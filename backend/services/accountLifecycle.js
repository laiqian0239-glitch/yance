'use strict';

const TERMINAL_STATES = new Set(['merged', 'tombstoned', 'deleted']);

function clean(value) { return String(value == null ? '' : value).trim(); }

function lifecycleState(account = {}) {
  const explicit = clean(account.lifecycleState || account.lifecycle_state).toLowerCase();
  if (explicit) return explicit;
  if (account.tombstonedAt || account.tombstoned_at) return 'tombstoned';
  if (account.mergedIntoId || account.merged_into_id || account.metadata?.authAliasOf) return 'merged';
  if (account.paused) return 'paused';
  return 'active';
}

function isMigrationTemporary(account = {}) {
  const values = [account.id, account.adapterAccountId, account.displayName, account.metadata?.resolvedAuthAccountKey, account.metadata?.openClawAccountId]
    .map(value => clean(value).toLowerCase());
  return values.some(value => value.includes('_migrating_') || value.includes('-migrating-') || value.startsWith('migrating-'))
    || account.metadata?.migrationTemporary === true;
}

function eligibility(account = {}, options = {}) {
  const state = lifecycleState(account);
  const reasons = [];
  if (TERMINAL_STATES.has(state)) reasons.push(`lifecycle-${state}`);
  if (state === 'pending-auth' && !options.manual) reasons.push('authorization-pending');
  if (clean(account.mergedIntoId || account.merged_into_id || account.metadata?.authAliasOf)) reasons.push('identity-alias');
  if (account.tombstonedAt || account.tombstoned_at) reasons.push('tombstoned');
  if (isMigrationTemporary(account)) reasons.push('migration-temporary');
  if (!options.manual && account.paused) reasons.push('paused');
  if (!options.manual && account.autoReconnect === false) reasons.push('auto-reconnect-disabled');
  return { eligible: reasons.length === 0, state, reasons };
}

function assertEligible(account, options = {}) {
  const result = eligibility(account, options);
  if (result.eligible) return result;
  const error = new Error(`账号运行已被生命周期门禁阻止：${result.reasons.join(', ')}`);
  error.code = 'ACCOUNT_LIFECYCLE_BLOCKED';
  error.status = 409;
  error.reasons = result.reasons;
  throw error;
}

module.exports = { lifecycleState, isMigrationTemporary, eligibility, assertEligible, TERMINAL_STATES };
