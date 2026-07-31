'use strict';

/**
 * Stable account lifecycle facade.
 * Every verb returns the same top-level schema and never nests account.account.
 */
let manager = null;

function loadManager() {
  if (!manager) manager = require('./accountManager');
  return manager;
}

function setManager(custom) {
  manager = custom;
  return manager;
}

function operationResult(action, raw) {
  const account = raw?.account || (raw && raw.id ? raw : null);
  const adapterResult = raw?.account ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'account')) : null;
  return {
    account,
    result: adapterResult && Object.keys(adapterResult).length ? adapterResult : null,
    lifecycle: {
      action,
      state: account?.state || '',
      stateLabel: account?.stateLabel || '',
      at: new Date().toISOString()
    }
  };
}

async function stateFor(mgr, accountId, fallback = null) {
  if (fallback?.account) return fallback.account;
  if (typeof mgr.getLifecycleState === 'function') return mgr.getLifecycleState(accountId);
  if (typeof mgr.list === 'function') return mgr.list().accounts?.find(row => row.id === accountId) || null;
  return null;
}

async function start(accountId, options = {}) {
  const mgr = loadManager();
  const account = await mgr.connect(accountId, options);
  return operationResult(options.action || 'connect', account);
}

async function restart(accountId, options = {}) {
  const mgr = loadManager();
  const account = await mgr.reconnect(accountId, options);
  return operationResult(options.action || 'reconnect', account);
}

async function stop(accountId, options = {}) {
  const mgr = loadManager();
  const raw = await mgr.disconnect(accountId, { logout: Boolean(options.logout) });
  const account = await stateFor(mgr, accountId, raw);
  return operationResult(options.logout ? 'logout' : 'pause', raw?.account ? raw : { ...(raw || {}), account });
}

async function lifecycleState(accountId) {
  return stateFor(loadManager(), accountId);
}

async function eligibility(accountId, options) {
  const mgr = loadManager();
  if (typeof mgr.eligibility === 'function') return mgr.eligibility(accountId, options);
  const state = await stateFor(mgr, accountId);
  return require('./accountLifecycle').eligibility(state, options);
}

async function assertEligible(accountId, operation) {
  const mgr = loadManager();
  if (typeof mgr.assertEligible === 'function') return mgr.assertEligible(accountId, operation);
  const state = await stateFor(mgr, accountId);
  return require('./accountLifecycle').assertEligible(state || accountId, { manual: true });
}

module.exports = {
  start,
  restart,
  stop,
  setManager,
  lifecycleState,
  eligibility,
  assertEligible,
  operationResult
};
