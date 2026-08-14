'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const authorizationPath = path.join(
  root,
  'governance/layered-ci/v21-learning-deep-training-contract-closure-v3-authorization.json'
);
const contractPath = path.join(root, 'backend/services/learningDeepTrainingContract.js');
const langfusePath = path.join(root, 'backend/services/langfuseLearningEvidenceAdapter.js');
const promotionPath = path.join(root, 'backend/services/learningPromotionAdapter.js');

const expectedImplementationPaths = [
  'backend/services/langfuseLearningEvidenceAdapter.js',
  'backend/services/learningDeepTrainingContract.js',
  'backend/services/learningPromotionAdapter.js',
  'backend/tests/learningDeepTrainingContract.test.js',
  'tests/wp0/v21-learning-deep-training-contract-closure.test.js'
];

const expectedFailureFirstPaths = [
  'backend/tests/learningDeepTrainingContract.test.js',
  'tests/wp0/v21-learning-deep-training-contract-closure.test.js'
];

function digestPaths(paths) {
  return crypto.createHash('sha256').update(`${paths.join('\n')}\n`).digest('hex');
}

test('V3 authorization pins exact five-path implementation and two-path failure-first scopes', () => {
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));

  assert.equal(authorization.workPackage, 'V21-LEARNING-DEEP-TRAINING-CONTRACT-CLOSURE-V3');
  assert.equal(authorization.implementation.branch, 'product/v21-learning-deep-training-contract-closure-v3');

  assert.equal(authorization.implementation.approvedChangedFileCount, 5);
  assert.deepEqual(authorization.implementation.allowedChangedPaths, expectedImplementationPaths);
  assert.equal(
    authorization.implementation.approvedChangedFileSetSha256,
    digestPaths(expectedImplementationPaths)
  );

  const first = authorization.implementation.failureFirstCommit;
  assert.equal(first.mustBeFirstImplementationCommit, true);
  assert.equal(first.freshCausalRedRequired, true);
  assert.equal(first.productionCodeChanged, false);
  assert.deepEqual(first.allowedChangedPaths, expectedFailureFirstPaths);
  assert.equal(first.approvedChangedFileSetSha256, digestPaths(expectedFailureFirstPaths));
});

test('stable Learning→Deep Training contract is a thin read-only seam', () => {
  assert.equal(
    fs.existsSync(contractPath),
    true,
    'trusted main has no stable Learning→Deep Training projection contract'
  );

  const source = fs.readFileSync(contractPath, 'utf8');
  assert.doesNotMatch(
    source,
    /insertLearningSignal|updateLearningProfile|deleteLearning|DatasetStore|trajectoryStore|rewardEngine|AgentLightning|agent-lightning/u
  );
  assert.doesNotMatch(source, /require\(['"]@/u);
});

test('approved mature OSS seams remain authoritative', () => {
  const langfuse = fs.readFileSync(langfusePath, 'utf8');
  const promotion = fs.readFileSync(promotionPath, 'utf8');

  assert.match(langfuse, /client\.api\.datasets\.create/u);
  assert.match(langfuse, /client\.dataset\.createItem/u);
  assert.match(langfuse, /client\.api\.scores\.create/u);
  assert.doesNotMatch(langfuse, /client\.score\.create/u);

  assert.match(promotion, /async function rollback/u);
  assert.match(promotion, /rollout\.kind/u);
  assert.match(promotion, /LEARNING_ROLLOUT/u);
  assert.match(promotion, /rollout\.candidate/u);
  assert.match(promotion, /LEARNING_ROLLBACK/u);
});

test('V3 contract rules stay fail-closed', () => {
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const rules = authorization.contractRules;

  assert.equal(rules.readOnlyProjection, true);
  assert.equal(rules.canonicalSignalIdsMustBePreserved, true);
  assert.equal(rules.trajectoryMayInferMissingSteps, false);
  assert.equal(rules.trajectoryMayReorderSteps, false);
  assert.equal(rules.sendEventImpliesSuccess, false);
  assert.equal(rules.deepTrainingMayComputeReward, false);
  assert.equal(rules.deepTrainingMayNormalizeOrShapeReward, false);
  assert.equal(rules.scoreMustBeLearningApproved, true);
  assert.equal(rules.langfuseDatasetIsExperimentDatasetAuthority, true);
  assert.equal(rules.piiMinimizationBeforeProjection, true);
  assert.equal(rules.doNotLearnFailClosed, true);
  assert.equal(rules.mixedRelationshipBatchForbidden, true);
  assert.equal(
    rules.globalAggregationDefault,
    'DENY_UNLESS_EXPLICIT_CANONICAL_GLOBAL_ELIGIBILITY'
  );
  assert.equal(rules.rollbackRequiresLearningRolloutIdentity, true);
  assert.equal(rules.rollbackRequiresCandidateIdentity, true);
});
