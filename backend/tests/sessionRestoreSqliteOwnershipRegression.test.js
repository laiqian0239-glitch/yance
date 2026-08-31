'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  acquireAuthorityWriteHost
} = require('../services/authorityWriteHost');

const {
  SqliteConnectionBroker
} = require('../lib/sqliteConnectionBroker');

const {
  SqliteDocumentStore
} = require('../lib/sqliteDocumentStore');

const {
  DurableExecutionAuthority
} = require('../services/durableExecutionAuthority');

function iso(base, offsetMs = 0) {
  return new Date(base + offsetMs).toISOString();
}

test('3 persisted SESSION_RESTORE claims do not collide with synchronous document updateAsync ownership', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yance-session-restore-sqlite-ownership-')
  );

  const dbPath = path.join(root, 'yance-r32.db');

  let broker = null;
  let host = null;

  try {
    const identity = `node-test:${process.pid}:${crypto.randomUUID()}`;

    host = acquireAuthorityWriteHost({
      dbPath,
      instanceId: `session-restore-host-${crypto.randomUUID()}`,
      startupNonce: crypto.randomUUID(),
      ownershipPid: process.pid,
      ownershipProcessIdentity: identity,
      ownershipPidAlive: pid => Number(pid) === Number(process.pid),
      ownershipCapturePidIdentity: () => identity,
      ownershipStaleMs: 60_000
    });

    broker = new SqliteConnectionBroker({
      dbPath,
      authorityWriteHostCapability: host.capability,
      storeOptions: {
        authorityHeartbeatMs: 60_000
      }
    });

    const store = broker.open();

    assert.ok(store);
    assert.ok(store.db);
    assert.ok(store.transactions);
    assert.equal(typeof store.transactions.snapshot, 'function');

    const persistenceCapability = {
      getSetting(namespace, name, fallback) {
        return store.getSetting(namespace, name, fallback);
      },

      setSetting(namespace, name, value) {
        return store.setSetting(namespace, name, value);
      },

      transaction(work) {
        return store.transaction(work);
      },

      transactionAsync(work) {
        return store.transactionAsync(work);
      }
    };

    const documentStore = new SqliteDocumentStore(
      'session-restore-startup-overlap',
      { revision: 0 },
      { persistenceCapability }
    );

    const authority = new DurableExecutionAuthority({
      storeProvider: () => store
    });

    const token = host.tokenSnapshot();

    assert.ok(token.instanceId);
    assert.ok(Number(token.hostGeneration) > 0);
    assert.ok(Number(token.fencingToken) > 0);

    const base = Date.parse('2026-08-31T04:04:00.000Z');

    const prepared = [];

    for (let index = 0; index < 3; index += 1) {
      const accountId = `existing-account-${index + 1}`;

      const createdAt = iso(base, index * 10_000);

      const created = authority.createExecution({
        executionId: `execution-session-restore-${index + 1}`,
        operationKind: 'SESSION_RESTORE',
        idempotencyKey: `existing-session-restore:${accountId}:1`,
        traceId: `startup-session-restore-${index + 1}`,
        command: {
          accountId,
          requestedSessionGeneration: 1,
          credentialReference: `credential-existing-${index + 1}`
        },
        authorityTimestamp: createdAt,
        maxAttempts: 3,
        metadata: {
          accountId,
          startup: true
        }
      });

      assert.equal(created.operationKind, 'SESSION_RESTORE');
      assert.equal(created.state, 'CREATED');

      const scheduledAt = iso(base, index * 10_000 + 1_000);

      const scheduled = authority.schedule({
        executionId: created.executionId,
        expectedStateVersion: created.stateVersion,
        generation: created.generation,
        hostId: token.instanceId,
        hostGeneration: token.hostGeneration,
        fencingToken: token.fencingToken,
        authorityTimestamp: scheduledAt,
        operationKind: 'SESSION_RESTORE',
        reasonCode: 'STARTUP_SESSION_RESTORE'
      });

      assert.equal(scheduled.executionId, created.executionId);
      assert.equal(scheduled.state, 'SCHEDULED');

      prepared.push(scheduled);
    }

    assert.equal(prepared.length, 3);

    const before = store.transactions.snapshot();

    assert.equal(before.depth, 0);
    assert.equal(before.pendingAsyncRoots, 0);

    /*
     * Exact UAT causal ordering:
     *
     * 1. documentStore.updateAsync() schedules a transactionAsync root.
     * 2. The coordinator execute microtask opens BEGIN IMMEDIATE.
     * 3. Old SqliteDocumentStore used async () => and therefore retained
     *    ownership across the following claim microtasks.
     * 4. DurableExecutionAuthority.claim() performs store.transaction/runSync.
     *
     * Old implementation deterministically produced:
     * SQLITE_TRANSACTION_BUSY_CONTEXT
     *
     * Fixed implementation uses a synchronous transaction callback and the
     * coordinator commits through its synchronous fast-path before claims run.
     */
    const documentUpdate = documentStore.updateAsync(current => {
      current.revision += 1;
      return current;
    });

    const busyCodes = [];
    const claimed = [];

    const claimPromises = prepared.map((scheduled, index) =>
      Promise.resolve().then(() => {
        const leaseStartedAt = iso(base, 60_000 + index * 10_000);
        const leaseExpiresAt = iso(base, 360_000 + index * 10_000);

        try {
          const result = authority.claim({
            executionId: scheduled.executionId,
            expectedStateVersion: scheduled.stateVersion,
            generation: scheduled.generation,
            ownerId: token.instanceId,
            claimId: `claim-session-restore-${index + 1}`,
            hostId: token.instanceId,
            hostGeneration: token.hostGeneration,
            fencingToken: token.fencingToken,
            leaseStartedAt,
            leaseExpiresAt,
            authorityTimestamp: leaseStartedAt,
            reasonCode: 'STARTUP_SESSION_RESTORE'
          });

          claimed.push(result);
          return result;
        } catch (error) {
          if (error && error.code) busyCodes.push(String(error.code));
          throw error;
        }
      })
    );

    const results = await Promise.all(claimPromises);
    const document = await documentUpdate;

    assert.deepEqual(document, { revision: 1 });

    assert.equal(results.length, 3);
    assert.equal(claimed.length, 3);

    assert.equal(
      busyCodes.filter(code => code === 'SQLITE_TRANSACTION_BUSY_CONTEXT').length,
      0
    );

    assert.equal(
      busyCodes.filter(code => code === 'WP_B_EXECUTION_IDEMPOTENCY_CONFLICT').length,
      0
    );

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];

      assert.equal(
        result.executionId,
        `execution-session-restore-${index + 1}`
      );

      assert.equal(result.operationKind, 'SESSION_RESTORE');

      assert.equal(
        result.ownerId,
        token.instanceId
      );

      assert.ok(Number(result.generation) >= 1);
    }

    const persistedCount = Number(
      store.db.prepare(`
        SELECT COUNT(*) AS count
        FROM durable_executions
        WHERE operation_kind='SESSION_RESTORE'
      `).get().count
    );

    assert.equal(persistedCount, 3);

    const finalSnapshot = store.transactions.snapshot();

    assert.equal(finalSnapshot.depth, 0);
    assert.equal(finalSnapshot.pendingAsyncRoots, 0);
    assert.equal(finalSnapshot.queued, false);

    console.log(JSON.stringify({
      prepared: prepared.length,
      claimed: claimed.length,
      persistedSessionRestoreCount: persistedCount,
      sqliteTransactionBusyContextCount:
        busyCodes.filter(code => code === 'SQLITE_TRANSACTION_BUSY_CONTEXT').length,
      wpBExecutionIdempotencyConflictCount:
        busyCodes.filter(code => code === 'WP_B_EXECUTION_IDEMPOTENCY_CONFLICT').length,
      documentRevision: document.revision,
      finalCoordinatorSnapshot: finalSnapshot
    }, null, 2));

  } finally {
    try {
      broker?.close();
    } catch (_) {}

    try {
      host?.close();
    } catch (_) {}

    try {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      });
    } catch (_) {}
  }
});
