'use strict';

/**
 * Run every backend *.test.js file sequentially in an isolated Node process.
 * Discovery prevents newly added tests from silently falling outside the gate;
 * the child process exit code is the source of truth.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function discoverTests(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path.relative(__dirname, absolute));
    }
  }
  visit(root);
  return files;
}

function usableDirectory(value) {
  try { return Boolean(value) && fs.statSync(value).isDirectory(); } catch (_) { return false; }
}

function createTestTempRoot(environment = process.env) {
  const configured = [environment.YANCE_TEST_TEMP_ROOT, environment.TMPDIR, environment.TEMP, environment.TMP].filter(Boolean);
  let parent = configured.find(usableDirectory);
  if (!parent && configured.length === 0 && usableDirectory(os.tmpdir())) parent = os.tmpdir();
  if (!parent) {
    parent = path.join(__dirname, '.test-tmp');
    fs.mkdirSync(parent, { recursive: true });
  }
  return fs.mkdtempSync(path.join(path.resolve(parent), 'yb-'));
}

function childEnvironment(environment, temporaryRoot) {
  return {
    ...environment,
    TMPDIR: temporaryRoot,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    YANCE_TEST_TEMP_ROOT: temporaryRoot
  };
}

function runFile(file, options = {}) {
  return new Promise(resolve => {
    console.log(`\n========== RUNNING: ${file} ==========\n`);
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', file], {
      cwd: __dirname,
      stdio: 'inherit',
      windowsHide: true,
      env: childEnvironment(process.env, options.temporaryRoot)
    });
    child.once('error', error => {
      console.error(`FAILED TO START: ${file}: ${error.message}`);
      resolve(false);
    });
    child.once('close', (code, signal) => {
      const passed = code === 0 && signal == null;
      if (!passed) console.error(`FAILED: ${file} (exit=${code}, signal=${signal || 'none'})`);
      resolve(passed);
    });
  });
}

async function runAll() {
  const temporaryRoot = createTestTempRoot();
  const files = discoverTests(path.join(__dirname, 'tests'));
  if (!files.length) throw new Error('No backend test files were discovered');
  let allPass = true;
  try {
    for (const file of files) {
      if (!await runFile(file, { temporaryRoot })) allPass = false;
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log(`\n========== ALL DONE (${files.length} files) ==========`);
  console.log(allPass ? 'ALL PASSED' : 'SOME FAILED');
  return allPass;
}

if (require.main === module) {
  runAll().then(allPass => {
    process.exitCode = allPass ? 0 : 1;
  }, error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { discoverTests, createTestTempRoot, childEnvironment, runFile, runAll };
