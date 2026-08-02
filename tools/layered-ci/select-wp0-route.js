'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { classifyWp0Route } = require('./wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY = path.join(ROOT, 'governance', 'layered-ci', 'wp0-routing-policy.json');
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] || '' : ''; }
function lines(value) { return String(value || '').split(/[\r\n,]+/u).map(v => v.trim()).filter(Boolean); }

function files() {
  const base = arg('--base');
  const head = arg('--head');
  if (!base || !head) throw Object.assign(new Error('--base and --head are required'), { reasonCode: 'WP0_ROUTE_DIFF_RANGE_INVALID' });
  return lines(execFileSync('git', ['diff', '--name-only', base, head], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
  const result = classifyWp0Route(policy, files());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `route=${result.route || 'FAIL'}\n`);
  if (!result.pass) process.exitCode = 1;
}
try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ pass: false, reasonCode: error.reasonCode || error.code || 'WP0_ROUTE_SELECTION_FAILED', message: error.message, readyForPromotion: false }, null, 2)}\n`);
  process.exitCode = 1;
}
