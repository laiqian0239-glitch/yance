#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

if (process.platform !== 'win32') {
  console.error('verify:m1:windows must be run on Windows.');
  process.exit(2);
}

const configuredEvidenceRoot = String(process.env.YANCE_M1_EVIDENCE_ROOT || '').trim();
const evidenceRoot = configuredEvidenceRoot
  ? path.resolve(configuredEvidenceRoot)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'yance-m1-evidence-'));
const verificationEnv = {
  ...process.env,
  YANCE_M1_WINDOWS_EVIDENCE: '1',
  YANCE_M1_EVIDENCE_ROOT: evidenceRoot
};

const verify = spawnSync(process.execPath, [path.join(root, 'tools', 'm1', 'verify.js')], {
  cwd: root,
  stdio: 'inherit',
  env: verificationEnv
});
if (verify.status !== 0) process.exit(verify.status || 1);

const evidence = spawnSync(process.execPath, [path.join(root, 'tools', 'm1', 'generate-evidence.js')], {
  cwd: root,
  stdio: 'inherit',
  env: verificationEnv
});
if (evidence.status !== 0) process.exit(evidence.status || 1);

console.log('verify:m1:windows PASS');
