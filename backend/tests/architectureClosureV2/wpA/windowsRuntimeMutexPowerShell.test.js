'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mutexModule = require('../../../runtime/NamedRuntimeMutex');

test('Windows runtime mutex prefers an installed PowerShell 7 helper without changing timeout policy', () => {
  assert.equal(typeof mutexModule.resolveWindowsPowerShellExecutable, 'function');
  const programFiles = 'C:\\Program Files';
  const expected = path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  const actual = mutexModule.resolveWindowsPowerShellExecutable({
    env: { ProgramFiles: programFiles },
    platform: 'win32',
    existsSync: candidate => candidate === expected
  });
  assert.equal(actual, expected);
  const mutex = new mutexModule.NamedRuntimeMutex({ name: 'Local\\Yance.ACV2.Test', platform: 'win32' });
  assert.equal(mutex.acquireTimeoutMs, 5000, 'A1 repair must not relax the mutex timeout');
});

test('Windows runtime mutex falls back to Windows PowerShell when PowerShell 7 is not installed', () => {
  assert.equal(typeof mutexModule.resolveWindowsPowerShellExecutable, 'function');
  assert.equal(
    mutexModule.resolveWindowsPowerShellExecutable({
      env: { ProgramFiles: 'C:\\Program Files' },
      platform: 'win32',
      existsSync: () => false
    }),
    'powershell.exe'
  );
});

test('an explicit helper path is accepted only when it exists', () => {
  assert.equal(typeof mutexModule.resolveWindowsPowerShellExecutable, 'function');
  const explicit = 'D:\\Tools\\pwsh.exe';
  assert.equal(
    mutexModule.resolveWindowsPowerShellExecutable({
      env: { YANCE_RUNTIME_POWERSHELL_EXE: explicit },
      platform: 'win32',
      existsSync: candidate => candidate === explicit
    }),
    explicit
  );
  assert.throws(
    () => mutexModule.resolveWindowsPowerShellExecutable({
      env: { YANCE_RUNTIME_POWERSHELL_EXE: explicit },
      platform: 'win32',
      existsSync: () => false
    }),
    error => error?.code === 'WINDOWS_RUNTIME_POWERSHELL_EXPLICIT_PATH_INVALID'
  );
});
