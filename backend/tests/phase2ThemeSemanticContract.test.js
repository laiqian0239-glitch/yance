'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('semantic theme contract is loaded directly after palette definitions', () => {
  const html = read('frontend/index.html');
  const palette = html.indexOf('/r32-theme-motion.css');
  const contract = html.indexOf('/r32-theme-semantic-contract.css');
  const authority = html.indexOf('/r32-theme-authority.css');
  assert.ok(palette >= 0 && contract > palette && authority > contract);
});

test('runtime-created components use semantic tokens instead of fixed colors', () => {
  const files = [
    'frontend/js/r32-ui-runtime.js',
    'frontend/r32-system-center.js',
    'frontend/js/r32-insights-runtime.js',
    'frontend/js/r32-ai-workbench-runtime.js',
    'frontend/js/sqliteConversationRuntime.js',
    'frontend/js/r32-safe-mode-runtime.js',
    'frontend/r32-account-center.js',
    'frontend/r32-phase1-governance.css'
  ];
  const pattern = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i;
  for (const file of files) assert.equal(pattern.test(read(file)), false, file);
});

test('semantic contract owns presence, charts, avatars, safe mode and overlay tokens', () => {
  const css = read('frontend/r32-theme-semantic-contract.css');
  for (const token of [
    '--presence-typing', '--chart-series-primary', '--chart-series-secondary',
    '--avatar-surface-start', '--avatar-face', '--safe-mode-surface', '--overlay-scrim'
  ]) assert.match(css, new RegExp(token.replaceAll('-', '\\-')));
});

test('fixed-color debt gate passes and writes an auditable report', () => {
  const result = spawnSync(process.execPath, ['scripts/audit-theme-colors.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(read('governance/theme-color-debt-report.json'));
  assert.deepEqual(report.failures, []);
  assert.equal(report.policy.legacyDebt['frontend/index.html'], 0);
});
