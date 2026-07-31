'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectBootFailureSources } = require('../../tools/wp4/scan-secret-transports');

const ROOT = path.resolve(__dirname, '../..');
const entrySource = fs.readFileSync(path.join(ROOT, 'backend', 'desktopHostedEntry.js'), 'utf8');
const channelSource = fs.readFileSync(path.join(ROOT, 'backend', 'bootstrap', 'parentLifecycleChannel.js'), 'utf8');

function reasons(channelMutation, entryMutation = entrySource) {
  return inspectBootFailureSources({ entrySource: entryMutation, channelSource: channelMutation }).map(row => row.reasonCode);
}

test('credential leak mutations are killed by the boot-failure transport scanner', () => {
  assert.deepEqual(reasons(channelSource), []);

  const mutations = [
    {
      id: 'RAW_ERROR_MESSAGE',
      source: channelSource.replace('message: BOOT_FAILURE_REASON_MESSAGES[reasonCode]', 'message: error.message'),
      expected: 'BOOT_FAILURE_RAW_MESSAGE_EXPOSED'
    },
    {
      id: 'RAW_STACK',
      source: channelSource.replace('stackHash: bootFailureStackHash(error),', 'stackHash: bootFailureStackHash(error),\n    stack: error.stack,'),
      expected: 'BOOT_FAILURE_RAW_STACK_EXPOSED'
    },
    {
      id: 'ERROR_OBJECT_SPREAD',
      source: channelSource.replace("type: 'backend:startup-failed',", "type: 'backend:startup-failed',\n    ...error,"),
      expected: 'BOOT_FAILURE_DYNAMIC_SPREAD'
    },
    {
      id: 'SECRET_FIELD',
      source: channelSource.replace('    pid\n  });', '    pid,\n    secret: error.secret\n  });'),
      expected: 'BOOT_FAILURE_SENSITIVE_FIELD_ADDED'
    }
  ];

  for (const mutation of mutations) {
    assert.notEqual(mutation.source, channelSource, `${mutation.id} anchor must mutate production source`);
    assert.ok(reasons(mutation.source).includes(mutation.expected), `${mutation.id} must be rejected`);
  }
});

test('desktopHostedEntry mutation cannot bypass the strict builder with raw diagnostics', () => {
  const mutant = entrySource.replace(
    'const payload = buildBootFailureLifecycleMessage(error, { pid: process.pid });',
    "const payload = { type: 'backend:startup-failed', message: error.message, stack: error.stack, pid: process.pid };"
  );
  const observed = reasons(channelSource, mutant);
  assert.ok(observed.includes('BOOT_FAILURE_BUILDER_BYPASSED'));
  assert.ok(observed.includes('BOOT_FAILURE_RAW_MESSAGE_EXPOSED'));
  assert.ok(observed.includes('BOOT_FAILURE_RAW_STACK_EXPOSED'));
});
