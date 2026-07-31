'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, CONFIG } = require('../config');
const { sanitizeObject } = require('./privacy');

const TRACE_FILE = path.join(PATHS.logs, 'production-diagnostics.jsonl');
const MAX_RECENT = 500;
const MAX_ACTIVE_AGE_MS = 30 * 60 * 1000;
const ROTATE_BYTES = Math.max(1024 * 1024, Number(process.env.YANCE_DIAGNOSTICS_ROTATE_BYTES || 5 * 1024 * 1024));
const recent = [];
const active = new Map();

function now() { return new Date().toISOString(); }
function clean(value, max = 300) { return String(value == null ? '' : value).trim().slice(0, max); }

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(TRACE_FILE) || fs.statSync(TRACE_FILE).size < ROTATE_BYTES) return;
    const rotated = `${TRACE_FILE}.1`;
    if (fs.existsSync(rotated)) fs.rmSync(rotated, { force: true });
    fs.renameSync(TRACE_FILE, rotated);
  } catch (_) {}
}

function append(row) {
  const safe = sanitizeObject(row);
  recent.unshift(safe);
  recent.splice(MAX_RECENT);
  try {
    fs.mkdirSync(PATHS.logs, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(TRACE_FILE, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (_) {}
  return safe;
}

function beginOperation(input = {}) {
  const operationId = clean(input.operationId || crypto.randomUUID(), 120);
  const row = {
    type: 'operation-started',
    operationId,
    correlationId: clean(input.correlationId || operationId, 120),
    command: clean(input.command || 'unknown', 160),
    actor: clean(input.actor || 'system', 120),
    resource: clean(input.resource || '', 240),
    lifecycleState: clean(input.lifecycleState || '', 80),
    startedAt: now(),
    startedAtMs: Date.now()
  };
  active.set(operationId, row);
  append(row);
  return operationId;
}

function completeOperation(operationId, input = {}) {
  const started = active.get(operationId) || { operationId, startedAtMs: Date.now(), correlationId: clean(input.correlationId || operationId) };
  active.delete(operationId);
  return append({
    type: input.ok === false ? 'operation-failed' : 'operation-completed',
    operationId,
    correlationId: started.correlationId,
    command: started.command,
    actor: started.actor,
    resource: started.resource,
    lifecycleState: clean(input.lifecycleState || started.lifecycleState || '', 80),
    durationMs: Math.max(0, Date.now() - Number(started.startedAtMs || Date.now())),
    completedAt: now(),
    ok: input.ok !== false,
    code: clean(input.code || '', 120),
    message: clean(input.message || '', 800),
    metadata: sanitizeObject(input.metadata || {})
  });
}

function recordEvent(name, input = {}) {
  return append({
    type: 'event',
    name: clean(name || 'unnamed', 160),
    correlationId: clean(input.correlationId || '', 120),
    at: now(),
    severity: clean(input.severity || 'info', 40),
    metadata: sanitizeObject(input.metadata || input)
  });
}

function sweepStaleOperations() {
  const cutoff = Date.now() - MAX_ACTIVE_AGE_MS;
  for (const [id, row] of active.entries()) {
    if (Number(row.startedAtMs || 0) < cutoff) completeOperation(id, { ok: false, code: 'OPERATION_TIMEOUT_OBSERVED', message: '操作观测超过最大活动时间' });
  }
}

function readTraceFile(limit = 200) {
  try {
    if (!fs.existsSync(TRACE_FILE)) return [];
    return fs.readFileSync(TRACE_FILE, 'utf8').split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(1000, Number(limit || 200)))).map(line => {
      try { return sanitizeObject(JSON.parse(line)); } catch (_) { return null; }
    }).filter(Boolean).reverse();
  } catch (_) { return []; }
}

function snapshot(options = {}) {
  sweepStaleOperations();
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  return {
    schemaVersion: 1,
    product: CONFIG.product,
    generatedAt: now(),
    activeOperations: [...active.values()].map(row => sanitizeObject(row, { redactPaths: true })),
    recent: (recent.length ? recent.slice(0, limit) : readTraceFile(limit)).map(row => sanitizeObject(row, { redactPaths: true })),
    traceFile: path.basename(TRACE_FILE),
    limits: { recent: MAX_RECENT, activeAgeMs: MAX_ACTIVE_AGE_MS, rotateBytes: ROTATE_BYTES }
  };
}

module.exports = { TRACE_FILE, beginOperation, completeOperation, recordEvent, snapshot, readTraceFile };
