'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Windows 8.3 short-path fixture shares the native lexical resolver and never uses PowerShell COM', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'wp3', 'production-runtime-alias-scenario.js'), 'utf8');
  const start = source.indexOf('function windowsShortPath');
  const end = source.indexOf('\nasync function runProductionRuntimeAliasScenario', start);
  const section = source.slice(start, end);
  assert.match(source, /resolveWindowsShortPath/);
  assert.match(section, /resolveWindowsShortPath/);
  assert.doesNotMatch(source, /Scripting\.FileSystemObject|New-Object\s+-ComObject/i);
  assert.doesNotMatch(section, /powershell\.exe/i);
});
