'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGate, REQUIRED_DOMAINS, REQUIRED_LEVELS, REQUIRED_PROJECTIONS } = require('../../tools/uat/rootCauseClosureGate');

test('root cause closure design baseline is machine-checkable and evidence exporter P0 is closed at unit level', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const report = runGate(repoRoot);
  assert.equal(report.status, 'DESIGN_BASELINE_READY', JSON.stringify(report.blockers, null, 2));
  assert.equal(report.acceptanceLevel, 'SOURCE_CONTRACT_PASS');
  assert.equal(report.blockers.length, 0);
  assert.equal(report.openRootCauses.length, 0);
  assert.equal(report.remainingDefects.length, 0);
  assert.deepEqual(report.remainingDefects.map(row => row.id), []);
  assert.match(report.warning, /18 项已登记缺陷均已有源码关闭检查点/u);
  assert.match(report.warning, /不代表真实 Windows 已通过/u);
});

test('root cause closure requires all authority, acceptance and idempotency domains', () => {
  assert.equal(REQUIRED_DOMAINS.length, 11);
  assert.deepEqual(REQUIRED_LEVELS, [
    'SOURCE_CONTRACT_PASS',
    'UNIT_BEHAVIOR_PASS',
    'REAL_DB_REPLAY_PASS',
    'WINDOWS_RENDER_PASS',
    'END_TO_END_TASK_PASS',
    'USER_CONFIRMED_REAL_WINDOWS_PASS',
    'FORMAL_RELEASE_PASS'
  ]);
  assert.equal(REQUIRED_PROJECTIONS.length, 7);
});

test('root cause closure executable Product proof no longer reads the retired legacy frontend', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(repoRoot, 'tools', 'uat', 'rootCauseClosureGate.js'), 'utf8');
  for (const legacyCurrentProof of [
    "path.join(repoRoot, 'frontend', 'r32-component-readability.css')",
    "path.join(repoRoot, 'frontend', 'index.html')",
    "path.join(repoRoot, 'frontend', 'js', 'r32-ui-runtime.js')",
    "path.join(repoRoot, 'frontend', 'js', 'r32-ai-workbench-runtime.js')"
  ]) {
    assert.equal(source.includes(legacyCurrentProof), false, legacyCurrentProof);
  }
});

test('root cause closure requires Graphiti-only relationship inference authority readiness', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const report = runGate(repoRoot);
  const check = report.checks.find(row => row.id === 'known-root-cause:relationship-state-graphiti-only-ready');
  assert.ok(check, 'missing Graphiti-only relationship authority readiness check');
  assert.equal(check.pass, true, JSON.stringify(check.evidence, null, 2));
});
