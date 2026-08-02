'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateReviewedCandidate } = require('./reviewed-candidate');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function main() {
  const input = process.argv[2] || 'governance/layered-ci/reviewed-candidate-a6.json';
  const manifestPath = path.resolve(REPO_ROOT, input);
  if (!manifestPath.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw Object.assign(new Error('manifest path must stay inside the repository'), {
      reasonCode: 'CANDIDATE_MANIFEST_PATH_INVALID'
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = evaluateReviewedCandidate({ manifest, git });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    pass: false,
    reasonCode: error.reasonCode || error.code || 'CANDIDATE_VERIFICATION_INPUT_INVALID',
    message: error.message,
    readyForPromotion: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
