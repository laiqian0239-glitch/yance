'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  buildHumanTypingPlan,
  normalizeTypingPolicy,
  resolveTypingTier
} = require('../store/typing/typingPolicy');
const { TypingStateService, wait: realWait } = require('../services/typingStateService');
const { StoreManager, createInitialState } = require('../store/StoreManager');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');

function deterministicRandom(values = [0.5]) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

function storeFixture() {
  const state = {
    conversations: {
      byId: {
        conv1: {
          id: 'conv1',
          contactId: 'contact1',
          accountId: 'account1',
          platform: 'whatsapp',
          chatJid: '491234@s.whatsapp.net'
        }
      }
    },
    customers: {
      byId: {
        contact1: { id: 'contact1', accountId: 'account1', platform: 'whatsapp' }
      }
    },
    auth: {
      accountsById: {
        account1: { id: 'account1', adapterAccountId: 'wa-adapter', platform: 'whatsapp' }
      }
    },
    typingState: { byContactId: {} }
  };
  const commands = [];
  return {
    state,
    commands,
    select: selector => selector(state),
    dispatch: async command => {
      commands.push(command);
      return { result: command.payload || {} };
    }
  };
}

function serviceFixture(options = {}) {
  const eventBus = new EventEmitter();
  const storeManager = storeFixture();
  const presence = [];
  const service = new TypingStateService({
    storeManager,
    eventBus,
    messaging: {
      sendPresence: async payload => {
        presence.push(payload.state);
        options.onPresence?.(payload);
        return { ok: true, state: payload.state };
      }
    },
    logger: { warn() {}, info() {}, error() {} },
    wait: options.wait || (async () => {}),
    random: options.random || deterministicRandom([0.5]),
    policy: options.policy || {}
  });
  service.start();
  return { service, eventBus, storeManager, presence };
}

test('human typing tiers follow the requested time envelopes and short replies avoid four bursts', () => {
  const policy = normalizeTypingPolicy({});
  assert.equal(createInitialState().typingState.policy.platformDuringGeneration, false);
  assert.equal(buildHumanTypingPlan('普通回复内容', policy, { tier: 'normal', random: deterministicRandom([1]) }).bursts.length, 4);
  const simple = buildHumanTypingPlan('好的', policy, { random: deterministicRandom([0.9]) });
  const normal = buildHumanTypingPlan('我明白你的意思了，晚一点我会把完整情况整理好再回复你。', policy, { random: deterministicRandom([0.5]) });
  const complex = buildHumanTypingPlan('第一部分需要确认。\n第二部分涉及时间安排。\n第三部分我会重新核对。\n最后我会给你一个完整答复。', policy, { random: deterministicRandom([0.4]) });

  const rapid = buildHumanTypingPlan('你呢？', policy, { tier: 'rapid', random: deterministicRandom([0.5]) });
  assert.equal(resolveTypingTier('热聊回复', policy, { complexityHint: 'rapid' }), 'rapid');
  assert.equal(rapid.tier, 'rapid');
  assert.ok(rapid.totalMs >= 3_000 && rapid.totalMs <= 12_000);
  assert.ok(rapid.bursts.length >= 1 && rapid.bursts.length <= 2);

  assert.equal(resolveTypingTier('好的', policy), 'simple');
  assert.equal(simple.tier, 'simple');
  assert.equal(simple.bursts.length, 1);
  assert.ok(simple.totalMs >= 18_000 && simple.totalMs <= 40_000);

  assert.equal(normal.tier, 'normal');
  assert.ok(normal.bursts.length >= 2 && normal.bursts.length <= 4);
  assert.ok(normal.totalMs >= 45_000 && normal.totalMs <= 85_000);

  assert.equal(complex.tier, 'complex');
  assert.ok(complex.bursts.length >= 3 && complex.bursts.length <= 5);
  assert.ok(complex.totalMs >= 80_000 && complex.totalMs <= 150_000);
});

test('AI generation remains locally visible but never exposes platform composing', async () => {
  const { service, presence, storeManager } = serviceFixture();
  const session = await service.beginAiGeneration({ contactId: 'contact1', conversationId: 'conv1' });
  assert.equal(session.started, true);
  assert.deepEqual(presence, []);
  assert.ok(storeManager.commands.some(command => command.type === 'UPDATE_SELF_TYPING_STATE' && command.payload.phase === 'ai_generation'));
  await service.endAiGeneration({ contactId: 'contact1', conversationId: 'conv1' });
  service.stop();
});

test('approved WhatsApp reply alternates composing and paused and sends inside the final composing burst', async () => {
  const timeline = [];
  const waits = [];
  const { service, presence } = serviceFixture({
    wait: async ms => { waits.push(ms); timeline.push(`wait:${ms}`); },
    random: deterministicRandom([0.5]),
    onPresence: payload => timeline.push(payload.state)
  });

  const result = await service.simulateApprovedSend({
    contactId: 'contact1',
    conversationId: 'conv1',
    text: '我明白你的意思了，晚一点我会把完整情况整理好再回复你。',
    preFinalCheck: async () => ({ blocked: false, token: 'frozen' }),
    send: async ({ sendContext }) => {
      assert.equal(sendContext.token, 'frozen');
      timeline.push('send');
      return { id: 'queue-1' };
    }
  });

  assert.equal(result.simulated, true);
  assert.equal(result.plan.tier, 'normal');
  assert.ok(waits[0] >= 18_000, 'first wait must be silent reading delay');
  assert.deepEqual(presence, ['composing', 'paused', 'composing', 'paused', 'composing', 'paused']);
  const sendIndex = timeline.indexOf('send');
  const finalPausedIndex = timeline.lastIndexOf('paused');
  assert.ok(sendIndex > timeline.lastIndexOf('composing'));
  assert.ok(sendIndex < finalPausedIndex, 'message enqueue must occur before the final paused state');
  service.stop();
});

test('new incoming message aborts the silent phase without exposing composing', async () => {
  let waiting = false;
  const wait = (_ms, signal) => new Promise((resolve, reject) => {
    waiting = true;
    const abort = () => {
      const error = new Error(String(signal.reason || 'aborted'));
      error.name = 'AbortError';
      error.code = String(signal.reason || 'aborted');
      reject(error);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  const { service, presence } = serviceFixture({ wait, random: deterministicRandom([0.5]) });
  const task = service.simulateApprovedSend({
    contactId: 'contact1',
    conversationId: 'conv1',
    text: '这是普通回复，需要先静默阅读。',
    send: async () => ({ id: 'must-not-send' })
  });
  while (!waiting) await Promise.resolve();
  await service._handleMessageInserted({ payload: { message: {
    id: 'incoming-2',
    conversationId: 'conv1',
    contactId: 'contact1',
    accountId: 'account1',
    platform: 'whatsapp',
    direction: 'inbound'
  } } });
  await assert.rejects(task, error => error.code === 'NEW_INCOMING_MESSAGE');
  assert.deepEqual(presence, []);
  service.stop();
});

test('manual keyboard activity cancels an active simulated burst and immediately sends paused', async () => {
  let signalBurstStarted;
  const burstStarted = new Promise(resolve => { signalBurstStarted = resolve; });
  const { service, presence } = serviceFixture({
    wait: realWait,
    random: deterministicRandom([0]),
    onPresence: payload => { if (payload.state === 'composing') signalBurstStarted(); },
    policy: {
      finalSendDelayMinMs: 0,
      finalSendDelayMaxMs: 0,
      tiers: {
        simple: {
          silentDelayMinMs: 0,
          silentDelayMaxMs: 0,
          minBursts: 1,
          maxBursts: 1,
          burstMinMs: 1000,
          burstMaxMs: 1000,
          pauseMinMs: 0,
          pauseMaxMs: 0,
          totalMinMs: 1000,
          totalMaxMs: 1000
        }
      }
    }
  });
  const task = service.simulateApprovedSend({
    contactId: 'contact1',
    conversationId: 'conv1',
    text: '好的',
    send: async () => ({ id: 'must-not-send' })
  });
  await burstStarted;
  await service.notifyManualTyping({ contactId: 'contact1', conversationId: 'conv1' });
  await assert.rejects(task, error => error.code === 'MANUAL_TYPING_STARTED');
  assert.equal(presence.at(-1), 'paused');
  service.stop();
});


test('user cancel aborts a silent approved send and keeps the approved reply available for later confirmation', async () => {
  let waiting = false;
  const wait = (_ms, signal) => new Promise((resolve, reject) => {
    waiting = true;
    signal.addEventListener('abort', () => {
      const error = new Error(String(signal.reason || 'aborted'));
      error.name = 'AbortError';
      error.code = String(signal.reason || 'aborted');
      reject(error);
    }, { once: true });
  });
  const { service, presence } = serviceFixture({ wait, random: deterministicRandom([0.5]) });
  const task = service.simulateApprovedSend({
    contactId: 'contact1',
    conversationId: 'conv1',
    text: '这是一条用户可以在静默准备阶段取消的普通回复。',
    send: async () => ({ id: 'must-not-send' })
  });
  while (!waiting) await Promise.resolve();
  await service.notifyUserCancel({ contactId: 'contact1', conversationId: 'conv1' });
  await assert.rejects(task, error => error.code === 'USER_CANCELLED_SEND');
  assert.deepEqual(presence, []);
  service.stop();
});

test('outbox abort distinguishes user cancellation from stale incoming context', async () => {
  const seed = createInitialState({
    meta: { hydrated: true },
    customers: { byId: { contact1: { id: 'contact1', version: 1 } } },
    conversations: { byId: { conv1: { id: 'conv1', contactId: 'contact1', accountId: 'account1', platform: 'whatsapp' } } },
    auth: { accountsById: { account1: { id: 'account1', state: 'ready', canAttemptSend: true, sendVerified: true, canSend: true } } },
    aiBrain: {
      tasksById: { task1: { taskId: 'task1', status: 'awaiting_send_confirmation' } },
      candidatesById: { candidate1: { candidateId: 'candidate1', taskId: 'task1', text: '回复', originalText: '回复', state: 'approved' } }
    },
    outbox: {
      byId: {
        outbox1: {
          id: 'outbox1', taskId: 'task1', candidateId: 'candidate1', contactId: 'contact1', conversationId: 'conv1',
          accountId: 'account1', platform: 'whatsapp', text: '回复', originalText: '回复', state: 'send_confirmed',
          userApproved: true, metadata: { entityVersions: { customer: 1, relationship: 0, memory: 0, interactionPolicy: 0, routing: 0 } }
        }
      }
    }
  });
  const manager = new StoreManager({ persistence: { loadSnapshot: async () => seed } });
  registerAiReplyCommands(manager);
  await manager.hydrate();

  await manager.dispatch({
    type: 'OUTBOX_SEND_ABORTED',
    source: 'test',
    payload: { outboxId: 'outbox1', reason: 'USER_CANCELLED_SEND', reverifyRequired: false }
  });
  let snapshot = manager.snapshot();
  assert.equal(snapshot.outbox.byId.outbox1.state, 'approved');
  assert.equal(snapshot.aiBrain.tasksById.task1.status, 'awaiting_send_confirmation');
  assert.equal(snapshot.aiBrain.candidatesById.candidate1.state, 'approved');

  await manager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED',
    source: 'test',
    payload: { outboxId: 'outbox1', confirmSend: true }
  });
  await manager.dispatch({
    type: 'OUTBOX_SEND_ABORTED',
    source: 'test',
    payload: { outboxId: 'outbox1', reason: 'NEW_INCOMING_MESSAGE', reverifyRequired: true }
  });
  snapshot = manager.snapshot();
  assert.equal(snapshot.outbox.byId.outbox1.state, 'reverify_required');
  assert.equal(snapshot.aiBrain.tasksById.task1.status, 'cancelled');
  assert.equal(snapshot.aiBrain.candidatesById.candidate1.state, 'reverify_required');
});

test('frontend contract cancels simulation on trusted manual input and conversation change', () => {
  const fs = require('node:fs');
  const runtime = fs.readFileSync(require('node:path').join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const capabilities = fs.readFileSync(require('node:path').join(__dirname, '../../frontend/js/r32-conversation-capabilities.js'), 'utf8');
  const core = fs.readFileSync(require('node:path').join(__dirname, '../../frontend/js/core-client.js'), 'utf8');
  assert.match(core, /message\.typing\.cancel/);
  assert.match(runtime, /cancelTypingForContact\(previous,'conversation_changed'\)/);
  assert.match(runtime, /typingCancel==='1'/);
  assert.match(runtime, /'user_cancel'/);
  assert.match(capabilities, /if\(!event\.isTrusted\)return/);
  assert.match(capabilities, /cause:'manual_input'/);
});
