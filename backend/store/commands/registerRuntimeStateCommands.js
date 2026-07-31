'use strict';

const { normalizeTypingPolicy } = require('../typing/typingPolicy');
const { normalizeAccountRuntime } = require('../../services/accountRuntimeAuthority');

function clean(value) {
  return String(value == null ? '' : value).trim();
}


const { randomUUID } = require('node:crypto');
const {
  THEME_IDS,
  LIGHT_THEME_IDS,
  DARK_THEME_IDS,
  normalizeThemeId,
  normalizeMotionLevel,
  normalizeBackgroundEffect,
  normalizeThemeMode,
  normalizeClock,
  normalizeThemeIdList,
  normalizeThemeTuning,
  normalizeTypography,
  normalizeCustomThemePresets,
  normalizePresetId,
  normalizeAppearanceState
} = require('../themeAppearancePolicy');

function persistentUiState(ui, updatedAt = new Date().toISOString()) {
  const appearance = normalizeAppearanceState(ui);
  return {
    readingMode: ui.readingMode || 'comfortable',
    density: ui.density || 'comfortable',
    contrastMode: ui.contrastMode || 'high',
    ...appearance,
    updatedAt
  };
}

function moveRecentTheme(ui, themeId) {
  ui.recentThemeIds = normalizeThemeIdList([themeId, ...(ui.recentThemeIds || [])], 12);
}

function registerRuntimeStateCommands(storeManager) {
  storeManager.registerCommand('SYNC_ACCOUNT_STATE', ({ command, cloneState }) => {
    const accountId = clean(command.payload.accountId || command.payload.id);
    if (!accountId) return { noop: true, result: { accountId: '' } };
    const nextState = cloneState();
    const previous = nextState.auth.accountsById[accountId] || {};
    const authority = normalizeAccountRuntime(previous, command.payload);
    const state = authority.state;
    nextState.auth.accountsById[accountId] = {
      ...previous,
      ...command.payload,
      ...authority,
      id: accountId,
      accountId,
      version: Number(previous.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    return {
      nextState,
      changedDomains: ['auth'],
      result: nextState.auth.accountsById[accountId],
      events: {
        type: 'auth.accountState.updated',
        domain: 'auth',
        entityId: accountId,
        changedPaths: [`auth.accountsById.${accountId}`],
        payload: { accountId, state, canAttemptSend: nextState.auth.accountsById[accountId].canAttemptSend, sendVerified: nextState.auth.accountsById[accountId].sendVerified, canSend: nextState.auth.accountsById[accountId].canSend }
      }
    };
  });

  storeManager.registerCommand('SYNC_MODEL_REGISTRY', ({ command, cloneState }) => {
    const registry = command.payload.registry || command.payload || {};
    const nextState = cloneState();
    nextState.models.byId = {};
    for (const model of registry.models || []) {
      if (!model?.id) continue;
      nextState.models.byId[model.id] = { ...model };
    }
    nextState.models.routes = { ...(registry.routes || {}) };
    nextState.models.ready = true;
    nextState.routing.byTask = { ...(registry.routes || {}) };
    nextState.routing.ready = true;
    return {
      nextState,
      changedDomains: ['models', 'routing'],
      result: { modelCount: Object.keys(nextState.models.byId).length },
      events: {
        type: 'models.registry.synced',
        domain: 'models',
        changedPaths: ['models.byId', 'models.routes', 'routing.byTask'],
        payload: { modelCount: Object.keys(nextState.models.byId).length }
      }
    };
  });

  storeManager.registerCommand('SET_UI_READING_MODE', ({ command, cloneState }) => {
    const readingMode = ['standard', 'comfortable', 'large'].includes(clean(command.payload.readingMode))
      ? clean(command.payload.readingMode)
      : 'comfortable';
    const density = ['comfortable', 'compact'].includes(clean(command.payload.density))
      ? clean(command.payload.density)
      : undefined;
    const contrastMode = ['standard', 'high'].includes(clean(command.payload.contrastMode))
      ? clean(command.payload.contrastMode)
      : undefined;
    const nextState = cloneState();
    nextState.ui.readingMode = readingMode;
    if (density) nextState.ui.density = density;
    if (contrastMode) nextState.ui.contrastMode = contrastMode;
    nextState.ui.ready = true;
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { readingMode, density: nextState.ui.density, contrastMode: nextState.ui.contrastMode },
      events: {
        type: 'ui.readingMode.changed',
        domain: 'ui',
        changedPaths: ['ui.readingMode', ...(density ? ['ui.density'] : []), ...(contrastMode ? ['ui.contrastMode'] : [])],
        payload: { readingMode, density: nextState.ui.density, contrastMode: nextState.ui.contrastMode }
      },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });

  storeManager.registerCommand('PREVIEW_THEME', ({ command, cloneState }) => {
    const nextState = cloneState();
    const themeId = normalizeThemeId(command.payload.themeId, nextState.ui.themeId || 'midnight-cyan');
    nextState.ui.previewThemeId = themeId;
    nextState.ui.previewStartedAt = new Date().toISOString();
    nextState.ui.ready = true;
    return {
      nextState,
      ephemeral: true,
      changedDomains: ['ui'],
      result: { themeId, preview: true },
      events: {
        type: 'ui.theme.previewed',
        domain: 'ui',
        changedPaths: ['ui.previewThemeId', 'ui.previewStartedAt'],
        payload: { themeId }
      }
    };
  });

  storeManager.registerCommand('CANCEL_THEME_PREVIEW', ({ cloneState }) => {
    const nextState = cloneState();
    const previousThemeId = clean(nextState.ui.previewThemeId);
    nextState.ui.previewThemeId = '';
    nextState.ui.previewStartedAt = '';
    nextState.ui.ready = true;
    return {
      nextState,
      ephemeral: true,
      changedDomains: ['ui'],
      result: { themeId: nextState.ui.themeId, previewCancelled: Boolean(previousThemeId) },
      events: {
        type: 'ui.theme.previewCancelled',
        domain: 'ui',
        changedPaths: ['ui.previewThemeId', 'ui.previewStartedAt'],
        payload: { themeId: nextState.ui.themeId }
      }
    };
  });

  storeManager.registerCommand('APPLY_THEME', ({ command, cloneState }) => {
    const nextState = cloneState();
    const themeId = normalizeThemeId(command.payload.themeId || nextState.ui.previewThemeId, nextState.ui.themeId || 'midnight-cyan');
    nextState.ui.themeId = themeId;
    nextState.ui.previewThemeId = '';
    nextState.ui.previewStartedAt = '';
    nextState.ui.themeMode = 'manual';
    nextState.ui.activeCustomThemePresetId = '';
    moveRecentTheme(nextState.ui, themeId);
    nextState.ui.ready = true;
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { themeId, applied: true },
      events: {
        type: 'ui.theme.applied',
        domain: 'ui',
        priority: 'high',
        changedPaths: ['ui.themeId', 'ui.previewThemeId', 'ui.themeMode', 'ui.recentThemeIds', 'ui.activeCustomThemePresetId'],
        payload: { themeId }
      },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });

  storeManager.registerCommand('SET_UI_MOTION_LEVEL', ({ command, cloneState }) => {
    const nextState = cloneState();
    const motionLevel = normalizeMotionLevel(command.payload.motionLevel, nextState.ui.motionLevel || 'balanced');
    nextState.ui.motionLevel = motionLevel;
    nextState.ui.ready = true;
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { motionLevel },
      events: {
        type: 'ui.motionLevel.changed',
        domain: 'ui',
        changedPaths: ['ui.motionLevel'],
        payload: { motionLevel }
      },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });

  storeManager.registerCommand('SET_UI_BACKGROUND_EFFECT', ({ command, cloneState }) => {
    const nextState = cloneState();
    const backgroundEffect = normalizeBackgroundEffect(command.payload.backgroundEffect, nextState.ui.backgroundEffect || 'ambient');
    nextState.ui.backgroundEffect = backgroundEffect;
    nextState.ui.ready = true;
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { backgroundEffect },
      events: {
        type: 'ui.backgroundEffect.changed',
        domain: 'ui',
        changedPaths: ['ui.backgroundEffect'],
        payload: { backgroundEffect }
      },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });


  storeManager.registerCommand('UPDATE_THEME_PREFERENCES', ({ command, cloneState }) => {
    const nextState = cloneState();
    const payload = command.payload || {};
    const changedPaths = [];
    if (payload.favoriteThemeId != null) {
      const requestedThemeId = clean(payload.favoriteThemeId);
      const themeId = THEME_IDS.has(requestedThemeId) ? requestedThemeId : '';
      if (themeId) {
        const set = new Set(normalizeThemeIdList(nextState.ui.favoriteThemeIds, 60));
        if (payload.favorite === false) set.delete(themeId); else set.add(themeId);
        nextState.ui.favoriteThemeIds = normalizeThemeIdList([...set], 60);
        changedPaths.push('ui.favoriteThemeIds');
      }
    }
    if (payload.themeTuning && typeof payload.themeTuning === 'object') {
      nextState.ui.themeTuning = normalizeThemeTuning({ ...(nextState.ui.themeTuning || {}), ...payload.themeTuning });
      nextState.ui.activeCustomThemePresetId = '';
      changedPaths.push('ui.themeTuning', 'ui.activeCustomThemePresetId');
    }
    if (payload.typography && typeof payload.typography === 'object') {
      nextState.ui.typography = normalizeTypography({ ...(nextState.ui.typography || {}), ...payload.typography });
      nextState.ui.activeCustomThemePresetId = '';
      changedPaths.push('ui.typography', 'ui.activeCustomThemePresetId');
    }
    if (payload.themeMode != null || payload.lightThemeId != null || payload.darkThemeId != null || payload.scheduleDayStart != null || payload.scheduleNightStart != null) {
      nextState.ui.themeMode = normalizeThemeMode(payload.themeMode, nextState.ui.themeMode || 'manual');
      const requestedLight = clean(payload.lightThemeId);
      const requestedDark = clean(payload.darkThemeId);
      nextState.ui.lightThemeId = LIGHT_THEME_IDS.has(requestedLight) ? requestedLight : nextState.ui.lightThemeId;
      nextState.ui.darkThemeId = DARK_THEME_IDS.has(requestedDark) ? requestedDark : nextState.ui.darkThemeId;
      nextState.ui.scheduleDayStart = normalizeClock(payload.scheduleDayStart, nextState.ui.scheduleDayStart || '07:00');
      nextState.ui.scheduleNightStart = normalizeClock(payload.scheduleNightStart, nextState.ui.scheduleNightStart || '19:00');
      changedPaths.push('ui.themeMode', 'ui.lightThemeId', 'ui.darkThemeId', 'ui.scheduleDayStart', 'ui.scheduleNightStart');
    }
    if (!changedPaths.length) return { noop: true, result: { updated: false } };
    nextState.ui.ready = true;
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { updated: true, ui: persistentUiState(nextState.ui, nextState.ui.updatedAt) },
      events: {
        type: 'ui.themePreferences.changed',
        domain: 'ui',
        changedPaths: [...new Set(changedPaths)],
        payload: { changedPaths: [...new Set(changedPaths)] }
      },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });

  storeManager.registerCommand('SAVE_CUSTOM_THEME_PRESET', ({ command, cloneState }) => {
    const nextState = cloneState();
    const payload = command.payload || {};
    const now = new Date().toISOString();
    const requestedId = normalizePresetId(payload.id);
    const id = requestedId || `theme-${randomUUID().replace(/-/gu, '').slice(0, 12)}`;
    const name = clean(payload.name).slice(0, 40) || `我的主题 ${Math.min(12, (nextState.ui.customThemePresets || []).length + 1)}`;
    const previous = (nextState.ui.customThemePresets || []).find(row => row.id === id);
    const preset = {
      id,
      name,
      baseThemeId: normalizeThemeId(payload.baseThemeId || nextState.ui.previewThemeId || nextState.ui.themeId),
      tuning: normalizeThemeTuning(payload.tuning || nextState.ui.themeTuning),
      typography: normalizeTypography(payload.typography || nextState.ui.typography),
      motionLevel: normalizeMotionLevel(payload.motionLevel || nextState.ui.motionLevel),
      backgroundEffect: normalizeBackgroundEffect(payload.backgroundEffect || nextState.ui.backgroundEffect),
      createdAt: clean(previous?.createdAt) || now,
      updatedAt: now
    };
    nextState.ui.customThemePresets = normalizeCustomThemePresets([preset, ...(nextState.ui.customThemePresets || []).filter(row => row.id !== id)]);
    nextState.ui.activeCustomThemePresetId = id;
    nextState.ui.updatedAt = now;
    nextState.ui.ready = true;
    return {
      nextState,
      changedDomains: ['ui'],
      result: { preset, saved: true },
      events: { type: 'ui.customTheme.saved', domain: 'ui', entityId: id, changedPaths: ['ui.customThemePresets', 'ui.activeCustomThemePresetId'], payload: { id, name } },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, now))
    };
  });

  storeManager.registerCommand('APPLY_CUSTOM_THEME_PRESET', ({ command, cloneState }) => {
    const nextState = cloneState();
    const id = normalizePresetId(command.payload?.presetId);
    const preset = normalizeCustomThemePresets(nextState.ui.customThemePresets).find(row => row.id === id);
    if (!preset) return { noop: true, result: { presetId: id, applied: false, reason: 'not-found' } };
    nextState.ui.themeId = preset.baseThemeId;
    nextState.ui.previewThemeId = '';
    nextState.ui.previewStartedAt = '';
    nextState.ui.themeMode = 'manual';
    nextState.ui.themeTuning = preset.tuning;
    nextState.ui.typography = preset.typography;
    nextState.ui.motionLevel = preset.motionLevel;
    nextState.ui.backgroundEffect = preset.backgroundEffect;
    nextState.ui.activeCustomThemePresetId = id;
    moveRecentTheme(nextState.ui, preset.baseThemeId);
    nextState.ui.ready = true;
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { presetId: id, themeId: preset.baseThemeId, applied: true },
      events: { type: 'ui.customTheme.applied', domain: 'ui', entityId: id, priority: 'high', changedPaths: ['ui.themeId', 'ui.themeTuning', 'ui.typography', 'ui.motionLevel', 'ui.backgroundEffect', 'ui.activeCustomThemePresetId'], payload: { presetId: id, themeId: preset.baseThemeId } },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });

  storeManager.registerCommand('DELETE_CUSTOM_THEME_PRESET', ({ command, cloneState }) => {
    const nextState = cloneState();
    const id = normalizePresetId(command.payload?.presetId);
    const before = normalizeCustomThemePresets(nextState.ui.customThemePresets);
    nextState.ui.customThemePresets = before.filter(row => row.id !== id);
    if (nextState.ui.activeCustomThemePresetId === id) nextState.ui.activeCustomThemePresetId = '';
    if (before.length === nextState.ui.customThemePresets.length) return { noop: true, result: { presetId: id, deleted: false } };
    nextState.ui.updatedAt = new Date().toISOString();
    return {
      nextState,
      changedDomains: ['ui'],
      result: { presetId: id, deleted: true },
      events: { type: 'ui.customTheme.deleted', domain: 'ui', entityId: id, changedPaths: ['ui.customThemePresets', 'ui.activeCustomThemePresetId'], payload: { presetId: id } },
      persist: transaction => transaction?.upsertUiState?.(persistentUiState(nextState.ui, nextState.ui.updatedAt))
    };
  });

  storeManager.registerCommand('SYNC_CUSTOMER_CONTEXT', ({ command, cloneState }) => {
    const context = command.payload.context || command.payload || {};
    const contact = context.contact || {};
    const contactId = clean(contact.id || contact.contactId || context.contactId);
    if (!contactId) return { noop: true, result: { contactId: '' } };
    const nextState = cloneState();
    const previousCustomer = nextState.customers.byId[contactId] || {};
    const archived = Boolean(contact.archived || contact.archivedAt);
    nextState.customers.byId[contactId] = {
      ...previousCustomer,
      ...contact,
      id: contactId,
      contactId,
      displayName: clean(contact.displayName || contact.name || previousCustomer.displayName),
      archived,
      archivedAt: clean(contact.archivedAt),
      version: Number(previousCustomer.version || 0) + 1
    };
    nextState.customers.activeIds = nextState.customers.activeIds.filter(id => id !== contactId);
    nextState.customers.archivedIds = nextState.customers.archivedIds.filter(id => id !== contactId);
    (archived ? nextState.customers.archivedIds : nextState.customers.activeIds).push(contactId);
    if (!nextState.customers.currentId && !archived) nextState.customers.currentId = contactId;

    const profile = context.profile || {};
    const previousMemory = nextState.memories.byContactId[contactId] || { version: 0, preferences: {} };
    nextState.memories.byContactId[contactId] = {
      ...previousMemory,
      version: Math.max(Number(previousMemory.version || 0) + 1, Number(profile.version || 0), 1),
      confirmedFacts: Array.isArray(profile.confirmed) ? profile.confirmed : previousMemory.confirmedFacts || [],
      inferredFacts: Array.isArray(profile.inferences) ? profile.inferences : previousMemory.inferredFacts || [],
      userNotes: profile.notes || profile.note ? [{ text: clean(profile.notes || profile.note), source: 'manual_note', confidence: 1 }] : previousMemory.userNotes || [],
      importantEvents: Array.isArray(profile.payload?.importantEvents) ? profile.payload.importantEvents : previousMemory.importantEvents || [],
      openLoops: Array.isArray(profile.payload?.openLoops) ? profile.payload.openLoops : previousMemory.openLoops || [],
      promises: Array.isArray(profile.commitments) ? profile.commitments : previousMemory.promises || [],
      boundaries: Array.isArray(profile.boundaries) ? profile.boundaries : previousMemory.boundaries || [],
      sensitiveTopics: Array.isArray(profile.payload?.sensitiveTopics) ? profile.payload.sensitiveTopics : previousMemory.sensitiveTopics || [],
      recurringInterests: Array.isArray(profile.payload?.recurringInterests) ? profile.payload.recurringInterests : previousMemory.recurringInterests || [],
      preferences: { ...(previousMemory.preferences || {}), ...(profile.payload?.preferences || profile.traits?.preferences || {}) }
    };

    const insights = context.insights || {};
    const previousRelationship = nextState.relationships.byContactId[contactId] || { version: 0, timeline: [], signals: [] };
    nextState.relationships.byContactId[contactId] = {
      ...previousRelationship,
      version: Math.max(Number(previousRelationship.version || 0) + 1, Number(insights.version || 0), 1),
      stage: clean(previousRelationship.stage || insights.relationshipStage || insights.stage) || 'unknown',
      potential: {
        ...(previousRelationship.potential || {}),
        relationshipStage: clean(previousRelationship.potential?.relationshipStage || insights.relationshipStage || insights.stage) || 'unknown',
        warmth: previousRelationship.potential?.warmth ?? Number(insights.intimacyScore || insights.intimacy || 0),
        openness: previousRelationship.potential?.openness ?? Number(insights.openness || 0),
        initiative: previousRelationship.potential?.initiative ?? Number(insights.initiativeScore || insights.initiative || 0),
        tension: previousRelationship.potential?.tension ?? Number(insights.responsePressure || 0),
        momentum: clean(previousRelationship.potential?.momentum || insights.momentum) || 'stable'
      },
      workspaceInsights: {
        summary: clean(insights.summary),
        relationshipStage: clean(insights.relationshipStage || insights.stage),
        tone: clean(insights.tone),
        hiddenNeed: clean(insights.hiddenNeed),
        nextAction: clean(insights.nextAction || insights.next),
        opportunityScore: Number(insights.opportunityScore ?? insights.opportunity ?? 0),
        riskScore: Number(insights.riskScore ?? insights.risk ?? 0),
        evidence: Array.isArray(insights.evidence) ? insights.evidence : [],
        openLoops: Array.isArray(insights.openLoops) ? insights.openLoops : [],
        status: clean(insights.status),
        modelId: clean(insights.modelId),
        model: clean(insights.model),
        analyzedThroughMessageId: clean(insights.analyzedThroughMessageId),
        analyzedThroughAt: clean(insights.analyzedThroughAt),
        updatedAt: clean(insights.updatedAt || insights.updated)
      },
      timeline: previousRelationship.timeline || [],
      signals: previousRelationship.signals || []
    };

    const conversations = Array.isArray(context.conversations) ? context.conversations : context.conversationId ? [{ sessionKey: context.conversationId }] : [];
    for (const conversation of conversations) {
      const conversationId = clean(conversation.sessionKey || conversation.id || conversation.conversationId);
      if (!conversationId) continue;
      nextState.conversations.byId[conversationId] = {
        ...(nextState.conversations.byId[conversationId] || {}),
        ...conversation,
        id: conversationId,
        sessionKey: conversationId,
        conversationId,
        contactId,
        version: Number(nextState.conversations.byId[conversationId]?.version || 0) + 1
      };
      nextState.conversations.byContactId[contactId] ||= [];
      if (!nextState.conversations.byContactId[contactId].includes(conversationId)) nextState.conversations.byContactId[contactId].push(conversationId);
    }
    return {
      nextState,
      changedDomains: ['customers', 'conversations', 'memories', 'relationships'],
      result: { contactId },
      events: {
        type: 'customer.context.synced',
        domain: 'customers',
        entityId: contactId,
        changedPaths: [
          `customers.byId.${contactId}`,
          `memories.byContactId.${contactId}`,
          `relationships.byContactId.${contactId}`
        ],
        payload: { contactId }
      }
    };
  });


  storeManager.registerCommand('UPDATE_TYPING_POLICY', ({ command, cloneState }) => {
    const nextState = cloneState();
    nextState.typingState.policy = normalizeTypingPolicy({
      ...(nextState.typingState.policy || {}),
      ...(command.payload || {})
    });
    nextState.typingState.ready = true;
    return {
      nextState,
      changedDomains: ['typingState'],
      ephemeral: true,
      result: nextState.typingState.policy,
      events: {
        type: 'conversation.typingPolicy.updated',
        domain: 'typingState',
        changedPaths: ['typingState.policy'],
        priority: 'high',
        payload: { policy: nextState.typingState.policy }
      }
    };
  });


  storeManager.registerCommand('UPDATE_CONTACT_TYPING_STATE', ({ command, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    if (!contactId) fail('CONTACT_ID_REQUIRED', 'Typing state requires a stable contactId');
    const nextState = cloneState();
    const previous = nextState.typingState.byContactId[contactId] || {};
    const isTyping = command.payload.isTyping === true;
    const activity = clean(command.payload.activity) || (isTyping ? 'composing' : 'paused');
    const lastUpdated = clean(command.payload.lastUpdated) || now();
    const ttlMs = Math.max(500, Math.min(10000, Number(command.payload.ttlMs || nextState.typingState.policy?.inboundTtlMs || 3000)));
    const timestamp = Number.isFinite(Date.parse(lastUpdated)) ? Date.parse(lastUpdated) : Date.now();
    const contact = {
      ...(previous.contact || {}),
      isTyping,
      activity,
      lastUpdated,
      expiresAt: isTyping ? new Date(timestamp + ttlMs).toISOString() : '',
      conversationId: clean(command.payload.conversationId || previous.contact?.conversationId || previous.conversationId),
      accountId: clean(command.payload.accountId || previous.contact?.accountId || previous.accountId),
      platform: clean(command.payload.platform || previous.contact?.platform || previous.platform),
      participant: clean(command.payload.participant || previous.contact?.participant),
      reason: clean(command.payload.reason)
    };
    const self = previous.self || {
      isTyping: false,
      activity: 'paused',
      phase: '',
      lastUpdated: '',
      expiresAt: ''
    };
    nextState.typingState.byContactId[contactId] = {
      ...previous,
      contactId,
      conversationId: contact.conversationId,
      accountId: contact.accountId,
      platform: contact.platform,
      // Compatibility aliases requested by the ConversationState protocol.
      isTyping: contact.isTyping,
      lastUpdated: contact.lastUpdated,
      expiresAt: contact.expiresAt,
      activity: contact.activity,
      contact,
      self
    };
    nextState.typingState.ready = true;
    return {
      nextState,
      changedDomains: ['typingState'],
      ephemeral: true,
      result: nextState.typingState.byContactId[contactId],
      events: {
        type: 'conversation.contactTyping.updated',
        domain: 'typingState',
        entityId: contactId,
        changedPaths: [`typingState.byContactId.${contactId}.contact`],
        priority: 'high',
        payload: {
          contactId,
          conversationId: contact.conversationId,
          platform: contact.platform,
          isTyping,
          activity,
          lastUpdated,
          expiresAt: contact.expiresAt,
          reason: contact.reason
        }
      }
    };
  });

  storeManager.registerCommand('UPDATE_SELF_TYPING_STATE', ({ command, cloneState, now, fail }) => {
    const contactId = clean(command.payload.contactId);
    if (!contactId) fail('CONTACT_ID_REQUIRED', 'Self typing state requires a stable contactId');
    const nextState = cloneState();
    const previous = nextState.typingState.byContactId[contactId] || {};
    const isTyping = command.payload.isTyping === true;
    const activity = clean(command.payload.activity) || (isTyping ? 'composing' : 'paused');
    const lastUpdated = clean(command.payload.lastUpdated) || now();
    const ttlMs = Math.max(1000, Math.min(30000, Number(command.payload.ttlMs || 5000)));
    const timestamp = Number.isFinite(Date.parse(lastUpdated)) ? Date.parse(lastUpdated) : Date.now();
    const self = {
      ...(previous.self || {}),
      isTyping,
      activity,
      phase: clean(command.payload.phase || previous.self?.phase),
      lastUpdated,
      expiresAt: isTyping ? new Date(timestamp + ttlMs).toISOString() : '',
      conversationId: clean(command.payload.conversationId || previous.self?.conversationId || previous.conversationId),
      accountId: clean(command.payload.accountId || previous.self?.accountId || previous.accountId),
      platform: clean(command.payload.platform || previous.self?.platform || previous.platform),
      reason: clean(command.payload.reason)
    };
    const contact = previous.contact || {
      isTyping: false,
      activity: 'paused',
      lastUpdated: '',
      expiresAt: ''
    };
    nextState.typingState.byContactId[contactId] = {
      ...previous,
      contactId,
      conversationId: self.conversationId || previous.conversationId || '',
      accountId: self.accountId || previous.accountId || '',
      platform: self.platform || previous.platform || '',
      isTyping: contact.isTyping === true,
      lastUpdated: contact.lastUpdated || '',
      expiresAt: contact.expiresAt || '',
      activity: contact.activity || 'paused',
      contact,
      self
    };
    nextState.typingState.ready = true;
    return {
      nextState,
      changedDomains: ['typingState'],
      ephemeral: true,
      result: nextState.typingState.byContactId[contactId],
      events: {
        type: 'conversation.selfTyping.updated',
        domain: 'typingState',
        entityId: contactId,
        changedPaths: [`typingState.byContactId.${contactId}.self`],
        priority: 'high',
        payload: {
          contactId,
          conversationId: self.conversationId,
          platform: self.platform,
          isTyping,
          activity,
          phase: self.phase,
          lastUpdated,
          expiresAt: self.expiresAt,
          reason: self.reason
        }
      }
    };
  });

  storeManager.registerCommand('SYNC_CUSTOMER_ARCHIVE', ({ command, state, cloneState }) => {
    const contactId = clean(command.payload.contactId);
    if (!contactId || !state.customers.byId[contactId]) return { noop: true, result: { contactId } };
    const archived = command.payload.archived === true;
    const nextState = cloneState();
    const customer = nextState.customers.byId[contactId];
    customer.archived = archived;
    customer.archivedAt = archived ? clean(command.payload.archivedAt) || new Date().toISOString() : '';
    customer.archiveReason = archived ? clean(command.payload.archiveReason || command.payload.reason) : '';
    customer.version = Number(customer.version || 0) + 1;
    nextState.customers.activeIds = nextState.customers.activeIds.filter(id => id !== contactId);
    nextState.customers.archivedIds = nextState.customers.archivedIds.filter(id => id !== contactId);
    (archived ? nextState.customers.archivedIds : nextState.customers.activeIds).push(contactId);
    if (archived && nextState.customers.currentId === contactId) nextState.customers.currentId = nextState.customers.activeIds[0] || '';
    const policy = nextState.interactionPolicies.byContactId[contactId] || { version: 0 };
    policy.version = Number(policy.version || 0) + 1;
    policy.blocked = archived;
    policy.blockReason = archived ? 'ARCHIVED_CUSTOMER_READ_ONLY' : '';
    policy.allowReplies = !archived;
    policy.allowProactive = false;
    policy.policy = archived ? 'manual_only' : 'reply_normally';
    nextState.interactionPolicies.byContactId[contactId] = policy;
    return {
      nextState,
      changedDomains: ['customers', 'interactionPolicies'],
      result: { contactId, archived },
      events: {
        type: archived ? 'customer.archived' : 'customer.restored',
        domain: 'customers',
        entityId: contactId,
        changedPaths: [
          `customers.byId.${contactId}.archived`,
          'customers.activeIds',
          'customers.archivedIds',
          `interactionPolicies.byContactId.${contactId}`
        ],
        payload: { contactId, archived }
      },
      persist: transaction => transaction?.upsertInteractionPolicy?.({ contactId, ...policy, calculatedAt: new Date().toISOString() })
    };
  });
}

module.exports = { registerRuntimeStateCommands };
