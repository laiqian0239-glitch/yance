'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

test('full frontend DOM sink audit has no high-risk findings', () => {
  const result = spawnSync(process.execPath, ['tools/security/audit-dom-sinks.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.deepEqual(report.findings, []);
  assert.ok(report.totals.innerHTML > 0, 'audit should inventory existing reviewed innerHTML sinks');
  assert.equal(report.totals.outerHTML, 0);
  assert.equal(report.totals.directUrl, 0);
});

test('regex fallback distinguishes data-action controls from URL action attributes', () => {
  const result = spawnSync(process.execPath, ['tools/security/audit-dom-sinks.js'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, YANCE_DOM_AUDIT_FORCE_REGEX: '1' }
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.contextualReview.parser, 'regex-fallback');
  assert.equal(report.pass, true);
  assert.deepEqual(report.findings, []);
});
