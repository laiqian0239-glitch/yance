'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportSafeEvidence } = require('../../tools/uat/exportSourceUatEvidence');

function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }

test('safe evidence export never copies platform-auth.json or secret values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-safe-evidence-'));
  const resources = path.join(root, 'resources');
  const output = path.join(root, 'evidence');
  fs.mkdirSync(resources, { recursive: true });
  writeJson(path.join(resources, 'platform-auth.json'), {
    telegram: { apiId: 123, apiHash: 'SUPER_SECRET_API_HASH' },
    facebook: { workerBaseUrl: 'https://example.invalid' }
  });
  writeJson(path.join(resources, 'release-manifest.json'), {
    buildId: 'build-1', sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), artifactClass: 'SOURCE_UAT_ONLY',
    platformAuthConfigured: true, platformAuthConfigSha256: 'c'.repeat(64), platformAuthReleaseManaged: true,
    sourceUat: { branch: 'uat/test', tag: 'tag-1', fullPipelineExecuted: false, wp7Executed: false, strictExecuted: false, builderExecuted: false }
  });
  writeJson(path.join(resources, 'source-uat-preparation.json'), {
    sourceIdentity: { branch: 'uat/test', commit: 'a'.repeat(40), tree: 'b'.repeat(40), tag: 'tag-1' },
    platformAuth: { configured: true, configSha256: 'c'.repeat(64) }
  });
  writeJson(path.join(resources, 'source-uat-launch.json'), {
    sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), dataRoot: 'C:/Users/Private/Secret', dataMode: 'custom-explicit',
    selectedDataRootEvidence: { databasePath: 'C:/Users/Private/Secret/store/yance-r32.db', databaseExists: true, databaseSizeBytes: 1234, walSizeBytes: 56 },
    dataRootCandidates: [{ dataRoot: 'C:/Users/Private/Secret' }], port: 27632, status: 'EXITED', startedAtUtc: '2026-07-22T00:00:00Z', exitedAtUtc: '2026-07-22T00:10:00Z', exitCode: 0
  });

  const result = exportSafeEvidence({ resourcesRoot: resources, outputRoot: output });
  const names = fs.readdirSync(output).sort();
  assert.deepEqual(names, ['evidence-export-manifest.json', 'platform-auth-summary.json', 'runtime-summary.json', 'source-identity.json']);
  assert.equal(fs.existsSync(path.join(output, 'platform-auth.json')), false);
  const allText = names.map(name => fs.readFileSync(path.join(output, name), 'utf8')).join('\n');
  assert.doesNotMatch(allText, /SUPER_SECRET_API_HASH/u);
  assert.doesNotMatch(allText, /C:\/Users\/Private\/Secret/u);
  const auth = JSON.parse(fs.readFileSync(path.join(output, 'platform-auth-summary.json'), 'utf8'));
  assert.equal(auth.configured, true);
  assert.equal(auth.configSha256, 'c'.repeat(64));
  assert.equal(auth.rawConfigExported, false);
  assert.equal(result.manifest.recursiveCopyUsed, false);
});
