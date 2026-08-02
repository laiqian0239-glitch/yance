'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { classifyChangedFiles } = require('./governance-policy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'layered-ci', 'risk-policy.json');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : '';
}

function splitFiles(value) {
  return String(value || '')
    .split(/[\r\n,]+/u)
    .map(item => item.trim())
    .filter(Boolean);
}

function changedFiles() {
  const base = argValue('--base');
  const head = argValue('--head');
  if (base || head) {
    if (!base || !head) throw Object.assign(new Error('--base and --head must be supplied together'), {
      reasonCode: 'CI_DIFF_RANGE_INVALID'
    });
    const output = execFileSync('git', ['diff', '--name-only', base, head], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return splitFiles(output);
  }
  const explicit = argValue('--files');
  if (explicit) return splitFiles(explicit);
  if (process.stdin.isTTY) return [];
  return splitFiles(fs.readFileSync(0, 'utf8'));
}

function writeOutputs(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, [
    `required_level=${result.requiredLevel || 'FAIL'}`,
    `requires_l2=${result.requiredLevel === 'L2'}`,
    `promotion_required=${result.promotionRequired === true}`
  ].join('\n') + '\n');
}

function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const result = classifyChangedFiles(policy, changedFiles());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  writeOutputs(result);
  if (!result.pass) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    pass: false,
    reasonCode: error.reasonCode || error.code || 'CI_LEVEL_SELECTION_FAILED',
    message: error.message,
    readyForPromotion: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
