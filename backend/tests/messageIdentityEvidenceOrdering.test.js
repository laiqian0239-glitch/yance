'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-identity-evidence-order-'));
const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_PRIMARY_SQLITE_PATH = dbPath;

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { createSqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `message-identity-evidence-order:${process.pid}`
});
const sqliteBroker = createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});
const authorityStore = sqliteBroker.open();

const eventBus = require('../services/eventBus');
const { AuthorityTransactionCoordinator } = require('../services/authorityTransactionCoordinator');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const canonicalEventLedger = require('../services/canonicalEventLedgerAuthority');
const authorityTransactionCoordinator = new AuthorityTransactionCoordinator({
  store: authorityStore,
  eventBus
});
const platformCoreRepository = createPlatformCoreRepository({
  storeProvider: () => authorityStore,
  coordinatorCapability: authorityTransactionCoordinator.repositoryCapability()
});
const canonicalEventLedgerAuthority = new canonicalEventLedger.CanonicalEventLedgerAuthority({
  coordinator: authorityTransactionCoordinator,
  store: authorityStore,
  compatibilityRepository: platformCoreRepository
});
canonicalEventLedger.configureSingleton(canonicalEventLedgerAuthority);

const messageStore = require('../services/messageStore');
const { getStore, closeStore } = require('../repositories/storeProvider');

const store = getStore();
store.upsertAccount({ id: 'page-identity-order', accountId: 'page-identity-order', adapterAccountId: 'page-identity-order', platform: 'facebook', state: 'online', canSend: false, canReceive: true });

test.after(() => {
  try { canonicalEventLedger.resetSingletonForTests(); } catch (_) {}
  try { closeStore(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('failed message projection persists only canonical repair evidence and creates no identity evidence', async t => {
  const originalTouch = authorityStore.touchConversationFromMessage;
  authorityStore.touchConversationFromMessage = () => {
    const error = new Error('forced message persistence failure');
    error.code = 'FORCED_MESSAGE_PERSISTENCE_FAILURE';
    throw error;
  };
  t.after(() => { authorityStore.touchConversationFromMessage = originalTouch; });

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
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM domain_events WHERE event_id=?').get(result.eventId).count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection_jobs WHERE event_id=?').get(result.eventId).count, 0);
  const receipt = store.db.prepare(`SELECT projection_status,failure_code FROM domain_projection_receipts
    WHERE projector_name='message-projection' AND projector_version='round12-v2' AND event_id=?`).get(result.eventId);
  assert.equal(receipt.projection_status, 'failed');
  assert.equal(receipt.failure_code, 'FORCED_MESSAGE_PERSISTENCE_FAILURE');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM r32_messages WHERE id=?').get('identity-order-mid-1').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM persons').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_links').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_link_audit').get().count, 0);
});
