'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');

test('every legacy public-brand occurrence is explicitly classified and no allowed occurrence is user-visible', () => {
  const result = spawnSync(process.execPath, ['scripts/branding/audit-yance-brand.js'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.unexplainedCount, 0);
  assert.equal(report.visibleAllowanceCount, 0);
  assert.ok(report.findingCount > 0, 'the audit must prove that historical and compatibility occurrences were inspected');
});
