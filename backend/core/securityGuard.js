'use strict';

const { randomUUID } = require('crypto');
const { isWriteCommand } = require('../../shared/core/contracts');
const { CoreError, normalizeCoreError } = require('../../shared/core/errors');

const SAFE_MODE_WRITE_ALLOWLIST = new Set([
  'recovery.enterSafeMode',
  'recovery.clearSafeMode',
  'recovery.createBackup',
  'recovery.stageRestore',
  'recovery.cancelRestore',
  'lifecycle.exitSafeMode',
  'security.deleteCredential'
]);
const LIFECYCLE_WRITE_BLOCKED_STATES = new Set(['updating', 'shuttingDown', 'stopped', 'failed']);
const INTERNAL_ACTORS = new Set(['system', 'backend-core', 'desktop-core', 'platform-adapter', 'recovery-manager']);
const INTERNAL_SECURITY_CONTEXT = Symbol('SecurityGuard.internalContext');
const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;

function clean(value) { return String(value == null ? '' : value).trim(); }

function validateCredentialRef(value, options = {}) {
  const raw = String(value == null ? '' : value);
  const key = raw.trim();
  if (!key && options.allowEmpty === true) return '';
  if (!key) throw new CoreError('INVALID_CREDENTIAL_REF', '凭据引用不能为空', { status: 400 });
  if (raw !== key || key.includes('..') || !CREDENTIAL_REF_PATTERN.test(key)) {
    throw new CoreError('INVALID_CREDENTIAL_REF', '凭据引用格式无效', {
      status: 400,
      details: { maximumLength: 256, pathSeparatorsAllowed: false }
    });
  }
  return key;
}

function trustedInternalContext(actor, context = {}) {
  const safeContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  const trusted = {
    actor,
    correlationId: clean(safeContext.correlationId),
    requireInternal: true
  };
  Object.defineProperty(trusted, INTERNAL_SECURITY_CONTEXT, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return trusted;
}

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
    this.policyProvidersSealed = false;
    this.decisions = { allowed: 0, denied: 0, lastDecisionAt: '' };
    this.auditSample = new Map();
    this.credentials = Object.freeze({
      get: (ref, context = {}) => this.readCredential(ref, context),
      has: ref => {
        const key = validateCredentialRef(ref, { allowEmpty: true });
        return key ? this.secureBridge.has(key) : false;
      },
      listRefs: () => this.secureBridge.listRefs(),
      persist: (ref, value, context = {}) => this.persistCredential(ref, value, context),
      remove: (ref, context = {}) => this.removeCredential(ref, context)
    });
  }

  setPolicyProviders({ safeModeProvider, lifecycleStateProvider, productionDiagnostics } = {}) {
    const hasBinding = typeof safeModeProvider === 'function'
      || typeof lifecycleStateProvider === 'function'
      || Boolean(productionDiagnostics);
    if (!hasBinding) return this;
    if (this.policyProvidersSealed) {
      throw new CoreError('SECURITY_POLICY_PROVIDERS_SEALED', '安全策略提供器已经绑定，禁止运行时重新绑定', { status: 409 });
    }
    if (typeof safeModeProvider === 'function') this.safeModeProvider = safeModeProvider;
    if (typeof lifecycleStateProvider === 'function') this.lifecycleStateProvider = lifecycleStateProvider;
    if (productionDiagnostics) this.productionDiagnostics = productionDiagnostics;
    this.policyProvidersSealed = true;
    return this;
  }

  authorize(action, context = {}) {
    const normalizedAction = clean(action);
    if (!normalizedAction) throw new CoreError('SECURITY_ACTION_REQUIRED', '安全操作名称不能为空', { status: 400 });
    const actor = clean(context.actor || context.subject || 'system');
    const correlationId = clean(context.correlationId) || randomUUID();
    const decision = { action: normalizedAction, actor, correlationId, at: new Date().toISOString(), allowed: true };
    try {
      const write = isWriteCommand(normalizedAction);
      const lifecycleState = clean(this.lifecycleStateProvider?.() || '');
      const safeMode = this.safeModeProvider?.() === true;
      decision.write = write;
      decision.lifecycleState = lifecycleState;
      decision.safeMode = safeMode;
      const recoveryAllowed = SAFE_MODE_WRITE_ALLOWLIST.has(normalizedAction);
      if (write && !recoveryAllowed) this.systemPolicy.assertWriteAllowed(normalizedAction);
      if (write && LIFECYCLE_WRITE_BLOCKED_STATES.has(lifecycleState)) {
        throw new CoreError('LIFECYCLE_WRITE_BLOCKED', `当前生命周期状态禁止写操作：${lifecycleState}`, { status: 423, details: { action: normalizedAction, lifecycleState } });
      }
      if (write && safeMode && !recoveryAllowed) {
        throw new CoreError('SAFE_MODE_WRITE_BLOCKED', `安全模式已阻止写操作：${normalizedAction}`, { status: 423, details: { action: normalizedAction } });
      }
      if (context.requireInternal === true
          && (context[INTERNAL_SECURITY_CONTEXT] !== true || !INTERNAL_ACTORS.has(actor))) {
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
    const key = validateCredentialRef(ref, { allowEmpty: true });
    if (!key) return null;
    this.authorize('security.credential.read', trustedInternalContext('backend-core', context));
    return this.secureBridge.get(key);
  }

  async persistCredential(ref, value, context = {}) {
    const key = validateCredentialRef(ref);
    this.authorize('security.saveCredential', trustedInternalContext('backend-core', context));
    const persisted = await this.secureBridge.persist(key, value || {});
    this.eventBus?.publish?.('security:credential-changed', { ref: key, action: 'persist', persisted: Boolean(persisted) });
    return persisted;
  }

  async removeCredential(ref, context = {}) {
    const key = validateCredentialRef(ref, { allowEmpty: true });
    if (!key) return false;
    this.authorize('security.deleteCredential', trustedInternalContext('backend-core', context));
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

module.exports = { SecurityGuard, validateCredentialRef };
