'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const packageVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package');
const upstreamVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-upstream');

const XSTATE_COMMIT = 'c25dba07a2b68565edbe83d83c5d679dd85e00b2';

test('governed scratch roots canonicalize Windows short paths before source checkout', () => {
  const result = packageVerifier.createGovernedScratchDirectory({
    baseDirectory: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp',
    prefix: 'yance-wp-b-',
    realpathImpl: () => 'C:\\Users\\runneradmin\\AppData\\Local\\Temp',
    mkdtempImpl: candidate => `${candidate}fixture`
  });

  assert.equal(result, 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\yance-wp-b-fixture');
});

test('exact checkout freezes LF bytes before materializing the upstream tree', () => {
  const calls = [];
  packageVerifier.checkoutExactUpstreamTag({
    checkoutRoot: 'D:\\a\\_temp\\xstate-fixture',
    mkdirImpl() {},
    runCommand(command, args, options) {
      calls.push({ command, args: [...args], options: { ...options } });
      if (args[0] === 'rev-parse') {
        return Object.freeze({ status: 0, stdout: `${XSTATE_COMMIT}\n`, stderr: '' });
      }
      return Object.freeze({ status: 0, stdout: '', stderr: '' });
    }
  });

  const autoCrlf = calls.find(call => call.args.join(' ') === 'config core.autocrlf false');
  const eol = calls.find(call => call.args.join(' ') === 'config core.eol lf');
  const checkoutIndex = calls.findIndex(call => call.args[0] === 'checkout');
  assert.ok(autoCrlf);
  assert.ok(eol);
  assert.ok(calls.indexOf(autoCrlf) < checkoutIndex);
  assert.ok(calls.indexOf(eol) < checkoutIndex);
  assert.equal(autoCrlf.options.timeoutMs > 0, true);
  assert.equal(eol.options.timeoutMs > 0, true);
});

test('real Vitest summary preserves upstream skipped and todo counts', () => {
  const summary = upstreamVerifier.parseVitestSummary([
    ' Test Files  75 passed (75)',
    '      Tests  1721 passed | 13 skipped | 1 todo (1735)'
  ].join('\n'));

  assert.deepEqual(summary, {
    testFilePassCount: 75,
    testFileFailCount: 0,
    testPassCount: 1721,
    testFailCount: 0,
    skipCount: 13,
    todoCount: 1
  });
});
