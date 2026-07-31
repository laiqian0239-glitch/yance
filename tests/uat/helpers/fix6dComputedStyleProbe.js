'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROBE = path.join(ROOT, 'tools/uat/fix6d_computed_style_probe.py');

function runScenarios(scenarios, { productionDom = false, timeoutMs = 90000 } = {}) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new TypeError('scenarios must be a non-empty array');
  }
  const payload = scenarios.map(scenario => productionDom ? { productionDom: true, ...scenario } : { ...scenario });
  const run = spawnSync('python', [PROBE, JSON.stringify(payload)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || `computed-style probe exited ${run.status}`);
  }
  const result = JSON.parse(run.stdout.trim());
  if (!Array.isArray(result) || result.length !== payload.length) {
    throw new Error(`computed-style probe result count mismatch: expected ${payload.length}`);
  }
  return result;
}

function runScenario(scenario, options) {
  return runScenarios([scenario], options)[0];
}

module.exports = { ROOT, PROBE, runScenarios, runScenario };
