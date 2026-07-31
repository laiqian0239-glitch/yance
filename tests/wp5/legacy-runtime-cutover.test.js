'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LegacyRuntimeCutoverGate } = require('../../electron/desktopHost/LegacyRuntimeCutoverGate');
const { tempRoot, removeRoot } = require('./helpers');

function identity(seed = 'owner') { return { platform: 'test', startTicks: seed, commandDigest: crypto.createHash('sha256').update(seed).digest('hex') }; }
function ownerRecord(pid = 7001, processIdentity = identity()) {
  return {
    schemaVersion: 1, state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: pid,
    startupNonce: 'nonce', backendSessionId: 'session', fd6PipeInstanceId: 'pipe',
    processIdentity, reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED', updatedAtUtc: '2026-07-05T00:00:00.000Z'
  };
}
function writeOwner(root, value) {
  const file = path.join(root, 'secure', 'desktop-backend-owner.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test('no Yance27 owner record clears the cutover gate without mutation', async () => {
  const root = tempRoot();
  try {
    const result = await new LegacyRuntimeCutoverGate({ legacyDataRoot: root }).execute();
    assert.equal(result.ok, true);
    assert.equal(result.state, 'LEGACY_OWNER_CLEARED');
    assert.equal(result.sourceRegistryMutated, false);
  } finally { removeRoot(root); }
});

test('identity-matched live Yance27 owner is contained and real exit is confirmed', async () => {
  const root = tempRoot();
  let alive = true;
  const expected = identity('matched');
  const file = writeOwner(root, ownerRecord(7002, expected));
  const before = fs.readFileSync(file, 'utf8');
  const signals = [];
  try {
    const gate = new LegacyRuntimeCutoverGate({
      legacyDataRoot: root,
      isProcessAlive: () => alive,
      captureProcessIdentity: () => expected,
      killProcess: (_pid, signal) => { signals.push(signal); alive = false; },
      sleep: async () => {}
    });
    const result = await gate.execute({ gracefulMs: 25, forceMs: 25 });
    assert.equal(result.state, 'LEGACY_OWNER_EXIT_CONFIRMED');
    assert.deepEqual(signals, ['SIGTERM']);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { removeRoot(root); }
});

test('PID reuse is not killed and is treated as a cleared stale legacy owner', async () => {
  const root = tempRoot();
  const expected = identity('old');
  writeOwner(root, ownerRecord(7003, expected));
  let kills = 0;
  try {
    const result = await new LegacyRuntimeCutoverGate({
      legacyDataRoot: root,
      isProcessAlive: () => true,
      captureProcessIdentity: () => identity('new'),
      killProcess: () => { kills += 1; }
    }).execute();
    assert.equal(result.pidReused, true);
    assert.equal(kills, 0);
  } finally { removeRoot(root); }
});

test('live owner with unverifiable identity blocks Yance startup', async () => {
  const root = tempRoot();
  writeOwner(root, ownerRecord(7004, identity('unknown')));
  try {
    await assert.rejects(new LegacyRuntimeCutoverGate({
      legacyDataRoot: root,
      isProcessAlive: () => true,
      captureProcessIdentity: () => null
    }).execute(), error => error.code === 'WP5_LEGACY_OWNER_AMBIGUOUS');
  } finally { removeRoot(root); }
});

test('semantically invalid owner registry blocks without overwriting Yance27', async () => {
  const root = tempRoot();
  const file = writeOwner(root, { schemaVersion: 1, state: 'RUNNING', ownershipActive: true, trusted: true, backendPid: 0 });
  const before = fs.readFileSync(file, 'utf8');
  try {
    await assert.rejects(new LegacyRuntimeCutoverGate({ legacyDataRoot: root }).execute(), error => error.code === 'WP5_LEGACY_OWNER_REGISTRY_INVALID');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { removeRoot(root); }
});
