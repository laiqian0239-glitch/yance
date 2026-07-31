'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const generator = require('../../tools/wp3/generate-evidence');

test('WP3 evidence generator isolates singleton execution from inherited runtime authority paths', () => {
  const source = {
    PATH: process.env.PATH || '',
    WORKBUDDY_DATA_DIR: 'legacy-workbuddy',
    YANCE_DATA_DIR: 'current-data',
    YANCE_LEGACY_DATA_DIR: 'legacy-data',
    YANCE_PRIMARY_SQLITE_PATH: 'primary.sqlite',
    YANCE_SETTINGS_SQLITE_PATH: 'settings.sqlite',
    YANCE_RUNTIME_MUTEX_NAME: 'shared-mutex',
    YANCE_SAFE_MODE: '1',
    YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD: '7'
  };
  const env = generator.isolatedWp3Environment(source);
  for (const key of generator.WP3_ISOLATED_ENV_KEYS) assert.equal(Object.hasOwn(env, key), false, key);
  assert.equal(env.YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD, '7');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET, '1');
});

test('WP3 evidence generator supports an external evidence directory', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../tools/wp3/generate-evidence.js'), 'utf8');
  assert.match(source, /process\.env\.WP3_EVIDENCE_DIR/);
  assert.match(source, /runRuntimeSingletonScenarioIsolated\(\)/);
  assert.doesNotMatch(source, /await runRuntimeSingletonScenario\(\)/);
});


test('WP3 evidence parser accepts only complete strict summaries', () => {
  assert.deepEqual(generator.testSummary('# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n'), {
    tests: 2, pass: 2, fail: 0, skipped: 0, cancelled: 0, todo: 0
  });
  assert.equal(generator.testSummary('ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ skipped 1\n'), null);
});


test('WP3 evidence accepts more test cases than required files when every case passes', () => {
  assert.equal(generator.requiredTestSummaryComplete({ tests: 47, pass: 47, fail: 0, skipped: 0, cancelled: 0, todo: 0 }, 25), true);
  assert.equal(generator.requiredTestSummaryComplete({ tests: 47, pass: 46, fail: 0, skipped: 1, cancelled: 0, todo: 0 }, 25), false);
});

test('WP3 evidence rejects incomplete, failing, or undersized summaries', () => {
  assert.equal(generator.requiredTestSummaryComplete({ tests: 24, pass: 24, fail: 0, skipped: 0, cancelled: 0, todo: 0 }, 25), false);
  assert.equal(generator.requiredTestSummaryComplete({ tests: 47, pass: 46, fail: 1, skipped: 0, cancelled: 0, todo: 0 }, 25), false);
  assert.equal(generator.requiredTestSummaryComplete({ tests: 47, pass: 45, fail: 0, skipped: 1, cancelled: 0, todo: 0 }, 25), false);
});

test('WP3 evidence parser uses the final summary when output contains multiple summaries', () => {
  const output = [
    '# tests 3', '# pass 3', '# fail 0', '# skipped 0', '# cancelled 0', '# todo 0',
    '# tests 47', '# pass 47', '# fail 0', '# skipped 0', '# cancelled 0', '# todo 0', ''
  ].join('\n');
  assert.deepEqual(generator.testSummary(output), { tests: 47, pass: 47, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
});
