'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const backendRoot = path.join(__dirname, '..');

function runWorkerStorageProbe(name, source) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `yance-fix6j-role-${name}-`));
  try {
    return spawnSync(process.execPath, ['-e', `
      try {
        ${source}
        process.stdout.write('NO_ERROR');
      } catch (error) {
        process.stdout.write(String(error.code || error.message || error));
      }
    `], {
      cwd: path.join(backendRoot, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        YANCE_DATA_DIR: dataRoot,
        YANCE_PROCESS_ROLE: 'model-execution-worker',
        YANCE_SQLITE_ACCESS: 'forbidden'
      },
      encoding: 'utf8',
      timeout: 10000
    });
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

test('model worker cannot instantiate R32SqliteStore', () => {
  const modulePath = path.join(backendRoot, 'lib', 'r32SqliteStore.js');
  const probe = runWorkerStorageProbe('r32', `
    const path = require('node:path');
    const { R32SqliteStore } = require(${JSON.stringify(modulePath)});
    new R32SqliteStore({ dbPath: path.join(process.env.YANCE_DATA_DIR, 'direct.db') });
  `);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, 'MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN');
});

test('model worker cannot instantiate SqliteDocumentStore', () => {
  const modulePath = path.join(backendRoot, 'lib', 'sqliteDocumentStore.js');
  const probe = runWorkerStorageProbe('document', `
    const { SqliteDocumentStore } = require(${JSON.stringify(modulePath)});
    new SqliteDocumentStore('guard-probe', { schemaVersion: 1 });
  `);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, 'MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN');
});

test('model worker cannot acquire the R32 store singleton', () => {
  const modulePath = path.join(backendRoot, 'lib', 'r32StoreSingleton.js');
  const probe = runWorkerStorageProbe('singleton', `
    const { getR32Store } = require(${JSON.stringify(modulePath)});
    getR32Store();
  `);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, 'MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN');
});
