'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { deepFreeze } = require('../../../lib/deepFreeze');
const { OPERATION_KINDS } = require('../../../services/durableOperationRegistry');
const { CommunicationAuthority } = require('../../../services/communicationAuthority');
const { ChannelAdapterRuntime } = require('../../../services/channelAdapterRuntime');

const operationPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'services',
  'durableOperations',
  'historySynchronizationOperation.js'
);
const HASH = '7'.repeat(64);

function operationModule() {
  assert.equal(
    fs.existsSync(operationPath),
    true,
    'WP_B_M2_HISTORY_SYNCHRONIZATION_OPERATION_REQUIRED'
  );
  delete require.cache[require.resolve(operationPath)];
  return require(operationPath);
}

function historyEnvelope(overrides = {}) {
  const request = deepFreeze({
    platform: 'telegram',
    accountReference: 'account-history-1',
    streamKind: 'messages',
    scopeReference: 'conversation-history-1',
    checkpointReference: 'checkpoint-history-1',
    checkpointVersion: 3,
    cursorReference: 'cursor-history-3',
    requestContentSha256: HASH,
    credentialReference: 'credential-history-1',
    pageSize: 50,
    ...overrides.request
  });
  return deepFreeze({
    executionId: 'execution-history-1',
    intentId: 'intent-history-1',
    attemptId: 'attempt-history-1',
    claimId: 'claim-history-1',
    ownerId: 'owner-history-1',
    generation: 2,
    hostGeneration: 4,
    fencingToken: 9,
    idempotencyKey: 'idempotency-history-1',
    request,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'request'))
  });
}

function historyCommand(overrides = {}) {
  return deepFreeze({
    schemaVersion: 1,
    platform: 'telegram',
    accountReference: 'account-history-1',
    streamKind: 'messages',
    scopeReference: 'conversation-history-1',
    checkpointReference: 'checkpoint-history-1',
    checkpointVersion: 3,
    cursorReference: 'cursor-history-3',
    requestContentSha256: HASH,
    credentialReference: 'credential-history-1',
    pageSize: 50,
    ...overrides
  });
}

function facadeFixture(overrides = {}) {
  return {
    platform: 'telegram',
    contract: () => ({ bindings: {}, boundaries: {} }),
    auth: { execute: async input => input },
    ingress: { normalize: async input => input },
    egress: { execute: async input => ({ accepted: true, input }) },
    reconcile: { execute: async input => ({ outcome: 'REMOTE_RESULT_UNKNOWN', input }) },
    ...overrides
  };
}

function checkpointCapability(order, overrides = {}) {
  let active = false;
  let transactionCount = 0;
  const assertActive = () => assert.equal(active, true, 'checkpoint mutation escaped the single store transaction');
  return Object.freeze({
    transaction(work) {
      assert.equal(active, false, 'nested checkpoint transaction is forbidden');
      transactionCount += 1;
      active = true;
      order.push('transaction:start');
      try {
        return work();
      } finally {
        order.push('transaction:end');
        active = false;
      }
    },
    recordObservation(input) {
      assertActive();
      order.push('recordObservation');
      overrides.onObservation?.(input);
      return Object.freeze({ observationId: 'history-observation-1' });
    },
    advanceCheckpoint(input) {
      assertActive();
      order.push('advanceCheckpoint');
      overrides.onAdvance?.(input);
      return Object.freeze({
        checkpointId: input.checkpointId,
        version: input.expectedVersion + 1,
        cursorReference: input.cursorReference,
        highWatermarkReference: input.highWatermarkReference,
        gapClosed: input.gapClosed
      });
    },
    transactionCount() { return transactionCount; }
  });
}

test('M2-HIS-001 history synchronization Adapter is frozen and owns the exact operation kind', () => {
  const { OPERATION_KIND, createHistorySynchronizationOperation } = operationModule();
  assert.equal(OPERATION_KIND, OPERATION_KINDS.HISTORY_SYNCHRONIZATION);
  const adapter = createHistorySynchronizationOperation({
    resolveCredentialReference: () => Object.freeze({ access: 'ephemeral' }),
    historyClient: Object.freeze({
      async fetchPage() { return Object.freeze({ status: 'PAGE_OBSERVED' }); },
      async compareCursor() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
    })
  });
  assert.equal(adapter.operationKind, OPERATION_KIND);
  assert.equal(typeof adapter.perform, 'function');
  assert.equal(typeof adapter.reconcile, 'function');
  assert.equal(Object.isFrozen(adapter), true);
});

test('M2-HIS-002 perform resolves ephemeral credential and returns only bounded page references', async () => {
  const { createHistorySynchronizationOperation } = operationModule();
  const calls = [];
  const credential = Object.freeze({ token: 'private-history-token' });
  const adapter = createHistorySynchronizationOperation({
    resolveCredentialReference(reference, context) {
      calls.push(['resolve', reference, context.attemptId]);
      return credential;
    },
    historyClient: Object.freeze({
      async fetchPage(input) {
        calls.push(['fetchPage', input.cursorReference, input.credential === credential, input.fencingToken]);
        return Object.freeze({
          status: 'PAGE_OBSERVED',
          segmentReference: 'segment-history-4',
          nextCursorReference: 'cursor-history-4',
          remoteHighWatermark: 'remote-high-watermark-104',
          gapClosed: false,
          providerRequestId: 'provider-request-history-1',
          evidenceReference: 'evidence-history-1',
          messages: [{ body: 'must-not-escape' }],
          authorizationHeader: 'secret-header'
        });
      },
      async compareCursor() { throw new Error('perform must not reconcile'); }
    })
  });

  const result = await adapter.perform(historyEnvelope());
  assert.deepEqual(calls, [
    ['resolve', 'credential-history-1', 'attempt-history-1'],
    ['fetchPage', 'cursor-history-3', true, 9]
  ]);
  assert.deepEqual(result, {
    status: 'PAGE_OBSERVED',
    segmentReference: 'segment-history-4',
    nextCursorReference: 'cursor-history-4',
    remoteHighWatermark: 'remote-high-watermark-104',
    gapClosed: false,
    providerRequestId: 'provider-request-history-1',
    evidenceReference: 'evidence-history-1',
    failureCode: '',
    uncertain: false
  });
  assert.equal(JSON.stringify(result).includes('private-history-token'), false);
  assert.equal(JSON.stringify(result).includes('must-not-escape'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-HIS-003 mutable attempts and inline history content fail before credential or physical I/O', async () => {
  const { createHistorySynchronizationOperation } = operationModule();
  let physicalCalls = 0;
  const adapter = createHistorySynchronizationOperation({
    resolveCredentialReference() {
      throw new Error('invalid attempt must not resolve credential');
    },
    historyClient: Object.freeze({
      async fetchPage() { physicalCalls += 1; },
      async compareCursor() { physicalCalls += 1; }
    })
  });

  await assert.rejects(
    () => adapter.perform({ ...historyEnvelope() }),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );
  for (const field of ['messageBody', 'messages', 'authorizationHeader', 'sessionToken']) {
    await assert.rejects(
      () => adapter.perform(historyEnvelope({ request: { [field]: 'forbidden-inline-history-value' } })),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD'
        || error?.code === 'WP_B_HISTORY_REFERENCE_ONLY_REQUIRED',
      field
    );
  }
  assert.equal(physicalCalls, 0);
});

test('M2-HIS-004 reconciliation compares remote cursor only and preserves unknown outcome', async () => {
  const { createHistorySynchronizationOperation } = operationModule();
  const calls = [];
  const credential = Object.freeze({ access: 'ephemeral-history-reconciliation' });
  const adapter = createHistorySynchronizationOperation({
    resolveCredentialReference(reference) {
      calls.push(['resolve', reference]);
      return credential;
    },
    historyClient: Object.freeze({
      async fetchPage() { calls.push(['fetchPage']); },
      async compareCursor(input) {
        calls.push(['compareCursor', input.checkpointReference, input.credential === credential]);
        return Object.freeze({
          outcome: 'REMOTE_RESULT_UNKNOWN',
          remoteCursorReference: 'remote-cursor-unknown-1',
          remoteHighWatermark: 'remote-high-watermark-unknown-1',
          evidenceReference: 'evidence-history-unknown-1'
        });
      }
    })
  });

  const result = await adapter.reconcile(historyEnvelope());
  assert.deepEqual(calls, [
    ['resolve', 'credential-history-1'],
    ['compareCursor', 'checkpoint-history-1', true]
  ]);
  assert.deepEqual(result, {
    outcome: 'REMOTE_RESULT_UNKNOWN',
    remoteCursorReference: 'remote-cursor-unknown-1',
    remoteHighWatermark: 'remote-high-watermark-unknown-1',
    evidenceReference: 'evidence-history-unknown-1',
    failureCode: ''
  });
  assert.equal(Object.isFrozen(result), true);
});

test('M2-HIS-005 communication authority creates a durable history execution and intent', () => {
  const calls = [];
  const authority = new CommunicationAuthority({
    storeProvider() {
      throw Object.assign(new Error('legacy checkpoint store must not be used'), {
        code: 'LEGACY_CHECKPOINT_STORE_FORBIDDEN'
      });
    },
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['execution', input]);
        return Object.freeze({ executionId: 'execution-history-scheduled-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['intent', input]);
        return Object.freeze({ intentId: 'intent-history-scheduled-1' });
      }
    }),
    issueTimestamp: purpose => purpose === 'history-synchronization-execution'
      ? '2026-08-04T06:00:00.000Z'
      : '2026-08-04T06:00:01.000Z'
  });

  assert.equal(typeof authority.prepareHistorySynchronization, 'function');
  const prepared = authority.prepareHistorySynchronization({
    idempotencyKey: 'history-schedule-idempotency-1',
    traceId: 'trace-history-schedule-1',
    command: historyCommand(),
    maxAttempts: 3
  });

  assert.deepEqual(calls.map(([kind]) => kind), ['execution', 'intent']);
  assert.equal(calls[0][1].operationKind, OPERATION_KINDS.HISTORY_SYNCHRONIZATION);
  assert.equal(calls[1][1].actionKind, OPERATION_KINDS.HISTORY_SYNCHRONIZATION);
  assert.equal(prepared.executionId, 'execution-history-scheduled-1');
  assert.equal(prepared.intentId, 'intent-history-scheduled-1');
  assert.equal(Object.isFrozen(prepared), true);
});

test('M2-HIS-006 public history backfill schedules durable work and never calls a platform history port', async () => {
  let physicalHistoryCalls = 0;
  const scheduled = [];
  const runtime = new ChannelAdapterRuntime({
    platform: 'telegram',
    facade: facadeFixture({
      reconcile: {
        async execute() {
          physicalHistoryCalls += 1;
          return { outcome: 'REMOTE_RESULT_UNKNOWN' };
        }
      }
    }),
    communicationAuthority: Object.freeze({
      prepareHistorySynchronization(input) {
        scheduled.push(input);
        return Object.freeze({
          executionId: 'execution-history-scheduled-2',
          intentId: 'intent-history-scheduled-2',
          operationKind: OPERATION_KINDS.HISTORY_SYNCHRONIZATION,
          idempotencyKey: input.idempotencyKey
        });
      }
    }),
    accountReader: () => null
  });

  const result = await runtime.backfillMessages({
    traceId: 'trace-history-schedule-2',
    idempotencyKey: 'history-schedule-idempotency-2',
    accountId: 'account-history-1',
    scopeReference: 'conversation-history-1',
    checkpointReference: 'checkpoint-history-1',
    checkpointVersion: 3,
    cursorReference: 'cursor-history-3',
    requestContentSha256: HASH,
    credentialReference: 'credential-history-1',
    pageSize: 50
  });

  assert.equal(physicalHistoryCalls, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].command.streamKind, 'messages');
  assert.equal(scheduled[0].command.checkpointVersion, 3);
  assert.equal(result.executionId, 'execution-history-scheduled-2');
  assert.equal(result.intentId, 'intent-history-scheduled-2');
});

test('M2-HIS-007 observed page persists observation then advances checkpoint with full fencing facts in one transaction', () => {
  const order = [];
  let observationInput = null;
  let advanceInput = null;
  const capability = checkpointCapability(order, {
    onObservation(input) { observationInput = input; },
    onAdvance(input) { advanceInput = input; }
  });
  const authority = new CommunicationAuthority({
    historyCheckpointTransactionCapability: capability,
    issueTimestamp: () => '2026-08-04T06:10:00.000Z'
  });

  assert.equal(typeof authority.applyHistoryCheckpointObservation, 'function');
  const result = authority.applyHistoryCheckpointObservation({
    executionClaim: deepFreeze({
      executionId: 'execution-history-7',
      stateVersion: 4,
      generation: 2,
      ownerId: 'owner-history-7',
      claimId: 'claim-history-7',
      hostId: 'host-history-7',
      hostGeneration: 4,
      fencingToken: 9,
      allowedStates: Object.freeze(['RUNNING', 'WAITING_REMOTE'])
    }),
    checkpoint: deepFreeze({
      checkpointId: 'checkpoint-history-7',
      platform: 'telegram',
      sourceAccountId: 'account-history-7',
      streamKind: 'messages',
      externalConversationId: 'conversation-history-7',
      expectedVersion: 3
    }),
    observation: deepFreeze({
      outcome: 'PAGE_OBSERVED',
      segmentReference: 'segment-history-7',
      cursorReference: 'cursor-history-4',
      highWatermarkReference: 'remote-high-watermark-107',
      gapClosed: false,
      evidenceReference: 'evidence-history-7'
    })
  });

  assert.deepEqual(order, [
    'transaction:start',
    'recordObservation',
    'advanceCheckpoint',
    'transaction:end'
  ]);
  assert.equal(capability.transactionCount(), 1);
  assert.equal(observationInput.executionId, 'execution-history-7');
  for (const field of ['stateVersion', 'generation', 'ownerId', 'claimId', 'hostId', 'hostGeneration', 'fencingToken']) {
    assert.equal(advanceInput[field], {
      stateVersion: 4,
      generation: 2,
      ownerId: 'owner-history-7',
      claimId: 'claim-history-7',
      hostId: 'host-history-7',
      hostGeneration: 4,
      fencingToken: 9
    }[field], field);
  }
  assert.equal(advanceInput.expectedVersion, 3);
  assert.equal(result.checkpoint.version, 4);
  assert.equal(result.nextSegmentRequired, true);
  assert.equal(result.retryAllowed, false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-HIS-008 unknown remote cursor is persisted first and cannot advance checkpoint or authorize retry', () => {
  const order = [];
  const capability = checkpointCapability(order, {
    onAdvance() { throw new Error('unknown cursor must not advance checkpoint'); }
  });
  const authority = new CommunicationAuthority({
    historyCheckpointTransactionCapability: capability,
    issueTimestamp: () => '2026-08-04T06:20:00.000Z'
  });

  const result = authority.applyHistoryCheckpointObservation({
    executionClaim: deepFreeze({
      executionId: 'execution-history-8',
      stateVersion: 5,
      generation: 2,
      ownerId: 'owner-history-8',
      claimId: 'claim-history-8',
      hostId: 'host-history-8',
      hostGeneration: 4,
      fencingToken: 10,
      allowedStates: Object.freeze(['RUNNING', 'WAITING_REMOTE'])
    }),
    checkpoint: deepFreeze({
      checkpointId: 'checkpoint-history-8',
      platform: 'telegram',
      sourceAccountId: 'account-history-8',
      streamKind: 'messages',
      externalConversationId: 'conversation-history-8',
      expectedVersion: 7
    }),
    observation: deepFreeze({
      outcome: 'REMOTE_RESULT_UNKNOWN',
      cursorReference: 'remote-cursor-unknown-8',
      highWatermarkReference: 'remote-high-watermark-unknown-8',
      gapClosed: false,
      evidenceReference: 'evidence-history-unknown-8'
    })
  });

  assert.deepEqual(order, [
    'transaction:start',
    'recordObservation',
    'transaction:end'
  ]);
  assert.equal(capability.transactionCount(), 1);
  assert.equal(result.state, 'REMOTE_RESULT_UNKNOWN');
  assert.equal(result.checkpointAdvanced, false);
  assert.equal(result.retryAllowed, false);
  assert.equal(result.terminal, false);
});
