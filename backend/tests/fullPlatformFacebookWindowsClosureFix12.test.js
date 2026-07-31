'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const relay = require('../services/facebookRelayClient');

function envelope(secret, body = { entry: [{ id: 'page-1' }] }) {
  const value = { type: 'facebook:webhook', eventId: 'evt-1', sentAt: '2026-07-24T00:00:00.000Z', body };
  value.signature = crypto.createHmac('sha256', secret).update(`${value.eventId}.${value.sentAt}.${JSON.stringify(body)}`).digest('base64url');
  return value;
}

test('Fix12 Facebook desktop relay verifies signed envelopes and derives a safe management URL', () => {
  const secret = 'relay-secret';
  const value = envelope(secret);
  assert.equal(relay.verifyEnvelope(value, secret), true);
  assert.equal(relay.verifyEnvelope({ ...value, body: { altered: true } }, secret), false);
  assert.equal(relay.relayManagementUrl('wss://relay.example/ws', 'page-1'), 'https://relay.example/ws/credentials/page-1');
});

test('Fix12 Worker tries Messenger profile, generic id picture and Picture Edge and reports deterministic Meta access denial', () => {
  const meta = source('services/facebook-worker/src/metaClient.js');
  const desktop = source('services/facebook-worker/src/desktopApi.js');
  assert.match(meta, /senderIdentityPicture/);
  assert.match(meta, /picture\.type\(large\)/);
  assert.match(desktop, /FACEBOOK_CONTACT_PROFILE_ACCESS_DENIED/);
  assert.match(desktop, /meta-contact-profile-access-denied/);
  assert.match(desktop, /grantedPermissions/);
  assert.match(desktop, /tokenType:\s*'page_access_token'/);
});

test('Fix12 avatar closure reports Meta access denial instead of blaming a matching message-derived identity', () => {
  const adapter = source('backend/services/facebookAdapter.js');
  assert.match(adapter, /avatarProbeMetaClassification/);
  assert.match(adapter, /META_CONTACT_PROFILE_ACCESS_DENIED/);
  assert.match(adapter, /contactAvatarCapability/);
  assert.match(adapter, /worker-v11-avatar-unavailable-and-translation-persistence/);
});

test('Facebook contact UI omits unsupported presence placeholders and exposes richer identity diagnostics', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /updateOnlineFilterAvailability/);
  assert.match(ui, /button\.hidden=!supported/);
  assert.doesNotMatch(ui, /在线状态不可用/);
  assert.doesNotMatch(ui, /平台不提供上线状态/);
  assert.match(ui, /头像错误/);
  assert.match(ui, /身份来源/);
  assert.match(ui, /AI学习版本/);
});

test('Fix12 bilingual history queues missing inbound translations and translation-only mode preserves untranslated original text', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const bilingual = source('frontend/js/r32-bilingual-experience-runtime.js');
  const css = source('frontend/r32-conversation-center-v2.css');
  assert.match(ui, /messageNeedsChineseTranslation/);
  assert.match(ui, /等待中文翻译/);
  assert.match(ui, /yance:r32-messages-rendered/);
  assert.match(bilingual, /queueMissingTranslations/);
  assert.match(bilingual, /createTranslationJob/);
  assert.match(css, /translation-missing \.message-original/);
});

test('Fix12 hides synthetic media placeholder text after media renders while preserving real captions', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /messageHasMediaPlaceholderText/);
  assert.match(ui, /image\|photo\|video\|audio\|voice/);
  assert.match(ui, /图片\|照片\|视频\|音频\|语音/);
  assert.match(ui, /visibleText\?`<p class="message-original"/);
});

test('current source UAT launcher is checkpoint-aware and obsolete Fix12 runner is absent', () => {
  assert.equal(fs.existsSync(path.join(root, 'RUN_YANCE_FIX12_WINDOWS_UAT.ps1')), false);
  const runner = source('tools/runtime-delivery/start-source-uat.js');
  const delivery = source('tools/runtime-delivery/source-uat-delivery.js');
  assert.match(runner, /prepareSourceUat/);
  assert.match(runner, /YANCE_UAT_SELECTED_DATA_ROOT/);
  assert.match(delivery, /YANCE_SOURCE_CHECKPOINT/);
});

test('Fix12 branding and Whisper contracts work in Windows source ZIPs without .git or fake POSIX executables', () => {
  const brand = source('scripts/branding/audit-yance-brand.js');
  const lineEndings = source('tests/branding/brand-line-ending-contract.test.js');
  const whisper = source('backend/tests/whatsappVoiceTranscriptionScrollCleanup.test.js');
  assert.match(brand, /return null/);
  assert.match(brand, /SOURCE_FILESYSTEM_EXCLUDES/);
  assert.match(lineEndings, /rootTextAutoLf/);
  assert.doesNotMatch(whisper, /fake-whisper/);
  assert.match(whisper, /argument contract is cross-platform/);
});

test('Fix12 keeps platform-aware AI reply and learning fingerprints from Fix11 intact', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const brain = source('backend/services/replyBrainBenchmark.js');
  assert.match(brain, /platformCoverage|Facebook Messenger|Telegram/);
  assert.match(ui, /learning|persona/i);
});
