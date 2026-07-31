'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectServerStartupFailureSources } = require('../../tools/wp4/scan-secret-transports');

const ROOT = path.resolve(__dirname, '../..');
const serverSource = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const channelSource = fs.readFileSync(path.join(ROOT, 'backend', 'bootstrap', 'parentLifecycleChannel.js'), 'utf8');

function reasons(serverMutation = serverSource, channelMutation = channelSource) {
  return inspectServerStartupFailureSources({
    serverSource: serverMutation,
    channelSource: channelMutation
  }).map(row => row.reasonCode);
}

function expectKilled(id, source, expected, channel = channelSource) {
  assert.notEqual(source, serverSource, `${id} anchor must mutate production source`);
  const observed = reasons(source, channel);
  assert.ok(observed.includes(expected), `${id} must be rejected; observed=${JSON.stringify(observed)}`);
}

test('server startup-failed path mutations cannot expose raw diagnostics or readiness context', () => {
  assert.deepEqual(reasons(), []);

  const inlineRaw = serverSource.replace(
    `  const payload = buildServerStartupFailureLifecycleMessage(error, {\n    pid: process.pid,\n    reasonCode: code\n  });`,
    `  const payload = {\n    type: 'backend:startup-failed',\n    reasonCode: error.code,\n    code: error.code,\n    phase: 'server-startup',\n    message: error.message,\n    stack: error.stack,\n    pid: process.pid\n  };`
  );
  expectKilled('INLINE_RAW_ERROR', inlineRaw, 'SERVER_STARTUP_FAILURE_BUILDER_BYPASSED');
  assert.ok(reasons(inlineRaw).includes('SERVER_STARTUP_FAILURE_RAW_MESSAGE_EXPOSED'));
  assert.ok(reasons(inlineRaw).includes('SERVER_STARTUP_FAILURE_RAW_STACK_EXPOSED'));

  const genericIpc = serverSource.replace(
    '  sendParentLifecycleMessage(payload);',
    "  sendParentMessage({ type: 'backend:startup-failed', ...readinessPayload({ includeNonce: true }), ...failure });"
  );
  expectKilled('GENERIC_IPC_AND_READINESS_SPREAD', genericIpc, 'SERVER_STARTUP_FAILURE_CHANNEL_BYPASSED');
  assert.ok(reasons(genericIpc).includes('SERVER_STARTUP_FAILURE_GENERIC_IPC_USED'));
  assert.ok(reasons(genericIpc).includes('SERVER_STARTUP_FAILURE_DYNAMIC_SPREAD'));
  assert.ok(reasons(genericIpc).includes('SERVER_STARTUP_FAILURE_CONTEXT_EXPOSED'));

  const rawStderr = serverSource.replace(
    'JSON.stringify(payload)',
    "JSON.stringify({ ...payload, message: error.message, stack: error.stack, startupNonce: STARTUP_NONCE })"
  );
  expectKilled('RAW_STDERR_DIAGNOSTICS', rawStderr, 'SERVER_STARTUP_FAILURE_RAW_MESSAGE_EXPOSED');
  assert.ok(reasons(rawStderr).includes('SERVER_STARTUP_FAILURE_RAW_STACK_EXPOSED'));
  assert.ok(reasons(rawStderr).includes('SERVER_STARTUP_FAILURE_CONTEXT_EXPOSED'));

  const dynamicReason = serverSource.replace(
    "announceStartupFailure(error, 'SERVER_LISTEN_FAILED');",
    'announceStartupFailure(error, error.code);'
  );
  expectKilled('DYNAMIC_REASON', dynamicReason, 'SERVER_STARTUP_FAILURE_DYNAMIC_REASON');
});

test('server startup-failure builder mutations cannot add secret fields, raw message, raw stack, or dynamic spread', () => {
  const mutations = [
    {
      id: 'RAW_MESSAGE',
      source: channelSource.replace(
        'message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode]',
        'message: error.message'
      ),
      expected: 'SERVER_STARTUP_FAILURE_RAW_MESSAGE_EXPOSED'
    },
    {
      id: 'RAW_STACK',
      source: channelSource.replace(
        `message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode],\n    stackHash: bootFailureStackHash(error),\n    causeCodeHash: failureCauseCodeHash(error, reasonCode),`,
        `message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode],\n    stackHash: bootFailureStackHash(error),\n    stack: error.stack,\n    causeCodeHash: failureCauseCodeHash(error, reasonCode),`
      ),
      expected: 'SERVER_STARTUP_FAILURE_RAW_STACK_EXPOSED'
    },
    {
      id: 'ERROR_SPREAD',
      source: channelSource.replace(
        `phase: 'server-startup',\n    message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode]`,
        `phase: 'server-startup',\n    ...error,\n    message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode]`
      ),
      expected: 'SERVER_STARTUP_FAILURE_BUILDER_DYNAMIC_SPREAD'
    },
    {
      id: 'SECRET_FIELD',
      source: channelSource.replace(
        `message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode],\n    stackHash: bootFailureStackHash(error),\n    causeCodeHash: failureCauseCodeHash(error, reasonCode),`,
        `message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode],\n    stackHash: bootFailureStackHash(error),\n    secret: error.secret,\n    causeCodeHash: failureCauseCodeHash(error, reasonCode),`
      ),
      expected: 'SERVER_STARTUP_FAILURE_SENSITIVE_FIELD_ADDED'
    }
  ];

  for (const mutation of mutations) {
    assert.notEqual(mutation.source, channelSource, `${mutation.id} anchor must mutate production source`);
    const observed = reasons(serverSource, mutation.source);
    assert.ok(observed.includes(mutation.expected), `${mutation.id} must be rejected; observed=${JSON.stringify(observed)}`);
  }
});
