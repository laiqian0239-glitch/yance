'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const properLockfile = require('proper-lockfile');
const { BackendOwnerRegistry } = require('../../electron/desktopHost/BackendOwnerRegistry');

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-owner-claim-lock-'));
}

function identity(pid, suffix = 'stable') {
  return {
    platform: 'test',
    startTicks: `${pid}-${suffix}`,
    commandDigest: `cmd-${pid}-${suffix}`
  };
}

function context(pid, suffix = 'stable', state = 'SPAWNED') {
  return {
    state,
    ownershipActive: true,
    trusted: state === 'RUNNING',
    backendPid: pid,
    startupNonce: `nonce-${pid}-${suffix}`,
    backendSessionId: `session-${pid}-${suffix}`,
    fd6PipeInstanceId: `pipe-${pid}-${suffix}`,
    processIdentity: identity(pid, suffix),
    reasonCode: state === 'RUNNING' ? 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED' : 'BACKEND_SPAWNED'
  };
}

function registry(file) {
  return new BackendOwnerRegistry({
    file,
    isProcessAlive: () => true,
    captureIdentity: pid => identity(pid)
  });
}

test('stale constructor snapshots cannot overwrite an owner claimed by another process', () => {
  const dir = root();
  try {
    const file = path.join(dir, 'backend-owner.json');
    const first = registry(file);
    const contender = registry(file);

    first.register(context(51001));
    assert.throws(() => contender.register(context(51002)), error => {
      assert.equal(error.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_CONFLICT');
      assert.equal(error.retryable, true);
      assert.equal(error.existingOwner?.backendPid, 51001);
      return true;
    });

    const durable = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(durable.backendPid, 51001);
    assert.equal(durable.startupNonce, 'nonce-51001-stable');
    assert.equal(fs.existsSync(`${file}.lock`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});

test('a concurrent filesystem claim lock fails fast before owner record mutation', () => {
  const dir = root();
  try {
    const file = path.join(dir, 'backend-owner.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const release = properLockfile.lockSync(file, { realpath: false, stale: 30000, retries: 0 });
    const contender = registry(file);
    try {
      assert.throws(() => contender.register(context(52001)), error => {
        assert.equal(error.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_LOCK_HELD');
        assert.equal(error.retryable, true);
        return true;
      });
      assert.equal(fs.existsSync(file), false);
    } finally {
      release();
    }

    contender.register(context(52001));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).backendPid, 52001);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});

test('terminal owner records remain replaceable after lock-scoped refresh', () => {
  const dir = root();
  try {
    const file = path.join(dir, 'backend-owner.json');
    const first = registry(file);
    const contender = registry(file);

    first.register(context(53001));
    first.markExited({ reasonCode: 'OWNER_EXIT_CONFIRMED', exitCode: 0 });
    contender.register(context(53002));

    const durable = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(durable.backendPid, 53002);
    assert.equal(durable.state, 'SPAWNED');
    assert.equal(durable.ownershipActive, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});

test('registry corruption introduced after construction is re-read and never overwritten by a claim', () => {
  const dir = root();
  try {
    const file = path.join(dir, 'backend-owner.json');
    const contender = registry(file);
    const corrupt = '{"schemaVersion":1,"state":"RUNNING","backendPid":';
    fs.writeFileSync(file, corrupt, 'utf8');

    assert.throws(() => contender.register(context(54001)), error => {
      assert.equal(error.reasonCode, 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID');
      assert.ok(error.registryFailure);
      return true;
    });
    assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});
