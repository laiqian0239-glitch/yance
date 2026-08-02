'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('A8 primary store singleton has no process-local constructor fallback', () => {
  const singletonSource = source('backend/lib/r32StoreSingleton.js');
  assert.equal(singletonSource.includes('new R32SqliteStore'), false);
  assert.equal(singletonSource.includes("require('./r32SqliteStore')"), false);
  assert.match(singletonSource, /SQLITE_BROKER_NOT_READY/);

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-a8-no-broker-'));
  try {
    const script = `
      process.env.YANCE_PROCESS_ROLE = 'test-fixture';
      process.env.NODE_TEST_CONTEXT = 'a8-primary-store-boundary';
      process.env.YANCE_DATA_DIR = ${JSON.stringify(dataRoot)};
      const { getR32Store } = require('./backend/lib/r32StoreSingleton');
      try {
        getR32Store();
        process.stderr.write('UNEXPECTED_STORE_CREATED');
        process.exit(2);
      } catch (error) {
        if (error && error.code === 'SQLITE_BROKER_NOT_READY') process.exit(0);
        process.stderr.write(String(error && (error.stack || error.message) || error));
        process.exit(3);
      }
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_TEST_CONTEXT: 'a8-primary-store-boundary', YANCE_DATA_DIR: dataRoot, YANCE_PROCESS_ROLE: 'test-fixture' }
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(dataRoot, 'store', 'yance-r32.db')), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('A8 adapters and document stores require injected capability-bound persistence', () => {
  const documentStoreSource = source('backend/lib/sqliteDocumentStore.js');
  const persistenceAdapterSource = source('backend/store/adapters/SqliteStorePersistenceAdapter.js');

  assert.equal(documentStoreSource.includes("require('./r32StoreSingleton')"), false);
  assert.equal(documentStoreSource.includes('getR32Store()'), false);
  assert.match(documentStoreSource, /persistenceCapability/);

  assert.equal(persistenceAdapterSource.includes("require('../../lib/r32StoreSingleton')"), false);
  assert.equal(persistenceAdapterSource.includes('options.store || getR32Store()'), false);
  assert.match(persistenceAdapterSource, /PRIMARY_STORE_CAPABILITY_REQUIRED/);
});

test('A8 store provider exposes bounded authority snapshots instead of a raw store getter', () => {
  const providerSource = source('backend/repositories/storeProvider.js');
  assert.match(providerSource, /getAuthorityReadSnapshot/);
  assert.equal(providerSource.includes('function getStore() { return getR32Store(); }'), false);
  assert.equal(providerSource.includes('module.exports = { getStore'), false);
});
