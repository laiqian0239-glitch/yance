'use strict';

const logger = require('./logger');
const personaBrainModule = require('../personaBrain');
const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');
const { inferFeedbackSignals } = require('../store/social/replyFeedbackLearningEngine');
const replyLearningScopeAuthority = require('./replyLearningScopeAuthority');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { LearningPreferenceAuthority } = require('./learningPreferenceAuthority');
const { ReplyLearningProjectionRepository } = require('../repositories/replyLearningProjectionRepository');
const { executeWithDeadline } = require('./executionDeadline');

let started = false;
let unsubscribe = null;
const runningTasks = new Set();
const scopeTails = new Map();
let retryTimer = null;
let runtime = null;
let serviceController = null;
const learningAuthorities = new WeakMap();

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function isLearningDisabled(value) {
  return ['send_only', 'exception', 'do_not_learn'].includes(clean(value).toLowerCase());
}

function tableExists(store, tableName) {
  try {
    return Boolean(store?.db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(clean(tableName)));
  } catch (_) {
    return false;
  }
}

function learningAuthorityFor(repository) {
  if (!repository || typeof repository !== 'object') return null;
  if (learningAuthorities.has(repository)) return learningAuthorities.get(repository);
  if (!tableExists(repository.store, 'learning_signal_ledger')) {
    learningAuthorities.set(repository, null);
    return null;
  }
  const coreRepository = createPlatformCoreRepository({ storeProvider: () => repository.store });
  const authority = new LearningPreferenceAuthority({ repository: coreRepository });
  learningAuthorities.set(repository, authority);
  return authority;
}

function normalizeAdjustments(metadata = {}, styleVariant = '') {
  const values = new Set();
  const branch = metadata.candidateStrategyBranch && typeof metadata.candidateStrategyBranch === 'object'
    ? metadata.candidateStrategyBranch
    : {};
  for (const value of [...(Array.isArray(branch.adjustments) ? branch.adjustments : []), ...(Array.isArray(metadata.adjustments) ? metadata.adjustments : [])]) {
    if (clean(value)) values.add(clean(value));
  }
  const text = clean(styleVariant).toLowerCase();
  const mappings = [
    [/短|short/u, 'shorter'], [/直接|direct/u, 'direct'], [/自然|natural/u, 'natural'],
    [/温柔|gentle|warm/u, 'gentle'], [/妩媚|女人味|feminine/u, 'feminine'], [/暧昧|flirt/u, 'flirtier'],
    [/不提问|no[_ -]?question/u, 'no_question'], [/换话题|topic[_ -]?pivot/u, 'topic_pivot'],
    [/降温|cool/u, 'cooler'], [/强势|strong/u, 'stronger'], [/害羞|shy/u, 'shy']
  ];
  for (const [pattern, tag] of mappings) if (pattern.test(text)) values.add(tag);
  return [...values];
}

function attachProvisionalCandidateInteractions(repository, feedbackPayload = {}) {
  if (!repository?.store || clean(feedbackPayload.eventType) !== 'sent' || !clean(feedbackPayload.candidateId)) return feedbackPayload;
  try {
    const coreRepository = createPlatformCoreRepository({ storeProvider: () => repository.store });
    const rows = coreRepository.listCandidateLearningSignals({ candidateId: feedbackPayload.candidateId, learningEligible: false });
    const pending = rows.filter(row => clean(row.signal?.exclusionReason) === 'PENDING_SUCCESSFUL_SEND');
    if (!pending.length) return feedbackPayload;
    const adjustments = new Set(Array.isArray(feedbackPayload.generationMetadata?.adjustments) ? feedbackPayload.generationMetadata.adjustments : []);
    for (const row of pending) for (const value of Array.isArray(row.signal?.adjustments) ? row.signal.adjustments : []) if (clean(value)) adjustments.add(clean(value));
    return {
      ...feedbackPayload,
      generationMetadata: {
        ...(feedbackPayload.generationMetadata || {}),
        adjustments: [...adjustments],
        provisionalInteractions: pending.map(row => ({
          signalId: clean(row.signal_id),
          signalType: clean(row.signal_type),
          interactionId: clean(row.signal?.metadata?.interactionId),
          adjustments: Array.isArray(row.signal?.adjustments) ? row.signal.adjustments : [],
          observedAt: clean(row.created_at)
        })),
        provisionalInteractionCount: pending.length,
        activatedOnlyAfterSuccessfulSend: true
      }
    };
  } catch (error) {
    logger.warn?.('Failed to attach provisional candidate interactions', { candidateId: clean(feedbackPayload.candidateId), error: clean(error?.message) });
    return feedbackPayload;
  }
}

function l1SignalFromFeedback(feedbackPayload = {}) {
  const metadata = feedbackPayload.generationMetadata || {};
  const route = metadata.qualityRouteReceipt || {};
  const personaTruthReceipt = metadata.personaTruthReceipt && typeof metadata.personaTruthReceipt === 'object' ? metadata.personaTruthReceipt : {};
  const truthEligible = personaTruthReceipt.pass === true;
  const branch = metadata.candidateStrategyBranch && typeof metadata.candidateStrategyBranch === 'object'
    ? metadata.candidateStrategyBranch
    : {};
  return {
    signalType: feedbackPayload.eventType === 'rejected' ? 'candidate_rejected' : 'candidate_sent',
    scopeType: 'conversation',
    scopeId: clean(feedbackPayload.conversationId),
    contactId: clean(feedbackPayload.contactId),
    conversationId: clean(feedbackPayload.conversationId),
    candidateId: clean(feedbackPayload.candidateId),
    outboxId: clean(feedbackPayload.outboxId),
    originalText: clean(feedbackPayload.originalText),
    finalText: clean(feedbackPayload.finalText),
    rejectionReason: clean(feedbackPayload.rejectionReason),
    adjustments: normalizeAdjustments(metadata, feedbackPayload.styleVariant),
    strategyBranch: clean(metadata.candidateStrategyBranchId || branch.strategy || metadata.director?.effective?.candidateStrategyBranch),
    qualityRouteReceipt: route,
    personaTruthReceipt,
    personaTruthRequired: true,
    qualityTier: clean(metadata.qualityTier || route.qualityTier),
    emergencyMode: metadata.emergencyMode === true || route.emergencyMode === true,
    learningEligible: metadata.learningEligible !== false && route.learningEligible !== false && truthEligible && !isLearningDisabled(feedbackPayload.learningMode),
    idempotencyKey: `round13:${clean(feedbackPayload.evidenceId)}`,
    observedAt: clean(feedbackPayload.observedAt),
    source: 'reply-feedback-learning-service',
    metadata: {
      replyTask: clean(feedbackPayload.replyTask),
      styleVariant: clean(feedbackPayload.styleVariant),
      directorStrategyId: clean(metadata.directorStrategy?.strategyId),
      candidatePlanId: clean(metadata.candidatePlan?.planId),
      candidateAxisId: clean(metadata.candidateAxisId || branch.axisId),
      highCapabilityPath: metadata.highCapabilityPath === true || route.highCapabilityPath === true,
      personaTruthReceiptPass: truthEligible,
      personaTruthReceiptSha256: clean(personaTruthReceipt.receiptSha256)
    }
  };
}

function snapshotForEvent(storeManager, event) {
  if (event.eventType === 'outbox.sent') {
    const outboxId = clean(event.payload?.outboxId || event.entityId);
    return storeManager.select(state => {
      const outbox = state.outbox.byId[outboxId] || null;
      const candidate = outbox ? state.aiBrain.candidatesById[outbox.candidateId] || null : null;
      return { eventType: 'sent', outbox, candidate };
    });
  }
  if (event.eventType === 'ai.replyCandidate.rejected') {
    const candidateId = clean(event.payload?.candidateId || event.entityId);
    return storeManager.select(state => ({
      eventType: 'rejected',
      outbox: null,
      candidate: state.aiBrain.candidatesById[candidateId] || null
    }));
  }
  return null;
}

function identityForSnapshot(storeManager, candidate, outbox, fallback = {}) {
  const contactId = clean(candidate?.contactId || outbox?.contactId || fallback.contactId);
  const conversationId = clean(candidate?.conversationId || outbox?.conversationId || fallback.conversationId);
  return storeManager.select(state => {
    const customer = state.customers.byId[contactId] || {};
    const conversation = state.conversations.byId[conversationId] || {};
    return {
      contactId,
      conversationId,
      platform: clean(outbox?.platform || fallback.platform || conversation.platform || customer.platform),
      sourceAccountId: clean(outbox?.accountId || fallback.sourceAccountId || conversation.accountId || customer.accountId),
      platformContactIdentity: clean(fallback.platformContactIdentity || customer.externalId || customer.phone || customer.platformContactIdentity),
      canonicalContactId: clean(fallback.canonicalContactId || customer.canonicalContactId || customer.customerProfileId || contactId)
    };
  });
}

function feedbackPayloadFromSnapshot(storeManager, snapshot, options = {}) {
  if (!snapshot?.candidate && !options.persisted) return null;
  const candidate = snapshot?.candidate || {};
  const outbox = snapshot?.outbox || {};
  const persisted = options.persisted || {};
  const eventType = clean(snapshot?.eventType || persisted.eventType || 'sent');
  const learningMode = clean(outbox?.metadata?.learningMode || persisted.learningMode || 'send_and_learn').toLowerCase();
  if (eventType === 'sent' && isLearningDisabled(learningMode)) return null;
  const identity = identityForSnapshot(storeManager, candidate, outbox, persisted);
  if (!identity.contactId) return null;
  const generationMetadata = {
    ...(candidate.generationMetadata || {}),
    ...(outbox?.metadata?.generationMetadata || {}),
    ...(persisted.generationMetadata || {})
  };
  const personaTruthReceipt = {
    ...(candidate.personaTruthReceipt || {}),
    ...(outbox?.personaTruthReceipt || {}),
    ...(outbox?.metadata?.personaTruthReceipt || {}),
    ...(persisted.personaTruthReceipt || {}),
    ...(generationMetadata.personaTruthReceipt || {})
  };
  if (Object.keys(personaTruthReceipt).length) generationMetadata.personaTruthReceipt = personaTruthReceipt;
  const director = {
    ...(candidate.director || {}),
    ...(outbox?.metadata?.director || {}),
    ...(persisted.director || {})
  };
  if (Object.keys(director).length) generationMetadata.director = director;
  const candidateId = clean(candidate.candidateId || persisted.candidateId);
  const outboxId = clean(outbox.id || persisted.outboxId);
  const evidenceId = eventType === 'sent' ? `sent:${outboxId}` : `rejected:${candidateId}`;
  return {
    evidenceId,
    eventType,
    candidateId,
    outboxId,
    contactId: identity.contactId,
    conversationId: identity.conversationId,
    personaProfileId: clean(candidate.personaProfileId || outbox.personaProfileId || persisted.personaProfileId) || 'owner',
    originalText: clean(candidate.originalText || outbox.originalText || persisted.originalText),
    finalText: eventType === 'sent' ? clean(outbox.text || candidate.text || persisted.finalText) : '',
    rejectionReason: eventType === 'rejected'
      ? clean(candidate.rejectionReason || options.rejectionReason || persisted.rejectionReason)
      : '',
    replyStrategy: candidate.replyStrategy || outbox?.metadata?.replyStrategy || persisted.replyStrategy || {},
    source: clean(outbox?.metadata?.replySource || candidate.source || persisted.source || 'local_model'),
    contextRevision: Number(outbox?.metadata?.conversationRevision || candidate.conversationRevision || persisted.contextRevision || 0),
    contextMessageIds: Array.isArray(outbox?.metadata?.contextMessageIds)
      ? outbox.metadata.contextMessageIds
      : (Array.isArray(candidate.contextMessageIds)
        ? candidate.contextMessageIds
        : (Array.isArray(persisted.contextMessageIds) ? persisted.contextMessageIds : [])),
    performanceMode: clean(outbox?.metadata?.performanceMode || candidate.performanceMode || persisted.performanceMode),
    platform: identity.platform,
    sourceAccountId: identity.sourceAccountId,
    platformContactIdentity: identity.platformContactIdentity,
    canonicalContactId: identity.canonicalContactId,
    learningMode,
    targetLanguage: clean(outbox?.metadata?.targetLanguage || candidate.targetLanguage || generationMetadata.targetLanguage || persisted.targetLanguage),
    translatedZh: clean(outbox?.metadata?.translatedZh || candidate.translatedZh || persisted.translatedZh),
    translationModel: clean(outbox?.metadata?.translationModel || candidate.translationModel || persisted.translationModel),
    modelId: clean(outbox?.metadata?.modelId || candidate.modelId || generationMetadata.modelId || persisted.modelId),
    model: clean(outbox?.metadata?.model || candidate.model || generationMetadata.model || persisted.model),
    replyTask: clean(outbox?.metadata?.replyTask || candidate.replyTask || generationMetadata.replyTask || persisted.replyTask),
    styleVariant: clean(outbox?.metadata?.styleVariant || generationMetadata.styleVariant || director.variant || persisted.styleVariant),
    generationMetadata,
    observedAt: clean(options.observedAt || persisted.observedAt)
  };
}

async function processProjectionJob(repository, projectionRepository, job, executionContext = null) {
  const feedbackPayload = job.payload || {};
  try {
    executionContext?.assertCurrent?.();
    let current = projectionRepository.heartbeat(job, { leaseMs: 60_000 });
    if (current.scopeState !== 'completed') {
      projectionRepository.applyEffectOnce(current, 'scope', () => replyLearningScopeAuthority.recordFeedback({
        ...feedbackPayload,
        signals: Array.isArray(feedbackPayload.signals) ? feedbackPayload.signals : inferFeedbackSignals(feedbackPayload)
      }, { store: repository.store }), executionContext);
      current = projectionRepository.get(current.jobId);
    }

    executionContext?.assertCurrent?.();
    current = projectionRepository.heartbeat(current, { leaseMs: 60_000 });
    const authority = learningAuthorityFor(repository);
    if (current.l1State !== 'completed' && current.l1State !== 'skipped') {
      if (authority && clean(feedbackPayload.conversationId)) {
        const effect = projectionRepository.applyEffectOnce(current, 'l1', () => authority.recordSignal(l1SignalFromFeedback(feedbackPayload)), executionContext);
        const l1Learning = effect.result || {};
        current = projectionRepository.get(current.jobId);
        if (runtime && !effect.replay) {
          runtime.l1Signals = Number(runtime.l1Signals || 0) + (l1Learning.idempotentReplay ? 0 : 1);
          runtime.l1ProfileChanges = Number(runtime.l1ProfileChanges || 0) + (l1Learning.profileChanged ? 1 : 0);
          runtime.l1EmergencyExcluded = Number(runtime.l1EmergencyExcluded || 0)
            + (l1Learning.excludedReason === 'EMERGENCY_RESULT_NOT_LEARNING_ELIGIBLE' ? 1 : 0);
          runtime.l1PersonaTruthExcluded = Number(runtime.l1PersonaTruthExcluded || 0)
            + (l1Learning.excludedReason === 'PERSONA_TRUTH_RECEIPT_NOT_LEARNING_ELIGIBLE' ? 1 : 0);
        }
      } else {
        current = projectionRepository.markL1(current, 'skipped', executionContext);
      }
    }
    executionContext?.assertCurrent?.();
    projectionRepository.complete(current, executionContext);
    return { completed: true, evidenceId: clean(feedbackPayload.evidenceId), jobId: current.jobId };
  } catch (error) {
    projectionRepository.fail(job, error, { maxAttempts: 8 });
    throw error;
  }
}

async function drainProjectionJobs(repository, projectionRepository, options = {}) {
  if (!projectionRepository) return { scanned: 0, completed: 0, failed: 0, pending: 0, deadLetter: 0, hasMore: false };
  const maximum = Math.max(1, Math.min(100_000, Number(options.maximum || 5000)));
  const deadlineAt = Date.now() + Math.max(250, Number(options.timeBudgetMs || 30_000));
  let scanned = 0; let completed = 0; let failed = 0;
  while (scanned < maximum && Date.now() < deadlineAt) {
    options.executionContext?.assertCurrent?.();
    const job = projectionRepository.claimNext({ leaseMs: 60_000 });
    if (!job) break;
    scanned += 1;
    try {
      await processProjectionJob(repository, projectionRepository, job, options.executionContext);
      options.executionContext?.assertCurrent?.();
      completed += 1;
    }
    catch (error) {
      failed += 1;
      logger.warn('ai', 'reply-learning-projection-failed', { jobId: job.jobId, evidenceId: job.evidenceId, code: error.code || '', error: error.message });
    }
  }
  const ledger = projectionRepository.ledger();
  if (runtime) {
    runtime.pendingBacklog = ledger.executable;
    runtime.learningDeadLetter = ledger.deadLetter;
    runtime.learningOldestPendingAt = ledger.oldestUnresolvedAt;
  }
  return {
    scanned, completed, failed,
    pending: ledger.unresolved,
    ready: ledger.ready,
    deferred: ledger.retryDeferred,
    active: ledger.active,
    deadLetter: ledger.deadLetter,
    hasReady: ledger.ready > 0,
    hasMore: ledger.unresolved > 0,
    budgetExhausted: ledger.ready > 0 && (scanned >= maximum || Date.now() >= deadlineAt),
    ledger
  };
}

async function recordFeedback(storeManager, repository, feedbackPayload, executionContext = null) {
  executionContext?.assertCurrent?.();
  if (!feedbackPayload) return { skipped: true };
  feedbackPayload = attachProvisionalCandidateInteractions(repository, feedbackPayload);
  const result = await storeManager.dispatch({
    type: 'AI_REPLY_FEEDBACK_RECORDED',
    source: 'reply-feedback-learning-service',
    payload: feedbackPayload
  }, { executionContext });
  executionContext?.assertCurrent?.();

  if (tableExists(repository.store, 'reply_learning_projection_jobs')) {
    const projectionRepository = runtime?.projectionRepository || new ReplyLearningProjectionRepository({ store: repository.store });
    const projection = await drainProjectionJobs(repository, projectionRepository, {
      maximum: 100,
      timeBudgetMs: 5_000,
      executionContext
    });
    return { ...result, projection };
  }

  // Compatibility for non-SQLite unit-test repositories only.
  replyLearningScopeAuthority.recordFeedback({ ...feedbackPayload, signals: inferFeedbackSignals(feedbackPayload) }, { store: repository.store });
  const authority = learningAuthorityFor(repository);
  const l1Learning = authority && clean(feedbackPayload.conversationId) ? authority.recordSignal(l1SignalFromFeedback(feedbackPayload)) : null;
  return { ...result, l1Learning, compatibilityProjection: true };
}

async function processEvent(storeManager, brain, repository, event, executionContext = null) {
  executionContext?.assertCurrent?.();
  const snapshot = snapshotForEvent(storeManager, event);
  if (!snapshot?.candidate) return { skipped: true, reason: 'candidate-unavailable' };
  const feedbackPayload = feedbackPayloadFromSnapshot(storeManager, snapshot, {
    observedAt: event.occurredAt,
    rejectionReason: event.payload?.rejectionReason
  });
  return recordFeedback(storeManager, repository, feedbackPayload, executionContext);
}

async function processPersistedSuccessfulSend(storeManager, repository, row, executionContext = null) {
  const feedbackPayload = feedbackPayloadFromSnapshot(storeManager, { eventType: 'sent' }, {
    persisted: row,
    observedAt: row.observedAt
  });
  return recordFeedback(storeManager, repository, feedbackPayload, executionContext);
}

async function processPersistedRejectedCandidate(storeManager, repository, row, executionContext = null) {
  const feedbackPayload = feedbackPayloadFromSnapshot(storeManager, { eventType: 'rejected' }, {
    persisted: row,
    observedAt: row.observedAt,
    rejectionReason: row.rejectionReason
  });
  return recordFeedback(storeManager, repository, feedbackPayload, executionContext);
}

function sourceDescriptor(row, sourceType) {
  const type = clean(sourceType);
  const entityId = type === 'sent' ? clean(row?.outboxId) : clean(row?.candidateId || row?.eventEntityId || row?.eventId);
  return { sourceType: type, sourceEntityId: entityId, sourceKey: `${type}:${entityId}` };
}

async function reconcileRows(rows, processor, storeManager, repository, projectionRepository, sourceType, executionContext = null) {
  let reconciled = 0;
  let skipped = 0;
  let failed = 0;
  let deadLetter = 0;
  for (const row of rows) {
    executionContext?.assertCurrent?.();
    const source = sourceDescriptor(row, sourceType);
    try {
      const result = await processor(storeManager, repository, row, executionContext);
      executionContext?.assertCurrent?.();
      if (result?.skipped) skipped += 1;
      else reconciled += 1;
      projectionRepository?.markSourceCompleted(source);
    } catch (error) {
      failed += 1;
      const failure = projectionRepository?.recordSourceFailure({ ...source, error }, { maxAttempts: 8 });
      if (failure?.deadLetter) deadLetter += 1;
      logger.warn('ai', 'reply-learning-source-reconcile-failed', {
        sourceKey: source.sourceKey, sourceType, code: error.code || '', error: error.message,
        attempts: failure?.attempts || 0, deadLetter: failure?.deadLetter === true
      });
    }
  }
  return { scanned: rows.length, reconciled, skipped, failed, deadLetter };
}

async function reconcilePendingSuccessfulSends(storeManager, repository, options = {}) {
  if (typeof repository?.listPendingSuccessfulSends !== 'function') return { scanned: 0, reconciled: 0, skipped: 0, failed: 0, pages: 0 };
  const pageSize = Math.max(1, Math.min(1000, Number(options.limit || 500)));
  const maximumPages = Math.max(1, Number(options.maximumPages || 20));
  const deadlineAt = Date.now() + Math.max(250, Number(options.sourceTimeBudgetMs || 30_000));
  const projectionRepository = options.projectionRepository || null;
  const total = { scanned: 0, reconciled: 0, skipped: 0, failed: 0, deadLetter: 0, pages: 0 };
  for (let page = 0; page < maximumPages && Date.now() < deadlineAt; page += 1) {
    options.executionContext?.assertCurrent?.();
    const rows = repository.listPendingSuccessfulSends({ limit: pageSize });
    if (!rows.length) break;
    const result = await reconcileRows(rows, processPersistedSuccessfulSend, storeManager, repository, projectionRepository, 'sent', options.executionContext);
    options.executionContext?.assertCurrent?.();
    for (const key of ['scanned','reconciled','skipped','failed','deadLetter']) total[key] += Number(result[key] || 0);
    total.pages += 1;
    if (rows.length < pageSize) break;
  }
  const pending = typeof repository.countPendingLearningSources === 'function'
    ? repository.countPendingLearningSources().successful : 0;
  return { ...total, pending, hasMore: pending > 0, budgetExhausted: pending > 0 && (total.pages >= maximumPages || Date.now() >= deadlineAt) };
}

async function reconcilePendingRejectedCandidates(storeManager, repository, options = {}) {
  if (typeof repository?.listPendingRejectedCandidates !== 'function') return { scanned: 0, reconciled: 0, skipped: 0, failed: 0, pages: 0 };
  const pageSize = Math.max(1, Math.min(1000, Number(options.limit || 500)));
  const maximumPages = Math.max(1, Number(options.maximumPages || 20));
  const deadlineAt = Date.now() + Math.max(250, Number(options.sourceTimeBudgetMs || 30_000));
  const projectionRepository = options.projectionRepository || null;
  const total = { scanned: 0, reconciled: 0, skipped: 0, failed: 0, deadLetter: 0, pages: 0 };
  for (let page = 0; page < maximumPages && Date.now() < deadlineAt; page += 1) {
    options.executionContext?.assertCurrent?.();
    const rows = repository.listPendingRejectedCandidates({ limit: pageSize });
    if (!rows.length) break;
    const result = await reconcileRows(rows, processPersistedRejectedCandidate, storeManager, repository, projectionRepository, 'rejected', options.executionContext);
    options.executionContext?.assertCurrent?.();
    for (const key of ['scanned','reconciled','skipped','failed','deadLetter']) total[key] += Number(result[key] || 0);
    total.pages += 1;
    if (rows.length < pageSize) break;
  }
  const pending = typeof repository.countPendingLearningSources === 'function'
    ? repository.countPendingLearningSources().rejected : 0;
  return { ...total, pending, hasMore: pending > 0, budgetExhausted: pending > 0 && (total.pages >= maximumPages || Date.now() >= deadlineAt) };
}

async function reconcilePendingFeedback(storeManager, repository, options = {}) {
  const projectionRepository = tableExists(repository.store, 'reply_learning_projection_jobs')
    ? (runtime?.projectionRepository || new ReplyLearningProjectionRepository({ store: repository.store }))
    : null;
  const sourceOptions = { ...options, projectionRepository };
  const successful = await reconcilePendingSuccessfulSends(storeManager, repository, sourceOptions);
  const rejected = await reconcilePendingRejectedCandidates(storeManager, repository, sourceOptions);
  const projection = await drainProjectionJobs(repository, projectionRepository, {
    maximum: options.maximumProjectionJobs || 10_000,
    timeBudgetMs: options.projectionTimeBudgetMs || 30_000,
    executionContext: options.executionContext
  });
  const sourcePending = typeof repository.countPendingLearningSources === 'function'
    ? repository.countPendingLearningSources() : { successful: 0, rejected: 0, total: 0 };
  const sourceLedger = projectionRepository?.sourceLedger() || { retryable: 0, deadLetter: 0 };
  const combined = projectionRepository?.writeLedgerSnapshot({
    sourcePending: sourcePending.total,
    source: sourceLedger,
    projection: projection.ledger,
    successful,
    rejected
  }) || null;
  const lastReconciledAt = new Date().toISOString();
  if (runtime) {
    runtime.reconciled += successful.reconciled + rejected.reconciled;
    runtime.successfulSendReconciled += successful.reconciled;
    runtime.rejectedCandidateReconciled += rejected.reconciled;
    runtime.reconciliationScanned += successful.scanned + rejected.scanned;
    runtime.lastReconciledAt = lastReconciledAt;
    runtime.pendingBacklog = Number(sourcePending.total || 0) + Number(projection.pending || 0);
    runtime.learningDeadLetter = Number(sourceLedger.deadLetter || 0) + Number(projection.deadLetter || 0);
    runtime.learningOldestPendingAt = clean(projection.ledger?.oldestUnresolvedAt || sourceLedger.oldestRetryAt);
  }
  return {
    scanned: successful.scanned + rejected.scanned,
    reconciled: successful.reconciled + rejected.reconciled,
    skipped: successful.skipped + rejected.skipped,
    failed: successful.failed + rejected.failed + projection.failed,
    successful, rejected, projection, sourcePending, sourceLedger, ledger: combined,
    hasMore: sourcePending.total > 0 || projection.pending > 0,
    lastReconciledAt
  };
}

function enqueue(work, context = {}) {
  const scopeKey = clean(context.scopeKey || context.entityId || context.eventType || 'global');
  const previous = scopeTails.get(scopeKey) || Promise.resolve();
  const timeoutMs = Math.max(1, Number(context.timeoutMs || 30_000));
  const serviceSignal = serviceController?.signal || null;
  const task = previous.catch(() => undefined).then(() => {
    const deadlineAt = Date.now() + timeoutMs;
    return executeWithDeadline(
      ({ signal, generation }) => {
        const executionContext = {
          signal,
          deadlineAt,
          logicalTaskId: clean(context.logicalTaskId || context.entityId || scopeKey),
          generation,
          assertCurrent() {
            if (signal.aborted || Date.now() >= deadlineAt) {
              throw Object.assign(new Error('Learning deadline exceeded'), {
                code: 'LEARNING_DEADLINE_EXCEEDED',
                logicalTaskId: this.logicalTaskId,
                generation
              });
            }
            if (typeof context.assertCurrent === 'function' && context.assertCurrent(executionContext) === false) {
              throw Object.assign(new Error('Learning generation is stale'), {
                code: 'LEARNING_STALE_GENERATION',
                logicalTaskId: this.logicalTaskId,
                generation
              });
            }
            return true;
          }
        };
        executionContext.assertCurrent();
        return work(executionContext);
      },
      {
        timeoutMs,
        signal: serviceSignal,
        generation: clean(context.generation),
        code: 'LEARNING_DEADLINE_EXCEEDED', operation: 'reply-learning', commandId: clean(context.entityId)
      }
    );
  });
  scopeTails.set(scopeKey, task);
  runningTasks.add(task);
  task.catch(error => {
    if (runtime) runtime.lastError = `${error.code || 'REPLY_FEEDBACK_LEARNING_FAILED'}: ${error.message}`;
    logger.warn('ai', 'reply-feedback-learning-failed', {
      eventType: context.eventType || '', entityId: context.entityId || '', code: error.code || '', error: error.message
    });
  }).finally(() => {
    runningTasks.delete(task);
    if (scopeTails.get(scopeKey) === task) scopeTails.delete(scopeKey);
  });
  return task;
}

function start(options = {}) {
  if (started) return status();
  const storeManager = options.storeManager;
  if (!storeManager?.onEvent || !storeManager?.dispatch) throw new TypeError('storeManager is required');
  const brain = options.personaBrain || personaBrainModule.createPersonaBrain();
  const repository = options.repository || new ReplyFeedbackRepository();
  serviceController = new AbortController();
  runtime = {
    storeManager,
    brain,
    repository,
    projectionRepository: tableExists(repository.store, 'reply_learning_projection_jobs') ? new ReplyLearningProjectionRepository({ store: repository.store }) : null,
    lastError: '',
    processed: 0,
    reconciled: 0,
    successfulSendReconciled: 0,
    rejectedCandidateReconciled: 0,
    reconciliationScanned: 0,
    pendingBacklog: 0,
    learningDeadLetter: 0,
    learningOldestPendingAt: '',
    lastReconciledAt: '',
    l1Signals: 0,
    l1ProfileChanges: 0,
    l1EmergencyExcluded: 0,
    l1PersonaTruthExcluded: 0
  };
  unsubscribe = storeManager.onEvent(event => {
    if (!['outbox.sent', 'ai.replyCandidate.rejected'].includes(event.eventType)) return;
    enqueue(async executionContext => {
      await processEvent(storeManager, brain, repository, event, executionContext);
      executionContext.assertCurrent();
      if (runtime) runtime.processed += 1;
    }, { eventType: event.eventType, entityId: event.entityId });
  });
  started = true;
  enqueue(executionContext => reconcilePendingFeedback(storeManager, repository, { executionContext }), { eventType: 'reply-feedback.reconcile', scopeKey: 'startup-reconcile', timeoutMs: 120_000 });
  retryTimer = setInterval(() => enqueue(executionContext => reconcilePendingFeedback(storeManager, repository, { executionContext }), { eventType: 'reply-feedback.periodic-reconcile', scopeKey: 'periodic-reconcile', timeoutMs: 120_000 }), 30_000);
  retryTimer.unref?.();
  return status();
}

async function waitForIdle(options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 150));
  const active = [...runningTasks];
  if (!active.length) return { idle: true, pending: 0 };
  const marker = Symbol('learning-wait-timeout');
  const result = await Promise.race([Promise.allSettled(active), new Promise(resolve => setTimeout(() => resolve(marker), timeoutMs))]);
  return { idle: result !== marker, pending: runningTasks.size, usedStableVersion: result === marker };
}

function stop() {
  try { unsubscribe?.(); } catch (_) {}
  unsubscribe = null;
  runtime = null;
  started = false;
  if (retryTimer) clearInterval(retryTimer); retryTimer = null;
  if (serviceController && !serviceController.signal.aborted) {
    serviceController.abort(Object.assign(new Error('Reply learning service stopped'), {
      code: 'LEARNING_SERVICE_STOPPED'
    }));
  }
  serviceController = null;
  if (!runningTasks.size) scopeTails.clear();
  return { stopped: true, pending: runningTasks.size };
}

function status() {
  return {
    started,
    processed: Number(runtime?.processed || 0),
    reconciled: Number(runtime?.reconciled || 0),
    successfulSendReconciled: Number(runtime?.successfulSendReconciled || 0),
    rejectedCandidateReconciled: Number(runtime?.rejectedCandidateReconciled || 0),
    reconciliationScanned: Number(runtime?.reconciliationScanned || 0),
    pendingBacklog: Number(runtime?.pendingBacklog || 0),
    deadLetterBacklog: Number(runtime?.learningDeadLetter || 0),
    oldestPendingAt: clean(runtime?.learningOldestPendingAt),
    lastReconciledAt: clean(runtime?.lastReconciledAt),
    lastError: clean(runtime?.lastError),
    l1Signals: Number(runtime?.l1Signals || 0),
    l1ProfileChanges: Number(runtime?.l1ProfileChanges || 0),
    l1EmergencyExcluded: Number(runtime?.l1EmergencyExcluded || 0),
    l1PersonaTruthExcluded: Number(runtime?.l1PersonaTruthExcluded || 0),
    learningAuthority: 'LearningPreferenceAuthority',
    learnsOnlyAfterSuccessfulSend: true,
    crashRecoveryReconciliation: true,
    rejectionRequiresExplicitReason: true,
    automaticModelWeightTraining: false,
    backgroundNonBlocking: true,
    supportedLearningModes: ['send_and_learn', 'send_only', 'exception']
  };
}

module.exports = {
  start,
  stop,
  status,
  waitForIdle,
  processEvent,
  processPersistedSuccessfulSend,
  processPersistedRejectedCandidate,
  reconcilePendingSuccessfulSends,
  reconcilePendingRejectedCandidates,
  reconcilePendingFeedback,
  feedbackPayloadFromSnapshot,
  snapshotForEvent,
  recordFeedback,
  learningAuthorityFor,
  l1SignalFromFeedback,
  attachProvisionalCandidateInteractions,
  normalizeAdjustments,
  drainProjectionJobs,
  processProjectionJob
  ,enqueue
};
