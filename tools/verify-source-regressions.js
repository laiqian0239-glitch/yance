'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SUITES = Object.freeze([
  ['AC-021', 'tests/ac021'],
  ['AC-029', 'tests/ac029'],
  ['Chat Export', 'tests/chat-export'],
  ['Desktop Fixes', 'tests/desktop-fixes'],
  ['Frontend Security', 'tests/frontend-security'],
  ['P0 Contracts', 'tests/p0'],
  ['Persona Brain', 'tests/persona-brain'],
  ['Release Closure', 'tests/release-closure']
]);

function discoverTests(relativeRoot) {
  const root = path.join(REPO_ROOT, relativeRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Required source-regression suite directory is missing: ${relativeRoot}`);
  }
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path.relative(REPO_ROOT, absolute));
    }
  }
  visit(root);
  if (!files.length) throw new Error(`Required source-regression suite contains no tests: ${relativeRoot}`);
  return files;
}

function runNodeTests(label, files) {
  console.log(`\n========== SOURCE REGRESSION: ${label} (${files.length} files) ==========\n`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) {
    throw new Error(`${label} failed (exit=${result.status}, signal=${result.signal || 'none'})`);
  }
}

function runSourceRegressions() {
  for (const [label, relativeRoot] of SUITES) runNodeTests(label, discoverTests(relativeRoot));
  const backend = spawnSync(process.execPath, ['backend/run_all_tests.js'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (backend.error) throw backend.error;
  if (backend.status !== 0 || backend.signal) {
    throw new Error(`Backend full test gate failed (exit=${backend.status}, signal=${backend.signal || 'none'})`);
  }
  console.log('\nSOURCE REGRESSION GATE: PASS');
  return { status: 'PASS', suites: SUITES.length, backend: true };
}

if (require.main === module) {
  try {
    runSourceRegressions();
  } catch (error) {
    console.error(`\nSOURCE REGRESSION GATE: FAIL\n${error && error.stack ? error.stack : error}`);
    process.exit(1);
  }
}

module.exports = { SUITES, discoverTests, runNodeTests, runSourceRegressions };
