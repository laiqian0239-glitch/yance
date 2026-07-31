'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');

function clean(value, max = 2000) { return String(value == null ? '' : value).trim().slice(0, max); }
function now() { return new Date().toISOString(); }

function ensure(store = getStore()) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS send_outcome_reconciliation_audit (
      audit_id TEXT PRIMARY KEY,
      queue_id TEXT NOT NULL,
      resolution TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_type TEXT NOT NULL DEFAULT '',
      evidence_id TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      previous_state TEXT NOT NULL DEFAULT '',
      resulting_state TEXT NOT NULL DEFAULT '',
      platform_message_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      CHECK(resolution IN ('confirmed_sent','confirmed_not_sent','cancelled','evidence_inconclusive'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_send_outcome_reconciliation_queue
      ON send_outcome_reconciliation_audit(queue_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_send_outcome_reconciliation_evidence
      ON send_outcome_reconciliation_audit(evidence_type, evidence_id);
  `);
}

function normalize(row) {
  if (!row) return null;
  return {
    auditId: row.audit_id,
    queueId: row.queue_id,
    resolution: row.resolution,
    actor: row.actor,
    reason: row.reason,
    evidenceType: row.evidence_type,
    evidenceId: row.evidence_id,
    evidence: parseJson(row.evidence_json, {}) || {},
    previousState: row.previous_state,
    resultingState: row.resulting_state,
    platformMessageId: row.platform_message_id,
    createdAt: row.created_at
  };
}

function record(input = {}, store = getStore()) {
  ensure(store);
  const timestamp = clean(input.createdAt || now(), 80);
  const auditId = clean(input.auditId, 120) || `send-outcome-audit-${crypto.randomUUID()}`;
  const resolution = clean(input.resolution, 80).toLowerCase();
  if (!['confirmed_sent', 'confirmed_not_sent', 'cancelled', 'evidence_inconclusive'].includes(resolution)) {
    const error = new Error('发送结果对账审计结论无效');
    error.code = 'SEND_OUTCOME_AUDIT_RESOLUTION_INVALID';
    throw error;
  }
  const queueId = clean(input.queueId, 180);
  const actor = clean(input.actor, 180);
  const reason = clean(input.reason, 1200);
  if (!queueId || !actor || !reason) {
    const error = new Error('发送结果对账审计缺少任务、操作者或原因');
    error.code = 'SEND_OUTCOME_AUDIT_FIELDS_REQUIRED';
    throw error;
  }
  store.db.prepare(`
    INSERT INTO send_outcome_reconciliation_audit(
      audit_id,queue_id,resolution,actor,reason,evidence_type,evidence_id,evidence_json,
      previous_state,resulting_state,platform_message_id,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    auditId,
    queueId,
    resolution,
    actor,
    reason,
    clean(input.evidenceType, 120),
    clean(input.evidenceId, 300),
    JSON.stringify(input.evidence && typeof input.evidence === 'object' ? input.evidence : {}),
    clean(input.previousState, 80),
    clean(input.resultingState, 80),
    clean(input.platformMessageId, 500),
    timestamp
  );
  return normalize(store.db.prepare('SELECT * FROM send_outcome_reconciliation_audit WHERE audit_id=?').get(auditId));
}

function list(input = {}, store = getStore()) {
  ensure(store);
  const limit = Math.max(1, Math.min(1000, Number(input.limit || 100)));
  const queueId = clean(input.queueId, 180);
  const rows = queueId
    ? store.db.prepare('SELECT * FROM send_outcome_reconciliation_audit WHERE queue_id=? ORDER BY created_at DESC LIMIT ?').all(queueId, limit)
    : store.db.prepare('SELECT * FROM send_outcome_reconciliation_audit ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(normalize);
}

function latest(queueId, store = getStore()) {
  ensure(store);
  return normalize(store.db.prepare('SELECT * FROM send_outcome_reconciliation_audit WHERE queue_id=? ORDER BY created_at DESC LIMIT 1').get(clean(queueId, 180)));
}

module.exports = { ensure, record, list, latest };
