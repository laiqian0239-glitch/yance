'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runNpmScript } = require('../../tools/m1/npm-script-runner');

function captureSpawn(result = { status: 0 }) {
  const calls = [];
  return {
    calls,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return result;
    }
  };
}

test('M1 npm runner uses npm.cmd through the Windows shell', () => {
  const capture = captureSpawn();
  const result = runNpmScript('test:wp2', {
    platform: 'win32',
    cwd: 'C:\\Yance',
    spawn: capture.spawn
  });

  assert.equal(result.status, 0);
  assert.equal(capture.calls.length, 1);
  assert.equal(capture.calls[0].command, 'npm.cmd');
  assert.deepEqual(capture.calls[0].args, ['run', 'test:wp2']);
  assert.equal(capture.calls[0].options.shell, true);
  assert.equal(capture.calls[0].options.windowsHide, true);
});

test('M1 npm runner does not require a shell on non-Windows platforms', () => {
  const capture = captureSpawn();
  runNpmScript('test:wp2', {
    platform: 'linux',
    cwd: '/tmp/yance',
    spawn: capture.spawn
  });

  assert.equal(capture.calls[0].command, 'npm');
  assert.equal(capture.calls[0].options.shell, false);
});

test('M1 npm runner preserves spawn failures for the caller', () => {
  const expected = { status: null, error: Object.assign(new Error('invalid argument'), { code: 'EINVAL' }) };
  const capture = captureSpawn(expected);
  const result = runNpmScript('test:wp2', {
    platform: 'win32',
    spawn: capture.spawn
  });

  assert.equal(result, expected);
  assert.equal(result.error.code, 'EINVAL');
});

test('M1 npm runner rejects shell metacharacters in script names', () => {
  assert.throws(
    () => runNpmScript('test:wp2 & calc', { platform: 'win32', spawn: () => ({ status: 0 }) }),
    /scriptName/
  );
});
