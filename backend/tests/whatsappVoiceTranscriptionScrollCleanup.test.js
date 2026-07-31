'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-voice-scroll-cleanup-'));
process.env.YANCE_DATA_DIR = dataRoot;

const messages = require('../repositories/messageRepository');
const workspace = require('../repositories/workspaceRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');
const transcription = require('../services/transcriptionService');
const scroll = require('../../frontend/js/r32-message-interaction-runtime');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

process.on('exit', () => {
  try { closeStore(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

function ensureAccount(accountId) {
  getStore().upsertAccount({
    id: accountId, platform: 'whatsapp', adapterAccountId: accountId,
    displayName: accountId, state: 'ready', canAttemptSend: true,
    sendVerified: true, canSend: true, canReceive: true
  });
}

async function unsupportedRow({ accountId, sessionKey, id, sentAt = '2026-07-21T15:14:50.000Z' }) {
  ensureAccount(accountId);
  await messages.upsert({
    id,
    externalMessageId: id,
    dedupeKey: id,
    accountId,
    conversationId: sessionKey,
    sessionKey,
    chatJid: sessionKey.split(':').slice(1).join(':'),
    platform: 'whatsapp',
    direction: 'outbound',
    fromMe: true,
    type: 'unknown',
    text: '对方发送了一条暂不支持的消息',
    timestamp: sentAt,
    status: 'sent'
  });
}

test('legacy empty synthetic voice conversation is archived even after an older build already deleted its duplicate rows', async () => {
  const accountId = 'legacy-empty-artifact';
  const sessionKey = `${accountId}:4915739003140@s.whatsapp.net`;
  await unsupportedRow({ accountId, sessionKey, id: 'legacy-a' });
  await unsupportedRow({ accountId, sessionKey, id: 'legacy-b' });
  const store = getStore();
  const conversation = store.db.prepare('SELECT payload_json FROM r32_conversations WHERE session_key=?').get(sessionKey);
  const payload = JSON.parse(conversation.payload_json);
  payload.lastMessage = '对方发送了一条暂不支持的消息';
  store.db.prepare('UPDATE r32_conversations SET payload_json=?,last_message=?,last_message_at=? WHERE session_key=?')
    .run(JSON.stringify(payload), '', '', sessionKey);
  store.db.prepare('DELETE FROM r32_messages_fts WHERE session_key=?').run(sessionKey);
  store.db.prepare('DELETE FROM r32_messages WHERE session_key=?').run(sessionKey);

  const result = messages.collapseDuplicateUnsupportedMobileEchoes(accountId);
  assert.equal(result.groups, 0);
  assert.deepEqual(result.archivedConversations, [sessionKey]);
  const row = store.db.prepare('SELECT archived_at,archive_reason FROM r32_conversations WHERE session_key=?').get(sessionKey);
  assert.ok(row.archived_at);
  assert.equal(row.archive_reason, 'synthetic-mobile-voice-echo');
  assert.equal(messages.listConversations({ limit: 500 }).some(item => item.sessionKey === sessionKey), false);
  assert.equal(workspace.listContacts({ limit: 500 }).some(item => item.id === store.db.prepare('SELECT contact_id FROM r32_conversations WHERE session_key=?').get(sessionKey).contact_id), false);
});

test('empty weak WhatsApp contact without synthetic marker is not archived', async () => {
  const accountId = 'legitimate-empty-contact';
  const sessionKey = `${accountId}:4915000000000@s.whatsapp.net`;
  ensureAccount(accountId);
  await messages.upsert({
    id: 'legitimate-text', externalMessageId: 'legitimate-text', dedupeKey: 'legitimate-text',
    accountId, conversationId: sessionKey, sessionKey, chatJid: '4915000000000@s.whatsapp.net',
    platform: 'whatsapp', direction: 'inbound', fromMe: false, type: 'text', text: 'Hallo', timestamp: '2026-07-21T15:20:00.000Z'
  });
  const store = getStore();
  store.db.prepare('DELETE FROM r32_messages_fts WHERE session_key=?').run(sessionKey);
  store.db.prepare('DELETE FROM r32_messages WHERE session_key=?').run(sessionKey);
  store.db.prepare("UPDATE r32_conversations SET last_message='',last_message_at='' WHERE session_key=?").run(sessionKey);
  const result = messages.collapseDuplicateUnsupportedMobileEchoes(accountId);
  assert.deepEqual(result.archivedConversations, []);
  const row = store.db.prepare('SELECT archived_at FROM r32_conversations WHERE session_key=?').get(sessionKey);
  assert.equal(row.archived_at, '');
});

test('scroll persistence distinguishes bottom, anchor and legacy offset states', () => {
  assert.deepEqual(scroll.normalizeScrollState(420), { version: 3, mode: 'offset', scrollTop: 420 });
  assert.equal(scroll.normalizeScrollState({ mode: 'bottom', scrollTop: 900 }).mode, 'bottom');
  assert.deepEqual(scroll.normalizeScrollState({ mode: 'anchor', messageId: 'm-2', offsetPx: 18, scrollTop: 250 }), {
    version: 3, mode: 'anchor', scrollTop: 250, messageId: 'm-2', externalMessageId: '', offsetPx: 18
  });
  assert.equal(scroll.scrollStateIsBottom({ mode: 'bottom' }), true);
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /captureMessageScrollState/);
  assert.match(ui, /restoreMessageScrollState/);
  assert.match(ui, /uiVersion:4/);
  assert.match(ui, /Number\(s\.uiVersion\|\|0\)>=4/);
  assert.match(ui, /restoreMessagePositionAfterMediaLayout/);
  const diagnostics = source('tools/uat/whatsappIdentityDiagnostics.js');
  assert.match(diagnostics, /syntheticMobileEchoArtifactsHidden/);
  assert.match(diagnostics, /row\.isActive/);
  assert.match(diagnostics, /synthetic-mobile-voice-echo/);
});

test('whisper.cpp argument contract is cross-platform and the current runtime-delivery installer is wired through API and UI', () => {
  const transcriptionSource = source('backend/services/transcriptionService.js');
  assert.match(transcriptionSource, /const args = \['-m', engine\.model, '-f', inputFile, '-l', language === 'auto' \? 'auto' : language, '-nt'\];/);
  assert.match(transcriptionSource, /runCommand\(engine\.command, args\)/);

  const installerService = source('backend/services/speechInstallerService.js');
  const installer = source('tools/runtime-delivery/install-local-whisper.ps1');
  const routes = source('backend/routes/system.js');
  const frontend = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(installerService, /tools', 'runtime-delivery', 'install-local-whisper\.ps1/);
  assert.match(installer, /whisper-bin-x64\.zip/);
  assert.match(installer, /ggml-base\.bin/);
  assert.match(installer, /Gyan\.FFmpeg\.Essentials/);
  assert.match(installer, /install-status\.json/);
  assert.match(routes, /speech\/install/);
  assert.match(frontend, /installSpeechEngine/);
  assert.match(frontend, /TRANSCRIPTION_MODEL_NOT_CONFIGURED/);
  assert.equal(fs.existsSync(path.join(root, 'INSTALL_LOCAL_WHISPER_FOR_YANCE.ps1')), false);
});
