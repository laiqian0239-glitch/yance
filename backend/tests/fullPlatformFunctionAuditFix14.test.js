'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AvatarSyncService,
  avatarFailureRetryable
} = require('../services/avatarService');
const {
  avatarProbeMetaClassification
} = require('../services/facebookAdapter');
const bilingual = require('../services/bilingualUnderstandingService');
const terminology = require('../services/translationTerminologyService');
const {
  MessageTranslationService,
  translatableText
} = require('../services/messageTranslationService');

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('WAIT_TIMEOUT'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('Fix14 keeps transient Facebook avatar failures retryable and deterministic unsupported_get non-retryable', () => {
  assert.equal(avatarFailureRetryable('FACEBOOK_CONTACT_AVATAR_UNAVAILABLE'), true);
  assert.equal(avatarFailureRetryable('FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET'), false);
  assert.equal(avatarFailureRetryable('META_CONTACT_AVATAR_UNSUPPORTED_GET'), false);

  const transient = new AvatarSyncService({
    messageStore: {
      getConversation: () => ({ avatarUrl: '', avatarLastError: 'FACEBOOK_CONTACT_AVATAR_UNAVAILABLE', avatarUpdatedAt: new Date().toISOString() })
    },
    backgroundJobs: null
  });
  assert.equal(transient.needsRefresh('facebook:transient'), true);

  const deterministic = new AvatarSyncService({
    messageStore: {
      getConversation: () => ({ avatarUrl: '', avatarLastError: 'FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET', avatarUpdatedAt: new Date().toISOString() })
    },
    backgroundJobs: null
  });
  assert.equal(deterministic.needsRefresh('facebook:unsupported'), false);
});

test('Fix14 diagnostics do not turn generic contact-avatar-unavailable into deterministic unsupported_get', () => {
  assert.equal(avatarProbeMetaClassification({ messengerProfile: { diagnosis: 'contact-avatar-unavailable' } }), '');
  assert.equal(avatarProbeMetaClassification({ messengerProfile: { diagnosis: 'meta-contact-avatar-unsupported-get' } }), 'unsupported-get');
  assert.equal(avatarProbeMetaClassification({ pictureEdge: { metaReason: 'unsupported_get' } }), 'unsupported-get');
});

test('Fix14 translates legitimate bracketed text but skips known media placeholders', () => {
  assert.equal(translatableText({ text: '[Hello, how are you?]' }), '[Hello, how are you?]');
  assert.equal(translatableText({ text: '[image]' }), '');
  assert.equal(translatableText({ text: '[语音]' }), '');
});

test('Fix14 does not treat a foreign sentence containing a Chinese name as already translated', async () => {
  let calls = 0;
  const result = await bilingual.translateToChinese({
    text: 'Hallo 王先生, wie geht es dir?',
    sourceLanguage: 'de'
  }, {
    aiGateway: {
      async execute() {
        calls += 1;
        return { text: '王先生，你好，最近怎么样？', modelId: 'translation-primary', model: 'translation-primary' };
      }
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.translationStatus, 'success');
  assert.equal(result.translatedZh, '王先生，你好，最近怎么样？');
  assert.equal(bilingual.isChineseDominant('Hallo 王先生, wie geht es dir?'), false);
  assert.equal(bilingual.isChineseDominant('你好，我在 WhatsApp 上联系你'), true);
});

test('Fix14 keeps Chinese text with URLs on the identity path', async () => {
  let calls = 0;
  const result = await bilingual.translateToChinese({
    text: '这是订单详情，请查看 https://example.com/orders/ABC123',
    sourceLanguage: 'auto'
  }, {
    aiGateway: { async execute() { calls += 1; return { text: '不应调用' }; } }
  });
  assert.equal(calls, 0);
  assert.equal(result.translationModel, 'identity');
  assert.equal(result.translatedZh.includes('https://example.com'), true);
});

test('Fix14 restores spaced and double-digit terminology placeholders without swallowing surrounding spaces or colliding token indexes', () => {
  const mappings = Array.from({ length: 11 }, (_, index) => ({
    placeholder: `⟦YANCE_TERM_${index}⟧`,
    source: `TERM${index}`,
    restoreValue: `值${index}`
  }));
  const restored = terminology.restoreProtectedTerms('A [ YANCE_TERM_1 ] B [YANCE_TERM_10] C', mappings);
  assert.equal(restored, 'A 值1 B 值10 C');
  assert.equal(restored.includes('YANCE_TERM'), false);
});

test('Fix14 drops a queued translation whose source changed before execution and translates the latest source only once', async () => {
  const rows = new Map();
  rows.set('m1', {
    id: 'm1', accountId: 'fb-a', sessionKey: 'fb-a:contact', conversationId: 'fb-a:contact',
    direction: 'outbound', fromMe: true, text: 'Hallo'
  });
  const store = {
    getMessage(id) { const row = rows.get(id); return row ? { ...row } : null; },
    upsertMessage(input) { rows.set(input.id, { ...(rows.get(input.id) || {}), ...input }); return input.id; }
  };
  let modelCalls = 0;
  const service = new MessageTranslationService({
    storeProvider: () => store,
    maxConcurrency: 2,
    contactLanguageAuthority: { observeMessage() {} },
    bilingualUnderstandingService: {
      async translateToChinese(input) {
        modelCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return {
          sourceText: input.text,
          sourceLanguage: 'de',
          translatedZh: input.text === 'Hallo neu' ? '新的你好' : '旧的你好',
          translationStatus: 'success',
          translationModel: 'translation-primary',
          translatedAt: new Date().toISOString()
        };
      }
    },
    aiGateway: {}
  });

  const oldJob = service.createJob('m1', { background: true });
  rows.set('m1', { ...rows.get('m1'), text: 'Hallo neu' });
  assert.equal(service.enqueue('m1', { background: true }), true);

  await waitFor(() => service.listJobs({ messageId: 'm1' }).every(job => !['queued', 'running'].includes(job.status)));
  const jobs = service.listJobs({ messageId: 'm1' });
  const skipped = jobs.find(job => job.id === oldJob.id);
  assert.equal(skipped.status, 'cancelled');
  assert.equal(skipped.errorCode, 'TRANSLATION_SUPERSEDED');
  assert.equal(modelCalls, 1);
  assert.equal(rows.get('m1').translatedZh, '新的你好');
  service.close();
});

test('current Worker deployment verifier binds the exact v11 evidence contract without a root deployment script', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  assert.equal(fs.existsSync(path.join(repoRoot, 'DEPLOY_YANCE_FIX13_FACEBOOK_WORKER.ps1')), false);
  const deploy = fs.readFileSync(path.join(repoRoot, 'tools/facebook/deploy-avatar-proxy-routes.js'), 'utf8');
  assert.match(deploy, /AVATAR_CONTRACT_VERSION = 11/);
  assert.match(deploy, /EVIDENCE_CONTRACT_VERSION = 6/);
  assert.match(deploy, /facebook-avatar-translation-persistence-fix13-20260724/);
  assert.match(deploy, /FACEBOOK_AVATAR_DEPLOY_DOWNGRADE_REFUSED/);
});
