 'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const script = fs.readFileSync(path.join(ROOT, 'tools', 'release-closure', 'VERIFY_DELIVERY.ps1'), 'utf8');

test('delivery verifier is safe under Windows PowerShell 5.1 parameter binding', () => {
  assert.match(script, /\[string\]\$DeliveryRoot = ''/);
  assert.match(script, /\[string\]\$LogPath = ''/);
  assert.match(script, /IsNullOrWhiteSpace\(\$DeliveryRoot\).*\$PSScriptRoot/);
  assert.match(script, /IsNullOrWhiteSpace\(\$LogPath\).*Join-Path \$DeliveryRoot/);
  assert.doesNotMatch(script, /\$LogPath = \(Join-Path \$PSScriptRoot/);
});

test('delivery verifier remains fail-closed on missing, unsafe, and mismatched files', () => {
  assert.match(script, /SHA256SUMS\.txt is missing/);
  assert.match(script, /INVALID LINE/);
  assert.match(script, /UNSAFE/);
  assert.match(script, /MISSING/);
  assert.match(script, /HASH/);
  assert.match(script, /DELIVERY VERIFY PASS/);
});
