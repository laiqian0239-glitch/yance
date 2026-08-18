'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function outboxModule() {
  return require('../../../services/externalActionOutboxAuthority');
}

function dispatcherModule() {
  return require('../../../services/externalActionDispatcher');
}

test('external action outbox exposes immutable intent, claim, attempt and receipt authority', () => {
  const { ExternalActionOutboxAuthority } = outboxModule();
  for (const method of [
    'createIntent', 'claimIntent', 'startAttempt', 'recordReceipt',
    'recordFailureReceipt', 'markUncertain', 'recordReconciliation', 'recordLateResult'
  ]) assert.equal(typeof ExternalActionOutboxAuthority.prototype[method], 'function', method);
});

test('intent command canonicalization is stable and deeply immutable', () => {
  const { normalizeIntentCommand } = outboxModule();
  const left = normalizeIntentCommand({
    executionId: 'execution-1',
    actionKind: 'MESSAGE_SEND',
    idempotencyKey: 'intent-key-1',
    payload: { recipient: 'r-1', options: { urgent: true }, parts: ['a', 'b'] }
  });
  const right = normalizeIntentCommand({
    idempotencyKey: 'intent-key-1',
    payload: { parts: ['a', 'b'], options: { urgent: true }, recipient: 'r-1' },
    actionKind: 'MESSAGE_SEND',
    executionId: 'execution-1'
  });

  assert.equal(left.intentContentSha256, right.intentContentSha256);
  assert.match(left.intentContentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(left.contentHashVersion, 1);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.payload), true);
  assert.equal(Object.isFrozen(left.payload.options), true);
  assert.equal(Object.isFrozen(left.payload.parts), true);
  assert.throws(() => { left.payload.options.urgent = false; }, TypeError);
});

test('outbox source persists an attempt before physical I/O can be invoked', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../../services/externalActionDispatcher'), 'utf8');
  const persistAt = source.indexOf('startAttempt');
  const performAt = source.indexOf('.perform(');
  assert.ok(persistAt >= 0, 'startAttempt missing');
  assert.ok(performAt >= 0, 'physical Adapter invocation missing');
  assert.ok(persistAt < performAt, 'attempt must be persisted before I/O');
});

test('dispatcher performs physical I/O only after a persisted attempt and then records success', async () => {
  const { ExternalActionDispatcher } = dispatcherModule();
  const calls = [];
  const authority = {
    startAttempt(input) {
      calls.push(['startAttempt', input]);
      return Object.freeze({ attemptId: 'attempt-1', intentId: input.intentId });
    },
    recordReceipt(input) {
      calls.push(['recordReceipt', input]);
      return Object.freeze({ receiptId: 'receipt-1', receiptType: 'SUCCESS' });
    },
    recordFailureReceipt() { throw new Error('unexpected failure receipt'); },
    markUncertain() { throw new Error('unexpected uncertain receipt'); }
  };
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: authority,
    adapter: {
      async perform(input) {
        calls.push(['perform', input]);
        return {
          providerReceiptId: 'provider-1',
          evidenceReference: 'provider:provider-1',
          result: { accepted: true }
        };
      }
    },
    issueTimestamp: purpose => `2026-08-03T03:10:0${purpose === 'external-action-attempt' ? '0' : '1'}.000Z`
  });

  const result = await dispatcher.dispatch({
    intentId: 'intent-1',
    ownerId: 'dispatcher-1',
    claimId: 'claim-1',
    generation: 1,
    hostGeneration: 2,
    fencingToken: 3,
    stateVersion: 1,
    request: { bodyReference: 'body-ref-1' }
  });

  assert.deepEqual(calls.map(item => item[0]), ['startAttempt', 'perform', 'recordReceipt']);
  assert.equal(result.receiptType, 'SUCCESS');
});

test('unknown physical outcome is never converted to an ordinary failure receipt', async () => {
  const { ExternalActionDispatcher } = dispatcherModule();
  const calls = [];
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: {
      startAttempt() {
        calls.push('startAttempt');
        return Object.freeze({ attemptId: 'attempt-unknown', intentId: 'intent-unknown' });
      },
      recordReceipt() { throw new Error('unexpected success receipt'); },
      recordFailureReceipt() { calls.push('recordFailureReceipt'); },
      markUncertain(input) {
        calls.push('markUncertain');
        return Object.freeze({ receiptType: 'UNKNOWN', evidenceReference: input.evidenceReference });
      }
    },
    adapter: {
      async perform() {
        calls.push('perform');
        throw Object.assign(new Error('connection lost after write'), {
          remoteOutcomeUnknown: true,
          evidenceReference: 'network:connection-lost-after-write'
        });
      }
    },
    issueTimestamp: () => '2026-08-03T03:11:00.000Z'
  });

  const result = await dispatcher.dispatch({
    intentId: 'intent-unknown',
    ownerId: 'dispatcher-1',
    claimId: 'claim-unknown',
    generation: 1,
    hostGeneration: 2,
    fencingToken: 3,
    stateVersion: 1,
    request: { bodyReference: 'body-ref-2' }
  });

  assert.deepEqual(calls, ['startAttempt', 'perform', 'markUncertain']);
  assert.equal(result.receiptType, 'UNKNOWN');
});

test('post-call canonicalization failure is marked uncertain and never recorded as failure', async () => {
  const { ExternalActionDispatcher } = dispatcherModule();
  const calls = [];
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: {
      startAttempt(input) {
        calls.push('startAttempt');
        return Object.freeze({
          attemptId: 'attempt-post-call-canonical',
          intentId: input.intentId,
          stateVersion: 2,
          generation: 1,
          ownerId: input.ownerId
        });
      },
      recordReceipt() {
        calls.push('recordReceipt');
        throw new Error('recordReceipt must not run after canonicalization failure');
      },
      recordFailureReceipt() {
        calls.push('recordFailureReceipt');
        throw new Error('post-call canonicalization failure must not become ordinary failure');
      },
      markUncertain(input) {
        calls.push('markUncertain');
        return Object.freeze({ receiptType: 'UNKNOWN', evidenceReference: input.evidenceReference });
      }
    },
    adapter: {
      async perform() {
        calls.push('perform');
        return {
          providerReceiptId: 'provider-post-call-canonical',
          evidenceReference: 'provider:post-call-canonical',
          result: { unsupported: 1n }
        };
      }
    },
    issueTimestamp: () => '2026-08-03T03:11:30.000Z'
  });

  const result = await dispatcher.dispatch({
    intentId: 'intent-post-call-canonical',
    ownerId: 'dispatcher-1',
    claimId: 'claim-post-call-canonical',
    generation: 1,
    hostGeneration: 2,
    fencingToken: 3,
    stateVersion: 1,
    request: { bodyReference: 'body-ref-post-call-canonical' }
  });

  assert.deepEqual(calls, ['startAttempt', 'perform', 'markUncertain']);
  assert.equal(result.receiptType, 'UNKNOWN');
});

test('success receipt persistence failure is marked uncertain and never recorded as failure', async () => {
  const { ExternalActionDispatcher } = dispatcherModule();
  const calls = [];
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: {
      startAttempt(input) {
        calls.push('startAttempt');
        return Object.freeze({
          attemptId: 'attempt-post-call-receipt',
          intentId: input.intentId,
          stateVersion: 2,
          generation: 1,
          ownerId: input.ownerId
        });
      },
      recordReceipt() {
        calls.push('recordReceipt');
        throw Object.assign(new Error('success receipt CAS rejected'), {
          code: 'WP_B_OUTBOX_RECEIPT_CAS_REJECTED'
        });
      },
      recordFailureReceipt() {
        calls.push('recordFailureReceipt');
        throw new Error('post-call receipt failure must not become ordinary failure');
      },
      markUncertain(input) {
        calls.push('markUncertain');
        return Object.freeze({ receiptType: 'UNKNOWN', evidenceReference: input.evidenceReference });
      }
    },
    adapter: {
      async perform() {
        calls.push('perform');
        return {
          providerReceiptId: 'provider-post-call-receipt',
          evidenceReference: 'provider:post-call-receipt',
          result: { accepted: true }
        };
      }
    },
    issueTimestamp: () => '2026-08-03T03:11:45.000Z'
  });

  const result = await dispatcher.dispatch({
    intentId: 'intent-post-call-receipt',
    ownerId: 'dispatcher-1',
    claimId: 'claim-post-call-receipt',
    generation: 1,
    hostGeneration: 2,
    fencingToken: 3,
    stateVersion: 1,
    request: { bodyReference: 'body-ref-post-call-receipt' }
  });

  assert.deepEqual(calls, ['startAttempt', 'perform', 'recordReceipt', 'markUncertain']);
  assert.equal(result.receiptType, 'UNKNOWN');
});

test('attempt persistence failure prevents physical I/O', async () => {
  const { ExternalActionDispatcher } = dispatcherModule();
  let performed = false;
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority: {
      startAttempt() {
        throw Object.assign(new Error('CAS rejected'), { code: 'WP_B_OUTBOX_ATTEMPT_CAS_REJECTED' });
      }
    },
    adapter: {
      async perform() { performed = true; }
    },
    issueTimestamp: () => '2026-08-03T03:12:00.000Z'
  });

  await assert.rejects(
    dispatcher.dispatch({
      intentId: 'intent-stale',
      ownerId: 'dispatcher-1',
      claimId: 'claim-stale',
      generation: 1,
      hostGeneration: 2,
      fencingToken: 3,
      stateVersion: 1,
      request: { bodyReference: 'body-ref-3' }
    }),
    error => error?.code === 'WP_B_OUTBOX_ATTEMPT_CAS_REJECTED'
  );
  assert.equal(performed, false);
});

test('intent idempotency key is bound to a canonical content hash', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../../services/externalActionOutboxAuthority'), 'utf8');
  assert.match(source, /intent_content_sha256|intentContentSha256/u);
  assert.match(source, /WP_B_INTENT_IDEMPOTENCY_CONFLICT/u);
  assert.match(source, /content_hash_version|contentHashVersion/u);
});

test('late stale results have a separate append-only receipt path', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../../services/externalActionOutboxAuthority'), 'utf8');
  assert.match(source, /recordLateResult/u);
  assert.match(source, /LATE_RESULT/u);
});

test('dispatcher binds persisted attempt and receipt to durable execution WAITING_REMOTE and terminal CAS', async () => {
  const { ExternalActionDispatcher } = dispatcherModule();
  const calls = [];
  const executionAuthority = {
    transition(input) {
      calls.push(['transition', input.targetState, input.stateVersion]);
      return Object.freeze({
        executionId: input.executionId,
        state: input.targetState,
        stateVersion: input.stateVersion + 1,
        generation: input.generation,
        ownerId: input.ownerId,
        claimId: input.claimId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken
      });
    }
  };
  const dispatcher = new ExternalActionDispatcher({
    executionAuthority,
    outboxAuthority: {
      startAttempt(input) {
        calls.push(['startAttempt', input.intentId]);
        return Object.freeze({
          attemptId: 'attempt-session-restore-1',
          intentId: input.intentId,
          stateVersion: 2,
          generation: input.generation,
          ownerId: input.ownerId
        });
      },
      recordReceipt(input) {
        calls.push(['recordReceipt', input.attemptId]);
        return Object.freeze({ receiptId: 'receipt-session-restore-1', receiptType: 'SUCCESS' });
      },
      recordFailureReceipt() { throw new Error('unexpected failure receipt'); },
      markUncertain() { throw new Error('unexpected uncertain receipt'); }
    },
    adapter: Object.freeze({
      operationKind: 'SESSION_RESTORE',
      async perform(input) {
        calls.push(['perform', input.attemptId]);
        return Object.freeze({
          providerReceiptId: 'provider-session-restore-1',
          evidenceReference: 'session-restore:provider-session-restore-1',
          result: Object.freeze({ state: 'RESTORED' })
        });
      }
    }),
    issueTimestamp: purpose => ({
      'external-action-attempt': '2026-08-18T00:00:00.000Z',
      'external-action-waiting-remote': '2026-08-18T00:00:01.000Z',
      'external-action-success-receipt': '2026-08-18T00:00:02.000Z',
      'external-action-terminal-success': '2026-08-18T00:00:03.000Z'
    })[purpose] || '2026-08-18T00:00:04.000Z'
  });

  const receipt = await dispatcher.dispatch({
    executionId: 'execution-session-restore-1',
    executionStateVersion: 4,
    executionGeneration: 2,
    intentId: 'intent-session-restore-1',
    idempotencyKey: 'session-restore:whatsapp:account-1:1:hash',
    ownerId: 'authority-host-1',
    hostId: 'authority-host-1',
    claimId: 'claim-session-restore-1',
    generation: 1,
    hostGeneration: 7,
    fencingToken: 19,
    stateVersion: 1,
    leaseExpiresAt: '2026-08-18T00:02:00.000Z',
    request: { platform: 'whatsapp', accountReference: 'account-1' }
  });

  assert.equal(receipt.receiptType, 'SUCCESS');
  assert.deepEqual(calls.map(call => call[0] === 'transition' ? `${call[0]}:${call[1]}` : call[0]), [
    'startAttempt',
    'transition:WAITING_REMOTE',
    'perform',
    'recordReceipt',
    'transition:SUCCEEDED'
  ]);
  assert.deepEqual(calls.filter(call => call[0] === 'transition').map(call => call[2]), [4, 5]);
});

test('external action settlement is owned by durable execution authority and retry re-arm stays in outbox authority', () => {
  const { DurableExecutionAuthority } = require('../../../services/durableExecutionAuthority');
  const { ExternalActionOutboxAuthority } = outboxModule();
  assert.equal(typeof DurableExecutionAuthority.prototype.settleExternalAttempt, 'function');
  assert.equal(typeof ExternalActionOutboxAuthority.prototype.rearmRetry, 'function');
});
