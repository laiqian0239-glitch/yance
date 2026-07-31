'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
}

test('WP3 and WP4 evidence generators support output roots outside the source repository', () => {
  const wp3 = source('tools/wp3/generate-evidence.js');
  const wp4 = source('tools/wp4/generate-evidence.js');
  assert.match(wp3, /process\.env\.WP3_EVIDENCE_DIR/);
  assert.match(wp4, /process\.env\.WP4_EVIDENCE_DIR/);
});

test('WP3 evidence generator is import-safe and isolates singleton execution', () => {
  const wp3 = source('tools/wp3/generate-evidence.js');
  assert.match(wp3, /if \(require\.main === module\) main\(\)\.catch\(reportFailure\)/);
  assert.match(wp3, /runRuntimeSingletonScenarioIsolated\(\)/);
  assert.doesNotMatch(wp3, /\(async \(\) => \{/);
});

test('WP4 required-test evidence does not depend on shell glob expansion', () => {
  const wp4 = source('tools/wp4/generate-evidence.js');
  assert.match(wp4, /shell:\s*false/);
  assert.match(wp4, /requiredWp4TestFiles\(\)/);
  assert.doesNotMatch(wp4, /tests\/wp4\/\*\.test\.js/);
});
