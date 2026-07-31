'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateOwnerRecord } = require('../../electron/desktopHost/BackendOwnerRegistry');
const {
  REQUIRED_CHECK_IDS,
  buildActiveOwnerRecord,
  staleIdentity,
  finalizeReport
} = require('../../tools/wp5/windows-legacy-runtime-cutover-evidence');

function windowsIdentity(seed = 'a') {
  return {
    platform: 'win32',
    creationTimeUtc: '2026-07-05T00:00:00.000Z',
    executablePathDigest: seed.repeat(64).slice(0, 64),
    commandDigest: (seed === '0' ? '1' : '0').repeat(64)
  };
}

test('Windows cutover evidence owner record satisfies the accepted WP4 registry schema', () => {
  const record = buildActiveOwnerRecord({ pid: 4242, processIdentity: windowsIdentity('a') });
  assert.equal(validateOwnerRecord(record, { requireProcessIdentity: true, expectedPlatform: 'win32' }), record);
  assert.equal(record.state, 'RUNNING');
  assert.equal(record.ownershipActive, true);
  assert.equal(record.trusted, true);
  assert.equal(record.reasonCode, 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED');
});

test('stale Windows identity remains schema-valid but cannot match the real command digest', () => {
  const actual = windowsIdentity('b');
  const stale = staleIdentity(actual);
  assert.notEqual(stale.commandDigest, actual.commandDigest);
  const record = buildActiveOwnerRecord({ pid: 4343, processIdentity: stale });
  assert.doesNotThrow(() => validateOwnerRecord(record, { requireProcessIdentity: true, expectedPlatform: 'win32' }));
});

test('Windows evidence cannot PASS when a required real-host check is missing or failed', () => {
  assert.deepEqual(REQUIRED_CHECK_IDS, [
    'NO_OWNER_ALLOWS_STARTUP',
    'LIVE_OWNER_CONTAINED',
    'PID_REUSE_NOT_KILLED',
    'AMBIGUOUS_IDENTITY_FAILS_CLOSED'
  ]);
  const incomplete = finalizeReport(REQUIRED_CHECK_IDS.slice(0, -1).map(id => ({ id, status: 'PASS' })), 'win32');
  assert.equal(incomplete.status, 'FAIL');
  assert.deepEqual(incomplete.completeness.missing, ['AMBIGUOUS_IDENTITY_FAILS_CLOSED']);

  const failed = finalizeReport(REQUIRED_CHECK_IDS.map(id => ({ id, status: id === 'PID_REUSE_NOT_KILLED' ? 'FAIL' : 'PASS' })), 'win32');
  assert.equal(failed.status, 'FAIL');
  assert.deepEqual(failed.completeness.failed, ['PID_REUSE_NOT_KILLED']);

  const complete = finalizeReport(REQUIRED_CHECK_IDS.map(id => ({ id, status: 'PASS' })), 'win32');
  assert.equal(complete.status, 'PASS');
  assert.equal(complete.productionChainExecuted, true);
});
