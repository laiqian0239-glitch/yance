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
