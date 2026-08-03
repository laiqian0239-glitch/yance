'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { deepFreeze } = require('../../../lib/deepFreeze');
const { OPERATION_KINDS } = require('../../../services/durableOperationRegistry');
const mediaPipeline = require('../../../services/mediaPipeline');
const transcriptionService = require('../../../services/transcriptionService');

const operationPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'services',
  'durableOperations',
  'mediaTransferOperation.js'
);
const HASH = 'e'.repeat(64);

function operationModule() {
  assert.equal(
    fs.existsSync(operationPath),
    true,
    'WP_B_M2_MEDIA_TRANSFER_OPERATION_REQUIRED'
  );
  delete require.cache[require.resolve(operationPath)];
  return require(operationPath);
}

function transferEnvelope(overrides = {}) {
  const request = deepFreeze({
    transferKind: 'FETCH',
    mediaReference: 'media-reference-1',
    sourceScopeReference: 'source-scope-reference-1',
    destinationScopeReference: 'destination-scope-reference-1',
    metadataSha256: HASH,
    custodyReference: 'custody-reference-1',
    ...overrides.request
  });
  return deepFreeze({
    executionId: 'execution-media-1',
    intentId: 'intent-media-1',
    attemptId: 'attempt-media-1',
    claimId: 'claim-media-1',
    ownerId: 'owner-media-1',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    idempotencyKey: 'idempotency-media-1',
    request,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'request'))
  });
}

test('M2-MED-001 media transfer Adapter is frozen and owns the exact operation kind', () => {
  const { OPERATION_KIND, createMediaTransferOperation } = operationModule();
  assert.equal(OPERATION_KIND, OPERATION_KINDS.MEDIA_TRANSFER);
  const adapter = createMediaTransferOperation({
    resolveCustodyReference: () => Object.freeze({ access: 'ephemeral' }),
    mediaClient: Object.freeze({
      async transfer() { return Object.freeze({ status: 'COMPLETED' }); },
      async transcribe() { return Object.freeze({ status: 'COMPLETED' }); },
      async lookup() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
    })
  });
  assert.equal(adapter.operationKind, OPERATION_KIND);
  assert.equal(typeof adapter.perform, 'function');
  assert.equal(typeof adapter.reconcile, 'function');
  assert.equal(Object.isFrozen(adapter), true);
});

test('M2-MED-002 perform resolves ephemeral custody and returns only bounded transfer references', async () => {
  const { createMediaTransferOperation } = operationModule();
  const calls = [];
  const custody = Object.freeze({ token: 'private-ephemeral-token' });
  const adapter = createMediaTransferOperation({
    resolveCustodyReference(reference, context) {
      calls.push(['resolve', reference, context.attemptId]);
      return custody;
    },
    mediaClient: Object.freeze({
      async transfer(input) {
        calls.push(['transfer', input.mediaReference, input.custody === custody, input.fencingToken]);
        return Object.freeze({
          status: 'COMPLETED',
          remoteTransferId: 'remote-transfer-1',
          providerRequestId: 'provider-request-media-1',
          outputReference: 'media-output-reference-1',
          evidenceReference: 'media-evidence-reference-1',
          binaryPayload: Buffer.from('must-not-escape'),
          signedUrl: 'https://example.invalid/private?token=secret'
        });
      },
      async transcribe() { throw new Error('FETCH must not transcribe'); },
      async lookup() { throw new Error('perform must not reconcile'); }
    })
  });

  const result = await adapter.perform(transferEnvelope());
  assert.deepEqual(calls, [
    ['resolve', 'custody-reference-1', 'attempt-media-1'],
    ['transfer', 'media-reference-1', true, 1]
  ]);
  assert.deepEqual(result, {
    status: 'COMPLETED',
    remoteTransferId: 'remote-transfer-1',
    providerRequestId: 'provider-request-media-1',
    outputReference: 'media-output-reference-1',
    evidenceReference: 'media-evidence-reference-1',
    failureCode: '',
    uncertain: false
  });
  assert.equal(JSON.stringify(result).includes('private-ephemeral-token'), false);
  assert.equal(JSON.stringify(result).includes('signedUrl'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-MED-003 mutable attempts and inline media content fail before custody or physical I/O', async () => {
  const { createMediaTransferOperation } = operationModule();
  let physicalCalls = 0;
  const adapter = createMediaTransferOperation({
    resolveCustodyReference() {
      throw new Error('invalid attempt must not resolve custody');
    },
    mediaClient: Object.freeze({
      async transfer() { physicalCalls += 1; },
      async transcribe() { physicalCalls += 1; },
      async lookup() { physicalCalls += 1; }
    })
  });

  await assert.rejects(
    () => adapter.perform({ ...transferEnvelope() }),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );
  for (const field of ['binaryPayload', 'messageBody', 'signedUrl', 'authorizationHeader']) {
    await assert.rejects(
      () => adapter.perform(transferEnvelope({ request: { [field]: 'forbidden-inline-value' } })),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD'
        || error?.code === 'WP_B_MEDIA_TRANSFER_REFERENCE_ONLY_REQUIRED',
      field
    );
  }
  assert.equal(physicalCalls, 0);
});

test('M2-MED-004 reconciliation performs lookup only and preserves unknown remote outcome', async () => {
  const { createMediaTransferOperation } = operationModule();
  const calls = [];
  const custody = Object.freeze({ access: 'ephemeral-reconciliation' });
  const adapter = createMediaTransferOperation({
    resolveCustodyReference(reference) {
      calls.push(['resolve', reference]);
      return custody;
    },
    mediaClient: Object.freeze({
      async transfer() { calls.push(['transfer']); },
      async transcribe() { calls.push(['transcribe']); },
      async lookup(input) {
        calls.push(['lookup', input.mediaReference, input.custody === custody]);
        return Object.freeze({
          outcome: 'REMOTE_RESULT_UNKNOWN',
          remoteTransferId: 'remote-transfer-unknown-1',
          evidenceReference: 'media-evidence-unknown-1'
        });
      }
    })
  });

  const result = await adapter.reconcile(transferEnvelope());
  assert.deepEqual(calls, [
    ['resolve', 'custody-reference-1'],
    ['lookup', 'media-reference-1', true]
  ]);
  assert.deepEqual(result, {
    outcome: 'REMOTE_RESULT_UNKNOWN',
    remoteTransferId: 'remote-transfer-unknown-1',
    providerRequestId: '',
    outputReference: '',
    evidenceReference: 'media-evidence-unknown-1',
    failureCode: ''
  });
  assert.equal(Object.isFrozen(result), true);
});

test('M2-MED-005 media pipeline creates execution and intent without performing physical transfer', () => {
  const calls = [];
  assert.equal(typeof mediaPipeline.createMediaTransferScheduler, 'function');
  const scheduler = mediaPipeline.createMediaTransferScheduler({
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['execution', input]);
        return Object.freeze({ executionId: 'execution-media-scheduled-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['intent', input]);
        return Object.freeze({ intentId: 'intent-media-scheduled-1' });
      }
    }),
    issueTimestamp: purpose => purpose === 'media-transfer-execution'
      ? '2026-08-04T05:00:00.000Z'
      : '2026-08-04T05:00:01.000Z'
  });

  const result = scheduler.prepare({
    idempotencyKey: 'media-schedule-idempotency-1',
    traceId: 'trace-media-schedule-1',
    command: transferEnvelope().request
  });
  assert.deepEqual(calls.map(([kind]) => kind), ['execution', 'intent']);
  assert.equal(calls[0][1].operationKind, OPERATION_KINDS.MEDIA_TRANSFER);
  assert.equal(calls[1][1].actionKind, OPERATION_KINDS.MEDIA_TRANSFER);
  assert.equal(result.executionId, 'execution-media-scheduled-1');
  assert.equal(result.intentId, 'intent-media-scheduled-1');
  assert.equal(Object.isFrozen(result), true);
});

test('M2-MED-006 transcription public entry schedules durable work and never spawns before a persisted attempt', async () => {
  let physicalRuns = 0;
  assert.equal(typeof transcriptionService.createTranscriptionService, 'function');
  const service = transcriptionService.createTranscriptionService({
    mediaTransferScheduler: Object.freeze({
      prepare(input) {
        return Object.freeze({
          executionId: 'execution-transcription-1',
          intentId: 'intent-transcription-1',
          operationKind: OPERATION_KINDS.MEDIA_TRANSFER,
          idempotencyKey: input.idempotencyKey
        });
      }
    }),
    physicalRunner: async () => {
      physicalRuns += 1;
      return { transcript: 'must-not-run' };
    }
  });

  const result = await service.transcribe({
    idempotencyKey: 'transcription-idempotency-1',
    traceId: 'trace-transcription-1',
    mediaReference: 'media-reference-transcription-1',
    sourceScopeReference: 'source-transcription-1',
    destinationScopeReference: 'destination-transcription-1',
    metadataSha256: HASH,
    custodyReference: 'custody-transcription-1'
  });
  assert.equal(physicalRuns, 0);
  assert.equal(result.executionId, 'execution-transcription-1');
  assert.equal(result.intentId, 'intent-transcription-1');

  await assert.rejects(
    () => service.executePersistedTranscription({
      request: transferEnvelope({ request: { transferKind: 'TRANSCRIBE' } }).request
    }),
    error => error?.code === 'WP_B_MEDIA_TRANSFER_ATTEMPT_REQUIRED'
  );
  assert.equal(physicalRuns, 0);
});
