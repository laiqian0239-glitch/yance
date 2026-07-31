'use strict';

const { EventEmitter } = require('events');
const { CoreError, normalizeCoreError } = require('./errors');

const TRANSITIONS = Object.freeze({
  created: new Set(['booting', 'safeMode', 'shuttingDown', 'failed']),
  booting: new Set(['ready', 'degraded', 'offline', 'safeMode', 'failed', 'shuttingDown']),
  ready: new Set(['degraded', 'offline', 'suspended', 'safeMode', 'updating', 'recovering', 'shuttingDown', 'failed']),
  degraded: new Set(['ready', 'offline', 'suspended', 'safeMode', 'recovering', 'updating', 'shuttingDown', 'failed']),
  offline: new Set(['ready', 'degraded', 'suspended', 'safeMode', 'recovering', 'shuttingDown', 'failed']),
  suspended: new Set(['ready', 'degraded', 'offline', 'safeMode', 'shuttingDown', 'failed']),
  recovering: new Set(['ready', 'degraded', 'offline', 'safeMode', 'failed', 'shuttingDown']),
  safeMode: new Set(['recovering', 'shuttingDown', 'failed']),
  updating: new Set(['shuttingDown', 'failed']),
  shuttingDown: new Set(['stopped', 'failed']),
  stopped: new Set([]),
  failed: new Set(['recovering', 'safeMode', 'shuttingDown', 'stopped'])
});

class LifecycleManager extends EventEmitter {
  constructor({ eventBus, logger } = {}) {
    super();
    this.eventBus = eventBus;
    this.logger = logger;
    this.state = 'created';
    this.reason = '';
    this.changedAt = new Date().toISOString();
    this.participants = new Map();
    this.history = [];
  }

  register(name, participant, options = {}) {
    if (!name || !participant) throw new CoreError('LIFECYCLE_PARTICIPANT_INVALID', '生命周期参与者无效', { status: 400 });
    if (this.participants.has(name)) throw new CoreError('LIFECYCLE_PARTICIPANT_DUPLICATE', `生命周期参与者重复：${name}`, { status: 409 });
    this.participants.set(name, { name, participant, order: Number(options.order || 100), critical: options.critical !== false, state: 'registered', error: '' });
    return this;
  }

  transition(next, reason = '', metadata = {}) {
    if (next === this.state) return this.snapshot();
    const allowed = TRANSITIONS[this.state] || new Set();
    if (!allowed.has(next)) throw new CoreError('LIFECYCLE_TRANSITION_INVALID', `不允许的生命周期转换：${this.state} → ${next}`, { status: 409, details: { current: this.state, next } });
    const previous = this.state;
    this.state = next;
    this.reason = String(reason || '');
    this.changedAt = new Date().toISOString();
    const event = { previous, state: next, reason: this.reason, at: this.changedAt, ...metadata };
    this.history.unshift(event);
    this.history = this.history.slice(0, 100);
    this.eventBus?.publish?.('lifecycle:state-changed', event);
    this.emit('state', event);
    return this.snapshot();
  }

  ordered(reverse = false) {
    const rows = [...this.participants.values()].sort((a, b) => a.order - b.order);
    return reverse ? rows.reverse() : rows;
  }

  async invoke(method, { reverse = false, tolerateNonCritical = true } = {}) {
    const results = [];
    for (const row of this.ordered(reverse)) {
      const fn = row.participant?.[method];
      if (typeof fn !== 'function') continue;
      try {
        row.state = `${method}:running`;
        const value = await fn.call(row.participant, this.snapshot());
        row.state = `${method}:complete`;
        row.error = '';
        results.push({ name: row.name, ok: true, value });
      } catch (error) {
        const normalized = normalizeCoreError(error, 'LIFECYCLE_PARTICIPANT_FAILED');
        row.state = `${method}:failed`;
        row.error = normalized.message;
        results.push({ name: row.name, ok: false, code: normalized.code, error: normalized.message });
        this.logger?.error?.('lifecycle', 'participant-failed', { participant: row.name, method, code: normalized.code, error: normalized.message });
        if (row.critical || !tolerateNonCritical) throw normalized;
      }
    }
    return results;
  }

  async boot(options = {}) {
    this.transition('booting', 'core-runtime-boot');
    try {
      await this.invoke('prepare');
      const results = await this.invoke('start');
      const failedNonCritical = results.some(row => !row.ok);
      if (options.safeMode === true) {
        await this.invoke('enterSafeMode', { reverse: true, tolerateNonCritical: true });
        this.transition('safeMode', options.reason || 'safe-mode-startup', options.metadata || {});
      } else {
        this.transition(failedNonCritical ? 'degraded' : 'ready', failedNonCritical ? 'non-critical-participant-failed' : 'core-runtime-ready');
      }
      return this.snapshot();
    } catch (error) {
      this.transition('failed', error.message, { code: error.code || 'LIFECYCLE_BOOT_FAILED' });
      throw error;
    }
  }

  async setOnline(online, reason = '') {
    if (!online) {
      await this.invoke('offline', { reverse: true });
      return this.transition('offline', reason || 'network-offline');
    }
    if (this.state === 'offline' || this.state === 'degraded') {
      this.transition('recovering', reason || 'network-restored');
      await this.invoke('online');
      return this.transition('ready', 'network-restored');
    }
    return this.snapshot();
  }

  async suspend(reason = 'system-suspend') {
    await this.invoke('pause', { reverse: true });
    return this.transition('suspended', reason);
  }

  async resume(reason = 'system-resume') {
    await this.invoke('resume');
    return this.transition('ready', reason);
  }

  async enterSafeMode(reason = 'safe-mode-requested', metadata = {}) {
    if (this.state === 'safeMode') return this.snapshot();
    if (['updating', 'shuttingDown', 'stopped'].includes(this.state)) {
      throw new CoreError('LIFECYCLE_SAFE_MODE_BLOCKED', `当前状态不能进入安全模式：${this.state}`, { status: 409 });
    }
    await this.invoke('enterSafeMode', { reverse: true, tolerateNonCritical: true });
    return this.transition('safeMode', reason, metadata);
  }

  async exitSafeMode(reason = 'safe-mode-cleared') {
    if (this.state !== 'safeMode') return this.snapshot();
    this.transition('recovering', reason);
    const results = await this.invoke('exitSafeMode', { tolerateNonCritical: true });
    const failedNonCritical = results.some(row => !row.ok);
    return this.transition(failedNonCritical ? 'degraded' : 'ready', failedNonCritical ? 'safe-mode-exit-degraded' : reason);
  }

  async beginUpdate(reason = 'update-install') {
    if (!['ready', 'degraded'].includes(this.state)) throw new CoreError('LIFECYCLE_UPDATE_BLOCKED', `当前状态不能安装更新：${this.state}`, { status: 409 });
    await this.invoke('beforeUpdate', { reverse: true });
    return this.transition('updating', reason);
  }

  async shutdown(reason = 'application-exit') {
    if (this.state === 'stopped') return this.snapshot();
    if (this.state !== 'shuttingDown') this.transition('shuttingDown', reason);
    try {
      await this.invoke('stop', { reverse: true, tolerateNonCritical: true });
      this.transition('stopped', reason);
    } catch (error) {
      this.transition('failed', error.message, { code: error.code || 'LIFECYCLE_SHUTDOWN_FAILED' });
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      module: 'LifecycleManager',
      state: this.state,
      reason: this.reason,
      changedAt: this.changedAt,
      participants: this.ordered().map(row => ({ name: row.name, order: row.order, critical: row.critical, state: row.state, error: row.error })),
      history: this.history.slice(0, 20)
    };
  }
}

module.exports = { LifecycleManager, TRANSITIONS };
