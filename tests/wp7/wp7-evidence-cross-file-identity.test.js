'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCrossFileIdentity } = require('../../tools/wp7/lib');
const { generateFinalEvidenceSet } = require('../../tools/wp7/final-evidence');
const { identityTuple, expectReason, temp } = require('./helpers');
const { isFinalExecution, evidenceRoot, load, finalContext } = require('./final-phase-helpers');

test('wp7-evidence-cross-file-identity.test', () => {
  const a = identityTuple('a');
  assert.equal(validateCrossFileIdentity({ a, b: { ...a } }).status, 'PASS');
  expectReason(assert, () => validateCrossFileIdentity({ a, b: { ...a, buildSessionId: 'other' } }), 'WP7_EVIDENCE_IDENTITY_SPLIT');

  if (isFinalExecution()) {
    const context = finalContext();
    const names = [
      'evidence/wp7/clean-install.json',
      'evidence/wp7/build-identity.json',
      'evidence/wp7/runtime-ownership.json',
      'evidence/wp7/install-tree-inventory.json'
    ];
    const documents = Object.fromEntries(names.map((name) => [name, load(name)]));
    assert.equal(validateCrossFileIdentity(documents).status, 'PASS');
    for (const document of Object.values(documents)) {
      assert.equal(document.buildSessionId, context.buildSessionId);
      assert.equal(document.installerSha256, context.installerSha256);
    }
    assert.ok(fs.existsSync(path.join(evidenceRoot(), 'raw-evidence-manifest.json')));
    return;
  }

  const root = temp('wp7-final-evidence-denied-');
  expectReason(assert, () => generateFinalEvidenceSet({ outputRoot: root, observations: {}, testResults: {} }), 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS');
});
