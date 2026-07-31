'use strict';

const replyBrainAuthority = require('./replyBrainModelAuthority');
const aiTaskRoleReadinessAuthority = require('./aiTaskRoleReadinessAuthority');

const CORE_AI_TASKS = aiTaskRoleReadinessAuthority.CORE_AI_TASKS;

function accountReadiness(accountState = {}, recentOperations = []) {
  const accounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
  const onboardingStates = new Set(['unconfigured', 'waiting-verification', 'logged-out', 'paused']);
  const transientStates = new Set(['connecting']);
  const onboardingAccounts = accounts.filter(row => onboardingStates.has(String(row.state || '').toLowerCase()));
  const transientAccounts = accounts.filter(row => transientStates.has(String(row.state || '').toLowerCase()));
  const activeAccounts = accounts.filter(row => !onboardingStates.has(String(row.state || '').toLowerCase()));
  const unreadyAccounts = activeAccounts.filter(row => {
    const state = String(row.state || '').toLowerCase();
    if (transientStates.has(state)) return false;
    return !['connected', 'limited'].includes(state) || row.credentialReady !== true;
  });
  const operationFailures = (Array.isArray(recentOperations) ? recentOperations : []).filter(row => (
    row?.type === 'operation-failed'
    && ['account.connect', 'account.reconnect', 'account.logout', 'account.pause', 'account.resume'].includes(row.command)
  ));
  return { accounts, activeAccounts, onboardingAccounts, transientAccounts, unreadyAccounts, operationFailures };
}

function aiRoutingReadiness(modelState = {}) {
  const count = Array.isArray(modelState.models) ? modelState.models.length : Number(modelState.count || 0);
  const verified = Number(modelState.summary?.verified || modelState.verified || 0);
  const routingEligible = Number(modelState.summary?.routingEligible || modelState.routingEligible || 0);
  const replyBrain = modelState.replyBrain && typeof modelState.replyBrain === 'object'
    ? modelState.replyBrain
    : replyBrainAuthority.evaluate(Array.isArray(modelState.models) ? modelState.models : [], modelState.routes || {});
  const routeIntegrity = modelState.routeIntegrity && typeof modelState.routeIntegrity === 'object'
    ? modelState.routeIntegrity
    : { pass: true, invalidPersistedRouteCount: 0, quarantine: [] };
  return {
    count,
    verified,
    routingEligible,
    replyBrain,
    routeIntegrity,
    pass: count === 0 || (replyBrain.pass === true && routeIntegrity.pass !== false)
  };
}

function aiTaskRoutingReadiness(modelState = {}) {
  return aiTaskRoleReadinessAuthority.evaluate(modelState);
}

module.exports = { accountReadiness, aiRoutingReadiness, aiTaskRoutingReadiness, CORE_AI_TASKS };
