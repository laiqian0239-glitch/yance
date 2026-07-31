'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreReviewFixture } = require('../../tools/wp7/lib');
const { temp, expectReason } = require('./helpers');
const { isFinalExecution, load } = require('./final-phase-helpers');

test('final-build-clean-staging.test', () => {
  if (isFinalExecution()) {
    const provenance = load('evidence/wp7/build-provenance.json');
    assert.equal(provenance.stagingInitiallyEmpty, true);
    assert.equal(provenance.oldBuildArtifactReuseAllowed, false);
    return;
  }
  const dir = temp('wp7-not-empty-');
  fs.writeFileSync(path.join(dir, 'old.bin'), 'old');
  expectReason(assert, () => buildPreReviewFixture({ outputRoot: dir, requireClean: false }), 'FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT');
});
