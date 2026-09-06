'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classMethod(source, name) {
  const matcher = new RegExp(`\\n  (?:async )?${escapeRegExp(name)}\\s*\\(`);
  const match = matcher.exec(source);
  assert.ok(match, `expected class method ${name}`);
  const start = match.index + 1;
  const rest = source.slice(start + match[0].length - 1);
  const next = /\n  (?:async )?[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.exec(rest);
  return next ? source.slice(start, start + match[0].length - 1 + next.index) : source.slice(start);
}

function assertOrdered(haystack, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle);
    assert.ok(index >= 0, `${label}: missing ${needle}`);
    assert.ok(index > cursor, `${label}: ${needle} is out of order`);
    cursor = index;
  }
}

test('boot critical owner registry exposes async registration and production liveness seams', () => {
  const source = read('electron/desktopHost/BackendOwnerRegistry.js');
  assert.match(source, /async registerAsync\s*\(/, 'owner registration must have a real async entrypoint');
  assert.match(source, /isProcessAliveAsync/, 'owner registry must expose an async liveness authority');

  const updateAsync = classMethod(source, 'updateAsync');
  assert.match(updateAsync, /return\s+this\.registerAsync\s*\(/, 'updateAsync must never fall back to synchronous register');
  assert.doesNotMatch(updateAsync, /return\s+this\.register\s*\(/, 'updateAsync sync registration fallback is forbidden');

  const probeAsync = classMethod(source, 'probeAsync');
  assert.match(probeAsync, /await\s+this\.isProcessAliveAsync\s*\(/, 'probeAsync must await asynchronous liveness');
  assert.doesNotMatch(probeAsync, /this\.isProcessAlive\s*\(/, 'probeAsync must not invoke synchronous native liveness');
});

test('marker-to-fork recovery path contains no synchronous owner probes or fire-and-forget durable recovery', () => {
  const source = read('electron/desktopHost/BackendProcessHost.js');

  const recover = classMethod(source, '_recoverRejectedOwnerForStartUnlocked');
  assert.match(recover, /await\s+this\.clearRejectedOwner\s*\(\{\s*force:\s*true\s*\}\)/, 'PID-reuse cleanup must be awaited');

  const terminate = classMethod(source, '_terminateOrphanOwner');
  assert.match(terminate, /await\s+this\.ownerRegistry\.probeAsync\s*\(/, 'orphan termination must use async liveness');
  assert.doesNotMatch(terminate, /this\.ownerRegistry\.probe\s*\(/, 'orphan termination must not busy-poll synchronous liveness');

  const clear = classMethod(source, 'clearRejectedOwner');
  assert.match(clear, /await\s+this\.ownerRegistry\.probeAsync\s*\(/, 'rejected-owner clear must use async liveness unless exact child exit is authoritative');
  assert.doesNotMatch(clear, /this\.ownerRegistry\.probe\s*\(/, 'rejected-owner clear must not use a synchronous native probe');

  const contain = classMethod(source, 'containRejectedOwner');
  assert.doesNotMatch(contain, /this\.ownerRegistry\.probe\s*\(/, 'immediate containment must rely on exact owned-child memory state and durable fail-closed state only');

  const waitRecovery = classMethod(source, 'waitForOwnerExitRecovery');
  assert.doesNotMatch(waitRecovery, /isPotentiallyLive\s*\(/, 'owner-exit recovery observation must not perform synchronous native liveness');

  const hasOwnership = classMethod(source, 'hasOwnership');
  assert.doesNotMatch(hasOwnership, /isPotentiallyLive\s*\(/, 'ownership snapshot must use durable authority state rather than synchronous native liveness');
});

test('child exit publishes one observed composite durability/recovery promise', () => {
  const source = read('electron/desktopHost/BackendProcessHost.js');
  const lifecycle = classMethod(source, '_bindChildLifecycle');

  assert.match(lifecycle, /ownerExitRecoveryByChild\.set\s*\(child,\s*recoveryPromise\)/, 'child exit must publish the composite recovery promise');
  assert.match(lifecycle, /markExitedAsync\s*\(/, 'durable EXITED transition must be part of observed recovery');
  assert.match(lifecycle, /await\s+admission\.release\s*\(/, 'pre-claim admission release must be part of observed recovery');
  assert.doesNotMatch(lifecycle, /ownerRegistry\.markExited\s*\(/, 'sync durable EXITED write is forbidden in the EventEmitter callback');
  assert.doesNotMatch(lifecycle, /Promise\.resolve\s*\(admission\.release\s*\(\)\)/, 'fire-and-forget admission release is forbidden');
});

test('startup admission remains held through fork identity capture and durable SPAWNED write before the startup frame', () => {
  const source = read('electron/desktopHost/BackendProcessHost.js');
  const start = classMethod(source, '_startUnlocked');

  assertOrdered(start, [
    'await this.ownerRegistry.acquireStartupAdmission()',
    'child = this.fork(',
    'await this._awaitSpawnIdentity(',
    'await this.ownerRegistry.captureIdentityAsync(',
    'await attempt.startupAdmission.register({',
    "state: 'SPAWNED'",
    'await attempt.startupAdmission.release()',
    'await this._writeStartupFrame('
  ], 'startup admission/fork/frame invariant');
});

test('restored/orphan containment liveness is asynchronous while sync snapshots remain fail-closed', () => {
  const source = read('electron/desktopHost/DesktopCredentialApplicationCoordinator.js');
  const childLive = classMethod(source, '_backendChildLive');
  const persistedLive = classMethod(source, '_persistedContainmentPidLive');

  assert.doesNotMatch(childLive, /this\.isProcessAlive\s*\(/, 'sync child snapshot must not query native PID liveness');
  assert.doesNotMatch(persistedLive, /this\.isProcessAlive\s*\(/, 'sync persisted snapshot must not query native PID liveness');
  assert.match(source, /async _backendChildLiveAsync\s*\(/, 'async recovery must expose an exact liveness variant');
  assert.match(source, /async _persistedContainmentPidLiveAsync\s*\(/, 'persisted recovery must expose an async liveness variant');
  assert.match(source, /isRejectedOwnerLiveAsync/, 'coordinator recovery must use the backend host async liveness seam');
});

test('async durability fails closed on non-tolerated directory fsync errors', () => {
  const source = read('electron/desktopHost/asyncDurability.js');
  const atomicWrite = source.slice(source.indexOf('async function atomicWriteJsonAsync'));
  assert.ok(atomicWrite.includes("invoke('directory-fsync')"), 'directory durability phase must be explicit');
  assert.match(atomicWrite, /invoke\('directory-fsync'\);\s*await fileSyncAsync\(dirHandle, 'directory', platform\);/, 'directory fsync must be directly awaited so non-tolerated failures reject');
});

test('desktop-hosted backend remains inert until the startup frame is received', () => {
  const source = read('backend/desktopHostedEntry.js');
  assertOrdered(source, [
    'await readStartupFrame(',
    'runBootPhase0Restore',
    'acquireAuthorityWriteHost',
    'createSqliteConnectionBroker',
    'initializeAppRuntime',
    'require(serverEntry)'
  ], 'desktopHostedEntry startup-frame authority boundary');

  assert.doesNotMatch(
    source,
    /new NamedRuntimeMutex|runtimeMutex\.acquire\s*\(/u,
    'desktop-hosted production must not place a second process mutex in front of AuthorityWriteHost'
  );
});
