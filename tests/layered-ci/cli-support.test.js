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
  parseNulFileList,
  splitFileList
} = require('../../tools/layered-ci/cli-support');
const {
  parseLsTreeMode
} = require('../../tools/layered-ci/verify-product-documentation');

const ROOT = path.resolve(__dirname, '..', '..');

test('CLI argument and human file-list parsing remain centralized and deterministic', () => {
  assert.equal(argValue(['node', 'tool', '--base', 'abc'], '--base'), 'abc');
  assert.equal(argValue(['node', 'tool'], '--base'), '');
  assert.deepEqual(splitFileList('b.js\na.js,b.js\r\n'), ['b.js', 'a.js', 'b.js']);
});

test('trusted git path parsing uses NUL records and preserves commas and newlines atomically', () => {
  const raw = Buffer.from(
    'docs/superpowers/plans/comma,name.md\0docs/superpowers/plans/line\nbreak.md\0',
    'utf8'
  );
  assert.deepEqual(parseNulFileList(raw), [
    'docs/superpowers/plans/comma,name.md',
    'docs/superpowers/plans/line\nbreak.md'
  ]);
  assert.throws(
    () => parseNulFileList(Buffer.from('unterminated.md', 'utf8')),
    error => error.reasonCode === 'CI_DIFF_PATH_LIST_INVALID'
  );
});

test('ls-tree mode parsing consumes exactly one NUL-delimited record', () => {
  const raw = Buffer.from(
    '100644 blob 0123456789abcdef0123456789abcdef01234567\tdocs/superpowers/plans/comma,name.md\0',
    'utf8'
  );
  assert.equal(parseLsTreeMode(raw), '100644');
  assert.throws(
    () => parseLsTreeMode(Buffer.from('100644 blob invalid\tfile.md\n', 'utf8')),
    error => error.reasonCode === 'WP0_PRODUCT_DOCUMENTATION_TREE_ENTRY_INVALID'
  );
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
