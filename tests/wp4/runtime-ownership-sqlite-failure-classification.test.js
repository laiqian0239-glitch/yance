'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeOwnership } = require('../../backend/runtime/RuntimeOwnership');
const { buildBootFailureLifecycleMessage, sanitizeParentLifecycleMessage } = require('../../backend/bootstrap/parentLifecycleChannel');

function mutex() {
  return {
    async acquire() {},
    async release() {},
    snapshot() { return { acquired: true }; }
  };
}

function sqliteError(message, errcode = 1) {
  const error = new Error(message);
  error.code = 'ERR_SQLITE_ERROR';
  error.errcode = errcode;
  error.errstr = errcode === 5 ? 'database is locked' : 'SQL logic error';
  return error;
}

async function rejected(error, options = {}) {
  const owner = new RuntimeOwnership({
    dataRoot: options.dataRoot || process.cwd(),
    dbPath: options.dbPath || require('node:path').join(process.cwd(), 'tmp-runtime-owner.db'),
    buildId: 'b34-test',
    mutex: mutex(),
    sqliteAcquireRetryDelaysMs: options.retryDelays || [],
    storeFactory: () => { throw error; }
  });
  try {
    await owner.acquire();
    assert.fail('expected acquire to reject');
  } catch (candidate) {
    return candidate;
  }
}

test('SQLite ownership failures map to fixed safe boot reason codes and subphases', async () => {
  const cases = [
    [sqliteError('database is locked', 5), 'BOOT_SQLITE_BUSY_OR_LOCKED'],
    [sqliteError('unable to open database file', 14), 'BOOT_SQLITE_CANNOT_OPEN'],
    [sqliteError('attempt to write a readonly database', 8), 'BOOT_SQLITE_READ_ONLY'],
    [sqliteError('no such table: runtime_fencing_counter', 1), 'BOOT_SQLITE_SCHEMA_MISSING'],
    [sqliteError('duplicate column name: generation', 1), 'BOOT_SQLITE_SCHEMA_MISMATCH'],
    [sqliteError('cannot start a transaction within a transaction', 1), 'BOOT_SQLITE_TRANSACTION_STATE_INVALID'],
    [sqliteError('near "BROKEN": syntax error', 1), 'BOOT_SQLITE_LOGIC_FAILED']
  ];
  for (const [input, reasonCode] of cases) {
    const error = await rejected(input);
    assert.equal(error.reasonCode, reasonCode);
    assert.equal(error.failedPhase, 'ownership_store_open');
    const payload = sanitizeParentLifecycleMessage(buildBootFailureLifecycleMessage(error, { pid: 1 }));
    assert.equal(payload.reasonCode, reasonCode);
    assert.equal(payload.runtimeSubphase, 'ownership_store_open');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'details'), false);
  }
});

test('busy SQLite ownership open is retried with a bounded attempt count', async () => {
  let calls = 0;
  const store = {
    acquireLease() { return { fencingToken: 1, heartbeatAtUtc: '', leaseExpiresAtUtc: '' }; },
    close() {}
  };
  const owner = new RuntimeOwnership({
    dataRoot: process.cwd(),
    dbPath: require('node:path').join(process.cwd(), 'tmp-runtime-owner-retry.db'),
    buildId: 'b34-retry',
    mutex: mutex(),
    sqliteAcquireRetryDelaysMs: [0, 0],
    storeFactory: () => {
      calls += 1;
      if (calls < 3) throw sqliteError('database is locked', 5);
      return store;
    }
  });
  const snapshot = await owner.acquire();
  assert.equal(snapshot.acquired, true);
  assert.equal(calls, 3);
  await owner.release();
});

test('non-busy SQLite logic failures are not retried', async () => {
  let calls = 0;
  const owner = new RuntimeOwnership({
    dataRoot: process.cwd(),
    dbPath: require('node:path').join(process.cwd(), 'tmp-runtime-owner-no-retry.db'),
    buildId: 'b34-no-retry',
    mutex: mutex(),
    sqliteAcquireRetryDelaysMs: [0, 0, 0],
    storeFactory: () => { calls += 1; throw sqliteError('no such table: runtime_fencing_counter', 1); }
  });
  await assert.rejects(() => owner.acquire(), error => error.reasonCode === 'BOOT_SQLITE_SCHEMA_MISSING');
  assert.equal(calls, 1);
});
