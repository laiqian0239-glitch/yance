'use strict';

const { parseSocialSignals } = require('../social/socialSignalParser');
const messageSpeakerAuthority = require('../../services/messageSpeakerAuthority');
const { evolveRelationship } = require('../social/relationTrailEngine');
const { calculateInteractionPolicy } = require('../social/interactionGovernor');
const { inferInteractionPreferences } = require('../social/preferenceLearningEngine');
const contactContextAuthority = require('../../services/contactContextAuthority');
const { RECENT_SOCIAL_MESSAGE_LIMIT } = require('../social/learningPolicy');
const { extractDeterministicFacts, mergeConfirmedFacts, mergeInterestRows } = require('../../services/contactFactExtractionService');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sameMessage(left, right) {
  return clean(left?.id || left?.messageId) === clean(right?.id || right?.messageId);
}

function normalizeMessage(input = {}) {
  const id = clean(input.id || input.messageId);
  return messageSpeakerAuthority.normalizeMessageIdentity({
    ...input,
    id,
    messageId: id,
    conversationId: clean(input.conversationId || input.sessionKey),
    sessionKey: clean(input.sessionKey || input.conversationId),
    text: clean(input.text || input.transcript || input.translation),
    sentAt: clean(input.sentAt || input.timestamp) || new Date().toISOString(),
    timestamp: clean(input.timestamp || input.sentAt) || new Date().toISOString(),
    type: clean(input.type || input.messageType) || 'text'
  });
}

function upsertRecentMessage(nextState, conversationId, message, limit = RECENT_SOCIAL_MESSAGE_LIMIT) {
  const list = array(nextState.conversations.recentMessagesById[conversationId]);
  const index = list.findIndex(row => sameMessage(row, message));
  if (index >= 0) list[index] = message;
  else list.push(message);
  list.sort((a, b) => clean(a.sentAt || a.timestamp).localeCompare(clean(b.sentAt || b.timestamp)));
  nextState.conversations.recentMessagesById[conversationId] = list.slice(-Math.max(8, limit));
}

function registerSocialIntelligenceCommands(storeManager, options = {}) {
  const governorConfig = options.governorConfig || {};

  storeManager.registerCommand('INGEST_SOCIAL_MESSAGE', ({ command, state, cloneState, fail }) => {
    const contactId = clean(command.payload.contactId);
    const conversationId = clean(command.payload.conversationId || command.payload.message?.conversationId || command.payload.message?.sessionKey);
    const message = normalizeMessage(command.payload.message || {});
    if (!contactId) fail('SOCIAL_CONTACT_REQUIRED', 'Social ingestion requires a stable contactId');
    if (!conversationId) fail('SOCIAL_CONVERSATION_REQUIRED', 'Social ingestion requires conversationId');
    if (!message.id) fail('SOCIAL_MESSAGE_REQUIRED', 'Social ingestion requires message.id');

    const customer = state.customers.byId[contactId];
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Social ingestion customer does not exist', { contactId });
    const sourceConversation = state.conversations.byId[conversationId] || {};
    const platform = clean(command.payload.platform || message.platform || sourceConversation.platform || customer.platform);
    const sourceAccountId = clean(command.payload.sourceAccountId || message.sourceAccountId || message.accountId || sourceConversation.accountId || customer.accountId);
    const platformMessageId = clean(message.platformMessageId || message.id);
    Object.assign(message, { platform, sourceAccountId, platformMessageId });

    const previousRelationship = state.relationships.byContactId[contactId] || {
      version: 0,
      stage: 'unknown',
      potential: {},
      emotion: {},
      interaction: {},
      timeline: [],
      signals: []
    };
    const previousMemory = state.memories.byContactId[contactId] || {
      version: 0,
      preferences: {},
      confirmedFacts: [],
      inferredFacts: [],
      userNotes: [],
      importantEvents: [],
      openLoops: [],
      promises: [],
      boundaries: [],
      sensitiveTopics: [],
      recurringInterests: []
    };
    const existingMessages = array(state.conversations.recentMessagesById[conversationId]);
    const recentMessages = existingMessages.some(row => sameMessage(row, message))
      ? existingMessages.map(row => sameMessage(row, message) ? message : row)
      : [...existingMessages, message];

    const signals = parseSocialSignals({
      contactId,
      conversationId,
      platform,
      sourceAccountId,
      message,
      recentMessages,
      relationship: previousRelationship
    });

    const relationship = evolveRelationship({
      contactId,
      conversationId,
      platform,
      sourceAccountId,
      message,
      signals,
      recentMessages,
      previous: previousRelationship
    });

    const learnedPreferences = inferInteractionPreferences(recentMessages, previousMemory.preferences || {});
    const deterministicFacts = extractDeterministicFacts(message, {
      platform,
      sourceAccountId,
      conversationId,
      canonicalContactId: clean(customer.canonicalContactId || customer.customerProfileId || contactId)
    });
    const memory = {
      ...previousMemory,
      version: Number(previousMemory.version || 0) + 1,
      preferences: learnedPreferences,
      confirmedFacts: mergeConfirmedFacts(previousMemory.confirmedFacts, deterministicFacts.facts),
      recurringInterests: mergeInterestRows(previousMemory.recurringInterests, deterministicFacts.recurringInterests),
      updatedAt: relationship.calculatedAt
    };

    const previousPolicy = state.interactionPolicies.byContactId[contactId] || {};
    const policy = calculateInteractionPolicy({
      customer,
      relationship: {
        ...relationship,
        preferences: learnedPreferences,
        deterministicFacts: deterministicFacts.facts,
        profileFacts: deterministicFacts.profileFacts
      },
      memory,
      signals,
      previousPolicy
    }, command.payload.governorConfig || governorConfig);

    const nextState = cloneState();
    nextState.relationships.byContactId[contactId] = relationship;
    nextState.memories.byContactId[contactId] = memory;
    nextState.interactionPolicies.byContactId[contactId] = policy;
    if (deterministicFacts.facts.length) {
      const nextCustomer = nextState.customers.byId[contactId];
      if (nextCustomer) {
        nextCustomer.facts = { ...(nextCustomer.facts || {}), ...deterministicFacts.profileFacts };
        for (const [key, value] of Object.entries(deterministicFacts.profileFacts)) {
          if (value !== undefined && value !== null && String(value).trim()) nextCustomer[key] = value;
        }
        nextCustomer.version = Number(nextCustomer.version || 0) + 1;
        nextCustomer.updatedAt = relationship.calculatedAt;
      }
    }
    upsertRecentMessage(nextState, conversationId, message, command.payload.recentMessageLimit || RECENT_SOCIAL_MESSAGE_LIMIT);

    const conversation = nextState.conversations.byId[conversationId];
    if (conversation) {
      conversation.lastMessage = message.text || `[${message.type}]`;
      conversation.lastMessageAt = message.sentAt;
      conversation.version = Number(conversation.version || 0) + 1;
    }

    const changedPaths = [
      `relationships.byContactId.${contactId}`,
      `memories.byContactId.${contactId}.preferences`,
      `memories.byContactId.${contactId}.confirmedFacts`,
      `memories.byContactId.${contactId}.recurringInterests`,
      ...(deterministicFacts.facts.length ? [`customers.byId.${contactId}.facts`] : []),
      `interactionPolicies.byContactId.${contactId}`,
      `conversations.recentMessagesById.${conversationId}`
    ];

    const events = [
      {
        type: 'message.sociallyIngested',
        domain: 'relationships',
        entityId: message.id,
        changedPaths,
        payload: {
          contactId,
          conversationId,
          messageId: message.id,
          signalCount: signals.length,
          timelineEventCount: relationship.timelineEvents.length
        }
      },
      {
        type: 'customer.socialState.updated',
        domain: 'relationships',
        entityId: contactId,
        changedPaths: [
          `relationships.byContactId.${contactId}`,
          `interactionPolicies.byContactId.${contactId}`
        ],
        payload: {
          contactId,
          relationshipStage: relationship.stage,
          emotionalTrend: relationship.emotion.trend,
          interactionPolicy: policy.policy
        }
      }
    ];
    if (signals.length) {
      events.push({
        type: 'socialSignals.detected',
        domain: 'relationships',
        entityId: contactId,
        changedPaths: [`relationships.byContactId.${contactId}.signals`],
        payload: { contactId, conversationId, messageId: message.id, signals }
      });
    }
    if (deterministicFacts.facts.length) {
      events.push({
        type: 'customer.facts.updated',
        domain: 'memories',
        entityId: contactId,
        changedPaths: [
          `customers.byId.${contactId}.facts`,
          `memories.byContactId.${contactId}.confirmedFacts`,
          `memories.byContactId.${contactId}.recurringInterests`
        ],
        payload: {
          contactId,
          conversationId,
          messageId: message.id,
          factKeys: deterministicFacts.facts.map(row => row.key),
          extractionVersion: deterministicFacts.version
        }
      });
    }
    if (relationship.timelineEvents.length) {
      events.push({
        type: 'relationshipTrail.updated',
        domain: 'relationships',
        entityId: contactId,
        changedPaths: [`relationships.byContactId.${contactId}.timeline`],
        payload: { contactId, events: relationship.timelineEvents }
      });
    }

    return {
      nextState,
      changedDomains: [
        'relationships', 'memories', 'interactionPolicies', 'conversations',
        ...(deterministicFacts.facts.length ? ['customers'] : [])
      ],
      result: {
        contactId,
        conversationId,
        messageId: message.id,
        signals,
        timelineEvents: relationship.timelineEvents,
        relationshipPotential: relationship.potential,
        interactionPolicy: policy,
        preferences: learnedPreferences,
        deterministicFacts: deterministicFacts.facts,
        profileFacts: deterministicFacts.profileFacts
      },
      events,
      persist: transaction => {
        transaction?.upsertSocialSignals?.(signals);
        transaction?.upsertTimelineEvents?.(relationship.timelineEvents);
        transaction?.upsertCustomerSocialState?.({
          contactId,
          relationship: relationship.relationship,
          emotion: relationship.emotion,
          interaction: relationship.interaction,
          preferences: learnedPreferences,
          strategy: policy.replyStrategy,
          potential: relationship.potential,
          version: relationship.version,
          sourceMessageId: message.id,
          sourceMessageAt: message.sentAt,
          calculatedAt: relationship.calculatedAt,
          engineVersion: relationship.engineVersion,
          payload: { stage: relationship.stage }
        });
        transaction?.upsertInteractionPreferences?.({
          contactId,
          preferences: learnedPreferences,
          evidenceCount: learnedPreferences.evidenceCount,
          confidence: learnedPreferences.confidence,
          evidenceMessageIds: recentMessages.slice(-20).map(row => row.id).filter(Boolean),
          source: 'preference_learning',
          lastConfirmedAt: relationship.calculatedAt
        });
        transaction?.upsertInteractionPolicy?.({
          contactId,
          ...policy
        });
        if (deterministicFacts.facts.length) {
          transaction?.upsertDeterministicCustomerFacts?.({
            contactId,
            canonicalContactId: clean(customer.canonicalContactId || customer.customerProfileId || contactId),
            platform,
            sourceAccountId,
            conversationId,
            sourceMessageId: message.id,
            sourceMessageAt: message.sentAt,
            profileFacts: deterministicFacts.profileFacts,
            confirmedFacts: memory.confirmedFacts,
            recurringInterests: memory.recurringInterests,
            evidence: deterministicFacts.facts,
            extractionVersion: deterministicFacts.version
          });
        }
      }
    };
  });

  storeManager.registerCommand('CORRECT_SOCIAL_INFERENCE', ({ command, state, cloneState, fail, createId, now }) => {
    const contactId = clean(command.payload.contactId);
    const targetType = clean(command.payload.targetType);
    if (!state.customers.byId[contactId]) fail('CUSTOMER_NOT_FOUND', 'Cannot correct social inference for an unknown customer', { contactId });
    if (!['signal', 'timeline', 'preference', 'relationship_state'].includes(targetType)) {
      fail('INVALID_CORRECTION_TARGET', 'Unsupported correction target', { targetType });
    }
    const correction = command.payload.correction || {};
    const nextState = cloneState();
    const memory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    if (targetType === 'preference') {
      memory.preferences = { ...(memory.preferences || {}), ...correction };
      memory.version = Number(memory.version || 0) + 1;
      memory.updatedAt = now();
      nextState.memories.byContactId[contactId] = memory;
    } else {
      const relationship = nextState.relationships.byContactId[contactId] || {
        version: 0,
        timeline: [],
        signals: []
      };
      relationship.version = Number(relationship.version || 0) + 1;
      relationship.corrections = [
        ...(Array.isArray(relationship.corrections) ? relationship.corrections : []),
        {
          targetType,
          targetId: clean(command.payload.targetId),
          correction,
          reason: clean(command.payload.reason),
          correctedBy: clean(command.payload.correctedBy) || 'user',
          correctedAt: now()
        }
      ].slice(-100);
      relationship.updatedAt = now();
      nextState.relationships.byContactId[contactId] = relationship;
    }
    const correctionId = createId();
    return {
      nextState,
      changedDomains: targetType === 'preference' ? ['memories'] : ['relationships'],
      result: { correctionId, contactId, targetType },
      events: {
        type: 'socialInference.corrected',
        domain: targetType === 'preference' ? 'memories' : 'relationships',
        entityId: contactId,
        changedPaths: targetType === 'preference' ? [`memories.byContactId.${contactId}.preferences`] : [],
        payload: { correctionId, contactId, targetType, targetId: clean(command.payload.targetId) }
      },
      persist: transaction => {
        transaction?.insertCorrection?.({
          id: correctionId,
          contactId,
          targetType,
          targetId: clean(command.payload.targetId),
          correction,
          reason: clean(command.payload.reason),
          correctedBy: clean(command.payload.correctedBy) || 'user',
          createdAt: now()
        });
        if (targetType === 'preference') {
          transaction?.upsertInteractionPreferences?.({
            contactId,
            preferences: memory.preferences,
            evidenceCount: Number(memory.preferences.evidenceCount || 0),
            confidence: 1,
            source: 'manual_correction',
            lastConfirmedAt: now()
          });
        }
      }
    };
  });

  // Wire contactContextAuthority ingest -> local store authority (INGEST_SOCIAL_MESSAGE)
  contactContextAuthority.setIngest(async (contactId, signal) => {
    return storeManager.dispatch({
      type: 'INGEST_SOCIAL_MESSAGE',
      source: 'contact-context-authority',
      payload: {
        contactId,
        conversationId: signal.conversationId,
        message: signal.message || {},
        governorConfig: signal.governorConfig
      }
    });
  });

  // Bridge authority events -> eventBus so existing consumers (socialSignals.detected,
  // relationshipTrail.updated, etc.) keep receiving them.
  const eventBus = options.eventBus || require('../../services/eventBus');
  const bound = [];
  const bind = (type, handler) => {
    const listener = (...args) => Promise.resolve(handler(...args)).catch(() => {});
    eventBus.on(type, listener);
    bound.push({ type, listener });
  };
  for (const type of [
    'socialSignals.detected',
    'relationshipTrail.updated',
    'customer.socialState.updated',
    'customer.facts.updated',
    'message.sociallyIngested',
    'socialInference.corrected'
  ]) {
    // StoreProjectionCoordinator exposes authoritative StoreManager events under
    // the store:<eventType> namespace. Bridge that namespace for legacy
    // consumers; listening and republishing the same raw event recursively
    // re-entered the listener if a legacy publisher ever emitted it.
    bind(`store:${type}`, event => eventBus.publish(type, event));
  }

  // Expose unbinding for cleanup
  storeManager.registerCommand('__CONTACT_CONTEXT_AUTHORITY_UNBIND__', () => {
    for (const { type, listener } of bound) eventBus.off(type, listener);
    return { ok: true };
  });
}

module.exports = {
  registerSocialIntelligenceCommands,
  normalizeMessage,
  upsertRecentMessage
};
