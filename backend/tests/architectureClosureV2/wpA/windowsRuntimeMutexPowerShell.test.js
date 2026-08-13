'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mutexModule = require('../../../runtime/NamedRuntimeMutex');

test('runtime process ownership delegates to proper-lockfile and contains no PowerShell helper infrastructure', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../runtime/NamedRuntimeMutex.js'), 'utf8');
  assert.match(source, /require\(['"]proper-lockfile['"]\)/u);
  assert.doesNotMatch(source, /System\.Threading\.Mutex|PowerShell|powershell\.exe|node:child_process|net\.createServer/u);
  assert.equal(mutexModule.resolveWindowsPowerShellExecutable, undefined);
  const mutex = new mutexModule.NamedRuntimeMutex({ lockTarget: path.join(process.cwd(), '.runtime-test.db') });
  assert.equal(mutex.provider, 'PROPER_LOCKFILE');
});
