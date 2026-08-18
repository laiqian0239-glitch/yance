'use strict';

const { singleton: repository } = require('../repositories/platformCoreRepository');
const domainEventLog = require('./domainEventLogService').singleton;
const messageStore = require('./messageStore');
const { projectMessage, projectDomainEvent } = require('./domainMessageProjector');
const operationalProjector = require('./domainOperationalProjector');
const eventBus = require('./eventBus');
const logger = require('./logger');
const { DurableInternalOperationAuthority, currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');
const { DurableExecutionRecoveryAuthority, currentRuntimeRecoveryAuthority } = require('./durableExecutionRecoveryAuthority');

const AUTHORITY = 'DomainEventProjectionAuthority';
const PROJECTOR_NAME = 'message-projection';
const PROJECTOR_VERSION = 'round12-v2';
const OPERATIONAL_PROJECTOR_NAME = 'operational-projection';
const OPERATIONAL_PROJECTOR_VERSION = 'round13-v2';

function clean(value) { return String(value == null ? '' : value).trim(); }
function same(left, right) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }
function sameProjection(left, right) { return same(projectMessage(left || {}), projectMessage(right || {})); }
function bounded(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function ledgerSequenceOf(event = {}) {
  const ledgerSequence = Number(event.ledgerSequence || event.ledger_sequence || 0);
  if (!Number.isSafeInteger(ledgerSequence) || ledgerSequence < 1) {
    throw Object.assign(new Error('Domain projection requires a positive canonical ledgerSequence'), { code: 'CANONICAL_LEDGER_SEQUENCE_REQUIRED' });
  }
  return ledgerSequence;
}
function projectionEvent(event = {}) {
  return Object.freeze({
    ...event,
    event_id: clean(event.eventId || event.event_id),
    event_type: clean(event.eventType || event.event_type),
    platform: clean(event.platform),
    source_account_id: clean(event.sourceAccountId || event.source_account_id),
    replay_state: clean(event.replayState || event.replay_state) || 'available',
    payload: event.payload || {}
  });
}
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
        const event = this.eventLog.readEvent(id); if (!event) return;
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
    const ledgerSequence = ledgerSequenceOf(event);
    const candidate = projectionEvent(event);
    const eventId = candidate.event_id;
    const projector = projectorFor(candidate);
    if (!projector) {
      result.skipped += 1;
      this.eventLog.recordSkippedProjection({
        eventId, ledgerSequence, projectorName: OPERATIONAL_PROJECTOR_NAME, projectorVersion: OPERATIONAL_PROJECTOR_VERSION,
        failureCode: 'DOMAIN_EVENT_PROJECTOR_UNSUPPORTED', failureReason: `eventType=${candidate.event_type}`
      });
      return;
    }
    if (candidate.replay_state === 'expired') { result.skipped += 1; return; }
    if (projector.kind === 'message') {
      const projection = projectDomainEvent(candidate);
      const messageId = clean(projection.id);
      const saved = messageId ? this.messageStore.getMessageByDedupeKey(messageId) : null;
      if (!saved) {
        result.missing += 1; result.failures.push({ eventId, ledgerSequence, messageId, code: 'DOMAIN_EVENT_TARGET_MESSAGE_MISSING' });
        this.eventLog.recordProjectionFailure({ eventId, ledgerSequence, projectorName: projector.name, projectorVersion: projector.version, failureCode: 'DOMAIN_EVENT_TARGET_MESSAGE_MISSING', failureReason: `messageId=${messageId || 'unknown'}`, targetRefs: messageId ? [{ table: 'r32_messages', id: messageId }] : [] });
        return;
      }
      const actual = projectMessage(saved);
      if (!sameProjection(projection, actual)) {
        result.mismatch += 1; result.failures.push({ eventId, ledgerSequence, messageId, code: 'SHADOW_PROJECTION_MISMATCH' });
        this.eventLog.recordShadowProjection({ eventId, ledgerSequence, projectorName: projector.name, projectorVersion: projector.version, expectedProjection: projection, actualProjection: actual, targetRefs: [{ table: 'r32_messages', id: messageId }] });
        return;
      }
      this.eventLog.recordAppliedProjection({ eventId, ledgerSequence, projectorName: projector.name, projectorVersion: projector.version, projection: actual, targetRefs: [{ table: 'r32_messages', id: messageId }] });
      result.applied += 1; return;
    }
    const expected = operationalProjector.projection(candidate);
    const actual = operationalProjector.actualFor(candidate, this.repository.store());
    if (actual == null) {
      result.missing += 1; result.failures.push({ eventId, ledgerSequence, code: 'DOMAIN_OPERATIONAL_TARGET_MISSING' });
      this.eventLog.recordProjectionFailure({ eventId, ledgerSequence, projectorName: projector.name, projectorVersion: projector.version, failureCode: 'DOMAIN_OPERATIONAL_TARGET_MISSING', failureReason: `eventType=${candidate.event_type}`, targetRefs: [] });
      return;
    }
    if (!operationalProjector.isVerified(actual)) {
      result.mismatch += 1; result.failures.push({ eventId, ledgerSequence, code: 'DOMAIN_OPERATIONAL_PROJECTION_MISMATCH' });
      this.eventLog.recordShadowProjection({ eventId, ledgerSequence, projectorName: projector.name, projectorVersion: projector.version, expectedProjection: expected, actualProjection: actual, targetRefs: [] });
      return;
    }
    this.eventLog.recordAppliedProjection({ eventId, ledgerSequence, projectorName: projector.name, projectorVersion: projector.version, projection: actual, targetRefs: [] });
    result.applied += 1;
  }

  auditExisting(input = {}) {
    const pageSize = bounded(input.pageSize, 1000, 1, 10000);
    const eventType = clean(input.eventType);
    const total = this.eventLog.countEvents(eventType ? { eventType } : {});
    const maximum = input.maximum == null ? total : bounded(input.maximum, total, 1, 10000000);
    const result = { authority: AUTHORITY, projectorName: 'all-domain-projectors', projectorVersion: 'round13', eventType: eventType || 'all', total, maximum, pageSize, scanned: 0, applied: 0, mismatch: 0, missing: 0, skipped: 0, failures: [], truncated: maximum < total };
    let offset = 0;
    while (offset < maximum) {
      const limit = Math.min(pageSize, maximum - offset);
      const events = this.eventLog.listEvents({ ...(eventType ? { eventType } : {}), limit, offset });
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
    const event = this.eventLog.readEvent(eventId); if (!event) throw Object.assign(new Error('待修复的领域事件不存在。'), { code: 'DOMAIN_EVENT_NOT_FOUND', status: 404 });
    const candidate = projectionEvent(event);
    const ledgerSequence = ledgerSequenceOf(event);
    const projector = projectorFor(event); if (!projector) throw Object.assign(new Error('当前事件没有可用投影器。'), { code: 'DOMAIN_EVENT_PROJECTOR_UNSUPPORTED', status: 409 });
    if (projector.kind === 'message') {
      const projection = projectDomainEvent(candidate);
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
      const repaired = await operationalProjector.repair(candidate, this.repository.store());
      if (!repaired) throw Object.assign(new Error('该运营事件只能审计，不能自动重放。'), { code: 'DOMAIN_EVENT_REPAIR_NOT_SUPPORTED', status: 409, eventId });
    }
    const verify = { applied: 0, mismatch: 0, missing: 0, skipped: 0, failures: [] }; this.auditEvent(event, verify);
    if (verify.mismatch || verify.missing) throw Object.assign(new Error('修复写入后投影仍不一致。'), { code: 'DOMAIN_EVENT_REPAIR_VERIFICATION_FAILED', status: 409, verify });
    const result = { authority: AUTHORITY, repaired: true, actor, reason, eventId, ledgerSequence, eventType: candidate.event_type, convergence: this.convergence() };
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

  projectionInternalAuthority() {
    const store = this.repository.store();
    try {
      const authority = currentRuntimeInternalOperationAuthority();
      if (authority.store().db === store.db) return authority;
    } catch (_) {}
    const capability = store?.authorityWriteHostCapability;
    if (!capability || typeof capability.tokenSnapshot !== 'function') {
      throw Object.assign(new Error('Domain projection requires the current AuthorityWriteHost capability'), {
        code: 'DOMAIN_EVENT_PROJECTION_AUTHORITY_WRITE_HOST_REQUIRED'
      });
    }
    return new DurableInternalOperationAuthority({
      storeProvider: () => store,
      tokenProvider: () => capability.tokenSnapshot()
    });
  }

  projectionRecoveryAuthority() {
    const store = this.repository.store();
    try {
      const authority = currentRuntimeRecoveryAuthority();
      if (authority.storeProvider?.()?.db === store.db) return authority;
    } catch (_) {}
    return new DurableExecutionRecoveryAuthority({
      storeProvider: () => store,
      authorityWriteHostCapability: store.authorityWriteHostCapability
    });
  }

  recoverExpiredProjectionJobs() {
    const authority = this.projectionInternalAuthority();
    const recovery = this.projectionRecoveryAuthority();
    const authorityTimestamp = new Date().toISOString();
    const nowMs = Date.parse(authorityTimestamp);
    let recovered = 0;
    for (const operation of authority.snapshot({ operationType: 'projection.domain-event-message', limit: 1000 })) {
      const retryDue = operation.state === 'RETRY_SCHEDULED'
        && (!operation.nextAttemptAt || Date.parse(operation.nextAttemptAt) <= nowMs);
      const leaseExpired = operation.state === 'RUNNING'
        && operation.leaseExpiresAt
        && Date.parse(operation.leaseExpiresAt) <= nowMs;
      if (!retryDue && !leaseExpired) continue;
      const receipt = recovery.recoverExecution(operation.operationId, { authorityTimestamp });
      if (receipt?.decision === 'REQUEUE_SAFE' || receipt?.transition?.state === 'SCHEDULED') recovered += 1;
    }
    return recovered;
  }

  async drainProjectionJobs(input = {}) {
    if (this.jobDrainRunning) return { claimed: 0, applied: 0, failed: 0, quarantined: 0, skipped: true };
    this.jobDrainRunning = true;
    const report = { claimed: 0, applied: 0, failed: 0, quarantined: 0, recovered: 0 };
    try {
      report.recovered = this.recoverExpiredProjectionJobs();
      const authority = this.projectionInternalAuthority();
      const limit = bounded(input.limit, 20, 1, 100);
      const operations = authority.snapshot({ operationType: 'projection.domain-event-message', limit: Math.max(limit * 5, limit) })
        .filter(operation => operation.state === 'SCHEDULED')
        .slice(0, limit);
      for (const operation of operations) {
        const eventId = clean(operation.scopeKey || operation.messageId);
        if (!eventId) continue;
        report.claimed += 1;
        try {
          await this.repairEvent({
            eventId,
            actor: 'domain-projection-canonical-recovery',
            reason: 'Canonical Schema 23 projection operation is scheduled and eligible for replay.'
          });
          report.applied += 1;
        } catch (error) {
          const latest = authority.read(operation.operationId);
          if (latest?.state === 'DEAD_LETTERED' || latest?.state === 'FAILED') report.quarantined += 1;
          else report.failed += 1;
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
    // Startup recovery may execute eligible work, but retry timing and stale
    // lease decisions are owned exclusively by DurableExecutionRecoveryAuthority.
    // There is deliberately no second projection retry timer here.
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
