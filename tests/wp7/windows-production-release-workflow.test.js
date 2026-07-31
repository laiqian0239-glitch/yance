'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/windows-production-release.yml'), 'utf8');

test('production release workflow fixes the reviewed runtime and requires independent approval plus signing secrets', () => {
  for (const token of [
    'NODE_VERSION: 22.16.0',
    'expected_commit:',
    'expected_tree:',
    'git switch --create $buildBranch',
    'refs/heads/$branch',
    'WP7_PREACCEPTANCE_RECORD_BASE64',
    'WP7_PREACCEPTANCE_RECORD_SHA256',
    'WINDOWS_CERTIFICATE_PFX_BASE64',
    'WINDOWS_CERTIFICATE_PASSWORD',
    '-RequireSignedInstaller',
    'Get-AuthenticodeSignature',
    'latestYmlFile',
    'blockmapFile'
  ]) assert.match(workflow, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('workflow never publishes before signed builder verification', () => {
  assert.ok(workflow.indexOf('Verify signed release assets') < workflow.indexOf('Publish trusted update release'));
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
