'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  APPROVED_MATRIX_SHA256,
  FIX6D_UI_ISSUES,
  FIX6D_PROTECTIONS,
  WINDOWS_VISUAL_SCENARIOS
} = require('../../tools/uat/fix6d-screenshot-matrix-contract');

const expectedUiCodes = Array.from({ length: 32 }, (_, index) => `UI-${String(index + 1).padStart(3, '0')}`);
const expectedProtectionCodes = Array.from({ length: 9 }, (_, index) => `P-${String(index + 1).padStart(3, '0')}`);

function sortedKeys(value) {
  return Object.keys(value).sort();
}

test('FIX6D matrix gate binds the approved V2 base plus the V4 regression delta', () => {
  assert.equal(APPROVED_MATRIX_SHA256, '45a2217231c8347bac8a5a43f8bb9902816d0fb1a1ee630a41418a51dfb32c5f');
  assert.deepEqual(sortedKeys(FIX6D_UI_ISSUES), expectedUiCodes);
  assert.deepEqual(sortedKeys(FIX6D_PROTECTIONS), expectedProtectionCodes);
});

test('FIX6D matrix gate excludes runtime and model defects from the UI branch', () => {
  const allCodes = [...sortedKeys(FIX6D_UI_ISSUES), ...sortedKeys(FIX6D_PROTECTIONS)];
  assert.equal(allCodes.some(code => /^(RT|MDL)-/.test(code)), false);
});

test('every UI issue is closed by source assertions or explicitly held for Windows evidence', () => {
  for (const [code, issue] of Object.entries(FIX6D_UI_ISSUES)) {
    assert.ok(['source-asserted-windows-pending', 'protected-current', 'windows-pending'].includes(issue.status), `${code} has invalid status`);
    assert.ok(Array.isArray(issue.sourceAssertions), `${code} sourceAssertions missing`);
    assert.ok(Array.isArray(issue.windowsEvidence), `${code} windowsEvidence missing`);
    assert.ok(issue.sourceAssertions.length > 0 || issue.windowsEvidence.length > 0, `${code} has no closure evidence`);
    for (const file of issue.sourceAssertions) {
      assert.match(file, /\.test\.js$/, `${code} source assertion must be a test file`);
      assert.equal(fs.existsSync(path.resolve(__dirname, '..', '..', file)), true, `${code} source assertion does not exist: ${file}`);
    }
    for (const scenario of issue.windowsEvidence) {
      assert.ok(WINDOWS_VISUAL_SCENARIOS[scenario], `${code} references unknown Windows scenario ${scenario}`);
    }
  }
});

test('historically fixed binary controls remain protection-only and cannot be re-opened silently', () => {
  for (const code of ['UI-011', 'UI-012']) {
    const issue = FIX6D_UI_ISSUES[code];
    assert.equal(issue.status, 'protected-current');
    assert.ok(issue.sourceAssertions.includes('tests/uat/fix6dSystemNaturalLayout.test.js'));
    assert.ok(issue.sourceAssertions.includes('tests/uat/fix6dWindowsUiPublicContract.test.js'));
  }
  assert.ok(FIX6D_PROTECTIONS['P-009'].sourceAssertions.includes('tests/uat/fix6dSystemNaturalLayout.test.js'));
});

test('every frozen normal-state protection has an automated guard', () => {
  for (const [code, protection] of Object.entries(FIX6D_PROTECTIONS)) {
    assert.ok(protection.description, `${code} description missing`);
    assert.ok(Array.isArray(protection.sourceAssertions) && protection.sourceAssertions.length > 0, `${code} automated guard missing`);
  }
});

test('Windows-only matrix covers normal, isolated, DPI, navigation, AI and route states without claiming pass', () => {
  const required = [
    'normal-100', 'normal-125', 'normal-150',
    'isolated-100', 'isolated-125', 'isolated-150',
    'nav-expanded-ai-open', 'nav-compact-ai-closed', 'nav-hidden-ai-open',
    'all-routes', 'all-themes-reading-density', 'narrow-window-floating-layers'
  ];
  assert.deepEqual(Object.keys(WINDOWS_VISUAL_SCENARIOS).sort(), required.sort());
  for (const [id, scenario] of Object.entries(WINDOWS_VISUAL_SCENARIOS)) {
    assert.equal(scenario.status, 'pending-windows-evidence', `${id} must remain pending`);
    assert.ok(scenario.requiredScreenshots >= 1, `${id} screenshot count missing`);
  }
});
