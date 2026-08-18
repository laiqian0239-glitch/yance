'use strict';

const sendQueue = require('./sendQueueService');
const eventBus = require('./eventBus');
const safeModeService = require('./safeModeService');
const systemPolicy = require('./systemPolicy');
const {
  recoverNonterminalExecutions
} = require('./durableExecutionRecoveryAuthority');

function nowIso(clock = Date) { return new clock().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function cleanRecoveryReason(value) { return clean(value).slice(0, 128); }

class RuntimeRecoveryService {
  constructor(options = {}) {
    this.sendQueue = options.sendQueue || sendQueue;
    this.eventBus = options.eventBus || eventBus;
    this.recoverNonterminalExecutions = options.recoverNonterminalExecutions || recoverNonterminalExecutions;
    this.safeModeService = options.safeModeService || safeModeService;
    this.systemPolicy = options.systemPolicy || systemPolicy;
    this.clock = options.clock || Date;
    this.state = {
      online: true,
      suspended: false,
      locked: false,
      lastEvent: 'startup',
      lastEventAt: nowIso(this.clock),
      recovering: false,
      lastRecoveryAt: '',
      lastRecovery: [],
      lastRecoveryBlocked: null
    };
  }

  timestamp() { return nowIso(this.clock); }

  queueStatus() {
    try {
      return this.sendQueue.status();
    } catch (error) {
      return { statusError: clean(error.code || error.message || 'SEND_QUEUE_STATUS_UNAVAILABLE'), writeBlocked: true, resumeBlocked: true };
    }
  }

  recoveryGate() {
    const queue = this.queueStatus();
    let policy = {};
    try { policy = this.systemPolicy.read() || {}; } catch (error) { return { allowed: false, code: 'SYSTEM_POLICY_UNAVAILABLE', detail: clean(error.code || error.message), queue }; }
    let safeMode = false;
    try { safeMode = this.safeModeService.isActive() === true; } catch (error) { return { allowed: false, code: 'SAFE_MODE_STATUS_UNAVAILABLE', detail: clean(error.code || error.message), queue }; }
    if (safeMode) return { allowed: false, code: 'SAFE_MODE_ACTIVE', detail: '安全模式已启用，自动账号恢复已暂停。', queue };
    if (policy.emergencyStop === true) return { allowed: false, code: 'GLOBAL_EMERGENCY_STOP', detail: clean(policy.reason) || '全局紧急停止已启用。', queue };
    if (queue.statusError) return { allowed: false, code: 'SEND_QUEUE_STATUS_UNAVAILABLE', detail: clean(queue.statusError), queue };
    if (queue.writeBlocked === true || queue.resumeBlocked === true || queue.pausedReason === 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN' || Number(queue.unknownOutcomeCount || queue.uncertainCount || 0) > 0) {
      return { allowed: false, code: clean(queue.pausedReason) || 'SEND_QUEUE_RECOVERY_BLOCKED', detail: '发送队列存在未闭环结果，durable recovery 已暂停。', queue };
    }
    return { allowed: true, code: '', detail: '', queue };
  }

  status() {
    return { ...this.state, queue: this.queueStatus() };
  }

  // Compatibility lifecycle hooks are intentionally inert. Runtime recovery has
  // no private scheduler; startup/manual callers invoke the canonical durable
  // recovery authority explicitly.
  start() { return this.status(); }
  stop() { return this.status(); }

  blocked(reason, gate) {
    const blocked = { reason: cleanRecoveryReason(reason), code: clean(gate.code), detail: clean(gate.detail), at: this.timestamp() };
    this.state.lastRecoveryBlocked = blocked;
    this.eventBus.publish('runtime:recovery-blocked', blocked);
    return this.status();
  }

  async recover(reason = 'manual') {
    if (this.state.recovering || this.state.suspended || !this.state.online) return this.status();
    const gate = this.recoveryGate();
    if (!gate.allowed) return this.blocked(reason, gate);

    this.state.recovering = true;
    this.state.lastRecoveryBlocked = null;
    const authorityTimestamp = this.timestamp();
    this.eventBus.publish('runtime:recovery-started', { reason, authorityTimestamp });
    try {
      const receipts = this.recoverNonterminalExecutions({
        authorityTimestamp,
        reasonCode: cleanRecoveryReason(reason)
      });
      const results = (Array.isArray(receipts) ? receipts : []).map(receipt => ({
        executionId: clean(receipt.executionId),
        fromState: clean(receipt.fromState),
        targetState: clean(receipt.targetState),
        decision: clean(receipt.decision),
        reasonCode: clean(receipt.reasonCode),
        persistedAttemptCount: Number(receipt.persistedAttemptCount || 0),
        authorityTimestamp: clean(receipt.authorityTimestamp)
      }));
      this.state.lastRecoveryAt = authorityTimestamp;
      this.state.lastRecovery = results.slice(-50);
      this.eventBus.publish('runtime:recovery-completed', {
        reason,
        results,
        authorityTimestamp
      });
    } finally {
      this.state.recovering = false;
    }
    return this.status();
  }
}

const runtimeRecoveryService = new RuntimeRecoveryService();
module.exports = runtimeRecoveryService;
module.exports.RuntimeRecoveryService = RuntimeRecoveryService;
