'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const modelBrainProjection = require('../services/modelBrainProjection');
const readiness = require('../services/aiTaskRoleReadinessAuthority');
const roleReceipts = require('../services/aiRoleQualificationReceiptAuthority');

function verifiedModel(id, task, extra = {}) {
  return {
    id,
    name: id,
    provider: 'openrouter',
    qualification: 'verified',
    available: true,
    userDisabled: false,
    allowedTasks: [task],
    ...extra
  };
}

// V21 Model Brain retired Yance-owned physical routing/qualityPlan scoring. Hard task
// eligibility is now the Model Brain projection (verified + declared task tags), and the
// commercial quality gate is readiness.commercialTaskPass (signed role qualification receipt).

test('blocks a translation model that lacks the commercial translation quality qualification', () => {
  const model = verifiedModel('translation-conditional', 'translation');
  // Hard deployment eligibility can pass while the commercial translation quality gate still blocks.
  assert.equal(readiness.formalTaskEligible(model, 'translation'), true);
  assert.equal(readiness.commercialTaskPass(model, 'translation'), false);
  const projection = modelBrainProjection.project({ models: [model] }, { task: 'translation' });
  assert.equal(projection.candidates.length, 1);
});

test('a stale route human-review flag cannot grant conditional translation qualification', () => {
  const model = verifiedModel('translation-conditional', 'translation', {
    // Legacy route flags must never substitute for a signed commercial quality receipt.
    allowConditional: true,
    humanReviewRequired: true
  });
  assert.equal(readiness.commercialTaskPass(model, 'translation'), false);
});

test('blocks fact extraction for a model that does not declare the fact_extraction task capability', () => {
  // The model is verified for translation only; requesting the fact-extraction logical model
  // must fail the current hard-eligibility projection (no legacy capabilityCoverage enumeration).
  const model = verifiedModel('fact-not-declared', 'translation');
  const projection = modelBrainProjection.project({ models: [model] }, { task: 'fact_extraction' });
  assert.equal(projection.logicalModel, 'yance.fact-extraction');
  assert.equal(projection.candidates.length, 0);
});

test('a commercially qualified translation model passes both hard eligibility and the quality gate', () => {
  const evidence = { authority: 'YanceCommercialModelBenchmark', status: 'COMMERCIAL_MODEL_QUALIFIED', testedAt: '2026-07-31T10:00:00.000Z', completed: true, pass: true, score: 95, qualifyingTasks: ['translation'], translationScore: 95 };
  const model = verifiedModel('translation-qualified', 'translation', {
    lastCommercialBenchmark: evidence,
    roleQualificationReceipts: { translation: roleReceipts.issueFromEvidence({ modelId: 'translation-qualified', task: 'translation', evidence, expiresAt: '2030-01-01T00:00:00.000Z' }) }
  });

  assert.equal(readiness.formalTaskEligible(model, 'translation'), true);
  assert.equal(readiness.commercialTaskPass(model, 'translation'), true);
  const projection = modelBrainProjection.project({ models: [model] }, { task: 'translation' });
  assert.equal(projection.candidates.length, 1);
  assert.equal(projection.candidates[0].id, model.id);
});
