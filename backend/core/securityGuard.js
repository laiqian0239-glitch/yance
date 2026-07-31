'use strict';

const { randomUUID } = require('crypto');
const { isWriteCommand } = require('../../shared/core/contracts');
const { CoreError, normalizeCoreError } = require('../../shared/core/errors');

const SAFE_MODE_WRITE_ALLOWLIST = Object.freeze([
  'recovery.',
  'lifecycle.exitSafeMode',
  'security.deleteCredential'
]);
const LIFECYCLE_WRITE_BLOCKED_STATES = new Set(['updating', 'shuttingDown', 'stopped', 'failed']);

function clean(value) { return String(value == null ? '' : value).trim(); }

class SecurityGuard {
  constructor({ secureBridge, systemPolicy, eventBus, logger }) {
    this.secureBridge = secureBridge;
    this.systemPolicy = systemPolicy;
    this.eventBus = eventBus;
    this.logger = logger;
    this.startedAt = new Date().toISOString();
    this.safeModeProvider = () => false;
    this.lifecycleStateProvider = () => '';
    this.productionDiagnostics = null;
    this.decisions = { allowed: 0, denied: 0, lastDecisionAt: '' };
    this.auditSample = new Map();
    this.credentials = Object.freeze({
      get: (ref, context = {}) => this.readCredential(ref, context),
      has: ref => this.secureBridge.has(clean(ref)),
      listRefs: () => this.secureBridge.listRefs(),
      persist: (ref, value, context = {}) => this.persistCredential(ref, value, context),
      remove: (ref, context = {}) => this.removeCredential(ref, context)
    });
  }

  setPolicyProviders({ safeModeProvider, lifecycleStateProvider, productionDiagnostics } = {}) {
    if (typeof safeModeProvider === 'function') this.safeModeProvider = safeModeProvider;
    if (typeof lifecycleStateProvider === 'function') this.lifecycleStateProvider = lifecycleStateProvider;
    if (productionDiagnostics) this.productionDiagnostics = productionDiagnostics;
    return this;
  }

  authorize(action, context = {}) {
    const normalizedAction = clean(action);
    if (!normalizedAction) throw new CoreError('SECURITY_ACTION_REQUIRED', '安全操作名称不能为空', { status: 400 });
    const actor = clean(context.actor || context.subject || 'system');
    const correlationId = clean(context.correlationId) || randomUUID();
    const decision = { action: normalizedAction, actor, correlationId, at: new Date().toISOString(), allowed: true };
    try {
      const write = isWriteCommand(normalizedAction) || context.write === true;
      const lifecycleState = clean(this.lifecycleStateProvider?.() || '');
      const safeMode = this.safeModeProvider?.() === true;
      decision.write = write;
      decision.lifecycleState = lifecycleState;
      decision.safeMode = safeMode;
      const recoveryAllowed = SAFE_MODE_WRITE_ALLOWLIST.some(prefix => normalizedAction.startsWith(prefix));
      if (write && !recoveryAllowed) this.systemPolicy.assertWriteAllowed(normalizedAction);
      if (write && LIFECYCLE_WRITE_BLOCKED_STATES.has(lifecycleState)) {
        throw new CoreError('LIFECYCLE_WRITE_BLOCKED', `当前生命周期状态禁止写操作：${lifecycleState}`, { status: 423, details: { action: normalizedAction, lifecycleState } });
      }
      if (write && safeMode && !recoveryAllowed) {
        throw new CoreError('SAFE_MODE_WRITE_BLOCKED', `安全模式已阻止写操作：${normalizedAction}`, { status: 423, details: { action: normalizedAction } });
      }
      if (context.requireInternal === true && !['system', 'backend-core', 'desktop-core', 'platform-adapter', 'recovery-manager'].includes(actor)) {
        throw new CoreError('SECURITY_INTERNAL_ONLY', `操作仅允许核心框架调用：${normalizedAction}`, { status: 403 });
      }
      this.decisions.allowed += 1;
      this.decisions.lastDecisionAt = decision.at;
      const highFrequencyRead = normalizedAction === 'security.credential.read';
      const sampleKey = `${normalizedAction}:${actor}`;
      const lastSample = this.auditSample.get(sampleKey) || 0;
      const shouldPublish = !highFrequencyRead || Date.now() - lastSample >= 15000;
      if (shouldPublish) {
        this.auditSample.set(sampleKey, Date.now());
        this.eventBus?.publish?.('security:decision', decision);
        this.productionDiagnostics?.recordEvent?.('security-decision', { correlationId, metadata: decision });
      }
      return decision;
    } catch (error) {
      const normalized = normalizeCoreError(error, 'SECURITY_DENIED');
      decision.allowed = false;
      decision.code = normalized.code;
      decision.message = normalized.message;
      this.decisions.denied += 1;
      this.decisions.lastDecisionAt = decision.at;
      this.logger?.warn?.('security', 'security-decision-denied', decision);
      this.eventBus?.publish?.('security:decision', decision);
      this.productionDiagnostics?.recordEvent?.('security-decision-denied', { correlationId, severity: 'warning', metadata: decision });
      throw normalized;
    }
  }

  async execute(action, context, operation) {
    const decision = this.authorize(action, context);
    try {
      const result = await operation(decision);
      return result;
    } catch (error) {
      const normalized = normalizeCoreError(error);
      this.logger?.warn?.('security', 'secured-operation-failed', {
        action: decision.action,
        actor: decision.actor,
        correlationId: decision.correlationId,
        code: normalized.code,
        error: normalized.message
      });
      throw normalized;
    }
  }

  readCredential(ref, context = {}) {
    const key = clean(ref);
    if (!key) return null;
    this.authorize('security.credential.read', { ...context, requireInternal: true, write: false });
    return this.secureBridge.get(key);
  }

  async persistCredential(ref, value, context = {}) {
    const key = clean(ref);
    if (!key) throw new CoreError('INVALID_CREDENTIAL_REF', '凭据引用不能为空', { status: 400 });
    this.authorize('security.saveCredential', { ...context, requireInternal: true, write: true });
    const persisted = await this.secureBridge.persist(key, value || {});
    this.eventBus?.publish?.('security:credential-changed', { ref: key, action: 'persist', persisted: Boolean(persisted) });
    return persisted;
  }

  async removeCredential(ref, context = {}) {
    const key = clean(ref);
    if (!key) return false;
    this.authorize('security.deleteCredential', { ...context, requireInternal: true, write: true });
    const removed = await this.secureBridge.remove(key);
    this.eventBus?.publish?.('security:credential-changed', { ref: key, action: 'remove', removed: Boolean(removed) });
    return removed;
  }


  onCredentialChanged(listener) {
    this.secureBridge.on('changed', listener);
    return () => this.secureBridge.off('changed', listener);
  }

  get available() { return Boolean(this.secureBridge.available); }

  snapshot() {
    return {
      module: 'SecurityGuard',
      ready: true,
      secureStorageAvailable: Boolean(this.secureBridge.available),
      credentialRefs: this.secureBridge.listRefs().length,
      decisions: { ...this.decisions },
      safeMode: this.safeModeProvider?.() === true,
      lifecycleState: clean(this.lifecycleStateProvider?.() || ''),
      startedAt: this.startedAt
    };
  }
}

module.exports = { SecurityGuard };
