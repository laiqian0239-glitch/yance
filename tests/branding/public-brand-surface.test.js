'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); }

test('primary window and in-app brand surfaces use the unnumbered Yance identity', () => {
  const index = read('frontend/index.html');
  const system = read('frontend/r32-system-center.js');
  const theme = read('frontend/r32-theme-motion.js');
  const recovery = read('frontend/r32-settings-recovery.js');
  const accounts = read('frontend/r32-account-center.js');
  const combined = [index, system, theme, recovery, accounts].join('\n');

  assert.match(index, /<title>言策<\/title>/);
  assert.doesNotMatch(index, /<title>言策\s*[·|-]/);
  assert.match(index, /aria-label="言策 Yance"/);
  assert.match(system, /<small>YANCE · ARCHITECTURE & RELEASE COMMAND CENTER<\/small>/);
  assert.match(system, /<h2>关于言策<\/h2>/);
  assert.match(system, /智能沟通与关系洞察平台/);
  assert.match(system, /看懂对话，找到下一步/);
  assert.match(system, /yance-lockup-horizontal\.svg/);
  assert.match(theme, /YANCE · THEME & MOTION STUDIO/);
  assert.match(recovery, /YANCE · SETTINGS & RECOVERY/);

  assert.doesNotMatch(combined, /YANCE\s+\d+/i);
  assert.doesNotMatch(combined, /言策\s*(?:20|26|27|28|29)/);
  assert.doesNotMatch(combined, /(?:言策|Yance)\s*29/i);
});

test('product UI references product-standard vector assets rather than presentation-only artwork', () => {
  const index = read('frontend/index.html');
  assert.match(index, /assets\/branding\/yance\/yance-mark-flat\.svg/);
  assert.doesNotMatch(index, /yance-mark-display\.svg/);
});
