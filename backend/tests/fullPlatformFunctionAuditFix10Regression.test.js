'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AccountContext } = require('../core/accountContext');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function contextWithMessageStore(messageStore, sendQueue = {}) {
  return new AccountContext({
    securityGuard: {}, accountManager: {}, accountStore: {}, accountMigration: {},
    messageStore, sendQueue, platformMessaging: {}, platformCapabilities: {},
    whatsapp: {}, facebook: {}, canonicalIdentity: {}, eventBus: {}
  });
}

test('Telegram native expression retries with the same idempotency key do not resend', async t => {
  let stored = null;
  let sends = 0;
  const queueByIdempotency = new Map();
  let lastQueue = null;
  const sendQueue = {
    status: () => ({ started: true }),
    async waitForTerminal() { return { queue: lastQueue, result: { deduplicated: lastQueue?.deduplicated === true } }; },
    async enqueueAction(input) {
      const key = input.idempotencyKey;
      const existing = queueByIdempotency.get(key);
      if (existing) {
        lastQueue = { ...existing, deduplicated: true };
        return lastQueue;
      }
      sends += 1;
      const queue = { id: `send-${key}`, state: 'sent', platformMessageId: 'telegram-remote-77', deduplicated: false };
      queueByIdempotency.set(key, queue);
      lastQueue = queue;
      stored = {
        id: queue.id,
        dedupeKey: queue.id,
        externalMessageId: 'telegram-remote-77',
        deliveryStatus: 'sent',
        type: 'gif',
        text: 'caption'
      };
      return queue;
    }
  };
  const context = contextWithMessageStore({ getMessageByDedupeKey: id => stored?.id === id ? stored : null }, sendQueue);
  const input = {
    platform: 'telegram', accountId: 'tg-account', chatJid: '10077', sessionKey: 'tg-account:10077',
    reference: 'short-lived-reference', kind: 'gif', caption: 'caption', idempotencyKey: 'stable-expression-key'
  };
  const first = await context.sendExpression(input);
  const second = await context.sendExpression(input);

  assert.equal(sends, 1);
  assert.equal(first.state, 'sent');
  assert.equal(second.state, 'sent');
  assert.equal(second.queue.deduplicated, true);
  assert.equal(second.result.deduplicated, true);
  assert.equal(second.queue.id, first.queue.id);
});

test('media stream quote preserves participant for WhatsApp group replies', () => {
  const backend = source('backend/routes/messages.js');
  const frontend = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(frontend, /X-Yance-Quoted-Participant/u);
  assert.match(backend, /x-yance-quoted-participant/u);
  assert.match(backend, /quotedParticipant \}\) : undefined/u);
});

test('media, forwarding and Telegram native expression sends share uncertain-response reconciliation', () => {
  const text = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(text, /async function reconcileIdempotentRequest/u);
  assert.match(text, /mediaSendPromise/u);
  assert.match(text, /activePending\.sendKey/u);
  assert.match(text, /forwardIdempotencyKeys/u);
  assert.match(text, /nativeExpressionIdempotencyKeys/u);
  assert.match(text, /R32_INVALID_RESPONSE/u);
  assert.match(text, /reconciledAfterUncertainResponse/u);
});

test('successful media send clears only the originating conversation caption and draft', () => {
  const text = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(text, /String\(contact\(\)\?\.id\|\|''\)===String\(c\.id\|\|''\)/u);
  assert.match(text, /composer\.value='';composer\.dispatchEvent\(new Event\('input',\{bubbles:true\}\)\)/u);
  assert.match(text, /if\(pending===activePending\)clearPending\(\)/u);
});

test('Telegram sticker send consumes quote without consuming unrelated composer text', () => {
  const text = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(text, /if\(!isSticker&&payload\.result\?\.composerTextConsumed===true/u);
  assert.match(text, /if\(!quoteSnapshot\|\|quote\?\.quotedMessageId===quoteSnapshot\.quotedMessageId\)clearQuote\(\)/u);
  assert.doesNotMatch(text, /if\(!isSticker\)clearQuote\(\)/u);
});

test('second malformed text-send response remains uncertain and retains its key', () => {
  const text = source('frontend/js/r32-ui-runtime.js');
  assert.match(text, /CORE_INVALID_RESPONSE\|R32_INVALID_RESPONSE/u);
  assert.match(text, /error\?\.name==='AbortError'/u);
  assert.match(text, /if\(!uncertain\)\{delete composer\.dataset\.pendingSendKey/u);
});

test('StoreManager and general R32 JSON clients reject malformed successful responses', () => {
  const store = source('frontend/js/r32-store-client.js');
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(store, /STORE_INVALID_RESPONSE/u);
  assert.match(store, /StoreManager 返回了无法解析的响应/u);
  assert.match(ui, /R32_INVALID_RESPONSE/u);
  assert.match(ui, /服务返回了无法解析的响应/u);
});


test('AI workbench and media analysis reject malformed successful responses', () => {
  const ai = source('frontend/js/r32-ai-workbench-runtime.js');
  const capabilities = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(ai, /AIW_INVALID_RESPONSE/u);
  assert.match(ai, /AI 工作台返回了无法解析的响应/u);
  assert.doesNotMatch(ai, /response\.json\(\)\.catch\(\(\)=>\(\{\}\)\)/u);
  assert.match(capabilities, /parseJsonResponse\(response,'素材读取'\)/u);
  assert.match(capabilities, /parseJsonResponse\(response,'媒体识别'\)/u);
  assert.match(capabilities, /媒体识别返回了无效结果/u);
});

test('current recursive test authority replaces obsolete Fix10 root runner', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'RUN_YANCE_FIX10_WINDOWS_UAT.ps1')), false);
  for (const file of ['backend/tests/round7ProductWiringP0.test.js','backend/tests/round7InboundIntelligenceP0.test.js','backend/tests/round7ModelRoutingP0.test.js']) assert.equal(fs.existsSync(path.join(ROOT, file)), true);
  assert.doesNotMatch(source('package.json'), /RUN_YANCE_FIX10_WINDOWS_UAT/);
});
