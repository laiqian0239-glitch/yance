'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyChangedFiles } = require('./governance-policy');
const {
  appendGithubOutputs,
  argValue,
  diffChangedFiles,
  runJsonCli,
  splitFileList
} = require('./cli-support');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'layered-ci', 'risk-policy.json');

function changedFiles() {
  const base = argValue(process.argv, '--base');
  const head = argValue(process.argv, '--head');
  if (base || head) {
    if (!base || !head) {
      throw Object.assign(new Error('--base and --head must be supplied together'), {
        reasonCode: 'CI_DIFF_RANGE_INVALID'
      });
    }
    return diffChangedFiles({
      repoRoot: REPO_ROOT,
      base,
      head,
      reasonCode: 'CI_DIFF_RANGE_INVALID'
    });
  }

  const explicit = argValue(process.argv, '--files');
  if (explicit) return splitFileList(explicit);
  if (process.stdin.isTTY) return [];
  return splitFileList(fs.readFileSync(0, 'utf8'));
}

function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const result = classifyChangedFiles(policy, changedFiles());
  appendGithubOutputs({
    required_level: result.requiredLevel || 'FAIL',
    requires_l2: result.requiredLevel === 'L2',
    promotion_required: result.promotionRequired === true
  });
  return result;
}

runJsonCli(main, 'CI_LEVEL_SELECTION_FAILED');
