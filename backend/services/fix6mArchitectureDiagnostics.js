'use strict';

const { getStore } = require('../repositories/storeProvider');
const architectureShadowGate = require('./architectureShadowGate');

const AUTHORITY = 'Fix6MArchitectureDiagnostics';
const SCHEMA_VERSION = 1;
const RANK = Object.freeze({ pass: 0, skipped: 0, warning: 1, fail: 2 });
function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultClock() { return new Date(); }
function mergeDiagnosticTruth(local = {}, authority = {}) {
  const localStatus = clean(local.status || (local.pass === false ? 'fail' : 'pass')) || 'pass';
  const authorityStatus = clean(authority.status || (authority.pass === false ? 'fail' : 'pass')) || 'pass';
  const status = (RANK[authorityStatus] || 0) > (RANK[localStatus] || 0) ? authorityStatus : localStatus;
  return { ...local, ...authority, detail: local.detail || authority.detail || '', status, pass: status === 'pass' };
}
function scalar(db, sql, ...params) { return Number(db.prepare(sql).get(...params)?.count || 0); }

class Fix6MArchitectureDiagnostics {
  constructor({ storeProvider = getStore, shadowGate = architectureShadowGate, clock = defaultClock } = {}) { this.storeProvider = storeProvider; this.shadowGate = shadowGate; this.clock = clock; }
  snapshot(options = {}) {
    try {
      const store = this.storeProvider(); const db = store.db; const now = this.clock(); const stalledCutoff = new Date(now.getTime() - Math.max(60000, Number(options.stalledAfterMs || 15 * 60 * 1000))).toISOString();
      const counts = {
        activeExecutions: scalar(db, `SELECT COUNT(*) AS count FROM durable_executions WHERE state IN ('CREATED','SCHEDULED','RUNNING','WAITING_REMOTE','RETRY_SCHEDULED','CANCEL_REQUESTED')`),
        stalledExecutions: scalar(db, `SELECT COUNT(*) AS count FROM durable_executions WHERE state IN ('RUNNING','WAITING_REMOTE') AND COALESCE(NULLIF(last_heartbeat_at,''),updated_at) < ?`, stalledCutoff),
        deadLetteredExecutions: scalar(db, `SELECT COUNT(*) AS count FROM durable_executions WHERE state='DEAD_LETTERED'`),
        retryableMediaFailures: scalar(db, `SELECT COUNT(*) AS count FROM communication_media_assets WHERE state='FAILED_RETRYABLE'`),
        permanentMediaFailures: scalar(db, `SELECT COUNT(*) AS count FROM communication_media_assets WHERE state='FAILED_PERMANENT'`),
        openSyncGaps: scalar(db, `SELECT COUNT(*) AS count FROM communication_sync_checkpoints WHERE gap_closed=0`),
        uncertainDeliveries: scalar(db, `SELECT COUNT(*) AS count FROM communication_delivery_attempts WHERE state IN ('CREATED','UNKNOWN') AND updated_at < ?`, stalledCutoff),
        pendingRelationshipAssertions: scalar(db, `SELECT COUNT(*) AS count FROM relationship_assertions_v2 a WHERE (SELECT action FROM relationship_assertion_events e WHERE e.assertion_id=a.assertion_id ORDER BY sequence DESC LIMIT 1)='created'`),
        pendingLearningReceipts: scalar(db, `SELECT COUNT(*) AS count FROM ai_learning_receipts_v2 a WHERE (SELECT action FROM ai_learning_receipt_events e WHERE e.learning_receipt_id=a.learning_receipt_id ORDER BY sequence DESC LIMIT 1) IN ('created','approve','start-shadow')`)
      };
      const shadowGate = this.shadowGate.evaluate({ authorities: options.shadowAuthorities || ['communication','contact-relationship','ai-learning'], minSamples: options.shadowMinSamples || 100, windowSize: options.shadowWindowSize || 1000 });
      const fail = counts.stalledExecutions > 0 || counts.deadLetteredExecutions > 0 || counts.openSyncGaps > 0 || shadowGate.mismatches > 0;
      const warning = !fail && (counts.retryableMediaFailures > 0 || counts.permanentMediaFailures > 0 || counts.uncertainDeliveries > 0 || !shadowGate.pass);
      return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, status: fail ? 'fail' : warning ? 'warning' : 'pass', pass: !fail && !warning, reasonCode: fail ? 'FIX6M_ARCHITECTURE_AUTHORITY_BLOCKED' : warning ? 'FIX6M_ARCHITECTURE_AUTHORITY_DEGRADED' : 'FIX6M_ARCHITECTURE_AUTHORITY_READY', counts, shadowGate, checkedAt: now.toISOString() };
    } catch (error) {
      return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, status: 'warning', pass: false, reasonCode: clean(error.code || 'FIX6M_ARCHITECTURE_DIAGNOSTICS_UNAVAILABLE'), counts: {}, shadowGate: { pass: false, samples: 0, mismatches: 0, authorities: [] }, checkedAt: this.clock().toISOString() };
    }
  }
}

const singleton = new Fix6MArchitectureDiagnostics();
module.exports = singleton;
module.exports.Fix6MArchitectureDiagnostics = Fix6MArchitectureDiagnostics;
module.exports.mergeDiagnosticTruth = mergeDiagnosticTruth;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
