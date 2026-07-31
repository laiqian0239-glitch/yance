'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPipelineTest, FINAL_REUSE_REASON, gitIdentity, scanForPipelineTestArtifacts } = require('../../tools/wp1/lib');
const { tempDir, write } = require('./helpers');

test('WP1 pipeline-test artifacts are marked and rejected from WP7 final staging', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const identity = gitIdentity(repoRoot);
  const pipeline = buildPipelineTest({ repoRoot, outputRoot: tempDir('yance-wp1-marker-'), gitIdentity: { ...identity, repositoryClean: true }, buildTimestampUtc: '2026-07-03T00:00:00Z', requireClean: false });
  assert.equal(fs.existsSync(path.join(pipeline.outputRoot, '.wp1-pipeline-test-artifact.json')), true);
  const rejected = scanForPipelineTestArtifacts(pipeline.outputRoot);
  assert.equal(rejected.status, 'FAIL');
  assert.equal(rejected.reasonCode, FINAL_REUSE_REASON);
  const clean = tempDir('yance-wp1-clean-staging-');
  write(path.join(clean, 'app.asar'), 'clean-final-fixture');
  assert.equal(scanForPipelineTestArtifacts(clean).status, 'PASS');
});
