'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BackendProcessHost, PROCESS_STATES, validateBackendLaunchContract } = require('../../electron/desktopHost/BackendProcessHost');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-m1-launch-contract-'));
}


function releaseConfig(root) {
  return { resourcesPath: path.join(root, 'resources'), expectedBuildId: 'test-build', manifestSha256: 'a'.repeat(64) };
}

function createEntry(root) {
  const entry = path.join(root, 'backend', 'desktopHostedEntry.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "'use strict';\n");
  return entry;
}

test('M1 preflight rejects missing app root before fork', async () => {
  await assert.rejects(() => validateBackendLaunchContract({
    cwd: path.join(os.tmpdir(), 'missing-yance-app-root'),
    entry: path.join(os.tmpdir(), 'missing-yance-app-root', 'backend', 'desktopHostedEntry.js'),
    nodeRuntimeExecutablePath: process.execPath,
    releaseStartupConfig: releaseConfig(path.join(os.tmpdir(), 'missing-yance-app-root'))
  }), error => error.reasonCode === 'M1_APP_ROOT_MISSING');
});

test('M1 preflight rejects missing backend entry before fork', async () => {
  const root = tempRoot();
  await assert.rejects(() => validateBackendLaunchContract({
    cwd: root,
    entry: path.join(root, 'backend', 'desktopHostedEntry.js'),
    nodeRuntimeExecutablePath: process.execPath,
    releaseStartupConfig: releaseConfig(root)
  }), error => error.reasonCode === 'M1_BACKEND_ENTRY_MISSING');
});

test('M1 preflight rejects missing trusted Node runtime before fork', async () => {
  const root = tempRoot();
  const entry = createEntry(root);
  await assert.rejects(() => validateBackendLaunchContract({
    cwd: root,
    entry,
    nodeRuntimeExecutablePath: path.join(root, 'resources', 'runtime', 'node22', 'node.exe'),
    releaseStartupConfig: releaseConfig(root)
  }), error => error.reasonCode === 'M1_NODE_RUNTIME_MISSING');
});

test('M1 preflight rejects missing NODE_PATH before fork', async () => {
  const root = tempRoot();
  const entry = createEntry(root);
  await assert.rejects(() => validateBackendLaunchContract({
    cwd: root,
    entry,
    nodeRuntimeExecutablePath: process.execPath,
    env: { NODE_PATH: path.join(root, 'node_modules') },
    releaseStartupConfig: releaseConfig(root)
  }), error => error.reasonCode === 'M1_NODE_MODULES_MISSING');
});

test('M1 preflight accepts coherent runtime contract', async () => {
  const root = tempRoot();
  const entry = createEntry(root);
  const nodeModules = path.join(root, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  const result = await validateBackendLaunchContract({
    cwd: root,
    entry,
    nodeRuntimeExecutablePath: process.execPath,
    env: { NODE_PATH: nodeModules },
    releaseStartupConfig: releaseConfig(root)
  });
  assert.equal(result.appRoot, root);
  assert.equal(result.backendEntryPath, entry);
  assert.equal(result.nodeRuntimeExecutablePath, process.execPath);
  assert.equal(result.nodeModulesPath, nodeModules);
});


test('M1 preflight failure enters START_FAILED without forking a backend child', async () => {
  let forkCalled = false;
  const host = new BackendProcessHost({ fork: () => { forkCalled = true; throw new Error('must not fork'); } });
  await assert.rejects(() => host.start({
    cwd: path.join(os.tmpdir(), `missing-yance-app-root-${process.pid}-${Date.now()}`),
    entry: path.join(os.tmpdir(), 'missing-yance-app-root', 'backend', 'desktopHostedEntry.js'),
    nodeRuntimeExecutablePath: process.execPath,
    releaseStartupConfig: releaseConfig(path.join(os.tmpdir(), 'missing-yance-app-root'))
  }), error => error.reasonCode === 'M1_APP_ROOT_MISSING');
  const snapshot = host.snapshot();
  assert.equal(forkCalled, false);
  assert.equal(snapshot.state, PROCESS_STATES.START_FAILED);
  assert.deepEqual(snapshot.stateHistory.map(item => item.state).slice(-2), [PROCESS_STATES.STARTING, PROCESS_STATES.START_FAILED]);
  assert.equal(snapshot.backendPid, 0);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.apiSessionEstablished, false);
});

test('trusted Node runtime preflight executes the exact runtime and rejects a silent launch failure', async () => {
  const { probeNodeRuntimeExecutable } = require('../../electron/desktopHost/BackendProcessHost');
  const calls = [];
  const ok = await probeNodeRuntimeExecutable(process.execPath, {
    noCache: true,
    cwd: ROOT_FOR_PROBE(),
    env: { SAFE: '1' },
    execFile(executable, args, options) {
      calls.push({ executable, args, options });
      return Promise.resolve({ stdout: 'v22.16.0\n', stderr: '' });
    }
  });
  assert.equal(ok.version, 'v22.16.0');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, path.resolve(process.execPath));
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].options.windowsHide, true);

  await assert.rejects(() => probeNodeRuntimeExecutable(process.execPath, {
    noCache: true,
    cwd: ROOT_FOR_PROBE(),
    execFile() {
      const e = new Error('Command failed with exit code 1');
      e.status = 1;
      e.signal = null;
      e.stdout = '';
      e.stderr = 'bad option: --electron-flag';
      return Promise.reject(e);
    }
  }), error => error.reasonCode === 'M1_NODE_RUNTIME_PROBE_FAILED' && /bad option/.test(error.stderrTail));
});

function ROOT_FOR_PROBE() { return path.resolve(__dirname, '../..'); }
