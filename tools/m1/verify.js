#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { runNpmScript } = require('./npm-script-runner');
const path = require('node:path');

const fs = require('node:fs');

const requiredDocs = [
  'docs/architecture/M1_STARTUP_CHAIN_SPEC.md',
  'docs/architecture/M1_RUNTIME_CONTRACT.md',
  'docs/architecture/M1_RELEASE_CONTRACT.md',
  'docs/architecture/M1_STATE_TRANSITIONS.md',
  'docs/architecture/M1_ERROR_TAXONOMY.md',
  'docs/architecture/M1_EVIDENCE_MAPPING.md',
  'docs/architecture/M1_EXIT_CRITERIA.md'
];

function verifyRequiredDocs() {
  for (const relative of requiredDocs) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) {
      console.error(`Missing M1 architecture document: ${relative}`);
      process.exit(1);
    }
    const content = fs.readFileSync(absolute, 'utf8');
    if (!/M1|Startup|Runtime|Release|Evidence|Exit/i.test(content)) {
      console.error(`M1 architecture document appears incomplete: ${relative}`);
      process.exit(1);
    }
  }
}

const root = path.resolve(__dirname, '..', '..');
const suites = [
  ['--check', 'electron/main.js'],
  ['--check', 'electron/backendStartupSupervisor.js'],
  ['--check', 'electron/desktopHost/BackendProcessHost.js'],
  ['--test', 'tests/wp7/backend-launch-contract-preflight.test.js'],
  ['--test', 'tests/wp7/backend-runtime-contract.test.js'],
  ['--test', 'tests/wp7/backend-server-ready-lifecycle.test.js'],
  ['--test', 'tests/wp2/desktop-host-process-lifecycle.test.js'],
  ['--test', 'tests/wp2/backend-release-startup-order.test.js'],
  ['--test', 'tests/wp2/api-session-token-inherited-pipe.test.js'],
  ['--test', 'tests/wp2/api-session-token-transport-leak-scan.test.js'],
  ['--test', 'tests/wp4/backend-owner-registry-containment-recovery.test.js'],
  ['--test', 'tests/wp4/backend-owner-exit-recovery.test.js'],
  ['--test', 'tests/wp7/production-layout-contract.test.js'],
  ['--test', 'tests/wp7/native-binary-scan.test.js']
];

verifyRequiredDocs();

for (const args of suites) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

// M1 Exit Criteria depends on the complete WP2 Electron-main governance suite,
// not only the startup-focused subset above. Running the npm script here prevents
// verify:m1 from reporting a false PASS when IPC inventory/evidence tests fail.
const wp2 = runNpmScript('test:wp2', { cwd: root, stdio: 'inherit' });
if (wp2.error) {
  console.error(`Unable to launch npm run test:wp2: ${wp2.error.code || wp2.error.message}`);
}
if (wp2.status !== 0) process.exit(wp2.status || 1);

console.log('verify:m1 PASS');
