'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { EvidenceAuthority } = require('../services/evidenceAuthority');

function withStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-evidence-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    return callback(store, { root, dbPath });
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function authorityFor(store) {
  let id = 0;
  let tick = 0;
  return new EvidenceAuthority({
    storeProvider: () => store,
    idFactory: prefix => `${prefix}-${++id}`,
    clock: () => new Date(Date.UTC(2026, 7, 1, 10, 0, tick++)).toISOString()
  });
}

test('evidence trace persists append-only ordered observations and survives authority recreation', () => {
  withStore(store => {
    const authority = authorityFor(store);
    const started = authority.startTrace({
      traceId: 'trace-fixed',
      routeTestId: 'route-test-fixed',
      traceType: 'ai-reply',
      task: 'quick_reply',
      executionMode: 'candidate-only',
      messages: [{ role: 'user', content: 'SECRET MESSAGE' }],
      apiKey: 'SECRET KEY'
    });
    assert.equal(started.traceId, 'trace-fixed');
    assert.equal(started.routeTestId, 'route-test-fixed');
    assert.equal(started.status, 'running');

    const first = authority.appendObservation({
      traceId: started.traceId,
      idempotencyKey: 'route-resolved',
      kind: 'span',
      stage: 'route-resolved',
      executionId: 'exec-1',
      evidence: {
        modelId: 'cloud-a',
        provider: 'openrouter',
        resolvedPrimary: 'cloud-a',
        apiKey: 'SECRET KEY',
        prompt: 'SECRET MESSAGE'
      }
    });
    const duplicate = authority.appendObservation({
      traceId: started.traceId,
      idempotencyKey: 'route-resolved',
      kind: 'span',
      stage: 'route-resolved',
      executionId: 'exec-1',
      evidence: { modelId: 'different-model-that-must-not-overwrite' }
    });
    const second = authority.appendObservation({
      traceId: started.traceId,
      idempotencyKey: 'provider-result',
      kind: 'generation',
      stage: 'provider-result',
      executionId: 'exec-1',
      attemptId: 'attempt-1',
      providerRequestId: 'gen-123',
      status: 'completed',
      evidence: { modelId: 'cloud-a', providerRequestId: 'gen-123', preview: 'SECRET OUTPUT' }
    });

    assert.equal(first.sequence, 1);
    assert.equal(duplicate.observationId, first.observationId);
    assert.equal(duplicate.sequence, 1);
    assert.equal(second.sequence, 2);

    authority.completeTrace({ traceId: started.traceId, idempotencyKey: 'trace-complete', evidence: { status: 'completed' } });

    const reloaded = new EvidenceAuthority({ storeProvider: () => store }).getTrace(started.traceId);
    assert.equal(reloaded.status, 'completed');
    assert.deepEqual(reloaded.observations.map(row => row.sequence), [1, 2, 3]);
    assert.deepEqual(reloaded.observations.map(row => row.stage), ['route-resolved', 'provider-result', 'trace-completed']);
    assert.equal(reloaded.observations[0].evidence.modelId, 'cloud-a');
    const serialized = JSON.stringify(reloaded);
    assert.doesNotMatch(serialized, /SECRET MESSAGE|SECRET KEY|SECRET OUTPUT|different-model-that-must-not-overwrite/u);
    assert.match(serialized, /cloud-a|gen-123/u);

    assert.throws(
      () => store.db.prepare('UPDATE evidence_observations SET stage=? WHERE trace_id=?').run('tampered', started.traceId),
      /append-only/i
    );
    assert.throws(
      () => store.db.prepare('DELETE FROM evidence_observations WHERE trace_id=?').run(started.traceId),
      /append-only/i
    );
  });
});

test('routeTestId remains a compatibility alias of traceId and terminal operations are idempotent', () => {
  withStore(store => {
    const authority = authorityFor(store);
    const started = authority.startTrace({ routeTestId: 'route-test-only', task: 'director', executionMode: 'candidate-only' });
    assert.equal(started.traceId, 'route-test-only');
    assert.equal(started.routeTestId, 'route-test-only');

    const completed = authority.completeTrace({ traceId: started.traceId, idempotencyKey: 'done', evidence: { modelId: 'cloud-a' } });
    const repeated = authority.completeTrace({ traceId: started.traceId, idempotencyKey: 'done', evidence: { modelId: 'cloud-b' } });
    assert.equal(completed.status, 'completed');
    assert.equal(repeated.observations.length, completed.observations.length);
    assert.equal(repeated.observations.at(-1).evidence.modelId, 'cloud-a');

    assert.throws(
      () => authority.failTrace({ traceId: started.traceId, idempotencyKey: 'late-fail', error: { code: 'LATE_FAILURE' } }),
      error => error?.code === 'EVIDENCE_TRACE_TERMINAL_CONFLICT'
    );
  });
});
