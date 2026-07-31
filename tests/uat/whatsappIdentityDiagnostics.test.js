'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const diagnostics = require('../../tools/uat/whatsappIdentityDiagnostics');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wa-diag-')); }

function createFixture() {
  const root = tempRoot();
  const store = path.join(root, 'store');
  fs.mkdirSync(store, { recursive: true });
  const dbPath = path.join(store, 'yance-r32.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE r32_meta(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT);
    INSERT INTO r32_meta VALUES('schema_version','1','2026-07-21T00:00:00Z');
    CREATE TABLE r32_accounts(id TEXT,platform TEXT,adapter_account_id TEXT,display_name TEXT,identity_label TEXT,payload_json TEXT);
    CREATE TABLE r32_conversations(session_key TEXT,account_id TEXT,contact_id TEXT,platform TEXT,title TEXT,avatar_url TEXT,avatar_status TEXT,last_message_at TEXT,route_state TEXT,payload_json TEXT,merged_into TEXT,merged_at TEXT,merge_reason TEXT);
    CREATE TABLE contacts(id TEXT,platform TEXT,account_id TEXT,external_id TEXT,display_name TEXT,phone TEXT,avatar_url TEXT,avatar_status TEXT,aliases_json TEXT,payload_json TEXT,merged_into_id TEXT,canonical_contact_id TEXT);
    CREATE TABLE r32_messages(id TEXT,session_key TEXT,account_id TEXT,direction TEXT DEFAULT '',message_type TEXT DEFAULT 'text',media_url TEXT DEFAULT '',media_path TEXT DEFAULT '',delivery_status TEXT DEFAULT '',payload_json TEXT,sent_at TEXT,created_at TEXT);
    CREATE TABLE customer_profiles(contact_id TEXT);
    CREATE TABLE relationship_insights(contact_id TEXT,conversation_id TEXT);
    CREATE TABLE ai_context_snapshots(contact_id TEXT,conversation_id TEXT);
    CREATE TABLE r32_send_queue(id TEXT,account_id TEXT,session_key TEXT,payload_json TEXT);
    CREATE TABLE whatsapp_identity_authority(account_id TEXT,alias_jid TEXT,canonical_jid TEXT,display_name TEXT,name_score INTEGER,name_source TEXT,avatar_url TEXT,avatar_source TEXT,aliases_json TEXT,updated_at TEXT);
    CREATE TABLE identity_aliases(platform TEXT,alias_value TEXT,canonical_account_id TEXT,canonical_contact_id TEXT);
    CREATE TABLE identity_merge_audit(platform TEXT,entity_type TEXT,source_id TEXT,target_id TEXT);
  `);
  db.prepare('INSERT INTO r32_accounts VALUES(?,?,?,?,?,?)').run('wa1','whatsapp','wa-auth','My WA','',JSON.stringify({ liveUser: { id: '49111111111@s.whatsapp.net' } }));
  db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('c1','whatsapp','wa1','58141257502913@lid','Anna Müller','','','','["58141257502913@lid"]','{}','','c1');
  db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('c2','whatsapp','wa1','49123456789@s.whatsapp.net','Anna Müller','','','','["49123456789@s.whatsapp.net"]','{}','','c2');
  db.prepare('INSERT INTO r32_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('wa1:58141257502913@lid','wa1','c1','whatsapp','Anna Müller','','','2026-07-20T10:00:00Z','source-a',JSON.stringify({ chatJid:'58141257502913@lid' }),'','','');
  db.prepare('INSERT INTO r32_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('wa1:49123456789@s.whatsapp.net','wa1','c2','whatsapp','Anna Müller','','','2026-07-20T11:00:00Z','source-b',JSON.stringify({ chatJid:'49123456789@s.whatsapp.net' }),'','','');
  db.prepare('INSERT INTO r32_messages(id,session_key,account_id,payload_json,sent_at,created_at) VALUES(?,?,?,?,?,?)').run('m1','wa1:58141257502913@lid','wa1',JSON.stringify({ chatJid: '58141257502913@lid', externalMessageId: 'm1' }),'2026-07-20T10:00:00Z','2026-07-20T10:00:00Z');
  db.prepare('INSERT INTO r32_messages(id,session_key,account_id,payload_json,sent_at,created_at) VALUES(?,?,?,?,?,?)').run('m2','wa1:49123456789@s.whatsapp.net','wa1',JSON.stringify({ chatJid: '49123456789@s.whatsapp.net', externalMessageId: 'm2' }),'2026-07-20T11:00:00Z','2026-07-20T11:00:00Z');
  db.prepare("UPDATE r32_messages SET direction='outbound',message_type='text',delivery_status='delivered' WHERE id='m2'").run();
  db.prepare('INSERT INTO whatsapp_identity_authority VALUES(?,?,?,?,?,?,?,?,?,?)').run('wa1','58141257502913@lid','49123456789@s.whatsapp.net','Anna Müller',100,'lid-map','','',JSON.stringify(['58141257502913@lid','49123456789@s.whatsapp.net']),'2026-07-21T00:00:00Z');
  db.close();
  return root;
}

test('strict JID validation rejects placeholder canonical identities', () => {
  assert.equal(diagnostics.classifyJid('0@s.whatsapp.net').valid, false);
  assert.equal(diagnostics.classifyJid('@s.whatsapp.net').valid, false);
  assert.equal(diagnostics.classifyJid('49123456789@s.whatsapp.net').valid, true);
  assert.equal(diagnostics.classifyJid('58141257502913@lid').valid, true);
  assert.equal(diagnostics.normalizeJid('49123456789@c.us'), '49123456789@s.whatsapp.net');
});

test('read-only diagnostics groups LID and phone JID duplicate conversations', () => {
  const root = createFixture();
  const dbPath = path.join(root, 'store', 'yance-r32.db');
  const before = fs.readFileSync(dbPath);
  const report = diagnostics.buildDiagnostics({ dataRoot: root });
  const after = fs.readFileSync(dbPath);
  assert.equal(report.summary.duplicateGroups, 1);
  assert.equal(report.duplicateGroups[0].rows.length, 2);
  assert.ok(report.duplicateGroups[0].reasonCodes.includes('WHATSAPP_DUPLICATE_ACTIVE_CONVERSATIONS'));
  assert.ok(report.duplicateGroups[0].reasonCodes.includes('WHATSAPP_SEND_SOURCE_CONFLICT'));
  assert.equal(report.summary.telegramNotEvaluated, true);
  assert.equal(report.summary.themeNotEvaluated, true);
  assert.equal(report.p0Baseline.whatsappIdentityContractVersion, 5);
  assert.equal(report.p0Baseline.whatsappMergeIntegrityContractVersion, 3);
  assert.equal(report.mergeIntegrity.ok, true);
  assert.equal(report.summary.staleMergedReferences, 0);
  assert.equal(report.summary.pendingSendPayloadMismatches, 0);
  assert.equal(report.summary.sendRouteReadyConversations, 2);
  assert.equal(report.summary.sendRouteBlockedConversations, 0);
  assert.equal(report.summary.whatsappOutboundMessages, 1);
  assert.equal(report.summary.whatsappOutboundMediaMessages, 0);
  assert.equal(report.summary.whatsappOutboundAcknowledgedMessages, 1);
  assert.equal(report.realSendEvidence.lastOutboundAt, '2026-07-20T11:00:00Z');
  assert.deepEqual(after, before);
});




test('diagnostics accepts a Facebook brand logo as a valid WhatsApp Business avatar when provenance is WhatsApp', () => {
  const root = createFixture();
  const mediaDir = path.join(root, 'media', 'wa1', 'wa1_49123456789_s.whatsapp.net');
  fs.mkdirSync(mediaDir, { recursive: true });
  const avatarFile = path.join(mediaDir, 'contact-avatar.jpg');
  // Keep this regression self-contained: diagnostics must trust WhatsApp
  // provenance rather than infer platform identity from arbitrary image pixels.
  const observedCrossBrandAvatar = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  fs.writeFileSync(avatarFile, observedCrossBrandAvatar);
  const db = new DatabaseSync(path.join(root, 'store', 'yance-r32.db'));
  const mediaUrl = '/api/r32/messages/media/wa1/wa1_49123456789_s.whatsapp.net/contact-avatar.jpg';
  db.prepare("UPDATE r32_conversations SET avatar_url=?,avatar_status='ready' WHERE session_key='wa1:49123456789@s.whatsapp.net'").run(mediaUrl);
  db.close();
  const report = diagnostics.buildDiagnostics({ dataRoot: root });
  assert.equal(report.summary.platformMismatchedAvatarFiles, 0);
  assert.equal(report.summary.avatarProvenanceErrors, 0);
  assert.equal(report.mergeIntegrity.ok, true);
  assert.equal(report.mergeIntegrity.blockers.includes('WHATSAPP_AVATAR_PLATFORM_CONTENT_MISMATCH'), false);
});

test('read-only diagnostics detects high-confidence duplicate history under an orphan WhatsApp account id', () => {
  const root = createFixture();
  const dbPath = path.join(root, 'store', 'yance-r32.db');
  const db = new DatabaseSync(dbPath);
  const targetAccountId = 'wa1';
  const sourceAccountId = 'wa-orphan';
  for (const [index, phone] of ['491700000001@s.whatsapp.net', '491700000002@s.whatsapp.net'].entries()) {
    const targetContact = `target-cross-${index}`;
    const sourceContact = `source-cross-${index}`;
    const targetSession = `${targetAccountId}:${phone}`;
    const sourceSession = `${sourceAccountId}:${phone}`;
    const aliases = JSON.stringify([phone]);
    db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(targetContact,'whatsapp',targetAccountId,phone,`Target ${index}`,'','','',aliases,JSON.stringify({ chatJid: phone }),'',targetContact);
    db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(sourceContact,'whatsapp',sourceAccountId,phone,`Source ${index}`,'','','',aliases,JSON.stringify({ chatJid: phone }),'',sourceContact);
    db.prepare('INSERT INTO r32_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(targetSession,targetAccountId,targetContact,'whatsapp',`Target ${index}`,'','','2026-07-20T11:00:00Z','',JSON.stringify({ chatJid: phone }),'','','');
    db.prepare('INSERT INTO r32_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sourceSession,sourceAccountId,sourceContact,'whatsapp',`Source ${index}`,'','','2026-07-20T10:00:00Z','',JSON.stringify({ chatJid: phone }),'','','');
    const external = `cross-shared-${index}`;
    db.prepare('INSERT INTO r32_messages(id,session_key,account_id,payload_json,sent_at,created_at) VALUES(?,?,?,?,?,?)').run(`target-cross-message-${index}`,targetSession,targetAccountId,JSON.stringify({ chatJid: phone, externalMessageId: external }),'2026-07-20T11:00:00Z','2026-07-20T11:00:00Z');
    db.prepare('INSERT INTO r32_messages(id,session_key,account_id,payload_json,sent_at,created_at) VALUES(?,?,?,?,?,?)').run(`source-cross-message-${index}`,sourceSession,sourceAccountId,JSON.stringify({ chatJid: phone, externalMessageId: external }),'2026-07-20T10:00:00Z','2026-07-20T10:00:00Z');
  }
  db.close();

  const report = diagnostics.buildDiagnostics({ dataRoot: root });
  assert.equal(report.summary.eligibleOrphanAccountPlans, 1);
  assert.equal(report.summary.ambiguousOrphanAccountPlans, 0);
  assert.equal(report.orphanAccountCheck.eligiblePlans[0].sourceAccountId, sourceAccountId);
  assert.equal(report.orphanAccountCheck.eligiblePlans[0].targetAccountId, targetAccountId);
  assert.ok(report.mergeIntegrity.blockers.includes('WHATSAPP_ORPHAN_ACCOUNT_DUPLICATE_DATA'));
  assert.equal(report.mergeIntegrity.ok, false);
});

test('diagnostics blocks partial merges with tombstone references and stale send targets', () => {
  const root = createFixture();
  const dbPath = path.join(root, 'store', 'yance-r32.db');
  const db = new DatabaseSync(dbPath);
  const lidSession = 'wa1:58141257502913@lid';
  const phoneSession = 'wa1:49123456789@s.whatsapp.net';
  db.prepare("UPDATE r32_conversations SET merged_into=?,merged_at='2026-07-21T01:00:00Z',merge_reason='whatsapp-jid-alias' WHERE session_key=?").run(phoneSession, lidSession);
  db.prepare("UPDATE contacts SET merged_into_id='c2' WHERE id='c1'").run();
  db.prepare('INSERT INTO ai_context_snapshots(contact_id,conversation_id) VALUES(?,?)').run('c1', lidSession);
  db.prepare('INSERT INTO r32_send_queue(id,account_id,session_key,payload_json) VALUES(?,?,?,?)').run(
    'q1', 'wa1', phoneSession,
    JSON.stringify({ platform: 'whatsapp', accountId: 'wa1', chatJid: '58141257502913@lid', conversationId: lidSession, contactId: 'c1', quoted: { key: { remoteJid: '58141257502913@lid' } } })
  );
  db.close();
  const report = diagnostics.buildDiagnostics({ dataRoot: root });
  assert.equal(report.mergeIntegrity.ok, false);
  assert.ok(report.summary.staleMergedReferences >= 2);
  assert.ok(report.summary.pendingSendPayloadMismatches >= 4);
  assert.ok(report.mergeIntegrity.blockers.includes('WHATSAPP_MERGED_REFERENCE_LEAK'));
  assert.ok(report.mergeIntegrity.blockers.includes('WHATSAPP_PENDING_SEND_BINDING_MISMATCH'));
  assert.ok(report.mergeIntegrity.pendingSendCheck.issues.some(row => row.reasonCode === 'WHATSAPP_QUEUE_CHAT_JID_MISMATCH'));
});
