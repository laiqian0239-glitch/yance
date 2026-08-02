'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const contextPath = path.join(repoRoot, 'backend', 'services', 'authorityTransactionContext.js');
const guardPath = path.join(repoRoot, 'backend', 'services', 'externalIoBoundaryGuard.js');

function loadBoundaries() {
  assert.ok(fs.existsSync(contextPath), 'backend/services/authorityTransactionContext.js must exist before A3 can be green');
  assert.ok(fs.existsSync(guardPath), 'backend/services/externalIoBoundaryGuard.js must exist before A3 can be green');
  delete require.cache[require.resolve(contextPath)];
  delete require.cache[require.resolve(guardPath)];
  return {
    context: require(contextPath),
    guard: require(guardPath)
  };
}

function transactionContext(overrides = {}) {
  return {
    commandId: 'cmd-io-1',
    authorityScope: 'TestAuthority',
    startedAtMs: 1_700_000_000_000,
    hostGeneration: 7,
    fencingToken: 11,
    ...overrides
  };
}

test('all registered external IO kinds are allowed outside and rejected inside an authority write transaction', () => {
  const { context, guard } = loadBoundaries();
  const kinds = [
    'network',
    'provider-sdk',
    'platform-sdk',
    'filesystem-transfer',
    'child-process',
    'user-wait',
    'timer-wait'
  ];
  for (const kind of kinds) assert.equal(guard.assertExternalIoAllowed(kind), true);

  context.runWithAuthorityWriteTransaction(transactionContext(), () => {
    assert.equal(context.isAuthorityWriteTransactionActive(), true);
    assert.deepEqual(context.currentAuthorityWriteTransaction(), transactionContext());
    for (const kind of kinds) {
      assert.throws(
        () => guard.assertExternalIoAllowed(kind),
        error => error?.code === 'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN'
          && error?.kind === kind
          && error?.commandId === 'cmd-io-1'
          && error?.hostGeneration === 7
          && error?.fencingToken === 11
      );
    }
  });
  assert.equal(context.isAuthorityWriteTransactionActive(), false);
  assert.equal(context.currentAuthorityWriteTransaction(), null);
});

test('transaction context survives await boundaries and clears only after async work settles', async () => {
  const { context, guard } = loadBoundaries();
  await context.runWithAuthorityWriteTransaction(transactionContext({ commandId: 'cmd-async-context' }), async () => {
    await Promise.resolve();
    assert.equal(context.currentAuthorityWriteTransaction()?.commandId, 'cmd-async-context');
    assert.throws(
      () => guard.assertExternalIoAllowed('network'),
      error => error?.code === 'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN'
    );
  });
  assert.equal(context.currentAuthorityWriteTransaction(), null);
  assert.equal(guard.assertExternalIoAllowed('network'), true);
});

test('context clears after synchronous and asynchronous failures without leaking authority', async () => {
  const { context, guard } = loadBoundaries();
  assert.throws(
    () => context.runWithAuthorityWriteTransaction(transactionContext({ commandId: 'cmd-sync-fail' }), () => {
      throw new Error('sync-failure');
    }),
    /sync-failure/
  );
  assert.equal(context.currentAuthorityWriteTransaction(), null);

  await assert.rejects(
    context.runWithAuthorityWriteTransaction(transactionContext({ commandId: 'cmd-async-fail' }), async () => {
      await Promise.resolve();
      throw new Error('async-failure');
    }),
    /async-failure/
  );
  assert.equal(context.currentAuthorityWriteTransaction(), null);
  assert.equal(guard.assertExternalIoAllowed('provider-sdk'), true);
});

test('invalid or nested conflicting transaction contexts fail closed', () => {
  const { context } = loadBoundaries();
  for (const invalid of [
    transactionContext({ commandId: '' }),
    transactionContext({ authorityScope: '' }),
    transactionContext({ startedAtMs: NaN }),
    transactionContext({ hostGeneration: 0 }),
    transactionContext({ fencingToken: 0 })
  ]) {
    assert.throws(
      () => context.runWithAuthorityWriteTransaction(invalid, () => true),
      error => error?.code === 'AUTHORITY_TRANSACTION_CONTEXT_INVALID'
    );
  }

  context.runWithAuthorityWriteTransaction(transactionContext(), () => {
    assert.throws(
      () => context.runWithAuthorityWriteTransaction(transactionContext({ commandId: 'different-command' }), () => true),
      error => error?.code === 'AUTHORITY_TRANSACTION_CONTEXT_CONFLICT'
    );
  });
});

test('unknown IO kinds cannot be silently treated as safe', () => {
  const { guard } = loadBoundaries();
  for (const kind of ['', 'unknown', 'http-temporary-bypass']) {
    assert.throws(
      () => guard.assertExternalIoAllowed(kind),
      error => error?.code === 'EXTERNAL_IO_KIND_UNREGISTERED'
    );
  }
});
