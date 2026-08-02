'use strict';

const { randomUUID } = require('node:crypto');
const evidenceAuthority = require('./evidenceAuthority');

const AUTHORITY = 'AIExecutionTraceAuthority';
const SCHEMA_VERSION = 2;
const MAX_TRACES = 200;
const memoryTraces = new Map();
let testMode = false;

const SAFE_KEYS = new Set([
  'task', 'executionMode', 'requestedMode', 'requestedPrimary', 'requestedFallback',
  'resolvedPrimary', 'resolvedFallback', 'allowConditional', 'humanReviewRequired',
  'formalQualification', 'routeState', 'reasonCode', 'reasonCodes', 'modelId',
  'fallbackModelId', 'provider', 'providerRequestId', 'status', 'errorCode',
  'durationMs', 'workerStarted', 'fallbackUsed', 'deliveryEligible', 'learningEligible',
  'formalReceiptEligible', 'source', 'stage', 'resolutionState', 'traceId',
  'executionId', 'attemptId', 'routeReceiptId', 'qualificationReceiptId',
  'deliveryReceiptId', 'learningReceiptId'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }
function sanitizeValue(value, depth = 0) {
  if (depth > 3) return undefined;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SAFE_KEYS.has(key)) continue;
      const safe = sanitizeValue(item, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return undefined;
}
function prune() { while (memoryTraces.size > MAX_TRACES) memoryTraces.delete(memoryTraces.keys().next().value); }
function projectPersistent(trace) {
  if (!trace) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    traceId: trace.traceId,
    routeTestId: trace.routeTestId || trace.traceId,
    task: trace.task,
    executionMode: trace.executionMode,
    status: trace.status,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    stages: (trace.observations || []).map(row => ({ at: row.createdAt, stage: row.stage, evidence: row.evidence || {} }))
  };
}

function memoryStart(input = {}) {
  const routeTestId = clean(input.routeTestId || input.traceId) || `route-test-${randomUUID()}`;
  const at = now();
  const trace = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    traceId: routeTestId,
    routeTestId,
    task: clean(input.task),
    executionMode: clean(input.executionMode),
    status: 'running',
    startedAt: at,
    completedAt: '',
    stages: [{ at, stage: 'route-test-started', evidence: sanitizeValue(input) || {} }]
  };
  memoryTraces.set(routeTestId, trace);
  prune();
  return structuredClone(trace);
}
function memoryRecord(routeTestId, stage, evidence = {}) {
  const id = clean(routeTestId);
  const trace = memoryTraces.get(id);
  if (!trace) return null;
  trace.stages.push({ at: now(), stage: clean(stage) || 'trace-stage', evidence: sanitizeValue(evidence) || {} });
  return structuredClone(trace);
}
function memoryTerminal(routeTestId, status, stage, evidence = {}, error = {}) {
  const id = clean(routeTestId);
  const trace = memoryTraces.get(id);
  if (!trace) return null;
  trace.status = status;
  trace.completedAt = now();
  trace.stages.push({
    at: trace.completedAt,
    stage,
    evidence: sanitizeValue({ ...evidence, errorCode: clean(error.code || error.reasonCode), reasonCode: clean(error.reasonCode || error.code) }) || {}
  });
  return structuredClone(trace);
}

function start(input = {}) {
  if (testMode) return memoryStart(input);
  const trace = evidenceAuthority.startTrace({ ...input, traceId: clean(input.traceId || input.routeTestId), routeTestId: clean(input.routeTestId), traceType: 'ai-route-test' });
  evidenceAuthority.appendObservation({
    traceId: trace.traceId,
    idempotencyKey: `route-test-started:${randomUUID()}`,
    kind: 'event',
    stage: 'route-test-started',
    executionId: clean(input.executionId),
    evidence: sanitizeValue(input) || {}
  });
  return projectPersistent(evidenceAuthority.getTrace(trace.traceId));
}
function record(routeTestId, stage, evidence = {}) {
  if (testMode) return memoryRecord(routeTestId, stage, evidence);
  const id = clean(routeTestId);
  if (!id) return null;
  evidenceAuthority.appendObservation({
    traceId: id,
    idempotencyKey: `${clean(stage) || 'trace-stage'}:${randomUUID()}`,
    kind: clean(stage).includes('provider') ? 'generation' : 'span',
    stage: clean(stage) || 'trace-stage',
    status: clean(evidence.status),
    executionId: clean(evidence.executionId),
    attemptId: clean(evidence.attemptId),
    providerRequestId: clean(evidence.providerRequestId),
    routeReceiptId: clean(evidence.routeReceiptId),
    qualificationReceiptId: clean(evidence.qualificationReceiptId),
    deliveryReceiptId: clean(evidence.deliveryReceiptId),
    learningReceiptId: clean(evidence.learningReceiptId),
    evidence: sanitizeValue(evidence) || {}
  });
  return projectPersistent(evidenceAuthority.getTrace(id));
}
function complete(routeTestId, evidence = {}) {
  if (testMode) return memoryTerminal(routeTestId, 'completed', 'route-test-completed', evidence);
  const trace = evidenceAuthority.completeTrace({
    traceId: clean(routeTestId),
    idempotencyKey: 'route-test-completed',
    stage: 'route-test-completed',
    executionId: clean(evidence.executionId),
    providerRequestId: clean(evidence.providerRequestId),
    routeReceiptId: clean(evidence.routeReceiptId),
    qualificationReceiptId: clean(evidence.qualificationReceiptId),
    deliveryReceiptId: clean(evidence.deliveryReceiptId),
    learningReceiptId: clean(evidence.learningReceiptId),
    evidence: sanitizeValue(evidence) || {}
  });
  return projectPersistent(trace);
}
function fail(routeTestId, error = {}, evidence = {}) {
  if (testMode) return memoryTerminal(routeTestId, 'failed', 'route-test-failed', evidence, error);
  const trace = evidenceAuthority.failTrace({
    traceId: clean(routeTestId),
    idempotencyKey: 'route-test-failed',
    stage: 'route-test-failed',
    error,
    executionId: clean(evidence.executionId || error.executionId),
    providerRequestId: clean(evidence.providerRequestId || error.providerRequestId),
    evidence: sanitizeValue(evidence) || {}
  });
  return projectPersistent(trace);
}
function get(routeTestId) {
  if (testMode) {
    const row = memoryTraces.get(clean(routeTestId));
    return row ? structuredClone(row) : null;
  }
  return projectPersistent(evidenceAuthority.getTrace(clean(routeTestId)));
}
function recent(limit = 50) {
  if (testMode) return [...memoryTraces.values()].slice(-Math.max(1, Math.min(200, Number(limit || 50)))).reverse().map(row => structuredClone(row));
  return evidenceAuthority.recentTraces(limit).filter(row => row.traceType === 'ai-route-test').map(projectPersistent);
}
function clearForTests() { testMode = true; memoryTraces.clear(); }
function restorePersistentModeForTests() { testMode = false; memoryTraces.clear(); }

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  start,
  record,
  complete,
  fail,
  get,
  recent,
  clearForTests,
  restorePersistentModeForTests
};
