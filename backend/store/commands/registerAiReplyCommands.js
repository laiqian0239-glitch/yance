'use strict';

const { inferFeedbackSignals, applySignals, ENGINE_VERSION } = require('../social/replyFeedbackLearningEngine');
const replyLanguageAuthority = require('../../services/replyLanguageAuthority');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function requireUserApproval(command, fail) {
  if (command.payload.userApproved !== true) {
    fail('USER_APPROVAL_REQUIRED', 'AI candidate cannot enter Outbox without explicit user approval');
  }
  const approvedBy = clean(command.payload.approvedBy);
  if (!approvedBy) fail('APPROVER_REQUIRED', 'Explicit approver identity is required');
  return approvedBy;
}

function currentConversationRevision(state, conversationId) {
  const conversation = state.conversations.byId[clean(conversationId)] || {};
  return Number(conversation.version || 0);
}

function normalizeLearningMode(value) {
  const mode = clean(value).toLowerCase();
  if (['send_only', 'exception', 'do_not_learn'].includes(mode)) return mode;
  return 'send_and_learn';
}

function normalizeReplySource(value) {
  const source = clean(value).toLowerCase();
  return source || 'local_model';
}

function normalizeQuotedContext(value) {
  if (!value || typeof value !== 'object') return null;
  const key = value.key && typeof value.key === 'object' ? value.key : {};
  const id = clean(key.id || value.quotedMessageId || value.id);
  if (!id) return null;
  const remoteJid = clean(key.remoteJid || value.chatJid || value.remoteJid);
  const participant = clean(key.participant || value.quotedParticipant || value.participant);
  const normalized = {
    key: {
      id,
      fromMe: key.fromMe === true || value.quotedFromMe === true || value.fromMe === true
    }
  };
  if (remoteJid) normalized.key.remoteJid = remoteJid;
  if (participant) normalized.key.participant = participant;
  if (value.message && typeof value.message === 'object') normalized.message = value.message;
  else if (value.quotedMessage && typeof value.quotedMessage === 'object') normalized.message = value.quotedMessage;
  return normalized;
}

function currentEntityVersions(state, contactId) {
  const customer = state.customers.byId[contactId] || {};
  const relationship = state.relationships.byContactId[contactId] || {};
  const memory = state.memories.byContactId[contactId] || {};
  const policy = state.interactionPolicies.byContactId[contactId] || {};
  return {
    customer: Number(customer.version || 0),
    relationship: Number(relationship.version || 0),
    memory: Number(memory.version || 0),
    interactionPolicy: Number(policy.version || 0),
    routing: Number(state.meta?.domainVersions?.routing || 0)
  };
}

function assertSocialContextVersion(state, contactId, expected, fail, phase) {
  const current = currentEntityVersions(state, contactId);
  const keys = ['customer', 'relationship', 'memory', 'interactionPolicy', 'routing'];
  const changed = keys.filter(key => Number(expected?.[key] || 0) !== Number(current[key] || 0));
  if (changed.length) {
    fail('STALE_SOCIAL_CONTEXT', `Social context changed before ${phase || 'commit'}`, {
      contactId,
      phase: phase || 'commit',
      changed,
      expected: expected || {},
      current
    });
  }
  return current;
}

function registerAiReplyCommands(storeManager, options = {}) {
  const personaAuthority = options.personaAuthority || options.personaService || null;
  const resolvePersonaAtCommit = payload => {
    if (!personaAuthority || typeof personaAuthority.resolveEffective !== 'function') return null;
    return personaAuthority.resolveEffective({
      profileId: clean(payload.personaProfileId) || 'owner',
      contactId: clean(payload.personaScopeContactId || payload.contactId),
      conversationId: clean(payload.conversationId),
      candidateAdjustment: payload.personaCandidateAdjustment && typeof payload.personaCandidateAdjustment === 'object'
        ? payload.personaCandidateAdjustment
        : {}
    });
  };
  const assertRuntimeAtCommit = (payload, transaction) => {
    const expectedGeneration = Number(payload.expectedRuntimeGeneration || 0);
    const expectedFingerprint = clean(payload.expectedRuntimeFingerprint);
    if (!expectedGeneration && !expectedFingerprint) return null;
    const db = transaction?.db;
    const taskId = clean(payload.taskId);
    if (!db || !taskId) {
      throw Object.assign(new Error('Durable AI runtime authority is unavailable at candidate commit'), {
        code: 'AI_RUNTIME_AUTHORITY_UNAVAILABLE_AT_CANDIDATE_COMMIT', taskId
      });
    }
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='async_operation_state'").get();
    const current = table ? db.prepare(`SELECT state,generation,object_fingerprint FROM async_operation_state WHERE operation_id=?`).get(taskId) : null;
    if (!current || current.state !== 'RUNNING'
      || (expectedGeneration && Number(current.generation || 0) !== expectedGeneration)
      || (expectedFingerprint && clean(current.object_fingerprint) !== expectedFingerprint)) {
      throw Object.assign(new Error('AI runtime generation changed before candidate transaction commit'), {
        code: 'STALE_AI_RUNTIME_AT_CANDIDATE_COMMIT', taskId,
        expectedGeneration, actualGeneration: Number(current?.generation || 0),
        expectedFingerprint, actualFingerprint: clean(current?.object_fingerprint),
        actualState: clean(current?.state)
      });
    }
    return current;
  };
  const assertPersonaAtCommit = payload => {
    const current = resolvePersonaAtCommit(payload);
    if (!current) return null;
    const expectedProfileId = clean(payload.personaProfileId) || 'owner';
    const expectedVersion = Number(payload.personaVersionId || 0);
    const expectedHash = clean(payload.personaPolicyHash);
    const actualProfileId = clean(current.profileId) || 'owner';
    const actualVersion = Number(current.baseVersion || current.version?.version || 0);
    const actualHash = clean(current.effectivePolicyHash || current.version?.contentSha256);
    if (expectedProfileId !== actualProfileId || expectedVersion !== actualVersion || expectedHash !== actualHash) {
      const error = Object.assign(new Error('Persona changed before candidate transaction commit'), {
        code: 'STALE_PERSONA_PROFILE_AT_CANDIDATE_COMMIT',
        expectedProfileId, actualProfileId, expectedVersion, actualVersion, expectedHash, actualHash
      });
      throw error;
    }
    return current;
  };
  storeManager.registerCommand('AI_REPLY_TASK_STARTED', ({ command, state, cloneState, createId, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    const customer = state.customers.byId[contactId];
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Cannot start AI reply task without a customer', { contactId });
    if (customer.archived || customer.archivedAt) fail('ARCHIVED_CUSTOMER_READ_ONLY', 'Archived customer cannot enter AI reply routing', { contactId });
    // Relationship/interaction policy is advisory; the user remains the final decision-maker.
    const taskId = createId();
    const createdAt = now();
    const task = {
      taskId,
      contactId,
      conversationId: clean(command.payload.conversationId),
      conversationRevision: Number(command.payload.conversationRevision ?? currentConversationRevision(state, command.payload.conversationId)),
      performanceMode: clean(command.payload.performanceMode || 'balanced'),
      source: normalizeReplySource(command.payload.source),
      contextVersion: Number(command.payload.contextVersion || state.meta.stateVersion),
      entityVersions: { ...(command.payload.entityVersions || {}) },
      status: 'running',
      createdAt,
      updatedAt: createdAt,
      cancelReason: '',
      error: ''
    };
    const nextState = cloneState();
    nextState.aiBrain.tasksById[taskId] = task;
    return {
      nextState,
      changedDomains: ['aiBrain'],
      result: { taskId },
      events: {
        type: 'ai.replyTask.started',
        domain: 'aiBrain',
        entityId: taskId,
        changedPaths: [`aiBrain.tasksById.${taskId}`],
        payload: { taskId, contactId }
      },
      persist: transaction => {
        transaction?.upsertAiReplyTask?.(task);
        if (command.payload.socialContextSnapshot) {
          transaction?.insertAiContextSnapshot?.({
            taskId,
            contactId,
            conversationId: task.conversationId,
            stateVersion: task.contextVersion,
            entityVersions: task.entityVersions,
            context: command.payload.socialContextSnapshot,
            createdAt
          });
        }
      }
    };
  });

  storeManager.registerCommand('AI_REPLY_TASK_CANCELLED', ({ command, cloneState, now }) => {
    const taskId = clean(command.payload.taskId);
    const nextState = cloneState();
    const task = nextState.aiBrain.tasksById[taskId];
    if (!task || ['cancelled', 'committed', 'failed', 'rejected'].includes(task.status)) return { noop: true, result: { taskId } };
    task.status = command.payload.failed === true ? 'failed' : 'cancelled';
    task.cancelReason = clean(command.payload.reason) || 'CANCELLED';
    task.error = clean(command.payload.error);
    task.updatedAt = now();
    return {
      nextState,
      changedDomains: ['aiBrain'],
      result: { taskId },
      events: {
        type: task.status === 'failed' ? 'ai.replyTask.failed' : 'ai.replyTask.cancelled',
        domain: 'aiBrain',
        entityId: taskId,
        changedPaths: [`aiBrain.tasksById.${taskId}.status`],
        payload: { taskId, reason: task.cancelReason }
      },
      persist: transaction => transaction?.upsertAiReplyTask?.(task)
    };
  });

  storeManager.registerCommand('AI_REPLY_CANDIDATE_READY', ({ command, cloneState, createId, now, fail }) => {
    const taskId = clean(command.payload.taskId);
    const nextState = cloneState();
    const task = nextState.aiBrain.tasksById[taskId];
    if (!task) fail('AI_REPLY_TASK_NOT_FOUND', 'AI reply task does not exist', { taskId });
    if (task.status !== 'running') fail('AI_REPLY_TASK_NOT_RUNNING', 'AI reply task cannot accept a candidate', { taskId, status: task.status });
    const expectedRevision = Number(command.payload.expectedConversationRevision ?? command.payload.conversationRevision ?? task.conversationRevision ?? 0);
    const actualRevision = currentConversationRevision(nextState, task.conversationId);
    const expectedEntityVersions = { ...(command.payload.expectedEntityVersions || command.payload.entityVersions || task.entityVersions || {}) };
    const actualEntityVersions = currentEntityVersions(nextState, task.contactId);
    const changedEntities = Object.keys(expectedEntityVersions).filter(key => Number(expectedEntityVersions[key] || 0) !== Number(actualEntityVersions[key] || 0));
    if (expectedRevision !== actualRevision || changedEntities.length) {
      const updatedAt = now();
      task.status = 'cancelled';
      task.cancelReason = expectedRevision !== actualRevision ? 'STALE_CONVERSATION_REVISION_AT_CANDIDATE_COMMIT' : 'STALE_SOCIAL_CONTEXT_AT_CANDIDATE_COMMIT';
      task.error = task.cancelReason;
      task.updatedAt = updatedAt;
      return {
        nextState,
        changedDomains: ['aiBrain'],
        result: { taskId, stale: true, candidateId: '', reason: task.cancelReason, expectedRevision, actualRevision, changedEntities },
        events: {
          type: 'ai.replyTask.cancelled', domain: 'aiBrain', entityId: taskId,
          changedPaths: [`aiBrain.tasksById.${taskId}.status`],
          payload: { taskId, reason: task.cancelReason, expectedRevision, actualRevision, changedEntities }
        },
        persist: transaction => transaction?.upsertAiReplyTask?.(task)
      };
    }
    const text = clean(command.payload.text);
    if (!text) fail('EMPTY_AI_REPLY_CANDIDATE', 'AI candidate text is empty', { taskId });
    const candidateId = createId();
    const createdAt = now();
    const generationMetadata = { ...(command.payload.generationMetadata || {}) };
    const chineseUnderstanding = {
      sourceText: text,
      translatedZh: clean(command.payload.translatedZh),
      translationStatus: clean(command.payload.translationStatus),
      translationModel: clean(command.payload.translationModel),
      targetLanguage: clean(command.payload.targetLanguage)
    };
    const candidate = {
      candidateId,
      taskId,
      contactId: task.contactId,
      conversationId: task.conversationId,
      text,
      originalText: text,
      modelId: clean(command.payload.modelId),
      model: clean(command.payload.model),
      contextVersion: Number(command.payload.contextVersion || 0),
      conversationRevision: Number(command.payload.conversationRevision ?? task.conversationRevision ?? 0),
      contextMessageIds: Array.isArray(command.payload.contextMessageIds)
        ? command.payload.contextMessageIds.map(clean).filter(Boolean)
        : [],
      performanceMode: clean(command.payload.performanceMode || task.performanceMode || 'balanced'),
      source: normalizeReplySource(command.payload.source || task.source),
      entityVersions: { ...(command.payload.entityVersions || task.entityVersions || {}) },
      translatedZh: chineseUnderstanding.translatedZh,
      translationStatus: chineseUnderstanding.translationStatus,
      translationModel: chineseUnderstanding.translationModel,
      targetLanguage: chineseUnderstanding.targetLanguage,
      targetLanguageCode: clean(command.payload.targetLanguageCode || generationMetadata.targetLanguageCode),
      languageAuthority: { ...(command.payload.languageAuthority || generationMetadata.languageAuthority || {}) },
      languageValidation: { ...(command.payload.languageValidation || generationMetadata.languageValidation || {}) },
      replyTask: clean(command.payload.replyTask),
      director: { ...(command.payload.director || {}) },
      qualityRouteReceipt: { ...(command.payload.qualityRouteReceipt || generationMetadata.qualityRouteReceipt || {}) },
      qualityTier: clean(command.payload.qualityTier || generationMetadata.qualityTier),
      emergencyMode: command.payload.emergencyMode === true || generationMetadata.emergencyMode === true,
      learningEligible: command.payload.learningEligible !== false
        && generationMetadata.learningEligible !== false
        && command.payload.emergencyMode !== true
        && generationMetadata.emergencyMode !== true,
      highCapabilityPath: command.payload.highCapabilityPath === true || generationMetadata.highCapabilityPath === true,
      directorQualityRouteReceipt: { ...(command.payload.directorQualityRouteReceipt || generationMetadata.director?.qualityRouteReceipt || {}) },
      directorStrategy: { ...(command.payload.directorStrategy || generationMetadata.directorStrategy || {}) },
      candidatePlan: { ...(command.payload.candidatePlan || generationMetadata.candidatePlan || {}) },
      candidateStrategyBranch: command.payload.candidateStrategyBranch || generationMetadata.candidateStrategyBranch || null,
      memoryRecall: { ...(command.payload.memoryRecall || generationMetadata.memoryRecall || {}) },
      generationMetadata,
      replyStrategy: {
        ...(command.payload.replyStrategy || {}),
        _generation: generationMetadata,
        _chineseUnderstanding: chineseUnderstanding,
        _director: { ...(command.payload.director || {}) }
      },
      relationshipPotential: { ...(command.payload.relationshipPotential || {}) },
      personaProfileId: clean(command.payload.personaProfileId || 'owner'),
      personaVersionId: Number(command.payload.personaVersionId || 0),
      personaPolicyHash: clean(command.payload.personaPolicyHash || ''),
      personaTruthReceipt: { ...(command.payload.personaTruthReceipt || generationMetadata.personaTruthReceipt || {}) },
      state: 'generated',
      createdAt,
      updatedAt: createdAt
    };
    task.status = 'generated';
    task.updatedAt = createdAt;
    task.candidateId = candidateId;
    nextState.aiBrain.candidatesById[candidateId] = candidate;
    return {
      nextState,
      changedDomains: ['aiBrain'],
      result: { taskId, candidateId },
      events: {
        type: 'ai.replyCandidate.ready',
        domain: 'aiBrain',
        entityId: candidateId,
        changedPaths: [
          `aiBrain.tasksById.${taskId}.status`,
          `aiBrain.candidatesById.${candidateId}`
        ],
        payload: {
          taskId,
          candidateId,
          contactId: task.contactId,
          requiresUserApproval: true
        }
      },
      persist: transaction => {
        // This assertion executes while the authoritative SQLite StoreManager
        // transaction is open. Persona writes use the same store/coordinator, so
        // they cannot pass between this read and candidate persistence.
        assertRuntimeAtCommit(command.payload, transaction);
        assertPersonaAtCommit(command.payload);
        transaction?.upsertAiReplyTask?.(task);
        transaction?.upsertAiReplyCandidate?.(candidate);
      }
    };
  });

  storeManager.registerCommand('AI_REPLY_CANDIDATE_APPROVED', ({ command, state, cloneState, createId, now, fail }) => {
    const candidateId = clean(command.payload.candidateId);
    const current = state.aiBrain.candidatesById[candidateId];
    if (!current) fail('AI_REPLY_CANDIDATE_NOT_FOUND', 'AI reply candidate does not exist', { candidateId });
    // AC-037: block approval if candidate is stale (persona version changed since generation)
    if (current.state === 'reverify_required') {
      fail('AI_REPLY_CANDIDATE_REVERIFY_REQUIRED',
        'Persona 版本已更新，请重新生成回复候选人',
        { candidateId, candidatePersonaVersionId: current.personaVersionId, suggestedAction: 'REGENERATE' });
    }
    if (!['generated', 'edited'].includes(current.state)) {
      fail('AI_REPLY_CANDIDATE_NOT_REVIEWABLE', 'AI reply candidate is not available for approval', { candidateId, state: current.state });
    }
    const personaTruthReceipt = { ...(current.personaTruthReceipt || current.generationMetadata?.personaTruthReceipt || {}) };
    if (Object.keys(personaTruthReceipt).length && personaTruthReceipt.pass !== true) {
      fail('PERSONA_TRUTH_FIREWALL_BLOCKED', 'Persona 真相防火墙未通过，禁止批准该回复候选', {
        candidateId,
        receiptSha256: clean(personaTruthReceipt.receiptSha256),
        errors: Array.isArray(personaTruthReceipt.errors) ? personaTruthReceipt.errors : []
      });
    }
    const approvedBy = requireUserApproval(command, fail);
    const customer = state.customers.byId[current.contactId];
    if (!customer || customer.archived || customer.archivedAt) fail('ARCHIVED_CUSTOMER_READ_ONLY', 'Customer is no longer eligible for an AI reply', { contactId: current.contactId });
    // Background relationship/memory changes do not block approval on the fast path.
    const approvedEntityVersions = currentEntityVersions(state, current.contactId);
    const conversationRevision = currentConversationRevision(state, current.conversationId);
    if (Number(current.conversationRevision || 0) !== conversationRevision) {
      fail('AI_REPLY_CANDIDATE_REVERIFY_REQUIRED',
        'Conversation changed after this reply was generated',
        {
          candidateId,
          conversationId: current.conversationId,
          expectedRevision: Number(current.conversationRevision || 0),
          currentRevision: conversationRevision,
          suggestedAction: 'REGENERATE'
        });
    }
    const text = clean(command.payload.text || current.text);
    const learningMode = normalizeLearningMode(command.payload.learningMode);
    const replySource = normalizeReplySource(command.payload.source || current.source);
    if (!text) fail('EMPTY_APPROVED_REPLY', 'Approved reply text cannot be empty');
    const approvalLanguage = replyLanguageAuthority.validateCandidate(text, current.languageAuthority?.code
      ? current.languageAuthority
      : current.targetLanguageCode || current.targetLanguage || current.generationMetadata?.targetLanguageCode || current.generationMetadata?.targetLanguage);
    if (!approvalLanguage.pass) {
      fail('AI_REPLY_LANGUAGE_MISMATCH', approvalLanguage.message, {
        candidateId,
        expectedLanguage: approvalLanguage.expectedCode,
        actualLanguage: approvalLanguage.actualCode,
        suggestedAction: 'REGENERATE_OR_CHANGE_CONTACT_LANGUAGE'
      });
    }

    const nextState = cloneState();
    const candidate = nextState.aiBrain.candidatesById[candidateId];
    const task = nextState.aiBrain.tasksById[candidate.taskId];
    const outboxId = createId();
    const approvedAt = now();
    candidate.text = text;
    candidate.state = text === candidate.originalText ? 'approved' : 'edited_approved';
    candidate.updatedAt = approvedAt;
    if (task) {
      task.status = 'awaiting_send_confirmation';
      task.updatedAt = approvedAt;
    }
    const conversation = state.conversations.byId[candidate.conversationId] || {};
    const outbox = {
      id: outboxId,
      taskId: candidate.taskId,
      candidateId,
      contactId: candidate.contactId,
      conversationId: candidate.conversationId,
      accountId: clean(conversation.accountId || customer.accountId),
      platform: clean(conversation.platform || customer.platform),
      text,
      originalText: candidate.originalText,
      state: 'approved',
      userApproved: true,
      approvedAt,
      approvedBy,
      sendQueueId: '',
      contextVersion: candidate.contextVersion,
      metadata: {
        replyStrategy: candidate.replyStrategy,
        relationshipPotential: candidate.relationshipPotential,
        entityVersions: approvedEntityVersions,
        conversationRevision: Number(candidate.conversationRevision || 0),
        contextMessageIds: Array.isArray(candidate.contextMessageIds) ? [...candidate.contextMessageIds] : [],
        performanceMode: clean(candidate.performanceMode || 'balanced'),
        learningMode,
        replySource,
        explicitApproval: true,
        personaProfileId: candidate.personaProfileId || 'owner',
        personaVersionId: candidate.personaVersionId,
        personaPolicyHash: candidate.personaPolicyHash || '',
        personaTruthReceipt: { ...(candidate.personaTruthReceipt || candidate.generationMetadata?.personaTruthReceipt || {}) },
        targetLanguage: clean(candidate.targetLanguage || candidate.generationMetadata?.targetLanguage),
        targetLanguageCode: clean(candidate.targetLanguageCode || candidate.languageAuthority?.code || candidate.generationMetadata?.targetLanguageCode),
        languageAuthority: { ...(candidate.languageAuthority || candidate.generationMetadata?.languageAuthority || {}) },
        languageValidation: approvalLanguage,
        translatedZh: clean(candidate.translatedZh),
        translationModel: clean(candidate.translationModel),
        modelId: clean(candidate.modelId || candidate.generationMetadata?.modelId),
        model: clean(candidate.model || candidate.generationMetadata?.model),
        replyTask: clean(candidate.replyTask || candidate.generationMetadata?.replyTask),
        styleVariant: clean(candidate.generationMetadata?.styleVariant || candidate.director?.variant),
        director: { ...(candidate.director || {}) },
        qualityRouteReceipt: { ...(candidate.qualityRouteReceipt || candidate.generationMetadata?.qualityRouteReceipt || {}) },
        qualityTier: clean(candidate.qualityTier || candidate.generationMetadata?.qualityTier),
        emergencyMode: candidate.emergencyMode === true || candidate.generationMetadata?.emergencyMode === true,
        learningEligible: candidate.learningEligible !== false
          && candidate.generationMetadata?.learningEligible !== false
          && candidate.emergencyMode !== true
          && candidate.generationMetadata?.emergencyMode !== true,
        highCapabilityPath: candidate.highCapabilityPath === true || candidate.generationMetadata?.highCapabilityPath === true,
        directorQualityRouteReceipt: { ...(candidate.directorQualityRouteReceipt || candidate.generationMetadata?.director?.qualityRouteReceipt || {}) },
        directorStrategy: { ...(candidate.directorStrategy || candidate.generationMetadata?.directorStrategy || {}) },
        candidatePlan: { ...(candidate.candidatePlan || candidate.generationMetadata?.candidatePlan || {}) },
        candidateStrategyBranch: candidate.candidateStrategyBranch || candidate.generationMetadata?.candidateStrategyBranch || null,
        memoryRecall: { ...(candidate.memoryRecall || candidate.generationMetadata?.memoryRecall || {}) },
        generationMetadata: { ...(candidate.generationMetadata || {}) }
      },
      qualityRouteReceipt: { ...(candidate.qualityRouteReceipt || candidate.generationMetadata?.qualityRouteReceipt || {}) },
      qualityTier: clean(candidate.qualityTier || candidate.generationMetadata?.qualityTier),
      emergencyMode: candidate.emergencyMode === true || candidate.generationMetadata?.emergencyMode === true,
      learningEligible: candidate.learningEligible !== false
        && candidate.generationMetadata?.learningEligible !== false
        && candidate.emergencyMode !== true
        && candidate.generationMetadata?.emergencyMode !== true,
      personaProfileId: candidate.personaProfileId || 'owner',
      personaVersionId: candidate.personaVersionId,
      personaPolicyHash: candidate.personaPolicyHash || '',
      personaTruthReceipt: { ...(candidate.personaTruthReceipt || candidate.generationMetadata?.personaTruthReceipt || {}) },
      createdAt: approvedAt,
      updatedAt: approvedAt
    };
    nextState.outbox.byId[outboxId] = outbox;
    return {
      nextState,
      changedDomains: ['aiBrain', 'outbox'],
      result: { candidateId, outboxId, state: outbox.state },
      events: {
        type: 'ai.replyCandidate.userApproved',
        domain: 'outbox',
        entityId: outboxId,
        changedPaths: [
          `aiBrain.candidatesById.${candidateId}.state`,
          `outbox.byId.${outboxId}`
        ],
        payload: {
          candidateId,
          outboxId,
          contactId: candidate.contactId,
          approvedBy,
          requiresSendConfirmation: true
        }
      },
      persist: transaction => {
        transaction?.upsertAiReplyCandidate?.(candidate);
        if (task) transaction?.upsertAiReplyTask?.(task);
        transaction?.upsertOutboxItem?.(outbox);
      }
    };
  });

  storeManager.registerCommand('AI_REPLY_CANDIDATE_REJECTED', ({ command, state, cloneState, now, fail }) => {
    const candidateId = clean(command.payload.candidateId);
    if (!state.aiBrain.candidatesById[candidateId]) fail('AI_REPLY_CANDIDATE_NOT_FOUND', 'AI reply candidate does not exist', { candidateId });
    const rejectionReason = clean(command.payload.reason);
    if (!rejectionReason) fail('REPLY_REJECTION_REASON_REQUIRED', '拒绝候选时必须说明原因', { candidateId });
    const nextState = cloneState();
    const candidate = nextState.aiBrain.candidatesById[candidateId];
    candidate.state = 'rejected';
    candidate.rejectionReason = rejectionReason;
    candidate.updatedAt = now();
    const task = nextState.aiBrain.tasksById[candidate.taskId];
    if (task) {
      task.status = 'rejected';
      task.cancelReason = candidate.rejectionReason || 'USER_REJECTED';
      task.updatedAt = now();
    }
    return {
      nextState,
      changedDomains: ['aiBrain'],
      result: { candidateId, state: 'rejected' },
      events: {
        type: 'ai.replyCandidate.rejected',
        domain: 'aiBrain',
        entityId: candidateId,
        changedPaths: [`aiBrain.candidatesById.${candidateId}.state`],
        payload: {
          candidateId,
          contactId: candidate.contactId,
          conversationId: candidate.conversationId,
          rejectionReason: candidate.rejectionReason,
          originalText: candidate.originalText,
          finalText: candidate.text
        }
      },
      persist: transaction => {
        transaction?.upsertAiReplyCandidate?.(candidate);
        if (task) transaction?.upsertAiReplyTask?.(task);
      }
    };
  });

  storeManager.registerCommand('OUTBOX_TEXT_REVISED', ({ command, state, cloneState, now, fail }) => {
    const outboxId = clean(command.payload.outboxId);
    const current = state.outbox.byId[outboxId];
    if (!current) fail('OUTBOX_ITEM_NOT_FOUND', 'Outbox item does not exist', { outboxId });
    if (current.state !== 'approved' || current.userApproved !== true) {
      fail('OUTBOX_NOT_REVISION_READY', 'Only an approved, unsent Outbox item can be revised', { outboxId, state: current.state });
    }
    if (command.payload.userConfirmedRevision !== true) {
      fail('USER_REVISION_CONFIRMATION_REQUIRED', 'Outbox revision requires explicit user confirmation');
    }
    const text = clean(command.payload.text);
    if (!text) fail('EMPTY_APPROVED_REPLY', 'Revised reply text cannot be empty');
    const revisionLanguage = replyLanguageAuthority.validateCandidate(text, current.metadata?.languageAuthority?.code
      ? current.metadata.languageAuthority
      : current.metadata?.targetLanguageCode || current.metadata?.targetLanguage);
    if (!revisionLanguage.pass) {
      fail('AI_REPLY_LANGUAGE_MISMATCH', revisionLanguage.message, {
        outboxId,
        expectedLanguage: revisionLanguage.expectedCode,
        actualLanguage: revisionLanguage.actualCode,
        suggestedAction: 'REVISE_OR_CHANGE_CONTACT_LANGUAGE'
      });
    }
    const nextState = cloneState();
    const outbox = nextState.outbox.byId[outboxId];
    outbox.text = text;
    outbox.updatedAt = now();
    outbox.metadata = { ...(outbox.metadata || {}), userRevised: true, revisedAt: outbox.updatedAt, languageValidation: revisionLanguage };
    const candidate = nextState.aiBrain.candidatesById[outbox.candidateId];
    if (candidate) {
      candidate.text = text;
      candidate.state = 'edited_approved';
      candidate.updatedAt = outbox.updatedAt;
    }
    return {
      nextState,
      changedDomains: ['aiBrain', 'outbox'],
      result: { outboxId, text, state: outbox.state },
      events: {
        type: 'outbox.userRevised',
        domain: 'outbox',
        entityId: outboxId,
        changedPaths: [`outbox.byId.${outboxId}.text`],
        payload: { outboxId, candidateId: outbox.candidateId, contactId: outbox.contactId }
      },
      persist: transaction => {
        transaction?.upsertOutboxItem?.(outbox);
        if (candidate) transaction?.upsertAiReplyCandidate?.(candidate);
      }
    };
  });

  storeManager.registerCommand('OUTBOX_SEND_CONFIRMED', ({ command, state, cloneState, now, fail }) => {
    const outboxId = clean(command.payload.outboxId);
    const current = state.outbox.byId[outboxId];
    if (!current) fail('OUTBOX_ITEM_NOT_FOUND', 'Outbox item does not exist', { outboxId });
    // AC-037: block send if outbox item is stale (persona version changed since candidate approval)
    if (current.state === 'reverify_required') {
      fail('OUTBOX_REVERIFY_REQUIRED',
        'Persona 版本已更新，请重新批准回复候选人',
        { outboxId, personaVersionId: current.metadata?.personaVersionId, suggestedAction: 'REGENERATE_CANDIDATE' });
    }
    if (current.state !== 'approved' || current.userApproved !== true) {
      fail('OUTBOX_NOT_USER_APPROVED', 'Outbox item must be explicitly approved before send confirmation', { outboxId, state: current.state });
    }
    if (command.payload.confirmSend !== true) {
      fail('EXPLICIT_SEND_CONFIRMATION_REQUIRED', 'The user must explicitly confirm sending');
    }
    const customer = state.customers.byId[current.contactId];
    const account = state.auth.accountsById[current.accountId] || {};
    if (!customer || customer.archived || customer.archivedAt) fail('ARCHIVED_CUSTOMER_READ_ONLY', 'Customer is no longer eligible for sending', { contactId: current.contactId });
    if (account.canAttemptSend !== true) fail('ACCOUNT_CANNOT_ATTEMPT_SEND', 'The selected account does not satisfy send-attempt prerequisites', { accountId: current.accountId, state: account.state, sendVerified: account.sendVerified === true });
    // Relationship/memory analysis is asynchronous and cannot delay or veto final sending.
    const conversationRevision = currentConversationRevision(state, current.conversationId);
    if (Number(current.metadata?.conversationRevision || 0) !== conversationRevision) {
      fail('OUTBOX_REVERIFY_REQUIRED',
        'Conversation changed before final send confirmation',
        {
          outboxId,
          conversationId: current.conversationId,
          expectedRevision: Number(current.metadata?.conversationRevision || 0),
          currentRevision: conversationRevision,
          suggestedAction: 'REGENERATE_CANDIDATE'
        });
    }
    const sendLanguage = replyLanguageAuthority.validateCandidate(current.text, current.metadata?.languageAuthority?.code
      ? current.metadata.languageAuthority
      : current.metadata?.targetLanguageCode || current.metadata?.targetLanguage);
    if (!sendLanguage.pass) {
      fail('AI_REPLY_LANGUAGE_MISMATCH', sendLanguage.message, {
        outboxId,
        expectedLanguage: sendLanguage.expectedCode,
        actualLanguage: sendLanguage.actualCode,
        suggestedAction: 'REVISE_OR_CHANGE_CONTACT_LANGUAGE'
      });
    }

    const nextState = cloneState();
    const outbox = nextState.outbox.byId[outboxId];
    outbox.state = 'send_confirmed';
    outbox.sendConfirmedAt = now();
    outbox.updatedAt = now();
    outbox.metadata = { ...(outbox.metadata || {}), quoted: normalizeQuotedContext(command.payload.quoted) };
    return {
      nextState,
      changedDomains: ['outbox'],
      result: {
        outboxId,
        contactId: outbox.contactId,
        conversationId: outbox.conversationId,
        accountId: outbox.accountId,
        platform: outbox.platform,
        text: outbox.text
      },
      events: {
        type: 'outbox.sendConfirmed',
        domain: 'outbox',
        entityId: outboxId,
        changedPaths: [`outbox.byId.${outboxId}.state`, `outbox.byId.${outboxId}.metadata.quoted`],
        payload: {
          outboxId,
          contactId: outbox.contactId,
          conversationId: outbox.conversationId,
          accountId: outbox.accountId,
          platform: outbox.platform
        }
      },
      persist: transaction => transaction?.upsertOutboxItem?.(outbox)
    };
  });

  storeManager.registerCommand('OUTBOX_SEND_ABORTED', ({ command, state, cloneState, now, fail }) => {
    const outboxId = clean(command.payload.outboxId);
    const current = state.outbox.byId[outboxId];
    if (!current) fail('OUTBOX_ITEM_NOT_FOUND', 'Outbox item does not exist', { outboxId });
    if (['sent', 'queued', 'failed', 'cancelled', 'rejected'].includes(current.state)) {
      return { noop: true, result: { outboxId, state: current.state } };
    }
    const nextState = cloneState();
    const outbox = nextState.outbox.byId[outboxId];
    const reason = clean(command.payload.reason) || 'APPROVED_SEND_ABORTED';
    const reverifyRequired = command.payload.reverifyRequired === true;
    const timestamp = now();
    outbox.state = reverifyRequired ? 'reverify_required' : 'approved';
    outbox.sendConfirmedAt = '';
    outbox.error = '';
    outbox.updatedAt = timestamp;
    outbox.metadata = {
      ...(outbox.metadata || {}),
      lastTypingCancellation: { reason, at: timestamp, reverifyRequired }
    };
    const task = nextState.aiBrain.tasksById[outbox.taskId];
    if (task) {
      task.status = reverifyRequired ? 'cancelled' : 'awaiting_send_confirmation';
      task.cancelReason = reverifyRequired ? reason : '';
      task.error = '';
      task.updatedAt = timestamp;
    }
    const candidate = nextState.aiBrain.candidatesById[outbox.candidateId];
    if (candidate) {
      if (reverifyRequired) candidate.state = 'reverify_required';
      else if (!['approved', 'edited_approved'].includes(candidate.state)) {
        candidate.state = candidate.text === candidate.originalText ? 'approved' : 'edited_approved';
      }
      candidate.updatedAt = timestamp;
    }
    return {
      nextState,
      changedDomains: ['outbox', 'aiBrain'],
      result: { outboxId, state: outbox.state, reason, reverifyRequired },
      events: {
        type: reverifyRequired ? 'outbox.reverifyRequired' : 'outbox.sendCancelled',
        domain: 'outbox',
        entityId: outboxId,
        changedPaths: [`outbox.byId.${outboxId}.state`],
        payload: { outboxId, contactId: outbox.contactId, reason, reverifyRequired }
      },
      persist: transaction => {
        transaction?.upsertOutboxItem?.(outbox);
        if (task) transaction?.upsertAiReplyTask?.(task);
        if (candidate) transaction?.upsertAiReplyCandidate?.(candidate);
      }
    };
  });

  storeManager.registerCommand('OUTBOX_QUEUE_LINKED', ({ command, state, cloneState, now, fail }) => {
    const outboxId = clean(command.payload.outboxId);
    if (!state.outbox.byId[outboxId]) fail('OUTBOX_ITEM_NOT_FOUND', 'Outbox item does not exist', { outboxId });
    const nextState = cloneState();
    const outbox = nextState.outbox.byId[outboxId];
    if (!['send_confirmed', 'approved'].includes(outbox.state)) {
      fail('OUTBOX_NOT_SEND_CONFIRMED', 'Outbox item is not ready to join the platform send queue', { outboxId, state: outbox.state });
    }
    outbox.state = 'queued';
    outbox.sendQueueId = clean(command.payload.sendQueueId);
    outbox.approvalReceiptId = clean(command.payload.approvalReceiptId || outbox.approvalReceiptId);
    outbox.finalTextSha256 = clean(command.payload.finalTextSha256 || outbox.finalTextSha256);
    outbox.sendPolicyVersion = clean(command.payload.sendPolicyVersion || outbox.sendPolicyVersion);
    outbox.capabilitySnapshotId = clean(command.payload.capabilitySnapshotId || outbox.capabilitySnapshotId);
    outbox.qualityTier = clean(command.payload.qualityTier || outbox.qualityTier);
    outbox.emergencyMode = command.payload.emergencyMode === true;
    outbox.learningEligible = command.payload.learningEligible !== false && outbox.emergencyMode !== true;
    outbox.qualityRouteReceipt = { ...(command.payload.qualityRouteReceipt || outbox.qualityRouteReceipt || {}) };
    outbox.metadata = {
      ...(outbox.metadata || {}),
      approvalReceiptId: outbox.approvalReceiptId,
      finalTextSha256: outbox.finalTextSha256,
      sendPolicyVersion: outbox.sendPolicyVersion,
      capabilitySnapshotId: outbox.capabilitySnapshotId,
      qualityTier: outbox.qualityTier,
      emergencyMode: outbox.emergencyMode,
      learningEligible: outbox.learningEligible,
      qualityRouteReceipt: { ...outbox.qualityRouteReceipt }
    };
    outbox.updatedAt = now();
    return {
      nextState,
      changedDomains: ['outbox'],
      result: { outboxId, sendQueueId: outbox.sendQueueId, state: outbox.state },
      events: {
        type: 'outbox.queued',
        domain: 'outbox',
        entityId: outboxId,
        changedPaths: [`outbox.byId.${outboxId}.state`, `outbox.byId.${outboxId}.sendQueueId`],
        payload: {
          outboxId,
          candidateId: outbox.candidateId,
          contactId: outbox.contactId,
          conversationId: outbox.conversationId,
          accountId: outbox.accountId,
          platform: outbox.platform,
          sendQueueId: outbox.sendQueueId,
          state: outbox.state
        }
      },
      persist: transaction => transaction?.upsertOutboxItem?.(outbox)
    };
  });

  storeManager.registerCommand('AI_REPLY_FEEDBACK_RECORDED', ({ command, state, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    if (!state.customers.byId[contactId]) fail('CUSTOMER_NOT_FOUND', 'Cannot learn reply feedback for an unknown customer', { contactId });
    const evidenceId = clean(command.payload.evidenceId);
    if (!evidenceId) fail('REPLY_FEEDBACK_EVIDENCE_ID_REQUIRED', 'Reply feedback evidence id is required');
    const currentMemory = state.memories.byContactId[contactId] || { version: 0, preferences: {} };
    const existingEvidence = Array.isArray(currentMemory.feedbackLearning?.evidence)
      ? currentMemory.feedbackLearning.evidence
      : [];
    if (existingEvidence.some(row => clean(row.id) === evidenceId)) {
      return { noop: true, result: { evidenceId, contactId, duplicate: true } };
    }

    const observedAt = clean(command.payload.observedAt) || now();
    const eventType = clean(command.payload.eventType) || 'sent';
    const signals = inferFeedbackSignals({
      eventType,
      originalText: command.payload.originalText,
      finalText: command.payload.finalText,
      rejectionReason: command.payload.rejectionReason,
      replyStrategy: command.payload.replyStrategy || {}
    });
    const evidence = {
      id: evidenceId,
      eventType,
      candidateId: clean(command.payload.candidateId),
      outboxId: clean(command.payload.outboxId),
      contactId,
      conversationId: clean(command.payload.conversationId),
      source: normalizeReplySource(command.payload.source),
      finalText: eventType === 'sent' ? clean(command.payload.finalText) : '',
      contextRevision: Number(command.payload.contextRevision || 0),
      contextMessageIds: Array.isArray(command.payload.contextMessageIds)
        ? command.payload.contextMessageIds.map(clean).filter(Boolean)
        : [],
      performanceMode: clean(command.payload.performanceMode),
      platform: clean(command.payload.platform),
      sourceAccountId: clean(command.payload.sourceAccountId),
      platformContactIdentity: clean(command.payload.platformContactIdentity),
      canonicalContactId: clean(command.payload.canonicalContactId || contactId),
      learningMode: clean(command.payload.learningMode),
      targetLanguage: clean(command.payload.targetLanguage),
      translatedZh: clean(command.payload.translatedZh),
      translationModel: clean(command.payload.translationModel),
      modelId: clean(command.payload.modelId),
      model: clean(command.payload.model),
      replyTask: clean(command.payload.replyTask),
      styleVariant: clean(command.payload.styleVariant),
      generationMetadata: { ...(command.payload.generationMetadata || {}) }
    };
    const contactApplied = applySignals(currentMemory.feedbackLearning || {}, signals, evidence, { now: observedAt });
    if (!contactApplied.changed) {
      return { noop: true, result: { evidenceId, contactId, learned: false, signals: [] } };
    }
    const personaProfileId = clean(command.payload.personaProfileId) || 'owner';

    const nextState = cloneState();
    const memory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    memory.feedbackLearning = contactApplied.profile;
    memory.version = Number(memory.version || 0) + 1;
    memory.updatedAt = observedAt;
    nextState.memories.byContactId[contactId] = memory;

    const eventRow = {
      id: evidenceId,
      eventType,
      candidateId: clean(command.payload.candidateId),
      outboxId: clean(command.payload.outboxId),
      contactId,
      conversationId: clean(command.payload.conversationId),
      personaProfileId,
      originalText: clean(command.payload.originalText),
      finalText: clean(command.payload.finalText),
      rejectionReason: clean(command.payload.rejectionReason),
      source: normalizeReplySource(command.payload.source),
      contextRevision: Number(command.payload.contextRevision || 0),
      contextMessageIds: Array.isArray(command.payload.contextMessageIds)
        ? command.payload.contextMessageIds.map(clean).filter(Boolean)
        : [],
      performanceMode: clean(command.payload.performanceMode),
      platform: clean(command.payload.platform),
      sourceAccountId: clean(command.payload.sourceAccountId),
      platformContactIdentity: clean(command.payload.platformContactIdentity),
      canonicalContactId: clean(command.payload.canonicalContactId || contactId),
      learningMode: clean(command.payload.learningMode),
      targetLanguage: clean(command.payload.targetLanguage),
      translatedZh: clean(command.payload.translatedZh),
      translationModel: clean(command.payload.translationModel),
      modelId: clean(command.payload.modelId),
      model: clean(command.payload.model),
      replyTask: clean(command.payload.replyTask),
      styleVariant: clean(command.payload.styleVariant),
      generationMetadata: { ...(command.payload.generationMetadata || {}) },
      signals,
      createdAt: observedAt
    };
    return {
      nextState,
      changedDomains: ['memories'],
      result: {
        evidenceId,
        contactId,
        learned: true,
        signals,
        contactProfile: contactApplied.profile,
        contactNewlyEffective: contactApplied.newlyEffective,
        personaProfile: {},
        personaNewlyEffective: {},
        personaProfileId,
        personaSyncSkipped: 'identity-scoped-feedback-learning-authority'
      },
      events: {
        type: 'ai.replyFeedback.learned',
        domain: 'memories',
        entityId: contactId,
        changedPaths: [`memories.byContactId.${contactId}.feedbackLearning`],
        payload: {
          evidenceId,
          contactId,
          personaProfileId,
          eventType,
          effectiveKeys: Object.keys(contactApplied.newlyEffective)
        }
      },
      persist: transaction => {
        transaction?.insertReplyFeedbackEvent?.(eventRow);
        transaction?.insertReplyLearningProjectionJob?.({
          evidenceId,
          contactId,
          conversationId: clean(command.payload.conversationId),
          payload: { ...command.payload, evidenceId, eventType, signals, observedAt },
          createdAt: observedAt
        });
        transaction?.upsertReplyFeedbackProfile?.({
          scopeType: 'contact',
          scopeId: contactId,
          profile: contactApplied.profile,
          version: contactApplied.profile.version,
          updatedAt: observedAt
        });
      }
    };
  });

  storeManager.registerCommand('AI_REPLY_FEEDBACK_PREFERENCE_UPDATED', ({ command, state, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    const key = clean(command.payload.key);
    const action = clean(command.payload.action).toLowerCase();
    if (!state.customers.byId[contactId]) fail('CUSTOMER_NOT_FOUND', 'Cannot update reply learning for an unknown customer', { contactId });
    if (!key) fail('REPLY_FEEDBACK_KEY_REQUIRED', 'Reply learning preference key is required');
    if (!['enable', 'disable', 'delete'].includes(action)) fail('REPLY_FEEDBACK_ACTION_INVALID', 'Unsupported reply learning preference action', { action });
    const nextState = cloneState();
    const memory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    const current = memory.feedbackLearning && typeof memory.feedbackLearning === 'object' ? memory.feedbackLearning : {};
    const timestamp = now();
    const feedbackLearning = {
      ...current,
      version: Number(current.version || 0) + 1,
      counts: { ...(current.counts || {}) },
      effective: { ...(current.effective || {}) },
      evidence: Array.isArray(current.evidence) ? current.evidence.map(row => ({ ...row, signals: Array.isArray(row?.signals) ? row.signals.map(signal => ({ ...signal })) : [] })) : [],
      recentExamples: Array.isArray(current.recentExamples) ? current.recentExamples.slice(-12) : [],
      updatedAt: timestamp,
      engineVersion: clean(current.engineVersion) || ENGINE_VERSION
    };
    const existing = feedbackLearning.effective[key] && typeof feedbackLearning.effective[key] === 'object'
      ? { ...feedbackLearning.effective[key] }
      : null;
    if (action !== 'delete' && (!existing || !clean(existing.value))) {
      fail('REPLY_FEEDBACK_PREFERENCE_NOT_FOUND', 'Reply learning preference does not exist', { contactId, key });
    }
    if (action === 'delete') {
      delete feedbackLearning.effective[key];
      delete feedbackLearning.counts[key];
      feedbackLearning.evidence = feedbackLearning.evidence.map(row => ({
        ...row,
        signals: (row.signals || []).filter(signal => clean(signal?.key) !== key)
      })).filter(row => row.signals.length || clean(row.eventType) === 'sent');
    } else {
      feedbackLearning.effective[key] = {
        ...existing,
        disabled: action === 'disable',
        disabledAt: action === 'disable' ? timestamp : '',
        disabledBy: action === 'disable' ? clean(command.payload.actor) || 'user' : ''
      };
    }
    memory.feedbackLearning = feedbackLearning;
    memory.version = Number(memory.version || 0) + 1;
    memory.updatedAt = timestamp;
    nextState.memories.byContactId[contactId] = memory;
    return {
      nextState,
      changedDomains: ['memories'],
      result: { contactId, key, action, feedbackLearning },
      events: {
        type: 'ai.replyFeedback.preferenceUpdated',
        domain: 'memories',
        entityId: contactId,
        changedPaths: [`memories.byContactId.${contactId}.feedbackLearning.effective.${key}`],
        payload: { contactId, key, action, actor: clean(command.payload.actor) || 'user' }
      },
      persist: transaction => transaction?.upsertReplyFeedbackProfile?.({
        scopeType: 'contact',
        scopeId: contactId,
        profile: feedbackLearning,
        version: feedbackLearning.version,
        updatedAt: timestamp,
        reason: `preference:${action}:${key}:${clean(command.payload.actor) || 'user'}`
      })
    };
  });

  storeManager.registerCommand('AI_REPLY_FEEDBACK_RESET', ({ command, state, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    if (!state.customers.byId[contactId]) fail('CUSTOMER_NOT_FOUND', 'Cannot reset reply feedback for an unknown customer', { contactId });
    const nextState = cloneState();
    const memory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    const timestamp = now();
    const feedbackLearning = {
      version: Number(memory.feedbackLearning?.version || 0) + 1,
      evidence: [],
      counts: {},
      effective: {},
      recentExamples: [],
      updatedAt: timestamp,
      engineVersion: ENGINE_VERSION
    };
    memory.feedbackLearning = feedbackLearning;
    memory.version = Number(memory.version || 0) + 1;
    memory.updatedAt = timestamp;
    nextState.memories.byContactId[contactId] = memory;
    const resetBy = clean(command.payload.resetBy) || 'user';
    return {
      nextState,
      changedDomains: ['memories'],
      result: { contactId, reset: true, feedbackVersion: feedbackLearning.version },
      events: {
        type: 'ai.replyFeedback.reset',
        domain: 'memories',
        entityId: contactId,
        changedPaths: [`memories.byContactId.${contactId}.feedbackLearning`],
        payload: { contactId, resetBy, feedbackVersion: feedbackLearning.version }
      },
      persist: transaction => transaction?.upsertReplyFeedbackProfile?.({
        scopeType: 'contact',
        scopeId: contactId,
        profile: feedbackLearning,
        version: feedbackLearning.version,
        updatedAt: timestamp,
        reason: `reset:${resetBy}`
      })
    };
  });

  storeManager.registerCommand('AI_REPLY_FEEDBACK_FORGOTTEN', ({ command, state, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    if (!state.customers.byId[contactId]) fail('CUSTOMER_NOT_FOUND', 'Cannot forget reply feedback for an unknown customer', { contactId });
    if (command.payload.confirmForget !== true) {
      fail('REPLY_FEEDBACK_FORGET_CONFIRMATION_REQUIRED', '永久忘记回复学习需要明确确认', { contactId });
    }
    const nextState = cloneState();
    const memory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    delete memory.feedbackLearning;
    memory.version = Number(memory.version || 0) + 1;
    memory.updatedAt = now();
    nextState.memories.byContactId[contactId] = memory;
    const forgottenBy = clean(command.payload.forgottenBy) || 'user';
    return {
      nextState,
      changedDomains: ['memories'],
      result: { contactId, forgotten: true, permanent: true },
      events: {
        type: 'ai.replyFeedback.forgotten',
        domain: 'memories',
        entityId: contactId,
        changedPaths: [`memories.byContactId.${contactId}.feedbackLearning`],
        payload: { contactId, forgottenBy, permanent: true }
      },
      persist: transaction => transaction?.forgetReplyFeedbackContact?.({ contactId })
    };
  });

  storeManager.registerCommand('AI_REPLY_FEEDBACK_RESTORED', ({ command, state, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    if (!state.customers.byId[contactId]) fail('CUSTOMER_NOT_FOUND', 'Cannot restore reply feedback for an unknown customer', { contactId });
    const sourceProfile = command.payload.profile && typeof command.payload.profile === 'object' ? command.payload.profile : null;
    if (!sourceProfile) fail('REPLY_FEEDBACK_VERSION_REQUIRED', 'A stored reply feedback version is required');
    const nextState = cloneState();
    const memory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    const timestamp = now();
    const restored = {
      ...sourceProfile,
      version: Number(memory.feedbackLearning?.version || 0) + 1,
      evidence: Array.isArray(sourceProfile.evidence) ? sourceProfile.evidence.slice(-200) : [],
      counts: sourceProfile.counts && typeof sourceProfile.counts === 'object' ? sourceProfile.counts : {},
      effective: sourceProfile.effective && typeof sourceProfile.effective === 'object' ? sourceProfile.effective : {},
      recentExamples: Array.isArray(sourceProfile.recentExamples) ? sourceProfile.recentExamples.slice(-12) : [],
      updatedAt: timestamp,
      engineVersion: clean(sourceProfile.engineVersion) || ENGINE_VERSION
    };
    memory.feedbackLearning = restored;
    memory.version = Number(memory.version || 0) + 1;
    memory.updatedAt = timestamp;
    nextState.memories.byContactId[contactId] = memory;
    const sourceVersion = Number(command.payload.sourceVersion || 0);
    const restoredBy = clean(command.payload.restoredBy) || 'user';
    return {
      nextState,
      changedDomains: ['memories'],
      result: { contactId, restored: true, sourceVersion, feedbackVersion: restored.version, feedbackLearning: restored },
      events: {
        type: 'ai.replyFeedback.restored',
        domain: 'memories',
        entityId: contactId,
        changedPaths: [`memories.byContactId.${contactId}.feedbackLearning`],
        payload: { contactId, sourceVersion, feedbackVersion: restored.version, restoredBy }
      },
      persist: transaction => transaction?.upsertReplyFeedbackProfile?.({
        scopeType: 'contact',
        scopeId: contactId,
        profile: restored,
        version: restored.version,
        updatedAt: timestamp,
        reason: `restore:${sourceVersion}:${restoredBy}`
      })
    };
  });

  storeManager.registerCommand('OUTBOX_SEND_RESULT', ({ command, state, cloneState, now, fail }) => {
    const outboxId = clean(command.payload.outboxId);
    if (!state.outbox.byId[outboxId]) fail('OUTBOX_ITEM_NOT_FOUND', 'Outbox item does not exist', { outboxId });
    const nextState = cloneState();
    const outbox = nextState.outbox.byId[outboxId];
    outbox.state = command.payload.success === true ? 'sent' : 'failed';
    outbox.sendQueueId = clean(command.payload.sendQueueId || outbox.sendQueueId);
    outbox.error = clean(command.payload.error);
    outbox.updatedAt = now();
    const task = nextState.aiBrain.tasksById[outbox.taskId];
    if (task) {
      task.status = command.payload.success === true ? 'committed' : 'failed';
      task.error = outbox.error;
      task.updatedAt = now();
    }
    const candidate = nextState.aiBrain.candidatesById[outbox.candidateId];
    if (candidate) {
      candidate.state = command.payload.success === true ? 'sent' : 'send_failed';
      candidate.updatedAt = now();
    }
    return {
      nextState,
      changedDomains: ['outbox', 'aiBrain'],
      result: { outboxId, state: outbox.state },
      events: {
        type: command.payload.success === true ? 'outbox.sent' : 'outbox.failed',
        domain: 'outbox',
        entityId: outboxId,
        changedPaths: [`outbox.byId.${outboxId}.state`],
        payload: {
          outboxId,
          candidateId: outbox.candidateId,
          contactId: outbox.contactId,
          conversationId: outbox.conversationId,
          accountId: outbox.accountId,
          platform: outbox.platform,
          sendQueueId: outbox.sendQueueId,
          state: outbox.state,
          success: command.payload.success === true,
          error: outbox.error,
          finalText: outbox.text,
          originalText: outbox.originalText
        }
      },
      persist: transaction => {
        transaction?.upsertOutboxItem?.(outbox);
        if (task) transaction?.upsertAiReplyTask?.(task);
        if (candidate) transaction?.upsertAiReplyCandidate?.(candidate);
      }
    };
  });
}

module.exports = { registerAiReplyCommands, currentEntityVersions, assertSocialContextVersion, normalizeQuotedContext };
