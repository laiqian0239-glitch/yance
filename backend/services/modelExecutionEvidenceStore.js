'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');

const AUTHORITY = 'ModelExecutionEvidenceStore';
const SCHEMA_VERSION = 1;
const MAX_RECENT = 200;
const MAX_TEXT = 4096;

const store = new SqliteDocumentStore('model-execution-evidence', {
  schemaVersion: SCHEMA_VERSION,
  authority: AUTHORITY,
  recent: []
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function redact(value) {
  return clean(value)
    .slice(-MAX_TEXT)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, '$1=[REDACTED]');
}
function sanitize(receipt = {}) {
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    executionId: clean(receipt.executionId),
    correlationId: clean(receipt.correlationId),
    modelId: clean(receipt.modelId),
    task: clean(receipt.task),
    pid: Number(receipt.pid || 0),
    workerStarted: receipt.workerStarted === true,
    lastWorkerMessageType: clean(receipt.lastWorkerMessageType),
    exitCode: Number.isInteger(receipt.exitCode) ? receipt.exitCode : null,
    signal: clean(receipt.signal),
    terminated: receipt.terminated === true,
    terminationClass: clean(receipt.terminationClass),
    terminationReason: clean(receipt.terminationReason),
    abortSource: clean(receipt.abortSource),
    stderrTail: redact(receipt.stderrTail),
    stdoutTail: redact(receipt.stdoutTail),
    providerRequestId: clean(receipt.providerRequestId),
    envelopeSchemaVersion: Number(receipt.envelopeSchemaVersion || 0),
    envelopeDigest: /^[a-f0-9]{64}$/u.test(clean(receipt.envelopeDigest)) ? clean(receipt.envelopeDigest) : '',
    policySnapshotVersion: Number(receipt.policySnapshotVersion || 0),
    startedAt: clean(receipt.startedAt),
    finishedAt: clean(receipt.finishedAt),
    durationMs: Math.max(0, Number(receipt.durationMs || 0))
  };
}
function append(receipt = {}) {
  const row = sanitize(receipt);
  return Promise.resolve()
    .then(() => store.update(document => {
      document.schemaVersion = SCHEMA_VERSION;
      document.authority = AUTHORITY;
      document.recent = [row, ...(Array.isArray(document.recent) ? document.recent : []).filter(existing => existing.executionId !== row.executionId)].slice(0, MAX_RECENT);
      return document;
    }))
    .then(() => row);
}
function readRecent(limit = 50) {
  const document = store.read();
  return (Array.isArray(document.recent) ? document.recent : []).slice(0, Math.max(1, Math.min(MAX_RECENT, Number(limit || 50))));
}
function projectError(error = {}) {
  const code = clean(error.code || error.reasonCode);
  if (!clean(error.executionId) && !clean(error.terminationClass) && code !== 'MODEL_EXECUTION_TERMINATED') return null;
  return sanitize({
    executionId: error.executionId,
    correlationId: error.correlationId,
    modelId: error.modelId,
    task: error.task,
    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
    signal: error.signal,
    terminated: true,
    terminationClass: error.terminationClass || 'unknown',
    terminationReason: error.terminationReason || code || 'MODEL_EXECUTION_TERMINATED',
    abortSource: error.abortSource,
    stderrTail: error.stderrTail,
    providerRequestId: error.providerRequestId
  });
}

module.exports = { AUTHORITY, SCHEMA_VERSION, MAX_RECENT, sanitize, append, readRecent, projectError };
