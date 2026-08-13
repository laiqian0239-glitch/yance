'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLangfuseLearningEvidenceAdapter } = require('../services/langfuseLearningEvidenceAdapter');
const { createLearningPromotionAdapter } = require('../services/learningPromotionAdapter');

function loadContractFactory() {
  try {
    const module = require('../services/learningDeepTrainingContract');
    assert.equal(typeof module.createLearningDeepTrainingContract, 'function');
    return module.createLearningDeepTrainingContract;
  } catch (error) {
    assert.fail(`Stable Learning→Deep Training contract is missing: ${error.message}`);
  }
}

function learningSignal(overrides = {}) {
  return {
    signal_id: 'learning-signal-001',
    idempotency_key: 'reply-feedback:sent:outbox-1',
    learning_level: 'L1',
    scope_type: 'conversation',
    scope_id: 'conversation-1',
    contact_id: 'contact-1',
    conversation_id: 'conversation-1',
    candidate_id: 'candidate-1',
    outbox_id: 'outbox-1',
    signal_type: 'candidate_sent',
    signal: {
      schemaVersion: 1,
      authority: 'LearningV4ImmutableFeedbackSignalSource',
      eventType: 'sent',
      negativeEvidence: false,
      metadata: { rawPrivateChatPersisted: false }
    },
    learning_eligible: 1,
    created_at: '2026-08-14T00:00:00.000Z',
    ...overrides
  };
}

function approvedScore(overrides = {}) {
  return {
    scoreId: 'langfuse-score-1',
    authority: 'Langfuse',
    approvedByLearning: true,
    name: 'learning-quality',
    value: 0.91,
    ...overrides
  };
}

function createSubject(options = {}) {
  const queries = [];
  const signals = options.signals || [learningSignal()];
  const repository = options.repository || {
    listLearningSignals(query) {
      queries.push(query);
      return signals;
    }
  };
  const dataPolicy = options.dataPolicy || {
    async minimize(input = {}) {
      if (String(input.text || '').includes('DENY')) return { allowed: false, reasonCode: 'PRESIDIO_DENIED', text: '' };
      return { allowed: true, minimized: true, text: String(input.text || '').replaceAll('alice@example.com', '<EMAIL_ADDRESS>') };
    }
  };
  const evidenceCalls = [];
  const evidenceAdapter = options.evidenceAdapter || {
    async bindTrainingEvidence(input) {
      evidenceCalls.push(input);
      return Object.freeze({
        bound: true,
        authority: 'Langfuse Dataset + Score',
        datasetName: input.datasetName,
        datasetItemId: input.record.signalId,
        scoreId: input.record.score.scoreId
      });
    }
  };
  const rollbackCalls = [];
  const promotionAdapter = options.promotionAdapter || {
    async rollback(rollout, input) {
      rollbackCalls.push({ rollout, input });
      return Object.freeze({ kind: 'LEARNING_ROLLBACK', rollout, evidenceId: input.evidence.id });
    }
  };
  const createLearningDeepTrainingContract = loadContractFactory();
  return {
    contract: createLearningDeepTrainingContract({ repository, dataPolicy, evidenceAdapter, promotionAdapter }),
    queries,
    evidenceCalls,
    rollbackCalls
  };
}

function assertReasonCode(code) {
  return error => Boolean(error && error.reasonCode === code);
}

test('preserves canonical signal order and ids without treating candidate_sent as success', async () => {
  const sent = learningSignal({ signal_id: 'learning-signal-sent', created_at: '2026-08-14T00:00:02.000Z' });
  const rejected = learningSignal({
    signal_id: 'learning-signal-rejected',
    signal_type: 'candidate_rejected',
    outbox_id: '',
    created_at: '2026-08-14T00:00:01.000Z',
    signal: {
      schemaVersion: 1,
      authority: 'LearningV4ImmutableFeedbackSignalSource',
      eventType: 'rejected',
      negativeEvidence: true,
      hasExplicitRejectionReason: true,
      metadata: { rawPrivateChatPersisted: false }
    }
  });
  const { contract, queries } = createSubject({ signals: [sent, rejected] });
  const projection = await contract.projectRelationship({
    scopeType: 'conversation',
    scopeId: 'conversation-1',
    contentBySignalId: {
      'learning-signal-sent': 'sent alice@example.com',
      'learning-signal-rejected': 'rejected alice@example.com'
    },
    approvedScoresBySignalId: {
      'learning-signal-sent': approvedScore({ scoreId: 'score-sent' }),
      'learning-signal-rejected': approvedScore({ scoreId: 'score-rejected', value: 0.1 })
    }
  });

  assert.deepEqual(queries, [{ scopeType: 'conversation', scopeId: 'conversation-1', learningLevel: 'L1', learningEligible: true }]);
  assert.deepEqual(projection.trajectory.map(step => step.signalId), ['learning-signal-sent', 'learning-signal-rejected']);
  assert.deepEqual(projection.trajectory[0].outcome, { status: 'sent', success: null, negativeEvidence: false });
  assert.deepEqual(projection.trajectory[1].outcome, { status: 'rejected', success: false, negativeEvidence: true });
  assert.equal('reward' in projection.trajectory[0], false);
  assert.equal(projection.trajectory[0].content, 'sent <EMAIL_ADDRESS>');
});

test('filters ineligible, do-not-learn and PII-denied evidence before the Deep Training boundary', async () => {
  const ineligible = learningSignal({ signal_id: 'learning-signal-ineligible', learning_eligible: 0 });
  const doNotLearn = learningSignal({
    signal_id: 'learning-signal-dnl',
    signal: { authority: 'LearningV4ImmutableFeedbackSignalSource', eventType: 'sent', doNotLearn: true, metadata: { rawPrivateChatPersisted: false } }
  });
  const piiDenied = learningSignal({ signal_id: 'learning-signal-pii' });
  const safe = learningSignal({ signal_id: 'learning-signal-safe' });
  const { contract } = createSubject({ signals: [ineligible, doNotLearn, piiDenied, safe] });
  const projection = await contract.projectRelationship({
    scopeType: 'conversation',
    scopeId: 'conversation-1',
    contentBySignalId: {
      'learning-signal-ineligible': 'raw-ineligible-secret',
      'learning-signal-dnl': 'raw-do-not-learn-secret',
      'learning-signal-pii': 'DENY raw-pii-secret',
      'learning-signal-safe': 'safe alice@example.com'
    },
    approvedScoresBySignalId: {
      'learning-signal-ineligible': approvedScore({ scoreId: 'score-ineligible' }),
      'learning-signal-dnl': approvedScore({ scoreId: 'score-dnl' }),
      'learning-signal-pii': approvedScore({ scoreId: 'score-pii' }),
      'learning-signal-safe': approvedScore({ scoreId: 'score-safe' })
    }
  });

  assert.deepEqual(projection.trajectory.map(step => step.signalId), ['learning-signal-safe']);
  assert.equal(projection.trajectory[0].content, 'safe <EMAIL_ADDRESS>');
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes('raw-ineligible-secret'), false);
  assert.equal(serialized.includes('raw-do-not-learn-secret'), false);
  assert.equal(serialized.includes('raw-pii-secret'), false);
});

test('fails closed when one projection batch mixes relationship scopes', async () => {
  const { contract } = createSubject({
    signals: [
      learningSignal({ signal_id: 'learning-signal-a' }),
      learningSignal({ signal_id: 'learning-signal-b', scope_id: 'conversation-2', conversation_id: 'conversation-2' })
    ]
  });
  await assert.rejects(
    contract.projectRelationship({
      scopeType: 'conversation',
      scopeId: 'conversation-1',
      approvedScoresBySignalId: {
        'learning-signal-a': approvedScore({ scoreId: 'score-a' }),
        'learning-signal-b': approvedScore({ scoreId: 'score-b' })
      }
    }),
    assertReasonCode('LEARNING_DEEP_TRAINING_MIXED_RELATIONSHIP_BATCH')
  );
});

test('denies global aggregation by default and accepts only explicit canonical Learning eligibility', async () => {
  const globalSignal = learningSignal({
    signal_id: 'learning-signal-global',
    scope_type: 'global',
    scope_id: 'global-learning-v1',
    conversation_id: ''
  });
  const { contract } = createSubject({ signals: [globalSignal] });

  await assert.rejects(
    contract.projectGlobal({
      scopeType: 'global',
      scopeId: 'global-learning-v1',
      approvedScoresBySignalId: { 'learning-signal-global': approvedScore({ scoreId: 'score-global' }) }
    }),
    assertReasonCode('LEARNING_DEEP_TRAINING_GLOBAL_ELIGIBILITY_REQUIRED')
  );

  const projection = await contract.projectGlobal({
    scopeType: 'global',
    scopeId: 'global-learning-v1',
    canonicalGlobalEligibility: {
      authority: 'Learning',
      eligible: true,
      scopeType: 'global',
      scopeId: 'global-learning-v1',
      evidenceId: 'learning-global-eligibility-1'
    },
    approvedScoresBySignalId: { 'learning-signal-global': approvedScore({ scoreId: 'score-global' }) }
  });
  assert.equal(projection.globalAggregation, true);
  assert.equal(projection.globalEligibilityEvidenceId, 'learning-global-eligibility-1');
});

test('requires a Learning-approved Langfuse score and never computes or normalizes reward', async () => {
  const { contract } = createSubject();
  await assert.rejects(
    contract.projectRelationship({ scopeType: 'conversation', scopeId: 'conversation-1' }),
    assertReasonCode('LEARNING_DEEP_TRAINING_APPROVED_SCORE_REQUIRED')
  );
  await assert.rejects(
    contract.projectRelationship({
      scopeType: 'conversation',
      scopeId: 'conversation-1',
      approvedScoresBySignalId: {
        'learning-signal-001': approvedScore({ authority: 'Yance', approvedByLearning: true })
      }
    }),
    assertReasonCode('LEARNING_DEEP_TRAINING_APPROVED_SCORE_REQUIRED')
  );
});

test('binds experiment evidence only through the existing Langfuse Dataset/Score seam', async () => {
  const { contract, evidenceCalls } = createSubject();
  const projection = await contract.projectRelationship({
    scopeType: 'conversation',
    scopeId: 'conversation-1',
    approvedScoresBySignalId: { 'learning-signal-001': approvedScore() }
  });
  const receipt = await contract.bindExperimentEvidence({
    projection,
    signalId: 'learning-signal-001',
    datasetName: 'learning-deep-training-v1'
  });
  assert.equal(receipt.authority, 'Langfuse Dataset + Score');
  assert.equal(evidenceCalls.length, 1);
  assert.equal(evidenceCalls[0].record.signalId, 'learning-signal-001');
});

test('rollback stays Learning-owned and requires explicit approval plus evidence', async () => {
  const { contract, rollbackCalls } = createSubject();
  const rollout = { kind: 'LEARNING_ROLLOUT', candidate: { id: 'candidate-1' } };
  await assert.rejects(
    contract.rollbackPromotion({ rollout, approved: false, evidence: { id: 'rollback-evidence-1' } }),
    assertReasonCode('LEARNING_DEEP_TRAINING_ROLLBACK_APPROVAL_REQUIRED')
  );
  await assert.rejects(
    contract.rollbackPromotion({ rollout, approved: true, evidence: {} }),
    assertReasonCode('LEARNING_DEEP_TRAINING_ROLLBACK_EVIDENCE_REQUIRED')
  );
  const receipt = await contract.rollbackPromotion({ rollout, approved: true, evidence: { id: 'rollback-evidence-1' } });
  assert.equal(receipt.kind, 'LEARNING_ROLLBACK');
  assert.equal(rollbackCalls.length, 1);
});

test('Langfuse adapter uses official Dataset and Score APIs for approved training evidence', async () => {
  const calls = [];
  const client = {
    dataset: {
      async create(input) { calls.push(['dataset.create', input]); return { id: 'dataset-1', name: input.name }; },
      async createItem(input) { calls.push(['dataset.createItem', input]); return { id: input.id }; }
    },
    score: {
      async create(input) { calls.push(['score.create', input]); return { id: 'score-remote-1' }; }
    }
  };
  const adapter = createLangfuseLearningEvidenceAdapter({ client, enabled: true });
  assert.equal(typeof adapter.bindTrainingEvidence, 'function');
  const receipt = await adapter.bindTrainingEvidence({
    datasetName: 'learning-deep-training-v1',
    record: {
      signalId: 'learning-signal-001',
      content: '<EMAIL_ADDRESS>',
      outcome: { status: 'sent', success: null, negativeEvidence: false },
      score: approvedScore()
    }
  });
  assert.equal(receipt.authority, 'Langfuse Dataset + Score');
  assert.deepEqual(calls.map(([name]) => name), ['dataset.create', 'dataset.createItem', 'score.create']);
});

test('Learning promotion adapter exposes symmetric rollback guarded by approval and evidence', async () => {
  const langfuseCalls = [];
  const adapter = createLearningPromotionAdapter({
    openFeature: { setEvaluationContext() {} },
    flagd: { mode: 'in-process-offline' },
    langfuse: { async recordRollback(input) { langfuseCalls.push(input); } }
  });
  assert.equal(typeof adapter.rollback, 'function');
  await assert.rejects(adapter.rollback({ kind: 'LEARNING_ROLLOUT' }, { approved: false, evidence: { id: 'e-1' } }), assertReasonCode('LEARNING_ROLLBACK_APPROVAL_REQUIRED'));
  await assert.rejects(adapter.rollback({ kind: 'LEARNING_ROLLOUT' }, { approved: true, evidence: {} }), assertReasonCode('LEARNING_ROLLBACK_EVIDENCE_REQUIRED'));
  const receipt = await adapter.rollback({ kind: 'LEARNING_ROLLOUT', candidate: { id: 'candidate-1' } }, { approved: true, evidence: { id: 'e-1' } });
  assert.equal(receipt.kind, 'LEARNING_ROLLBACK');
  assert.equal(receipt.automaticPromotion, false);
  assert.equal(langfuseCalls.length, 1);
});
