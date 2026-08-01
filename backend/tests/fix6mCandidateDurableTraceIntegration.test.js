'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { EvidenceAuthority } = require('../services/evidenceAuthority');
const { DurableExecutionAuthority } = require('../services/durableExecutionAuthority');
const { CandidateExecutionService } = require('../services/candidateExecutionService');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-candidate-durable-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const store = new R32SqliteStore({ dbPath });
  let id = 0;
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 7, 1, 12, 0, tick++)).toISOString();
  const idFactory = prefix => `${prefix}-${++id}`;
  const evidence = new EvidenceAuthority({ storeProvider: () => store, idFactory, clock });
  const durable = new DurableExecutionAuthority({ storeProvider: () => store, idFactory, clock });
  const trace = {
    start(input) {
      const row = evidence.startTrace({ ...input, traceId: input.routeTestId, routeTestId: input.routeTestId, traceType: 'ai-route-test' });
      evidence.appendObservation({ traceId: row.traceId, idempotencyKey: 'route-test-started', stage: 'route-test-started', evidence: input });
      return { ...row, routeTestId: row.routeTestId || row.traceId };
    },
    record(traceId, stage, payload) {
      evidence.appendObservation({
        traceId,
        idempotencyKey: `${stage}:${payload.executionId || ''}:${payload.providerRequestId || ''}`,
        stage,
        executionId: payload.executionId,
        providerRequestId: payload.providerRequestId,
        evidence: payload
      });
    },
    complete(traceId, payload) {
      return evidence.completeTrace({ traceId, idempotencyKey: 'route-test-completed', stage: 'route-test-completed', executionId: payload.executionId, providerRequestId: payload.providerRequestId, evidence: payload });
    },
    fail(traceId, error, payload) {
      return evidence.failTrace({ traceId, idempotencyKey: 'route-test-failed', stage: 'route-test-failed', error, executionId: payload.executionId, evidence: payload });
    }
  };
  return {
    root, store, evidence, durable, trace,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

test('candidate execution persists one durable execution under the same trace', async () => {
  const f = fixture();
  try {
    let observedOptions;
    const service = new CandidateExecutionService({
      traceAuthority: f.trace,
      durableExecutionAuthority: f.durable,
      ownerId: 'candidate-worker-test',
      gateway: {
        async execute(payload) {
          observedOptions = payload.options;
          f.trace.record(payload.options.routeTestId, 'worker-started', {
            executionId: payload.options.executionId,
            modelId: 'cloud-a',
            provider: 'openrouter',
            workerStarted: true
          });
          f.trace.record(payload.options.routeTestId, 'provider-result', {
            executionId: payload.options.executionId,
            modelId: 'cloud-a',
            providerRequestId: 'gen-123',
            status: 'success'
          });
          return { modelId: 'cloud-a', providerRequestId: 'gen-123', text: 'candidate text' };
        }
      }
    });

    const result = await service.execute({
      task: 'quick_reply',
      routeTestId: 'route-test-durable',
      messages: [{ role: 'user', content: 'private message' }],
      route: { resolved: { primary: { modelId: 'cloud-a' } } }
    });

    assert.equal(result.routeTestId, 'route-test-durable');
    assert.match(result.executionId, /^execution-/u);
    assert.equal(observedOptions.executionId, result.executionId);
    assert.equal(result.deliveryEligible, false);
    assert.equal(result.learningEligible, false);
    assert.equal(result.formalReceiptEligible, false);

    const durableReloaded = new DurableExecutionAuthority({ storeProvider: () => f.store }).get(result.executionId);
    assert.equal(durableReloaded.traceId, result.routeTestId);
    assert.equal(durableReloaded.operationKind, 'ai-candidate-generation');
    assert.equal(durableReloaded.state, 'SUCCEEDED');
    assert.deepEqual(durableReloaded.history.map(row => row.toState), ['CREATED', 'SCHEDULED', 'RUNNING', 'SUCCEEDED']);

    const traceReloaded = new EvidenceAuthority({ storeProvider: () => f.store }).getTrace(result.routeTestId);
    assert.equal(traceReloaded.status, 'completed');
    assert.ok(traceReloaded.observations.some(row => row.executionId === result.executionId));
    assert.ok(traceReloaded.observations.some(row => row.providerRequestId === 'gen-123'));
    assert.doesNotMatch(JSON.stringify(traceReloaded), /private message|candidate text/u);
  } finally { f.close(); }
});

test('candidate failure persists terminal execution and trace failure', async () => {
  const f = fixture();
  try {
    const service = new CandidateExecutionService({
      traceAuthority: f.trace,
      durableExecutionAuthority: f.durable,
      ownerId: 'candidate-worker-test',
      gateway: { async execute() { throw Object.assign(new Error('provider down'), { code: 'PROVIDER_UNAVAILABLE' }); } }
    });
    await assert.rejects(
      () => service.execute({ task: 'director', routeTestId: 'route-test-failed', route: { resolved: { primary: { modelId: 'cloud-a' } } } }),
      error => error?.code === 'PROVIDER_UNAVAILABLE' && /^execution-/u.test(error.executionId || '')
    );
    const executions = f.store.db.prepare('SELECT execution_id FROM durable_executions WHERE trace_id=?').all('route-test-failed');
    assert.equal(executions.length, 1);
    assert.equal(f.durable.get(executions[0].execution_id).state, 'FAILED');
    assert.equal(f.evidence.getTrace('route-test-failed').status, 'failed');
  } finally { f.close(); }
});
