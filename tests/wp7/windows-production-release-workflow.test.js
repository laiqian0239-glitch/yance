'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/windows-production-release.yml'), 'utf8');

test('production release workflow binds the current Final Builder packaging contract before signing', () => {
  for (const token of [
    'NODE_VERSION: 22.16.0',
    'TRUSTED_NODE_VERSION: 22.23.1',
    'TRUSTED_NODE_ARCHIVE_SHA256: 7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29',
    'TRUSTED_NODE_EXE_SHA256: f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed',
    'expected_commit:',
    'expected_tree:',
    'rebuild/windows-release-closure-$releaseDate-run-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT',
    'RUN_WINDOWS_VERIFY_ROUND.ps1',
    "'-VerificationMode', 'STRICT'",
    'create-windows-preacceptance.js',
    '-WindowsRound1Result',
    '-WindowsRound1Sha256',
    '-WindowsRound2Result',
    '-WindowsRound2Sha256',
    '-ExpectedBundleSha256',
    '-NodeRoot',
    '-TrustedNodeExecutable',
    'WINDOWS_CERTIFICATE_PFX_BASE64',
    'WINDOWS_CERTIFICATE_PASSWORD',
    '-RequireSignedInstaller',
    'Get-AuthenticodeSignature',
    'latestYmlFile',
    'blockmapFile'
  ]) assert.match(workflow, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(workflow, /release-candidate-\$env:GITHUB_RUN_ID/);
  assert.doesNotMatch(workflow, /WP7_PREACCEPTANCE_RECORD_BASE64/);
  assert.doesNotMatch(workflow, /WP7_PREACCEPTANCE_RECORD_SHA256/);
});

test('workflow creates exact strict-round preacceptance before the signed Final Builder', () => {
  const round = workflow.indexOf('Run two independent strict Windows packaging rounds');
  const preacceptance = workflow.indexOf('Create exact machine-bound final packaging preacceptance');
  const builder = workflow.indexOf('Build and sign release before metadata sealing');
  const verify = workflow.indexOf('Verify signed release assets');
  const publish = workflow.indexOf('Publish trusted update release');
  assert.ok(round > 0 && preacceptance > round && builder > preacceptance && verify > builder && publish > verify);
});

test('workflow never publishes before signed builder verification', () => {
  assert.match(workflow, /if: \$\{\{ inputs\.publish \}\}/);
  assert.match(workflow, /RELEASE_REPOSITORY: wangyi198675-coder\/Yance-Releases/);
  assert.match(workflow, /Verify public signed release policy/);
  assert.match(workflow, /PUBLIC_SIGNED_AUTOUPDATE/);
  assert.doesNotMatch(workflow, /Set-Content -Encoding UTF8 release-identity\.json/);
});

test('final builder signs before deriving update hashes and blockmap', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'tools/wp7/lib.js'), 'utf8');
  const signing = lib.indexOf("options.signInstaller({");
  const metadata = lib.indexOf('const updateMeta = emitUpdateMetadata({', signing);
  const finalHash = lib.indexOf('const installerSha256 = sha256File(outputFile);', metadata);
  assert.ok(signing > 0 && metadata > signing && finalHash > metadata);
  assert.doesNotMatch(lib.slice(signing, metadata), /emitUpdateMetadata/);
});
