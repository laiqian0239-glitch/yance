'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { waitOutcome } = require('../../tools/wp3/production-runtime-alias-scenario');

test('WP3 alias observer consumes startup-failed lifecycle backlog without racing exit', async () => {
  const child = new EventEmitter();
  child.exitCode = 1;
  child.signalCode = null;
  child.__desktopHostLifecycleMessages = [{ type: 'backend:startup-failed', reasonCode: 'BOOT_RUNTIME_MUTEX_HELD' }];
  const outcome = await waitOutcome(child, 50);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.message.reasonCode, 'BOOT_RUNTIME_MUTEX_HELD');
  assert.equal(outcome.source, 'lifecycle-backlog');
});
