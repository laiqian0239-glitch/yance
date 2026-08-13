'use strict';

const crypto = require('node:crypto');

let started = false;

const AUTHORITY = 'LearningV4ImmutableFeedbackSignalSource';
function clean(value) { return String(value == null ? '' : value).trim(); }
function isLearningDisabled(value) { return ['send_only', 'exception', 'do_not_learn'].includes(clean(value).toLowerCase()); }
function signalId(idempotencyKey) { return 'learning-signal-' + crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24); }

function normalizeAdjustments(metadata = {}, styleVariant = '') {
  const values = new Set();
  const branch = metadata.candidateStrategyBranch && typeof metadata.candidateStrategyBranch === 'object' ? metadata.candidateStrategyBranch : {};
  for (const value of [...(Array.isArray(branch.adjustments) ? branch.adjustments : []), ...(Array.isArray(metadata.adjustments) ? metadata.adjustments : [])]) {
    if (clean(value)) values.add(clean(value));
  }
  const text = clean(styleVariant).toLowerCase();
  const mappings = [[/短|short/u,'shorter'],[/直接|direct/u,'direct'],[/自然|natural/u,'natural'],[/温柔|gentle|warm/u,'gentle'],[/暧昧|flirt/u,'flirtier'],[/不提问|no[_ -]?question/u,'no_question']];
  for (const [pattern, tag] of mappings) if (pattern.test(text)) values.add(tag);
  return [...values];
}

function buildImmutableFeedbackSignal(input = {}) {
  const eventType = clean(input.eventType) || 'sent';
  const learningMode = clean(input.learningMode || 'send_and_learn').toLowerCase();
  if (isLearningDisabled(learningMode)) return Object.freeze({ skipped: true, reasonCode: learningMode === 'do_not_learn' ? 'DO_NOT_LEARN' : 'LEARNING_MODE_DISABLED' });
  const metadata = input.generationMetadata && typeof input.generationMetadata === 'object' ? input.generationMetadata : {};
  const route = input.qualityRouteReceipt || metadata.qualityRouteReceipt || {};
  const receipt = input.personaTruthReceipt || metadata.personaTruthReceipt || {};
  const emergencyMode = input.emergencyMode === true || metadata.emergencyMode === true || route.emergencyMode === true;
  const truthEligible = receipt.pass === true;
  const learningEligible = input.learningEligible !== false && metadata.learningEligible !== false && route.learningEligible !== false && truthEligible && !emergencyMode;
  const candidateId = clean(input.candidateId);
  const outboxId = clean(input.outboxId);
  const conversationId = clean(input.conversationId);
  const evidenceKey = clean(input.evidenceId) || (eventType === 'sent' ? outboxId : candidateId);
  const idempotencyKey = 'reply-feedback:' + eventType + ':' + evidenceKey;
  const branch = input.candidateStrategyBranch || metadata.candidateStrategyBranch || {};
  return Object.freeze({
    skipped: false,
    signalId: signalId(idempotencyKey),
    idempotencyKey,
    learningLevel: 'L1',
    scopeType: 'conversation',
    scopeId: conversationId,
    contactId: clean(input.contactId),
    conversationId,
    candidateId,
    outboxId,
    signalType: eventType === 'rejected' ? 'candidate_rejected' : 'candidate_sent',
    qualityTier: clean(input.qualityTier || metadata.qualityTier || route.qualityTier),
    emergencyMode,
    learningEligible,
    createdAt: clean(input.observedAt) || new Date().toISOString(),
    signal: Object.freeze({
      schemaVersion: 1,
      authority: AUTHORITY,
      eventType,
      negativeEvidence: eventType === 'rejected',
      hasExplicitRejectionReason: input.hasExplicitRejectionReason === true,
      adjustments: normalizeAdjustments(metadata, input.styleVariant),
      strategyBranch: clean(metadata.candidateStrategyBranchId || branch.strategy),
      metadata: Object.freeze({
        source: clean(input.source) || 'reply-outcome-transaction',
        replyTask: clean(input.replyTask || metadata.replyTask),
        styleVariant: clean(input.styleVariant || metadata.styleVariant),
        targetLanguage: clean(input.targetLanguage || metadata.targetLanguageCode || metadata.targetLanguage),
        modelId: clean(input.modelId || metadata.modelId),
        model: clean(input.model || metadata.model),
        directorStrategyId: clean(metadata.directorStrategy?.strategyId),
        candidatePlanId: clean(metadata.candidatePlan?.planId),
        candidateAxisId: clean(metadata.candidateAxisId || branch.axisId),
        personaTruthReceiptPass: truthEligible,
        personaTruthReceiptSha256: clean(receipt.receiptSha256),
        rawPrivateChatPersisted: false,
        automaticProfileMutation: false
      })
    })
  });
}

function persistImmutableLearningSignal(transaction, input = {}) {
  const row = input && input.signalId ? input : buildImmutableFeedbackSignal(input);
  if (!row || row.skipped) return row || { skipped: true, reasonCode: 'NO_SIGNAL' };
  const db = transaction?.db;
  if (!db || typeof db.prepare !== 'function') return { skipped: true, reasonCode: 'LEARNING_SIGNAL_LEDGER_UNAVAILABLE' };
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='learning_signal_ledger'").get();
  if (!table) return { skipped: true, reasonCode: 'LEARNING_SIGNAL_LEDGER_UNAVAILABLE' };
  db.prepare(`INSERT INTO learning_signal_ledger(
    signal_id,idempotency_key,learning_level,scope_type,scope_id,contact_id,conversation_id,candidate_id,outbox_id,
    signal_type,signal_json,quality_tier,emergency_mode,learning_eligible,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`).run(
    row.signalId,row.idempotencyKey,row.learningLevel,row.scopeType,row.scopeId,row.contactId,row.conversationId,row.candidateId,row.outboxId,
    row.signalType,JSON.stringify(row.signal),row.qualityTier,row.emergencyMode?1:0,row.learningEligible?1:0,row.createdAt
  );
  return { ...row, persisted: true, profileChanged: false };
}

function start(options = {}) {
  if (!options.storeManager?.dispatch) throw new TypeError('storeManager is required');
  started = true;
  return status();
}
function stop() { started = false; return { stopped: true, pending: 0 }; }
async function waitForIdle() { return { idle: true, pending: 0, transactionBound: true }; }
function status() {
  return Object.freeze({
    started,
    authority: AUTHORITY,
    mode: 'transaction-bound-immutable-signal-ledger',
    automaticProfileMutation: false,
    customProjectionScheduler: false,
    customRetryQueue: false,
    rawPrivateChatTraining: false,
    doNotLearnEnforcedBeforePersistence: true,
    supportedLearningModes: ['send_and_learn','send_only','exception','do_not_learn']
  });
}

module.exports = { AUTHORITY, start, stop, status, waitForIdle, isLearningDisabled, normalizeAdjustments, buildImmutableFeedbackSignal, persistImmutableLearningSignal };
