'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WP_A_TEST_ROOT = path.join(ROOT, 'backend', 'tests', 'architectureClosureV2', 'wpA');

function repositoryPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/gu, '/');
}

function collectContractFiles() {
  const architectureContracts = fs.readdirSync(WP_A_TEST_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => repositoryPath(path.join(WP_A_TEST_ROOT, entry.name)))
    .sort();

  const regressionContracts = [
    'backend/tests/round12PlatformCoreAuthorities.test.js',
    'tests/runtime-delivery/repository-source-identity-authority.test.js',
    'tests/wp3/stale-fencing-token-outbox-denied.test.js',
    'tests/wp4/application-matrix-temp-path.test.js',
    'tests/wp5/m5-sqlite-ownership.test.js'
  ];

  const files = [...architectureContracts, ...regressionContracts];
  assert.equal(new Set(files).size, files.length, 'post-merge contract file list contains duplicates');
  for (const relativePath of files) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, `missing post-merge contract: ${relativePath}`);
  }
  return Object.freeze(files);
}

function runContracts(options = {}) {
  const files = options.files || collectContractFiles();
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...files],
    {
      cwd: options.cwd || ROOT,
      encoding: 'utf8',
      stdio: options.capture === true ? 'pipe' : 'inherit',
      env: { ...process.env, ...(options.env || {}) }
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`WP-A post-merge contract matrix failed with exit code ${result.status}`);
    error.code = 'WP_A_POST_MERGE_CONTRACT_FAILURE';
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    throw error;
  }
  return Object.freeze({ ok: true, fileCount: files.length, files: [...files] });
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--list') {
    process.stdout.write(`${collectContractFiles().join('\n')}\n`);
    return;
  }
  assert.deepEqual(argv, [], `unexpected arguments: ${argv.join(', ')}`);
  const result = runContracts();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ROOT,
  WP_A_TEST_ROOT,
  collectContractFiles,
  runContracts,
  runCli
};
