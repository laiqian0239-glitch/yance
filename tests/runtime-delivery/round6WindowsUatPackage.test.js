'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { replaceAll } = require('../../tools/runtime-delivery/create-round6-windows-uat-package');

const repoRoot = path.resolve(__dirname, '..', '..');


test('round6 UAT installer template preserves safety and local-secret boundaries', () => {
  const file = path.join(repoRoot, 'tools/runtime-delivery/templates/INSTALL_TEST_AND_START_YANCE_UAT.ps1.template');
  const raw = fs.readFileSync(file);
  const template = raw.toString('ascii');
  assert.equal([...raw].every(byte => byte < 128), true);
  assert.equal(raw.includes(Buffer.from('\r\n')), true);
  assert.match(template, /Get-FileHash/);
  assert.match(template, /YANCE_SOURCE_CHECKPOINT\.json/);
  assert.match(template, /Yance-UAT-RestorePoints/);
  assert.match(template, /YANCE_UAT_SELECTED_DATA_ROOT/);
  assert.match(template, /RedirectStandardOutput = \$true/);
  assert.match(template, /RedirectStandardError = \$true/);
  assert.match(template, /ReadToEndAsync\(\)/);
  assert.match(template, /return \[int\]\$process\.ExitCode/);
  assert.doesNotMatch(template, /2>&1\s*\|\s*Tee-Object/u);
  assert.doesNotMatch(template, /Remove-Item[^\n]+APPDATA[^\n]+Yance[^\n]+-Recurse/iu);
});

test('round6 package renderer rejects unresolved identity placeholders', () => {
  assert.throws(() => replaceAll('__EXPECTED_COMMIT__ __MISSING__', { '__EXPECTED_COMMIT__': 'a'.repeat(40) }), /unresolved placeholders/);
});

test('round6 package generator declares the ASCII bootstrap and exit-code-only stderr policy', () => {
  const generator = fs.readFileSync(path.join(repoRoot, 'tools/runtime-delivery/create-round6-windows-uat-package.js'), 'utf8');
  assert.match(generator, /bootstrapRevision: 3/u);
  assert.match(generator, /installerEncoding: 'ASCII-CRLF'/u);
  assert.match(generator, /nativeStderrPolicy: 'exit-code-only'/u);
  assert.match(generator, /dataRootBinding: 'process-environment'/u);
  assert.match(generator, /Buffer\.from\(rendered, 'ascii'\)/u);
});
