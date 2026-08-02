'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROBE = path.join(ROOT, 'tools/uat/fix6d_global_typography_matrix_probe.py');

function runTypographyMatrix(options = {}) {
  const run = spawnSync('python', [PROBE, JSON.stringify(options)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || `typography matrix probe exited ${run.status}`);
  return JSON.parse(run.stdout.trim());
}

module.exports = { ROOT, PROBE, runTypographyMatrix };
