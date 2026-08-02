'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  appendGithubOutputs,
  argValue,
  diffChangedFiles,
  splitFileList
} = require('../../tools/layered-ci/cli-support');

const ROOT = path.resolve(__dirname, '..', '..');

test('CLI argument and file-list parsing are centralized and deterministic', () => {
  assert.equal(argValue(['node', 'tool', '--base', 'abc'], '--base'), 'abc');
  assert.equal(argValue(['node', 'tool'], '--base'), '');
  assert.deepEqual(splitFileList('b.js\na.js,b.js\r\n'), ['b.js', 'a.js', 'b.js']);
});

test('diff range rejects non-exact commit IDs before invoking git diff', () => {
  assert.throws(
    () => diffChangedFiles({
      repoRoot: ROOT,
      base: '--output=/tmp/escape',
      head: 'a'.repeat(40),
      reasonCode: 'CI_DIFF_RANGE_INVALID'
    }),
    error => error.reasonCode === 'CI_DIFF_RANGE_INVALID'
  );
});

test('GitHub outputs are appended as data records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-cli-output-'));
  const outputPath = path.join(directory, 'output.txt');
  const previous = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = outputPath;
  try {
    appendGithubOutputs({ required_level: 'L2', promotion_required: false });
    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      'required_level=L2\npromotion_required=false\n'
    );
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
