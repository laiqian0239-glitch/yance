'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createModelExecutionEvidenceStore
} = require('../../../services/modelExecutionEvidenceStore');

const RECEIPT = Object.freeze({
  executionId: 'execution-evidence-boundary-1',
  correlationId: 'correlation-evidence-boundary-1',
  modelId: 'model-evidence-boundary-1',
  task: 'contract',
  terminated: true,
  terminationClass: 'uncertain-remote-outcome',
  terminationReason: 'UNCERTAIN_REMOTE_OUTCOME',
  providerRequestId: 'provider-request-evidence-boundary-1',
  startedAt: '2026-08-04T01:20:00.000Z',
  finishedAt: '2026-08-04T01:20:01.000Z',
  durationMs: 1000
});

test('M2-AI-009 evidence append preserves an asynchronous failure boundary', async () => {
  assert.equal(typeof createModelExecutionEvidenceStore, 'function');
  const isolatedStore = createModelExecutionEvidenceStore({
    persistenceCapability: Object.freeze({})
  });

  let appendResult;
  assert.doesNotThrow(() => {
    appendResult = isolatedStore.append(RECEIPT);
  });
  assert.equal(typeof appendResult?.then, 'function');

  let rejection = null;
  try {
    await appendResult;
  } catch (error) {
    rejection = error;
  }
  assert.deepEqual(
    { code: rejection?.code || null },
    { code: 'DOCUMENT_PERSISTENCE_CAPABILITY_REQUIRED' }
  );
});
