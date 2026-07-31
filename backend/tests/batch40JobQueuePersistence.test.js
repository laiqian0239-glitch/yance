'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { JobQueue } = require('../services/jobQueue');
const { getStore, closeStore } = require('../repositories/storeProvider');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test.after(() => {
  try { closeStore(); } catch (_) {}
});

test('a physical persistence write failure degrades the queue and blocks later work', async () => {
  let writeCount = 0;
  let laterTaskStarted = false;
  const queue = new JobQueue({
    concurrency: 1,
    name: 'b40-persistence-write-failure',
    physicalPersistence: {
      write() {
        writeCount += 1;
        if (writeCount === 1) {
          throw Object.assign(new Error('disk unavailable'), { code: 'SQLITE_IOERR' });
        }
      },
      async probe() { return { ok: true }; },
      async listUnresolved() { return []; },
      async reconcile() { return []; }
    }
  });

  const current = queue.add(async () => 'current-settled', {
    providerKey: 'provider-a'
  });
  await assert.rejects(current.promise, error =>
    error.code === 'AI_RUNTIME_PERSISTENCE_DEGRADED'
  );

  const health = queue.status().persistenceHealth;
  assert.equal(health.state, 'degraded');
  assert.match(health.firstFailedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(health.lastErrorCode, 'SQLITE_IOERR');
  assert.equal(health.retryCount, 1);
  assert.equal(health.recoveryStage, '');

  const later = queue.add(async () => {
    laterTaskStarted = true;
    return 'must-not-run';
  }, {
    providerKey: 'provider-a'
  });
  await assert.rejects(later.promise, error =>
    error.code === 'AI_RUNTIME_PERSISTENCE_DEGRADED'
    && error.retryable === true
  );
  await queue._drain();
  await delay(10);
  assert.equal(laterTaskStarted, false);
  assert.equal(queue.status().running.length, 0);
});

test('missing default SQLite persistence authority blocks execution fail-closed', async () => {
  let taskStarted = false;
  const queue = new JobQueue({
    concurrency: 1,
    name: 'b40-missing-default-persistence'
  });
  queue.physicalStore = () => null;

  const job = queue.add(async () => {
    taskStarted = true;
    return 'ran-without-ledger';
  }, { providerKey: 'provider-a' });

  await assert.rejects(job.promise, error =>
    error.code === 'AI_RUNTIME_PERSISTENCE_DEGRADED'
  );
  assert.equal(taskStarted, false);
  assert.equal(queue.status().persistenceHealth.state, 'degraded');
});

test('a physical execution identity rebind write failure degrades the queue', async () => {
  let laterTaskStarted = false;
  const queue = new JobQueue({
    concurrency: 1,
    name: 'b40-persistence-rebind-failure',
    physicalPersistence: {
      write() {},
      async probe() { return { ok: true }; },
      async listUnresolved() { return []; },
      async reconcile() { return []; }
    }
  });
  queue.physicalStore = () => ({
    db: {
      prepare() {
        return {
          run() {
            throw Object.assign(new Error('execution identity rebind failed'), {
              code: 'SQLITE_IOERR_REBIND'
            });
          }
        };
      }
    }
  });

  const current = queue.add(async ({ bindExecution }) => {
    bindExecution({ executionId: 'provider-execution-1', providerKey: 'provider-a' });
    return 'current-settled';
  }, {
    providerKey: 'provider-a'
  });
  await assert.rejects(current.promise, error =>
    error.code === 'SQLITE_IOERR_REBIND'
  );

  const health = queue.status().persistenceHealth;
  assert.equal(health.state, 'degraded');
  assert.equal(health.lastErrorCode, 'SQLITE_IOERR_REBIND');
  assert.equal(health.retryCount, 1);

  const later = queue.add(async () => {
    laterTaskStarted = true;
    return 'must-not-run';
  }, {
    providerKey: 'provider-a'
  });
  await assert.rejects(later.promise, error =>
    error.code === 'AI_RUNTIME_PERSISTENCE_DEGRADED'
  );
  assert.equal(laterTaskStarted, false);
});

test('probe success cannot reopen until every unknown execution has a matching verified receipt', async () => {
  let failWrite = true;
  let reconciliationReceipts = [];
  const unresolved = [{
    executionId: 'physical-execution-1',
    generation: 'generation-1',
    providerKey: 'provider-a',
    state: 'physical-running'
  }];
  const queue = new JobQueue({
    concurrency: 1,
    name: 'b40-persistence-reconciliation',
    physicalPersistence: {
      write() {
        if (failWrite) {
          failWrite = false;
          throw Object.assign(new Error('write lost'), { code: 'PERSISTENCE_WRITE_LOST' });
        }
      },
      async probe() { return { ok: true }; },
      async listUnresolved() { return unresolved; },
      async reconcile() { return reconciliationReceipts; }
    }
  });

  const current = queue.add(async () => 'settled');
  await assert.rejects(current.promise, error =>
    error.code === 'AI_RUNTIME_PERSISTENCE_DEGRADED'
  );

  reconciliationReceipts = [{
    terminated: true,
    executionId: 'another-execution',
    exitCode: 0,
    signal: ''
  }];
  await assert.rejects(queue.recoverPersistence(), error =>
    error.code === 'AI_RUNTIME_RECONCILIATION_REQUIRED'
  );
  let health = queue.status().persistenceHealth;
  assert.equal(health.state, 'degraded');
  assert.equal(health.lastErrorCode, 'AI_RUNTIME_RECONCILIATION_REQUIRED');
  assert.deepEqual(health.unresolved, [{
    executionId: 'physical-execution-1',
    generation: 'generation-1',
    providerKey: 'provider-a',
    state: 'UNKNOWN'
  }]);

  reconciliationReceipts = [{
    terminated: true,
    executionId: 'physical-execution-1',
    exitCode: null,
    signal: 'SIGTERM'
  }];
  const recovered = await queue.recoverPersistence();
  assert.equal(recovered.recovered, true);
  health = queue.status().persistenceHealth;
  assert.deepEqual(health, {
    state: 'healthy',
    firstFailedAt: '',
    lastErrorCode: '',
    retryCount: 0,
    unresolved: [],
    recoveryStage: ''
  });

  const later = queue.add(async () => 'reopened');
  assert.equal(await later.promise, 'reopened');
});

test('default SQLite recovery does not declare a previous physical execution terminated without a receipt', async () => {
  const queueName = `b40-default-reconciliation-${Date.now()}`;
  const store = getStore();
  const at = new Date().toISOString();
  store.db.prepare(`INSERT INTO ai_provider_physical_execution_state(
    execution_id,queue_name,provider_key,generation,job_id,state,logical_state,
    started_at,deadline_at,finished_at,last_error_code,metadata_json,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'previous-physical-execution',
    queueName,
    'provider-a',
    'previous-generation',
    'previous-job',
    'physical-running',
    'running',
    at,
    '',
    '',
    '',
    '{}',
    at
  );

  const originalPrepare = store.db.prepare.bind(store.db);
  store.db.prepare = sql => {
    if (String(sql).includes('INSERT INTO ai_provider_physical_execution_state')) {
      throw Object.assign(new Error('simulated persistence write loss'), {
        code: 'SQLITE_IOERR_WRITE'
      });
    }
    return originalPrepare(sql);
  };

  const queue = new JobQueue({ concurrency: 1, name: queueName });
  try {
    const current = queue.add(async () => 'settled');
    await assert.rejects(current.promise, error =>
      error.code === 'AI_RUNTIME_PERSISTENCE_DEGRADED'
    );
  } finally {
    store.db.prepare = originalPrepare;
  }

  await assert.rejects(queue.recoverPersistence(), error =>
    error.code === 'AI_RUNTIME_RECONCILIATION_REQUIRED'
  );
  assert.deepEqual(queue.status().persistenceHealth.unresolved, [{
    executionId: 'previous-physical-execution',
    generation: 'previous-generation',
    providerKey: 'provider-a',
    state: 'UNKNOWN'
  }]);
});
