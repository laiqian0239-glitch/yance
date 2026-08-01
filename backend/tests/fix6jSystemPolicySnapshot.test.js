'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  normalizeSystemPolicy,
  assertWriteAllowedFromPolicy
} = require('../services/systemPolicyCore');
const { createSystemPolicySnapshot } = require('../services/systemPolicySnapshotAuthority');

function deeplyFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

test('normalizes policy and enforces emergency-stop writes without I/O', () => {
  const normalized = normalizeSystemPolicy({
    emergencyStop: 1,
    privacyMode: 0,
    reason: '  incident  ',
    safeMode: true,
    updatedBy: 'repository-only'
  });
  assert.deepEqual(normalized, {
    schemaVersion: 1,
    emergencyStop: true,
    privacyMode: false,
    reason: 'incident',
    operatingModeAuthority: 'runtime_state.operating_mode',
    sourceVersion: 1
  });
  assert.throws(
    () => assertWriteAllowedFromPolicy(normalized, 'account-send-text'),
    error => error.code === 'GLOBAL_WRITE_BLOCKED' && error.status === 423
  );
  assert.equal(assertWriteAllowedFromPolicy({ emergencyStop: false }, 'account-send-text'), true);
});

test('creates a deterministic deeply frozen execution policy snapshot', () => {
  const context = { createdAt: '2026-08-01T05:30:00.000Z', sourceVersion: 9 };
  const first = createSystemPolicySnapshot({ emergencyStop: false, privacyMode: true, updatedBy: 'alice', reason: 'x' }, context);
  const second = createSystemPolicySnapshot({ emergencyStop: false, privacyMode: true, updatedBy: 'bob', reason: 'x' }, context);
  assert.deepEqual(first, {
    schemaVersion: 1,
    emergencyStop: false,
    privacyMode: true,
    operatingModeAuthority: 'runtime_state.operating_mode',
    createdAt: '2026-08-01T05:30:00.000Z',
    sourceVersion: 9
  });
  assert.deepEqual(second, first);
  assert.equal('updatedBy' in first, false);
  assert.equal('reason' in first, false);
  assert.equal(deeplyFrozen(first), true);
});

test('policy core and snapshot authority load without repositories, backend lib, event bus or logger', () => {
  const corePath = path.join(__dirname, '..', 'services', 'systemPolicyCore.js');
  const snapshotPath = path.join(__dirname, '..', 'services', 'systemPolicySnapshotAuthority.js');
  const script = `
    require(${JSON.stringify(corePath)});
    require(${JSON.stringify(snapshotPath)});
    process.stdout.write(JSON.stringify(Object.keys(require.cache).map(value => value.toLowerCase())));
  `;
  const probe = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(probe.status, 0, probe.stderr);
  const modules = JSON.parse(probe.stdout);
  const forbidden = ['\\backend\\lib\\', 'systempolicyrepository', 'eventbus', 'logger', 'sqlite', 'store'];
  assert.deepEqual(modules.filter(modulePath => forbidden.some(fragment => modulePath.includes(fragment))), []);
});
