'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateBackendLaunchContract } = require('../../electron/desktopHost/BackendProcessHost');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch11-'));
  const entry = path.join(root, 'backend.js');
  const runtime = path.join(root, process.platform === 'win32' ? 'node.exe' : 'node');
  const modules = path.join(root, 'node_modules');
  const manifest = path.join(root, 'release-manifest.json');
  const detached = path.join(root, 'release-manifest.sha256');
  fs.writeFileSync(entry, "'use strict';\n");
  fs.writeFileSync(runtime, 'runtime');
  fs.mkdirSync(modules);
  fs.writeFileSync(manifest, '{}\n');
  fs.writeFileSync(detached, `${'a'.repeat(64)}  release-manifest.json\n`);
  return {
    root,
    options: {
      entry,
      cwd: root,
      nodeRuntimeExecutablePath: runtime,
      env: { NODE_PATH: modules, YANCE_PORT: '27642' },
      releaseStartupConfig: {
        resourcesPath: root,
        expectedBuildId: 'batch11-test',
        manifestSha256: 'a'.repeat(64),
        manifestPath: manifest,
        releaseManifestPath: manifest,
        detachedHashPath: detached,
        releaseManifestSha256Path: detached
      }
    }
  };
}

test('Batch 11 backend launch contract inherits the configured startup timeout instead of reverting to 30 seconds', async () => {
  const { root, options } = fixture();
  try {
    const contract = await validateBackendLaunchContract({
      ...options,
      env: { ...options.env, YANCE_BACKEND_STARTUP_TIMEOUT_MS: '180000' }
    });
    assert.equal(contract.readyTimeoutMs, 180000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Batch 11 backend launch contract caps excessive startup timeouts and rejects invalid values', async () => {
  const { root, options } = fixture();
  try {
    assert.equal((await validateBackendLaunchContract({ ...options, readyTimeoutMs: 999999 })).readyTimeoutMs, 180000);
    await assert.rejects(
      () => validateBackendLaunchContract({ ...options, env: { ...options.env, YANCE_BACKEND_STARTUP_TIMEOUT_MS: 'invalid' } }),
      error => error.reasonCode === 'M1_READY_TIMEOUT_INVALID'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Batch 11 desktop coordinator passes one timeout authority to the child handshake and supervisor', () => {
  const root = path.resolve(__dirname, '../..');
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const sourceUat = fs.readFileSync(path.join(root, 'tools/runtime-delivery/start-source-uat.js'), 'utf8');
  assert.match(main, /const startupTimeoutMs = backendStartupTimeoutMs\(\);/);
  assert.match(main, /readyTimeoutMs: startupTimeoutMs/);
  assert.match(main, /launchTimeoutMs: startupTimeoutMs/);
  assert.match(sourceUat, /YANCE_BACKEND_STARTUP_TIMEOUT_MS: String\(process\.env\.YANCE_BACKEND_STARTUP_TIMEOUT_MS \|\| 180000\)/);
});
