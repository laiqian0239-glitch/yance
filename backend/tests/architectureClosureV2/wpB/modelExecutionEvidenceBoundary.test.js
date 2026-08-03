'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const evidenceStore = require('../../../services/modelExecutionEvidenceStore');

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
  let appendResult;
  assert.doesNotThrow(() => {
    appendResult = evidenceStore.append(RECEIPT);
  });
  assert.equal(typeof appendResult?.then, 'function');
  await assert.rejects(
    appendResult,
    error => error?.code === 'DOCUMENT_PERSISTENCE_CAPABILITY_REQUIRED'
  );
});
