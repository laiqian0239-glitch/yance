'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AccountManager } = require('../../../services/accountManager');

function restorableAccount() {
  return Object.freeze({
    id: 'account-existing-data-1',
    platform: 'whatsapp',
    lifecycleState: 'active',
    credentialRef: 'credential-existing-data-1',
    sessionGeneration: 2,
    sessionReference: 'session-existing-data-2',
    metadata: Object.freeze({})
  });
}

function idempotentExecutionAuthority() {
  const byKey = new Map();
  const calls = [];
  return Object.freeze({
    calls,
    createExecution(input) {
      calls.push(input);
      const previous = byKey.get(input.idempotencyKey);
      if (previous) {
        if (previous.traceId !== input.traceId) {
          const error = new Error('same durable session restore key changed trace identity');
          error.code = 'WP_B_EXECUTION_IDEMPOTENCY_CONFLICT';
          throw error;
        }
        return previous.receipt;
      }
      const receipt = Object.freeze({ executionId: 'execution-existing-data-1' });
      byKey.set(input.idempotencyKey, Object.freeze({ traceId: input.traceId, receipt }));
      return receipt;
    }
  });
}

test('M2-SES-012 repeated startup restore keeps the canonical trace identity for existing durable work', () => {
  const account = restorableAccount();
  const executionAuthority = idempotentExecutionAuthority();
  const intentCalls = [];
  const manager = new AccountManager({
    accountList: () => Object.freeze([account]),
    accountReader: id => id === account.id ? account : null,
    durableExecutionAuthority: executionAuthority,
    outboxAuthority: Object.freeze({
      createIntent(input) {
        intentCalls.push(input);
        return Object.freeze({ intentId: 'intent-existing-data-1' });
      }
    }),
    issueTimestamp: () => '2026-08-30T15:13:59.972Z'
  });

  const compositionPass = manager.requestPersistedSessionRestores({
    traceId: 'runtime-composition-startup'
  });
  const postMigrationPass = manager.requestPersistedSessionRestores({
    authorityTimestamp: '2026-08-30T15:14:00.002Z'
  });

  assert.equal(compositionPass.length, 1);
  assert.equal(postMigrationPass.length, 1);
  assert.equal(executionAuthority.calls.length, 2);
  assert.equal(
    executionAuthority.calls[0].idempotencyKey,
    executionAuthority.calls[1].idempotencyKey,
    'same account-generation restore must keep the same durable idempotency key'
  );
  assert.equal(executionAuthority.calls[0].traceId, 'runtime-composition-startup');
  assert.equal(executionAuthority.calls[1].traceId, 'runtime-composition-startup');
  assert.equal(intentCalls.length, 2);
});

test('M2-SES-013 explicit one-off restore still preserves the caller trace id', () => {
  const account = restorableAccount();
  const calls = [];
  const manager = new AccountManager({
    accountReader: id => id === account.id ? account : null,
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(input);
        return Object.freeze({ executionId: 'execution-explicit-trace' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent() {
        return Object.freeze({ intentId: 'intent-explicit-trace' });
      }
    })
  });

  manager.requestSessionRestore({
    accountId: account.id,
    requestedSessionGeneration: 2,
    credentialReference: account.credentialRef,
    sessionReference: account.sessionReference,
    traceId: 'manual-restore-trace'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].traceId, 'manual-restore-trace');
});
