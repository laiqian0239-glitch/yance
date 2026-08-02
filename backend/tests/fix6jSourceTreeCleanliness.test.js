'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceRoot = path.join(__dirname, '..', '..');
const focusedTests = [
  'fix6jExecutionEnvelope.test.js',
  'fix6jHostEvidenceBoundary.test.js',
  'fix6jIsolatedModelExecutor.test.js',
  'fix6jMissingCredentialForkGuard.test.js',
  'fix6jModelExecutionSpecResolver.test.js',
  'fix6jRuntimeRoleIsolation.test.js',
  'fix6jSystemPolicySnapshot.test.js',
  'fix6jWorkerEnvelopeVerification.test.js',
  'fix6jWorkerSqliteIsolation.test.js'
].map(name => path.join('backend', 'tests', name));

function protectedHashes() {
  const rows = {};
  function walk(root) {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) walk(target);
      else {
        const relative = path.relative(sourceRoot, target).replaceAll('\\', '/');
        const protectedFile = /\.(?:db|sqlite|wal|shm)$/iu.test(entry.name) || relative.includes('/migration-backups/');
        if (protectedFile) rows[relative] = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      }
    }
  }
  walk(path.join(sourceRoot, 'data'));
  walk(path.join(sourceRoot, 'backend', 'data'));
  return rows;
}

test('applicable FIX6J tests establish a unique data root before importing storage-capable modules', () => {
  for (const name of ['fix6jHostEvidenceBoundary.test.js', 'fix6jMissingCredentialForkGuard.test.js', 'fix6jWorkerSqliteIsolation.test.js']) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    const environmentIndex = source.indexOf('process.env.YANCE_DATA_DIR');
    const importIndexes = [
      source.indexOf("require('../services/modelExecutionHost')"),
      source.indexOf("require('../lib/r32StoreSingleton')")
    ].filter(index => index >= 0);
    assert.ok(environmentIndex >= 0, `${name}:YANCE_DATA_DIR_MISSING`);
    assert.ok(importIndexes.every(index => environmentIndex < index), `${name}:YANCE_DATA_DIR_TOO_LATE`);
  }
});

test('focused FIX6J suite cannot change protected source data', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6j-focused-'));
  const before = protectedHashes();
  try {
    const childEnvironment = {
      ...process.env,
      NODE_ENV: 'test',
      YANCE_DATA_DIR: path.join(temporaryRoot, 'data'),
      WORKBUDDY_DATA_DIR: path.join(temporaryRoot, 'workbuddy-data'),
      YANCE_LEGACY_DATA_DIR: path.join(temporaryRoot, 'legacy-data')
    };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', ...focusedTests], {
      cwd: sourceRoot,
      env: childEnvironment,
      encoding: 'utf8',
      timeout: 120000
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\btests 31\b/u, result.stdout);
    assert.deepEqual(protectedHashes(), before);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});
