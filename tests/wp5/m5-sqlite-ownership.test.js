'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  claimOwnership,
  SqliteOwnershipError,
  isLive,
  isOwnerActive,
  defaultCapturePidIdentity,
  processIdentityMatches
} = require('../../backend/lib/sqliteOwnership');

function memFs() {
  const files = new Map();
  const err = (code) => { const e = new Error(code); e.code = code; return e; };
  return {
    readFileSync(p) { if (!files.has(p)) throw err('ENOENT'); return files.get(p); },
    writeFileSync(p, d) { files.set(p, String(d)); },
    renameSync(s, d) { if (!files.has(s)) throw err('ENOENT'); files.set(d, files.get(s)); files.delete(s); },
    unlinkSync(p) { if (!files.has(p)) throw err('ENOENT'); files.delete(p); },
    _files: files
  };
}

test('current Windows process identity is derived locally without spawning a CIM probe', () => {
  let probes = 0;
  const identity = defaultCapturePidIdentity(4242, memFs(), {
    platform: 'win32',
    currentPid: 4242,
    processStartedAtMs: 1_700_000_000_123,
    execPath: 'C:/Program Files/nodejs/node.exe',
    windowsProbe() { probes += 1; throw new Error('current process must not invoke CIM'); }
  });
  assert.match(identity, /^v3:win32:1700000000123:[a-f0-9]{64}$/);
  assert.strictEqual(probes, 0);
});

test('fresh live owner avoids expensive identity capture until PID-reuse evidence is needed', () => {
  let captures = 0;
  const active = isOwnerActive(
    { lastHeartbeatMs: 10_000, pid: 42, processIdentity: 'v2:test:owner' },
    10_500,
    30_000,
    () => true,
    () => { captures += 1; return 'v2:test:owner'; }
  );
  assert.strictEqual(active, true);
  assert.strictEqual(captures, 0);
});

test('Windows v3 identity comparison tolerates clock sampling drift but rejects PID reuse', () => {
  const digest = 'a'.repeat(64);
  assert.strictEqual(
    processIdentityMatches(`v3:win32:1700000000000:${digest}`, `v3:win32:1700000001250:${digest}`),
    true
  );
  assert.strictEqual(
    processIdentityMatches(`v3:win32:1700000000000:${digest}`, `v3:win32:1700000005001:${digest}`),
    false
  );
  assert.strictEqual(
    processIdentityMatches(`v3:win32:1700000000000:${digest}`, `v3:win32:1700000001000:${'b'.repeat(64)}`),
    false
  );
});

test('legacy Windows v2 lock identity remains comparable with v3 capture', () => {
  const executableDigest = 'c'.repeat(64);
  const legacy = `v2:win32:2023-11-14T22:13:20.1234567Z:${executableDigest}:${'d'.repeat(64)}`;
  const current = `v3:win32:1700000001123:${executableDigest}`;
  assert.strictEqual(processIdentityMatches(legacy, current), true);
  assert.strictEqual(
    processIdentityMatches(legacy, `v3:win32:1700000010000:${executableDigest}`),
    false
  );
});

test('stale live PID with a different comparable identity is reclaimable', () => {
  const record = {
    lastHeartbeatMs: 1_000,
    pid: 42,
    processIdentity: `v3:win32:1700000000000:${'a'.repeat(64)}`
  };
  assert.strictEqual(
    isOwnerActive(
      record,
      61_000,
      30_000,
      () => true,
      () => `v3:win32:1700000010000:${'a'.repeat(64)}`
    ),
    false
  );
});


test('claimOwnership writes a lockfile with identity + heartbeat', () => {
  const fs = memFs();
  const clock = () => 1000;
  const h = claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  assert.strictEqual(h.instanceId, 'A');
  assert.strictEqual(h.isReleased(), false);
  const lock = JSON.parse(fs._files.get('/d/app.db.ownership.json'));
  assert.strictEqual(lock.instanceId, 'A');
  assert.strictEqual(lock.pid, 42);
  assert.strictEqual(lock.lastHeartbeatMs, 1000);
});

test('a second claim while the first owner is live throws SQLITE_OWNERSHIP_CONFLICT', () => {
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  // Two distinct processes: first owner pid 42, second claimant pid 99.
  claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  t = 1000 + 500; // well within staleness window
  const pidAlive = (pid) => pid === 42 ? true : false; // first owner still alive
  assert.throws(
    () => claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 99, clock, fsProvider: fs, staleMs: 30000, pidAlive }),
    (e) => e instanceof SqliteOwnershipError && e.reasonCode === 'SQLITE_OWNERSHIP_CONFLICT' && e.owner.instanceId === 'A'
  );
});

test('a stale lock is taken over by a new owner', () => {
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  t = 1000 + 60000; // older than staleMs
  const h = claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', clock, fsProvider: fs, staleMs: 30000 });
  assert.strictEqual(h.instanceId, 'B');
  const lock = JSON.parse(fs._files.get('/d/app.db.ownership.json'));
  assert.strictEqual(lock.instanceId, 'B');
});

test('heartbeat refreshes lastHeartbeatMs; release removes the lockfile only if ours', () => {
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  const h = claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', clock, fsProvider: fs, staleMs: 30000 });
  t = 2000;
  assert.strictEqual(h.heartbeat(), true);
  assert.strictEqual(JSON.parse(fs._files.get('/d/app.db.ownership.json')).lastHeartbeatMs, 2000);
  h.release();
  assert.strictEqual(h.isReleased(), true);
  assert.strictEqual(fs._files.has('/d/app.db.ownership.json'), false);
  // heartbeat after release is a no-op
  assert.strictEqual(h.heartbeat(), false);
});

test('isLive reflects the staleness window', () => {
  assert.strictEqual(isLive({ lastHeartbeatMs: 1000 }, 1000 + 5000, 30000), true);
  assert.strictEqual(isLive({ lastHeartbeatMs: 1000 }, 1000 + 60000, 30000), false);
  assert.strictEqual(isLive({}, 1000, 30000), false);
});

test('claimOwnership records schemaVersion and rejects a missing dbPath', () => {
  const fs = memFs();
  const h = claimOwnership({ dbPath: '/d/app.db', schemaVersion: 7, fsProvider: fs });
  assert.strictEqual(JSON.parse(fs._files.get('/d/app.db.ownership.json')).schemaVersion, 7);
  assert.throws(() => claimOwnership({ fsProvider: fs }), (e) => e.reasonCode === 'SQLITE_OWNERSHIP_PATH_REQUIRED');
});

// --- M5 hardening: owner-PID liveness so a SIGKILLed backend cannot leave a
// "fake-alive" orphan lock that blocks every subsequent start (the CI-flaky
// SQLITE_OWNERSHIP_CONFLICT seen in the M1 real-machine gate). ---

test('a fresh heartbeat with a DEAD owner pid is reclaimed (no conflict)', () => {
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  // First owner pid 42, heartbeat fresh.
  claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  // Owner 42 is dead now; pidAlive reports it dead.
  const pidAlive = (pid) => pid === 42 ? false : true;
  t = 1000 + 500; // still within staleness window by heartbeat
  const h = claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 99, clock, fsProvider: fs, staleMs: 30000, pidAlive });
  assert.strictEqual(h.instanceId, 'B');
  assert.strictEqual(JSON.parse(fs._files.get('/d/app.db.ownership.json')).instanceId, 'B');
});

test('a fresh heartbeat with an ALIVE owner pid still conflicts', () => {
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  const pidAlive = (pid) => pid === 42 ? true : false; // owner still alive
  t = 1000 + 500;
  assert.throws(
    () => claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 99, clock, fsProvider: fs, staleMs: 30000, pidAlive }),
    (e) => e instanceof SqliteOwnershipError && e.reasonCode === 'SQLITE_OWNERSHIP_CONFLICT'
  );
});

test('isOwnerActive combines heartbeat and pid liveness', () => {
  const alive = () => true;
  const dead = () => false;
  // fresh heartbeat + alive pid => active
  assert.strictEqual(isOwnerActive({ lastHeartbeatMs: 1000, pid: 42 }, 1000 + 5000, 30000, alive), true);
  // fresh heartbeat + dead pid => NOT active (reclaimable)
  assert.strictEqual(isOwnerActive({ lastHeartbeatMs: 1000, pid: 42 }, 1000 + 5000, 30000, dead), false);
  // wall-clock staleness alone cannot steal from a demonstrably live PID
  assert.strictEqual(isOwnerActive({ lastHeartbeatMs: 1000, pid: 42 }, 1000 + 60000, 30000, alive), true);
  // fresh heartbeat + no pid recorded => active (backward compatible)
  assert.strictEqual(isOwnerActive({ lastHeartbeatMs: 1000 }, 1000 + 5000, 30000, dead), true);
});

test('a second claim from the SAME pid is a re-entrant open and does not throw', () => {
  // Production reality: a startup migrator opens the main DB (PATHS.sqlite)
  // via `new R32SqliteStore({ dbPath })` while the singleton getR32Store()
  // already claimed it in the SAME process. Ownership is per-PROCESS, so the
  // second open must be allowed and must not disturb the primary lockfile.
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  const first = claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  assert.strictEqual(first.isReentrant, undefined);
  const second = claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  assert.strictEqual(second.isReentrant, true);
  assert.strictEqual(second.isReleased(), false); // real shared lease reference
  // Primary lockfile stays owned by instance A (not overwritten).
  const lock = JSON.parse(fs._files.get('/d/app.db.ownership.json'));
  assert.strictEqual(lock.instanceId, 'A');
  assert.strictEqual(lock.pid, 42);
  // Releasing either reference must not unlink while the other remains.
  first.release();
  assert.ok(fs._files.has('/d/app.db.ownership.json'));
  assert.strictEqual(second.heartbeat(), true);
  // Only the final reference releases the process-scoped lease.
  second.release();
  assert.strictEqual(fs._files.has('/d/app.db.ownership.json'), false);
});

test('a second claim from a DIFFERENT alive pid still conflicts (cross-process guard intact)', () => {
  const fs = memFs();
  let t = 1000;
  const clock = () => t;
  claimOwnership({ dbPath: '/d/app.db', instanceId: 'A', pid: 42, clock, fsProvider: fs, staleMs: 30000 });
  t = 1000 + 500; // well within staleness window, fresh heartbeat
  const pidAlive = (pid) => pid === 42 ? true : false; // first owner still alive
  assert.throws(
    () => claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 43, clock, fsProvider: fs, staleMs: 30000, pidAlive }),
    (e) => e instanceof SqliteOwnershipError && e.reasonCode === 'SQLITE_OWNERSHIP_CONFLICT' && e.owner.pid === 42
  );
});

test('a malformed ownership lock fails closed instead of being silently replaced', () => {
  const fs = memFs();
  fs._files.set('/d/app.db.ownership.json', '{"instanceId":');
  assert.throws(
    () => claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 99, fsProvider: fs }),
    (error) => error instanceof SqliteOwnershipError && error.reasonCode === 'SQLITE_OWNERSHIP_LOCK_CORRUPT'
  );
  assert.strictEqual(fs._files.get('/d/app.db.ownership.json'), '{"instanceId":');
});

test('an unreadable ownership lock fails closed instead of assuming there is no owner', () => {
  const base = memFs();
  base._files.set('/d/app.db.ownership.json', JSON.stringify({ instanceId: 'A', pid: 42, lastHeartbeatMs: 1000 }));
  const fs = {
    ...base,
    readFileSync(path, encoding) {
      if (path === '/d/app.db.ownership.json') {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
      return base.readFileSync(path, encoding);
    }
  };
  assert.throws(
    () => claimOwnership({ dbPath: '/d/app.db', instanceId: 'B', pid: 99, fsProvider: fs }),
    (error) => error instanceof SqliteOwnershipError && error.reasonCode === 'SQLITE_OWNERSHIP_LOCK_UNREADABLE'
  );
  assert.ok(base._files.has('/d/app.db.ownership.json'));
});
