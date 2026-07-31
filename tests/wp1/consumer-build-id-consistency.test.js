'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPipelineTest, gitIdentity, canonicalJsonBuffer, detachedHashText, sha256File } = require('../../tools/wp1/lib');
const { getElectronReleaseIdentity } = require('../../electron/releaseIdentity');
const { getBackendReleaseIdentity } = require('../../backend/releaseIdentity');
const { getInstallerReleaseIdentity } = require('../../installer/releaseIdentity');
const { getDiagnosticsReleaseIdentity } = require('../../diagnostics/releaseIdentity');
const { assertSameInstalledReleaseIdentity } = require('../../shared/release/installedManifestLocator');
const { tempDir, validManifest, write } = require('./helpers');

test('installed layout makes all four production consumers use one verified manifest by default rules', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const identity = gitIdentity(repoRoot);
  const pipeline = buildPipelineTest({ repoRoot, outputRoot: tempDir('yance-wp1-consumers-'), gitIdentity: { ...identity, repositoryClean: true }, buildTimestampUtc: '2026-07-03T00:00:00Z', requireClean: false });
  const resourcesPath = path.join(pipeline.outputRoot, 'resources');
  const electronIdentity = getElectronReleaseIdentity({ resourcesPath, reload: true });
  const backendIdentity = getBackendReleaseIdentity({ startupConfig: { resourcesPath }, reload: true });
  const installerIdentity = getInstallerReleaseIdentity({ stagingRoot: pipeline.outputRoot });
  const diagnosticsIdentity = getDiagnosticsReleaseIdentity({ releaseIdentity: backendIdentity });
  const consumers = [electronIdentity, backendIdentity, installerIdentity, diagnosticsIdentity];
  assert.equal(assertSameInstalledReleaseIdentity(consumers), true);
  assert.deepEqual(new Set(consumers.map(item => item.buildId)).size, 1);
  assert.equal(consumers[0].buildId, pipeline.summary.buildId);
  assert.deepEqual(consumers.map(item => item.consumer), ['electron', 'backend', 'installer', 'diagnostics']);
});

test('consumer cohort fails closed when one default layout resolves a different manifest', () => {
  const root = tempDir('yance-wp1-consumer-mismatch-');
  const a = path.join(root, 'a', 'resources');
  const b = path.join(root, 'b', 'resources');
  const first = validManifest();
  const second = validManifest({ gitCommit: 'e'.repeat(40), sourceCommit: 'e'.repeat(40) });
  for (const [dir, manifest] of [[a, first], [b, second]]) {
    const mp = path.join(dir, 'release-manifest.json');
    write(mp, canonicalJsonBuffer(manifest));
    write(path.join(dir, 'release-manifest.sha256'), detachedHashText(sha256File(mp)));
  }
  const identities = [
    getElectronReleaseIdentity({ resourcesPath: a, reload: true }),
    getBackendReleaseIdentity({ startupConfig: { resourcesPath: b }, reload: true })
  ];
  assert.throws(() => assertSameInstalledReleaseIdentity(identities), error => error.reasonCode === 'BOOT_BUILD_ID_MISMATCH');
});

test('all production release identity consumers use the Installed Manifest Locator and no explicit manifestPath wrapper', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const wrappers = ['electron/releaseIdentity.js', 'backend/releaseIdentity.js', 'installer/releaseIdentity.js', 'diagnostics/releaseIdentity.js'];
  for (const relative of wrappers) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.equal(text.includes("shared/release/installedManifestLocator"), true, relative);
    assert.equal(/manifestPath\s*:/.test(text), false, relative);
  }
});
