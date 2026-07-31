'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  BOOT_FAILURE_REASON_MESSAGES,
  buildBootFailureLifecycleMessage,
  sendParentLifecycleMessage
} = require('../../backend/bootstrap/parentLifecycleChannel');

test('boot-failure IPC emits an explicit fixed schema with bounded safe diagnostics', () => {
  const raw = 'credential=user:pass token=secret sessionKey=private database={sensitive-row}';
  const error = new Error(raw);
  error.reasonCode = 'BOOT_DESKTOP_STARTUP_PIPE_FAILED';
  error.stack = `Error: ${raw}\n    at openSecretDatabase (${raw})`;
  let observed = null;
  const payload = buildBootFailureLifecycleMessage(error, { pid: 404 });
  assert.equal(sendParentLifecycleMessage(payload, { sender(message) { observed = message; return true; } }), true);
  assert.deepEqual(observed, {
    type: 'backend:startup-failed',
    reasonCode: 'BOOT_DESKTOP_STARTUP_PIPE_FAILED',
    code: 'BOOT_DESKTOP_STARTUP_PIPE_FAILED',
    phase: 'early-boot',
    message: BOOT_FAILURE_REASON_MESSAGES.BOOT_DESKTOP_STARTUP_PIPE_FAILED,
    stackHash: crypto.createHash('sha256').update(error.stack, 'utf8').digest('hex'),
    causeCodeHash: crypto.createHash('sha256').update('BOOT_DESKTOP_STARTUP_PIPE_FAILED', 'utf8').digest('hex'),
    runtimeSubphase: 'runtime_boot',
    pid: 404
  });
  const serialized = JSON.stringify(observed);
  assert.equal(serialized.includes(raw), false);
  assert.equal(serialized.includes(error.stack), false);
  assert.equal(Object.hasOwn(observed, 'stack'), false);
  assert.equal(Object.hasOwn(observed, 'error'), false);
  assert.equal(Object.hasOwn(observed, 'credential'), false);
  assert.equal(Object.hasOwn(observed, 'token'), false);
});
