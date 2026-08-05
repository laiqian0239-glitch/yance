from pathlib import Path
import textwrap

POLICY = textwrap.dedent(r'''
'use strict';

const AUTH_EPOCH_ACTION = Object.freeze({
  PRESERVE: 'PRESERVE',
  INCREMENT: 'INCREMENT',
  REVOKE: 'REVOKE'
});

const DEFAULT_DISCONNECT_REASONS = Object.freeze({
  loggedOut: 401,
  forbidden: 403,
  connectionLost: 408,
  timedOut: 408,
  multideviceMismatch: 411,
  connectionClosed: 428,
  connectionReplaced: 440,
  badSession: 500,
  unavailableService: 503,
  restartRequired: 515
});

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function statusFromError(error) {
  return integer(
    error?.output?.statusCode
      ?? error?.statusCode
      ?? error?.data?.statusCode
      ?? error?.cause?.output?.statusCode
      ?? error?.cause?.statusCode,
    0
  );
}

function result(input) {
  return Object.freeze({
    statusCode: integer(input.statusCode, 0),
    disposition: String(input.disposition),
    reasonCode: String(input.reasonCode),
    adapterState: String(input.adapterState),
    publicState: String(input.publicState),
    autoReconnect: input.autoReconnect === true,
    authEpochAction: String(input.authEpochAction),
    canAttemptSend: false,
    canReceive: false,
    manualReviewRequired: input.manualReviewRequired === true,
    ownershipLost: input.ownershipLost === true,
    restartRequired: input.restartRequired === true,
    retryClass: String(input.retryClass || 'NONE')
  });
}

function classifyDisconnect({
  statusCode,
  error,
  stopping = false,
  startupTimedOut = false,
  restartRequiredRebuilds = 0,
  disconnectReasons = DEFAULT_DISCONNECT_REASONS
} = {}) {
  const reasons = { ...DEFAULT_DISCONNECT_REASONS, ...(disconnectReasons || {}) };
  const code = integer(statusCode, statusFromError(error));

  if (stopping) {
    return result({
      statusCode: code,
      disposition: 'STOPPED_BY_OWNER',
      reasonCode: 'WHATSAPP_STOPPED_BY_OWNER',
      adapterState: 'stopped',
      publicState: 'logged-out',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false
    });
  }

  if (startupTimedOut) {
    return result({
      statusCode: code,
      disposition: 'STARTUP_TIMEOUT',
      reasonCode: 'WHATSAPP_STARTUP_TIMEOUT',
      adapterState: 'startup-timeout',
      publicState: 'error',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.loggedOut)) {
    return result({
      statusCode: code,
      disposition: 'LOGGED_OUT',
      reasonCode: 'WHATSAPP_LOGGED_OUT',
      adapterState: 'logged-out',
      publicState: 'logged-out',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.REVOKE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.connectionReplaced)) {
    return result({
      statusCode: code,
      disposition: 'CONNECTION_REPLACED',
      reasonCode: 'WHATSAPP_CONNECTION_REPLACED',
      adapterState: 'replaced',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: true,
      ownershipLost: true
    });
  }

  if (code === integer(reasons.restartRequired)) {
    if (integer(restartRequiredRebuilds) >= 1) {
      return result({
        statusCode: code,
        disposition: 'RESTART_REQUIRED_EXHAUSTED',
        reasonCode: 'WHATSAPP_RESTART_REQUIRED_EXHAUSTED',
        adapterState: 'manual-review',
        publicState: 'manual-review',
        autoReconnect: false,
        authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
        manualReviewRequired: true,
        restartRequired: true
      });
    }
    return result({
      statusCode: code,
      disposition: 'RESTART_REQUIRED_ONCE',
      reasonCode: 'WHATSAPP_RESTART_REQUIRED',
      adapterState: 'restarting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      restartRequired: true,
      retryClass: 'IMMEDIATE_ONCE'
    });
  }

  if (code === integer(reasons.badSession)) {
    return result({
      statusCode: code,
      disposition: 'BAD_SESSION',
      reasonCode: 'WHATSAPP_BAD_SESSION',
      adapterState: 'quarantined',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.REVOKE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.multideviceMismatch)) {
    return result({
      statusCode: code,
      disposition: 'MULTIDEVICE_MISMATCH',
      reasonCode: 'WHATSAPP_MULTIDEVICE_MISMATCH',
      adapterState: 'quarantined',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.INCREMENT,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.forbidden)) {
    return result({
      statusCode: code,
      disposition: 'FORBIDDEN',
      reasonCode: 'WHATSAPP_FORBIDDEN',
      adapterState: 'blocked',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.connectionLost) || code === integer(reasons.timedOut)) {
    return result({
      statusCode: code,
      disposition: 'TRANSIENT_CONNECTION_LOSS',
      reasonCode: 'WHATSAPP_TRANSIENT_CONNECTION_LOSS',
      adapterState: 'reconnecting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      retryClass: 'EXPONENTIAL'
    });
  }

  if (code === integer(reasons.connectionClosed)) {
    return result({
      statusCode: code,
      disposition: 'CONNECTION_CLOSED',
      reasonCode: 'WHATSAPP_CONNECTION_CLOSED',
      adapterState: 'reconnecting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      retryClass: 'EXPONENTIAL'
    });
  }

  if (code === integer(reasons.unavailableService)) {
    return result({
      statusCode: code,
      disposition: 'SERVICE_UNAVAILABLE',
      reasonCode: 'WHATSAPP_SERVICE_UNAVAILABLE',
      adapterState: 'reconnecting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      retryClass: 'EXPONENTIAL'
    });
  }

  return result({
    statusCode: code,
    disposition: 'UNKNOWN_FAIL_CLOSED',
    reasonCode: 'WHATSAPP_DISCONNECT_UNKNOWN',
    adapterState: 'unknown-disconnect',
    publicState: 'manual-review',
    autoReconnect: false,
    authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
    manualReviewRequired: true
  });
}

function shouldExecuteReconnect({
  policy,
  expectedGeneration,
  currentGeneration,
  expectedEpoch,
  currentEpoch,
  stopped = false,
  accountPresent = true
} = {}) {
  return Boolean(
    policy?.autoReconnect === true
      && stopped !== true
      && accountPresent === true
      && integer(expectedGeneration, -1) === integer(currentGeneration, -2)
      && integer(expectedEpoch, -1) === integer(currentEpoch, -2)
  );
}

module.exports = {
  AUTH_EPOCH_ACTION,
  DEFAULT_DISCONNECT_REASONS,
  classifyDisconnect,
  shouldExecuteReconnect,
  statusFromError
};
''').lstrip()

POLICY_TEST = textwrap.dedent(r'''
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTH_EPOCH_ACTION,
  DEFAULT_DISCONNECT_REASONS,
  classifyDisconnect
} = require('../services/whatsappDisconnectPolicy');

const CASES = [
  ['loggedOut', 'LOGGED_OUT', false, AUTH_EPOCH_ACTION.REVOKE, 'logged-out', true],
  ['forbidden', 'FORBIDDEN', false, AUTH_EPOCH_ACTION.PRESERVE, 'manual-review', true],
  ['connectionLost', 'TRANSIENT_CONNECTION_LOSS', true, AUTH_EPOCH_ACTION.PRESERVE, 'recovering', false],
  ['multideviceMismatch', 'MULTIDEVICE_MISMATCH', false, AUTH_EPOCH_ACTION.INCREMENT, 'manual-review', true],
  ['connectionClosed', 'CONNECTION_CLOSED', true, AUTH_EPOCH_ACTION.PRESERVE, 'recovering', false],
  ['connectionReplaced', 'CONNECTION_REPLACED', false, AUTH_EPOCH_ACTION.PRESERVE, 'manual-review', true],
  ['badSession', 'BAD_SESSION', false, AUTH_EPOCH_ACTION.REVOKE, 'manual-review', true],
  ['unavailableService', 'SERVICE_UNAVAILABLE', true, AUTH_EPOCH_ACTION.PRESERVE, 'recovering', false]
];

test('every exact Baileys disconnect code has a fail-closed disposition contract', () => {
  for (const [name, disposition, autoReconnect, authEpochAction, publicState, manualReviewRequired] of CASES) {
    const value = classifyDisconnect({ statusCode: DEFAULT_DISCONNECT_REASONS[name] });
    assert.equal(value.disposition, disposition, name);
    assert.equal(value.autoReconnect, autoReconnect, name);
    assert.equal(value.authEpochAction, authEpochAction, name);
    assert.equal(value.publicState, publicState, name);
    assert.equal(value.manualReviewRequired, manualReviewRequired, name);
    assert.equal(value.canAttemptSend, false, name);
    assert.equal(value.canReceive, false, name);
    assert.equal(Object.isFrozen(value), true, name);
  }
});

test('connectionReplaced never reclaims ownership automatically', () => {
  const value = classifyDisconnect({ statusCode: DEFAULT_DISCONNECT_REASONS.connectionReplaced });
  assert.equal(value.ownershipLost, true);
  assert.equal(value.autoReconnect, false);
  assert.equal(value.adapterState, 'replaced');
  assert.equal(value.reasonCode, 'WHATSAPP_CONNECTION_REPLACED');
});

test('restartRequired rebuilds once with the same epoch and then freezes for manual review', () => {
  const first = classifyDisconnect({
    statusCode: DEFAULT_DISCONNECT_REASONS.restartRequired,
    restartRequiredRebuilds: 0
  });
  assert.equal(first.disposition, 'RESTART_REQUIRED_ONCE');
  assert.equal(first.autoReconnect, true);
  assert.equal(first.restartRequired, true);
  assert.equal(first.authEpochAction, AUTH_EPOCH_ACTION.PRESERVE);

  const second = classifyDisconnect({
    statusCode: DEFAULT_DISCONNECT_REASONS.restartRequired,
    restartRequiredRebuilds: 1
  });
  assert.equal(second.disposition, 'RESTART_REQUIRED_EXHAUSTED');
  assert.equal(second.autoReconnect, false);
  assert.equal(second.manualReviewRequired, true);
});

test('unknown, owner-stop and startup-timeout states never fall through to ordinary reconnect', () => {
  const unknown = classifyDisconnect({ statusCode: 599 });
  assert.equal(unknown.disposition, 'UNKNOWN_FAIL_CLOSED');
  assert.equal(unknown.autoReconnect, false);
  assert.equal(unknown.publicState, 'manual-review');

  const stopped = classifyDisconnect({ statusCode: 428, stopping: true });
  assert.equal(stopped.disposition, 'STOPPED_BY_OWNER');
  assert.equal(stopped.autoReconnect, false);

  const timedOut = classifyDisconnect({ statusCode: 408, startupTimedOut: true });
  assert.equal(timedOut.disposition, 'STARTUP_TIMEOUT');
  assert.equal(timedOut.autoReconnect, false);
});

test('status code is extracted from nested Boom-like errors without exposing the error object', () => {
  const value = classifyDisconnect({ error: { output: { statusCode: 440 }, secret: 'must-not-return' } });
  assert.equal(value.disposition, 'CONNECTION_REPLACED');
  assert.equal(Object.prototype.hasOwnProperty.call(value, 'error'), false);
  assert.equal(JSON.stringify(value).includes('must-not-return'), false);
});
''').lstrip()

RECONNECT_TEST = textwrap.dedent(r'''
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_DISCONNECT_REASONS,
  classifyDisconnect,
  shouldExecuteReconnect
} = require('../services/whatsappDisconnectPolicy');

function transientPolicy() {
  return classifyDisconnect({ statusCode: DEFAULT_DISCONNECT_REASONS.connectionClosed });
}

test('reconnect ownership requires the exact generation and auth epoch', () => {
  const policy = transientPolicy();
  assert.equal(shouldExecuteReconnect({
    policy,
    expectedGeneration: 7,
    currentGeneration: 7,
    expectedEpoch: 12,
    currentEpoch: 12
  }), true);
  assert.equal(shouldExecuteReconnect({
    policy,
    expectedGeneration: 7,
    currentGeneration: 8,
    expectedEpoch: 12,
    currentEpoch: 12
  }), false);
  assert.equal(shouldExecuteReconnect({
    policy,
    expectedGeneration: 7,
    currentGeneration: 7,
    expectedEpoch: 12,
    currentEpoch: 13
  }), false);
  assert.equal(shouldExecuteReconnect({
    policy,
    expectedGeneration: 7,
    currentGeneration: 7,
    expectedEpoch: 12,
    currentEpoch: 12,
    stopped: true
  }), false);
});

test('non-reconnect dispositions cannot pass the ownership predicate', () => {
  for (const statusCode of [
    DEFAULT_DISCONNECT_REASONS.loggedOut,
    DEFAULT_DISCONNECT_REASONS.connectionReplaced,
    DEFAULT_DISCONNECT_REASONS.badSession,
    599
  ]) {
    const policy = classifyDisconnect({ statusCode });
    assert.equal(shouldExecuteReconnect({
      policy,
      expectedGeneration: 1,
      currentGeneration: 1,
      expectedEpoch: 2,
      currentEpoch: 2
    }), false, String(statusCode));
  }
});

test('adapter executes the policy with one timer and two-dimensional ownership checks', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  const start = source.indexOf("if (connection === 'close')");
  const end = source.indexOf("eventHandlers.set('messaging-history.set'", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);

  assert.match(block, /classifyDisconnect\(/u);
  assert.match(block, /this\.cancelReconnect\(accountId\)/u);
  assert.match(block, /expectedGeneration/u);
  assert.match(block, /expectedEpoch/u);
  assert.match(block, /shouldExecuteReconnect\(/u);
  assert.match(block, /restartRequiredRebuilds/u);
  assert.match(block, /authEpoch:\s*expectedEpoch/u);
  assert.equal((block.match(/this\.reconnectTimers\.set\(accountId, timer\)/gu) || []).length, 1);
  assert.doesNotMatch(block, /if\s*\(!loggedOut/u);
});
''').lstrip()

Path('backend/services/whatsappDisconnectPolicy.js').write_text(POLICY, encoding='utf-8')
Path('backend/tests/oss1aWhatsappDisconnectPolicy.test.js').write_text(POLICY_TEST, encoding='utf-8')
Path('backend/tests/oss1aWhatsappReconnectOwnership.test.js').write_text(RECONNECT_TEST, encoding='utf-8')

adapter_path = Path('backend/services/whatsappAdapter.js')
source = adapter_path.read_text(encoding='utf-8')
import_line = "const { createWhatsAppBaileysEventProcessor } = require('./whatsappBaileysEventProcessor');"
new_import = import_line + "\nconst { AUTH_EPOCH_ACTION, classifyDisconnect, shouldExecuteReconnect } = require('./whatsappDisconnectPolicy');"
assert source.count(import_line) == 1
source = source.replace(import_line, new_import, 1)

retry_line = "      retryCount: 0,"
assert source.count(retry_line) == 1
source = source.replace(retry_line, retry_line + "\n      restartRequiredRebuilds: Number(options.restartRequiredRebuilds || 0),", 1)

close_start = source.index("      if (connection === 'close') {")
close_end = source.index("\n    });\n\n    eventHandlers.set('messaging-history.set'", close_start)
new_close = textwrap.dedent(r'''
      if (connection === 'close') {
        clearStartupWatchdog(row);
        const closeErrorObject = lastDisconnect?.error || null;
        const statusCode = closeErrorObject?.output?.statusCode || closeErrorObject?.statusCode || 0;
        const stopping = this.stopping.has(accountId) || this.stoppedAccounts.has(accountId);
        const policy = classifyDisconnect({
          statusCode,
          error: closeErrorObject,
          stopping,
          startupTimedOut: row.startupTimedOut,
          restartRequiredRebuilds: row.restartRequiredRebuilds,
          disconnectReasons: baileys.DisconnectReason
        });
        const closeError = closeErrorObject?.message || `连接关闭（${statusCode || 'unknown'}）`;
        const invalidCredentials = policy.authEpochAction === AUTH_EPOCH_ACTION.REVOKE;
        await this.recordConnectionFailure(accountId, closeError, invalidCredentials)
          .catch(error => logger.error('whatsapp', 'account-connection-failure-update-failed', { accountId, error: error.message }));
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'connection.update', phase: 'close-recorded' });

        this.cancelReconnect(accountId);
        row.state = policy.adapterState;
        row.lastError = closeError;
        row.disconnectDisposition = policy.disposition;
        row.reasonCode = policy.reasonCode;
        row.authEpochAction = policy.authEpochAction;
        row.manualReviewRequired = policy.manualReviewRequired;
        row.ownershipLost = policy.ownershipLost;
        row.canAttemptSend = false;
        row.canReceive = false;
        row.sessionFence.invalidate(policy.reasonCode);
        row.socket = null;
        if (invalidCredentials) {
          authChallenges.clear(databaseAccountId);
          this.invalidateCredentialState(reference);
        }
        eventBus.publish('whatsapp:state', {
          accountId,
          databaseAccountId,
          state: row.state,
          publicState: policy.publicState,
          error: row.lastError,
          lastError: row.lastError,
          code: policy.reasonCode,
          reasonCode: policy.reasonCode,
          disposition: policy.disposition,
          authEpochAction: policy.authEpochAction,
          manualReviewRequired: policy.manualReviewRequired,
          ownershipLost: policy.ownershipLost,
          canAttemptSend: false,
          canReceive: false,
          attemptId: String(options.attemptId || '')
        });
        logger.warn('whatsapp', 'connection-closed', {
          accountId,
          statusCode: policy.statusCode,
          disposition: policy.disposition,
          reasonCode: policy.reasonCode,
          authEpochAction: policy.authEpochAction,
          manualReviewRequired: policy.manualReviewRequired
        });

        if (!policy.autoReconnect) return;
        const currentAccount = accountStore.getRaw(databaseAccountId) || this.accountByAdapterId(accountId);
        const gate = currentAccount
          ? accountLifecycle.eligibility(currentAccount, { manual: false })
          : { eligible: false, reasons: ['account-missing'] };
        if (!gate.eligible) {
          logger.warn('whatsapp', 'reconnect-blocked-by-lifecycle', { accountId, databaseAccountId, reasons: gate.reasons });
          return;
        }

        const expectedGeneration = row.generation;
        const expectedEpoch = Number(socketGuard.details?.epoch || 0);
        const nextRestartRequiredRebuilds = policy.restartRequired
          ? row.restartRequiredRebuilds + 1
          : row.restartRequiredRebuilds;
        row.retryCount += 1;
        const delay = policy.retryClass === 'IMMEDIATE_ONCE'
          ? 0
          : Math.min(30000, 1200 * 2 ** Math.min(row.retryCount, 5));
        const timer = setTimeout(() => {
          if (this.reconnectTimers.get(accountId) === timer) this.reconnectTimers.delete(accountId);
          const currentRow = this.accounts.get(accountId);
          const currentEpoch = Number(currentRow?.sessionFence?.details?.epoch || 0);
          if (!shouldExecuteReconnect({
            policy,
            expectedGeneration,
            currentGeneration: this.generations.get(accountId),
            expectedEpoch,
            currentEpoch,
            stopped: this.stoppedAccounts.has(accountId) || this.stopping.has(accountId),
            accountPresent: currentRow === row
          })) return;
          const latest = accountStore.getRaw(databaseAccountId) || this.accountByAdapterId(accountId);
          const latestGate = latest
            ? accountLifecycle.eligibility(latest, { manual: false })
            : { eligible: false, reasons: ['account-missing'] };
          if (!latestGate.eligible) {
            logger.warn('whatsapp', 'reconnect-cancelled-by-lifecycle', { accountId, databaseAccountId, reasons: latestGate.reasons });
            return;
          }
          this.start(latest, {
            authEpoch: expectedEpoch,
            restartRequiredRebuilds: nextRestartRequiredRebuilds
          }).catch(error => logger.error('whatsapp', 'reconnect-failed', {
            accountId,
            databaseAccountId,
            reasonCode: policy.reasonCode,
            error: error.message
          }));
        }, delay);
        timer.unref?.();
        this.reconnectTimers.set(accountId, timer);
      }
''').rstrip()
source = source[:close_start] + new_close + source[close_end:]
adapter_path.write_text(source, encoding='utf-8')

registry_path = Path('backend/services/platformDriverRegistry.js')
registry = registry_path.read_text(encoding='utf-8')
old_map = "function mapWhatsAppState(value) {\n  return ({ online: 'connected', qr: 'waiting-verification', connecting: 'connecting', offline: 'error', 'logged-out': 'logged-out', stopped: 'logged-out' })[value] || 'logged-out';\n}"
new_map = "function mapWhatsAppState(value) {\n  return ({\n    online: 'connected',\n    qr: 'waiting-verification',\n    connecting: 'connecting',\n    reconnecting: 'recovering',\n    restarting: 'recovering',\n    offline: 'error',\n    'startup-timeout': 'error',\n    replaced: 'manual-review',\n    quarantined: 'manual-review',\n    blocked: 'manual-review',\n    'manual-review': 'manual-review',\n    'unknown-disconnect': 'manual-review',\n    'logged-out': 'logged-out',\n    stopped: 'logged-out'\n  })[String(value || '').trim().toLowerCase()] || 'manual-review';\n}"
assert registry.count(old_map) == 1
registry = registry.replace(old_map, new_map, 1)
registry_path.write_text(registry, encoding='utf-8')

manager_path = Path('backend/services/accountManager.js')
manager = manager_path.read_text(encoding='utf-8')
old_connected = "    const connectedNow = state === 'connected' || state === 'limited';"
new_connected = old_connected + "\n    const manualReviewRequired = runtime.manualReviewRequired === true\n      || ['manual-review', 'replaced', 'quarantined', 'blocked', 'unknown-disconnect'].includes(state);"
assert manager.count(old_connected) == 1
manager = manager.replace(old_connected, new_connected, 1)
old_attempt = "    const canAttemptSend = authorityPending || !messagingSupported ? false : Boolean(runtimeSendReady && credentialReady && connectedNow);\n    const canReceive = authorityPending || !messagingSupported ? false : (typeof runtime.canReceive === 'boolean' ? runtime.canReceive : connectedNow);"
new_attempt = "    const canAttemptSend = authorityPending || manualReviewRequired || !messagingSupported\n      ? false\n      : Boolean(runtimeSendReady && credentialReady && connectedNow);\n    const canReceive = authorityPending || manualReviewRequired || !messagingSupported\n      ? false\n      : (typeof runtime.canReceive === 'boolean' ? runtime.canReceive : connectedNow);"
assert manager.count(old_attempt) == 1
manager = manager.replace(old_attempt, new_attempt, 1)
old_label = "      stateLabel: authorizationPending ? '等待平台授权' : latestSaga?.state === 'manual_review' ? '账号状态需要人工恢复' : lifecycleAuthorityPending ? '正在恢复账号状态' : stateLabel(state),"
new_label = "      stateLabel: authorizationPending ? '等待平台授权' : manualReviewRequired || latestSaga?.state === 'manual_review' ? '账号状态需要人工恢复' : lifecycleAuthorityPending ? '正在恢复账号状态' : stateLabel(state),"
assert manager.count(old_label) == 1
manager = manager.replace(old_label, new_label, 1)
insert_after = "      authorityPending,\n      lifecycleAuthorityPending,"
replacement = "      authorityPending,\n      manualReviewRequired,\n      disconnectDisposition: runtime.disconnectDisposition || runtime.disposition || '',\n      authEpochAction: runtime.authEpochAction || '',\n      ownershipLost: runtime.ownershipLost === true,\n      lifecycleAuthorityPending,"
assert manager.count(insert_after) == 1
manager = manager.replace(insert_after, replacement, 1)
manager_path.write_text(manager, encoding='utf-8')

lifecycle_test_path = Path('backend/tests/accountLifecycleRegression.test.js')
lifecycle_test = lifecycle_test_path.read_text(encoding='utf-8')
marker = "WhatsApp manual-review disconnect states remain send and receive blocked"
assert marker not in lifecycle_test
lifecycle_test += textwrap.dedent(r'''


test('WhatsApp manual-review disconnect states remain send and receive blocked', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const platformDrivers = require('../services/platformDriverRegistry');
  const managerSource = fs.readFileSync(path.join(__dirname, '../services/accountManager.js'), 'utf8');

  for (const runtimeState of ['replaced', 'quarantined', 'blocked', 'manual-review', 'unknown-disconnect']) {
    assert.equal(platformDrivers.mapWhatsAppState(runtimeState), 'manual-review', runtimeState);
  }
  assert.equal(platformDrivers.mapWhatsAppState('reconnecting'), 'recovering');
  assert.equal(platformDrivers.mapWhatsAppState('restarting'), 'recovering');
  assert.equal(platformDrivers.mapWhatsAppState('unrecognized-state'), 'manual-review');
  assert.match(managerSource, /manualReviewRequired/u);
  assert.match(managerSource, /authorityPending \|\| manualReviewRequired \|\| !messagingSupported/u);
  assert.match(managerSource, /ownershipLost: runtime\.ownershipLost === true/u);
});
''')
lifecycle_test_path.write_text(lifecycle_test, encoding='utf-8')

for file_name in [
    'backend/services/whatsappDisconnectPolicy.js',
    'backend/services/whatsappAdapter.js',
    'backend/services/platformDriverRegistry.js',
    'backend/services/accountManager.js',
    'backend/tests/oss1aWhatsappDisconnectPolicy.test.js',
    'backend/tests/oss1aWhatsappReconnectOwnership.test.js',
    'backend/tests/accountLifecycleRegression.test.js'
]:
    assert Path(file_name).exists(), file_name
