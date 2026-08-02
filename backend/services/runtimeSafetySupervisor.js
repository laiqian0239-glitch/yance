'use strict';

const eventBus = require('./eventBus');
const logger = require('./logger');
const { getRuntimeDomainIsolationAuthority } = require('./runtimeDomainIsolationAuthority');
const { getScopedSafetyAuthority } = require('./scopedSafetyAuthority');

function clean(value, fallback = '') { return String(value == null ? fallback : value).trim(); }
function nowIso() { return new Date().toISOString(); }

class RuntimeSafetySupervisor {
  constructor(options = {}) {
    this.runtime = options.runtime || null;
    this.sendQueue = options.sendQueue || require('./sendQueueService');
    this.modelStatus = options.modelStatus || require('./modelStatusService');
    this.backgroundJobs = options.backgroundJobs || require('./backgroundJobAuthority');
    this.accountManager = options.accountManager || require('./accountManager');
    this.platformReadiness = options.platformReadiness || require('./platformProductionReadinessAuthority');
    this.domainIsolation = options.domainIsolation || getRuntimeDomainIsolationAuthority();
    this.scopedSafety = options.scopedSafety || getScopedSafetyAuthority();
    this.eventBus = options.eventBus || eventBus;
    this.logger = options.logger || logger;
    this.intervalMs = Math.max(1000, Number(options.intervalMs || process.env.YANCE_SAFETY_SUPERVISOR_INTERVAL_MS || 3000));
    this.finalFailureThreshold = Math.max(1, Number(options.finalFailureThreshold || process.env.YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD || 10));
    this.timer = null;
    this.initialTimer = null;
    this.scheduledTimer = null;
    this.inFlight = null;
    this.started = false;
    this.lastEvaluation = null;
    this.lastTransition = null;
    this.lastError = null;
    this.activeTriggers = [];
    this.onEvent = event => {
      const type = clean(event?.type).toLowerCase();
      if (!type || !/(send-queue|model|account|background|platform|runtime)/.test(type)) return;
      this.scheduleEvaluate(50);
    };
  }

  bindRuntime(runtime) { this.runtime = runtime; return this; }

  start() {
    if (this.started) return this.snapshot();
    this.started = true;
    this.eventBus.on?.('event', this.onEvent);
    this.initialTimer = setTimeout(() => this.evaluate().catch(() => {}), 750);
    this.initialTimer.unref?.();
    this.timer = setInterval(() => this.evaluate().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
    return this.snapshot();
  }

  stop() {
    this.started = false;
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    if (this.scheduledTimer) clearTimeout(this.scheduledTimer);
    this.initialTimer = null;
    this.scheduledTimer = null;
    this.timer = null;
    this.eventBus.off?.('event', this.onEvent);
    return this.snapshot();
  }

  scheduleEvaluate(delayMs = 0) {
    if (!this.started || this.inFlight || this.scheduledTimer) return;
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      this.evaluate().catch(() => {});
    }, Math.max(0, Number(delayMs || 0)));
    this.scheduledTimer.unref?.();
  }

  collectTriggers() {
    const triggers = [];
    let queueState;
    try { queueState = this.sendQueue.status(); }
    catch (error) {
      triggers.push({ code: 'SEND_QUEUE_STATUS_UNAVAILABLE', severity: 'high', scopeType: 'capability', capability: 'send', detail: error.message || String(error) });
      queueState = null;
    }
    if (queueState && (queueState.resumeBlocked === true || Number(queueState.outcomeUnknown || 0) > 0 || queueState.statusError)) {
      triggers.push({
        code: 'SEND_OUTCOME_UNKNOWN',
        severity: 'critical',
        scopeType: 'capability',
        capability: 'send',
        detail: `${Math.max(1, Number(queueState.outcomeUnknown || 0))} 个发送任务无法确认平台接受结果`,
        evidence: { pausedReason: queueState.pausedReason || '', outcomeUnknown: Number(queueState.outcomeUnknown || 0) }
      });
    }

    try {
      const state = this.modelStatus.read();
      const invalid = Number(state.routeIntegrity?.invalidPersistedRouteCount || state.routeIntegrity?.quarantine?.length || 0);
      if (state.routeIntegrity?.pass === false || invalid > 0) {
        triggers.push({ code: 'MODEL_ROUTE_QUALIFICATION_BLOCKED', severity: 'high', domain: 'ai', scopeType: 'capability', capability: 'ai-automation', detail: `${Math.max(1, invalid)} 条持久化模型路由不合格`, evidence: { invalidPersistedRouteCount: invalid } });
      }
    } catch (error) {
      triggers.push({ code: 'MODEL_ROUTE_STATUS_UNAVAILABLE', severity: 'high', domain: 'ai', scopeType: 'capability', capability: 'ai-automation', detail: error.message || String(error), evidence: { causeCode: clean(error.code) } });
    }

    try {
      const accounts = this.accountManager.list()?.accounts || [];
      for (const account of accounts) {
        const state = clean(account.state).toLowerCase();
        if (state === 'reauthorize' || state === 'logged-out') {
          triggers.push({
            code: clean(account.reasonCode || `${clean(account.platform).toUpperCase()}_REAUTH_REQUIRED`),
            severity: 'high', scopeType: 'account', platform: clean(account.platform).toLowerCase(), accountId: clean(account.id), capability: 'authenticate',
            detail: clean(account.lastError || '账号需要重新授权')
          });
        } else if (state === 'error') {
          triggers.push({
            code: clean(account.reasonCode || `${clean(account.platform).toUpperCase()}_ACCOUNT_RUNTIME_FAILED`),
            severity: 'high', scopeType: 'account', platform: clean(account.platform).toLowerCase(), accountId: clean(account.id), capability: 'sync',
            detail: clean(account.lastError || '账号运行异常')
          });
        }
      }
      const readiness = this.platformReadiness.evaluate({ accounts });
      for (const row of Array.isArray(readiness.platforms) ? readiness.platforms : []) {
        if (!['blocked','degraded'].includes(clean(row.status).toLowerCase())) continue;
        triggers.push({
          code: clean(row.reasonCode || 'PLATFORM_PRODUCTION_BLOCKED'), severity: 'high', scopeType: 'platform',
          platform: clean(row.platform).toLowerCase(), capability: clean(row.capability || 'send'),
          detail: clean(row.detail || `${row.platform || '平台'} 生产能力受限`), evidence: row
        });
      }
    } catch (error) {
      triggers.push({ code: 'PLATFORM_READINESS_UNAVAILABLE', severity: 'high', scopeType: 'capability', capability: 'platform-diagnostics', detail: error.message || String(error) });
    }

    try {
      const jobs = this.backgroundJobs.snapshot({ limit: 50 });
      const failed = Number(jobs.counts?.FAILED_FINAL || 0);
      if (failed >= this.finalFailureThreshold) {
        triggers.push({ code: 'BACKGROUND_JOB_FAILURE_STORM', severity: 'critical', scopeType: 'capability', capability: 'background-jobs', detail: `${failed} 个后台任务最终失败，达到阈值 ${this.finalFailureThreshold}`, evidence: { failedFinal: failed, threshold: this.finalFailureThreshold } });
      }
      if (jobs.consistency?.pass === false) {
        triggers.push({ code: 'BACKGROUND_JOB_COUNT_MISMATCH', severity: 'critical', scopeType: 'system', detail: `后台任务状态汇总 ${jobs.consistency.counted} 与总数 ${jobs.consistency.total} 不一致`, evidence: jobs.consistency });
      }
    } catch (error) {
      triggers.push({ code: 'BACKGROUND_JOB_STATUS_UNAVAILABLE', severity: 'high', scopeType: 'capability', capability: 'background-jobs', detail: error.message || String(error) });
    }
    return triggers;
  }

  evaluate() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this._evaluate().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async _evaluate() {
    const at = nowIso();
    try {
      const triggers = this.collectTriggers();
      this.activeTriggers = triggers;
      this.lastEvaluation = { at, triggerCount: triggers.length, triggerCodes: triggers.map(row => row.code) };
      const isolation = this.domainIsolation.evaluate(triggers);
      try { this.scopedSafety.reconcile(triggers); } catch (error) { this.logger.error('runtime-safety', 'scoped-safety-persistence-failed', { code: error.code || '', message: error.message }); }
      const critical = triggers.filter(row => isolation.globalSafeModeReasons.includes(row.code));
      const alreadySafe = clean(this.runtime?.operatingMode).toLowerCase() === 'safemode';
      if (critical.length && !alreadySafe) {
        if (!this.runtime?.enterSafeMode) throw Object.assign(new Error('运行时安全模式控制不可用'), { code: 'RUNTIME_SAFE_MODE_AUTHORITY_UNAVAILABLE' });
        const primary = critical[0];
        await this.runtime.enterSafeMode(`automatic:${primary.code}`, {
          code: primary.code,
          source: 'automatic-safety-supervisor',
          triggers: critical.map(row => row.code),
          trigger: 'runtime-safety-supervisor',
          evidence: { activeTriggers: critical.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null })) }
        });
        this.lastTransition = { at: nowIso(), targetMode: 'safeMode', reasonCode: primary.code, triggers: critical.map(row => row.code), automatic: true };
        this.eventBus.publish('runtime:safety-supervisor-entered-safe-mode', this.lastTransition);
        this.logger.error('runtime-safety', 'automatic-safe-mode-entered', this.lastTransition);
      }
      this.lastError = null;
      return this.snapshot();
    } catch (error) {
      this.lastError = { at: nowIso(), code: clean(error.code || 'RUNTIME_SAFETY_SUPERVISOR_FAILED'), message: error.message || String(error) };
      this.logger.error('runtime-safety', 'supervisor-evaluation-failed', this.lastError);
      return this.snapshot();
    }
  }

  snapshot() {
    const isolation = this.domainIsolation.snapshot();
    let scopedSafety = null;
    try { scopedSafety = this.scopedSafety.snapshot(); } catch (_) { scopedSafety = { active: [], globalBlockers: [] }; }
    return {
      schemaVersion: 2,
      authority: 'RuntimeSafetySupervisor',
      started: this.started,
      activeTriggers: this.activeTriggers.map(row => ({ ...row })),
      manualReviewRequired: isolation.globalWriteBlocked || isolation.aiAutomationBlocked || Object.keys(isolation.accounts || {}).length > 0 || Object.keys(isolation.platforms || {}).length > 0 || Object.keys(isolation.capabilities || {}).length > 0,
      globalWriteBlocked: isolation.globalWriteBlocked,
      globalSafeModeReasons: isolation.globalSafeModeReasons,
      aiAutomationBlocked: isolation.aiAutomationBlocked,
      aiIsolationReasons: isolation.aiIsolationReasons,
      accounts: isolation.accounts || {},
      platforms: isolation.platforms || {},
      capabilities: isolation.capabilities || {},
      domainIsolation: isolation,
      scopedSafety,
      lastEvaluation: this.lastEvaluation,
      lastTransition: this.lastTransition,
      lastError: this.lastError,
      finalFailureThreshold: this.finalFailureThreshold
    };
  }
}

let singleton = null;
function getRuntimeSafetySupervisor() { if (!singleton) singleton = new RuntimeSafetySupervisor(); return singleton; }

module.exports = { RuntimeSafetySupervisor, getRuntimeSafetySupervisor };
