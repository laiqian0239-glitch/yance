'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const orch = require('../../tools/wp9/verifyOrchestrator');

// Injectable spawn that returns a canned result based on the command string.
function fakeSpawn(map) {
  return (command) => {
    const entry = map[command];
    if (entry) return { status: entry.status, stdout: entry.stdout || '', stderr: entry.stderr || '', durationMs: 5 };
    return { status: 0, stdout: '', stderr: '', durationMs: 5 };
  };
}

test('M9-1 registry declares 10 modules with correct tiers', () => {
  assert.equal(orch.MODULES.length, 10);
  const byId = Object.fromEntries(orch.MODULES.map(m => [m.id, m]));
  assert.equal(byId.M1.tier, 'real-machine');
  assert.equal(byId.M2.tier, 'headless');
  assert.equal(byId.M2.headless, 'npm run verify:m2');
  assert.equal(byId.M1.realMachine, 'npm run verify:m1:windows');
  assert.ok(byId.M7.realMachine.includes('run-required-tests'));
});

test('M9-2 runCommand reports ok on status 0', () => {
  const r = orch.runCommand('node --test x', { spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }) });
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
});

test('M9-3 runCommand reports not-ok on status 1', () => {
  const r = orch.runCommand('node --test x', { spawn: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
});

test('M9-4 runCommand catches spawn throw (timeout) as not-ok', () => {
  const r = orch.runCommand('node --test x', { spawn: () => { throw new Error('ETIMEDOUT'); } });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /ETIMEDOUT/);
});

test('M9-5 runModule headless runs the complete WP2 command and PASSes', () => {
  const spawn = fakeSpawn({ 'npm run verify:m2': { status: 0 } });
  const r = orch.runModule(orch.MODULES.find(m => m.id === 'M2'), { spawn });
  assert.equal(r.status, 'PASS');
  assert.equal(r.command, 'npm run verify:m2');
});

test('M9-6 runModule real-machine selects realMachine command', () => {
  const spawn = fakeSpawn({ 'npm run verify:m1:windows': { status: 0 } });
  const r = orch.runModule(orch.MODULES.find(m => m.id === 'M1'), { spawn, tier: 'real-machine' });
  assert.equal(r.command, 'npm run verify:m1:windows');
  assert.equal(r.status, 'PASS');
});

test('M9-7 runModule with no test files is SKIPPED (forward-compatible)', () => {
  const spawn = fakeSpawn({});
  // Use a synthetic module whose glob genuinely has no test files (decoupled from
  // any real module so the assertion stays valid even after wp* dirs are populated).
  const r = orch.runModule({ id: 'M_NOOP', tier: 'headless', headless: 'node --test tests/wp99/*.test.js' }, { spawn });
  assert.equal(r.status, 'SKIPPED');
  assert.match(r.reason, /no test files/);
});

test('M9-8 runAll filters by tier (headless only skips real-machine M1)', () => {
  const spawn = fakeSpawn({
    'npm run verify:m2': { status: 0 },
    'node --test tests/wp8/*.test.js': { status: 0 }
  });
  const run = orch.runAll({ tiers: ['headless'], spawn });
  const m1 = run.results.find(r => r.id === 'M1');
  const m2 = run.results.find(r => r.id === 'M2');
  assert.equal(m1.status, 'SKIPPED');
  assert.equal(m2.status, 'PASS');
});

test('M9-9 runAll filters by module list', () => {
  const spawn = fakeSpawn({ 'node --test tests/wp6/m6-*.test.js': { status: 0 } });
  const run = orch.runAll({ tiers: ['headless'], modules: ['M6'], spawn });
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].id, 'M6');
});

test('M9-10 evaluateGate fails when a headless module fails', () => {
  const spawn = fakeSpawn({
    'npm run verify:m2': { status: 1 },
    'node --test tests/wp8/*.test.js': { status: 0 }
  });
  const run = orch.runAll({ tiers: ['headless'], spawn });
  assert.equal(run.gate.passed, false);
  assert.deepEqual(run.gate.headlessFailed, ['M2']);
});

test('M9-11 evaluateGate: real-machine failure only fails when requireRealMachine', () => {
  const spawn = fakeSpawn({ 'npm run verify:m1:windows': { status: 1 } });
  const without = orch.runAll({ tiers: ['real-machine'], spawn, requireRealMachine: false });
  const withReq = orch.runAll({ tiers: ['real-machine'], spawn, requireRealMachine: true });
  assert.equal(without.gate.passed, true);
  assert.equal(withReq.gate.passed, false);
  assert.deepEqual(withReq.gate.realMachineFailed, ['M1']);
});

test('M9-12 formatReport renders a module table', () => {
  const spawn = fakeSpawn({ 'npm run verify:m2': { status: 0 } });
  const run = orch.runAll({ tiers: ['headless'], modules: ['M2'], spawn });
  const md = orch.formatReport(run);
  assert.match(md, /# 言策（Yance）验证报告/);
  assert.match(md, /M2/);
  assert.match(md, /GATE|gate/);
});

test('M9-13 hasTestFiles detects matching and missing globs', () => {
  assert.equal(orch.hasTestFiles('tests/wp8/*.test.js'), true);
  // Use a genuinely absent glob (decoupled from real modules) so the negative
  // assertion stays valid after wp10 tests are introduced by later milestones.
  assert.equal(orch.hasTestFiles('tests/wp99/*.test.js'), false);
  assert.equal(orch.hasTestFiles('tests/wp2/m2-*.test.js'), true);
});
