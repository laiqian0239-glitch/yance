'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const compositionPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeComposition.js');
const EXPECTED_OPERATION_KINDS = Object.freeze([
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);

function frozenAttemptEnvelope(overrides = {}) {
  return Object.freeze({
    executionId: 'm2-review-execution-1',
    intentId: 'm2-review-intent-1',
    attemptId: 'm2-review-attempt-1',
    claimId: 'm2-review-claim-1',
    ownerId: 'm2-review-owner-1',
    generation: 3,
    hostGeneration: 7,
    fencingToken: 11,
    idempotencyKey: 'm2-review-idempotency-1',
    request: Object.freeze({
      platform: 'whatsapp',
      accountReference: 'account-review-1',
      commandReference: 'command-review-1',
      credentialReference: 'credential-review-1',
      requestContentSha256: 'a'.repeat(64)
    }),
    ...overrides
  });
}

function frozenAdapter(operationKind) {
  return Object.freeze({
    operationKind,
    async perform() { return Object.freeze({ status: 'performed' }); },
    async reconcile() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
  });
}

test('M2-IR-001 outbound Adapter preserves the complete persisted fencing identity at the physical client boundary', async () => {
  const { createOutboundMessageSendOperation } = require('../../../services/durableOperations/outboundMessageSendOperation');
  const { createChannelPhysicalClient } = require('../../../services/channelRuntimeEngine');
  const physicalCalls = [];
  const facade = Object.freeze({
    platform: 'whatsapp',
    egress: Object.freeze({
      async execute(input) {
        physicalCalls.push(input);
        return Object.freeze({
          accepted: true,
          platformMessageId: 'platform-review-1',
          providerRequestId: 'provider-review-1',
          evidenceReference: 'review:outbound:1'
        });
      }
    }),
    reconcile: Object.freeze({
      async execute(input) {
        physicalCalls.push(input);
        return Object.freeze({
          outcome: 'REMOTE_RESULT_UNKNOWN',
          evidenceReference: 'review:outbound:lookup:1'
        });
      }
    })
  });
  const command = Object.freeze({ body: 'ephemeral-command-capability' });
  const credential = Object.freeze({ session: 'ephemeral-credential-capability' });
  const adapter = createOutboundMessageSendOperation({
    resolveCommandReference() { return command; },
    resolveCredentialReference() { return credential; },
    channelClient: createChannelPhysicalClient({ platform: 'whatsapp', facade })
  });

  const receipt = await adapter.perform(frozenAttemptEnvelope());
  assert.equal(receipt.accepted, true);
  assert.equal(physicalCalls.length, 1);
  assert.deepEqual(
    Object.fromEntries([
      'executionId',
      'intentId',
      'attemptId',
      'claimId',
      'ownerId',
      'generation',
      'hostGeneration',
      'fencingToken'
    ].map(field => [field, physicalCalls[0][field]])),
    {
      executionId: 'm2-review-execution-1',
      intentId: 'm2-review-intent-1',
      attemptId: 'm2-review-attempt-1',
      claimId: 'm2-review-claim-1',
      ownerId: 'm2-review-owner-1',
      generation: 3,
      hostGeneration: 7,
      fencingToken: 11
    }
  );
});

test('M2-IR-002 production composition builds one sealed registry containing all six mandatory Adapters', () => {
  delete require.cache[require.resolve('../../../runtime/AppRuntimeComposition')];
  const composition = require('../../../runtime/AppRuntimeComposition');
  assert.equal(
    typeof composition.createDurableOperationRuntimeRegistry,
    'function',
    'production composition must expose one six-Adapter registry constructor'
  );
  const adapters = Object.fromEntries(
    EXPECTED_OPERATION_KINDS.map(operationKind => [operationKind, frozenAdapter(operationKind)])
  );
  const runtime = composition.createDurableOperationRuntimeRegistry({ adapters });
  assert.ok(runtime && typeof runtime === 'object');
  assert.equal(Object.isFrozen(runtime), true);
  assert.ok(runtime.registry);
  assert.equal(runtime.registry.sealed, true);
  assert.deepEqual(runtime.registry.list(), EXPECTED_OPERATION_KINDS);
  for (const operationKind of EXPECTED_OPERATION_KINDS) {
    assert.equal(runtime.registry.require(operationKind), adapters[operationKind]);
  }

  const source = fs.readFileSync(compositionPath, 'utf8');
  assert.match(source, /createDurableOperationRuntimeRegistry\s*\(/u);
  assert.match(source, /durableOperationRegistry:\s*durableOperationRuntime\.registry/u);
});

test('M2-IR-003 dispatcher persists an attempt before touching the Adapter and routes unknown outcomes only to uncertain state', async () => {
  const { ExternalActionDispatcher } = require('../../../services/externalActionDispatcher');
  const calls = [];
  const outboxAuthority = Object.freeze({
    startAttempt(input) {
      calls.push(['startAttempt', input.intentId]);
      return Object.freeze({
        attemptId: 'm2-review-dispatch-attempt-1',
        intentId: input.intentId,
        stateVersion: 2,
        generation: input.generation,
        ownerId: input.ownerId,
        claimId: input.claimId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken
      });
    },
    markUncertain(input) {
      calls.push(['markUncertain', input.attemptId]);
      return Object.freeze({ state: 'UNCERTAIN_REMOTE_OUTCOME' });
    },
    recordFailureReceipt() {
      calls.push(['recordFailureReceipt']);
      throw new Error('unknown remote outcome must not become ordinary failure');
    },
    recordReceipt() {
      calls.push(['recordReceipt']);
      throw new Error('unknown remote outcome must not become success');
    }
  });
  const adapter = Object.freeze({
    async perform(input) {
      calls.push(['perform', input.attemptId]);
      throw Object.assign(new Error('remote result unknown'), {
        code: 'UNCERTAIN_REMOTE_OUTCOME',
        remoteOutcomeUnknown: true
      });
    }
  });
  let tick = 0;
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority,
    adapter,
    issueTimestamp() {
      const value = new Date(Date.parse('2026-08-04T04:00:00.000Z') + tick * 1000).toISOString();
      tick += 1;
      return value;
    }
  });
  const result = await dispatcher.dispatch({
    executionId: 'm2-review-dispatch-execution-1',
    intentId: 'm2-review-dispatch-intent-1',
    idempotencyKey: 'm2-review-dispatch-key-1',
    ownerId: 'm2-review-owner-1',
    claimId: 'm2-review-claim-1',
    stateVersion: 1,
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    leaseExpiresAt: '2026-08-04T05:00:00.000Z',
    request: Object.freeze({ reference: 'request-review-1' })
  });
  assert.equal(result.state, 'UNCERTAIN_REMOTE_OUTCOME');
  assert.deepEqual(calls, [
    ['startAttempt', 'm2-review-dispatch-intent-1'],
    ['perform', 'm2-review-dispatch-attempt-1'],
    ['markUncertain', 'm2-review-dispatch-attempt-1']
  ]);
});

test('M2-IR-004 persisted attempts and uncertain states never enter blind recovery retry', () => {
  const {
    DECISIONS,
    decideRecovery
  } = require('../../../services/durableExecutionRecoveryAuthority');
  const authorityTimestamp = '2026-08-04T04:30:00.000Z';
  const base = Object.freeze({
    executionId: 'm2-review-recovery-execution-1',
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    stateVersion: 4,
    generation: 2,
    ownerId: 'stale-owner',
    claimId: 'stale-claim',
    hostGeneration: 3,
    fencingToken: 5,
    leaseExpiresAt: '2026-08-04T04:00:00.000Z',
    deadlineAt: '2026-08-04T06:00:00.000Z'
  });
  const attempted = decideRecovery(
    { ...base, state: 'RUNNING' },
    [{ executionId: base.executionId, intentId: 'intent-1', attemptId: 'attempt-1' }],
    authorityTimestamp
  );
  assert.equal(attempted.decision, DECISIONS.RECONCILE_REQUIRED);
  const uncertain = decideRecovery(
    { ...base, state: 'UNCERTAIN_REMOTE_OUTCOME' },
    [],
    authorityTimestamp
  );
  assert.equal(uncertain.decision, DECISIONS.RECONCILE_REQUIRED);
  const safe = decideRecovery(
    { ...base, state: 'RUNNING' },
    [],
    authorityTimestamp
  );
  assert.equal(safe.decision, DECISIONS.REQUEUE_SAFE);
});
