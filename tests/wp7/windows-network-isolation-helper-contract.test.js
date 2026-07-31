'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-network-isolation-helper.ps1');
const source = fs.readFileSync(sourcePath, 'utf8');
const launcherSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-network-isolation-uac-launcher.ps1'), 'utf8');

test('Windows helper has a closed action set and requires an administrator token', () => {
  assert.match(source, /\$allowedActions\s*=\s*@\('SNAPSHOT', 'DISABLE', 'RESTORE'\)/);
  assert.match(source, /WindowsBuiltInRole\]::Administrator/);
  assert.match(source, /requires an elevated administrator token/);
});

test('UAC launcher invokes only the fixed helper with request and receipt paths', () => {
  assert.match(launcherSource, /-Verb RunAs/);
  assert.match(launcherSource, /'-File', \$HelperPath/);
  assert.match(launcherSource, /'-RequestPath', \$RequestPath/);
  assert.match(launcherSource, /'-ReceiptPath', \$ReceiptPath/);
  assert.doesNotMatch(launcherSource, /Invoke-Expression|iex\b/i);
});

test('Windows helper addresses only verified physical interface indexes', () => {
  assert.match(source, /Get-NetAdapter -Physical/);
  assert.match(source, /Requested interface index is not a physical adapter/);
  assert.match(source, /Duplicate interface index/);
  assert.doesNotMatch(source, /-Name\s+\*/);
});

test('Windows helper emits an atomic structured receipt for PASS and FAIL', () => {
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT/);
  assert.match(source, /Move-Item -LiteralPath \$temporary -Destination \$ReceiptPath -Force/);
  assert.match(source, /status = 'PASS'/);
  assert.match(source, /status = 'FAIL'/);
});

test('authoritative receipt does not depend on localized adapter display names', () => {
  assert.doesNotMatch(source, /name = \$_\.Name/);
  assert.match(source, /interfaceIndex = \[int\] \$_\.InterfaceIndex/);
  assert.match(source, /macAddress = \$_\.MacAddress/);
});
