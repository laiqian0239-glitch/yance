'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FINAL_REUSE_REASON,
  PROVENANCE_INDEX_REQUIRED_REASON,
  assertEmptyBeforeFinalBuild,
  assertNoWp1ProvenanceAfterGeneration,
  buildPipelineTest,
  createApplicationPayload,
  gitIdentity
} = require('../../tools/wp1/lib');
const { tempDir, write } = require('./helpers');

test('WP7 staging must be empty before final build', () => {
  const clean = tempDir('yance-wp1-empty-staging-');
  assert.equal(assertEmptyBeforeFinalBuild(clean).status, 'PASS');
  write(path.join(clean, 'stray.txt'), 'x');
  assert.throws(() => assertEmptyBeforeFinalBuild(clean), error => error.reasonCode === FINAL_REUSE_REASON);
});

test('post-generation provenance validation requires a WP1 provenance index', () => {
  const staging = tempDir('yance-wp1-provenance-required-');
  write(path.join(staging, 'application-payload', 'app.js'), 'fresh');
  assert.throws(
    () => assertNoWp1ProvenanceAfterGeneration(staging),
    error => error.reasonCode === PROVENANCE_INDEX_REQUIRED_REASON
  );
});

test('selectively copied WP1 pipeline metadata is rejected but ordinary runtime payload hashes are not blacklisted', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const identity = gitIdentity(repoRoot);
  const pipeline = buildPipelineTest({
    repoRoot,
    outputRoot: tempDir('yance-wp1-selective-src-'),
    gitIdentity: { ...identity, repositoryClean: true },
    buildTimestampUtc: '2026-07-03T00:00:00Z',
    requireClean: false
  });
  const selected = [
    'resources/release-manifest.json',
    'resources/release-manifest.sha256',
    'release-evidence.json',
    'resources/payload-files.json',
    '.wp1-pipeline-test-artifact.json',
    'Yance-PIPELINE-TEST-ONLY.bin',
    'pipeline-summary.json',
    'build-session-receipt.json',
    'wp1-provenance-index.json'
  ];
  for (const relative of selected) {
    const staging = tempDir('yance-wp1-selective-dst-');
    const destination = path.join(staging, path.basename(relative));
    fs.copyFileSync(path.join(pipeline.outputRoot, relative), destination);
    assert.throws(
      () => assertNoWp1ProvenanceAfterGeneration(staging, [pipeline.provenanceIndexPath]),
      error => error.reasonCode === FINAL_REUSE_REASON,
      relative
    );
  }
});

test('fresh-final-payload-with-identical-runtime-bytes-allowed', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const identity = gitIdentity(repoRoot);
  const pipeline = buildPipelineTest({
    repoRoot,
    outputRoot: tempDir('yance-wp1-fresh-final-source-'),
    gitIdentity: { ...identity, repositoryClean: true },
    buildTimestampUtc: '2026-07-03T00:00:00Z',
    requireClean: false
  });
  const finalStaging = tempDir('yance-wp1-fresh-final-staging-');
  assert.equal(assertEmptyBeforeFinalBuild(finalStaging).status, 'PASS');
  createApplicationPayload(repoRoot, path.join(finalStaging, 'application-payload'));
  const result = assertNoWp1ProvenanceAfterGeneration(finalStaging, [pipeline.provenanceIndexPath]);
  assert.equal(result.status, 'PASS');
  assert.equal(result.ordinaryApplicationPayloadHashesChecked, false);
});
