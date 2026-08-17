'use strict';

const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

const OPERATION_TYPE = 'platform.auth.workflow';
const PENDING_STATES = new Set(['connecting', 'waiting-verification', 'pending', 'pending-user-action', 'qr', 'code', 'password', 'authorizing']);
const SUCCESS_STATES = new Set(['connected', 'online', 'ready', 'authorized', 'completed', 'success', 'succeeded']);
const FAILURE_STATES = new Set(['error', 'failed', 'rejected', 'expired']);
const CANCEL_OPERATIONS = new Set(['cancel', 'logout', 'pause', 'telegram.cancel', 'facebook.oauth.cancel']);
const CONTINUATION_OPERATIONS = new Set(['telegram.code', 'telegram.password', 'facebook.oauth.status', 'facebook.oauth.selectpage']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function scopeKey(platform, accountId) { return `${lower(platform)}:${clean(accountId)}`; }
function extractState(result = {}) {
  const candidates = [
    result.state, result.status, result.lifecycleState,
    result.account?.state, result.account?.status, result.account?.lifecycleState,
    result.flow?.state, result.flow?.status
  ].map(lower).filter(Boolean);
  if (result.cancelled === true || result.account?.cancelled === true || result.flow?.cancelled === true) return 'cancelled';
  if (result.connected === true || result.account?.connected === true) return 'connected';
  return candidates[0] || '';
}
function isActive(row) { return Boolean(row && !TERMINAL_STATES.has(clean(row.state).toUpperCase())); }

class PlatformAuthWorkflowAuthority {
  constructor(options = {}) { this.injectedLifecycle = options.lifecycle || null; }

  latest(lifecycle, platform, accountId) {
    return lifecycle.latest({ operationType: OPERATION_TYPE, scopeKey: scopeKey(platform, accountId) });
  }

  begin(lifecycle, input = {}) {
    const platform = lower(input.platform);
    const accountId = clean(input.accountId);
    const operation = lower(input.operation);
    const current = this.latest(lifecycle, platform, accountId);
    if ((CONTINUATION_OPERATIONS.has(operation) || CANCEL_OPERATIONS.has(operation)) && isActive(current)) {
      lifecycle.progress(current.operationId, Math.max(10, Number(input.progress || current.progress || 10)));
      return { created: false, operation: lifecycle.read(current.operationId), continuation: true };
    }
    const fingerprint = clean(input.objectFingerprint || input.fingerprint || input.flowId || input.challengeId || input.requestId)
      || `${platform}:${accountId}:${operation}:${Date.now()}`;
    const adapterSessionId = clean(input.adapterSessionId || input.flowId || input.sessionId);
    const resumePolicy = clean(input.resumePolicy) || (adapterSessionId ? 'resume_adapter_session' : 'fail_on_restart');
    const created = lifecycle.create({
      operationId: clean(input.operationId),
      operationType: OPERATION_TYPE,
      scopeKey: scopeKey(platform, accountId),
      objectFingerprint: fingerprint,
      metadata: { platform, accountId, operation, workflow: true },
      resumePolicy,
      adapterSessionId,
      challengeExpiresAt: clean(input.challengeExpiresAt || input.expiresAt)
    });
    lifecycle.start(created.operation.operationId, {
      progress: 5,
      resumePolicy,
      adapterSessionId,
      challengeExpiresAt: clean(input.challengeExpiresAt || input.expiresAt),
      leaseOwner: `platform-auth-${process.pid}`,
      leaseExpiresAt: new Date(Date.now() + 120000).toISOString()
    });
    return created;
  }

  afterCommand(lifecycle, context = {}, result = {}) {
    const operation = lower(context.operation);
    const row = lifecycle.read(context.operationId);
    if (!row) return { operation: null, pending: false };
    const options = { generation: row.generation, objectFingerprint: row.objectFingerprint };
    if (CANCEL_OPERATIONS.has(operation)) {
      const settled = lifecycle.cancel(row.operationId, 'AUTH_WORKFLOW_CANCELLED', { ...options, message: 'Authentication workflow was cancelled.' });
      return { operation: settled.operation, pending: false };
    }
    const state = extractState(result);
    if (SUCCESS_STATES.has(state)) {
      const settled = lifecycle.succeed(row.operationId, { platform: context.platform, accountId: context.accountId, operation, state, completed: true }, options);
      return { operation: settled.operation, pending: false };
    }
    if (FAILURE_STATES.has(state)) {
      const settled = lifecycle.fail(row.operationId, { code: clean(result.reasonCode || result.code) || 'AUTH_WORKFLOW_FAILED', message: clean(result.lastError || result.error || result.message) || `Authentication workflow entered ${state}` }, options);
      return { operation: settled.operation, pending: false };
    }
    lifecycle.progress(row.operationId, Math.max(10, Number(context.progress || 20)));
    return { operation: lifecycle.read(row.operationId), pending: PENDING_STATES.has(state) || !state, state };
  }

  settleFromState(lifecycle, input = {}) {
    const platform = lower(input.platform);
    const accountId = clean(input.accountId);
    const current = this.latest(lifecycle, platform, accountId);
    if (!isActive(current)) return { updated: false, reason: 'no-active-workflow', operation: current || null };
    const state = lower(input.state || input.status);
    const options = { generation: current.generation, objectFingerprint: current.objectFingerprint };
    if (SUCCESS_STATES.has(state)) return lifecycle.succeed(current.operationId, { platform, accountId, state, completed: true }, options);
    if (FAILURE_STATES.has(state) || ['logged-out', 'offline'].includes(state)) {
      return lifecycle.fail(current.operationId, { code: clean(input.reasonCode || input.code) || 'AUTH_WORKFLOW_FAILED', message: clean(input.lastError || input.error) || `Authentication workflow entered ${state}` }, options);
    }
    if (state === 'cancelled' || state === 'unconfigured' && input.cancelled === true) {
      return lifecycle.cancel(current.operationId, 'AUTH_WORKFLOW_CANCELLED', options);
    }
    if (PENDING_STATES.has(state)) return lifecycle.progress(current.operationId, Math.max(10, Number(input.progress || current.progress || 10)));
    return { updated: false, reason: 'non-terminal-state', operation: current };
  }
}

const singleton = new PlatformAuthWorkflowAuthority();
function bindDefaultLifecycleEvents() {
  return { bound: false, delegatedTo: 'AccountLifecycleSagaService' };
}

module.exports = {
  OPERATION_TYPE,
  PENDING_STATES,
  SUCCESS_STATES,
  FAILURE_STATES,
  CANCEL_OPERATIONS,
  CONTINUATION_OPERATIONS,
  extractState,
  PlatformAuthWorkflowAuthority,
  singleton,
  bindDefaultLifecycleEvents
};
