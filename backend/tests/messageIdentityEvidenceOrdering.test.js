'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-identity-evidence-order-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');
const { AuthorityTransactionCoordinator } = require('../services/authorityTransactionCoordinator');
const canonicalEventLedger = require('../services/canonicalEventLedgerAuthority');
const eventBus = require('../services/eventBus');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');

resetSqliteConnectionBrokerForTests();
canonicalEventLedger.resetSingletonForTests();
const dbPath = path.join(dataRoot, 'database', 'yance.db');
const authorityHost = acquireAuthorityWriteHost({ dbPath, instanceId: 'identity-evidence-order-host' });
const broker = createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityHost.capability,
  storeOptions: { ownershipHeartbeatMs: 60000, ownershipStaleMs: 120000 }
});
const store = broker.open();
const coordinator = new AuthorityTransactionCoordinator({ store, eventBus });
canonicalEventLedger.configureSingleton(canonicalEventLedger.createCanonicalEventLedgerAuthority({
  store,
  coordinator,
  eventBus
}));
const messageStore = require('../services/messageStore');
const projectionJobSchema = messageStore.ensureCanonicalProjectionJobSchema(store);
assert.equal(projectionJobSchema.authority, 'CanonicalDomainProjectionJobSchemaAuthority');
assert.equal(projectionJobSchema.ledgerSequence, true);
assert.equal(projectionJobSchema.legacyForeignKeyRemoved, true);
const projectionJobColumns = store.db.prepare('PRAGMA table_info(domain_event_projection_jobs)').all();
assert.equal(projectionJobColumns.some(row => row.name === 'ledger_sequence'), true);
const projectionJobForeignKeys = store.db.prepare('PRAGMA foreign_key_list(domain_event_projection_jobs)').all();
assert.equal(projectionJobForeignKeys.some(row => row.table === 'canonical_event_headers' && row.from === 'event_id'), true);
assert.equal(projectionJobForeignKeys.some(row => row.table === 'domain_events'), false);

const cipher = createWhatsAppAuthCipher({ key: Buffer.alloc(32, 0x6d), keyVersion: 1 });
messageStore.configureWhatsAppMessageKeyIndex({
  cipherProvider: () => cipher,
  storeProvider: () => store
});

store.upsertAccount({ id: 'page-identity-order', accountId: 'page-identity-order', adapterAccountId: 'page-identity-order', platform: 'facebook', state: 'online', canSend: false, canReceive: true });
store.upsertAccount({ id: 'wa-identity-order', accountId: 'wa-identity-order', adapterAccountId: 'wa-identity-order', platform: 'whatsapp', state: 'online', canSend: false, canReceive: true });

test.after(() => {
  try { canonicalEventLedger.resetSingletonForTests(); } catch (_) {}
  try { cipher.close(); } catch (_) {}
  try { broker.checkpointAndClose(); } catch (_) {}
  try { authorityHost.close(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('failed message projection cannot create identity evidence for a nonexistent message', async t => {
  const originalTouch = store.touchConversationFromMessage;
  store.touchConversationFromMessage = () => {
    const error = new Error('forced message persistence failure');
    error.code = 'FORCED_MESSAGE_PERSISTENCE_FAILURE';
    throw error;
  };
  t.after(() => { store.touchConversationFromMessage = originalTouch; });

  const result = await messageStore.upsert({
    id: 'identity-order-mid-1',
    externalMessageId: 'identity-order-mid-1',
    dedupeKey: 'identity-order-mid-1',
    platform: 'facebook',
    accountId: 'page-identity-order',
    sourceAccountId: 'page-identity-order',
    pageScopedUserId: 'psid-identity-order',
    contactExternalId: 'psid-identity-order',
    chatJid: 'facebook:psid-identity-order',
    conversationId: 'page-identity-order:psid-identity-order',
    direction: 'inbound',
    fromMe: false,
    sender: 'psid-identity-order',
    contactName: 'Identity Ordering Test',
    text: 'Hello',
    type: 'text',
    timestamp: '2026-07-26T13:30:00.000Z'
  });

  assert.equal(result.committed, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.equal(result.repairRequired, true);
  assert.equal(result.failure.code, 'FORCED_MESSAGE_PERSISTENCE_FAILURE');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers WHERE event_id=?').get(result.eventId).count, 1);
  assert.equal(store.db.prepare('SELECT state FROM domain_event_projection_jobs WHERE event_id=?').get(result.eventId).state, 'failed');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM r32_messages WHERE id=?').get('identity-order-mid-1').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM persons').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_links').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_link_audit').get().count, 0);
});

test('failed WhatsApp message projection cannot leave an auth-key lookup index or identity evidence', async t => {
  const originalTouch = store.touchConversationFromMessage;
  store.touchConversationFromMessage = () => {
    const error = new Error('forced WhatsApp message persistence failure');
    error.code = 'FORCED_WHATSAPP_MESSAGE_PERSISTENCE_FAILURE';
    throw error;
  };
  t.after(() => { store.touchConversationFromMessage = originalTouch; });

  const result = await messageStore.upsert({
    id: 'identity-order-wa-mid-1',
    externalMessageId: 'identity-order-wa-external-1',
    dedupeKey: 'identity-order-wa-mid-1',
    platform: 'whatsapp',
    accountId: 'wa-identity-order',
    sourceAccountId: 'wa-identity-order',
    senderId: '15551234567@s.whatsapp.net',
    contactExternalId: '15551234567@s.whatsapp.net',
    chatJid: '15551234567@s.whatsapp.net',
    conversationId: 'wa-identity-order:15551234567@s.whatsapp.net',
    direction: 'inbound',
    fromMe: false,
    sender: 'WhatsApp Identity Ordering Test',
    contactName: 'WhatsApp Identity Ordering Test',
    text: 'Hello from WhatsApp',
    type: 'text',
    rawMessage: { conversation: 'Hello from WhatsApp' },
    rawMeta: {
      remoteJid: '15551234567@s.whatsapp.net',
      messageId: 'identity-order-wa-external-1'
    },
    timestamp: '2026-07-26T13:31:00.000Z'
  });

  assert.equal(result.committed, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.equal(result.repairRequired, true);
  assert.equal(result.failure.code, 'FORCED_WHATSAPP_MESSAGE_PERSISTENCE_FAILURE');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers WHERE event_id=?').get(result.eventId).count, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM r32_messages WHERE id=?').get('identity-order-wa-mid-1').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM whatsapp_message_key_index').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM whatsapp_message_retry_payloads').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM persons').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_links').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_link_audit').get().count, 0);
});
