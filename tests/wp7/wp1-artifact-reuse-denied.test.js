'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertNoWp1Reuse, buildPreReviewFixture, readJson } = require('../../tools/wp7/lib');
const { temp, expectReason } = require('./helpers');
const { isFinalExecution, load } = require('./final-phase-helpers');

test('wp1-artifact-reuse-denied.test', () => {
  if (isFinalExecution()) {
    const provenance = load('evidence/wp7/build-provenance.json');
    assert.equal(provenance.wp1ArtifactReuseAllowed, false);
    assert.equal(provenance.overlayInstallerAllowed, false);
    return;
  }
  const contaminated = temp('wp7-wp1-');
  fs.writeFileSync(path.join(contaminated, '.wp1-pipeline-test-artifact.json'), '{}');
  expectReason(assert, () => assertNoWp1Reuse(contaminated), 'FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT');
  const output = temp('wp7-generated-metadata-');
  fs.rmSync(output, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  try {
    const built = buildPreReviewFixture({ outputRoot: output, requireClean: false });
    assert.equal(built.status, 'PASS');
    assert.equal(readJson(built.payloadFilesPath).artifactClass, 'PIPELINE_TEST_ONLY');
    assert.equal(readJson(built.manifestPath).artifactClass, 'PIPELINE_TEST_ONLY');
  } finally { fs.rmSync(output, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
