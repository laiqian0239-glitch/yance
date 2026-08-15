'use strict';

const { canonicalHash } = require('./canonicalSerialization');
const eventBus = require('./eventBus');
const personContextAuthority = require('./personContextAuthority').singleton;
const { singleton: platformCoreRepository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'LearningOutcomeAttribution';
const RAW_SIGNAL_TYPE = 'policy_outcome_observed';

function clean(value) { return String(value == null ? '' : value).trim(); }
function attributionError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message || reasonCode), { reasonCode, code: reasonCode, ...details });
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
function timestamp(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}
function unique(values = []) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))]; }

function normalizeOutcomes(values = []) {
  if (!Array.isArray(values)) throw attributionError('LEARNING_POLICY_OUTCOMES_INVALID', 'outcomes must be an array.');
  const seen = new Set();
  const rows = values.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw attributionError('LEARNING_POLICY_OUTCOME_INVALID', `Outcome ${index} must be an object.`);
    }
    const outcomeId = clean(row.outcomeId);
    const type = clean(row.type);
    const evidenceRef = clean(row.evidenceRef);
    if (!outcomeId || !type || !evidenceRef || seen.has(outcomeId)) {
      throw attributionError('LEARNING_POLICY_OUTCOME_PROVENANCE_REQUIRED', 'Each outcome requires a unique outcomeId, type and evidenceRef.');
    }
    seen.add(outcomeId);
    const value = row.value;
    if (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value)) && value !== null) {
      throw attributionError('LEARNING_POLICY_OUTCOME_VALUE_INVALID', 'Outcome values must be finite numbers, booleans or null.');
    }
    return deepFreeze({ outcomeId, type, value, evidenceRef });
  });
  return deepFreeze(rows);
}

function createLearningOutcomeAttributionService(options = {}) {
  const repository = options.repository || platformCoreRepository;
  const identityAuthority = options.personContextAuthority || personContextAuthority;
  const bus = options.eventBus || eventBus;
  let started = false;
  let listener = null;

  function createOutcomeVector(input = {}) {
    const decisionId = clean(input.decisionId);
    if (!decisionId) throw attributionError('LEARNING_POLICY_DECISION_ID_REQUIRED', 'OutcomeVector requires decisionId.');
    const observedAt = timestamp(input.observedAt) || clean(input.observedAt);
    if (!observedAt) throw attributionError('LEARNING_POLICY_OUTCOME_OBSERVED_AT_REQUIRED', 'OutcomeVector requires observedAt.');
    const outcomes = normalizeOutcomes(input.outcomes || []);
    const sourceSignalId = clean(input.sourceSignalId);
    const contactId = clean(input.contactId);
    const conversationId = clean(input.conversationId);
    const personId = clean(input.personId);
    const observationWindow = input.observationWindow && typeof input.observationWindow === 'object'
      ? deepFreeze({ start: timestamp(input.observationWindow.start) || clean(input.observationWindow.start), end: timestamp(input.observationWindow.end) || clean(input.observationWindow.end) })
      : undefined;
    const signals = input.signals && typeof input.signals === 'object' && !Array.isArray(input.signals)
      ? deepFreeze(JSON.parse(JSON.stringify(input.signals)))
      : undefined;
    const outcomeId = clean(input.outcomeId) || `outcome:${canonicalHash({ decisionId, sourceSignalId, observedAt, outcomes, signals: signals || null })}`;
    const vector = {
      schemaVersion: 1,
      authority: AUTHORITY,
      signalType: RAW_SIGNAL_TYPE,
      outcomeId,
      decisionId,
      sourceSignalId,
      scopeType: conversationId ? 'conversation' : clean(input.scopeType) || 'conversation',
      scopeId: conversationId || clean(input.scopeId),
      contactId,
      personId,
      conversationId,
      observedAt,
      outcomes,
      learningEligible: false,
      rawPrivateChatPersisted: false
    };
    if (observationWindow) vector.observationWindow = observationWindow;
    if (signals) vector.signals = signals;
    return deepFreeze(vector);
  }

  function bindTrainableOutcome(input = {}) {
    const source = input.eligibleSourceSignal || {};
    const vector = input.outcomeVector || {};
    const score = input.score || {};
    const sourceSignalId = clean(source.signal_id || source.signalId);
    const sourceDecisionId = clean(source.signal?.decisionRecord?.decisionId);
    if (
      !sourceSignalId || clean(source.signal_type || source.signalType) !== 'candidate_sent' ||
      !(source.learning_eligible === true || source.learning_eligible === 1 || source.learningEligible === true) ||
      !sourceDecisionId
    ) {
      throw attributionError('LEARNING_POLICY_ELIGIBLE_SOURCE_SIGNAL_REQUIRED', 'A learning-eligible immutable candidate_sent source signal is required.');
    }
    if (vector.signalType !== RAW_SIGNAL_TYPE || vector.learningEligible !== false || clean(vector.decisionId) !== sourceDecisionId) {
      throw attributionError('LEARNING_POLICY_OUTCOME_DECISION_BINDING_MISMATCH', 'Raw outcome must remain false-eligible and bind the source DecisionRecord.');
    }
    const scoreSourceId = clean(score.eligibleSourceSignalId || score.sourceSignalId);
    const outcomeIds = unique((vector.outcomes || []).map(row => row.outcomeId));
    const scoreOutcomeIds = unique(score.outcomeIds);
    const exactOutcomeSet = outcomeIds.length === scoreOutcomeIds.length && outcomeIds.every(id => scoreOutcomeIds.includes(id));
    if (
      score.authority !== 'Langfuse' || score.approvedByLearning !== true || !clean(score.scoreId) ||
      scoreSourceId !== sourceSignalId || clean(score.decisionId) !== sourceDecisionId ||
      !exactOutcomeSet || !clean(score.outcomeEvidenceSetRef) || !clean(score.rewardPolicyVersion) ||
      !Number.isFinite(Number(score.value))
    ) {
      throw attributionError('LEARNING_POLICY_APPROVED_SCORE_BINDING_REQUIRED', 'Learning-approved Langfuse Score must bind the exact source/decision/outcome evidence set.');
    }
    return deepFreeze({
      eligibleSourceSignalId: sourceSignalId,
      sourceSignalId,
      decisionId: sourceDecisionId,
      outcomeIds,
      outcomeEvidenceSetRef: clean(score.outcomeEvidenceSetRef),
      rewardPolicyVersion: clean(score.rewardPolicyVersion),
      outcomeVector: vector,
      reward: deepFreeze({
        authority: 'Langfuse',
        scoreId: clean(score.scoreId),
        value: Number(score.value),
        approvedByLearning: true
      })
    });
  }

  function eligibleSentSources(conversationId) {
    if (!repository || typeof repository.listLearningSignals !== 'function') return [];
    const rows = repository.listLearningSignals({
      scopeType: 'conversation', scopeId: conversationId, learningLevel: 'L1', learningEligible: true
    });
    return (Array.isArray(rows) ? rows : []).filter(row =>
      clean(row.signal_type || row.signalType) === 'candidate_sent' && row.signal?.decisionRecord?.decisionId
    );
  }

  function resolveInboundAttribution(message = {}) {
    const conversationId = clean(message.conversationId || message.sessionKey);
    const contactId = clean(message.contactId);
    const inboundId = clean(message.externalMessageId || message.messageId || message.id);
    const observedAt = timestamp(message.sentAt || message.timestamp || message.createdAt);
    if (!conversationId || !contactId || !inboundId || !observedAt) return null;
    const direction = clean(message.direction).toLowerCase();
    if (message.fromMe === true || ['outbound', 'outgoing'].includes(direction)) return null;

    const identity = identityAuthority.resolve({ contactId, conversationId });
    if (identity?.authority !== 'PersonContextAuthority' || identity?.found !== true || !clean(identity.personId)) {
      throw attributionError('LEARNING_POLICY_OUTCOME_IDENTITY_REQUIRED', 'Inbound attribution requires canonical PersonContextAuthority identity.');
    }
    const personId = clean(identity.personId);
    const candidates = eligibleSentSources(conversationId).filter(row => {
      const decision = row.signal?.decisionRecord || {};
      const sentAt = timestamp(row.created_at || row.createdAt);
      return sentAt && sentAt < observedAt
        && clean(decision.contactId) === contactId
        && clean(decision.conversationId) === conversationId
        && clean(decision.personId) === personId;
    }).sort((a, b) => timestamp(b.created_at || b.createdAt).localeCompare(timestamp(a.created_at || a.createdAt)));
    if (!candidates.length) return null;
    const latestAt = timestamp(candidates[0].created_at || candidates[0].createdAt);
    const latest = candidates.filter(row => timestamp(row.created_at || row.createdAt) === latestAt);
    if (latest.length !== 1) {
      throw attributionError('LEARNING_POLICY_OUTCOME_ATTRIBUTION_AMBIGUOUS', 'Inbound outcome matches more than one latest eligible decision.', { conversationId, contactId, inboundId });
    }
    return { source: latest[0], identity, inboundId, observedAt };
  }

  function persistInboundOutcome(message = {}) {
    const match = resolveInboundAttribution(message);
    if (!match) return { skipped: true, reasonCode: 'NO_ELIGIBLE_SENT_DECISION' };
    const source = match.source;
    const decision = source.signal.decisionRecord;
    const sourceSignalId = clean(source.signal_id || source.signalId);
    const sentAt = timestamp(source.created_at || source.createdAt);
    const latencyMs = Math.max(0, Date.parse(match.observedAt) - Date.parse(sentAt));
    const messagePairRef = canonicalHash({ sourceSignalId, inboundMessageId: match.inboundId, sentAt, observedAt: match.observedAt });
    const inboundEvidenceRef = canonicalHash({ inboundMessageId: match.inboundId, conversationId: decision.conversationId, contactId: decision.contactId, observedAt: match.observedAt });
    const nextDayWindowEnd = new Date(Date.parse(match.observedAt) + 24 * 60 * 60 * 1000).toISOString();
    const outcomeId = `outcome:${canonicalHash({ decisionId: decision.decisionId, sourceSignalId, inboundMessageId: match.inboundId })}`;
    const vector = createOutcomeVector({
      outcomeId,
      decisionId: decision.decisionId,
      sourceSignalId,
      contactId: decision.contactId,
      personId: decision.personId,
      conversationId: decision.conversationId,
      observedAt: match.observedAt,
      observationWindow: { start: sentAt, end: match.observedAt },
      outcomes: [
        { outcomeId: `${outcomeId}:reply`, type: 'reply_received', value: 1, evidenceRef: inboundEvidenceRef },
        { outcomeId: `${outcomeId}:continued`, type: 'conversation_continued', value: 1, evidenceRef: messagePairRef }
      ],
      signals: {
        replyLatencyMs: { value: latencyMs, status: 'observed', observedAt: match.observedAt, windowStart: sentAt, windowEnd: match.observedAt, sourceType: 'message-pair', sourceId: `${sourceSignalId}:${match.inboundId}`, provenanceRef: messagePairRef },
        conversationContinued: { value: true, status: 'observed', observedAt: match.observedAt, windowStart: sentAt, windowEnd: match.observedAt, sourceType: 'inbound-message', sourceId: match.inboundId, provenanceRef: inboundEvidenceRef },
        nextDayReinitiation: { value: null, status: 'pending', observedAt: '', windowStart: match.observedAt, windowEnd: nextDayWindowEnd, sourceType: 'conversation-window', sourceId: decision.conversationId, provenanceRef: '' }
      }
    });
    if (!repository || typeof repository.insertLearningSignal !== 'function') {
      return { skipped: true, reasonCode: 'LEARNING_SIGNAL_LEDGER_UNAVAILABLE', outcomeVector: vector };
    }
    const idempotencyKey = `policy-outcome:${decision.decisionId}:${sourceSignalId}:${match.inboundId}`;
    const persisted = repository.insertLearningSignal({
      signalId: `learning-signal-${canonicalHash({ idempotencyKey }).slice(0, 24)}`,
      idempotencyKey,
      learningLevel: 'L1',
      scopeType: 'conversation',
      scopeId: decision.conversationId,
      contactId: decision.contactId,
      conversationId: decision.conversationId,
      candidateId: clean(source.candidate_id || source.candidateId),
      outboxId: clean(source.outbox_id || source.outboxId),
      signalType: RAW_SIGNAL_TYPE,
      signal: vector,
      qualityTier: clean(source.quality_tier || source.qualityTier),
      emergencyMode: false,
      learningEligible: false,
      createdAt: match.observedAt
    });
    return { skipped: false, persisted, outcomeVector: vector };
  }

  function start() {
    if (started) return status();
    listener = event => {
      Promise.resolve().then(() => persistInboundOutcome(event?.payload?.message || {})).catch(error => {
        bus.publish('learning-policy:outcome-attribution-failed', {
          reasonCode: clean(error.reasonCode || error.code) || 'LEARNING_POLICY_OUTCOME_ATTRIBUTION_FAILED',
          message: clean(error.message),
          conversationId: clean(event?.payload?.message?.conversationId || event?.payload?.message?.sessionKey),
          contactId: clean(event?.payload?.message?.contactId)
        });
      });
    };
    bus.on('message:inserted', listener);
    started = true;
    return status();
  }

  function stop() {
    if (listener) bus.off('message:inserted', listener);
    listener = null;
    started = false;
    return { stopped: true };
  }
  function status() { return Object.freeze({ started, authority: AUTHORITY, signalType: RAW_SIGNAL_TYPE, rawOutcomeLearningEligible: false }); }

  return Object.freeze({ createOutcomeVector, bindTrainableOutcome, resolveInboundAttribution, persistInboundOutcome, start, stop, status });
}

const singleton = createLearningOutcomeAttributionService();
module.exports = { AUTHORITY, RAW_SIGNAL_TYPE, createLearningOutcomeAttributionService, singleton };
