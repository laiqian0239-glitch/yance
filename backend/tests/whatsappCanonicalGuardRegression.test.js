'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wa-canonical-guard-'));
const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_PRIMARY_SQLITE_PATH = dbPath;

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { createSqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `whatsapp-canonical-guard:${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
}).open();

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'qrcode') return { toDataURL: async value => `data:image/png;base64,${Buffer.from(String(value || '')).toString('base64')}` };
  return originalLoad.call(this, request, parent, isMain);
};
const adapter = require('../services/whatsappAdapter');
Module._load = originalLoad;
const { getStore, closeStore } = require('../repositories/storeProvider');
const merger = require('../services/whatsappConversationMergeService');

process.on('exit', () => {
  try { closeStore(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

test('invalid placeholder identities never become history or send targets', () => {
  assert.equal(adapter.historyJid('0@s.whatsapp.net'), '');
  assert.equal(adapter.historyJid('0000000@s.whatsapp.net'), '');
  assert.throws(
    () => adapter.canonicalWhatsAppTarget('wa-account', '0@s.whatsapp.net', 'wa-account:0@s.whatsapp.net'),
    error => error?.code === 'WHATSAPP_SEND_TARGET_INVALID' && error?.status === 409
  );
});

test('invalid peer identities do not create contacts', async () => {
  const before = getStore().db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp'").get().n;
  const identity = await adapter.resolveWhatsAppPeerIdentity({ databaseAccountId: 'wa-account', jid: '0@s.whatsapp.net', info: { key: { remoteJid: '0@s.whatsapp.net' } } });
  const after = getStore().db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp'").get().n;
  assert.equal(identity.reasonCode, 'WHATSAPP_PEER_IDENTITY_INVALID');
  assert.equal(identity.canonicalJid, '');
  assert.equal(after, before);
});

test('canonical target prefers a valid phone JID over its LID alias', () => {
  const phone = '491234567890@s.whatsapp.net';
  const lid = '58141257502913@lid';
  const result = adapter.canonicalWhatsAppTarget('wa-account', phone, `wa-account:${lid}`);
  assert.equal(result.chatJid, phone);
  assert.equal(result.conversationId, `wa-account:${phone}`);
});


test('startup reconciliation derives a phone JID from an explicit stored phone field', () => {
  const store = getStore();
  const accountId = 'wa-phone-field';
  const lid = '58141257502999@lid';
  const phone = '4915778008999@s.whatsapp.net';
  store.upsertContact({
    id: 'contact-phone-field',
    accountId,
    platform: 'whatsapp',
    externalId: lid,
    displayName: 'Stored Phone Contact',
    phone: '+49 1577 8008999',
    aliases: [lid]
  });
  store.upsertConversation({
    sessionKey: `${accountId}:${lid}`,
    accountId,
    contactId: 'contact-phone-field',
    platform: 'whatsapp',
    chatJid: lid,
    externalId: lid,
    title: 'Stored Phone Contact'
  });
  const discovered = merger.persistedIdentityGroups(store.db, accountId);
  const group = discovered.groups.find(row => row.aliases.includes(lid));
  assert.ok(group);
  assert.equal(group.canonicalJid, phone);
  assert.deepEqual(new Set(group.aliases), new Set([lid, phone]));
});

test('runtime reconciliation preserves an unresolved legacy conversation instead of blanking it', async () => {
  const store = getStore();
  const accountId = 'wa-unresolved-legacy';
  const legacyJid = '123@s.whatsapp.net';
  const sessionKey = `${accountId}:${legacyJid}`;
  store.upsertConversation({
    sessionKey,
    accountId,
    contactId: 'legacy-contact',
    platform: 'whatsapp',
    chatJid: legacyJid,
    externalId: legacyJid,
    title: 'Legacy Preserved Name',
    avatarUrl: '/api/r32/messages/media/legacy/avatar.webp'
  });
  const runtime = new adapter.WhatsAppAdapter();
  const result = await runtime.reconcileKnownIdentities(accountId, accountId, {}, { reason: 'regression-test' });
  const row = store.db.prepare('SELECT title,avatar_url,payload_json FROM r32_conversations WHERE session_key=?').get(sessionKey);
  const payload = JSON.parse(row.payload_json);
  assert.equal(result.failed, 1);
  assert.equal(row.title, 'Legacy Preserved Name');
  assert.equal(row.avatar_url, '/api/r32/messages/media/legacy/avatar.webp');
  assert.equal(payload.chatJid, legacyJid);
  assert.equal(payload.externalId, legacyJid);
});


test('authority resolution repairs mixed legacy rows instead of selecting an invalid canonical', () => {
  const store = getStore();
  const authority = require('../services/whatsappIdentityAuthority');
  const accountId = 'wa-mixed-authority';
  const lidA = '58141257502001@lid';
  const lidB = '58141257502002@lid';
  const phone = '4915778002002@s.whatsapp.net';
  const statement = store.db.prepare(`INSERT INTO whatsapp_identity_authority(
    account_id,alias_jid,canonical_jid,display_name,name_score,name_source,avatar_url,avatar_source,aliases_json,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  statement.run(accountId, lidA, '0@s.whatsapp.net', 'Mixed Legacy', 80, 'legacy', '', '', JSON.stringify([lidA, lidB]), '2026-07-21T00:00:00Z');
  statement.run(accountId, lidB, phone, 'Mixed Legacy', 80, 'legacy', '', '', JSON.stringify([lidA, lidB]), '2026-07-21T00:00:01Z');
  const resolved = authority.resolve(accountId, [lidA, lidB]);
  assert.equal(resolved.canonicalJid, phone);
  assert.ok(resolved.aliases.includes(phone));
  assert.ok(!resolved.aliases.includes('0@s.whatsapp.net'));
});
