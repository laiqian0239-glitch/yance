'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const authorizationPath = path.join(root, 'governance/layered-ci/v21-learning-deep-training-contract-closure-v1-authorization.json');
const contractPath = path.join(root, 'backend/services/learningDeepTrainingContract.js');
const langfusePath = path.join(root, 'backend/services/langfuseLearningEvidenceAdapter.js');
const promotionPath = path.join(root, 'backend/services/learningPromotionAdapter.js');

function digestPaths(paths) {
  return crypto.createHash('sha256').update(`${paths.join('\n')}\n`).digest('hex');
}

test('authorization freezes the exact five-path implementation scope and two-path failure-first scope', () => {
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  assert.equal(authorization.implementation.approvedChangedFileCount, 5);
  assert.equal(digestPaths(authorization.implementation.allowedChangedPaths), authorization.implementation.approvedChangedFileSetSha256);
  assert.equal(digestPaths(authorization.implementation.firstCommitAllowedChangedPaths), authorization.implementation.firstCommitChangedFileSetSha256);
  assert.deepEqual(authorization.implementation.firstCommitAllowedChangedPaths, [
    'backend/tests/learningDeepTrainingContract.test.js',
    'tests/wp0/v21-learning-deep-training-contract-closure.test.js'
  ]);
});

test('stable Learning→Deep Training contract exists only as a thin read-only projection seam', () => {
  assert.equal(fs.existsSync(contractPath), true, 'trusted main has no stable Learning→Deep Training projection contract');
  const source = fs.readFileSync(contractPath, 'utf8');
  assert.doesNotMatch(source, /insertLearningSignal|updateLearningProfile|deleteLearning|DatasetStore|trajectoryStore|rewardEngine|AgentLightning|agent-lightning/u);
  assert.doesNotMatch(source, /require\(['"]@/u, 'the thin contract must not introduce a new package authority');
});

test('Langfuse and promotion adapters expose the approved OSS seams without a Yance replacement authority', () => {
  const langfuse = fs.readFileSync(langfusePath, 'utf8');
  const promotion = fs.readFileSync(promotionPath, 'utf8');
  assert.match(langfuse, /dataset\.create/u);
  assert.match(langfuse, /dataset\.createItem/u);
  assert.match(langfuse, /score\.create/u);
  assert.match(promotion, /async function rollback/u);
  assert.match(promotion, /LEARNING_ROLLBACK/u);
  assert.doesNotMatch(`${langfuse}\n${promotion}`, /custom DatasetStore|reward engine|trajectory store|custom evaluator/u);
});

test('contract rules remain fail-closed for send outcome, reward, relationship isolation and global aggregation', () => {
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  assert.equal(authorization.contractRules.readOnlyProjection, true);
  assert.equal(authorization.contractRules.canonicalSignalIdsMustBePreserved, true);
  assert.equal(authorization.contractRules.trajectoryMayInferMissingSteps, false);
  assert.equal(authorization.contractRules.trajectoryMayReorderSteps, false);
  assert.equal(authorization.contractRules.sendEventImpliesSuccess, false);
  assert.equal(authorization.contractRules.deepTrainingMayComputeReward, false);
  assert.equal(authorization.contractRules.scoreMustBeLearningApproved, true);
  assert.equal(authorization.contractRules.langfuseDatasetIsExperimentDatasetAuthority, true);
  assert.equal(authorization.contractRules.mixedRelationshipBatchForbidden, true);
  assert.equal(authorization.contractRules.globalAggregationDefault, 'DENY_UNLESS_EXPLICIT_CANONICAL_GLOBAL_ELIGIBILITY');
});
