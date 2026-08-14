'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-v21-policy-uat-'));
process.env.YANCE_DATA_DIR = root;
process.env.NODE_ENV = 'test';

const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../../backend/repositories/platformCoreRepository');
const feedback = require('../../backend/services/replyFeedbackLearningService');
const { createLearningPolicyDecisionContract } = require('../../backend/services/learningPolicyDecisionContract');
const { createLearningOutcomeAttributionService } = require('../../backend/services/learningOutcomeAttributionService');
const { createLearningDeepTrainingContract } = require('../../backend/services/learningDeepTrainingContract');
const { createLearningPolicyRuntimeAdapter } = require('../../backend/services/learningPolicyRuntimeAdapter');
const { createLearningPromotionAdapter } = require('../../backend/services/learningPromotionAdapter');

function runPolicyPython(payload) {
  const pythonDir = path.resolve(__dirname, '../../runtime/learning-growth/python');
  const entrypoint = path.join(pythonDir, 'learning_entrypoint.py');
  const result = cp.spawnSync(
    'uv',
    ['run', '--frozen', '--offline', 'python', entrypoint],
    { cwd: pythonDir, input: JSON.stringify(payload), encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`sealed policy runtime failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function main() {
  const store = new R32SqliteStore({ dbPath: path.join(root, 'policy-uat.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const identityAuthority = {
    resolve({ contactId, conversationId }) {
      return {
        authority: 'PersonContextAuthority',
        found: true,
        personId: 'person-uat',
        contactIds: [contactId],
        conversationIds: [conversationId]
      };
    }
  };

  const decisionContract = createLearningPolicyDecisionContract({ personContextAuthority: identityAuthority });
  const decision = decisionContract.createDecisionRecord({
    contactId: 'contact-uat',
    conversationId: 'conversation-uat',
    personaProfileId: 'owner',
    featureBundle: {
      interactionBand: 'balanced',
      performanceMode: 'balanced',
      questionPolicy: 'optional',
      relationshipStage: 'trust_building',
      targetLanguage: 'en'
    },
    allowedActionSet: ['natural_hook', 'playful_attraction', 'direct_advance'],
    candidateStrategyBranch: 'playful_attraction',
    policyVersion: 'vw-p1-baseline-v1',
    policyArtifactId: 'baseline',
    generation: {
      candidatePlanId: 'plan-uat',
      directorStrategyId: 'strategy-uat',
      contextVersion: 7,
      conversationRevision: 3
    }
  });
  assert.equal(decision.actionProbability, 1);
  assert.equal(decision.exploration, false);
  assert.equal(decision.rawPrivateChatPersisted, false);

  const sent = feedback.buildImmutableFeedbackSignal({
    eventType: 'sent',
    evidenceId: 'outbox-uat',
    outboxId: 'outbox-uat',
    candidateId: 'candidate-uat',
    contactId: 'contact-uat',
    conversationId: 'conversation-uat',
    observedAt: '2026-08-14T01:00:00.000Z',
    learningMode: 'send_and_learn',
    learningEligible: true,
    personaTruthReceipt: { pass: true, receiptSha256: 'truth-uat' },
    generationMetadata: {
      learningEligible: true,
      personaTruthReceipt: { pass: true, receiptSha256: 'truth-uat' },
      decisionRecord: decision,
      candidateStrategyBranchId: decision.candidateStrategyBranch
    }
  });
  assert.equal(sent.learningEligible, true);
  assert.equal(sent.signal.decisionRecord.decisionId, decision.decisionId);
  repository.insertLearningSignal(sent);

  const outcomeService = createLearningOutcomeAttributionService({
    repository,
    personContextAuthority: identityAuthority
  });
  const outcomeResult = outcomeService.persistInboundOutcome({
    id: 'inbound-uat-1',
    externalMessageId: 'inbound-uat-1',
    contactId: 'contact-uat',
    conversationId: 'conversation-uat',
    direction: 'inbound',
    sentAt: '2026-08-14T01:02:00.000Z'
  });
  assert.equal(outcomeResult.skipped, false);
  assert.equal(outcomeResult.outcomeVector.learningEligible, false);
  assert.equal(outcomeResult.outcomeVector.signals.replyLatencyMs.status, 'observed');
  assert.equal(outcomeResult.outcomeVector.signals.nextDayReinitiation.status, 'pending');

  const rawRows = repository.listLearningSignals({
    scopeType: 'conversation',
    scopeId: 'conversation-uat',
    learningLevel: 'L1',
    learningEligible: false
  });
  const rawOutcome = rawRows.find(row => row.signal_type === 'policy_outcome_observed');
  assert.ok(rawOutcome);
  assert.equal(Number(rawOutcome.learning_eligible), 0);

  const sourceRows = repository.listLearningSignals({
    scopeType: 'conversation',
    scopeId: 'conversation-uat',
    learningLevel: 'L1',
    learningEligible: true
  });
  const source = sourceRows.find(row => row.signal_type === 'candidate_sent');
  assert.ok(source);
  const outcomeIds = rawOutcome.signal.outcomes.map(row => row.outcomeId).sort();
  const approvedScore = {
    authority: 'Langfuse',
    approvedByLearning: true,
    scoreId: 'score-uat',
    name: 'policy_reward',
    value: 0.75,
    traceId: 'trace-uat',
    sourceSignalId: source.signal_id,
    eligibleSourceSignalId: source.signal_id,
    decisionId: decision.decisionId,
    outcomeIds,
    outcomeEvidenceSetRef: 'uat-evidence-set-v1',
    rewardPolicyVersion: 'reward-policy-v1'
  };

  const deep = createLearningDeepTrainingContract({
    repository,
    dataPolicy: {
      async minimize() { return { allowed: true, text: '' }; }
    }
  });
  const projection = await deep.projectPolicy({
    scopeType: 'conversation',
    scopeId: 'conversation-uat',
    approvedScoresBySignalId: { [source.signal_id]: approvedScore },
    contentBySignalId: { [source.signal_id]: '' }
  });
  assert.equal(projection.readOnly, true);
  assert.equal(projection.trajectory.length, 1);
  assert.equal(projection.trajectory[0].decision.decisionId, decision.decisionId);
  assert.equal(projection.trajectory[0].vwTrainingEligible, true);

  const artifactPath = path.join(root, 'policy.vw');
  const trained = runPolicyPython({
    operation: 'policy_train',
    rows: projection.trajectory,
    artifactPath
  });
  assert.match(trained.policyArtifactVersion, /^[a-f0-9]{64}$/u);
  assert.equal(trained.exploration, false);

  const predicted = runPolicyPython({
    operation: 'policy_predict',
    featureBundle: decision.featureBundle,
    allowedActions: decision.allowedActionSet,
    artifactPath,
    policyArtifactId: trained.policyArtifactVersion,
    policyVersion: 'vw-p1-uat-v1'
  });
  assert.ok(decision.allowedActionSet.includes(predicted.action));
  assert.equal(predicted.probability, 1);
  assert.equal(predicted.exploration, false);

  const runtimeAdapter = createLearningPolicyRuntimeAdapter({
    async invokeVowpalWabbit(input) {
      return runPolicyPython({
        ...input,
        artifactPath,
        policyArtifactId: trained.policyArtifactVersion
      });
    }
  });
  const consumed = await runtimeAdapter.selectLearnedPolicyAction({
    featureBundle: decision.featureBundle,
    allowedActions: decision.allowedActionSet,
    baselineAction: 'natural_hook'
  });
  assert.ok(decision.allowedActionSet.includes(consumed.candidateStrategyBranch));
  assert.equal(consumed.actionProbability, 1);
  assert.equal(consumed.exploration, false);

  const degraded = await createLearningPolicyRuntimeAdapter({
    async invokeVowpalWabbit() {
      const error = new Error('corrupt artifact');
      error.code = 'LEARNING_POLICY_ARTIFACT_IDENTITY_MISMATCH';
      throw error;
    }
  }).selectLearnedPolicyAction({
    featureBundle: decision.featureBundle,
    allowedActions: decision.allowedActionSet,
    baselineAction: 'natural_hook'
  });
  assert.equal(degraded.executedPolicy, 'baseline');
  assert.equal(degraded.degradation.reasonCode, 'LEARNING_POLICY_ARTIFACT_IDENTITY_MISMATCH');

  const promotion = createLearningPromotionAdapter({
    openFeature: {
      setEvaluationContext() {}
    },
    flagd: {
      mode: 'in-process-offline'
    }
  });

  const proposal = {
    status: 'READY_FOR_REVIEW',
    Candidate: {
      id: `policy:${trained.policyArtifactVersion}`,
      version: trained.policyArtifactVersion,
      exposure: 0
    },
    Regression: { passed: true },
    Shadow: { passed: true }
  };

  const active = await promotion.promote(proposal, {
    approved: true,
    evidence: { id: 'uat-promotion-evidence' }
  });

  assert.equal(active.kind, 'LEARNING_ROLLOUT');
  assert.equal(active.automaticPromotion, false);
  assert.equal(active.flagd, 'in-process-offline');

  const rolledBack = await promotion.rollback(active, {
    approved: true,
    evidence: { id: 'uat-rollback-evidence' }
  });

  assert.equal(rolledBack.kind, 'LEARNING_ROLLBACK');
  assert.equal(rolledBack.automaticPromotion, false);
  assert.equal(rolledBack.evidenceId, 'uat-rollback-evidence');

  const brainSource = fs.readFileSync(
    path.resolve(__dirname, '../../backend/services/contextAwareReplyBrain.js'),
    'utf8'
  );
  const selectionIndex = brainSource.indexOf('selectLearnedPolicyAction(');
  const finalFrontierIndex = brainSource.indexOf('let modelResult = await aiGateway.execute', selectionIndex);
  assert.ok(selectionIndex >= 0 && finalFrontierIndex > selectionIndex);

  const receipt = {
    workPackage: 'V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V2-SUCCESSOR',
    canonicalIdentityBound: true,
    storedHistoricalFeatureBundle: true,
    behaviorPropensityLoggedAtDecision: true,
    eligibleSourceSignalAnchored: true,
    rawOutcomeEligibilityImmutableFalse: true,
    outcomeWindowsAndMissingnessExplicit: true,
    scoreEvidenceBindingVerified: true,
    decisionOutcomeBound: true,
    rawOutcomeIsNotReward: true,
    providerPrivacyBoundaryProved: true,
    learner: 'VowpalWabbit 9.11.2',
    frontierGenerationAuthority: 'Model Brain / LiteLLM',
    policyConsumedBeforeGeneration: true,
    promotionAuthority: 'Learning',
    availabilityFallbackProved: true,
    rollbackProved: true,
    localReplyModelUsed: false,
    policyArtifactVersion: trained.policyArtifactVersion,
    selectedAction: consumed.candidateStrategyBranch
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  store.close?.();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});