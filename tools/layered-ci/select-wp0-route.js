'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyWp0Route } = require('./wp0-routing');
const {
  appendGithubOutputs,
  argValue,
  diffChangedFiles,
  runJsonCli
} = require('./cli-support');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT, 'governance', 'layered-ci', 'wp0-routing-policy.json');

function files() {
  const base = argValue(process.argv, '--base');
  const head = argValue(process.argv, '--head');
  if (!base || !head) {
    throw Object.assign(new Error('--base and --head are required'), {
      reasonCode: 'WP0_ROUTE_DIFF_RANGE_INVALID'
    });
  }
  return diffChangedFiles({
    repoRoot: ROOT,
    base,
    head,
    reasonCode: 'WP0_ROUTE_DIFF_RANGE_INVALID'
  });
}

function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const result = classifyWp0Route(policy, files());
  appendGithubOutputs({ route: result.route || 'FAIL' });
  return result;
}

runJsonCli(main, 'WP0_ROUTE_SELECTION_FAILED');
