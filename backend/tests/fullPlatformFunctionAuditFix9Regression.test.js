'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { StoreManager, createInitialState } = require('../store/StoreManager');
const { registerAiReplyCommands, normalizeQuotedContext } = require('../store/commands/registerAiReplyCommands');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function memoryPersistence(initialState) {
  return {
    async loadSnapshot() { return initialState; },
    async transaction(run) {
      return run({
        upsertAiReplyTask() {}, upsertAiReplyCandidate() {}, upsertOutboxItem() {},
        insertAiContextSnapshot() {}, appendStoreEvents() {}, persistStoreMeta() {}
      });
    }
  };
}

function commandState() {
  return createInitialState({
    auth: { ready: true, accountsById: { account1: { id: 'account1', state: 'ready', canAttemptSend: true, sendVerified: true, canSend: true } } },
    customers: { ready: true, byId: { contact1: { id: 'contact1', version: 1, accountId: 'account1', platform: 'whatsapp' } } },
    conversations: { ready: true, byId: { conv1: { id: 'conv1', version: 3, contactId: 'contact1', accountId: 'account1', platform: 'whatsapp', chatJid: '49123@s.whatsapp.net' } } },
    relationships: { ready: true, byContactId: { contact1: { version: 1 } } },
    memories: { ready: true, byContactId: { contact1: { version: 1, preferences: {} } } },
    interactionPolicies: { ready: true, byContactId: { contact1: { version: 1, allowReplies: true, blocked: false } } },
    routing: { ready: true, byTask: {} },
    aiBrain: { ready: true, tasksById: {}, candidatesById: {} },
    outbox: { ready: true, byId: {} }
  });
}

async function approvedOutboxManager() {
  const manager = new StoreManager({ persistence: memoryPersistence(commandState()) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  const task = await manager.dispatch({
    type: 'AI_REPLY_TASK_STARTED', source: 'test', payload: {
      contactId: 'contact1', conversationId: 'conv1', conversationRevision: 3,
      performanceMode: 'rapid', source: 'manual',
      entityVersions: { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 0 }
    }
  });
  const candidate = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_READY', source: 'test', payload: {
      taskId: task.result.taskId, text: 'Reply text', conversationRevision: 3,
      targetLanguage: 'English', targetLanguageCode: 'en', languageAuthority: { code: 'en' }, source: 'manual'
    }
  });
  const approved = await manager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED', source: 'test', payload: {
      candidateId: candidate.result.candidateId, text: 'Reply text', userApproved: true,
      approvedBy: 'user', learningMode: 'send_and_learn', source: 'manual'
    }
  });
  return { manager, outboxId: approved.result.outboxId };
}

test('final outbox confirmation persists normalized quoted-message context', async () => {
  const { manager, outboxId } = await approvedOutboxManager();
  const quoted = { quotedMessageId: 'wamid-quoted-1', quotedFromMe: false, quotedParticipant: '49123@s.whatsapp.net' };
  await manager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED', source: 'test', payload: { outboxId, confirmSend: true, quoted }
  });
  const outbox = manager.select(state => state.outbox.byId[outboxId]);
  assert.deepEqual(outbox.metadata.quoted, {
    key: { id: 'wamid-quoted-1', fromMe: false, participant: '49123@s.whatsapp.net' }
  });
});

test('quoted context normalizer rejects missing ids and preserves platform key fields', () => {
  assert.equal(normalizeQuotedContext({ quotedParticipant: 'nobody' }), null);
  assert.deepEqual(normalizeQuotedContext({
    key: { id: 'tg-9', remoteJid: '-10077', fromMe: true, participant: '77' },
    message: { message: 'quoted' }
  }), {
    key: { id: 'tg-9', fromMe: true, remoteJid: '-10077', participant: '77' },
    message: { message: 'quoted' }
  });
});

test('AI send-and-learn durable queue path forwards persisted quote', () => {
  const text = source('backend/services/aiReplyOutboxService.js');
  assert.match(text, /quoted:\s*current\.outbox\.metadata\?\.quoted\s*\|\|\s*null/u);
  assert.match(source('backend/routes/store.js'), /quoted:\s*req\.body\?\.quoted\s*\|\|\s*null/u);
  assert.match(source('frontend/js/r32-ui-runtime.js'), /confirmOutboxSend\(outboxId,true,\{quoted\}\)/u);
});

test('legacy account REST send route no longer drops quote fields', () => {
  const text = source('backend/routes/accounts.js');
  assert.match(text, /function quotedFromBody/u);
  assert.match(text, /quoted:\s*quotedFromBody\(req\.body\s*\|\|\s*\{\}\)/u);
});

test('core text send reconciles an uncertain first response using the identical idempotent payload', async () => {
  const bodies = [];
  let attempt = 0;
  const context = {
    window: { addEventListener() {}, dispatchEvent() {} },
    navigator: { onLine: true },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    AbortController,
    DOMException,
    URL,
    URLSearchParams,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
      bodies.push(options.body);
      attempt += 1;
      if (attempt === 1) throw new DOMException('uncertain', 'TimeoutError');
      return { ok: true, status: 200, async json() { return { ok: true, result: { state: 'sent' } }; } };
    }
  };
  context.window.window = context.window;
  vm.runInNewContext(source('frontend/js/core-client.js'), context, { filename: 'core-client.js' });
  const result = await context.window.YanceCore.messages.sendText({
    platform: 'whatsapp', accountId: 'a1', sessionKey: 'c1', chatJid: '49123@s.whatsapp.net',
    text: 'hello', idempotencyKey: 'stable-key-1'
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[1]).payload.idempotencyKey, 'stable-key-1');
  assert.equal(result.reconciledAfterUncertainResponse, true);
});


test('successful but malformed core response is reconciled with the same idempotency key', async () => {
  const bodies = [];
  let attempt = 0;
  const context = {
    window: { addEventListener() {}, dispatchEvent() {} },
    navigator: { onLine: true },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    AbortController,
    DOMException,
    URL,
    URLSearchParams,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
      bodies.push(options.body);
      attempt += 1;
      if (attempt === 1) return { ok: true, status: 200, async json() { throw new SyntaxError('truncated JSON'); } };
      return { ok: true, status: 200, async json() { return { ok: true, result: { state: 'sent' } }; } };
    }
  };
  context.window.window = context.window;
  vm.runInNewContext(source('frontend/js/core-client.js'), context, { filename: 'core-client.js' });
  const result = await context.window.YanceCore.messages.sendText({
    platform: 'telegram', accountId: 'a2', sessionKey: 'c2', chatJid: '1001',
    text: 'hello', idempotencyKey: 'stable-key-json-1'
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(result.reconciledAfterUncertainResponse, true);
});

test('composer retains the same idempotency key only while text is unchanged after an uncertain response', () => {
  const text = source('frontend/js/r32-ui-runtime.js');
  assert.match(text, /existingKey&&pendingText===t\?existingKey/u);
  assert.match(text, /发送结果暂未确认；再次点击会沿用同一发送标识核对结果，避免重复消息/u);
  assert.match(text, /delete composer\.dataset\.pendingSendKey;delete composer\.dataset\.pendingSendText/u);
});

test('current test runner supersedes obsolete Fix9 root runner and keeps release packaging separate', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'RUN_YANCE_FIX9_WINDOWS_UAT.ps1')), false);
  for (const file of ['backend/tests/round7ProductWiringP0.test.js','backend/tests/round7InboundIntelligenceP0.test.js','backend/tests/round7ModelRoutingP0.test.js']) assert.equal(fs.existsSync(path.join(ROOT, file)), true);
  assert.doesNotMatch(source('package.json'), /RUN_YANCE_FIX9_WINDOWS_UAT/);
});
