'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SERVER_STARTUP_FAILURE_REASON_MESSAGES,
  buildServerStartupFailureLifecycleMessage,
  sendParentLifecycleMessage
} = require('../../backend/bootstrap/parentLifecycleChannel');

const ROOT = path.resolve(__dirname, '../..');

test('backend server startup-failed IPC emits only fixed safe diagnostics', () => {
  const raw = 'credential=alpha secret=bravo token=charlie sessionKey=delta databaseRow=echo';
  const error = new Error(raw);
  error.code = 'EADDRINUSE';
  error.stack = `Error: ${raw}\n    at openSecretDatabase (${raw})`;
  error.secret = raw;
  error.database = { row: raw };

  const payload = buildServerStartupFailureLifecycleMessage(error, {
    pid: 606,
    reasonCode: 'SERVER_LISTEN_FAILED'
  });
  let observed = null;
  assert.equal(sendParentLifecycleMessage(payload, {
    sender(message) {
      observed = message;
      return true;
    }
  }), true);

  assert.deepEqual(observed, {
    type: 'backend:startup-failed',
    reasonCode: 'SERVER_LISTEN_FAILED',
    code: 'SERVER_LISTEN_FAILED',
    phase: 'server-startup',
    message: SERVER_STARTUP_FAILURE_REASON_MESSAGES.SERVER_LISTEN_FAILED,
    stackHash: crypto.createHash('sha256').update(error.stack, 'utf8').digest('hex'),
    causeCodeHash: crypto.createHash('sha256').update('EADDRINUSE', 'utf8').digest('hex'),
    runtimeSubphase: 'server_startup',
    pid: 606
  });
  assert.deepEqual(Object.keys(observed), ['type', 'reasonCode', 'code', 'phase', 'message', 'stackHash', 'causeCodeHash', 'runtimeSubphase', 'pid']);
  const serialized = JSON.stringify(observed);
  for (const fragment of [raw, 'credential=alpha', 'secret=bravo', 'token=charlie', 'sessionKey=delta', 'databaseRow=echo']) {
    assert.equal(serialized.includes(fragment), false, `must not expose ${fragment}`);
  }
});

test('backend/server.js routes startup-failed IPC through only the audited builder and channel', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  const start = source.indexOf('function announceStartupFailure');
  const end = source.indexOf('function boundServerPort', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);

  assert.match(block, /buildServerStartupFailureLifecycleMessage\(error, \{/);
  assert.match(block, /pid: process\.pid/);
  assert.match(block, /reasonCode: code/);
  assert.match(block, /sendParentLifecycleMessage\(payload\);/);
  assert.match(block, /JSON\.stringify\(payload\)/);
  assert.doesNotMatch(block, /sendParentMessage\(/);
  assert.doesNotMatch(block, /readinessPayload\(/);
  assert.doesNotMatch(block, /error\?\?\.message|error\?\.message|error\.message/);
  assert.doesNotMatch(block, /error\?\?\.stack|error\?\.stack|error\.stack/);
  assert.doesNotMatch(block, /\.\.\.\s*(?:error|failure|payload)/);
  assert.doesNotMatch(block, /startupNonce|credentialMetadata/);
  assert.doesNotMatch(source, /sendParentMessage\(\{\s*type:\s*['"]backend:startup-failed['"]/);
  assert.doesNotMatch(source, /YANCE_R32_STORE_STARTUP_FAILED/);
});
