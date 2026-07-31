'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { replaceAll } = require('../../tools/runtime-delivery/create-round10-windows-uat-package');

const root = path.join(__dirname, '..', '..');
const templateRoot = path.join(root, 'tools', 'runtime-delivery', 'templates');

function read(name) { return fs.readFileSync(path.join(templateRoot, name), 'utf8'); }

test('round10 Windows UAT installer remains single-entry, recovery-first and local-secret-only', () => {
  const ps1 = read('INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.ps1.template');
  const cmd = read('INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.cmd.template');
  assert.match(cmd, /INSTALL_TEST_AND_START_YANCE_ROUND10_UAT\.ps1/u);
  assert.match(ps1, /Get-ExistingDataRoot/u);
  assert.match(ps1, /New-DatabaseRecoveryPoint/u);
  assert.match(ps1, /Get-LowerSha256/u);
  assert.match(ps1, /start-source-uat\.js/u);
  assert.match(ps1, /Enter OpenRouter and platform credentials only inside the running Yance application/u);
  assert.doesNotMatch(ps1, /(api[_-]?key|access[_-]?token|cookie)\s*=\s*['"][^'"]+/iu);
});

test('round10 evidence collector invokes the safe platform exporter and writes a Downloads ZIP', () => {
  const ps1 = read('COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.ps1.template');
  assert.match(ps1, /exportPlatformProductionEvidence\.js/u);
  assert.match(ps1, /Downloads/u);
  assert.match(ps1, /Compress-Archive/u);
  assert.doesNotMatch(ps1, /platform-auth\.json|yance-r32\.db/iu);
});

test('round10 package renderer rejects unresolved placeholders', () => {
  assert.throws(() => replaceAll('__EXPECTED_COMMIT__ __UNKNOWN__', { '__EXPECTED_COMMIT__': 'abc' }), /unresolved placeholders/u);
  assert.equal(replaceAll('__EXPECTED_COMMIT__', { '__EXPECTED_COMMIT__': 'abc' }), 'abc');
});
