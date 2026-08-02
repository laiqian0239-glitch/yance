'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
}

function splitFileList(value) {
  return String(value || '')
    .split(/[\r\n,]+/u)
    .map(item => item.trim())
    .filter(Boolean);
}

function cliError(message, reasonCode) {
  return Object.assign(new Error(message), { reasonCode });
}

function assertCommitObject(repoRoot, sha, reasonCode) {
  if (!SHA_PATTERN.test(String(sha || ''))) {
    throw cliError('diff range must contain exact lowercase 40-character commit IDs', reasonCode);
  }
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    throw cliError(`commit object is unavailable: ${sha}`, reasonCode);
  }
}

function diffChangedFiles({ repoRoot, base, head, reasonCode }) {
  assertCommitObject(repoRoot, base, reasonCode);
  assertCommitObject(repoRoot, head, reasonCode);
  const output = execFileSync(
    'git',
    ['-c', 'core.quotePath=false', 'diff', '--name-only', base, head, '--'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  return splitFileList(output);
}

function appendGithubOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([name, value]) => `${name}=${String(value)}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function runJsonCli(main, fallbackReasonCode) {
  try {
    const result = main();
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result && result.pass === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      pass: false,
      reasonCode: error.reasonCode || error.code || fallbackReasonCode,
      message: error.message,
      readyForPromotion: false
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SHA_PATTERN,
  appendGithubOutputs,
  argValue,
  diffChangedFiles,
  runJsonCli,
  splitFileList
};
