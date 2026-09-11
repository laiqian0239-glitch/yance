'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b24-domain-projector-'));
process.env.YANCE_DATA_DIR = root;
process.env.WORKBUDDY_DATA_DIR = root;
process.env.NODE_ENV = 'test';
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  getSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const brokerDbPath = path.join(root, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(brokerDbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath: brokerDbPath,
  instanceId: `b24-domain-projector-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath: brokerDbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});
const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
const rawStore = getSqliteConnectionBroker().open();
const appRuntime = AppRuntimeFactory.create({
  ownership: { guard: () => ({ ownerInstanceId: 'b24-domain-projector-owner', fencingToken: 1 }) },
  store: {
    db: rawStore.db,
    snapshot: () => ({
      stateVersion: 1,
      lastEventSequence: 0,
      runtime: { operatingMode: 'normal', operatingModeRevision: 1 },
      capabilities: {},
      diagnosticsSummary: {}
    })
  },
  lifecycle: { state: 'runtime_state_ready' },
  buildId: 'b24-domain-projector-test',
  authorityWriteHostCapability: authorityWriteHost.capability,
  authorityStore: rawStore
});
appRuntime.configureProductionServices();

const { getR32Store, closeR32Store } = require('../lib/r32StoreSingleton');
const messageStore = require('../services/messageStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { DomainEventProjectionAuthority } = require('../services/domainEventProjectionAuthority');
const canonicalEventLedger = require('../services/canonicalEventLedgerAuthority');
const eventBus = require('../services/eventBus');

function inbound(id = 'incoming-projection-fail') {
  return {
    id,
    dedupeKey: id,
    externalMessageId: id,
    accountId: 'page-projection',
    sourceAccountId: 'page-projection',
    conversationId: 'page-projection:psid-projection',
    sessionKey: 'page-projection:psid-projection',
    platform: 'facebook',
    contactExternalId: 'psid-projection',
    pageScopedUserId: 'psid-projection',
    senderId: 'psid-projection',
    contactName: 'Projection Test',
    direction: 'inbound',
    fromMe: false,
    type: 'text',
    text: 'Hallo aus dem durable projector',
    timestamp: '2026-07-28T12:00:00.000Z',
    source: 'facebook-webhook'
  };
}

test('domain event and projection job survive a projection failure and converge after restart-style drain', async () => {
  const store = getR32Store();
  store.upsertAccount({ id: 'page-projection', accountId: 'page-projection', adapterAccountId: 'page-projection', platform: 'facebook', state: 'online' });
  store.db.exec(`CREATE TRIGGER fail_projection_message BEFORE INSERT ON r32_messages
    WHEN NEW.id='incoming-projection-fail'
    BEGIN SELECT RAISE(ABORT,'SIMULATED_DOMAIN_PROJECTION_FAILURE'); END;`);

  const first = await messageStore.upsert(inbound());
  assert.equal(first.committed, true);
  assert.equal(first.projectionStatus, 'pending');
  assert.equal(first.repairRequired, true);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM canonical_event_headers WHERE event_type='message.received'").get().n, 1);
  assert.equal(store.db.prepare("SELECT state FROM domain_event_projection_jobs LIMIT 1").get().state, 'failed');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM r32_messages WHERE id='incoming-projection-fail'").get().n, 0);

  store.db.exec('DROP TRIGGER fail_projection_message');
  store.db.prepare("UPDATE domain_event_projection_jobs SET next_attempt_at='' WHERE state='failed'").run();
  const authority = new DomainEventProjectionAuthority({
    repository: createPlatformCoreRepository({ storeProvider: () => store }),
    messageStore,
    eventBus,
    jobIntervalMs: 60000
  });
  const report = await authority.drainProjectionJobs({ limit: 10 });
  assert.equal(report.applied, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM r32_messages WHERE id='incoming-projection-fail'").get().n, 1);
  assert.equal(store.db.prepare("SELECT state FROM domain_event_projection_jobs LIMIT 1").get().state, 'applied');
  const receipt = store.db.prepare("SELECT projection_status FROM domain_projection_receipts WHERE event_id=? AND projector_name='message-projection'").get(first.eventId);
  assert.equal(receipt.projection_status, 'applied');
});

test.after(() => {
  try { canonicalEventLedger.resetSingletonForTests(); } catch (_) {}
  try { AppRuntimeFactory.resetForTests(); } catch (_) {}
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
});
