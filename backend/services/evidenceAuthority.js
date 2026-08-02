'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');

const AUTHORITY = 'EvidenceAuthority';
const SCHEMA_VERSION = 1;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const SAFE_KEYS = new Set([
  'authority', 'schemaVersion', 'traceType', 'task', 'executionMode', 'requestedMode',
  'requestedPrimary', 'requestedFallback', 'resolvedPrimary', 'resolvedFallback',
  'allowConditional', 'humanReviewRequired', 'formalQualification', 'routeState',
  'reasonCode', 'reasonCodes', 'modelId', 'fallbackModelId', 'provider',
  'providerRequestId', 'status', 'errorCode', 'durationMs', 'workerStarted',
  'fallbackUsed', 'deliveryEligible', 'learningEligible', 'formalReceiptEligible',
  'source', 'stage', 'resolutionState', 'platform', 'operationKind', 'generation',
  'attempt', 'retryable', 'terminationClass', 'capabilityId', 'mediaState',
  'messageKind', 'syncState', 'checkpoint', 'counts', 'pass', 'warning', 'failed',
  'skipped', 'receiptId', 'routeReceiptId', 'qualificationReceiptId',
  'deliveryReceiptId', 'learningReceiptId', 'traceId', 'executionId', 'attemptId'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function parse(value, fallback = {}) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function defaultClock() { return new Date().toISOString(); }

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
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

function rowObservation(row = {}) {
  return {
    observationId: clean(row.observation_id),
    traceId: clean(row.trace_id),
    sequence: Number(row.sequence || 0),
    idempotencyKey: clean(row.idempotency_key),
    kind: clean(row.kind),
    stage: clean(row.stage),
    status: clean(row.status),
    executionId: clean(row.execution_id),
    attemptId: clean(row.attempt_id),
    providerRequestId: clean(row.provider_request_id),
    routeReceiptId: clean(row.route_receipt_id),
    qualificationReceiptId: clean(row.qualification_receipt_id),
    deliveryReceiptId: clean(row.delivery_receipt_id),
    learningReceiptId: clean(row.learning_receipt_id),
    evidence: parse(row.evidence_json, {}),
    createdAt: clean(row.created_at)
  };
}

class EvidenceAuthority {
  constructor({ storeProvider = getStore, idFactory = defaultIdFactory, clock = defaultClock } = {}) {
    this.storeProvider = storeProvider;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  store() { return this.storeProvider(); }

  traceHeader(traceId, store = this.store()) {
    return store.db.prepare(`
      SELECT trace_id,route_test_id,trace_type,task,execution_mode,status,metadata_json,started_at,completed_at,updated_at
      FROM evidence_traces WHERE trace_id=?
    `).get(clean(traceId));
  }

  projectTrace(row, observations = []) {
    if (!row) return null;
    return {
      authority: AUTHORITY,
      schemaVersion: SCHEMA_VERSION,
      traceId: clean(row.trace_id),
      routeTestId: clean(row.route_test_id || row.trace_id),
      traceType: clean(row.trace_type),
      task: clean(row.task),
      executionMode: clean(row.execution_mode),
      status: clean(row.status),
      metadata: parse(row.metadata_json, {}),
      startedAt: clean(row.started_at),
      completedAt: clean(row.completed_at),
      updatedAt: clean(row.updated_at),
      observations
    };
  }

  startTrace(input = {}) {
    const store = this.store();
    const traceId = clean(input.traceId || input.routeTestId) || this.idFactory('trace');
    const routeTestId = clean(input.routeTestId) || (traceId.startsWith('route-test-') ? traceId : '');
    const existing = this.traceHeader(traceId, store);
    if (existing) return this.getTrace(traceId, store);
    const at = this.clock();
    const metadata = sanitizeValue(input) || {};
    store.db.prepare(`
      INSERT INTO evidence_traces(
        trace_id,route_test_id,trace_type,task,execution_mode,status,metadata_json,started_at,completed_at,updated_at
      ) VALUES(?,?,?,?,?,'running',?,?,?,?)
    `).run(
      traceId,
      routeTestId,
      clean(input.traceType) || 'generic',
      clean(input.task),
      clean(input.executionMode),
      JSON.stringify(metadata),
      at,
      '',
      at
    );
    return this.getTrace(traceId, store);
  }

  _append(store, input = {}) {
    const traceId = clean(input.traceId || input.routeTestId);
    if (!traceId) throw Object.assign(new Error('Evidence trace id is required'), { code: 'EVIDENCE_TRACE_ID_REQUIRED', status: 400 });
    const trace = this.traceHeader(traceId, store);
    if (!trace) throw Object.assign(new Error('Evidence trace not found'), { code: 'EVIDENCE_TRACE_NOT_FOUND', status: 404, traceId });
    const idempotencyKey = clean(input.idempotencyKey);
    if (!idempotencyKey) throw Object.assign(new Error('Evidence observation idempotency key is required'), { code: 'EVIDENCE_IDEMPOTENCY_KEY_REQUIRED', status: 400, traceId });
    const existing = store.db.prepare('SELECT * FROM evidence_observations WHERE trace_id=? AND idempotency_key=?').get(traceId, idempotencyKey);
    if (existing) return rowObservation(existing);
    if (TERMINAL.has(clean(trace.status)) && input.allowTerminalAppend !== true) {
      throw Object.assign(new Error('Evidence trace is already terminal'), { code: 'EVIDENCE_TRACE_TERMINAL', status: 409, traceId, traceStatus: clean(trace.status) });
    }
    const sequence = Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM evidence_observations WHERE trace_id=?').get(traceId)?.next || 1);
    const observationId = clean(input.observationId) || this.idFactory('observation');
    const at = clean(input.createdAt) || this.clock();
    const evidence = sanitizeValue(input.evidence || {}) || {};
    store.db.prepare(`
      INSERT INTO evidence_observations(
        observation_id,trace_id,sequence,idempotency_key,kind,stage,status,execution_id,attempt_id,
        provider_request_id,route_receipt_id,qualification_receipt_id,delivery_receipt_id,learning_receipt_id,
        evidence_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      observationId,
      traceId,
      sequence,
      idempotencyKey,
      clean(input.kind) || 'event',
      clean(input.stage) || 'observation',
      clean(input.status),
      clean(input.executionId),
      clean(input.attemptId),
      clean(input.providerRequestId),
      clean(input.routeReceiptId),
      clean(input.qualificationReceiptId),
      clean(input.deliveryReceiptId),
      clean(input.learningReceiptId),
      JSON.stringify(evidence),
      at
    );
    store.db.prepare('UPDATE evidence_traces SET updated_at=? WHERE trace_id=?').run(at, traceId);
    return rowObservation(store.db.prepare('SELECT * FROM evidence_observations WHERE observation_id=?').get(observationId));
  }

  appendObservation(input = {}) {
    const store = this.store();
    return store.transaction(() => this._append(store, input));
  }

  _terminal(input = {}, targetStatus, stage) {
    const store = this.store();
    const traceId = clean(input.traceId || input.routeTestId);
    return store.transaction(() => {
      const trace = this.traceHeader(traceId, store);
      if (!trace) throw Object.assign(new Error('Evidence trace not found'), { code: 'EVIDENCE_TRACE_NOT_FOUND', status: 404, traceId });
      const key = clean(input.idempotencyKey) || `${stage}:${targetStatus}`;
      const existing = store.db.prepare('SELECT * FROM evidence_observations WHERE trace_id=? AND idempotency_key=?').get(traceId, key);
      if (existing) return this.getTrace(traceId, store);
      const current = clean(trace.status);
      if (TERMINAL.has(current) && current !== targetStatus) {
        throw Object.assign(new Error(`Evidence trace already ${current}`), {
          code: 'EVIDENCE_TRACE_TERMINAL_CONFLICT', status: 409, traceId, currentStatus: current, requestedStatus: targetStatus
        });
      }
      if (current === targetStatus) return this.getTrace(traceId, store);
      const at = this.clock();
      const evidence = {
        ...(input.evidence && typeof input.evidence === 'object' ? input.evidence : {}),
        status: targetStatus,
        errorCode: clean(input.error?.code || input.error?.reasonCode),
        reasonCode: clean(input.error?.reasonCode || input.error?.code)
      };
      this._append(store, {
        traceId,
        idempotencyKey: key,
        kind: 'event',
        stage,
        status: targetStatus,
        executionId: input.executionId,
        attemptId: input.attemptId,
        providerRequestId: input.providerRequestId,
        routeReceiptId: input.routeReceiptId,
        qualificationReceiptId: input.qualificationReceiptId,
        deliveryReceiptId: input.deliveryReceiptId,
        learningReceiptId: input.learningReceiptId,
        evidence,
        createdAt: at,
        allowTerminalAppend: true
      });
      store.db.prepare('UPDATE evidence_traces SET status=?,completed_at=?,updated_at=? WHERE trace_id=?').run(targetStatus, at, at, traceId);
      return this.getTrace(traceId, store);
    });
  }

  completeTrace(input = {}) { return this._terminal(input, 'completed', clean(input.stage) || 'trace-completed'); }
  failTrace(input = {}) { return this._terminal(input, 'failed', clean(input.stage) || 'trace-failed'); }
  cancelTrace(input = {}) { return this._terminal(input, 'cancelled', clean(input.stage) || 'trace-cancelled'); }

  getTrace(traceId, store = this.store()) {
    const row = this.traceHeader(traceId, store);
    if (!row) return null;
    const observations = store.db.prepare('SELECT * FROM evidence_observations WHERE trace_id=? ORDER BY sequence ASC').all(clean(traceId)).map(rowObservation);
    return this.projectTrace(row, observations);
  }

  recentTraces(limit = 50) {
    const store = this.store();
    const bounded = Math.max(1, Math.min(200, Number(limit || 50)));
    const rows = store.db.prepare(`
      SELECT trace_id,route_test_id,trace_type,task,execution_mode,status,metadata_json,started_at,completed_at,updated_at
      FROM evidence_traces ORDER BY started_at DESC,trace_id DESC LIMIT ?
    `).all(bounded);
    return rows.map(row => this.projectTrace(row, store.db.prepare('SELECT * FROM evidence_observations WHERE trace_id=? ORDER BY sequence ASC').all(row.trace_id).map(rowObservation)));
  }
}

const evidenceAuthority = new EvidenceAuthority();
module.exports = evidenceAuthority;
module.exports.EvidenceAuthority = EvidenceAuthority;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.sanitizeValue = sanitizeValue;
