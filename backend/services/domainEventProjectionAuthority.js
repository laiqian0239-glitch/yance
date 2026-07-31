'use strict';

const { singleton: repository } = require('../repositories/platformCoreRepository');
const domainEventLog = require('./domainEventLogService').singleton;
const messageStore = require('./messageStore');
const { projectMessage, projectDomainEvent } = require('./domainMessageProjector');
const operationalProjector = require('./domainOperationalProjector');
const eventBus = require('./eventBus');
const logger = require('./logger');

const AUTHORITY = 'DomainEventProjectionAuthority';
const PROJECTOR_NAME = 'message-projection';
const PROJECTOR_VERSION = 'round12-v2';
const OPERATIONAL_PROJECTOR_NAME = 'operational-projection';
const OPERATIONAL_PROJECTOR_VERSION = 'round13-v2';

function clean(value) { return String(value == null ? '' : value).trim(); }
function same(left, right) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }
function sameProjection(left, right) { return same(projectMessage(left || {}), projectMessage(right || {})); }
function bounded(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function projectorFor(event = {}) {
  const type = clean(event.event_type || event.eventType);
  if (type === 'message.received') return { name: PROJECTOR_NAME, version: PROJECTOR_VERSION, kind: 'message' };
  if (operationalProjector.supported(type)) return { name: OPERATIONAL_PROJECTOR_NAME, version: OPERATIONAL_PROJECTOR_VERSION, kind: 'operational' };
  return null;
}

class DomainEventProjectionAuthority {
  constructor(options = {}) {
    this.repository = options.repository || repository;
    this.eventLog = options.eventLog || domainEventLog;
    this.messageStore = options.messageStore || messageStore;
    this.eventBus = options.eventBus || eventBus;
    this.logger = options.logger || logger;
    this.lastAudit = null;
    this.liveTimers = new Map();
    this.boundAppend = null;
    this.jobTimer = null;
    this.jobDrainRunning = false;
    this.jobIntervalMs = Math.max(5000, Number(options.jobIntervalMs || process.env.YANCE_DOMAIN_PROJECTION_JOB_INTERVAL_MS || 30000));
  }


  scheduleLiveAudit(eventId) {
    const id = clean(eventId); if (!id) return;
    const previous = this.liveTimers.get(id) || [];
    for (const timer of previous) clearTimeout(timer);
    const timers = [150, 1200, 5000].map((delay, index) => setTimeout(() => {
      try {
        const event = this.repository.getDomainEvent(id); if (!event) return;
        const result = { applied: 0, mismatch: 0, missing: 0, skipped: 0, failures: [] };
        this.auditEvent(event, result);
        if (result.applied > 0 || result.skipped > 0 || index === 2) {
          for (const pending of this.liveTimers.get(id) || []) clearTimeout(pending);
          this.liveTimers.delete(id);
        }
      } catch (error) {
        if (index === 2) this.logger.warn('domain-event', 'live-projection-audit-failed', { eventId: id, code: error.code || 'DOMAIN_EVENT_LIVE_AUDIT_FAILED', error: error.message });
      }
    }, delay));
    this.liveTimers.set(id, timers);
  }

  convergence() {
    const rows = [
      this.eventLog.convergence({ projectorName: PROJECTOR_NAME, projectorVersion: PROJECTOR_VERSION }),
      this.eventLog.convergence({ projectorName: OPERATIONAL_PROJECTOR_NAME, projectorVersion: OPERATIONAL_PROJECTOR_VERSION })
    ];
    const total = rows.reduce((n, row) => n + Number(row.total || 0), 0);
    const applied = rows.reduce((n, row) => n + Number(row.applied || 0), 0);
    const matched = rows.reduce((n, row) => n + Number(row.matched || 0), 0);
    const blocking = rows.reduce((n, row) => n + Number(row.blocking || 0), 0);
    return { projectorName: 'all-domain-projectors', projectorVersion: 'round13', total, applied, matched, blocking, converged: blocking === 0 && matched === total, projectors: rows };
  }

  auditEvent(event, result) {
    const projector = projectorFor(event);
    if (!projector) {
      result.skipped += 1;
      this.repository.upsertProjectionReceipt({ projectorName: OPERATIONAL_PROJECTOR_NAME, projectorVersion: OPERATIONAL_PROJECTOR_VERSION, eventId: event.event_id, projectionStatus: 'skipped', projectionHash: '', targetRefs: [], failureCode: 'DOMAIN_EVENT_PROJECTOR_UNSUPPORTED', failureReason: `eventType=${clean(event.event_type)}`, attempt: 1, projectedAt: new Date().toISOString() });
      return;
    }
    if (clean(event.replay_state) === 'expired') { result.skipped += 1; return; }
    if (projector.kind === 'message') {
      const projection = projectDomainEvent({ ...event, payload: event.payload || {} });
      const messageId = clean(projection.id);
      const saved = messageId ? this.messageStore.getMessageByDedupeKey(messageId) : null;
      if (!saved) {
        result.missing += 1; result.failures.push({ eventId: event.event_id, messageId, code: 'DOMAIN_EVENT_TARGET_MESSAGE_MISSING' });
        this.eventLog.recordProjectionFailure({ eventId: event.event_id, projectorName: projector.name, projectorVersion: projector.version, failureCode: 'DOMAIN_EVENT_TARGET_MESSAGE_MISSING', failureReason: `messageId=${messageId || 'unknown'}`, targetRefs: messageId ? [{ table: 'r32_messages', id: messageId }] : [] });
        return;
      }
      const actual = projectMessage(saved);
      if (!sameProjection(projection, actual)) {
        result.mismatch += 1; result.failures.push({ eventId: event.event_id, messageId, code: 'SHADOW_PROJECTION_MISMATCH' });
        this.eventLog.recordShadowProjection({ eventId: event.event_id, projectorName: projector.name, projectorVersion: projector.version, expectedProjection: projection, actualProjection: actual, targetRefs: [{ table: 'r32_messages', id: messageId }] });
        return;
      }
      this.eventLog.recordAppliedProjection({ eventId: event.event_id, projectorName: projector.name, projectorVersion: projector.version, projection: actual, targetRefs: [{ table: 'r32_messages', id: messageId }] });
      result.applied += 1; return;
    }
    const expected = operationalProjector.projection({ ...event, payload: event.payload || {} });
    const actual = operationalProjector.actualFor({ ...event, payload: event.payload || {} }, this.repository.store());
    if (actual == null) {
      result.missing += 1; result.failures.push({ eventId: event.event_id, code: 'DOMAIN_OPERATIONAL_TARGET_MISSING' });
      this.eventLog.recordProjectionFailure({ eventId: event.event_id, projectorName: projector.name, projectorVersion: projector.version, failureCode: 'DOMAIN_OPERATIONAL_TARGET_MISSING', failureReason: `eventType=${clean(event.event_type)}`, targetRefs: [] });
      return;
    }
    if (!operationalProjector.isVerified(actual)) {
      result.mismatch += 1; result.failures.push({ eventId: event.event_id, code: 'DOMAIN_OPERATIONAL_PROJECTION_MISMATCH' });
      this.eventLog.recordShadowProjection({ eventId: event.event_id, projectorName: projector.name, projectorVersion: projector.version, expectedProjection: expected, actualProjection: actual, targetRefs: [] });
      return;
    }
    this.eventLog.recordAppliedProjection({ eventId: event.event_id, projectorName: projector.name, projectorVersion: projector.version, projection: actual, targetRefs: [] });
    result.applied += 1;
  }

  auditExisting(input = {}) {
    const pageSize = bounded(input.pageSize, 1000, 1, 10000);
    const eventType = clean(input.eventType);
    const total = this.repository.countDomainEvents(eventType ? { eventType } : {});
    const maximum = input.maximum == null ? total : bounded(input.maximum, total, 1, 10000000);
    const result = { authority: AUTHORITY, projectorName: 'all-domain-projectors', projectorVersion: 'round13', eventType: eventType || 'all', total, maximum, pageSize, scanned: 0, applied: 0, mismatch: 0, missing: 0, skipped: 0, failures: [], truncated: maximum < total };
    let offset = 0;
    while (offset < maximum) {
      const limit = Math.min(pageSize, maximum - offset);
      const events = this.repository.listDomainEvents({ ...(eventType ? { eventType } : {}), limit, offset });
      if (!events.length) break;
      for (const event of events) { result.scanned += 1; this.auditEvent(event, result); }
      offset += events.length; if (events.length < limit) break;
    }
    result.convergence = this.convergence();
    result.converged = !result.truncated && result.mismatch === 0 && result.missing === 0 && result.convergence.blocking === 0;
    result.completedAt = new Date().toISOString(); this.lastAudit = result;
    this.eventBus.publish('domain-event:projection-audit-complete', result); return result;
  }

  blocking(input = {}) {
    const status = clean(input.status); const statuses = status ? [status] : ['failed', 'shadow-mismatch'];
    const limit = bounded(input.limit, 100, 1, 1000); const offset = bounded(input.offset, 0, 0, 10000000);
    const totalBlocking = this.repository.countBlockingProjectionEvents({ statuses });
    const items = this.repository.listBlockingProjectionReceipts({ statuses, limit, offset });
    return { authority: AUTHORITY, convergence: this.convergence(), totalBlocking, limit, offset, hasMore: offset + items.length < totalBlocking, items };
  }

  async repairEvent(input = {}) {
    const eventId = clean(input.eventId); const actor = clean(input.actor); const reason = clean(input.reason);
    if (!eventId) throw Object.assign(new Error('必须指定待修复的领域事件。'), { code: 'DOMAIN_EVENT_ID_REQUIRED', status: 400 });
    if (!actor || !reason) throw Object.assign(new Error('投影修复必须记录操作者和原因。'), { code: 'DOMAIN_EVENT_REPAIR_AUDIT_REQUIRED', status: 409 });
    const event = this.repository.getDomainEvent(eventId); if (!event) throw Object.assign(new Error('待修复的领域事件不存在。'), { code: 'DOMAIN_EVENT_NOT_FOUND', status: 404 });
    const projector = projectorFor(event); if (!projector) throw Object.assign(new Error('当前事件没有可用投影器。'), { code: 'DOMAIN_EVENT_PROJECTOR_UNSUPPORTED', status: 409 });
    if (projector.kind === 'message') {
      const projection = projectDomainEvent({ ...event, payload: event.payload || {} });
      if (!clean(projection.id) || !clean(projection.platform) || !clean(projection.accountId) || !clean(projection.conversationId)) throw Object.assign(new Error('领域事件缺少可恢复消息所需的稳定字段。'), { code: 'DOMAIN_EVENT_PROJECTION_INCOMPLETE', status: 409, eventId });
      const applied = await this.messageStore.upsert({
        ...projection,
        authoritativeDomainEventId: eventId,
        projectionReplayEventId: eventId,
        source: 'domain-event-projector-replay'
      });
      if (applied?.committed === true && applied?.projectionStatus === 'pending') {
        throw Object.assign(new Error('Projection replay remained pending after projector attempt'), {
          code: 'DOMAIN_EVENT_PROJECTION_REPLAY_PENDING', eventId, failure: applied.failure || null
        });
      }
    } else {
      const repaired = await operationalProjector.repair({ ...event, payload: event.payload || {} }, this.repository.store());
      if (!repaired) throw Object.assign(new Error('该运营事件只能审计，不能自动重放。'), { code: 'DOMAIN_EVENT_REPAIR_NOT_SUPPORTED', status: 409, eventId });
    }
    const verify = { applied: 0, mismatch: 0, missing: 0, skipped: 0, failures: [] }; this.auditEvent(event, verify);
    if (verify.mismatch || verify.missing) throw Object.assign(new Error('修复写入后投影仍不一致。'), { code: 'DOMAIN_EVENT_REPAIR_VERIFICATION_FAILED', status: 409, verify });
    const result = { authority: AUTHORITY, repaired: true, actor, reason, eventId, eventType: clean(event.event_type), convergence: this.convergence() };
    this.eventBus.publish('domain-event:projection-repaired', result); return result;
  }

  async repairBlocking(input = {}) {
    const actor = clean(input.actor); const reason = clean(input.reason);
    if (!actor || !reason) throw Object.assign(new Error('批量修复必须记录操作者和原因。'), { code: 'DOMAIN_EVENT_REPAIR_AUDIT_REQUIRED', status: 409 });
    const maximum = bounded(input.maximum, 100, 1, 10000); const rows = this.blocking({ limit: maximum, offset: Number(input.offset || 0) }).items;
    const report = { authority: AUTHORITY, requested: rows.length, repaired: [], failed: [] };
    for (const row of rows) { try { report.repaired.push(await this.repairEvent({ eventId: row.event_id, actor, reason })); } catch (error) { report.failed.push({ eventId: row.event_id, code: error.code || 'DOMAIN_EVENT_REPAIR_FAILED', error: error.message }); } }
    report.convergence = this.auditExisting({}).convergence; report.ok = report.failed.length === 0 && report.convergence.blocking === 0; return report;
  }

  recoverExpiredProjectionJobs() {
    const store = this.repository.store();
    const at = new Date().toISOString();
    const result = store.db.prepare(`UPDATE domain_event_projection_jobs
      SET state='failed',claim_token='',lease_expires_at='',last_error='PROCESSING_LEASE_EXPIRED',next_attempt_at=?,updated_at=?
      WHERE state='processing' AND lease_expires_at<>'' AND lease_expires_at<=?`).run(at, at, at);
    return Number(result.changes || 0);
  }

  async drainProjectionJobs(input = {}) {
    if (this.jobDrainRunning) return { claimed: 0, applied: 0, failed: 0, quarantined: 0, skipped: true };
    this.jobDrainRunning = true;
    const report = { claimed: 0, applied: 0, failed: 0, quarantined: 0, recovered: 0 };
    try {
      report.recovered = this.recoverExpiredProjectionJobs();
      const store = this.repository.store();
      const limit = bounded(input.limit, 20, 1, 100);
      const at = new Date().toISOString();
      const jobs = store.db.prepare(`SELECT * FROM domain_event_projection_jobs
        WHERE state IN ('pending','failed') AND (next_attempt_at='' OR next_attempt_at<=?)
        ORDER BY created_at LIMIT ?`).all(at, limit);
      for (const job of jobs) {
        report.claimed += 1;
        try {
          await this.repairEvent({
            eventId: job.event_id,
            actor: 'domain-projection-job-worker',
            reason: 'Durable projection job retry after initial projection did not converge.'
          });
          const current = store.db.prepare('SELECT state FROM domain_event_projection_jobs WHERE job_id=?').get(job.job_id);
          if (current?.state !== 'applied') {
            store.db.prepare(`UPDATE domain_event_projection_jobs
              SET state='applied',claim_token='',lease_expires_at='',next_attempt_at='',last_error='',updated_at=?
              WHERE job_id=? AND state<>'quarantined'`).run(new Date().toISOString(), job.job_id);
          }
          report.applied += 1;
        } catch (error) {
          const current = store.db.prepare('SELECT attempts,state FROM domain_event_projection_jobs WHERE job_id=?').get(job.job_id);
          if (Number(current?.attempts || 0) >= 5) {
            store.db.prepare(`UPDATE domain_event_projection_jobs
              SET state='quarantined',claim_token='',lease_expires_at='',next_attempt_at='',last_error=?,updated_at=?
              WHERE job_id=? AND state<>'applied'`).run(clean(error.message || error.code).slice(0, 2000), new Date().toISOString(), job.job_id);
            report.quarantined += 1;
          } else {
            report.failed += 1;
          }
        }
      }
      return report;
    } finally {
      this.jobDrainRunning = false;
    }
  }

  async prepare() { return { authority: AUTHORITY, ready: true }; }
  async start() {
    if (!this.boundAppend) {
      this.boundAppend = event => this.scheduleLiveAudit(event?.payload?.eventId);
      this.eventBus.on('domain-event:appended', this.boundAppend);
    }
    if (!this.jobTimer) {
      this.jobTimer = setInterval(() => this.drainProjectionJobs().catch(error => {
        this.logger.warn('domain-event', 'projection-job-drain-failed', { code: error.code || 'DOMAIN_EVENT_PROJECTION_JOB_DRAIN_FAILED', error: error.message });
      }), this.jobIntervalMs);
      this.jobTimer.unref?.();
    }
    await this.drainProjectionJobs().catch(error => this.logger.warn('domain-event', 'projection-job-start-recovery-failed', { code: error.code || 'DOMAIN_EVENT_PROJECTION_JOB_RECOVERY_FAILED', error: error.message }));
    try { return this.auditExisting({}); }
    catch (error) { this.logger.warn('domain-event', 'projection-audit-start-failed', { code: error.code || 'DOMAIN_EVENT_PROJECTION_AUDIT_FAILED', error: error.message }); this.lastAudit = { authority: AUTHORITY, converged: false, code: error.code || 'DOMAIN_EVENT_PROJECTION_AUDIT_FAILED', error: error.message, completedAt: new Date().toISOString() }; return this.lastAudit; }
  }
  async stop() {
    if (this.boundAppend) this.eventBus.off('domain-event:appended', this.boundAppend);
    this.boundAppend = null;
    if (this.jobTimer) clearInterval(this.jobTimer);
    this.jobTimer = null;
    for (const timers of this.liveTimers.values()) for (const timer of timers) clearTimeout(timer);
    this.liveTimers.clear();
    return { authority: AUTHORITY, stopped: true };
  }
  snapshot() { return this.lastAudit || { authority: AUTHORITY, projectorName: 'all-domain-projectors', projectorVersion: 'round13', state: 'not-audited', convergence: this.convergence() }; }
}

const singleton = new DomainEventProjectionAuthority();
module.exports = { AUTHORITY, PROJECTOR_NAME, PROJECTOR_VERSION, OPERATIONAL_PROJECTOR_NAME, OPERATIONAL_PROJECTOR_VERSION, DomainEventProjectionAuthority, singleton, sameProjection, projectorFor };
