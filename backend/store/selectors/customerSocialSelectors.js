'use strict';

const { RECENT_SOCIAL_MESSAGE_LIMIT } = require('../social/learningPolicy');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function derivePotential(relationship = {}) {
  const current = object(relationship.potential);
  const emotion = object(relationship.emotion);
  return {
    relationshipStage: clean(current.relationshipStage || relationship.stage) || 'unknown',
    warmth: clamp01(current.warmth ?? emotion.warmth),
    openness: clamp01(current.openness ?? relationship.openness),
    trust: clamp01(current.trust ?? relationship.trust),
    initiative: clamp01(current.initiative ?? relationship.initiative),
    tension: clamp01(current.tension ?? emotion.tension),
    momentum: clean(current.momentum || relationship.trend) || 'stable',
    stability: clean(current.stability) || 'unknown',
    socialDistance: clean(current.socialDistance) || 'moderate',
    confidence: clamp01(current.confidence ?? relationship.confidence, 0.5)
  };
}

function selectCustomerSocialContext(contactId, options = {}) {
  const id = clean(contactId);
  const timelineLimit = Math.max(1, Math.min(100, Number(options.timelineLimit || 24)));
  const recentMessageLimit = Math.max(1, Math.min(120, Number(options.recentMessageLimit || RECENT_SOCIAL_MESSAGE_LIMIT)));

  const selector = state => {
    const customer = state.customers?.byId?.[id] || null;
    const relationship = state.relationships?.byContactId?.[id] || {};
    const workspaceInsights = object(relationship.workspaceInsights);
    const workspaceInsightsUsable = !['stale', 'failed', 'superseded', 'rejected'].includes(clean(workspaceInsights.status).toLowerCase());
    const memory = state.memories?.byContactId?.[id] || {};
    const interactionPolicy = state.interactionPolicies?.byContactId?.[id] || {};
    const feedbackLearning = object(memory.feedbackLearning);
    const feedbackEffective = object(feedbackLearning.effective);
    const conversationIds = array(state.conversations?.byContactId?.[id]);
    const conversations = conversationIds
      .map(conversationId => state.conversations?.byId?.[conversationId])
      .filter(Boolean);
    const recentMessages = conversations
      .flatMap(conversation => array(state.conversations?.recentMessagesById?.[conversation.id]))
      .sort((a, b) => String(a.sentAt || a.timestamp || '').localeCompare(String(b.sentAt || b.timestamp || '')))
      .slice(-recentMessageLimit);
    const accountId = clean(customer?.accountId || conversations[0]?.accountId);
    const account = state.auth?.accountsById?.[accountId] || {};
    const archived = Boolean(customer?.archivedAt || customer?.archived);
    const frozen = ['frozen', 'wait_for_reply', 'manual_only'].includes(clean(interactionPolicy.policy));
    const ready = Boolean(
      state.customers?.ready &&
      state.relationships?.ready &&
      state.interactionPolicies?.ready &&
      state.memories?.ready
    );

    const entityVersions = {
      customer: Number(customer?.version || 0),
      relationship: Number(relationship.version || 0),
      memory: Number(memory.version || 0),
      interactionPolicy: Number(interactionPolicy.version || 0),
      routing: Number(state.meta?.domainVersions?.routing || 0)
    };

    return {
      found: Boolean(customer),
      ready,
      contactId: id,
      contextVersion: Number(state.meta?.stateVersion || 0),
      entityVersions,
      guards: {
        archived,
        canGenerateReply: Boolean(customer && ready && !archived && interactionPolicy.allowReplies !== false),
        canProactivelyContact: Boolean(customer && ready && !archived && !frozen && interactionPolicy.allowProactive !== false),
        canSendNow: Boolean(customer && ready && !archived && account.canSend === true && interactionPolicy.blocked !== true),
        blockReason: archived
          ? 'ARCHIVED_CUSTOMER_READ_ONLY'
          : !ready
            ? 'SOCIAL_CONTEXT_NOT_READY'
            : interactionPolicy.blocked === true
              ? clean(interactionPolicy.blockReason) || 'INTERACTION_POLICY_BLOCKED'
              : accountId && account.canSend !== true
                ? 'ACCOUNT_CANNOT_SEND'
                : ''
      },
      customer: customer ? {
        id,
        canonicalContactId: clean(customer.canonicalContactId || customer.customerProfileId || id),
        customerProfileId: clean(customer.customerProfileId || customer.canonicalContactId || id),
        displayName: clean(customer.displayName || customer.name),
        platform: clean(customer.platform),
        accountId,
        tags: array(customer.tags),
        relationshipStage: clean(customer.relationshipStage || relationship.stage),
        country: clean(customer.country || customer.facts?.country),
        city: clean(customer.city || customer.facts?.city),
        region: clean(customer.region || customer.facts?.region),
        timezone: clean(customer.timezone || customer.facts?.timezone),
        preferredLanguage: clean(customer.preferredLanguage || customer.language || customer.languages || customer.facts?.preferredLanguage || customer.facts?.languages),
        languages: clean(customer.languages || customer.facts?.languages),
        archived
      } : null,
      relationshipPotential: derivePotential(relationship),
      relationshipAnalysis: workspaceInsightsUsable ? {
        summary: clean(workspaceInsights.summary),
        relationshipStage: clean(workspaceInsights.relationshipStage),
        tone: clean(workspaceInsights.tone),
        hiddenNeed: clean(workspaceInsights.hiddenNeed),
        nextAction: clean(workspaceInsights.nextAction),
        opportunityScore: Number(workspaceInsights.opportunityScore || 0),
        riskScore: Number(workspaceInsights.riskScore || 0),
        evidence: array(workspaceInsights.evidence),
        openLoops: array(workspaceInsights.openLoops),
        status: clean(workspaceInsights.status),
        modelId: clean(workspaceInsights.modelId),
        model: clean(workspaceInsights.model),
        analyzedThroughMessageId: clean(workspaceInsights.analyzedThroughMessageId),
        analyzedThroughAt: clean(workspaceInsights.analyzedThroughAt),
        updatedAt: clean(workspaceInsights.updatedAt)
      } : { status: clean(workspaceInsights.status), stale: true },
      emotion: {
        current: clean(relationship.emotion?.current) || 'unknown',
        warmth: clamp01(relationship.emotion?.warmth),
        tension: clamp01(relationship.emotion?.tension),
        energy: clamp01(relationship.emotion?.energy),
        openness: clamp01(relationship.emotion?.openness),
        trust: clamp01(relationship.emotion?.trust),
        trend: clean(relationship.emotion?.trend) || 'stable',
        volatility: clean(relationship.emotion?.volatility) || 'unknown'
      },
      interaction: {
        averageReplyDelayMinutes: Number(relationship.interaction?.averageReplyDelayMinutes || 0),
        unansweredOutgoingCount: Number(relationship.interaction?.unansweredOutgoingCount || 0),
        responseRate7d: clamp01(relationship.interaction?.responseRate7d),
        initiatesConversationRate: clamp01(relationship.interaction?.initiatesConversationRate),
        lastInboundAt: clean(relationship.interaction?.lastInboundAt),
        lastOutboundAt: clean(relationship.interaction?.lastOutboundAt),
        preferredActiveHours: array(relationship.interaction?.preferredActiveHours)
      },
      preferences: {
        preferredLength: clean(memory.preferences?.preferredLength) || 'adaptive',
        humorAffinity: clamp01(memory.preferences?.humorAffinity, 0.5),
        formality: clamp01(memory.preferences?.formality, 0.5),
        directness: clamp01(memory.preferences?.directness, 0.5),
        emojiTolerance: clamp01(memory.preferences?.emojiTolerance, 0.2),
        questionTolerance: clamp01(memory.preferences?.questionTolerance, 0.5),
        preferredDepth: clean(memory.preferences?.preferredDepth) || 'adaptive',
        evidence: Array.isArray(memory.preferences?.evidence)
          ? memory.preferences.evidence
          : object(memory.preferences?.evidence),
        userFeedback: feedbackEffective
      },
      feedbackLearning: {
        version: Number(feedbackLearning.version || 0),
        effective: feedbackEffective,
        recentExamples: array(feedbackLearning.recentExamples).slice(-4).map(row => ({
          id: clean(row?.id),
          finalText: clean(row?.finalText).slice(0, 1200),
          source: clean(row?.source),
          performanceMode: clean(row?.performanceMode),
          platform: clean(row?.platform),
          targetLanguage: clean(row?.targetLanguage),
          translatedZh: clean(row?.translatedZh).slice(0, 1200),
          translationModel: clean(row?.translationModel),
          modelId: clean(row?.modelId),
          model: clean(row?.model),
          replyTask: clean(row?.replyTask),
          styleVariant: clean(row?.styleVariant),
          generationMetadata: object(row?.generationMetadata),
          qualityWeight: clamp01(row?.qualityWeight, 0.7),
          createdAt: clean(row?.createdAt)
        })).filter(row => row.id && row.finalText),
        evidenceCount: array(feedbackLearning.evidence).length,
        updatedAt: clean(feedbackLearning.updatedAt),
        engineVersion: clean(feedbackLearning.engineVersion)
      },
      memory: {
        confirmedFacts: array(memory.confirmedFacts),
        userNotes: array(memory.userNotes),
        importantEvents: array(memory.importantEvents),
        openLoops: array(memory.openLoops),
        promises: array(memory.promises),
        boundaries: array(memory.boundaries),
        sensitiveTopics: array(memory.sensitiveTopics),
        recurringInterests: array(memory.recurringInterests)
      },
      timeline: array(relationship.timeline).slice(-timelineLimit),
      recentSignals: array(relationship.signals).slice(-timelineLimit),
      interactionPolicy: {
        policy: clean(interactionPolicy.policy) || 'reply_normally',
        allowReplies: interactionPolicy.allowReplies !== false,
        allowProactive: interactionPolicy.allowProactive !== false,
        proactiveMessageBudget7d: Number(interactionPolicy.proactiveMessageBudget7d || 0),
        usedThisWeek: Number(interactionPolicy.usedThisWeek || 0),
        unansweredLimit: Number(interactionPolicy.unansweredLimit ?? 1),
        minimumIntervalHours: Number(interactionPolicy.minimumIntervalHours || 0),
        nextAllowedProactiveAt: clean(interactionPolicy.nextAllowedProactiveAt),
        blockReason: clean(interactionPolicy.blockReason),
        manualApprovalRequired: interactionPolicy.manualApprovalRequired !== false
      },
      replyStrategy: {
        recommendedTone: clean(interactionPolicy.replyStrategy?.recommendedTone) || 'warm_calm',
        recommendedLength: clean(interactionPolicy.replyStrategy?.recommendedLength) || 'short',
        recommendedDepth: clean(interactionPolicy.replyStrategy?.recommendedDepth) || 'light_personal',
        maxQuestions: Math.max(0, Number(interactionPolicy.replyStrategy?.maxQuestions ?? 1)),
        toneWeights: { ...object(interactionPolicy.replyStrategy?.toneWeights) },
        avoid: array(interactionPolicy.replyStrategy?.avoid),
        confidence: clamp01(interactionPolicy.replyStrategy?.confidence, 0.5)
      },
      recentMessages
    };
  };

  selector.selectorId = `customerSocialContext:${id}`;
  return selector;
}

function sameCustomerSocialContext(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.contextVersion === right.contextVersion &&
    left.contactId === right.contactId &&
    left.entityVersions.customer === right.entityVersions.customer &&
    left.entityVersions.relationship === right.entityVersions.relationship &&
    left.entityVersions.memory === right.entityVersions.memory &&
    left.entityVersions.interactionPolicy === right.entityVersions.interactionPolicy &&
    left.entityVersions.routing === right.entityVersions.routing;
}

module.exports = {
  selectCustomerSocialContext,
  sameCustomerSocialContext,
  derivePotential
};
