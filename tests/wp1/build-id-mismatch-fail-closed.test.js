'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildPipelineTest, gitIdentity } = require('../../tools/wp1/lib');
const { loadReleaseIdentity } = require('../../shared/release/releaseIdentity');
const { tempDir } = require('./helpers');

test('consumer buildId mismatch fails closed before identity use', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const identity = gitIdentity(repoRoot);
  const pipeline = buildPipelineTest({ repoRoot, outputRoot: tempDir('yance-wp1-mismatch-'), gitIdentity: { ...identity, repositoryClean: true }, buildTimestampUtc: '2026-07-03T00:00:00Z', requireClean: false });
  assert.throws(() => loadReleaseIdentity({
    manifestPath: path.join(pipeline.outputRoot, 'resources', 'release-manifest.json'),
    detachedHashPath: path.join(pipeline.outputRoot, 'resources', 'release-manifest.sha256'),
    expectedBuildId: 'YANCE-WRONG-BUILD',
    consumer: 'test'
  }), error => error.reasonCode === 'BOOT_BUILD_ID_MISMATCH');
});
