'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { normalizeWindowsPathLexically, resolveWindowsShortPath } = require('../../tools/release-closure/windows-short-path');

function withTempDirectory(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-short-path-test-'));
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

test('Windows short-path resolver uses cmd.exe and never PowerShell COM', () => withTempDirectory((root) => {
  let observed;
  const result = resolveWindowsShortPath(root, {
    platform: 'win32',
    commandInterpreter: 'C:\\Windows\\System32\\cmd.exe',
    exists(candidate) { return candidate === 'C:\\YANCE~1\\PROBE~1'; },
    spawn(file, args, options) {
      observed = { file, args, options };
      return { status: 0, stdout: 'C:\\YANCE~1\\PROBE~1\r\n', stderr: '' };
    }
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.reasonCode, 'WINDOWS_SHORT_PATH_ALIAS_AVAILABLE');
  assert.match(observed.file, /cmd\.exe$/i);
  assert.deepEqual(observed.args.slice(0, 2), ['/d', '/c']);
  assert.match(observed.args[2], /%~sI/);
  assert.doesNotMatch(observed.args[2], /powershell|comobject|filesystemobject/i);
  assert.equal(observed.options.env.YANCE_WINDOWS_SHORT_PATH_TARGET, path.resolve(root));
  assert.equal(observed.options.windowsVerbatimArguments, true);
}));

test('Windows short-path resolver distinguishes unavailable alias from command failure', () => withTempDirectory((root) => {
  const unavailable = resolveWindowsShortPath(root, {
    platform: 'win32',
    spawn() { return { status: 0, stdout: `${path.resolve(root)}\r\n`, stderr: '' }; }
  });
  assert.equal(unavailable.status, 'FAIL');
  assert.equal(unavailable.reasonCode, 'WINDOWS_SHORT_PATH_ALIAS_UNAVAILABLE');

  const commandFailure = resolveWindowsShortPath(root, {
    platform: 'win32',
    spawn() { return { status: 5, stdout: '', stderr: 'blocked' }; }
  });
  assert.equal(commandFailure.status, 'FAIL');
  assert.equal(commandFailure.reasonCode, 'WINDOWS_SHORT_PATH_COMMAND_FAILED');
  assert.equal(commandFailure.exitCode, 5);
}));

test('WP3 runtime alias scenario shares the WorkBuddy-compatible native resolver', () => withTempDirectory((root) => {
  const { windowsShortPath } = require('../../tools/wp3/production-runtime-alias-scenario');
  const value = windowsShortPath(root, {
    platform: 'win32',
    exists(candidate) { return candidate === 'C:\\YANCE~1\\RUNTIME~1'; },
    spawn() { return { status: 0, stdout: 'C:\\YANCE~1\\RUNTIME~1\r\n', stderr: '' }; }
  });
  assert.equal(value, 'C:\\YANCE~1\\RUNTIME~1');
}));

test('Windows short-path comparison is lexical and does not canonicalize a valid 8.3 alias back to the long path', () => {
  const longPath = 'C:\\Users\\1\\AppData\\Local\\Temp\\Yance-Windows-Validation-372a28c-Round1\\Yance Long Path Probe 1234567890';
  const shortPath = 'C:\\Users\\1\\AppData\\Local\\Temp\\YA3460~1\\YANCEL~1';
  assert.notEqual(normalizeWindowsPathLexically(shortPath), normalizeWindowsPathLexically(longPath));

  const result = resolveWindowsShortPath(longPath, {
    platform: 'win32',
    commandInterpreter: 'C:\\Windows\\System32\\cmd.exe',
    exists(candidate) { return candidate === shortPath; },
    spawn() { return { status: 0, stdout: `${shortPath}\r\n`, stderr: '' }; }
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.reasonCode, 'WINDOWS_SHORT_PATH_ALIAS_AVAILABLE');
  assert.equal(result.lexicallyDistinct, true);
  assert.equal(result.comparisonMethod, 'LEXICAL_CASE_INSENSITIVE_NO_CANONICALIZATION');
});



test('Windows short-path resolver rejects cmd output corrupted by automatic Windows argument quoting', () => withTempDirectory((root) => {
  const malformed = `D:\\"${path.resolve(root)}\\"`;
  const result = resolveWindowsShortPath(root, {
    platform: 'win32',
    spawn() { return { status: 0, stdout: `${malformed}\r\n`, stderr: '' }; }
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.reasonCode, 'WINDOWS_SHORT_PATH_COMMAND_OUTPUT_INVALID');
  assert.equal(result.outputValid, false);
  assert.equal(result.shortPathExists, false);
}));

test('Windows short-path lexical comparison ignores only case and trailing separators', () => {
  assert.equal(
    normalizeWindowsPathLexically('C:\\YanceTemp\\Probe\\'),
    normalizeWindowsPathLexically('c:\\yancetemp\\probe')
  );
});
