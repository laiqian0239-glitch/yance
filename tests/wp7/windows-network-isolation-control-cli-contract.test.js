'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-network-isolation-control-cli.js'), 'utf8');

test('control CLI serializes a hash-bound handle and fixed ProgramData custody fields', () => {
  assert.match(source, /schemaVersion: 2/);
  assert.match(source, /handleSha256/);
  assert.match(source, /attestationSha256/);
  assert.match(source, /guardianPid/);
  assert.match(source, /guardianScriptSha256/);
  assert.match(source, /defaultProtectedRoot\(\)/);
});

test('restore refuses changed session bytes and reconstructs protected paths rather than trusting serialized paths', () => {
  assert.match(source, /requireExpectedHash\('--session-sha256'/);
  assert.match(source, /serialized watchdog handle SHA256 mismatch/);
  assert.match(source, /path\.win32\.join\(sessionRoot, 'state\.json'\)/);
  assert.match(source, /path\.win32\.join\(sessionRoot, 'release\.signal'\)/);
  assert.match(source, /serialized isolation session escaped the audited ProgramData root/);
});

test('control CLI fails closed outside native Windows', () => {
  assert.match(source, /process\.platform !== 'win32'/);
  assert.match(source, /WP7_NETWORK_ISOLATION_PLATFORM_UNSUPPORTED/);
});
