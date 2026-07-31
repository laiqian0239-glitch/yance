'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const verify = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'verify.js'), 'utf8');
const supervisor = fs.readFileSync(path.join(ROOT, 'tools', 'wp7', 'command-supervisor.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('WP7 exposes a continue-on-failure diagnostic mode without weakening strict verification', () => {
  assert.equal(pkg.scripts['verify:wp7:diagnostic'], 'node tools/wp7/verify.js --diagnostic');
  assert.match(verify, /diagnosticMode = process\.argv\.includes\('--diagnostic'\)/);
  assert.match(verify, /STRICT_FAIL_FAST/);
  assert.match(verify, /DIAGNOSTIC_CONTINUE/);
  assert.match(verify, /if \(!passed && !diagnosticMode\) break/);
  assert.match(verify, /classification\.status !== 'PASS' && !diagnosticMode/);
  assert.match(verify, /process\.exitCode = summary\.status === 'PASS' \? 0 : 1/);
});

test('WP7 timeout budgets account for the nested convergence matrix', () => {
  assert.match(verify, /CONVERGENCE:\s*1800000/);
  assert.match(verify, /ADVERSARIAL:\s*2700000/);
  assert.match(verify, /wp7-adversarial[\s\S]*TIMEOUTS\.ADVERSARIAL/);
});

test('convergence PASS forwards its persisted stdout evidence to adversarial review', () => {
  assert.match(verify, /function lastRecordedCommand\(name\)/);
  assert.match(verify, /lastRecordedCommand\('wp7-convergence-correction-matrix'\)\?\.stdoutPath/);
  assert.match(verify, /WP7_CONVERGENCE_EVIDENCE_PATH:\s*convergenceEvidencePath/);
  assert.doesNotMatch(verify, /convergenceEvidencePath\s*=\s*rows\[/);
});

test('long commands emit periodic heartbeat evidence and terminate their process tree on timeout', () => {
  assert.match(supervisor, /setInterval\(\(\) => heartbeat\('RUNNING'\)/);
  assert.match(supervisor, /TIMEOUT_TERMINATION_REQUESTED/);
  assert.match(supervisor, /taskkill\.exe/);
  assert.match(verify, /WP7_VERIFY_HEARTBEAT\.json/);
  assert.match(verify, /WP7_VERIFY_PROCESS_TIMELINE\.jsonl/);
});
