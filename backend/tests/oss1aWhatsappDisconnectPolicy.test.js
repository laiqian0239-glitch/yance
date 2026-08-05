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
