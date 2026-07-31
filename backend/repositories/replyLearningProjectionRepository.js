'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const resilientLeaseClock = require('../lib/resilientLeaseClock');

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return resilientLeaseClock.iso(); }
function asJson(value) { try { return JSON.stringify(value == null ? {} : value); } catch (_) { return '{}'; } }
function normalize(row) {
  if (!row) return null;
  return {
    jobId: row.job_id, evidenceId: row.evidence_id, contactId: row.contact_id,
    conversationId: row.conversation_id, state: row.state, scopeState: row.scope_state,
    l1State: row.l1_state, attempts: Number(row.attempts || 0), claimToken: row.claim_token,
    leaseGeneration: Number(row.lease_generation || 0), leaseExpiresAt: row.lease_expires_at,
    lastHeartbeatAt: row.last_heartbeat_at, nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error, finalFailureCode: row.final_failure_code, dlqAt: row.dlq_at,
    payload: parseJson(row.payload_json, {}) || {},
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
  };
}

class ReplyLearningProjectionRepository {
  constructor(options = {}) { this.store = options.store || null; }
  resolveStore() { return this.store || getStore(); }

  recoverExpired(now = nowIso()) {
    const store = this.resolveStore();
    return Number(store.db.prepare(`UPDATE reply_learning_projection_jobs
      SET state='retry',claim_token='',lease_expires_at='',next_attempt_at=?,
          last_error='LEARNING_PROJECTION_LEASE_EXPIRED',last_heartbeat_at=?,updated_at=?
      WHERE state='processing' AND lease_expires_at<>'' AND lease_expires_at<?`)
      .run(now, now, now, now).changes || 0);
  }

  claimNext(options = {}) {
    const store = this.resolveStore();
    const now = clean(options.now) || nowIso();
    const leaseMs = Math.max(5_000, Number(options.leaseMs || 60_000));
    return store.transaction(() => {
      this.recoverExpired(now);
      const row = store.db.prepare(`SELECT * FROM reply_learning_projection_jobs
        WHERE state IN ('pending','retry') AND (next_attempt_at='' OR next_attempt_at<=?)
        ORDER BY created_at,job_id LIMIT 1`).get(now);
      if (!row) return null;
      const token = crypto.randomUUID();
      const generation = Number(row.lease_generation || 0) + 1;
      const lease = new Date(Date.parse(now) + leaseMs).toISOString();
      const updated = store.db.prepare(`UPDATE reply_learning_projection_jobs
        SET state='processing',attempts=attempts+1,claim_token=?,lease_generation=?,
            lease_expires_at=?,last_heartbeat_at=?,updated_at=?
        WHERE job_id=? AND state IN ('pending','retry') AND lease_generation=?`)
        .run(token, generation, lease, now, now, row.job_id, Number(row.lease_generation || 0));
      if (Number(updated.changes || 0) !== 1) return null;
      return this.get(row.job_id);
    });
  }

  assertClaim(job, store = this.resolveStore()) {
    const row = store.db.prepare(`SELECT state,claim_token,lease_generation,lease_expires_at
      FROM reply_learning_projection_jobs WHERE job_id=?`).get(clean(job?.jobId));
    const valid = row && row.state === 'processing'
      && clean(row.claim_token) === clean(job?.claimToken)
      && Number(row.lease_generation || 0) === Number(job?.leaseGeneration || 0)
      && (!clean(row.lease_expires_at) || Date.parse(row.lease_expires_at) > resilientLeaseClock.now());
    if (!valid) throw Object.assign(new Error('Learning projection lease lost'), {
      code: 'LEARNING_PROJECTION_LEASE_LOST', jobId: clean(job?.jobId),
      expectedGeneration: Number(job?.leaseGeneration || 0), actualGeneration: Number(row?.lease_generation || 0)
    });
    return row;
  }

  heartbeat(job, options = {}) {
    const store = this.resolveStore();
    const at = clean(options.now) || nowIso();
    const leaseMs = Math.max(5_000, Number(options.leaseMs || 60_000));
    const lease = new Date(Date.parse(at) + leaseMs).toISOString();
    const result = store.db.prepare(`UPDATE reply_learning_projection_jobs
      SET lease_expires_at=?,last_heartbeat_at=?,updated_at=?
      WHERE job_id=? AND state='processing' AND claim_token=? AND lease_generation=?`)
      .run(lease, at, at, clean(job.jobId), clean(job.claimToken), Number(job.leaseGeneration || 0));
    if (Number(result.changes || 0) !== 1) this.assertClaim(job, store);
    return this.get(job.jobId);
  }

  applyEffectOnce(job, effectType, callback, executionContext = null) {
    const store = this.resolveStore();
    const type = clean(effectType);
    if (!['scope', 'l1'].includes(type)) throw Object.assign(new Error('Invalid learning projection effect'), { code: 'LEARNING_PROJECTION_EFFECT_INVALID' });
    return store.transaction(() => {
      executionContext?.assertCurrent?.();
      this.assertClaim(job, store);
      const prior = store.db.prepare(`SELECT effect_result_json,applied_at FROM reply_learning_projection_effects
        WHERE job_id=? AND effect_type=?`).get(clean(job.jobId), type);
      if (prior) return { replay: true, result: parseJson(prior.effect_result_json, {}) || {}, appliedAt: prior.applied_at };
      const result = typeof callback === 'function' ? callback() : null;
      const at = nowIso();
      store.db.prepare(`INSERT INTO reply_learning_projection_effects(job_id,effect_type,effect_result_json,applied_at)
        VALUES(?,?,?,?)`).run(clean(job.jobId), type, asJson(result), at);
      const column = type === 'scope' ? 'scope_state' : 'l1_state';
      const update = store.db.prepare(`UPDATE reply_learning_projection_jobs SET ${column}='completed',last_heartbeat_at=?,updated_at=?
        WHERE job_id=? AND state='processing' AND claim_token=? AND lease_generation=?`)
        .run(at, at, clean(job.jobId), clean(job.claimToken), Number(job.leaseGeneration || 0));
      if (Number(update.changes || 0) !== 1) throw Object.assign(new Error('Learning projection effect lease lost'), { code: 'LEARNING_PROJECTION_LEASE_LOST', jobId: job.jobId });
      return { replay: false, result, appliedAt: at };
    });
  }

  markScope(job, state = 'completed') { return this._markPart(job, 'scope_state', state); }
  markL1(job, state = 'completed', executionContext = null) { return this._markPart(job, 'l1_state', state, executionContext); }
  _markPart(job, column, state, executionContext = null) {
    const store = this.resolveStore(); const at = nowIso();
    executionContext?.assertCurrent?.();
    const result = store.db.prepare(`UPDATE reply_learning_projection_jobs SET ${column}=?,updated_at=?
      WHERE job_id=? AND state='processing' AND claim_token=? AND lease_generation=?`)
      .run(clean(state), at, clean(job.jobId), clean(job.claimToken), Number(job.leaseGeneration || 0));
    if (Number(result.changes || 0) !== 1) this.assertClaim(job, store);
    return this.get(job.jobId);
  }

  complete(job, executionContext = null) {
    const store = this.resolveStore(); const at = nowIso();
    executionContext?.assertCurrent?.();
    const result = store.db.prepare(`UPDATE reply_learning_projection_jobs
      SET state='completed',scope_state=CASE WHEN scope_state='pending' THEN 'completed' ELSE scope_state END,
          l1_state=CASE WHEN l1_state='pending' THEN 'skipped' ELSE l1_state END,
          claim_token='',lease_expires_at='',next_attempt_at='',last_error='',final_failure_code='',dlq_at='',completed_at=?,updated_at=?
      WHERE job_id=? AND state='processing' AND claim_token=? AND lease_generation=?`)
      .run(at, at, clean(job.jobId), clean(job.claimToken), Number(job.leaseGeneration || 0));
    if (Number(result.changes || 0) !== 1) this.assertClaim(job, store);
    return this.get(job.jobId);
  }

  fail(job, error, options = {}) {
    const store = this.resolveStore(); const at = nowIso();
    const maxAttempts = Math.max(1, Number(options.maxAttempts || 8));
    const current = this.get(job.jobId);
    const retry = Number(current?.attempts || 0) < maxAttempts;
    const next = retry ? new Date(resilientLeaseClock.now() + Math.min(300_000, 5_000 * (2 ** Math.max(0, Number(current?.attempts || 1) - 1)))).toISOString() : '';
    const code = clean(error?.code || error?.message || error).slice(0, 2000) || 'LEARNING_PROJECTION_FAILED';
    const result = store.db.prepare(`UPDATE reply_learning_projection_jobs
      SET state=?,claim_token='',lease_expires_at='',next_attempt_at=?,last_error=?,
          final_failure_code=?,dlq_at=?,updated_at=?
      WHERE job_id=? AND state='processing' AND claim_token=? AND lease_generation=?`)
      .run(retry ? 'retry' : 'failed', next, code, retry ? '' : code, retry ? '' : at, at,
        clean(job.jobId), clean(job.claimToken), Number(job.leaseGeneration || 0));
    return { updated: Number(result.changes || 0) === 1, retry, deadLetter: !retry, nextAttemptAt: next, job: this.get(job.jobId) };
  }

  get(jobId) { return normalize(this.resolveStore().db.prepare('SELECT * FROM reply_learning_projection_jobs WHERE job_id=?').get(clean(jobId))); }

  ledger() {
    const store = this.resolveStore();
    const now = nowIso();
    const aggregate = store.db.prepare(`SELECT
      SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN state='processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN state='retry' THEN 1 ELSE 0 END) AS retry,
      SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN state='retry' AND (next_attempt_at='' OR next_attempt_at<=?) THEN 1 ELSE 0 END) AS retry_due,
      SUM(CASE WHEN state='retry' AND next_attempt_at>? THEN 1 ELSE 0 END) AS retry_deferred,
      MIN(CASE WHEN state='pending' OR (state='retry' AND (next_attempt_at='' OR next_attempt_at<=?)) THEN created_at END) AS oldest_ready,
      MIN(CASE WHEN state IN ('pending','processing','retry') THEN created_at END) AS oldest_unresolved,
      MIN(CASE WHEN state='failed' THEN created_at END) AS oldest_dead_letter
      FROM reply_learning_projection_jobs`).get(now, now, now) || {};
    const counts = {
      pending: Number(aggregate.pending || 0),
      processing: Number(aggregate.processing || 0),
      retry: Number(aggregate.retry || 0),
      completed: Number(aggregate.completed || 0),
      failed: Number(aggregate.failed || 0)
    };
    const retryDue = Number(aggregate.retry_due || 0);
    const retryDeferred = Number(aggregate.retry_deferred || 0);
    const ready = counts.pending + retryDue;
    const unresolved = counts.pending + counts.processing + counts.retry;
    const oldestReadyAt = clean(aggregate.oldest_ready);
    const oldestUnresolvedAt = clean(aggregate.oldest_unresolved);
    return {
      ...counts,
      ready,
      active: counts.processing,
      retryDue,
      retryDeferred,
      executable: unresolved,
      unresolved,
      deadLetter: counts.failed,
      totalUnfinished: unresolved + counts.failed,
      oldestReadyAt,
      oldestUnresolvedAt,
      oldestDeadLetterAt: clean(aggregate.oldest_dead_letter),
      // Compatibility alias retained for existing status consumers. It means oldest unresolved, not necessarily due.
      oldestExecutableAt: oldestUnresolvedAt
    };
  }
  countUnresolved() { return this.ledger().executable; }
  countAllUnfinished() { return this.ledger().totalUnfinished; }

  list(options = {}) {
    const state = clean(options.state); const limit = Math.max(1, Math.min(5000, Number(options.limit || 500)));
    const rows = state
      ? this.resolveStore().db.prepare('SELECT * FROM reply_learning_projection_jobs WHERE state=? ORDER BY updated_at,job_id LIMIT ?').all(state, limit)
      : this.resolveStore().db.prepare('SELECT * FROM reply_learning_projection_jobs ORDER BY updated_at,job_id LIMIT ?').all(limit);
    return rows.map(normalize);
  }

  recordSourceFailure(input = {}, options = {}) {
    const store = this.resolveStore(); const at = nowIso();
    const sourceKey = clean(input.sourceKey); const sourceType = clean(input.sourceType);
    if (!sourceKey || !['sent','rejected'].includes(sourceType)) return null;
    const maxAttempts = Math.max(1, Number(options.maxAttempts || 8));
    return store.transaction(() => {
      const previous = store.db.prepare('SELECT * FROM reply_learning_source_reconciliation WHERE source_key=?').get(sourceKey);
      const attempts = Number(previous?.attempts || 0) + 1;
      const retry = attempts < maxAttempts;
      const code = clean(input.error?.code || input.error?.message || input.error).slice(0, 2000) || 'LEARNING_SOURCE_RECONCILIATION_FAILED';
      const next = retry ? new Date(resilientLeaseClock.now() + Math.min(300_000, 5_000 * (2 ** Math.max(0, attempts - 1)))).toISOString() : '';
      store.db.prepare(`INSERT INTO reply_learning_source_reconciliation(
        source_key,source_type,source_entity_id,state,attempts,next_attempt_at,last_error,final_failure_code,dlq_at,created_at,updated_at
      ) VALUES(?,?,?, ?,?,?,?,?,?,?,?)
      ON CONFLICT(source_key) DO UPDATE SET state=excluded.state,attempts=excluded.attempts,
        next_attempt_at=excluded.next_attempt_at,last_error=excluded.last_error,
        final_failure_code=excluded.final_failure_code,dlq_at=excluded.dlq_at,updated_at=excluded.updated_at`)
        .run(sourceKey, sourceType, clean(input.sourceEntityId), retry ? 'retry' : 'dead_letter', attempts,
          next, code, retry ? '' : code, retry ? '' : at, previous?.created_at || at, at);
      return { sourceKey, sourceType, attempts, retry, deadLetter: !retry, nextAttemptAt: next, errorCode: code };
    });
  }

  markSourceCompleted(input = {}) {
    const store = this.resolveStore(); const at = nowIso();
    const sourceKey = clean(input.sourceKey); const sourceType = clean(input.sourceType);
    if (!sourceKey || !['sent','rejected'].includes(sourceType)) return null;
    store.db.prepare(`INSERT INTO reply_learning_source_reconciliation(
      source_key,source_type,source_entity_id,state,attempts,next_attempt_at,last_error,final_failure_code,dlq_at,created_at,updated_at
    ) VALUES(?,?,?,'completed',0,'','','','',?,?)
    ON CONFLICT(source_key) DO UPDATE SET state='completed',next_attempt_at='',last_error='',final_failure_code='',dlq_at='',updated_at=excluded.updated_at`)
      .run(sourceKey, sourceType, clean(input.sourceEntityId), at, at);
    return { sourceKey, state: 'completed' };
  }

  sourceLedger() {
    const store = this.resolveStore();
    const now = nowIso();
    const aggregate = store.db.prepare(`SELECT
      SUM(CASE WHEN state='retry' THEN 1 ELSE 0 END) AS retryable,
      SUM(CASE WHEN state='retry' AND (next_attempt_at='' OR next_attempt_at<=?) THEN 1 ELSE 0 END) AS retry_due,
      SUM(CASE WHEN state='retry' AND next_attempt_at>? THEN 1 ELSE 0 END) AS retry_deferred,
      SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN state='dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
      MIN(CASE WHEN state='retry' THEN created_at END) AS oldest_retry,
      MIN(CASE WHEN state='retry' AND (next_attempt_at='' OR next_attempt_at<=?) THEN created_at END) AS oldest_due,
      MIN(CASE WHEN state='dead_letter' THEN created_at END) AS oldest_dead_letter
      FROM reply_learning_source_reconciliation`).get(now, now, now) || {};
    return {
      retryable: Number(aggregate.retryable || 0),
      retryDue: Number(aggregate.retry_due || 0),
      retryDeferred: Number(aggregate.retry_deferred || 0),
      completed: Number(aggregate.completed || 0),
      deadLetter: Number(aggregate.dead_letter || 0),
      unresolved: Number(aggregate.retryable || 0),
      oldestRetryAt: clean(aggregate.oldest_retry),
      oldestDueAt: clean(aggregate.oldest_due),
      oldestDeadLetterAt: clean(aggregate.oldest_dead_letter)
    };
  }

  writeLedgerSnapshot(payload = {}) {
    const store = this.resolveStore(); const at = nowIso();
    const projection = payload.projection || this.ledger();
    const source = payload.source || this.sourceLedger();
    store.db.prepare(`INSERT INTO reply_learning_reconciliation_ledger(
      ledger_id,source_pending,source_retryable,source_dead_letter,
      projection_pending,projection_processing,projection_retryable,projection_dead_letter,projection_completed,
      oldest_source_at,oldest_projection_at,payload_json,updated_at
    ) VALUES('current',?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(ledger_id) DO UPDATE SET source_pending=excluded.source_pending,source_retryable=excluded.source_retryable,
      source_dead_letter=excluded.source_dead_letter,projection_pending=excluded.projection_pending,
      projection_processing=excluded.projection_processing,projection_retryable=excluded.projection_retryable,
      projection_dead_letter=excluded.projection_dead_letter,projection_completed=excluded.projection_completed,
      oldest_source_at=excluded.oldest_source_at,oldest_projection_at=excluded.oldest_projection_at,
      payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(Number(payload.sourcePending || 0), Number(source.retryable || 0), Number(source.deadLetter || 0),
        Number(projection.pending || 0), Number(projection.processing || 0), Number(projection.retry || 0),
        Number(projection.deadLetter || 0), Number(projection.completed || 0),
        clean(source.oldestRetryAt), clean(projection.oldestExecutableAt), asJson(payload), at);
    return { source, projection, sourcePending: Number(payload.sourcePending || 0), updatedAt: at };
  }
}

module.exports = { ReplyLearningProjectionRepository, normalize };
