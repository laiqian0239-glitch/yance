'use strict';

const accountManager = require('./accountManager');
const accountStore = require('./accountStore');
const sendQueue = require('./sendQueueService');
const eventBus = require('./eventBus');
const logger = require('./logger');
const safeModeService = require('./safeModeService');
const systemPolicy = require('./systemPolicy');
const settingsRepository = require('../repositories/settingsRepository');
const { eligibility } = require('./accountLifecycle');
const platformAdapters = require('./platformAdapterPorts').singleton;

function nowIso(clock = Date) { return new clock().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function cleanRecoveryReason(value) { return clean(value).slice(0, 128); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value || 0))); }

class RuntimeRecoveryService {
  constructor(options = {}) {
    this.accountManager = options.accountManager || accountManager;
    this.accountStore = options.accountStore || accountStore;
    this.sendQueue = options.sendQueue || sendQueue;
    this.eventBus = options.eventBus || eventBus;
    this.platformAdapters = options.platformAdapters || platformAdapters;
    this.safeModeService = options.safeModeService || safeModeService;
    this.systemPolicy = options.systemPolicy || systemPolicy;
    this.repository = options.repository || settingsRepository;
    this.clock = options.clock || Date;
    this.initialBackoffMs = clamp(options.initialBackoffMs || process.env.YANCE_RUNTIME_RECOVERY_INITIAL_BACKOFF_MS || 30000, 1000, 30 * 60 * 1000);
    this.maximumBackoffMs = clamp(options.maximumBackoffMs || process.env.YANCE_RUNTIME_RECOVERY_MAX_BACKOFF_MS || 30 * 60 * 1000, this.initialBackoffMs, 24 * 60 * 60 * 1000);
    this.accountAttempts = new Map();
    this.attemptStateLoaded = false;
    this.attemptStateError = '';
    this.state = {
      online: true,
      suspended: false,
      locked: false,
      lastEvent: 'startup',
      lastEventAt: nowIso(this.clock),
      recovering: false,
      lastRecoveryAt: '',
      lastRecovery: [],
      lastRecoveryBlocked: null,
      scheduledReason: '',
      scheduledAt: ''
    };
    this.timer = null;
    this.recoveryTimer = null;
  }

  timestamp() { return nowIso(this.clock); }
  epoch() { return this.clock.now(); }

  queueStatus() {
    try {
      return this.sendQueue.status();
    } catch (error) {
      return { statusError: clean(error.code || error.message || 'SEND_QUEUE_STATUS_UNAVAILABLE'), writeBlocked: true, resumeBlocked: true };
    }
  }

  loadAttemptState() {
    if (this.attemptStateLoaded && !this.attemptStateError) return true;
    try {
      const document = this.repository.get('runtime-recovery', 'account-attempts-v1', { schemaVersion: 1, accounts: {} }) || {};
      const accounts = document.accounts && typeof document.accounts === 'object' ? document.accounts : {};
      this.accountAttempts = new Map(Object.entries(accounts).map(([accountId, row]) => [clean(accountId), {
        failureCount: Math.max(0, Number(row?.failureCount || 0)),
        nextEligibleAt: Math.max(0, Number(row?.nextEligibleAt || 0)),
        inFlight: false,
        lastCode: clean(row?.lastCode),
        lastError: clean(row?.lastError),
        updatedAt: clean(row?.updatedAt)
      }]).filter(([accountId]) => accountId));
      this.attemptStateLoaded = true;
      this.attemptStateError = '';
      return true;
    } catch (error) {
      this.attemptStateLoaded = false;
      this.attemptStateError = clean(error.code || error.message || 'RUNTIME_RECOVERY_STATE_UNAVAILABLE');
      logger.warn('runtime', 'recovery-attempt-state-load-failed', { error: this.attemptStateError });
      return false;
    }
  }

  persistAttemptState() {
    const accounts = {};
    for (const [accountId, row] of this.accountAttempts.entries()) {
      accounts[accountId] = {
        failureCount: Math.max(0, Number(row.failureCount || 0)),
        nextEligibleAt: Math.max(0, Number(row.nextEligibleAt || 0)),
        lastCode: clean(row.lastCode),
        lastError: clean(row.lastError),
        updatedAt: clean(row.updatedAt) || this.timestamp()
      };
    }
    try {
      this.repository.set('runtime-recovery', 'account-attempts-v1', { schemaVersion: 1, accounts, updatedAt: this.timestamp() });
      this.attemptStateLoaded = true;
      this.attemptStateError = '';
      return true;
    } catch (error) {
      this.attemptStateError = clean(error.code || error.message || 'RUNTIME_RECOVERY_STATE_UNAVAILABLE');
      logger.warn('runtime', 'recovery-attempt-state-save-failed', { error: this.attemptStateError });
      return false;
    }
  }

  recoveryGate() {
    const queue = this.queueStatus();
    if (!this.loadAttemptState()) return { allowed: false, code: 'RUNTIME_RECOVERY_STATE_UNAVAILABLE', detail: clean(this.attemptStateError), queue };
    let policy = {};
    try { policy = this.systemPolicy.read() || {}; } catch (error) { return { allowed: false, code: 'SYSTEM_POLICY_UNAVAILABLE', detail: clean(error.code || error.message), queue }; }
    let safeMode = false;
    try { safeMode = this.safeModeService.isActive() === true; } catch (error) { return { allowed: false, code: 'SAFE_MODE_STATUS_UNAVAILABLE', detail: clean(error.code || error.message), queue }; }
    if (safeMode) return { allowed: false, code: 'SAFE_MODE_ACTIVE', detail: '安全模式已启用，自动账号恢复已暂停。', queue };
    if (policy.emergencyStop === true) return { allowed: false, code: 'GLOBAL_EMERGENCY_STOP', detail: clean(policy.reason) || '全局紧急停止已启用。', queue };
    if (queue.statusError) return { allowed: false, code: 'SEND_QUEUE_STATUS_UNAVAILABLE', detail: clean(queue.statusError), queue };
    if (queue.writeBlocked === true || queue.resumeBlocked === true || queue.pausedReason === 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN' || Number(queue.unknownOutcomeCount || queue.uncertainCount || 0) > 0) {
      return { allowed: false, code: clean(queue.pausedReason) || 'SEND_QUEUE_RECOVERY_BLOCKED', detail: '发送队列存在未闭环结果，账号自动恢复已暂停。', queue };
    }
    return { allowed: true, code: '', detail: '', queue };
  }

  status() {
    this.loadAttemptState();
    const attemptBackoff = [...this.accountAttempts.entries()].map(([accountId, row]) => ({
      accountId,
      failureCount: Number(row.failureCount || 0),
      inFlight: row.inFlight === true,
      nextEligibleAt: row.nextEligibleAt ? new Date(row.nextEligibleAt).toISOString() : '',
      lastCode: clean(row.lastCode),
      lastError: clean(row.lastError),
      updatedAt: clean(row.updatedAt)
    }));
    return { ...this.state, queue: this.queueStatus(), attemptBackoff, attemptStateError: clean(this.attemptStateError) };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.watchdog().catch(error => logger.warn('runtime', 'watchdog-failed', { error: error.message })), Math.max(30000, Number(process.env.YANCE_RUNTIME_WATCHDOG_MS || 60000)));
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.timer = null;
    this.recoveryTimer = null;
    this.state.scheduledReason = '';
    this.state.scheduledAt = '';
  }

  resumeQueueIfAllowed(reason) {
    const gate = this.recoveryGate();
    if (gate.allowed) {
      this.sendQueue.resume(reason);
      return true;
    }
    this.state.lastRecoveryBlocked = { reason: cleanRecoveryReason(reason), code: clean(gate.code), detail: clean(gate.detail), at: this.timestamp() };
    return false;
  }

  handle(message = {}) {
    const event = clean(message.event || message.state).toLowerCase();
    this.state.lastEvent = event || 'unknown';
    this.state.lastEventAt = this.timestamp();
    if (event === 'suspend') { this.state.suspended = true; this.sendQueue.pause('system-suspend'); }
    if (event === 'resume') { this.state.suspended = false; if (this.state.online) this.resumeQueueIfAllowed('system-resume'); this.scheduleRecovery('system-resume', 1800); }
    if (event === 'offline') { this.state.online = false; this.sendQueue.pause('network-offline'); }
    if (event === 'online') { this.state.online = true; if (!this.state.suspended) this.resumeQueueIfAllowed('network-online'); this.scheduleRecovery('network-online', 1000); }
    if (event === 'lock-screen') this.state.locked = true;
    if (event === 'unlock-screen') { this.state.locked = false; this.scheduleRecovery('screen-unlock', 1200); }
    this.eventBus.publish('runtime:lifecycle', this.status());
    return this.status();
  }

  scheduleRecovery(reason, delayMs = 1000) {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    const delay = Math.max(250, delayMs);
    this.state.scheduledReason = cleanRecoveryReason(reason);
    this.state.scheduledAt = new Date(this.epoch() + delay).toISOString();
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      this.state.scheduledReason = '';
      this.state.scheduledAt = '';
      this.recover(reason).catch(error => logger.warn('runtime', 'recovery-failed', { reason, error: error.message }));
    }, delay);
    this.recoveryTimer.unref?.();
  }

  attemptState(accountId) {
    this.loadAttemptState();
    if (!this.accountAttempts.has(accountId)) this.accountAttempts.set(accountId, { failureCount: 0, nextEligibleAt: 0, inFlight: false, lastCode: '', lastError: '' });
    return this.accountAttempts.get(accountId);
  }

  markFailure(accountId, error) {
    const attempt = this.attemptState(accountId);
    attempt.failureCount = Number(attempt.failureCount || 0) + 1;
    const delay = Math.min(this.maximumBackoffMs, this.initialBackoffMs * (2 ** Math.max(0, attempt.failureCount - 1)));
    attempt.nextEligibleAt = this.epoch() + delay;
    attempt.lastCode = clean(error?.code);
    attempt.lastError = clean(error?.message || error);
    attempt.inFlight = false;
    attempt.updatedAt = this.timestamp();
    const persisted = this.persistAttemptState();
    return { delay, retryAt: new Date(attempt.nextEligibleAt).toISOString(), failureCount: attempt.failureCount, attemptStatePersisted: persisted };
  }

  markSuccess(accountId) { this.accountAttempts.delete(accountId); return this.persistAttemptState(); }

  blocked(reason, gate) {
    const blocked = { reason: cleanRecoveryReason(reason), code: clean(gate.code), detail: clean(gate.detail), at: this.timestamp() };
    this.state.lastRecoveryBlocked = blocked;
    this.eventBus.publish('runtime:recovery-blocked', blocked);
    return this.status();
  }

  async recover(reason = 'manual') {
    const manual = clean(reason).toLowerCase() === 'manual';
    if (this.state.recovering || this.state.suspended || !this.state.online) return this.status();
    const gate = this.recoveryGate();
    if (!gate.allowed) return this.blocked(reason, gate);

    this.state.recovering = true;
    this.state.lastRecoveryBlocked = null;
    this.eventBus.publish('runtime:recovery-started', { reason, at: this.timestamp() });
    const results = [];
    try {
      const publicAccounts = this.accountManager.list().accounts;
      for (const row of publicAccounts) {
        const stored = this.accountStore.get(row.id);
        if (!stored || !eligibility(stored, { manual: false }).eligible) continue;
        if (['connected', 'limited', 'connecting', 'waiting-verification', 'reauthorize'].includes(row.state)) continue;
        if (row.state === 'unconfigured' && row.credentialReady !== true) continue;

        const attempt = this.attemptState(row.id);
        if (attempt.inFlight) {
          results.push({ accountId: row.id, platform: row.platform, ok: false, skipped: true, code: 'ACCOUNT_RECOVERY_ALREADY_IN_FLIGHT' });
          continue;
        }
        if (!manual && Number(attempt.nextEligibleAt || 0) > this.epoch()) {
          results.push({ accountId: row.id, platform: row.platform, ok: false, skipped: true, code: 'ACCOUNT_RECOVERY_BACKOFF', retryAt: new Date(attempt.nextEligibleAt).toISOString(), failureCount: attempt.failureCount });
          continue;
        }
        attempt.inFlight = true;
        try {
          const account = await this.platformAdapters.executeAuth({
            schemaVersion: 1,
            platform: row.platform,
            accountId: row.id,
            operation: 'connect',
            reason: cleanRecoveryReason(reason)
          });
          this.markSuccess(row.id);
          results.push({ accountId: row.id, platform: row.platform, ok: true, account });
        } catch (error) {
          const backoff = this.markFailure(row.id, error);
          results.push({ accountId: row.id, platform: row.platform, ok: false, error: clean(error.message), code: clean(error.code), ...backoff });
        } finally {
          const current = this.accountAttempts.get(row.id);
          if (current) current.inFlight = false;
        }
      }
      const postGate = this.recoveryGate();
      if (postGate.allowed) this.sendQueue.resume(reason);
      else this.state.lastRecoveryBlocked = { reason: cleanRecoveryReason(reason), code: clean(postGate.code), detail: clean(postGate.detail), at: this.timestamp() };
      this.state.lastRecoveryAt = this.timestamp();
      this.state.lastRecovery = results.slice(-50);
      this.eventBus.publish('runtime:recovery-completed', { reason, results, blocked: this.state.lastRecoveryBlocked, at: this.state.lastRecoveryAt });
      return this.status();
    } finally {
      this.state.recovering = false;
    }
  }

  async watchdog() {
    if (this.state.online && !this.state.suspended) await this.recover('watchdog');
  }
}

const runtimeRecoveryService = new RuntimeRecoveryService();
module.exports = runtimeRecoveryService;
module.exports.RuntimeRecoveryService = RuntimeRecoveryService;
