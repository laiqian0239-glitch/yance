'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPipelineTest, gitIdentity, readReleaseSource } = require('../../tools/wp1/lib');
const { tempDir } = require('./helpers');

test('release identity and pipeline-test metadata are deterministic for one source commit and timestamp', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const identity = gitIdentity(repoRoot);
  const timestamp = '2026-07-03T00:00:00Z';
  const a = buildPipelineTest({ repoRoot, outputRoot: tempDir('yance-wp1-det-a-'), gitIdentity: { ...identity, repositoryClean: true }, buildTimestampUtc: timestamp, requireClean: false });
  const b = buildPipelineTest({ repoRoot, outputRoot: tempDir('yance-wp1-det-b-'), gitIdentity: { ...identity, repositoryClean: true }, buildTimestampUtc: timestamp, requireClean: false });
  assert.deepEqual(a.summary, b.summary);
  for (const relative of ['resources/payload-files.json', 'resources/release-manifest.json', 'resources/release-manifest.sha256', 'release-evidence.json', 'pipeline-summary.json', 'wp1-provenance-index.json']) {
    assert.deepEqual(fs.readFileSync(path.join(a.outputRoot, relative)), fs.readFileSync(path.join(b.outputRoot, relative)), relative);
  }
  const source = readReleaseSource();
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.0.0-development');
  assert.notEqual(pkg.version, source.productVersion);
  assert.equal(pkg.releaseIdentitySource, 'release/release-source.json');
  const generatedPackage = JSON.parse(fs.readFileSync(path.join(a.payloadRoot, 'electron_runtime', 'package.json'), 'utf8'));
  assert.equal(generatedPackage.version, source.productVersion);
  assert.equal(generatedPackage.yanceRelease.generatedFrom, 'release/release-source.json');
});
