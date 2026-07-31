'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  checkpointValue,
  loadMutationCheckpoint,
  mutationCatalogSha256,
  readMutationSourceIdentity,
  validateMutationCheckpoint,
  writeMutationCheckpoint
} = require('../../tools/wp4/run-credential-mutation-tests');

const ROOT = path.resolve(__dirname, '../..');
const MUTATIONS = [
  { id: 'M01_TEST', file: 'a.js', find: 'a', replace: 'b' },
  { id: 'M02_TEST', file: 'b.js', find: 'b', replace: 'c' }
];
const SOURCE = {
  commit: '1111111111111111111111111111111111111111',
  tree: '2222222222222222222222222222222222222222'
};

function result(id) {
  return {
    id,
    status: 'PASS',
    killed: true,
    allRequiredOracleExecutionsValid: true,
    allRequiredOraclesKilled: true,
    invalidOracleCount: 0,
    survivingOracleCount: 0,
    oracleResults: {
      requiredTest: { status: 'KILLED', valid: true, killed: true },
      faultMatrix: { status: 'KILLED', valid: true, killed: true },
      completeFaultMatrix: { status: 'NOT_REQUIRED', valid: true, killed: true },
      evidenceGenerator: { status: 'KILLED', valid: true, killed: true }
    },
    secretValueRecorded: false,
    secretHashRecorded: false
  };
}

function fixture(results = [result('M01_TEST')]) {
  return checkpointValue({
    sourceIdentity: SOURCE,
    catalogSha256: mutationCatalogSha256(MUTATIONS),
    mutations: MUTATIONS,
    results
  });
}

function reasonCode(fn) {
  assert.throws(fn, error => Boolean(error && error.reasonCode));
  try { fn(); }
  catch (error) { return error.reasonCode; }
  return '';
}

test('mutation checkpoint is atomically persisted as a private exact-prefix record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-mutation-checkpoint-'));
  try {
    const file = path.join(root, 'nested', 'checkpoint.json');
    const value = fixture();
    writeMutationCheckpoint(file, value);
    const loaded = loadMutationCheckpoint(file, {
      mutations: MUTATIONS,
      sourceIdentity: SOURCE,
      catalogSha256: mutationCatalogSha256(MUTATIONS)
    });
    assert.deepEqual(loaded, value);
    assert.equal(loaded.completedCount, 1);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['checkpoint.json']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('mutation checkpoint rejects Commit, Tree, catalog and sequence drift', () => {
  const base = fixture();
  const options = {
    mutations: MUTATIONS,
    sourceIdentity: SOURCE,
    catalogSha256: mutationCatalogSha256(MUTATIONS)
  };
  assert.equal(reasonCode(() => validateMutationCheckpoint({ ...base, sourceCommit: '3'.repeat(40) }, options)), 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_SOURCE_MISMATCH');
  assert.equal(reasonCode(() => validateMutationCheckpoint({ ...base, sourceTree: '4'.repeat(40) }, options)), 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_SOURCE_MISMATCH');
  assert.equal(reasonCode(() => validateMutationCheckpoint({ ...base, mutationCatalogSha256: '5'.repeat(64) }, options)), 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_CATALOG_MISMATCH');
  assert.equal(reasonCode(() => validateMutationCheckpoint({ ...base, resultsSha256: '6'.repeat(64) }, options)), 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_RESULTS_HASH_MISMATCH');
  const wrongSequence = checkpointValue({ sourceIdentity: SOURCE, catalogSha256: mutationCatalogSha256(MUTATIONS), mutations: MUTATIONS, results: [result('M02_TEST')] });
  assert.equal(reasonCode(() => validateMutationCheckpoint(wrongSequence, options)), 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_SEQUENCE_INVALID');
  assert.equal(reasonCode(() => validateMutationCheckpoint({ ...base, completedCount: 0 }, options)), 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_COMPLETED_COUNT_INVALID');
});

test('mutation source identity is the clean checked-out Commit and Tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-mutation-source-'));
  const git = args => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git(['init']);
    git(['config', 'user.name', 'WP4 Test']);
    git(['config', 'user.email', 'wp4-test@local.invalid']);
    fs.writeFileSync(path.join(root, 'source.txt'), 'fixed source\n', 'utf8');
    git(['add', 'source.txt']);
    git(['commit', '-m', 'test source identity']);
    const expected = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
    assert.deepEqual(readMutationSourceIdentity(root), expected);
    fs.writeFileSync(path.join(root, 'source.txt'), 'dirty source\n', 'utf8');
    assert.equal(reasonCode(() => readMutationSourceIdentity(root)), 'WP4_CREDENTIAL_MUTATION_SOURCE_DIRTY');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
