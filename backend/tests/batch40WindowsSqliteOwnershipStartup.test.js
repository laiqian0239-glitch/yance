'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultCapturePidIdentity,
  isOwnerActive,
  processIdentityMatches
} = require('../lib/sqliteOwnership');

test('Batch40 Windows current-process ownership identity never launches CIM during startup', () => {
  let probes = 0;
  const identity = defaultCapturePidIdentity(4242, {}, {
    platform: 'win32',
    currentPid: 4242,
    processStartedAtMs: 1_700_000_000_123,
    execPath: 'C:/Program Files/nodejs/node.exe',
    windowsProbe() { probes += 1; throw new Error('CIM must not be called for the current process'); }
  });
  assert.match(identity, /^v3:win32:1700000000123:[a-f0-9]{64}$/);
  assert.equal(probes, 0);
});

test('Batch40 fresh live SQLite owner does not trigger synchronous identity capture', () => {
  let captures = 0;
  assert.equal(isOwnerActive(
    { lastHeartbeatMs: 10_000, pid: 42, processIdentity: 'v2:test:owner' },
    10_500,
    30_000,
    () => true,
    () => { captures += 1; return 'v2:test:owner'; }
  ), true);
  assert.equal(captures, 0);
});

test('Batch40 stale Windows PID reuse remains detectable with v3 identities', () => {
  const executableDigest = 'a'.repeat(64);
  const record = {
    lastHeartbeatMs: 1_000,
    pid: 42,
    processIdentity: `v3:win32:1700000000000:${executableDigest}`
  };
  assert.equal(isOwnerActive(
    record,
    61_000,
    30_000,
    () => true,
    () => `v3:win32:1700000010000:${executableDigest}`
  ), false);
});

test('Batch40 FIX4 v2 Windows lock identity remains comparable after v3 upgrade', () => {
  const executableDigest = 'c'.repeat(64);
  const legacy = `v2:win32:2023-11-14T22:13:20.1234567Z:${executableDigest}:${'d'.repeat(64)}`;
  assert.equal(processIdentityMatches(
    legacy,
    `v3:win32:1700000001123:${executableDigest}`
  ), true);
});
