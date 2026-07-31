'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

test('packaged main initializes durable bootstrap diagnostics before business imports', () => {
  const source = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const enter = source.indexOf("earlyBootLogSync('electron-main-module-enter'");
  const businessImport = source.indexOf("const WebSocket = require('ws')");
  const desktopHostImport = source.indexOf("require('./desktopHost')");
  const dataRoot = source.indexOf('const DATA_ROOT = EARLY_BOOT_DATA_ROOT');
  assert.ok(enter > 0);
  assert.ok(businessImport > enter);
  assert.ok(desktopHostImport > enter);
  assert.ok(dataRoot > desktopHostImport);
  assert.match(source, /desktop-bootstrap\.jsonl/);
  assert.match(source, /electron-main-early-uncaught-exception/);
  assert.match(source, /electron-main-business-modules-loaded/);
});

test('backend launch path is direct trusted Node fork and PowerShell EncodedCommand remains sound-only', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const host = fs.readFileSync(path.join(ROOT, 'electron', 'desktopHost', 'BackendProcessHost.js'), 'utf8');
  const soundStart = main.indexOf('function requestWindowsNativeSound');
  const encoded = main.indexOf("'-EncodedCommand'", soundStart);
  const soundEnd = main.indexOf('async function showNotification', soundStart);
  assert.ok(soundStart > 0 && encoded > soundStart && encoded < soundEnd);
  assert.match(host, /this\.fork\(options\.entry, \[\], \{/);
  assert.match(host, /execPath: launchContract\.nodeRuntimeExecutablePath/);
  assert.match(host, /execArgv: \[\]/);
  assert.doesNotMatch(host, /powershell\.exe[\s\S]{0,400}backendEntryPath/);
});
