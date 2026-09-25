'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TypingStateService } = require('../../backend/services/typingStateService');

function createStore() {
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
    customers: { byId: { contact1: { id: 'contact1', accountId: 'account1', platform: 'whatsapp' } } },
    auth: { accountsById: { account1: { id: 'account1', adapterAccountId: 'wa-adapter', platform: 'whatsapp' } } },
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

function deferredWaitFixture() {
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const wait = (_ms, signal) => {
    startedResolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const error = new Error(String(signal.reason || 'aborted'));
        error.name = 'AbortError';
        error.code = String(signal.reason || 'aborted');
        reject(error);
        return;
      }
      signal?.addEventListener('abort', () => {
        const error = new Error(String(signal.reason || 'aborted'));
        error.name = 'AbortError';
        error.code = String(signal.reason || 'aborted');
        reject(error);
      }, { once: true });
    });
  };
  return { started, wait };
}

function serviceFixture(wait) {
  const storeManager = createStore();
  const presence = [];
  const service = new TypingStateService({
    storeManager,
    eventBus: new EventEmitter(),
    messaging: { sendPresence: async payload => { presence.push(payload.state); return { ok: true }; } },
    logger: { warn() {}, info() {}, error() {} },
    wait,
    random: () => 0.5
  });
  service.start();
  return { service, storeManager, presence };
}

test('M04 external Element handoff remains owned by TypingStateService and immediate release only releases Element physical send', async () => {
  const deferred = deferredWaitFixture();
  const { service, storeManager } = serviceFixture(deferred.wait);
  const task = service.prepareExternalTextSend({
    operationId: 'element:outbox-1',
    contactId: 'contact1',
    conversationId: 'conv1',
    accountId: 'account1',
    platform: 'whatsapp',
    chatJid: '491234@s.whatsapp.net',
    sourceKind: 'ai_assist',
    text: '这是一条需要真人打字节奏的回复。'
  });

  await deferred.started;
  const released = await service.releaseExternalTextSend({ operationId: 'element:outbox-1' });
  assert.equal(released.released, true);

  const ready = await task;
  assert.equal(ready.ready, true);
  assert.equal(ready.releasedEarly, true);
  assert.equal(ready.operationId, 'element:outbox-1');

  const states = storeManager.commands.filter(row => row.type === 'UPDATE_SELF_TYPING_STATE').map(row => row.payload);
  assert.ok(states.some(row => row.operationId === 'element:outbox-1' && row.canRelease === true));
  assert.ok(states.some(row => row.operationId === 'element:outbox-1' && row.progress === 100 && row.canRelease === false));
  assert.equal(typeof ready.sendResult, 'undefined', 'TypingStateService must not physically send Element text');

  const completed = await service.completeExternalTextSend({
    operationId: 'element:outbox-1',
    success: true,
    reason: 'element_send_success'
  });
  assert.equal(completed.completed, true);
  assert.ok(storeManager.commands.some(row =>
    row.type === 'UPDATE_SELF_TYPING_STATE'
    && row.payload.isTyping === false
    && row.payload.reason === 'element_send_success'));
  service.stop();
});

test('M04 user cancel aborts an in-flight external handoff before Element physical send', async () => {
  const deferred = deferredWaitFixture();
  const { service, storeManager } = serviceFixture(deferred.wait);
  const task = service.prepareExternalTextSend({
    operationId: 'element:outbox-cancel',
    contactId: 'contact1',
    conversationId: 'conv1',
    accountId: 'account1',
    platform: 'whatsapp',
    chatJid: '491234@s.whatsapp.net',
    sourceKind: 'ai_assist',
    text: '取消这条回复。'
  });

  await deferred.started;
  const cancelled = await service.notifyUserCancel({
    operationId: 'element:outbox-cancel',
    contactId: 'contact1',
    conversationId: 'conv1',
    reason: 'USER_CANCELLED_SEND'
  });
  assert.equal(cancelled.cancelled, 1);
  await assert.rejects(task, error => error?.name === 'AbortError');

  assert.ok(storeManager.commands.some(row =>
    row.type === 'UPDATE_SELF_TYPING_STATE'
    && row.payload.isTyping === false
    && row.payload.reason === 'USER_CANCELLED_SEND'));
  service.stop();
});
