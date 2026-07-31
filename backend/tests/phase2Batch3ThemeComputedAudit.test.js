'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('../../frontend/js/r32-theme-computed-audit.js');
const catalog = require('../../frontend/theme-catalog.json');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('computed audit owns the complete published theme catalog', () => {
  assert.deepEqual(audit.THEME_IDS, catalog.themes.map(theme => theme.id));
  assert.equal(new Set(audit.THEME_IDS).size, catalog.themes.length);
  for (const id of ['midnight-cyan', 'amber-library', 'solar-flare']) assert.ok(audit.THEME_IDS.includes(id));
});

test('computed audit blocks transparent structural surfaces and low contrast', () => {
  const transparent = audit.auditSnapshot({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(255, 255, 255)' });
  assert.equal(transparent.ok, false);
  assert.equal(transparent.failures.some(row => row.code === 'TRANSPARENT_STRUCTURAL_SURFACE'), true);
  const low = audit.auditSnapshot({ backgroundColor: 'rgb(20, 20, 20)', color: 'rgb(30, 30, 30)' });
  assert.equal(low.ok, false);
  assert.equal(low.failures.some(row => row.code === 'LOW_TEXT_CONTRAST'), true);
  const pass = audit.auditSnapshot({ backgroundColor: 'rgb(10, 10, 10)', color: 'rgb(245, 245, 245)' });
  assert.equal(pass.ok, true);
});

test('theme workspace loads real getComputedStyle audit after theme motion', () => {
  const html = read('frontend/index.html');
  assert.ok(html.indexOf('/r32-theme-motion.js') < html.indexOf('/js/r32-theme-computed-audit.js'));
  const source = read('frontend/js/r32-theme-computed-audit.js');
  assert.match(source, /getComputedStyle/);
  assert.match(source, /auditAllThemes/);
  assert.match(source, /完整主题目录真实计算样式审计/);
});
