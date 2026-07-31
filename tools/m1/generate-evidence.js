#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');
const configuredEvidenceRoot = String(process.env.YANCE_M1_EVIDENCE_ROOT || '').trim();
const outputDir = configuredEvidenceRoot
  ? path.resolve(configuredEvidenceRoot)
  : path.join(root, 'evidence', 'm1');
const outputFile = path.join(outputDir, 'm1-evidence.json');

const docs = [
  'docs/architecture/M1_STARTUP_CHAIN_SPEC.md',
  'docs/architecture/M1_RUNTIME_CONTRACT.md',
  'docs/architecture/M1_RELEASE_CONTRACT.md',
  'docs/architecture/M1_STATE_TRANSITIONS.md',
  'docs/architecture/M1_ERROR_TAXONOMY.md',
  'docs/architecture/M1_EVIDENCE_MAPPING.md',
  'docs/architecture/M1_EXIT_CRITERIA.md'
];

const tests = [
  'tests/wp7/backend-launch-contract-preflight.test.js',
  'tests/wp7/backend-runtime-contract.test.js',
  'tests/wp2/desktop-host-process-lifecycle.test.js',
  'tests/wp2/backend-release-startup-order.test.js',
  'tests/wp4/backend-owner-registry-containment-recovery.test.js',
  'tests/wp4/backend-owner-exit-recovery.test.js',
  'tests/wp7/production-layout-contract.test.js',
  'tests/wp7/native-binary-scan.test.js'
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}

function statFile(file) {
  const absolute = path.join(root, file);
  const exists = fs.existsSync(absolute);
  return {
    path: file,
    exists,
    sha256: exists ? sha256(file) : null,
    bytes: exists ? fs.statSync(absolute).size : 0
  };
}

const evidence = {
  schema: 'yance.m1.evidence.v1',
  generatedAtUtc: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  docs: docs.map(statFile),
  tests: tests.map(statFile),
  windowsEvidenceRequired: true,
  windowsEvidenceComplete: process.platform === 'win32' && process.env.YANCE_M1_WINDOWS_EVIDENCE === '1'
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(outputFile);
