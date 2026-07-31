'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const terminology = require('../services/translationTerminologyService');
const bilingual = require('../services/bilingualUnderstandingService');
const { MessageTranslationService, translationSourceHash } = require('../services/messageTranslationService');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { FacebookAdapter } = require('../services/facebookAdapter');
const relayClient = require('../services/facebookRelayClient');
const messageStore = require('../services/messageStore');

function patch(t, target, key, value) {
  const previous = target[key];
  target[key] = value;
  t.after(() => { target[key] = previous; });
}

function fakeStore(seed = {}) {
  const messages = new Map(Object.entries(seed));
  return {
    messages,
    getMessage(id) { return messages.get(id) || null; },
    upsertMessage(input) { messages.set(input.id, { ...input }); return input.id; }
  };
}

test('Fix13 translates both incoming and outgoing foreign-language messages and does not requeue fresh persisted results', async () => {
  const store = fakeStore({
    out1: {
      id: 'out1', accountId: 'fb-a', sessionKey: 'fb-a:contact', conversationId: 'fb-a:contact',
      contactId: 'contact', direction: 'outbound', side: 'me', text: 'Danke dir', language: 'de'
    }
  });
  let calls = 0;
  const service = new MessageTranslationService({
    storeProvider: () => store,
    bilingualUnderstandingService: {
      async translateToChinese(input) {
        calls += 1;
        return {
          sourceText: input.text,
          sourceLanguage: 'de',
          translatedZh: '谢谢你',
          translationStatus: 'success',
          translationModel: 'translategemma:4b',
          translatedAt: '2026-07-24T00:00:00.000Z'
        };
      }
    },
    contactLanguageAuthority: { observeMessage() {} },
    logger: { warn() {} }
  });

  const first = await service.translateMessage('out1');
  assert.equal(first.status, 'success');
  assert.equal(store.getMessage('out1').translatedZh, '谢谢你');
  assert.equal(store.getMessage('out1').translationSourceHash, translationSourceHash('Danke dir'));
  assert.equal(store.getMessage('out1').translationTargetLanguage, 'zh');

  const second = await service.translateMessage('out1');
  assert.equal(second.status, 'cached');
  assert.equal(calls, 1);
  service.close();
});


test('Fix13 automatic translation event wiring includes outgoing messages', async () => {
  const eventBus = require('../services/eventBus');
  const service = new MessageTranslationService({
    storeProvider: () => fakeStore(),
    bilingualUnderstandingService: {},
    contactLanguageAuthority: { observeMessage() {} },
    logger: { warn() {} }
  });
  const enqueued = [];
  service.enqueue = (input, options) => { enqueued.push({ input, options }); return true; };
  service.install();
  eventBus.publish('message:inserted', {
    message: { id: 'out-event', direction: 'outbound', side: 'me', fromMe: true, text: 'Guten Abend' }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].input, 'out-event');
  assert.equal(enqueued[0].options.background, true);
  service.close();
});

test('Fix13 repairs malformed YANCE terminology placeholders before persisting Chinese translation', async () => {
  const sourceText = 'Ok mit Namen Sheti WhatsApp +491746634486';
  const packed = terminology.maskProtectedTerms(sourceText);
  assert.ok(packed.mappings.length >= 1);
  assert.equal(
    terminology.restoreProtectedTerms('好的，WhatsApp 是 [YANCE_TERM_0]', packed.mappings).includes('+491746634486'),
    true
  );

  const calls = [];
  const result = await bilingual.translateToChinese({ text: sourceText, sourceLanguage: 'de' }, {
    aiGateway: {
      async execute(request) {
        calls.push(request);
        if (calls.length === 1) return { text: 'WhatsApp [YANCE_TERM_0]', model: 'translategemma:4b' };
        return { text: '好的，没问题。Sheti 的 WhatsApp 是 [YANCE_TERM_0]', model: 'fallback-translation' };
      },
      resolveRoute() { return { fallback: { id: 'fallback-translation' } }; }
    }
  });

  assert.equal(result.translationStatus, 'success');
  assert.equal(result.translatedZh.includes('+491746634486'), true);
  assert.equal(result.translatedZh.includes('YANCE_TERM'), false);
  assert.equal(result.translationAttempts.length, 2);
  assert.equal(calls[1].modelId, 'fallback-translation');
});

test('Fix13 SQLite upserts preserve successful translations across delivery updates and mark them stale only when source text changes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix13-translation-'));
  const store = new R32SqliteStore({ dbPath: path.join(dir, 'yance.db') });
  t.after(() => {
    try { store.close(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  store.upsertConversation({ sessionKey: 'fb-a:contact', accountId: 'fb-a', platform: 'facebook', title: 'Contact' });
  store.upsertMessage({
    id: 'm1', sessionKey: 'fb-a:contact', accountId: 'fb-a', direction: 'inbound', text: 'Hallo',
    translatedZh: '你好', translationStatus: 'success', sourceText: 'Hallo',
    translationSourceHash: translationSourceHash('Hallo'), translationTargetLanguage: 'zh',
    translationModel: 'translategemma:4b', translatedAt: '2026-07-24T00:00:00.000Z'
  });
  store.upsertMessage({
    id: 'm1', sessionKey: 'fb-a:contact', accountId: 'fb-a', direction: 'inbound', text: 'Hallo',
    deliveryStatus: 'read', translatedZh: undefined, translationStatus: undefined, updatedAt: '2026-07-24T00:01:00.000Z'
  });
  const afterStatus = store.getMessage('m1');
  assert.equal(afterStatus.translatedZh, '你好');
  assert.equal(afterStatus.translationStatus, 'success');
  assert.equal(afterStatus.translationSourceHash, translationSourceHash('Hallo'));

  store.upsertMessage({
    id: 'm1', sessionKey: 'fb-a:contact', accountId: 'fb-a', direction: 'inbound', text: 'Hallo Klaus',
    deliveryStatus: 'read', updatedAt: '2026-07-24T00:02:00.000Z'
  });
  const afterEdit = store.getMessage('m1');
  assert.equal(afterEdit.translationStatus, 'stale');
  assert.equal(afterEdit.translatedZh, '');
  assert.equal(afterEdit.lastSuccessfulTranslatedZh, '你好');
  assert.equal(afterEdit.sourceText, 'Hallo Klaus');
});

test('Fix13 classifies deterministic Meta unsupported_get as an unavailable contact-avatar capability without automatic retry', async t => {
  const adapter = new FacebookAdapter();
  patch(t, adapter, 'credentials', () => ({ secret: { workerBaseUrl: 'https://worker.example', pageId: 'page-1' } }));
  patch(t, global, 'fetch', async () => new Response(JSON.stringify({
    ok: true,
    avatarProxyContract: { version: 11, evidenceContractVersion: 6 }
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  patch(t, relayClient, 'health', async () => ({ status: 'ready', queue: { pending: 0 } }));
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind) => {
    if (kind === 'page') return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' };
    throw Object.assign(new Error('unsupported get'), {
      code: 'FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET',
      status: 409,
      details: {
        requestId: 'safe-request-id',
        pictureEdgeCode: 'FACEBOOK_AVATAR_FETCH_FAILED', pictureEdgeStatus: 403,
        identityPictureCode: 'FACEBOOK_REQUEST_INVALID', identityPictureStatus: 409,
        identityPictureMetaCode: 100, identityPictureMetaSubcode: 33, identityPictureMetaReason: 'unsupported_get',
        profileCode: 'FACEBOOK_REQUEST_INVALID', profileStatus: 409,
        profileMetaCode: 100, profileMetaSubcode: 33, profileMetaReason: 'unsupported_get',
        diagnosis: 'meta-contact-avatar-unsupported-get', deterministic: true, retryable: false
      }
    });
  });
  patch(t, messageStore, 'listConversations', () => [{
    platform: 'facebook', accountId: 'fb-account', conversationId: 'fb-account:123456789',
    pageScopedUserId: '123456789', title: 'Contact', avatarUrl: '/existing/avatar.jpg', avatarStatus: 'ready'
  }]);

  const report = await adapter.diagnoseAvatarClosure({ id: 'fb-account' }, { limit: 1 });
  assert.equal(report.contacts[0].rootCause, 'META_CONTACT_AVATAR_UNSUPPORTED_GET');
  assert.equal(report.contacts[0].capability.status, 'meta-api-unavailable');
  assert.equal(report.contacts[0].capability.retryRecommended, false);
  assert.equal(report.contacts[0].capability.deterministic, true);
  assert.equal(report.contacts[0].capability.preservedAvatar, true);
  assert.equal(report.summary.contactAvatarUnsupportedGet, 1);
  assert.equal(report.summary.contactAvatarCapability, 'meta-api-unavailable');
  assert.equal(JSON.stringify(report).includes('123456789'), false);
});

test('current product keeps outgoing translation, persistence and Worker v11 classification without obsolete root runners', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const bilingualRuntime = source('frontend/js/r32-bilingual-experience-runtime.js');
  const store = source('backend/lib/r32SqliteStore.js');
  const adapter = source('backend/services/facebookAdapter.js');
  const worker = source('services/facebook-worker/src/index.js');
  const deploy = source('tools/facebook/deploy-avatar-proxy-routes.js');
  assert.match(ui, /function messageTextIsChineseDominant\(text=''/);
  assert.match(ui, /function messageNeedsChineseTranslation\(message=\{\}\).*knownChinese/);
  assert.match(bilingualRuntime, /autoTranslationQueued\.clear\(\)/);
  assert.match(store, /mergeMessagePayload/);
  assert.match(store, /translationStatus = 'stale'/);
  assert.match(adapter, /META_CONTACT_AVATAR_UNSUPPORTED_GET/);
  assert.match(adapter, /meta-api-unavailable/);
  assert.match(worker, /version:\s*11/);
  assert.match(worker, /deterministicUnsupportedGetClassification:\s*true/);
  assert.match(deploy, /DEPLOYMENT_MARKER/);
  for (const file of ['RUN_YANCE_FIX13_WINDOWS_UAT.ps1','DEPLOY_YANCE_FIX13_FACEBOOK_WORKER.ps1']) assert.equal(fs.existsSync(path.join(root, file)), false);
});
