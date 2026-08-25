'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { BackendOwnerRegistry } = require('../../electron/desktopHost/BackendOwnerRegistry');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORIZATION_PATH = 'governance/layered-ci/v21-backend-startup-admission-release-closure-p0-authorization.json';

function readJson(repoPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...repoPath.split('/')), 'utf8'));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function identity(pid) {
  return {
    platform: 'test',
    startTicks: `${pid}-stable`,
    commandDigest: `cmd-${pid}-stable`
  };
}

function fakePipe() {
  const pipe = new EventEmitter();
  pipe.end = (_data, callback) => queueMicrotask(() => callback?.());
  pipe.destroy = () => {};
  return pipe;
}

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.connected = false;
  child.stdio = [
    null,
    new PassThrough(),
    new PassThrough(),
    null,
    fakePipe(),
    new PassThrough(),
    new PassThrough()
  ];
  child.killCalls = [];
  child.kill = signal => {
    child.killCalls.push(signal);
    queueMicrotask(() => child.emit('exit', signal === 'SIGTERM' ? 0 : null, signal));
    return true;
  };
  return child;
}

function launchFixture(root) {
  const entry = path.join(root, 'backend', 'desktopHostedEntry.js');
  const nodeModules = path.join(root, 'node_modules');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(entry, '// backend startup admission fixture\n', 'utf8');
  return {
    entry,
    cwd: root,
    execPath: process.execPath,
    env: { NODE_PATH: nodeModules },
    credentialHandshakeRequired: false,
    releaseStartupConfig: {
      resourcesPath: root,
      expectedBuildId: 'backend-startup-admission-red',
      manifestSha256: 'a'.repeat(64)
    }
  };
}

async function runPreForkAdmissionRace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-backend-startup-admission-'));
  const ownerFile = path.join(root, 'backend-owner.json');
  const startOptions = launchFixture(root);
  const firstIdentityEntered = deferred();
  const releaseFirstIdentity = deferred();
  const firstForked = deferred();
  let firstForkCalls = 0;
  let secondForkCalls = 0;

  const firstChild = fakeChild(61001);
  const secondChild = fakeChild(61002);
  const firstRegistry = new BackendOwnerRegistry({
    file: ownerFile,
    isProcessAlive: () => true,
    captureIdentity: async pid => {
      if (Number(pid) === firstChild.pid) {
        firstIdentityEntered.resolve();
        await releaseFirstIdentity.promise;
      }
      return identity(pid);
    }
  });
  const secondRegistry = new BackendOwnerRegistry({
    file: ownerFile,
    isProcessAlive: () => true,
    captureIdentity: async pid => identity(pid)
  });

  const commonHostOptions = {
    probeNodeRuntime: executablePath => ({ ok: true, executablePath, version: process.version }),
    randomBytes: size => Buffer.alloc(size, 7)
  };
  const firstHost = new BackendProcessHost({
    ...commonHostOptions,
    ownerRegistry: firstRegistry,
    fork: () => {
      firstForkCalls += 1;
      firstForked.resolve();
      return firstChild;
    }
  });
  const secondHost = new BackendProcessHost({
    ...commonHostOptions,
    ownerRegistry: secondRegistry,
    fork: () => {
      secondForkCalls += 1;
      return secondChild;
    }
  });

  let firstStart = null;
  let secondStart = null;
  try {
    firstStart = firstHost.start(startOptions);
    await firstForked.promise;
    await firstIdentityEntered.promise;

    secondStart = secondHost.start(startOptions);
    await new Promise(resolve => setImmediate(resolve));
    const secondForkCallsBeforeFirstAdmissionCompleted = secondForkCalls;

    releaseFirstIdentity.resolve();
    const outcomes = await Promise.allSettled([firstStart, secondStart]);
    const fulfilled = outcomes
      .map((outcome, index) => ({ outcome, index }))
      .filter(item => item.outcome.status === 'fulfilled');
    const rejected = outcomes
      .map((outcome, index) => ({ outcome, index }))
      .filter(item => item.outcome.status === 'rejected');
    const winnerPid = fulfilled.length === 1
      ? Number(fulfilled[0].outcome.value?.child?.pid || 0)
      : 0;
    const durableBeforeCleanup = fs.existsSync(ownerFile)
      ? JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
      : null;

    return {
      firstForkCalls,
      secondForkCalls,
      secondForkCallsBeforeFirstAdmissionCompleted,
      outcomes,
      fulfilledCount: fulfilled.length,
      rejectedCount: rejected.length,
      rejectedReasonCodes: rejected.map(item => String(item.outcome.reason?.reasonCode || item.outcome.reason?.code || '')),
      winnerPid,
      durableBeforeCleanup,
      cleanup: async () => {
        for (const host of [firstHost, secondHost]) {
          if (Number(host.snapshot().backendPid || 0) > 0) {
            await host.stop({ gracefulMs: 25, forceMs: 100 }).catch(() => {});
          }
        }
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
      }
    };
  } catch (error) {
    releaseFirstIdentity.resolve();
    await Promise.allSettled([firstStart, secondStart].filter(Boolean));
    for (const host of [firstHost, secondHost]) {
      if (Number(host.snapshot().backendPid || 0) > 0) {
        await host.stop({ gracefulMs: 25, forceMs: 100 }).catch(() => {});
      }
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    throw error;
  }
}

test('merged authorization keeps the first implementation head tests-only and production forbidden', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(authorization.workPackage, 'V21-BACKEND-STARTUP-ADMISSION-RELEASE-CLOSURE-P0');
  assert.equal(authorization.status, 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE');
  assert.equal(authorization.implementation.branch, 'fix/v21-backend-startup-admission-release-closure-p0');
  assert.equal(authorization.implementation.productionScopeAuthorized, false);
  assert.deepEqual(authorization.implementation.failureFirstCommit.allowedChangedPaths, [
    'tests/wp0/v21-backend-startup-admission-release-closure-p0.test.js'
  ]);
  assert.equal(
    authorization.implementation.failureFirstCommit.fastClosureV2.requiredClosureTrailer,
    'Yance-Closure-Matrix-Unknown-Blockers: 0'
  );
});

test('cross-process startup admission rejects a contender before its physical backend fork boundary', async () => {
  const race = await runPreForkAdmissionRace();
  try {
    assert.equal(race.firstForkCalls, 1, 'the winning startup must physically fork exactly once');
    assert.equal(
      race.secondForkCallsBeforeFirstAdmissionCompleted,
      0,
      `a concurrent contender physically forked before startup admission completed: ${JSON.stringify({
        firstForkCalls: race.firstForkCalls,
        secondForkCalls: race.secondForkCalls,
        fulfilledCount: race.fulfilledCount,
        rejectedCount: race.rejectedCount,
        rejectedReasonCodes: race.rejectedReasonCodes
      })}`
    );
    assert.equal(race.fulfilledCount, 1, 'exactly one concurrent backend startup must win');
    assert.equal(race.rejectedCount, 1, 'exactly one concurrent backend startup must be rejected');
  } finally {
    await race.cleanup();
  }
});

test('a losing pre-claim child exit cannot mark the winning durable backend owner record exited', async () => {
  const race = await runPreForkAdmissionRace();
  try {
    assert.equal(race.fulfilledCount, 1, 'the race must produce one authoritative backend owner');
    assert.equal(race.rejectedCount, 1, 'the competing startup must fail closed');
    assert.ok(race.durableBeforeCleanup, 'the winning backend owner must remain durably recorded');
    assert.equal(
      race.durableBeforeCleanup.ownershipActive,
      true,
      `losing startup cleanup clobbered the winner owner record: ${JSON.stringify({
        winnerPid: race.winnerPid,
        durable: race.durableBeforeCleanup,
        rejectedReasonCodes: race.rejectedReasonCodes
      })}`
    );
    assert.equal(race.durableBeforeCleanup.backendPid, race.winnerPid);
  } finally {
    await race.cleanup();
  }
});
