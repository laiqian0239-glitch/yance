'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const taskPolicy = require('../../backend/services/modelTaskRuntimePolicy');
const { normalizeRoute } = require('../../backend/services/modelRoutingIntegrityService');
const { MessageTranslationService } = require('../../backend/services/messageTranslationService');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

async function waitUntil(predicate, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('WAIT_TIMEOUT');
}

test('Fix16: all AI task timeouts enforce slow-local-model floors and safe ceilings', () => {
  assert.equal(taskPolicy.normalizeTimeoutMs('quick_reply', 5000), 180000);
  assert.equal(taskPolicy.normalizeTimeoutMs('translation', 120000), 180000);
  assert.equal(taskPolicy.normalizeTimeoutMs('deep_reply', 180000), 240000);
  assert.equal(taskPolicy.normalizeTimeoutMs('deep_reply', 1500000), 1200000);
  assert.equal(taskPolicy.normalizeTimeoutMs('understanding', 360000), 360000);
});

test('Fix16: task routes persist independent timeout alongside primary and fallback models', () => {
  const route = normalizeRoute({
    primary: 'ollama-primary',
    fallback: 'ollama-fallback',
    enabled: true,
    timeoutMs: 420000,
    maxTokens: 510
  }, 'understanding');
  assert.equal(route.primary, 'ollama-primary');
  assert.equal(route.fallback, 'ollama-fallback');
  assert.equal(route.timeoutMs, 420000);
  assert.equal(route.maxTokens, 510);
});

test('Fix16: unexpected translation exceptions settle message state from pending to failed', async () => {
  const messages = new Map();
  messages.set('m-1', {
    id: 'm-1',
    sessionKey: 'conversation-1',
    contactId: 'contact-1',
    accountId: 'wa-account',
    text: 'Guten Morgen',
    sourceLanguage: 'de'
  });
  const store = {
    getMessage(id) { return messages.get(id) || null; },
    upsertMessage(message) { messages.set(message.id, { ...message }); return message; }
  };
  const service = new MessageTranslationService({
    storeProvider: () => store,
    bilingualUnderstandingService: {
      async translateToChinese() {
        const error = new Error('local translator crashed');
        error.code = 'LOCAL_TRANSLATOR_CRASHED';
        throw error;
      }
    },
    aiGateway: {},
    contactLanguageAuthority: { observeMessage() {} },
    logger: { warn() {} },
    maxConcurrency: 1
  });

  assert.equal(service.enqueue('m-1', { background: true }), true);
  const job = await waitUntil(() => service.listJobs({ messageId: 'm-1', limit: 1 })[0]?.status === 'failed'
    ? service.listJobs({ messageId: 'm-1', limit: 1 })[0]
    : null);
  const saved = messages.get('m-1');
  assert.equal(job.errorCode, 'LOCAL_TRANSLATOR_CRASHED');
  assert.equal(saved.translationStatus, 'failed');
  assert.equal(saved.translationErrorCode, 'LOCAL_TRANSLATOR_CRASHED');
  assert.match(saved.translationError, /local translator crashed/);
  assert.equal(saved.translationTargetLanguage, 'zh');
  assert.ok(saved.translationSourceHash);
  service.close();
});

test('Fix16: renderer forwards backend translation updates to bilingual queue runtime', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\('message:translation-updated',\{detail:\{conversationId,messageId:/);
  assert.doesNotMatch(source, /new CustomEvent\('message:translation-updated',\{detail:payload\}\)/, 'renderer must not expose the backend event payload as a second message authority');
});

test('Fix16: account selector never exposes internal adapter account IDs as user identity fallback', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /looksLikeInternalAccountIdentity/);
  assert.match(source, /\|\|'账号名称待同步'/);
  assert.doesNotMatch(source, /\|\|candidates\[0\]\|\|'未识别账号'/);
  const capability = read('frontend/js/r32-platform-capability-runtime.js');
  const conversationCapabilities = read('frontend/js/r32-conversation-capabilities.js');
  assert.doesNotMatch(capability, /sourceAccountIdentity\) \|\| clean\(route\.sourceAccountId\)/);
  assert.doesNotMatch(conversationCapabilities, /sourceAccountIdentity\|\|route\.sourceAccountId/);
});

test('Fix16: AI workbench exposes per-task timeout controls and persists milliseconds', () => {
  const source = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(source, /TASK_TIMEOUT_LIMITS/);
  assert.match(source, /data-route-timeout/);
  assert.match(source, /timeoutMs:normalizeTaskTimeout\(r\.id,r\.timeoutMs\)/);
  assert.match(source, /Number\(e\.target\.value\)\*1000/);
});

test('Fix16: conversation analysis and media understanding no longer use 120-second model limits', () => {
  const repository = read('backend/repositories/workspaceRepository.js');
  const media = read('backend/services/mediaIntelligenceService.js');
  assert.match(repository, /normalizeTimeoutMs\('understanding', options\.timeoutMs\)/);
  assert.match(media, /timeoutMs: 300000/);
});
