'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('renderer presents safe mode only from backend policy authority and has no desktop restart fallback', () => {
  const center = fs.readFileSync(path.resolve(__dirname, '../../frontend/r32-system-center.js'), 'utf8');
  const recovery = fs.readFileSync(path.resolve(__dirname, '../../frontend/r32-settings-recovery.js'), 'utf8');
  assert.equal(center.includes('state.desktop?.desktop?.settings?.safeMode'), false);
  assert.match(center, /Boolean\(p\.safeMode\)/);
  assert.equal(center.includes('restartSafeMode'), false);
  assert.equal(center.includes("'restart-safe'"), false);
  assert.equal(recovery.includes('restartSafeMode'), false);
  assert.equal(recovery.includes('data-action="restart-safe"'), false);
});
