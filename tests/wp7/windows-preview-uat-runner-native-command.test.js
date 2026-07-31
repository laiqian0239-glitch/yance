'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate, validateBinding } = require('../../tools/release-closure/render-windows-preview-uat-runner');

const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_PATH = path.join(ROOT, 'tools', 'release-closure', 'WINDOWS_PREVIEW_UAT_RUNNER.template.ps1');

function binding() {
  return {
    expectedCommit: 'a'.repeat(40),
    expectedTree: 'b'.repeat(40),
    branch: 'rebuild/windows-native-command-fix',
    bundleSha256: 'c'.repeat(64)
  };
}

test('Windows preview Runner renders immutable identity without unresolved placeholders', () => {
  const rendered = renderTemplate(fs.readFileSync(TEMPLATE_PATH, 'utf8'), binding());
  assert.match(rendered, /\$expectedCommit = 'a{40}'/);
  assert.match(rendered, /\$expectedTree = 'b{40}'/);
  assert.match(rendered, /Yance_GIT_FULL_aaaaaaa\.bundle/);
  assert.doesNotMatch(rendered, /__[A-Z0-9_]+__/);
});

test('Windows preview Runner executes native text commands through isolated ProcessStartInfo streams', () => {
  const script = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  for (const token of [
    'System.Diagnostics.ProcessStartInfo',
    'UseShellExecute = $false',
    'RedirectStandardOutput = $true',
    'RedirectStandardError = $true',
    'ReadToEndAsync()',
    '$process.ExitCode',
    'native-commands.log',
    "Stage 'git-clone'",
    "Stage 'npm-ci-full'",
    "Stage 'npm-ci-production'",
    "Stage 'build-pre-review-product'"
  ]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(script, /& \$(?:git|npm|node|BundledNode)\b/);
  assert.doesNotMatch(script, /\$builderOutput\s*=\s*@\(& \$node/);
});

test('Windows preview Runner preserves git binary subprocesses outside PowerShell stream merging', () => {
  const script = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  assert.doesNotMatch(script, /git[^\r\n]*2>&1/i);
  assert.doesNotMatch(script, /cat-file[^\r\n]*2>&1/i);
  assert.match(script, /stdout 与 stderr|RedirectStandardOutput/);
});

test('Runner binding rejects malformed identities', () => {
  assert.throws(() => validateBinding({ ...binding(), expectedCommit: 'A'.repeat(40) }), /expectedCommit/);
  assert.throws(() => validateBinding({ ...binding(), expectedTree: 'b'.repeat(39) }), /expectedTree/);
  assert.throws(() => validateBinding({ ...binding(), bundleSha256: 'z'.repeat(64) }), /bundleSha256/);
  assert.throws(() => validateBinding({ ...binding(), branch: 'bad\nbranch' }), /branch/);
});
