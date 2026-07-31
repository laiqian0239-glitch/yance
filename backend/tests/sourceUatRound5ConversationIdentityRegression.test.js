'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round5-'));
process.env.YANCE_DATA_DIR = dataRoot;

const { getStore, closeStore } = require('../repositories/storeProvider');
const { stableId } = require('../lib/r32SqliteStore');
const authority = require('../services/whatsappIdentityAuthority');
const outboxRouteAuthority = require('../services/outboxRouteAuthority').singleton;
const merger = require('../services/whatsappConversationMergeService');
const { AvatarSyncService } = require('../services/avatarService');
const workspaceRepository = require('../repositories/workspaceRepository');
const messageRepository = require('../repositories/messageRepository');
const root = path.resolve(__dirname, '../..');
const readSource = relative => fs.readFileSync(path.join(root, relative), 'utf8');

process.on('exit', () => {
  try { closeStore(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

function now(offset = 0) { return new Date(Date.now() + offset).toISOString(); }
function insertContact(db, input) {
  db.prepare(`INSERT INTO contacts(
    id,platform,account_id,external_id,display_name,phone,avatar_url,avatar_updated_at,avatar_status,
    tags_json,aliases_json,source,last_seen_at,archived_at,archive_reason,archived_by,payload_json,
    created_at,updated_at,canonical_contact_id,merged_into_id,tombstoned_at
  ) VALUES(?,?,?,?,?,?,?,?,?,'[]',?,'test','','','','',?,?,?,'','','')`).run(
    input.id, 'whatsapp', input.accountId, input.externalId, input.displayName, input.phone || '', input.avatarUrl || '', input.avatarUpdatedAt || '', input.avatarStatus || '',
    JSON.stringify(input.aliases || []), JSON.stringify({ externalId: input.externalId, aliases: input.aliases || [], displayName: input.displayName, avatarUrl: input.avatarUrl || '' }), now(-2000), now(-1000)
  );
}
function insertConversation(db, input) {
  db.prepare(`INSERT INTO r32_conversations(
    session_key,account_id,contact_id,platform,title,avatar_url,avatar_updated_at,avatar_status,
    last_message,last_message_at,unread_count,route_state,archived_at,archive_reason,archived_by,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.sessionKey, input.accountId, input.contactId, 'whatsapp', input.title, input.avatarUrl || '', '', input.avatarUrl ? 'ready' : '', input.lastMessage || '', input.lastMessageAt || '', input.unread || 0, input.routeState || '', input.archivedAt || '', '', '',
    JSON.stringify({ accountId: input.accountId, contactId: input.contactId, platform: 'whatsapp', chatJid: input.jid, externalId: input.jid, aliases: input.aliases, title: input.title, avatarUrl: input.avatarUrl || '' }), now(-3000), now(-1000)
  );
}
function insertMessage(db, input) {
  const payload = {
    id: input.externalId,
    externalMessageId: input.externalId,
    conversationId: input.sessionKey,
    sessionKey: input.sessionKey,
    accountId: input.accountId,
    chatJid: input.jid,
    contactId: input.contactId,
    direction: input.direction,
    fromMe: input.direction === 'outbound',
    text: input.text,
    timestamp: input.sentAt,
    rawMeta: { canonicalJid: input.jid }
  };
  db.prepare(`INSERT INTO r32_messages(
    id,session_key,account_id,sender_id,role,direction,message_type,text,media_url,media_path,
    quoted_message_id,delivery_status,sent_at,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.id, input.sessionKey, input.accountId, input.contactId, input.direction === 'outbound' ? 'assistant' : 'user', input.direction, 'text', input.text, '', '', '', 'sent', input.sentAt, JSON.stringify(payload), input.sentAt, input.sentAt
  );
  db.prepare('INSERT INTO r32_messages_fts(message_id,session_key,text) VALUES(?,?,?)').run(input.id, input.sessionKey, input.text);
}

test('WhatsApp LID and phone sessions merge transactionally and idempotently', async () => {
  const store = getStore();
  const db = store.db;
  const accountId = 'wa-test-account';
  const lid = '23996737257566@lid';
  const phone = '4915778008463@s.whatsapp.net';
  const lidSession = `${accountId}:${lid}`;
  const phoneSession = `${accountId}:${phone}`;
  const lidContact = stableId('contact', ['whatsapp', accountId, lid]);
  const phoneContact = stableId('contact', ['whatsapp', accountId, phone]);

  store.upsertAccount({
    id: accountId, platform: 'whatsapp', adapterAccountId: accountId,
    displayName: 'WhatsApp Test Account', state: 'ready', canAttemptSend: true,
    sendVerified: true, canSend: true, canReceive: true
  });
  insertContact(db, { id: lidContact, accountId, externalId: lid, displayName: 'Yeonhee Kim (김연희)', aliases: [lid, phone], avatarUrl: '/api/r32/messages/media/wa/contact/avatar.webp' });
  insertContact(db, { id: phoneContact, accountId, externalId: phone, displayName: 'me', aliases: [phone, lid] });
  insertConversation(db, { sessionKey: lidSession, accountId, contactId: lidContact, jid: lid, aliases: [lid, phone], title: 'Yeonhee Kim (김연희)', avatarUrl: '/api/r32/messages/media/wa/contact/avatar.webp', lastMessage: 'hello', lastMessageAt: now(-200), unread: 1, archivedAt: now(-500) });
  insertConversation(db, { sessionKey: phoneSession, accountId, contactId: phoneContact, jid: phone, aliases: [phone, lid], title: 'me', lastMessage: 'photo', lastMessageAt: now(-100), unread: 0 });
  insertMessage(db, { id: 'local-a', externalId: 'remote-a', sessionKey: lidSession, accountId, contactId: lidContact, jid: lid, direction: 'inbound', text: 'hello', sentAt: now(-200) });
  insertMessage(db, { id: 'local-b', externalId: 'remote-b', sessionKey: phoneSession, accountId, contactId: phoneContact, jid: phone, direction: 'outbound', text: 'photo', sentAt: now(-100) });

  db.prepare(`INSERT INTO customer_social_state(contact_id,relationship_json,emotion_json,interaction_json,preferences_json,strategy_json,potential_json,version,source_message_id,source_message_at,calculated_at,engine_version,payload_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,'','','','','{}',?,?)`).run(lidContact, '{"stage":"warm"}', '{}', '{}', '{}', '{}', '{}', now(-100), now(-100));
  db.prepare(`INSERT INTO customer_social_state(contact_id,relationship_json,emotion_json,interaction_json,preferences_json,strategy_json,potential_json,version,source_message_id,source_message_at,calculated_at,engine_version,payload_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,'','','','','{}',?,?)`).run(phoneContact, '{}', '{"trend":"positive"}', '{}', '{}', '{}', '{}', now(-100), now(-100));

  db.prepare(`INSERT INTO relationship_insights(contact_id,conversation_id,summary,relationship_stage,tone,intimacy_score,initiative_score,openness_score,response_pressure_score,opportunity_score,risk_score,hidden_need,next_action,evidence_json,open_loops_json,dimensions_json,source_message_count,analyzed_through_message_id,analyzed_through_at,model_id,model_name,status,payload_json,created_at,updated_at)
    VALUES(?,?,?,'warm','',0,0,0,0,0,0,'','','[]','[]','{}',1,'','','','','ready','{}',?,?)`).run(lidContact, lidSession, 'LID context', now(-100), now(-100));

  const pendingRoute = outboxRouteAuthority.ensure({
    conversationId: lidSession, accountId, platform: 'whatsapp', routeTarget: lid,
    capabilitySnapshotId: 'round5-pre-merge', source: 'source-uat-round5-fixture'
  }, store);
  db.prepare(`INSERT INTO r32_send_queue(id,idempotency_key,account_id,session_key,message_type,payload_json,state,attempts,next_attempt_at,locked_at,last_error,platform_message_id,outbox_route_id,outbox_route_version_id,created_at,updated_at)
    VALUES(?,?,?,?,? ,?,'pending',0,?,'','','',?,?,?,?)`).run('queue-lid', 'queue-lid-key', accountId, lidSession, 'text', JSON.stringify({ platform: 'whatsapp', operation: 'text', accountId, chatJid: lid, conversationId: lidSession, contactId: lidContact, text: 'queued before merge', quoted: { key: { remoteJid: lid, id: 'remote-a' } } }), now(), pendingRoute.outboxRouteId, pendingRoute.routeVersionId, now(-50), now(-50));
  db.prepare(`INSERT INTO ai_context_snapshots(id,task_id,contact_id,conversation_id,state_version,entity_versions_json,context_json,created_at)
    VALUES(?,?,?,?,1,'{}',?,?)`).run('snapshot-lid', 'task-lid', lidContact, lidSession, JSON.stringify({ conversationId: lidSession, contactId: lidContact, channel: { chatJid: lid } }), now(-50));
  db.prepare(`INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,2,?)`).run(phoneContact, JSON.stringify({ effective: { formal: { value: true } } }), now(-80));
  db.prepare(`INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,3,?)`).run(lidContact, JSON.stringify({ effective: { concise: { value: true } } }), now(-70));
  db.prepare(`INSERT INTO ai_reply_feedback_profile_versions(scope_type,scope_id,version,profile_json,reason,created_at) VALUES('contact',?,1,?,'target-history',?)`).run(phoneContact, JSON.stringify({ formal: true }), now(-90));
  db.prepare(`INSERT INTO ai_reply_feedback_profile_versions(scope_type,scope_id,version,profile_json,reason,created_at) VALUES('contact',?,1,?,'source-history',?)`).run(lidContact, JSON.stringify({ concise: true }), now(-85));

  authority.record({ accountId, aliases: [lid, phone], canonicalJid: phone, displayName: 'Yeonhee Kim (김연희)', nameSource: 'live-message-pushName', avatarUrl: '/api/r32/messages/media/wa/contact/avatar.webp' });
  const report = merger.mergeConversationAliases({ accountId, aliases: [lid, phone], canonicalJid: phone });
  assert.equal(report.merged, true);
  assert.equal(report.conversationId, phoneSession);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r32_conversations WHERE account_id=? AND platform='whatsapp'").get(accountId).n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r32_conversations WHERE account_id=? AND platform='whatsapp' AND merged_into=''").get(accountId).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(phoneSession).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(lidSession).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages_fts WHERE session_key=?').get(phoneSession).n, 2);
  const tombstone = db.prepare('SELECT merged_into,merged_at,merge_reason FROM r32_conversations WHERE session_key=?').get(lidSession);
  assert.equal(tombstone.merged_into, phoneSession);
  assert.ok(tombstone.merged_at);
  assert.equal(tombstone.merge_reason, 'whatsapp-jid-alias');
  assert.equal(getStore().listConversations({ limit: 20 }).filter(row => row.accountId === accountId).length, 1);
  const conversation = db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(phoneSession);
  assert.equal(conversation.title, 'Yeonhee Kim (김연희)');
  assert.equal(conversation.avatar_url, '/api/r32/messages/media/wa/contact/avatar.webp');
  assert.equal(conversation.unread_count, 1);
  assert.ok(conversation.archived_at, 'archived state must survive alias merge');
  const insight = db.prepare('SELECT * FROM relationship_insights WHERE contact_id=?').get(report.contactId);
  assert.equal(insight.conversation_id, phoneSession);
  assert.equal(insight.summary, 'LID context');
  const staleResolution = workspaceRepository.resolveContactForConversation(lidSession);
  assert.equal(staleResolution.conversation.session_key, phoneSession);
  assert.equal(staleResolution.contact.id, report.contactId);
  const redirected = await messageRepository.upsert({
    accountId,
    platform: 'whatsapp',
    conversationId: lidSession,
    sessionKey: lidSession,
    chatJid: lid,
    contactId: lidContact,
    contactName: 'Yeonhee Kim (김연희)',
    externalMessageId: 'remote-c',
    direction: 'inbound',
    fromMe: false,
    text: 'redirected after merge',
    timestamp: now()
  });
  assert.equal(redirected.message.sessionKey, phoneSession);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(lidSession).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(phoneSession).n, 3);
  const survivor = db.prepare('SELECT * FROM contacts WHERE id=?').get(report.contactId);
  assert.equal(survivor.display_name, 'Yeonhee Kim (김연희)');
  assert.equal(survivor.avatar_url, '/api/r32/messages/media/wa/contact/avatar.webp');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE merged_into_id=?').get(report.contactId).n, 1);
  const social = db.prepare('SELECT * FROM customer_social_state WHERE contact_id=?').get(report.contactId);
  assert.match(social.relationship_json, /warm/);
  assert.match(social.emotion_json, /positive/);
  const queue = db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get('queue-lid');
  assert.equal(queue.session_key, phoneSession);
  assert.notEqual(queue.outbox_route_version_id, pendingRoute.routeVersionId);
  const migratedRouteVersion = db.prepare('SELECT * FROM outbox_route_versions WHERE route_version_id=?').get(queue.outbox_route_version_id);
  assert.equal(migratedRouteVersion.conversation_id, phoneSession);
  assert.equal(migratedRouteVersion.route_target, phone);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox_routes WHERE conversation_id=?').get(lidSession).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox_route_versions WHERE conversation_id=?').get(lidSession).n, 0);
  assert.ok(report.referenceStats.outboundQueuesMoved >= 1);
  const queuePayload = JSON.parse(queue.payload_json);
  assert.equal(queuePayload.chatJid, phone);
  assert.equal(queuePayload.conversationId, phoneSession);
  assert.equal(queuePayload.contactId, report.contactId);
  assert.equal(queuePayload.quoted.key.remoteJid, phone);
  const snapshot = db.prepare('SELECT * FROM ai_context_snapshots WHERE id=?').get('snapshot-lid');
  assert.equal(snapshot.contact_id, report.contactId);
  assert.equal(snapshot.conversation_id, phoneSession);
  assert.equal(JSON.parse(snapshot.context_json).conversationId, phoneSession);
  assert.equal(JSON.parse(snapshot.context_json).contactId, report.contactId);
  assert.equal(JSON.parse(snapshot.context_json).channel.chatJid, phone);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(lidContact).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(lidContact).n, 0);
  const feedback = db.prepare("SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(report.contactId);
  assert.match(feedback.profile_json, /formal/);
  assert.match(feedback.profile_json, /concise/);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(report.contactId).n >= 3);
  assert.equal(report.integrity.ok, true);
  assert.ok(report.referenceStats.conversationRowsMoved >= 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const second = merger.mergeConversationAliases({ accountId, aliases: [lid, phone], canonicalJid: phone });
  assert.equal(second.merged, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(phoneSession).n, 3);
});

test('reference conflicts rollback the complete WhatsApp merge instead of leaving partial state', () => {
  const db = getStore().db;
  const accountId = 'wa-conflict-account';
  const lid = '82345678901234@lid';
  const phone = '491701234567@s.whatsapp.net';
  const lidSession = `${accountId}:${lid}`;
  const phoneSession = `${accountId}:${phone}`;
  const lidContact = stableId('contact', ['whatsapp', accountId, lid]);
  const phoneContact = stableId('contact', ['whatsapp', accountId, phone]);
  insertContact(db, { id: lidContact, accountId, externalId: lid, displayName: 'Conflict Contact', aliases: [lid, phone] });
  insertContact(db, { id: phoneContact, accountId, externalId: phone, displayName: '+491701234567', aliases: [phone, lid] });
  insertConversation(db, { sessionKey: lidSession, accountId, contactId: lidContact, jid: lid, aliases: [lid, phone], title: 'Conflict Contact' });
  insertConversation(db, { sessionKey: phoneSession, accountId, contactId: phoneContact, jid: phone, aliases: [phone, lid], title: '+491701234567' });
  insertMessage(db, { id: 'conflict-message', externalId: 'conflict-remote', sessionKey: lidSession, accountId, contactId: lidContact, jid: lid, direction: 'inbound', text: 'must survive rollback', sentAt: now() });
  db.exec("CREATE TABLE IF NOT EXISTS whatsapp_merge_collision(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL) STRICT");
  db.prepare('INSERT INTO whatsapp_merge_collision(id,conversation_id,payload_json,updated_at) VALUES(?,?,?,?)').run('conflict-source', lidSession, '{}', now());
  db.prepare('INSERT INTO whatsapp_merge_collision(id,conversation_id,payload_json,updated_at) VALUES(?,?,?,?)').run('conflict-target', phoneSession, '{}', now());
  assert.throws(() => merger.mergeConversationAliases({ accountId, aliases: [lid, phone], canonicalJid: phone }), error => error?.code === 'WHATSAPP_MERGE_REFERENCE_CONFLICT');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r32_conversations WHERE account_id=? AND COALESCE(merged_into,'')='' ").get(accountId).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(lidSession).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE account_id=? AND merged_into_id=?').get(accountId, phoneContact).n, 0);
  db.prepare('DELETE FROM whatsapp_merge_collision WHERE id IN (?,?)').run('conflict-source', 'conflict-target');
});

test('canonical selection rejects placeholder phone JIDs', () => {
  const lid = '58141257502913@lid';
  const phone = '491234567890@s.whatsapp.net';
  assert.equal(authority.classifyJid('0@s.whatsapp.net').valid, false);
  assert.equal(authority.normalizeJid('0@s.whatsapp.net'), '');
  assert.equal(authority.chooseCanonical(['0@s.whatsapp.net', lid]), lid);
  assert.equal(authority.chooseCanonical(['0@s.whatsapp.net', lid, phone]), phone);
});

test('startup reconciliation discovers persisted aliases missing from identity authority', () => {
  const store = getStore();
  const db = store.db;
  const accountId = 'wa-persisted-reconcile';
  const lid = '58141257502913@lid';
  const phone = '491234567890@s.whatsapp.net';
  const lidSession = `${accountId}:${lid}`;
  const phoneSession = `${accountId}:${phone}`;
  const lidContact = stableId('contact', ['whatsapp', accountId, lid]);
  const phoneContact = stableId('contact', ['whatsapp', accountId, phone]);

  store.upsertAccount({
    id: accountId, platform: 'whatsapp', adapterAccountId: accountId,
    displayName: 'WhatsApp Test Account', state: 'ready', canAttemptSend: true,
    sendVerified: true, canSend: true, canReceive: true
  });
  insertContact(db, { id: lidContact, accountId, externalId: lid, displayName: 'Anna Müller', aliases: [lid, phone], avatarUrl: '/api/r32/messages/media/wa/anna/avatar.webp' });
  insertContact(db, { id: phoneContact, accountId, externalId: phone, displayName: '+491234567890', aliases: [phone, lid] });
  insertConversation(db, { sessionKey: lidSession, accountId, contactId: lidContact, jid: lid, aliases: [lid, phone], title: 'Anna Müller', avatarUrl: '/api/r32/messages/media/wa/anna/avatar.webp', lastMessageAt: now(-200) });
  insertConversation(db, { sessionKey: phoneSession, accountId, contactId: phoneContact, jid: phone, aliases: [phone, lid], title: '+491234567890', lastMessageAt: now(-100) });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM whatsapp_identity_authority WHERE account_id=?').get(accountId).n, 0);
  const reports = merger.reconcileAccount(accountId);
  assert.equal(reports.some(row => row.merged), true);
  assert.equal(reports.some(row => row.discoveredFromPersistedRows), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r32_conversations WHERE account_id=? AND platform='whatsapp'").get(accountId).n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r32_conversations WHERE account_id=? AND platform='whatsapp' AND merged_into=''").get(accountId).n, 1);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM whatsapp_identity_authority WHERE account_id=?').get(accountId).n >= 2);
  const survivor = db.prepare("SELECT * FROM r32_conversations WHERE account_id=? AND merged_into=''").get(accountId);
  assert.equal(survivor.session_key, phoneSession);
  assert.equal(survivor.title, 'Anna Müller');
  assert.equal(survivor.avatar_url, '/api/r32/messages/media/wa/anna/avatar.webp');
});

test('outbound messages are canonicalized before persistence', () => {
  const accountId = 'wa-test-account';
  const lid = '23996737257566@lid';
  const phone = '4915778008463@s.whatsapp.net';
  const message = merger.canonicalizeMessage({
    platform: 'whatsapp', accountId, chatJid: lid, conversationId: `${accountId}:${lid}`,
    externalMessageId: 'remote-outbound', id: 'remote-outbound', fromMe: true, direction: 'outbound',
    sender: 'me', rawMeta: { remoteJid: lid, remoteJidAlt: phone }
  });
  assert.equal(message.chatJid, phone);
  assert.equal(message.conversationId, `${accountId}:${phone}`);
  assert.equal(message.sessionKey, `${accountId}:${phone}`);
  assert.equal(message.dedupeKey, `${accountId}:${phone}:remote-outbound`);
});

test('WhatsApp outbound text and media send through the canonical target before persistence', () => {
  const adapter = readSource('backend/services/whatsappAdapter.js');
  const textBlock = adapter.slice(adapter.indexOf('async sendText'), adapter.indexOf('async markRead'));
  const mediaBlock = adapter.slice(adapter.indexOf('async sendMedia'));
  for (const block of [textBlock, mediaBlock]) {
    assert.match(block, /canonicalWhatsAppTarget\(databaseAccountId, chatJid, sessionKey\)/);
    assert.match(block, /sendMessage\(target\.chatJid/);
    assert.match(block, /conversationId:\s*conversationId|conversationId,/);
    assert.match(block, /chatJid:\s*target\.chatJid/);
    assert.match(block, /contactId:\s*target\.contactId/);
  }
});

test('privacy restriction preserves a valid cached avatar', async () => {
  const persisted = [];
  const fakeStore = {
    getConversation: () => ({ avatarUrl: '/api/r32/messages/media/a/c/avatar.webp', avatarStatus: 'ready' }),
    updateConversationMetadata: async (_id, value) => persisted.push(value)
  };
  const service = new AvatarSyncService({
    messageStore: fakeStore,
    mediaPipeline: { resolveFile: () => '/virtual/avatar.webp' },
    fs: {
      statSync: () => ({ isFile: () => true, size: 16 }),
      openSync: () => 1,
      readSync: (_fd, buffer) => { Buffer.from([0xff, 0xd8, 0xff]).copy(buffer); return 3; },
      closeSync: () => {},
      rmSync: () => { throw new Error('valid cache must not be removed'); }
    },
    logger: { warn: () => {} }
  });
  const result = await service.markUnavailable({ accountId: 'a', conversationId: 'c' }, 'privacy-restricted');
  assert.equal(result.avatarUrl, '/api/r32/messages/media/a/c/avatar.webp');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].clearAvatar, undefined);
  assert.equal(persisted[0].avatarStatus, 'privacy-restricted');
});


test('AI reply generation resolves contact from conversation instead of trusting a session key as contact id', () => {
  const route = readSource('backend/routes/store.js');
  const brain = readSource('backend/services/contextAwareReplyBrain.js');
  const ui = readSource('frontend/js/r32-ui-runtime.js');
  assert.match(route, /ensureCustomerContext\(storeManager, conversationId/);
  assert.match(route, /contactId:\s*resolvedContactId/);
  assert.match(brain, /resolveSocialContext/);
  assert.match(brain, /resolveContactId\(conversationId, contactId\)/);
  assert.doesNotMatch(ui, /contactId:c\.contactId\|\|c\.id/);
  assert.match(ui, /contactId:c\.contactId\|\|''/);
});

test('functional workspaces use semantic theme tokens rather than fixed color literals', () => {
  const colorLiteral = /#[0-9a-f]{3,8}\b|rgba?\s*\([^)]*\)|hsla?\s*\([^)]*\)/ig;
  const functionalFiles = [
    'frontend/r32-system-center.css',
    'frontend/r32-account-center.css',
    'frontend/r32-conversation-center-v2.css',
    'frontend/r32-settings-recovery.css',
    'frontend/r32-basic-settings.css',
    'frontend/r32-conversation-capabilities.css',
    'frontend/r32-media-playback.css',
    'frontend/r32-persona.css',
    'frontend/r32-update-center.css',
    'frontend/r32-global-reading.css'
  ];
  for (const file of functionalFiles) assert.deepEqual(readSource(file).match(colorLiteral) || [], [], file);
  const motion = readSource('frontend/r32-theme-motion.css');
  const componentSection = motion.slice(motion.indexOf('html[data-motion-level="off"]'));
  assert.deepEqual(componentSection.match(colorLiteral) || [], []);
  const authorityCss = readSource('frontend/r32-theme-authority.css');
  for (const token of ['--surface-app','--surface-panel','--surface-card','--surface-control','--border-default','--border-active','--text-primary','--text-secondary','--status-success','--status-warning','--status-danger']) {
    assert.match(authorityCss, new RegExp(`${token}\\s*:`));
  }
  const electronMain = readSource('electron/main.js');
  assert.match(electronMain, /setTitleBarOverlay/);
  assert.match(electronMain, /setBackgroundColor\(color\)/);
});
