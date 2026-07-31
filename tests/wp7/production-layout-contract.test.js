'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '../..');

test('Electron packaged backend launch contract uses resources/app layout', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  assert.match(main, /function packagedAppRoot\(\)[\s\S]*path\.join\(process\.resourcesPath, 'app'\)/);
  const section = main.slice(main.indexOf('function resolveBackendLaunchPaths'), main.indexOf('function backendStartupTimeoutMs'));
  assert.match(section, /path\.join\(appRoot, 'backend', 'desktopHostedEntry\.js'\)/);
  assert.match(section, /node_modules/);
  assert.doesNotMatch(section, /app\.asar\.unpacked/);
});

test('backend runtime contract uses bundled Node and removes Electron-as-Node', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  assert.match(main, /function resolveTrustedNodeRuntime/);
  assert.match(main, /resources[\s\S]*runtime[\s\S]*node22/);
  assert.match(main, /delete env\.ELECTRON_RUN_AS_NODE/);
  assert.doesNotMatch(main, /ELECTRON_RUN_AS_NODE:\s*['"]1['"]/);
});

test('production Electron settings do not require node:sqlite', () => {
  const electronFiles = ['electron/main.js', 'electron/r32DesktopSettings.js'].map(rel => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  for (const source of electronFiles) assert.doesNotMatch(source, /require\(['"]node:sqlite['"]\)/);
});
