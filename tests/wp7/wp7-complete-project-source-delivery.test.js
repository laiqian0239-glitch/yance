'use strict';
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceDeliveryPreview } = require('../../tools/wp7/lib');
const { temp } = require('./helpers');
const { isFinalExecution, load, finalContext } = require('./final-phase-helpers');

test('wp7-complete-project-source-delivery.test', () => {
  if (isFinalExecution()) {
    const context = finalContext();
    const closure = load('evidence/wp7/full-source-delivery-closure.json');
    assert.equal(closure.status, 'PASS');
    assert.equal(closure.finalDeliveryHead, context.finalDeliveryHead);
    assert.equal(closure.finalDeliveryTree, context.finalDeliveryTree);
    assert.equal(closure.missingFiles, 0);
    assert.equal(closure.extraFiles, 0);
    assert.equal(closure.mismatchedFiles, 0);
    return;
  }
  const dir = temp('wp7-source-delivery-');
  const result = createSourceDeliveryPreview({ outputRoot: dir });
  assert.equal(result.status, 'PASS');
  assert.ok(result.trackedFileCount > 600);
  assert.ok(fs.statSync(result.sourceZip).size > 0);
});
