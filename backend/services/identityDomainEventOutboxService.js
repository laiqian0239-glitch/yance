'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function nextRetry(attempts) { return new Date(Date.now() + Math.min(300, Math.max(5, 2 ** Math.min(8, Number(attempts || 0)))) * 1000).toISOString(); }
function parse(value) { try { return JSON.parse(value || '{}') || {}; } catch (_) { return {}; } }

class IdentityDomainEventOutboxService {
  constructor(options = {}) {
    this.storeProvider = options.storeProvider || getStore;
    this.intervalMs = Math.max(5000, Number(options.intervalMs || process.env.YANCE_IDENTITY_EVENT_OUTBOX_INTERVAL_MS || 30000));
    this.timer = null;
    this.finalizer = null;
    this.running = false;
    this.leaseMs = Math.max(5000, Number(options.leaseMs || process.env.YANCE_IDENTITY_EVENT_OUTBOX_LEASE_MS || 60000));
  }

  enqueue(observation = {}, cause = {}, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const pending = observation?.pendingDomainEvent || {};
    const auditId = clean(pending.auditId || observation.auditId);
    const eventType = clean(pending.eventType) || 'identity.link.observed';
    if (!auditId) {
      const error = new Error('Identity domain-event outbox requires auditId');
      error.code = 'IDENTITY_DOMAIN_EVENT_OUTBOX_SCOPE_INCOMPLETE';
      throw error;
    }
    const outboxId = `identity-event-outbox-${crypto.createHash('sha256').update(`${auditId}\u001f${eventType}`).digest('hex').slice(0, 32)}`;
    const at = nowIso();
    store.db.prepare(`INSERT INTO identity_domain_event_outbox(
      outbox_id,audit_id,event_type,payload_json,state,attempts,last_error,next_attempt_at,created_at,updated_at
    ) VALUES(?,?,?,?, 'pending',0,?,?,?,?)
    ON CONFLICT(audit_id,event_type) DO UPDATE SET
      payload_json=excluded.payload_json,state=CASE WHEN identity_domain_event_outbox.state='sent' THEN 'sent' ELSE 'pending' END,
      last_error=CASE WHEN identity_domain_event_outbox.state='sent' THEN identity_domain_event_outbox.last_error ELSE excluded.last_error END,
      next_attempt_at=CASE WHEN identity_domain_event_outbox.state='sent' THEN identity_domain_event_outbox.next_attempt_at ELSE excluded.next_attempt_at END,
      updated_at=excluded.updated_at`)
      .run(outboxId, auditId, eventType, JSON.stringify({ observation }), clean(cause?.message || cause?.code).slice(0, 1000), at, at, at);
    return this.get(outboxId, store);
  }

  get(outboxId, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const row = store.db.prepare('SELECT * FROM identity_domain_event_outbox WHERE outbox_id=?').get(clean(outboxId));
    return row ? { ...row, payload: parse(row.payload_json) } : null;
  }

  list(input = {}, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const state = clean(input.state);
    const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));
    const rows = state
      ? store.db.prepare('SELECT * FROM identity_domain_event_outbox WHERE state=? ORDER BY created_at LIMIT ?').all(state, limit)
      : store.db.prepare('SELECT * FROM identity_domain_event_outbox ORDER BY created_at LIMIT ?').all(limit);
    return rows.map(row => ({ ...row, payload: parse(row.payload_json) }));
  }

  recoverExpiredLeases(storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const at = nowIso();
    const recovered = store.db.prepare(`UPDATE identity_domain_event_outbox
      SET state='failed',claim_token='',locked_at='',lease_expires_at='',
          last_error='PROCESSING_LEASE_EXPIRED',next_attempt_at=?,updated_at=?
      WHERE state='processing' AND lease_expires_at<>'' AND lease_expires_at<=?`)
      .run(at, at, at);
    return Number(recovered.changes || 0);
  }

  async drainOnce(finalizer = this.finalizer, storeOverride = null) {
    if (this.running || typeof finalizer !== 'function') return { claimed: 0, sent: 0, failed: 0, recovered: 0 };
    this.running = true;
    const store = storeOverride || this.storeProvider();
    const summary = { claimed: 0, sent: 0, failed: 0, recovered: 0 };
    try {
      summary.recovered = this.recoverExpiredLeases(store);
      const due = store.db.prepare(`SELECT * FROM identity_domain_event_outbox
        WHERE state IN ('pending','failed') AND (next_attempt_at='' OR next_attempt_at<=?)
        ORDER BY created_at LIMIT 20`).all(nowIso());
      for (const row of due) {
        const claimToken = crypto.randomUUID();
        const claimedAt = nowIso();
        const leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();
        const claimed = store.db.prepare(`UPDATE identity_domain_event_outbox
          SET state='processing',attempts=attempts+1,claim_token=?,locked_at=?,lease_expires_at=?,updated_at=?
          WHERE outbox_id=? AND state IN ('pending','failed')`)
          .run(claimToken, claimedAt, leaseExpiresAt, claimedAt, row.outbox_id);
        if (!claimed.changes) continue;
        summary.claimed += 1;
        const current = this.get(row.outbox_id, store);
        try {
          await finalizer(current?.payload?.observation || {});
          const completedAt = nowIso();
          const completed = store.db.prepare(`UPDATE identity_domain_event_outbox
            SET state='sent',last_error='',next_attempt_at='',claim_token='',locked_at='',lease_expires_at='',updated_at=?
            WHERE outbox_id=? AND state='processing' AND claim_token=?`)
            .run(completedAt, row.outbox_id, claimToken);
          if (Number(completed.changes || 0) !== 1) {
            const stale = new Error('Stale identity outbox completion rejected');
            stale.code = 'IDENTITY_OUTBOX_STALE_COMPLETION';
            throw stale;
          }
          summary.sent += 1;
        } catch (cause) {
          const attempts = Number(current?.attempts || row.attempts || 0);
          const failed = store.db.prepare(`UPDATE identity_domain_event_outbox
            SET state='failed',last_error=?,next_attempt_at=?,claim_token='',locked_at='',lease_expires_at='',updated_at=?
            WHERE outbox_id=? AND state='processing' AND claim_token=?`)
            .run(clean(cause?.message || cause?.code || 'IDENTITY_DOMAIN_EVENT_FINALIZATION_FAILED').slice(0, 1000), nextRetry(attempts), nowIso(), row.outbox_id, claimToken);
          if (Number(failed.changes || 0) === 1) summary.failed += 1;
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  start(finalizer) {
    if (typeof finalizer === 'function') this.finalizer = finalizer;
    if (this.timer || typeof this.finalizer !== 'function') return;
    this.timer = setInterval(() => this.drainOnce().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
    setImmediate(() => this.drainOnce().catch(() => {}));
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

const singleton = new IdentityDomainEventOutboxService();
module.exports = { IdentityDomainEventOutboxService, singleton };
