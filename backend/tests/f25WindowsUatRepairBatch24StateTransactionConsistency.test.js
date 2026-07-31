'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const { IdentityDomainEventOutboxService } = require('../services/identityDomainEventOutboxService');
const { RuntimeSettingsService } = require('../services/runtimeSettings');
const { AsyncOperationLifecycleAuthority, STATES } = require('../services/asyncOperationLifecycleAuthority');
const { AccountLifecycleSagaService } = require('../services/accountLifecycleSagaService');
const { AccountManager } = require('../services/accountManager');

function fixture(prefix = 'yance-b24-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return {
    root,
    store,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function seedScope(store, suffix = '1', platform = 'facebook') {
  const accountId = `account-${suffix}`;
  const sessionKey = `${accountId}:peer-${suffix}`;
  const target = `peer-${suffix}`;
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform, state: 'online', canSend: true, canReceive: true });
  store.upsertConversation({ sessionKey, accountId, platform, title: target, routeState: 'bound', chatJid: target, externalId: target });
  return { accountId, sessionKey, target, platform };
}

function authority(store) {
  return new OutboxRouteAuthority({
    storeProvider: () => store,
    externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store })
  });
}

function command(store, routeAuthority, scope, id, capabilitySnapshotId = 'cap-1') {
  return {
    store,
    outboxRouteAuthority: routeAuthority,
    route: {
      conversationId: scope.sessionKey,
      accountId: scope.accountId,
      platform: scope.platform,
      routeTarget: scope.target,
      capabilitySnapshotId
    },
    queue: {
      id,
      idempotencyKey: id,
      accountId: scope.accountId,
      sessionKey: scope.sessionKey,
      messageType: 'text',
      capabilitySnapshotId,
      payload: { operation: 'text', text: `Hallo ${id}` }
    },
    message: {
      id,
      dedupeKey: id,
      externalMessageId: id,
      accountId: scope.accountId,
      conversationId: scope.sessionKey,
      sessionKey: scope.sessionKey,
      chatJid: scope.target,
      platform: scope.platform,
      direction: 'outbound',
      fromMe: true,
      type: 'text',
      text: `Hallo ${id}`
    }
  };
}

test('Boot Phase 0 rejects restore after the broker-owned SQLite handle is open and rejects a second owner', () => {
  process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
  const brokerModule = require('../lib/sqliteConnectionBroker');
  brokerModule.resetSqliteConnectionBrokerForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b24-broker-'));
  try {
    const { runBootPhase0Restore } = require('../bootstrap/bootPhase0Restore');
    const phase0 = runBootPhase0Restore();
    assert.equal(phase0.ok, true);
    assert.equal(phase0.phase || 'boot-phase-0', 'boot-phase-0');

    const broker = brokerModule.createSqliteConnectionBroker({ dbPath: path.join(root, 'store', 'yance.db') });
    broker.open();
    assert.throws(
      () => brokerModule.createSqliteConnectionBroker({ dbPath: path.join(root, 'store', 'second.db') }),
      error => error.code === 'SQLITE_SECOND_WRITE_OWNER_REJECTED'
    );
    const backupService = require('../services/backupService');
    assert.throws(
      () => backupService.executePendingRestore({ requireClosedDatabase: true, phase: 'test' }),
      error => error.code === 'RESTORE_REQUIRES_CLOSED_DATABASE'
    );
  } finally {
    brokerModule.resetSqliteConnectionBrokerForTests();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  }
});


test('Electron settings worker rejects the broker-owned primary SQLite database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b24-settings-worker-'));
  const primary = path.join(root, 'store', 'yance-r32.db');
  const settings = path.join(root, 'settings', 'yance-settings.db');
  fs.mkdirSync(path.dirname(primary), { recursive: true });
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  const worker = path.resolve(__dirname, '..', '..', 'electron', 'sqliteSettingsWorker.js');
  try {
    const rejected = spawnSync(process.execPath, [worker], {
      input: JSON.stringify({ operation: 'write', dbPath: primary, namespace: 'settings', key: 'theme', value: 'dark' }),
      encoding: 'utf8',
      env: { ...process.env, YANCE_DATA_DIR: root, YANCE_PRIMARY_SQLITE_PATH: primary, YANCE_SETTINGS_SQLITE_PATH: primary }
    });
    const rejectedBody = JSON.parse(String(rejected.stdout || '{}'));
    assert.equal(rejected.status, 1);
    assert.equal(rejectedBody.reasonCode, 'SQLITE_SECOND_WRITE_OWNER_REJECTED');

    const allowed = spawnSync(process.execPath, [worker], {
      input: JSON.stringify({ operation: 'write', dbPath: settings, namespace: 'settings', key: 'theme', value: 'dark' }),
      encoding: 'utf8',
      env: { ...process.env, YANCE_DATA_DIR: root, YANCE_PRIMARY_SQLITE_PATH: primary, YANCE_SETTINGS_SQLITE_PATH: settings }
    });
    const allowedBody = JSON.parse(String(allowed.stdout || '{}'));
    assert.equal(allowed.status, 0);
    assert.equal(allowedBody.written, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('queue claim token and generation reject a late completion after outcome becomes unknown', () => {
  const f = fixture('yance-b24-cas-unknown-');
  try {
    const scope = seedScope(f.store);
    const created = outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, 'send-unknown'));
    assert.equal(created.queue.state, 'pending');
    const claimed = f.store.claimNextSend();
    const claim = { generation: claimed.claim_generation, token: claimed.claim_token };
    const unknown = f.store.markSendOutcomeUnknown(claimed.id, { error: 'simulated process uncertainty' }, claim);
    assert.equal(unknown.state, 'send_outcome_unknown');
    assert.throws(
      () => f.store.markSendResult(claimed.id, { success: true, platformMessageId: 'late-mid' }, claim),
      error => error.code === 'SEND_QUEUE_STALE_COMPLETION'
    );
    assert.equal(f.store.getSendQueueItem(claimed.id).state, 'send_outcome_unknown');
  } finally { f.close(); }
});

test('only the current queue claim token can complete a retried command', () => {
  const f = fixture('yance-b24-cas-generation-');
  try {
    const scope = seedScope(f.store);
    outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, 'send-generation'));
    const first = f.store.claimNextSend();
    const firstClaim = { generation: first.claim_generation, token: first.claim_token };
    f.store.deferSend(first.id, { nextAttemptAt: new Date(0).toISOString(), error: 'retry' }, firstClaim);
    const second = f.store.claimNextSend();
    const secondClaim = { generation: second.claim_generation, token: second.claim_token };
    assert.ok(secondClaim.generation > firstClaim.generation);
    assert.notEqual(secondClaim.token, firstClaim.token);
    assert.throws(
      () => f.store.markSendResult(second.id, { success: true, platformMessageId: 'stale-mid' }, firstClaim),
      error => error.code === 'SEND_QUEUE_STALE_COMPLETION'
    );
    assert.equal(f.store.markSendResult(second.id, { success: true, platformMessageId: 'current-mid' }, secondClaim).state, 'sent');
  } finally { f.close(); }
});

test('a stale queue worker cannot overwrite the frozen OutboxCommand of a newer claim', () => {
  const f = fixture('yance-b24-outbox-command-cas-');
  try {
    const scope = seedScope(f.store, 'outbox-cas');
    outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, 'send-outbox-cas'));
    const first = f.store.claimNextSend();
    const firstClaim = { generation: first.claim_generation, token: first.claim_token };
    f.store.deferSend(first.id, { nextAttemptAt: new Date(0).toISOString(), error: 'retry' }, firstClaim);
    const second = f.store.claimNextSend();
    const secondClaim = { generation: second.claim_generation, token: second.claim_token };
    assert.throws(
      () => f.store.persistSendQueueOutboxCommand(second.id, { operation: 'text', finalText: 'stale' }, {}, firstClaim),
      error => error.code === 'SEND_QUEUE_OUTBOX_COMMAND_STALE'
    );
    const persisted = f.store.persistSendQueueOutboxCommand(second.id, { operation: 'text', finalText: 'current' }, {}, secondClaim);
    assert.equal(persisted.payload.outboxCommand.finalText, 'current');
  } finally { f.close(); }
});

test('queue state and outbound message receipt roll back together when receipt update fails', () => {
  const f = fixture('yance-b24-checkpoint-');
  try {
    const scope = seedScope(f.store);
    outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, 'send-checkpoint'));
    const claimed = f.store.claimNextSend();
    const claim = { generation: claimed.claim_generation, token: claimed.claim_token };
    const pending = f.store.markPlatformAcceptedLocalPending(claimed.id, { platformMessageId: 'mid-checkpoint' }, claim);
    f.store.db.exec(`CREATE TRIGGER fail_message_receipt BEFORE UPDATE OF delivery_status ON r32_messages
      BEGIN SELECT RAISE(ABORT,'SIMULATED_RECEIPT_FAILURE'); END;`);
    assert.throws(() => f.store.checkpointLocalDeliveryTx({
      queueId: pending.id,
      expectedQueueState: 'platform_accepted_local_pending',
      queueState: 'sent',
      messageDeliveryStatus: 'sent',
      platformMessageId: 'mid-checkpoint',
      generation: pending.claim_generation,
      token: pending.claim_token,
      requireMessage: true
    }), /SIMULATED_RECEIPT_FAILURE/);
    const queue = f.store.getSendQueueItem(pending.id);
    const message = f.store.getMessage(pending.id);
    assert.equal(queue.state, 'platform_accepted_local_pending');
    assert.notEqual(message.deliveryStatus, 'sent');
  } finally { f.close(); }
});

test('outcome-unknown resolution and message receipt roll back together when receipt update fails', () => {
  const f = fixture('yance-b24-outcome-resolution-');
  try {
    const scope = seedScope(f.store, 'outcome-resolution');
    outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, 'send-outcome-resolution'));
    const claimed = f.store.claimNextSend();
    const unknown = f.store.markSendOutcomeUnknown(claimed.id, { error: 'simulated uncertainty' }, {
      generation: claimed.claim_generation,
      token: claimed.claim_token
    });
    const beforeVersion = unknown.row_version;
    f.store.db.exec(`CREATE TRIGGER fail_outcome_receipt BEFORE UPDATE OF delivery_status ON r32_messages
      BEGIN SELECT RAISE(ABORT,'SIMULATED_OUTCOME_RECEIPT_FAILURE'); END;`);
    assert.throws(() => f.store.resolveSendOutcomeUnknown(unknown.id, 'confirmed_not_sent', {
      requireMessage: true,
      messageId: unknown.id,
      messageDeliveryStatus: 'queued'
    }), /SIMULATED_OUTCOME_RECEIPT_FAILURE/);
    const queue = f.store.getSendQueueItem(unknown.id);
    assert.equal(queue.state, 'send_outcome_unknown');
    assert.equal(queue.row_version, beforeVersion);
  } finally { f.close(); }
});

test('manual retry and cancel roll back queue state when outbound receipt persistence fails', () => {
  for (const action of ['retry', 'cancel']) {
    const f = fixture(`yance-b24-${action}-receipt-`);
    try {
      const scope = seedScope(f.store, action);
      const id = `send-${action}-receipt`;
      outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, id));
      const before = f.store.getSendQueueItem(id);
      f.store.db.exec(`CREATE TRIGGER fail_manual_receipt BEFORE UPDATE OF delivery_status ON r32_messages
        BEGIN SELECT RAISE(ABORT,'SIMULATED_MANUAL_RECEIPT_FAILURE'); END;`);
      const invoke = action === 'retry'
        ? () => f.store.retrySend(id, { requireMessage: true, messageId: id, messageDeliveryStatus: 'queued' })
        : () => f.store.cancelSend(id, { requireMessage: true, messageId: id, messageDeliveryStatus: 'cancelled' });
      assert.throws(invoke, /SIMULATED_MANUAL_RECEIPT_FAILURE/);
      const after = f.store.getSendQueueItem(id);
      assert.equal(after.state, before.state);
      assert.equal(after.row_version, before.row_version);
    } finally { f.close(); }
  }
});

test('a second outcome-unknown decision cannot overwrite the first terminal decision', () => {
  const f = fixture('yance-b24-outcome-double-resolution-');
  try {
    const scope = seedScope(f.store, 'double-resolution');
    const id = 'send-double-resolution';
    outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scope, id));
    const claimed = f.store.claimNextSend();
    f.store.markSendOutcomeUnknown(id, { error: 'unknown' }, {
      generation: claimed.claim_generation,
      token: claimed.claim_token
    });
    const first = f.store.resolveSendOutcomeUnknown(id, 'cancelled', {
      requireMessage: true,
      messageId: id,
      messageDeliveryStatus: 'cancelled'
    });
    assert.equal(first.state, 'cancelled');
    assert.throws(
      () => f.store.resolveSendOutcomeUnknown(id, 'confirmed_not_sent', { requireMessage: true, messageId: id }),
      error => error.code === 'SEND_OUTCOME_NOT_UNKNOWN'
    );
    assert.equal(f.store.getSendQueueItem(id).state, 'cancelled');
  } finally { f.close(); }
});

test('immutable route versions remain valid and database triggers reject wrong route scope or illegal state', () => {
  const f = fixture('yance-b24-route-version-');
  try {
    const scopeA = seedScope(f.store, 'a');
    const scopeB = seedScope(f.store, 'b');
    const routeAuthority = authority(f.store);
    const first = outboundCommandRepository.createAtomic(command(f.store, routeAuthority, scopeA, 'send-route-a1', 'cap-a1'));
    const second = outboundCommandRepository.createAtomic(command(f.store, routeAuthority, scopeA, 'send-route-a2', 'cap-a2'));
    const other = outboundCommandRepository.createAtomic(command(f.store, routeAuthority, scopeB, 'send-route-b', 'cap-b'));
    assert.notEqual(first.route.routeVersionId, second.route.routeVersionId);
    assert.equal(routeAuthority.getVersion(first.route.routeVersionId).scopeHash, first.route.scopeHash);
    assert.equal(f.store.getSendQueueItem('send-route-a1').outbox_route_version_id, first.route.routeVersionId);
    assert.throws(
      () => f.store.db.prepare('UPDATE r32_send_queue SET outbox_route_version_id=? WHERE id=?').run(other.route.routeVersionId, 'send-route-a1'),
      /SEND_QUEUE_ROUTE_VERSION_SCOPE_INVALID/
    );
    assert.throws(
      () => f.store.db.prepare("UPDATE r32_send_queue SET state='not-a-state' WHERE id=?").run('send-route-a1'),
      /SEND_QUEUE_STATE_INVALID/
    );
    assert.throws(
      () => f.store.enqueueSend({
        id: 'send-route-missing',
        idempotencyKey: 'send-route-missing',
        accountId: scopeA.accountId,
        sessionKey: scopeA.sessionKey,
        messageType: 'text',
        payload: { operation: 'text', text: 'missing immutable route' }
      }),
      /SEND_QUEUE_ROUTE_VERSION_REQUIRED/
    );
    outboundCommandRepository.createAtomic(command(f.store, authority(f.store), scopeA, 'legacy-scope-update'));
    assert.throws(
      () => f.store.db.prepare('UPDATE r32_send_queue SET account_id=? WHERE id=?').run('missing-account', 'legacy-scope-update'),
      /(SEND_QUEUE_SCOPE_INVALID|SEND_QUEUE_ROUTE_VERSION_SCOPE_INVALID)/
    );
    assert.throws(
      () => f.store.db.prepare('UPDATE r32_send_queue SET session_key=? WHERE id=?').run('missing-conversation', 'legacy-scope-update'),
      /(SEND_QUEUE_SCOPE_INVALID|SEND_QUEUE_ROUTE_VERSION_SCOPE_INVALID)/
    );
  } finally { f.close(); }
});

test('identity outbox reclaims an expired processing lease and rejects the old token finalizer', async () => {
  const f = fixture('yance-b24-identity-lease-');
  try {
    const service = new IdentityDomainEventOutboxService({ storeProvider: () => f.store, leaseMs: 5000 });
    const row = service.enqueue({ auditId: 'audit-b24', pendingDomainEvent: { auditId: 'audit-b24', eventType: 'identity.link.observed' } });
    f.store.db.prepare(`UPDATE identity_domain_event_outbox SET state='processing',attempts=1,claim_token='old-token',locked_at=?,lease_expires_at=? WHERE outbox_id=?`)
      .run(new Date(0).toISOString(), new Date(0).toISOString(), row.outbox_id);
    let finalized = 0;
    const report = await service.drainOnce(async () => { finalized += 1; });
    assert.equal(report.recovered, 1);
    assert.equal(report.sent, 1);
    assert.equal(finalized, 1);
    const stale = f.store.db.prepare(`UPDATE identity_domain_event_outbox SET state='sent' WHERE outbox_id=? AND state='processing' AND claim_token='old-token'`).run(row.outbox_id);
    assert.equal(Number(stale.changes || 0), 0);
    assert.equal(service.get(row.outbox_id).state, 'sent');
  } finally { f.close(); }
});

test('runtime setting updates merge inside the shared SQLite transaction without losing another field', () => {
  const f = fixture('yance-b24-settings-');
  try {
    const a = new RuntimeSettingsService({ storeProvider: () => f.store });
    const b = new RuntimeSettingsService({ storeProvider: () => f.store });
    a.update({ autoConnectAccounts: false });
    b.update({ mediaAutoDownload: true });
    const final = a.read();
    assert.equal(final.autoConnectAccounts, false);
    assert.equal(final.mediaAutoDownload, true);
    assert.equal(final.backupOnStart, true);
  } finally { f.close(); }
});


test('a second OS process cannot open the broker-owned primary SQLite database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b24-owner-process-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const owner = new R32SqliteStore({ dbPath });
  const workerPath = path.join(root, 'open-primary.js');
  const storeModule = path.resolve(__dirname, '../lib/r32SqliteStore.js');
  fs.writeFileSync(workerPath, `
    'use strict';
    const { R32SqliteStore } = require(${JSON.stringify(storeModule)});
    try {
      const store = new R32SqliteStore({ dbPath: process.argv[2] });
      store.close();
      process.stdout.write('UNEXPECTED_OPEN');
      process.exitCode = 2;
    } catch (error) {
      process.stdout.write(String(error.code || error.reasonCode || error.message || error));
      process.exitCode = 0;
    }
  `);
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath, dbPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /SQLITE_(OWNERSHIP_CONFLICT|SECOND_WRITE_OWNER_REJECTED)/);
  } finally {
    owner.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic account persistence no longer clears an existing compatibility send/receive projection', () => {
  const f = fixture('yance-b24-account-capability-');
  try {
    f.store.upsertAccount({ id: 'account-cap', accountId: 'account-cap', adapterAccountId: 'account-cap', platform: 'telegram', canSend: true, canReceive: true, displayName: 'Before' });
    f.store.upsertAccount({ id: 'account-cap', accountId: 'account-cap', adapterAccountId: 'account-cap', platform: 'telegram', displayName: 'After' });
    const row = f.store.db.prepare('SELECT can_send,can_receive,display_name FROM r32_accounts WHERE id=?').get('account-cap');
    assert.equal(row.can_send, 1);
    assert.equal(row.can_receive, 1);
    assert.equal(row.display_name, 'After');
  } finally { f.close(); }
});

test('RUNNING auth operations fail on restart when challenge context is lost and resume when adapter session is durable', async () => {
  const f = fixture('yance-b24-auth-restart-');
  try {
    const lifecycle = new AsyncOperationLifecycleAuthority({ store: f.store });
    const lost = lifecycle.create({ operationType: 'platform.auth.workflow', scopeKey: 'telegram:lost', objectFingerprint: 'lost-v1', resumePolicy: 'fail_on_restart' }).operation;
    lifecycle.start(lost.operationId, { resumePolicy: 'fail_on_restart' });
    const resumable = lifecycle.create({ operationType: 'platform.auth.workflow', scopeKey: 'telegram:resume', objectFingerprint: 'resume-v1', resumePolicy: 'resume_adapter_session', adapterSessionId: 'adapter-session-1' }).operation;
    lifecycle.start(resumable.operationId, { resumePolicy: 'resume_adapter_session', adapterSessionId: 'adapter-session-1' });
    let resumed = 0;
    const report = await lifecycle.recoverInterruptedAuthOperations({
      canResume: async id => id === 'adapter-session-1',
      resume: async () => { resumed += 1; },
      leaseOwner: 'test-restart'
    });
    assert.equal(report.failed, 1);
    assert.equal(report.resumed, 1);
    assert.equal(resumed, 1);
    assert.equal(lifecycle.read(lost.operationId).state, STATES.FAILED);
    assert.equal(lifecycle.read(lost.operationId).errorCode, 'PROCESS_RESTARTED_AUTH_CONTEXT_LOST');
    assert.equal(lifecycle.read(resumable.operationId).state, STATES.RUNNING);
  } finally { f.close(); }
});

test('account lifecycle saga converges an interrupted connect and hydration publishes recovering before authority is ready', async () => {
  const f = fixture('yance-b24-saga-hydration-');
  try {
    const scope = seedScope(f.store, 'saga', 'telegram');
    const fakeAccount = { id: scope.accountId, platform: 'telegram', lifecycleState: 'active' };
    const fakeAccountStore = { getRaw: id => id === fakeAccount.id ? fakeAccount : null };
    const fakeDrivers = { get: () => ({ status: () => ({ state: 'offline' }) }) };
    const saga = new AccountLifecycleSagaService({ storeProvider: () => f.store, accountStore: fakeAccountStore, platformDrivers: fakeDrivers });
    const operation = await saga.begin(fakeAccount, 'connect');
    await saga.setPhase(operation.operation_id, 'prepared', 'adapter_connect_started');
    const report = await saga.recoverInterrupted();
    assert.equal(report.failed, 1);
    assert.equal(saga.get(operation.operation_id).state, 'failed');

    const manager = new AccountManager();
    const publicAccount = manager.publicAccount(fakeAccount);
    assert.equal(publicAccount.state, 'recovering');
    assert.equal(publicAccount.sendReadiness, 'recovering');
    assert.equal(publicAccount.authorityPending, true);
  } finally { f.close(); }
});

test('a connected adapter cannot finish an account Saga before SQLite identity commit', async () => {
  const f = fixture('yance-b24-saga-connected-');
  try {
    const scope = seedScope(f.store, 'connected-saga', 'telegram');
    const account = { id: scope.accountId, platform: 'telegram', lifecycleState: 'active', metadata: {} };
    const saga = new AccountLifecycleSagaService({
      storeProvider: () => f.store,
      accountStore: { getRaw: () => account },
      platformDrivers: { get: () => ({ status: () => ({ state: 'connected' }) }) }
    });
    const operation = await saga.begin(account, 'connect');
    await saga.setPhase(operation.operation_id, 'prepared', 'adapter_connect_started');
    const observed = await saga.settleLatestFromAdapter(account.id, 'connected', { state: 'connected' });
    assert.equal(observed.requiresIdentityCommit, true);
    assert.equal(saga.get(operation.operation_id).state, 'running');
    const recovered = await saga.recoverInterrupted();
    assert.equal(recovered.manualReview, 1);
    assert.equal(saga.get(operation.operation_id).state, 'manual_review');
    assert.equal(saga.get(operation.operation_id).last_error, 'ADAPTER_CONNECTED_SQLITE_IDENTITY_UNCONFIRMED');
  } finally { f.close(); }
});

test('an interrupted disconnect converges the durable account projection before Saga success', async () => {
  const f = fixture('yance-b24-saga-disconnect-');
  try {
    const scope = seedScope(f.store, 'disconnect-saga', 'telegram');
    let account = {
      id: scope.accountId,
      platform: 'telegram',
      lifecycleState: 'paused',
      paused: true,
      credentialRef: `credential:${scope.accountId}`,
      metadata: { lifecyclePending: true, lifecycleOperation: 'disconnect' }
    };
    const audits = [];
    const fakeStore = {
      getRaw: () => account,
      commitLifecycleTx: async (_id, patch, audit) => {
        account = { ...account, ...patch, metadata: { ...(account.metadata || {}), ...(patch.metadata || {}) } };
        audits.push(audit);
        return account;
      }
    };
    const saga = new AccountLifecycleSagaService({
      storeProvider: () => f.store,
      accountStore: fakeStore,
      platformDrivers: { get: () => ({ status: () => ({ state: 'offline' }) }) }
    });
    const operation = await saga.begin(account, 'disconnect');
    await saga.setPhase(operation.operation_id, 'prepared', 'sqlite_mark_disconnect_pending');
    await saga.setPhase(operation.operation_id, 'sqlite_mark_disconnect_pending', 'adapter_disconnect_started');
    const recovered = await saga.recoverInterrupted();
    assert.equal(recovered.succeeded, 1);
    assert.equal(account.metadata.lifecyclePending, false);
    assert.equal(account.paused, true);
    assert.equal(audits[0].action, 'account-disconnect-recovered');
    assert.equal(saga.get(operation.operation_id).state, 'succeeded');
  } finally { f.close(); }
});


test('connect Saga recovery uses the atomic SQLite operation marker to close the commit-to-phase crash window', async () => {
  const f = fixture('yance-b24-saga-connect-marker-');
  try {
    const scope = seedScope(f.store, 'connect-marker', 'telegram');
    let account = { id: scope.accountId, platform: 'telegram', lifecycleState: 'active', metadata: {} };
    const saga = new AccountLifecycleSagaService({
      storeProvider: () => f.store,
      accountStore: { getRaw: () => account },
      platformDrivers: { get: () => ({ status: () => ({ state: 'connected' }) }) }
    });
    const operation = await saga.begin(account, 'connect');
    await saga.setPhase(operation.operation_id, 'prepared', 'adapter_connect_started');
    await saga.setPhase(operation.operation_id, 'adapter_connect_started', 'adapter_connected');
    await saga.setPhase(operation.operation_id, 'adapter_connected', 'sqlite_identity_committing');
    account = { ...account, metadata: { lastConnectOperationId: operation.operation_id } };
    const recovered = await saga.recoverInterrupted();
    assert.equal(recovered.succeeded, 1);
    assert.equal(saga.get(operation.operation_id).state, 'succeeded');
  } finally { f.close(); }
});
