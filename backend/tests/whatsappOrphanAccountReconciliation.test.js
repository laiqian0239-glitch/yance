'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wa-account-reconcile-'));
process.env.YANCE_DATA_DIR = dataRoot;

const { PATHS } = require('../config');
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  SqliteConnectionBroker,
  configureSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');
resetSqliteConnectionBrokerForTests();
const testWriteHost = acquireAuthorityWriteHost({
  dbPath: PATHS.sqlite,
  instanceId: 'oss1a-orphan-reconciliation-test-host'
});
const testBroker = new SqliteConnectionBroker({
  dbPath: PATHS.sqlite,
  authorityWriteHostCapability: testWriteHost.capability
});
configureSqliteConnectionBroker(testBroker);
testBroker.open();
const { getStore, closeStore } = require('../repositories/storeProvider');
const { stableId } = require('../lib/r32SqliteStore');
const service = require('../services/whatsappAccountReconciliationService');
const outboxRouteAuthority = require('../services/outboxRouteAuthority').singleton;

process.on('exit', () => {
  try { closeStore(); } catch (error) { process.stderr.write(`closeStore failed: ${error.message}\n`); }
  try { resetSqliteConnectionBrokerForTests(); } catch (error) { process.stderr.write(`broker reset failed: ${error.message}\n`); }
  try { testWriteHost.release(); } catch (error) { process.stderr.write(`write host release failed: ${error.message}\n`); }
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (error) { process.stderr.write(`cleanup failed: ${error.message}\n`); }
});

function iso(offset = 0) { return new Date(Date.now() + offset).toISOString(); }

function addAccount(store, id, name) {
  store.upsertAccount({ id, platform: 'whatsapp', adapterAccountId: id, displayName: name, state: 'connected', lifecycleState: 'active', canSend: true, canReceive: true });
}

function addIdentity(store, { accountId, jid, lid, name, avatarUrl = '' }) {
  const contactId = stableId('contact', ['whatsapp', accountId, jid]);
  const sessionKey = `${accountId}:${jid}`;
  const aliases = [jid, lid].filter(Boolean);
  store.upsertContact({
    id: contactId,
    platform: 'whatsapp',
    accountId,
    externalId: jid,
    displayName: name,
    phone: jid.split('@')[0],
    avatarUrl,
    avatarStatus: avatarUrl ? 'ready' : '',
    aliases,
    source: 'test'
  });
  store.upsertConversation({
    sessionKey,
    accountId,
    contactId,
    platform: 'whatsapp',
    chatJid: jid,
    externalId: jid,
    aliases,
    title: name,
    avatarUrl,
    lastMessage: '',
    lastMessageAt: iso(-1000)
  });
  return { contactId, sessionKey, jid, aliases };
}

function addMessage(store, { rowId, externalMessageId, identity, accountId, text, sentAt }) {
  store.upsertMessage({
    id: rowId,
    externalMessageId,
    messageId: externalMessageId,
    sessionKey: identity.sessionKey,
    conversationId: identity.sessionKey,
    accountId,
    chatJid: identity.jid,
    contactId: identity.contactId,
    direction: 'inbound',
    fromMe: false,
    sender: identity.contactId,
    text,
    sentAt
  });
}

function count(db, sql, ...args) { return Number(db.prepare(sql).get(...args)?.n || 0); }

function seedSharedPair(store, sourceAccountId, targetAccountId, index) {
  const suffix = String(index).padStart(2, '0');
  const phone = `4917000000${suffix}@s.whatsapp.net`;
  const lid = `700000000000${suffix}@lid`;
  const source = addIdentity(store, { accountId: sourceAccountId, jid: phone, lid, name: `Old Contact ${index}` });
  const target = addIdentity(store, { accountId: targetAccountId, jid: phone, lid, name: `Current Contact ${index}`, avatarUrl: `/api/r32/messages/media/${targetAccountId}/${index}/avatar.webp` });
  const shared = `shared-${sourceAccountId}-${index}`;
  addMessage(store, { rowId: `old-shared-${sourceAccountId}-${index}`, externalMessageId: shared, identity: source, accountId: sourceAccountId, text: `shared old ${index}`, sentAt: iso(-5000 - index) });
  addMessage(store, { rowId: `new-shared-${targetAccountId}-${index}`, externalMessageId: shared, identity: target, accountId: targetAccountId, text: `shared current richer ${index}`, sentAt: iso(-5000 - index) });
  addMessage(store, { rowId: `old-unique-${sourceAccountId}-${index}`, externalMessageId: `old-unique-${index}`, identity: source, accountId: sourceAccountId, text: `old unique ${index}`, sentAt: iso(-4000 - index) });
  addMessage(store, { rowId: `new-unique-${targetAccountId}-${index}`, externalMessageId: `new-unique-${index}`, identity: target, accountId: targetAccountId, text: `new unique ${index}`, sentAt: iso(-3000 - index) });
  return { source, target, phone, lid };
}

test('high-confidence orphan account history is rebound, unioned, deduplicated, quarantined and idempotent', () => {
  const store = getStore();
  const db = store.db;
  const sourceAccountId = 'wh-orphan-source-a';
  const targetAccountId = 'wh-current-target-a';
  addAccount(store, targetAccountId, 'Current WhatsApp');
  // Schema 16 forbids new queue rows for a nonexistent account. Represent the
  // legacy orphan as a persisted tombstone: it is excluded from active account
  // authority but still permits migration of pre-existing operational rows.
  store.upsertAccount({
    id: sourceAccountId, accountId: sourceAccountId, adapterAccountId: sourceAccountId, platform: 'whatsapp',
    displayName: 'Legacy Orphan', state: 'logged-out', lifecycleState: 'tombstoned',
    tombstonedAt: iso(-10000), canSend: false, canReceive: false
  });

  const first = seedSharedPair(store, sourceAccountId, targetAccountId, 1);
  seedSharedPair(store, sourceAccountId, targetAccountId, 2);

  const orphanRoute = outboxRouteAuthority.ensure({
    conversationId: first.source.sessionKey, accountId: sourceAccountId, platform: 'whatsapp',
    routeTarget: first.phone, capabilitySnapshotId: 'orphan-account-pre-merge', source: 'orphan-account-reconciliation-fixture'
  }, store);
  db.prepare(`INSERT INTO r32_send_queue(id,idempotency_key,account_id,session_key,message_type,payload_json,state,attempts,next_attempt_at,locked_at,last_error,platform_message_id,outbox_route_id,outbox_route_version_id,created_at,updated_at)
    VALUES(?,?,?,?,? ,?,'pending',0,?,'','','',?,?,?,?)`).run(
    'orphan-queue-a', 'orphan-queue-key-a', sourceAccountId, first.source.sessionKey, 'text',
    JSON.stringify({ platform: 'whatsapp', accountId: sourceAccountId, conversationId: first.source.sessionKey, sessionKey: first.source.sessionKey, chatJid: first.phone, contactId: first.source.contactId, text: 'queued old account' }),
    iso(), orphanRoute.outboxRouteId, orphanRoute.routeVersionId, iso(-100), iso(-100)
  );

  const invalidSource = addIdentity(store, { accountId: sourceAccountId, jid: '0@s.whatsapp.net', name: '+' });
  addMessage(store, { rowId: 'invalid-source-message', externalMessageId: 'invalid-shared', identity: invalidSource, accountId: sourceAccountId, text: 'unknown retained', sentAt: iso(-2000) });

  const discovery = service.discoverOrphanAccountAliases(db);
  const plan = discovery.plans.find(row => row.sourceAccountId === sourceAccountId);
  assert.equal(plan.eligible, true);
  assert.equal(plan.targetAccountId, targetAccountId);
  assert.equal(plan.sharedCanonicalJidCount, undefined);
  assert.equal(plan.candidates[0].sharedCanonicalJidCount, 2);
  assert.equal(plan.candidates[0].sharedExternalMessageIds, 2);

  const report = service.reconcileOrphanAccounts();
  assert.equal(report.applied, 1);
  const applied = report.reports.find(row => row.sourceAccountId === sourceAccountId);
  assert.equal(applied.integrity.ok, true);
  assert.deepEqual(applied.integrity.sourceOperationalReferences, []);

  assert.equal(count(db, "SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into_id,'')='' AND COALESCE(tombstoned_at,'')=''", sourceAccountId), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM r32_conversations WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into,'')=''", sourceAccountId), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?', sourceAccountId), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into_id,'')='' AND COALESCE(tombstoned_at,'')=''", targetAccountId), 2);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM r32_conversations WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into,'')=''", targetAccountId), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?', targetAccountId), 7);

  const targetSession = `${targetAccountId}:${first.phone}`;
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?', targetSession), 3);
  const queue = db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get('orphan-queue-a');
  assert.equal(queue.account_id, targetAccountId);
  assert.equal(queue.session_key, targetSession);
  assert.notEqual(queue.outbox_route_version_id, orphanRoute.routeVersionId);
  const migratedRouteVersion = db.prepare('SELECT * FROM outbox_route_versions WHERE route_version_id=?').get(queue.outbox_route_version_id);
  assert.equal(migratedRouteVersion.account_id, targetAccountId);
  assert.equal(migratedRouteVersion.conversation_id, targetSession);
  assert.equal(migratedRouteVersion.route_target, first.phone);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM outbox_route_versions WHERE account_id=?', sourceAccountId), 0);
  const queuePayload = JSON.parse(queue.payload_json);
  assert.equal(queuePayload.accountId, targetAccountId);
  assert.equal(queuePayload.conversationId, targetSession);
  assert.equal(queuePayload.sessionKey, targetSession);

  const accountAlias = db.prepare("SELECT * FROM identity_aliases WHERE platform='whatsapp' AND alias_type='account-id' AND alias_value=?").get(sourceAccountId);
  assert.equal(accountAlias.canonical_account_id, targetAccountId);
  const invalidConversation = db.prepare("SELECT merged_into,merge_reason FROM r32_conversations WHERE session_key=?").get(invalidSource.sessionKey);
  assert.equal(invalidConversation.merge_reason, 'whatsapp-invalid-identity');
  assert.match(invalidConversation.merged_into, /^quarantine:whatsapp-invalid:/);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?', invalidSource.sessionKey), 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const second = service.reconcileOrphanAccounts();
  assert.equal(second.applied, 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?', targetAccountId), 7);
});


test('cross-account reconciliation rolls back every contact when one reference migration conflicts', () => {
  const store = getStore();
  const db = store.db;
  const sourceAccountId = 'wh-orphan-conflict';
  const targetAccountId = 'wh-current-conflict';
  addAccount(store, targetAccountId, 'Conflict Target');
  const first = seedSharedPair(store, sourceAccountId, targetAccountId, 21);
  seedSharedPair(store, sourceAccountId, targetAccountId, 22);

  db.exec("CREATE TABLE IF NOT EXISTS whatsapp_account_rebind_collision(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL) STRICT");
  db.prepare('INSERT INTO whatsapp_account_rebind_collision(id,conversation_id,payload_json,updated_at) VALUES(?,?,?,?)')
    .run('account-conflict-source', first.source.sessionKey, '{}', iso());
  db.prepare('INSERT INTO whatsapp_account_rebind_collision(id,conversation_id,payload_json,updated_at) VALUES(?,?,?,?)')
    .run('account-conflict-target', first.target.sessionKey, '{}', iso());

  const plan = service.discoverOrphanAccountAliases(db).plans.find(row => row.sourceAccountId === sourceAccountId);
  assert.equal(plan.eligible, true);
  assert.throws(() => service.reconcilePlan(plan), error => error?.code === 'WHATSAPP_MERGE_REFERENCE_CONFLICT');

  assert.equal(count(db, "SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into_id,'')='' AND COALESCE(tombstoned_at,'')=''", sourceAccountId), 2);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM r32_conversations WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into,'')=''", sourceAccountId), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?', sourceAccountId), 4);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM identity_aliases WHERE platform='whatsapp' AND alias_type='account-id' AND alias_value=?", sourceAccountId), 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  db.prepare('DELETE FROM whatsapp_account_rebind_collision WHERE id IN (?,?)').run('account-conflict-source', 'account-conflict-target');
});

test('ambiguous orphan account evidence is reported but never merged across active accounts', () => {
  const store = getStore();
  const db = store.db;
  const sourceAccountId = 'wh-orphan-ambiguous';
  const targetA = 'wh-current-ambiguous-a';
  const targetB = 'wh-current-ambiguous-b';
  addAccount(store, targetA, 'Target A');
  addAccount(store, targetB, 'Target B');

  for (let index = 11; index <= 12; index += 1) {
    const suffix = String(index);
    const phone = `4917111111${suffix}@s.whatsapp.net`;
    const source = addIdentity(store, { accountId: sourceAccountId, jid: phone, name: `Ambiguous Source ${index}` });
    const a = addIdentity(store, { accountId: targetA, jid: phone, name: `Ambiguous A ${index}` });
    const b = addIdentity(store, { accountId: targetB, jid: phone, name: `Ambiguous B ${index}` });
    const external = `ambiguous-shared-${index}`;
    addMessage(store, { rowId: `amb-source-${index}`, externalMessageId: external, identity: source, accountId: sourceAccountId, text: 'same source', sentAt: iso(-500) });
    addMessage(store, { rowId: `amb-a-${index}`, externalMessageId: external, identity: a, accountId: targetA, text: 'same a', sentAt: iso(-500) });
    addMessage(store, { rowId: `amb-b-${index}`, externalMessageId: external, identity: b, accountId: targetB, text: 'same b', sentAt: iso(-500) });
  }

  const discovery = service.discoverOrphanAccountAliases(db);
  const plan = discovery.plans.find(row => row.sourceAccountId === sourceAccountId);
  assert.equal(plan.eligible, false);
  assert.equal(plan.reasonCode, 'WHATSAPP_ORPHAN_ACCOUNT_AMBIGUOUS');
  assert.equal(plan.candidates[0].score, plan.candidates[1].score);

  const report = service.reconcileOrphanAccounts();
  const unresolved = report.reports.find(row => row.sourceAccountId === sourceAccountId);
  assert.equal(unresolved.applied, false);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM r32_conversations WHERE account_id=? AND COALESCE(merged_into,'')=''", sourceAccountId), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?', sourceAccountId), 2);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM identity_aliases WHERE platform='whatsapp' AND alias_type='account-id' AND alias_value=?", sourceAccountId), 0);
});

test('legacy auth discovery stays diagnostic and database tombstone blocks filesystem resurrection', async () => {
  const baileys = require('@whiskeysockets/baileys');
  const { PATHS } = require('../config');
  const resolver = require('../services/whatsappAuthResolver');
  const recovery = require('../services/credentialRecoveryService');
  const store = getStore();
  const db = store.db;
  const accountId = 'wh-legacy-tombstone-recovery';
  const stableKey = 'legacy-tombstone-recovery';
  const accountKey = `whatsapp-auth-account:${stableKey}`;
  const sourceDirectory = path.join(PATHS.baileysAuthLegacy, stableKey);
  const runtimeDirectory = path.join(PATHS.whatsappAuth, stableKey);
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const creds = baileys.initAuthCreds();
  creds.registered = true;
  creds.me = { id: '15559990000:1@s.whatsapp.net', name: 'Tombstoned Legacy' };
  fs.writeFileSync(path.join(sourceDirectory, 'creds.json'), JSON.stringify(creds, baileys.BufferJSON.replacer), 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'session-live.json'), JSON.stringify({ chainKey: Buffer.from([1, 2, 3]) }, baileys.BufferJSON.replacer), 'utf8');

  store.upsertAccount({
    id: accountId,
    accountId,
    adapterAccountId: stableKey,
    platform: 'whatsapp',
    displayName: 'Tombstoned WhatsApp',
    state: 'logged-out',
    lifecycleState: 'tombstoned',
    tombstonedAt: iso(-1000),
    canSend: false,
    canReceive: false
  });
  db.prepare(`INSERT INTO whatsapp_auth_accounts(
    account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
    creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
    identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
    logged_out_at,quarantine_reason
  ) VALUES(?,?,?,?,NULL,NULL,NULL,NULL,NULL,'',0,'',?,?,?,? ,?,'')`).run(
    accountKey, accountId, 4, 'LOGGED_OUT', 22, 'tombstone-token', iso(-1000), iso(-1000), iso(-1000)
  );

  const discovered = resolver.resolveAuthLocation(stableKey, { migrate: true, includeFileCount: true });
  assert.equal(discovered.discoveryOnly, true);
  assert.equal(discovered.runtimeAuthState, null);
  assert.equal(discovered.migration.performed, false);
  assert.equal(fs.existsSync(runtimeDirectory), false, 'resolver must never copy legacy auth into a runtime directory');
  assert.equal(fs.existsSync(sourceDirectory), true);

  const accountBefore = db.prepare('SELECT state,lifecycle_state,tombstoned_at,auto_reconnect,paused FROM r32_accounts WHERE id=?').get(accountId);
  const authorityBefore = db.prepare('SELECT state,current_epoch,writer_generation,writer_socket_token,logged_out_at FROM whatsapp_auth_accounts WHERE account_key=?').get(accountKey);
  const report = await recovery.recoverAtStartup({ scanDataRoot: false });

  assert.equal(report.registered.length, 0);
  assert.equal(report.reconciled.length, 0);
  assert.equal(report.copied.length, 0);
  assert.equal(report.importRequired.length, 0);
  assert.deepEqual(report.tombstones, [{
    accountId,
    accountKey,
    stableKey,
    state: 'LOGGED_OUT',
    directory: path.resolve(sourceDirectory),
    reasonCode: 'WHATSAPP_LEGACY_AUTH_RESURRECTION_BLOCKED'
  }]);
  assert.deepEqual(
    db.prepare('SELECT state,lifecycle_state,tombstoned_at,auto_reconnect,paused FROM r32_accounts WHERE id=?').get(accountId),
    accountBefore
  );
  assert.deepEqual(
    db.prepare('SELECT state,current_epoch,writer_generation,writer_socket_token,logged_out_at FROM whatsapp_auth_accounts WHERE account_key=?').get(accountKey),
    authorityBefore
  );
  assert.equal(fs.existsSync(runtimeDirectory), false);
  assert.equal(fs.existsSync(sourceDirectory), true);
});
