'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE = path.join(ROOT, 'tools/uat/fix6d_computed_style_probe.py');

test('computed-style probe accepts multiple scenarios in one browser process', () => {
  const scenarios = [
    { route: 'accounts', width: 1496, height: 800, navMode: 'compact', aiVisible: false, scrollAudit: true },
    { route: 'theme', width: 760, height: 700, navMode: 'compact', aiVisible: false, scrollAudit: true }
  ];
  const run = spawnSync('python', [PROBE, JSON.stringify(scenarios)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 45000
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 2);
  assert.equal(result[0].scrollAudit.owners[0].id, 'accountCenterWorkspace');
  assert.equal(result[1].scrollAudit.owners[0].id, 'themeWorkspace');
});
