'use strict';

const { randomUUID, createHash } = require('crypto');
const { createInitialState } = require('../StoreManager');
const { RECENT_SOCIAL_MESSAGE_LIMIT } = require('../social/learningPolicy');
const { normalizeAppearanceState } = require('../themeAppearancePolicy');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseJson(value, fallback) {
  try {
    return value == null || value === '' ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function bool(value, fallback = false) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function toAccount(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  const legacyVerifiedSend = bool(row.can_send);
  const canAttemptSend = typeof payload.canAttemptSend === 'boolean'
    ? payload.canAttemptSend
    : legacyVerifiedSend;
  const sendVerified = typeof payload.sendVerified === 'boolean'
    ? payload.sendVerified
    : legacyVerifiedSend;
  return {
    ...payload,
    id: row.id,
    platform: row.platform,
    adapterAccountId: row.adapter_account_id,
    displayName: row.display_name,
    identityLabel: row.identity_label,
    state: row.state || (legacyVerifiedSend ? 'ready' : ''),
    canAttemptSend,
    sendVerified,
    // Legacy can_send is an ACK-verified compatibility field. It must never be
    // re-derived from connected state, but existing verified rows remain valid.
    canSend: sendVerified,
    canReceive: bool(row.can_receive),
    version: Number(payload.version || 1),
    updatedAt: row.updated_at
  };
}

function toCustomer(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  return {
    ...payload,
    id: row.id,
    contactId: row.id,
    platform: row.platform,
    accountId: row.account_id,
    externalId: row.external_id,
    displayName: row.display_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    avatarUpdatedAt: row.avatar_updated_at || '',
    avatarStatus: row.avatar_status || '',
    tags: parseJson(row.tags_json, []) || [],
    aliases: parseJson(row.aliases_json, []) || [],
    canonicalContactId: row.canonical_contact_id || row.id,
    customerProfileId: row.canonical_contact_id || row.id,
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at || '',
    archiveReason: row.archive_reason || '',
    version: Number(payload.storeVersion || payload.version || 1),
    updatedAt: row.updated_at
  };
}

function toConversation(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  return {
    ...payload,
    id: row.session_key,
    sessionKey: row.session_key,
    conversationId: row.session_key,
    accountId: row.account_id,
    contactId: row.contact_id,
    platform: row.platform,
    title: row.title,
    avatarUrl: row.avatar_url,
    avatarUpdatedAt: row.avatar_updated_at || '',
    avatarStatus: row.avatar_status || '',
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count || 0),
    routeState: row.route_state,
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at || '',
    pinned: payload.pinned === true,
    pinnedAt: String(payload.pinnedAt || ''),
    pinnedBy: String(payload.pinnedBy || ''),
    version: Number(payload.storeVersion || payload.version || 1),
    updatedAt: row.updated_at
  };
}

function toMessage(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  return {
    ...payload,
    id: row.id,
    messageId: row.id,
    conversationId: row.session_key,
    sessionKey: row.session_key,
    accountId: row.account_id,
    senderId: row.sender_id,
    role: row.role,
    direction: row.direction,
    type: row.message_type,
    messageType: row.message_type,
    text: row.text,
    sentAt: row.sent_at,
    timestamp: row.sent_at,
    fromMe: row.direction === 'outbound' || row.direction === 'outgoing' || payload.fromMe === true
  };
}

function toMemory(profileRow) {
  if (!profileRow) return null;
  const payload = parseJson(profileRow.payload_json, {}) || {};
  const traits = parseJson(profileRow.traits_json, {}) || {};
  const confirmedFacts = parseJson(profileRow.confirmed_facts_json, []) || [];
  const inferredFacts = parseJson(profileRow.inferred_facts_json, []) || [];
  return {
    version: Number(profileRow.profile_version || 1),
    confirmedFacts,
    inferredFacts,
    userNotes: profileRow.notes ? [{ text: profileRow.notes, source: 'manual_note', confidence: 1 }] : [],
    importantEvents: Array.isArray(payload.importantEvents) ? payload.importantEvents : [],
    openLoops: Array.isArray(payload.openLoops) ? payload.openLoops : [],
    promises: Array.isArray(payload.promises || payload.commitments) ? (payload.promises || payload.commitments) : [],
    boundaries: Array.isArray(payload.boundaries) ? payload.boundaries : [],
    sensitiveTopics: Array.isArray(payload.sensitiveTopics) ? payload.sensitiveTopics : [],
    recurringInterests: Array.isArray(payload.recurringInterests) ? payload.recurringInterests : [],
    preferences: {
      ...(traits.preferences || {}),
      ...(payload.preferences || {})
    },
    updatedAt: profileRow.updated_at
  };
}

function toRelationshipState(row, insightRow, timeline, signals) {
  const insightPayload = parseJson(insightRow?.payload_json, {}) || {};
  const dimensions = parseJson(insightRow?.dimensions_json, {}) || {};
  if (!row && !insightRow && !timeline.length && !signals.length) return null;
  return {
    version: Number(row?.version || insightPayload.storeVersion || 1),
    stage: clean(parseJson(row?.relationship_json, {})?.stage || insightRow?.relationship_stage) || 'unknown',
    relationship: parseJson(row?.relationship_json, {}) || {},
    emotion: parseJson(row?.emotion_json, {}) || {},
    interaction: parseJson(row?.interaction_json, {}) || {},
    preferences: parseJson(row?.preferences_json, {}) || {},
    strategy: parseJson(row?.strategy_json, {}) || {},
    potential: {
      relationshipStage: clean(parseJson(row?.potential_json, {})?.relationshipStage || insightRow?.relationship_stage) || 'unknown',
      warmth: Number(parseJson(row?.potential_json, {})?.warmth ?? insightRow?.intimacy_score ?? 0),
      openness: Number(parseJson(row?.potential_json, {})?.openness ?? insightRow?.openness_score ?? 0),
      trust: Number(parseJson(row?.potential_json, {})?.trust ?? dimensions.trust ?? 0),
      initiative: Number(parseJson(row?.potential_json, {})?.initiative ?? insightRow?.initiative_score ?? 0),
      tension: Number(parseJson(row?.potential_json, {})?.tension ?? insightRow?.response_pressure_score ?? 0),
      momentum: clean(parseJson(row?.potential_json, {})?.momentum || insightPayload.momentum) || 'stable',
      stability: clean(parseJson(row?.potential_json, {})?.stability) || 'unknown',
      socialDistance: clean(parseJson(row?.potential_json, {})?.socialDistance) || 'moderate',
      confidence: Number(parseJson(row?.potential_json, {})?.confidence ?? 0.5)
    },
    timeline,
    signals,
    updatedAt: row?.updated_at || insightRow?.updated_at || ''
  };
}

function toPolicy(row) {
  if (!row) return null;
  const config = parseJson(row.config_json, {}) || {};
  return {
    version: Number(row.version || 1),
    policy: row.policy,
    allowReplies: bool(row.allow_replies, true),
    allowProactive: bool(row.allow_proactive, false),
    blocked: bool(row.blocked, false),
    blockReason: row.block_reason || '',
    proactiveMessageBudget7d: Number(row.proactive_budget_7d || 0),
    usedThisWeek: Number(row.used_this_week || 0),
    unansweredLimit: Number(row.unanswered_limit ?? 1),
    minimumIntervalHours: Number(row.minimum_interval_hours || 18),
    nextAllowedProactiveAt: row.next_allowed_proactive_at || '',
    replyStrategy: parseJson(row.reply_strategy_json, {}) || {},
    manualApprovalRequired: config.manualApprovalRequired !== false,
    config,
    calculatedAt: row.calculated_at,
    updatedAt: row.updated_at
  };
}

function toOutbox(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    candidateId: row.candidate_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    accountId: row.account_id,
    platform: row.platform,
    text: row.text,
    originalText: row.original_text,
    state: row.state,
    userApproved: bool(row.user_approved),
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    sendQueueId: row.send_queue_id,
    contextVersion: Number(row.context_version || 0),
    metadata: parseJson(row.metadata_json, {}) || {},
    personaProfileId: row.persona_profile_id || 'owner',
    personaVersionId: Number(row.persona_version_id || 0),
    personaPolicyHash: row.persona_policy_hash || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class SqliteStorePersistenceAdapter {
  constructor(options = {}) {
    if (!options.store || !options.store.db || typeof options.store.transactionAsync !== 'function') {
      const error = new TypeError('SqliteStorePersistenceAdapter requires the broker-owned primary store capability');
      error.code = 'PRIMARY_STORE_CAPABILITY_REQUIRED';
      throw error;
    }
    this.store = options.store;
    this.recentMessageLimit = Math.max(8, Math.min(120, Number(options.recentMessageLimit || RECENT_SOCIAL_MESSAGE_LIMIT)));
    this.timelineLimit = Math.max(20, Math.min(500, Number(options.timelineLimit || 120)));
  }

  _hasColumn(table, column) {
    try {
      return this.store.db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
    } catch (_) {
      return false;
    }
  }

  async loadSnapshot() {
    const db = this.store.db;
    const state = createInitialState();

    const accounts = db.prepare('SELECT * FROM r32_accounts ORDER BY updated_at DESC').all();
    for (const row of accounts) state.auth.accountsById[row.id] = toAccount(row);
    state.auth.ready = true;

    const contacts = db.prepare("SELECT * FROM contacts WHERE COALESCE(NULLIF(merged_into_id,''), NULLIF(tombstoned_at,'')) IS NULL ORDER BY updated_at DESC LIMIT 5000").all();
    for (const row of contacts) {
      const customer = toCustomer(row);
      state.customers.byId[customer.id] = customer;
      (customer.archived ? state.customers.archivedIds : state.customers.activeIds).push(customer.id);
    }
    state.customers.currentId = state.customers.activeIds[0] || '';
    state.customers.ready = true;

    const conversations = db.prepare("SELECT * FROM r32_conversations WHERE COALESCE(merged_into,'')='' ORDER BY COALESCE(NULLIF(last_message_at,''), updated_at) DESC LIMIT 2000").all();
    for (const row of conversations) {
      const conversation = toConversation(row);
      state.conversations.byId[conversation.id] = conversation;
      if (conversation.contactId) {
        state.conversations.byContactId[conversation.contactId] ||= [];
        state.conversations.byContactId[conversation.contactId].push(conversation.id);
      }
      const messages = db.prepare(`
        SELECT * FROM r32_messages
        WHERE session_key=?
        ORDER BY COALESCE(NULLIF(sent_at,''), created_at) DESC, id DESC
        LIMIT ?
      `).all(conversation.id, this.recentMessageLimit).reverse().map(toMessage);
      state.conversations.recentMessagesById[conversation.id] = messages;
    }
    state.conversations.ready = true;

    const profiles = new Map(db.prepare('SELECT * FROM customer_profiles').all().map(row => [row.contact_id, row]));
    for (const contactId of Object.keys(state.customers.byId)) {
      const memory = toMemory(profiles.get(contactId));
      state.memories.byContactId[contactId] = memory || {
        version: 1,
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
    }
    const feedbackProfiles = db.prepare("SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact'").all();
    for (const row of feedbackProfiles) {
      state.memories.byContactId[row.scope_id] ||= { version: 1, preferences: {} };
      state.memories.byContactId[row.scope_id].feedbackLearning = parseJson(row.profile_json, {}) || {};
    }

    const preferenceRows = db.prepare('SELECT * FROM customer_interaction_preferences').all();
    for (const row of preferenceRows) {
      state.memories.byContactId[row.contact_id] ||= { version: 1, preferences: {} };
      state.memories.byContactId[row.contact_id].preferences ||= {};
      state.memories.byContactId[row.contact_id].preferences[row.preference_key] = parseJson(row.value_json, null);
      state.memories.byContactId[row.contact_id].preferences.evidence ||= [];
      state.memories.byContactId[row.contact_id].preferences.evidence.push({
        key: row.preference_key,
        confidence: Number(row.confidence || 0),
        evidenceCount: Number(row.evidence_count || 0),
        evidenceMessageIds: parseJson(row.evidence_message_ids_json, []) || [],
        source: row.source,
        firstObservedAt: row.first_observed_at,
        lastConfirmedAt: row.last_confirmed_at
      });
    }
    state.memories.ready = true;

    const insightRows = new Map(db.prepare('SELECT * FROM relationship_insights').all().map(row => [row.contact_id, row]));
    const socialRows = new Map(db.prepare('SELECT * FROM customer_social_state').all().map(row => [row.contact_id, row]));
    const signalRows = db.prepare(`
      SELECT * FROM relationship_state_signals
      ORDER BY observed_at ASC, signal_id ASC
    `).all();
    const timelineRows = db.prepare(`
      SELECT * FROM relationship_timeline_events
      ORDER BY confirmed_at ASC, event_id ASC
    `).all();
    const signalsByContact = {};
    for (const row of signalRows) {
      signalsByContact[row.contact_id] ||= [];
      signalsByContact[row.contact_id].push({
        signalId: row.signal_id,
        idempotencyKey: row.idempotency_key || '',
        platform: row.platform || '',
        sourceAccountId: row.source_account_id || '',
        platformMessageId: row.platform_message_id || row.message_id,
        projectionVersion: row.projection_version || row.parser_version || '1.0',
        contactId: row.contact_id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        signalType: row.signal_type,
        dimension: row.dimension,
        direction: row.direction,
        strength: Number(row.strength || 0),
        confidence: Number(row.confidence || 0),
        observedAt: row.observed_at,
        evidence: parseJson(row.evidence_json, {}) || {},
        source: row.source,
        parserVersion: row.parser_version,
        status: row.status
      });
      if (signalsByContact[row.contact_id].length > this.timelineLimit) signalsByContact[row.contact_id].shift();
    }
    const timelineByContact = {};
    for (const row of timelineRows) {
      timelineByContact[row.contact_id] ||= [];
      timelineByContact[row.contact_id].push({
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key || '',
        platform: row.platform || '',
        sourceAccountId: row.source_account_id || '',
        platformMessageId: row.platform_message_id || '',
        projectionVersion: row.projection_version || row.engine_version || '1.0',
        contactId: row.contact_id,
        conversationId: row.conversation_id,
        eventType: row.event_type,
        startedAt: row.started_at,
        confirmedAt: row.confirmed_at,
        before: parseJson(row.before_json, {}) || {},
        after: parseJson(row.after_json, {}) || {},
        interpretation: row.interpretation,
        evidenceMessageIds: parseJson(row.evidence_message_ids_json, []) || [],
        sourceSignalIds: parseJson(row.source_signal_ids_json, []) || [],
        confidence: Number(row.confidence || 0),
        status: row.status,
        engineVersion: row.engine_version
      });
      if (timelineByContact[row.contact_id].length > this.timelineLimit) timelineByContact[row.contact_id].shift();
    }
    for (const contactId of Object.keys(state.customers.byId)) {
      state.relationships.byContactId[contactId] = toRelationshipState(
        socialRows.get(contactId),
        insightRows.get(contactId),
        timelineByContact[contactId] || [],
        signalsByContact[contactId] || []
      ) || {
        version: 1,
        stage: 'unknown',
        potential: {},
        emotion: {},
        interaction: {},
        timeline: [],
        signals: []
      };
    }
    state.relationships.ready = true;

    const policyRows = new Map(db.prepare('SELECT * FROM interaction_policies').all().map(row => [row.contact_id, row]));
    for (const contactId of Object.keys(state.customers.byId)) {
      state.interactionPolicies.byContactId[contactId] = toPolicy(policyRows.get(contactId)) || {
        version: 1,
        policy: 'reply_normally',
        allowReplies: true,
        allowProactive: false,
        blocked: false,
        blockReason: '',
        proactiveMessageBudget7d: 0,
        usedThisWeek: 0,
        unansweredLimit: 1,
        minimumIntervalHours: 18,
        nextAllowedProactiveAt: '',
        replyStrategy: {}
      };
    }
    state.interactionPolicies.ready = true;

    const modelDocument = this.store.getSetting('model-registry', 'document', {}) || {};
    for (const model of modelDocument.models || []) state.models.byId[model.id] = { ...model };
    state.models.routes = { ...(modelDocument.routes || {}) };
    state.models.ready = true;
    state.routing.byTask = { ...(modelDocument.routes || {}) };
    state.routing.ready = true;

    const taskRows = db.prepare(`
      SELECT * FROM ai_reply_tasks
      WHERE status NOT IN ('committed','cancelled','failed','rejected')
      ORDER BY updated_at DESC LIMIT 500
    `).all();
    for (const row of taskRows) {
      state.aiBrain.tasksById[row.task_id] = {
        taskId: row.task_id,
        contactId: row.contact_id,
        conversationId: row.conversation_id,
        contextVersion: Number(row.context_version || 0),
        conversationRevision: Number(row.conversation_revision || 0),
        performanceMode: row.performance_mode || 'balanced',
        source: row.reply_source || 'local_model',
        entityVersions: parseJson(row.entity_versions_json, {}) || {},
        status: row.status,
        cancelReason: row.cancel_reason,
        error: row.error_text,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    const candidateRows = db.prepare(`
      SELECT * FROM ai_reply_candidates
      WHERE state NOT IN ('sent','cancelled','rejected')
      ORDER BY updated_at DESC LIMIT 500
    `).all();
    for (const row of candidateRows) {
      const replyStrategy = parseJson(row.reply_strategy_json, {}) || {};
      const chineseUnderstanding = replyStrategy._chineseUnderstanding || {};
      const generationMetadata = replyStrategy._generation || {};
      state.aiBrain.candidatesById[row.candidate_id] = {
        candidateId: row.candidate_id,
        taskId: row.task_id,
        contactId: row.contact_id,
        conversationId: row.conversation_id,
        text: row.text,
        originalText: row.original_text,
        modelId: row.model_id,
        model: row.model_name,
        contextVersion: Number(row.context_version || 0),
        conversationRevision: Number(row.conversation_revision || 0),
        contextMessageIds: parseJson(row.context_message_ids_json, []) || [],
        performanceMode: row.performance_mode || 'balanced',
        source: row.reply_source || 'local_model',
        entityVersions: parseJson(row.entity_versions_json, {}) || {},
        translatedZh: clean(chineseUnderstanding.translatedZh),
        translationStatus: clean(chineseUnderstanding.translationStatus),
        translationModel: clean(chineseUnderstanding.translationModel),
        targetLanguage: clean(chineseUnderstanding.targetLanguage || generationMetadata.targetLanguage),
        replyTask: clean(generationMetadata.replyTask),
        director: { ...(replyStrategy._director || {}) },
        generationMetadata,
        replyStrategy,
        relationshipPotential: parseJson(row.relationship_potential_json, {}) || {},
        state: row.state,
        personaProfileId: row.persona_profile_id || 'owner',
        personaVersionId: Number(row.persona_version_id || 0),
        personaPolicyHash: row.persona_policy_hash || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    state.aiBrain.ready = true;

    const outboxRows = db.prepare(`
      SELECT * FROM ai_reply_outbox
      WHERE state NOT IN ('sent','cancelled')
      ORDER BY updated_at DESC LIMIT 500
    `).all();
    for (const row of outboxRows) state.outbox.byId[row.id] = toOutbox(row);
    state.outbox.ready = true;

    const uiDocument = this.store.getSetting('store-ui-state', 'document', {}) || {};
    state.ui.readingMode = ['standard', 'comfortable', 'large'].includes(clean(uiDocument.readingMode))
      ? clean(uiDocument.readingMode)
      : 'comfortable';
    state.ui.density = ['comfortable', 'compact'].includes(clean(uiDocument.density))
      ? clean(uiDocument.density)
      : 'comfortable';
    state.ui.contrastMode = ['standard', 'high'].includes(clean(uiDocument.contrastMode))
      ? clean(uiDocument.contrastMode)
      : 'high';
    Object.assign(state.ui, normalizeAppearanceState(uiDocument));
    state.ui.updatedAt = clean(uiDocument.updatedAt);
    state.ui.ready = true;
    state.system.ready = true;
    state.meta.stateVersion = Number(this.store.getMeta('storeStateVersion', 0) || 0);
    state.meta.domainVersions = this.store.getMeta('storeDomainVersions', {}) || {};
    state.meta.lastTransactionId = clean(this.store.getMeta('lastStoreTransactionId', ''));
    return state;
  }

  async transaction(work, metadata = {}) {
    return this.store.transactionAsync(async () => {
      const transaction = this._createTransaction(metadata);
      return work(transaction);
    });
  }

  _createTransaction(metadata = {}) {
    const db = this.store.db;
    const timestamp = nowIso();
    return {
      metadata,
      db,
      upsertSocialSignals: rows => {
        const statement = db.prepare(`
          INSERT INTO relationship_state_signals(
            signal_id, idempotency_key, platform, source_account_id, platform_message_id, projection_version,
            contact_id, conversation_id, message_id, signal_type,
            dimension, direction, strength, confidence, observed_at,
            evidence_json, source, parser_version, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO UPDATE SET
            platform=excluded.platform,
            source_account_id=excluded.source_account_id,
            platform_message_id=excluded.platform_message_id,
            projection_version=excluded.projection_version,
            contact_id=excluded.contact_id,
            conversation_id=excluded.conversation_id,
            message_id=excluded.message_id,
            signal_type=excluded.signal_type,
            dimension=excluded.dimension,
            direction=excluded.direction,
            strength=excluded.strength,
            confidence=excluded.confidence,
            observed_at=excluded.observed_at,
            evidence_json=excluded.evidence_json,
            source=excluded.source,
            parser_version=excluded.parser_version,
            status=excluded.status,
            updated_at=excluded.updated_at
        `);
        for (const row of rows || []) statement.run(
          row.signalId, row.idempotencyKey || '', row.platform || '', row.sourceAccountId || '',
          row.platformMessageId || row.messageId || '', row.projectionVersion || row.parserVersion || '1.0',
          row.contactId, row.conversationId || '', row.messageId,
          row.signalType, row.dimension, row.direction,
          Number(row.strength || 0), Number(row.confidence || 0), row.observedAt || timestamp,
          json(row.evidence || {}), row.source || 'social_parser', row.parserVersion || '1.0',
          row.status || 'candidate', timestamp, timestamp
        );
      },
      upsertTimelineEvents: rows => {
        const statement = db.prepare(`
          INSERT INTO relationship_timeline_events(
            event_id, idempotency_key, platform, source_account_id, platform_message_id, projection_version,
            contact_id, conversation_id, event_type, started_at,
            confirmed_at, before_json, after_json, interpretation,
            evidence_message_ids_json, source_signal_ids_json, confidence,
            status, engine_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO UPDATE SET
            platform=excluded.platform,
            source_account_id=excluded.source_account_id,
            platform_message_id=excluded.platform_message_id,
            projection_version=excluded.projection_version,
            contact_id=excluded.contact_id,
            conversation_id=excluded.conversation_id,
            event_type=excluded.event_type,
            started_at=excluded.started_at,
            confirmed_at=excluded.confirmed_at,
            before_json=excluded.before_json,
            after_json=excluded.after_json,
            interpretation=excluded.interpretation,
            evidence_message_ids_json=excluded.evidence_message_ids_json,
            source_signal_ids_json=excluded.source_signal_ids_json,
            confidence=excluded.confidence,
            status=excluded.status,
            engine_version=excluded.engine_version,
            updated_at=excluded.updated_at
        `);
        for (const row of rows || []) statement.run(
          row.eventId, row.idempotencyKey || '', row.platform || '', row.sourceAccountId || '',
          row.platformMessageId || row.evidenceMessageIds?.[0] || '', row.projectionVersion || row.engineVersion || '1.0',
          row.contactId, row.conversationId || '', row.eventType,
          row.startedAt || timestamp, row.confirmedAt || row.startedAt || timestamp,
          json(row.before || {}), json(row.after || {}), row.interpretation || '',
          json(row.evidenceMessageIds || []), json(row.sourceSignalIds || []),
          Number(row.confidence || 0), row.status || 'candidate', row.engineVersion || '1.0',
          timestamp, timestamp
        );
      },
      upsertCustomerSocialState: row => {
        db.prepare(`
          INSERT INTO customer_social_state(
            contact_id, relationship_json, emotion_json, interaction_json,
            preferences_json, strategy_json, potential_json, version,
            source_message_id, source_message_at, calculated_at, engine_version,
            payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contact_id) DO UPDATE SET
            relationship_json=excluded.relationship_json,
            emotion_json=excluded.emotion_json,
            interaction_json=excluded.interaction_json,
            preferences_json=excluded.preferences_json,
            strategy_json=excluded.strategy_json,
            potential_json=excluded.potential_json,
            version=excluded.version,
            source_message_id=excluded.source_message_id,
            source_message_at=excluded.source_message_at,
            calculated_at=excluded.calculated_at,
            engine_version=excluded.engine_version,
            payload_json=excluded.payload_json,
            updated_at=excluded.updated_at
        `).run(
          row.contactId,
          json(row.relationship || {}), json(row.emotion || {}), json(row.interaction || {}),
          json(row.preferences || {}), json(row.strategy || {}), json(row.potential || {}),
          Number(row.version || 1), row.sourceMessageId || '', row.sourceMessageAt || '',
          row.calculatedAt || timestamp, row.engineVersion || '1.0', json(row.payload || {}),
          row.createdAt || timestamp, timestamp
        );
      },
      upsertInteractionPreferences: row => {
        const values = row.preferences || {};
        const evidence = values.evidence || {};
        const statement = db.prepare(`
          INSERT INTO customer_interaction_preferences(
            contact_id, preference_key, value_json, confidence, evidence_count,
            evidence_message_ids_json, source, first_observed_at,
            last_confirmed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contact_id, preference_key) DO UPDATE SET
            value_json=excluded.value_json,
            confidence=excluded.confidence,
            evidence_count=excluded.evidence_count,
            evidence_message_ids_json=excluded.evidence_message_ids_json,
            source=excluded.source,
            last_confirmed_at=excluded.last_confirmed_at,
            updated_at=excluded.updated_at
        `);
        const ignored = new Set(['evidence', 'evidenceCount', 'confidence', 'engineVersion', 'updatedAt']);
        for (const [key, value] of Object.entries(values)) {
          if (ignored.has(key) || value === undefined) continue;
          statement.run(
            row.contactId, key, json(value), Number(values.confidence || row.confidence || 0),
            Number(values.evidenceCount || row.evidenceCount || 0),
            json(row.evidenceMessageIds || []), row.source || 'preference_learning',
            row.firstObservedAt || timestamp, row.lastConfirmedAt || timestamp, timestamp
          );
        }
      },
      upsertInteractionPolicy: row => {
        db.prepare(`
          INSERT INTO interaction_policies(
            contact_id, policy, allow_replies, allow_proactive, blocked,
            block_reason, proactive_budget_7d, used_this_week, unanswered_limit,
            minimum_interval_hours, next_allowed_proactive_at, reply_strategy_json,
            config_json, version, calculated_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contact_id) DO UPDATE SET
            policy=excluded.policy,
            allow_replies=excluded.allow_replies,
            allow_proactive=excluded.allow_proactive,
            blocked=excluded.blocked,
            block_reason=excluded.block_reason,
            proactive_budget_7d=excluded.proactive_budget_7d,
            used_this_week=excluded.used_this_week,
            unanswered_limit=excluded.unanswered_limit,
            minimum_interval_hours=excluded.minimum_interval_hours,
            next_allowed_proactive_at=excluded.next_allowed_proactive_at,
            reply_strategy_json=excluded.reply_strategy_json,
            config_json=excluded.config_json,
            version=excluded.version,
            calculated_at=excluded.calculated_at,
            updated_at=excluded.updated_at
        `).run(
          row.contactId, row.policy || 'reply_normally', row.allowReplies === false ? 0 : 1,
          row.allowProactive === true ? 1 : 0, row.blocked === true ? 1 : 0,
          row.blockReason || '', Number(row.proactiveMessageBudget7d || 0),
          Number(row.usedThisWeek || 0), Number(row.unansweredLimit ?? 1),
          Number(row.minimumIntervalHours || 18), row.nextAllowedProactiveAt || '',
          json(row.replyStrategy || {}), json(row.config || {}), Number(row.version || 1),
          row.calculatedAt || timestamp, row.createdAt || timestamp, timestamp
        );
      },
      upsertDeterministicCustomerFacts: row => {
        const requestedContactId = clean(row.contactId);
        if (!requestedContactId) return;

        const contactColumns = this._hasColumn('contacts', 'canonical_contact_id')
          ? 'id, canonical_contact_id'
          : 'id';
        const directContact = db.prepare(`SELECT ${contactColumns} FROM contacts WHERE id=?`).get(requestedContactId);
        let profileContactId = clean(row.canonicalContactId || directContact?.canonical_contact_id || requestedContactId);
        const canonicalExists = profileContactId
          ? db.prepare('SELECT id FROM contacts WHERE id=?').get(profileContactId)
          : null;
        if (!canonicalExists) profileContactId = clean(directContact?.id || requestedContactId);
        if (!profileContactId || !db.prepare('SELECT id FROM contacts WHERE id=?').get(profileContactId)) return;

        const currentRow = db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get(profileContactId);
        const currentFacts = parseJson(currentRow?.facts_json, {}) || {};
        const currentConfirmed = parseJson(currentRow?.confirmed_facts_json, []) || [];
        const currentPayload = parseJson(currentRow?.payload_json, {}) || {};
        const incomingFacts = row.profileFacts && typeof row.profileFacts === 'object' && !Array.isArray(row.profileFacts)
          ? row.profileFacts
          : {};
        const facts = { ...currentFacts, ...incomingFacts };
        if (clean(facts.country) && clean(facts.region)) facts.address = `${clean(facts.country)} · ${clean(facts.region)}`;

        const byIdentity = new Map();
        const factIdentity = value => {
          const key = clean(value?.key || value?.factKey || value?.field).toLowerCase();
          const factValue = clean(value?.value || value?.factValue || value?.text).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
          return key && factValue ? `${key}\u001f${factValue}` : '';
        };
        for (const value of [...currentConfirmed, ...(Array.isArray(row.confirmedFacts) ? row.confirmedFacts : [])]) {
          if (!value || typeof value !== 'object') continue;
          const identity = factIdentity(value) || clean(value.id);
          if (!identity) continue;
          const previous = byIdentity.get(identity) || {};
          const evidenceRows = [
            ...(Array.isArray(previous.evidence) ? previous.evidence : []),
            ...(Array.isArray(value.evidence) ? value.evidence : [])
          ];
          const evidenceSeen = new Set();
          const evidence = [];
          for (const evidenceRow of evidenceRows) {
            const evidenceId = clean(evidenceRow?.platformMessageId || evidenceRow?.messageId || evidenceRow?.sourceMessageId);
            const evidenceText = clean(evidenceRow?.sourceText || evidenceRow?.text);
            const evidenceKey = `${evidenceId}\u001f${evidenceText}`;
            if ((!evidenceId && !evidenceText) || evidenceSeen.has(evidenceKey)) continue;
            evidenceSeen.add(evidenceKey);
            evidence.push(evidenceRow);
          }
          byIdentity.set(identity, { ...previous, ...value, evidence: evidence.slice(-12) });
        }
        const confirmedFacts = [...byIdentity.values()].slice(-160);

        const recurringInterests = [];
        const interestSeen = new Set();
        for (const interest of [
          ...(Array.isArray(currentPayload.recurringInterests) ? currentPayload.recurringInterests : []),
          ...(Array.isArray(row.recurringInterests) ? row.recurringInterests : [])
        ]) {
          const value = clean(typeof interest === 'string' ? interest : interest?.value || interest?.text).normalize('NFKC').replace(/\s+/g, ' ');
          const identity = value.toLowerCase();
          if (!value || interestSeen.has(identity)) continue;
          interestSeen.add(identity);
          recurringInterests.push(typeof interest === 'string' ? { value, text: value, source: '历史记忆' } : { ...interest, value, text: clean(interest.text) || value });
        }

        const payload = {
          ...currentPayload,
          recurringInterests: recurringInterests.slice(-80),
          deterministicFactExtraction: {
            status: 'completed',
            version: clean(row.extractionVersion),
            sourceMessageId: clean(row.sourceMessageId),
            sourceMessageAt: clean(row.sourceMessageAt),
            conversationId: clean(row.conversationId),
            platform: clean(row.platform).toLowerCase(),
            sourceAccountId: clean(row.sourceAccountId),
            completedAt: timestamp
          }
        };
        const profileVersion = Math.max(1, Number(currentRow?.profile_version || 0) + 1);
        const reviewStatus = clean(currentRow?.review_status || 'manual') || 'manual';
        db.prepare(`
          INSERT INTO customer_profiles(
            contact_id, facts_json, confirmed_facts_json, review_status, profile_version,
            payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contact_id) DO UPDATE SET
            facts_json=excluded.facts_json,
            confirmed_facts_json=excluded.confirmed_facts_json,
            review_status=excluded.review_status,
            profile_version=excluded.profile_version,
            payload_json=excluded.payload_json,
            updated_at=excluded.updated_at
        `).run(
          profileContactId, json(facts), json(confirmedFacts), reviewStatus, profileVersion,
          json(payload), currentRow?.created_at || timestamp, timestamp
        );

        const evidenceStatement = db.prepare(`
          INSERT INTO customer_profile_evidence(
            evidence_id, idempotency_key, canonical_contact_id, platform, source_account_id,
            platform_contact_identity, conversation_id, platform_message_id, evidence_type,
            projection_version, source_text, translated_zh, translation_status,
            translation_model, confidence, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            canonical_contact_id=excluded.canonical_contact_id,
            platform=excluded.platform,
            source_account_id=excluded.source_account_id,
            platform_contact_identity=excluded.platform_contact_identity,
            conversation_id=excluded.conversation_id,
            platform_message_id=excluded.platform_message_id,
            evidence_type=excluded.evidence_type,
            projection_version=excluded.projection_version,
            source_text=excluded.source_text,
            translated_zh=excluded.translated_zh,
            translation_status=excluded.translation_status,
            translation_model=excluded.translation_model,
            confidence=excluded.confidence,
            payload_json=excluded.payload_json,
            updated_at=excluded.updated_at
        `);
        for (const fact of Array.isArray(row.evidence) ? row.evidence : []) {
          if (!fact || clean(fact.direction).toLowerCase() !== 'inbound' || clean(fact.speaker).toLowerCase() !== 'peer') continue;
          const platformMessageId = clean(fact.platformMessageId || fact.messageId || fact.sourceMessageId || row.sourceMessageId);
          const sourceText = clean(fact.sourceText || fact.evidence?.[0]?.sourceText);
          if (!platformMessageId || !sourceText) continue;
          const factKey = clean(fact.key || fact.factKey || 'fact').toLowerCase();
          const factValue = clean(fact.value || fact.factValue || fact.text);
          const evidenceId = clean(fact.id) || randomUUID();
          const idempotencyKey = clean(fact.id) || [
            clean(row.platform).toLowerCase(), clean(row.sourceAccountId), clean(row.conversationId),
            platformMessageId, factKey, factValue
          ].join('\u001f');
          evidenceStatement.run(
            evidenceId, idempotencyKey, profileContactId, clean(row.platform).toLowerCase(),
            clean(row.sourceAccountId), clean(row.canonicalContactId || requestedContactId),
            clean(row.conversationId), platformMessageId, `fact:${factKey}`,
            clean(row.extractionVersion || fact.extractionVersion || '1'), sourceText,
            clean(fact.translatedZh || fact.evidence?.[0]?.translatedZh),
            clean(fact.translatedZh || fact.evidence?.[0]?.translatedZh) ? 'success' : '',
            '', Number(fact.confidence || 100),
            json({
              factKey,
              factValue,
              title: clean(fact.title || fact.label),
              status: clean(fact.status || 'confirmed'),
              direction: 'inbound',
              speaker: 'peer',
              extractionMethod: clean(fact.extractionMethod || 'deterministic-rule'),
              extractionVersion: clean(row.extractionVersion || fact.extractionVersion),
              evidence: Array.isArray(fact.evidence) ? fact.evidence : []
            }),
            clean(fact.confirmedAt || row.sourceMessageAt || timestamp), timestamp
          );
        }
      },
      upsertAiReplyTask: row => {
        const columns = [
          'task_id', 'contact_id', 'conversation_id', 'context_version',
          'entity_versions_json', 'status', 'cancel_reason', 'error_text'
        ];
        const values = [
          row.taskId, row.contactId, row.conversationId, Number(row.contextVersion || 0),
          json(row.entityVersions || {}), row.status || 'queued', row.cancelReason || '', row.error || ''
        ];
        const updates = [
          'status=excluded.status', 'cancel_reason=excluded.cancel_reason',
          'error_text=excluded.error_text'
        ];
        for (const [name, value] of [
          ['conversation_revision', Number(row.conversationRevision || 0)],
          ['performance_mode', row.performanceMode || 'balanced'],
          ['reply_source', row.source || 'local_model']
        ]) {
          if (this._hasColumn('ai_reply_tasks', name)) { columns.push(name); values.push(value); updates.push(`${name}=excluded.${name}`); }
        }
        columns.push('created_at', 'updated_at');
        values.push(row.createdAt || timestamp, row.updatedAt || timestamp);
        updates.push('updated_at=excluded.updated_at');
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ai_reply_tasks(${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(task_id) DO UPDATE SET ${updates.join(', ')}`).run(...values);
      },
      upsertAiReplyCandidate: row => {
        const hasProfile = this._hasColumn('ai_reply_candidates', 'persona_profile_id');
        const hasVersion = this._hasColumn('ai_reply_candidates', 'persona_version_id');
        const hasHash = this._hasColumn('ai_reply_candidates', 'persona_policy_hash');
        const columns = [
          'candidate_id', 'task_id', 'contact_id', 'conversation_id', 'text',
          'original_text', 'model_id', 'model_name', 'context_version',
          'entity_versions_json', 'reply_strategy_json', 'relationship_potential_json', 'state'
        ];
        const values = [
          row.candidateId, row.taskId, row.contactId, row.conversationId,
          row.text, row.originalText || row.text, row.modelId || '', row.model || '',
          Number(row.contextVersion || 0), json(row.entityVersions || {}),
          json(row.replyStrategy || {}), json(row.relationshipPotential || {}), row.state || 'generated'
        ];
        const updates = ['text=excluded.text', 'state=excluded.state'];
        if (hasProfile) { columns.push('persona_profile_id'); values.push(clean(row.personaProfileId || 'owner')); updates.push('persona_profile_id=excluded.persona_profile_id'); }
        if (hasVersion) { columns.push('persona_version_id'); values.push(Number(row.personaVersionId || 0)); updates.push('persona_version_id=excluded.persona_version_id'); }
        if (hasHash) { columns.push('persona_policy_hash'); values.push(clean(row.personaPolicyHash || '')); updates.push('persona_policy_hash=excluded.persona_policy_hash'); }
        for (const [name, value] of [
          ['conversation_revision', Number(row.conversationRevision || 0)],
          ['context_message_ids_json', json(row.contextMessageIds || [])],
          ['performance_mode', row.performanceMode || 'balanced'],
          ['reply_source', row.source || 'local_model']
        ]) {
          if (this._hasColumn('ai_reply_candidates', name)) { columns.push(name); values.push(value); updates.push(`${name}=excluded.${name}`); }
        }
        columns.push('created_at', 'updated_at');
        values.push(row.createdAt || timestamp, row.updatedAt || timestamp);
        updates.push('updated_at=excluded.updated_at');
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ai_reply_candidates(${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(candidate_id) DO UPDATE SET ${updates.join(', ')}`).run(...values);
      },
      insertAiContextSnapshot: row => {
        db.prepare(`
          INSERT INTO ai_context_snapshots(
            id, task_id, contact_id, conversation_id, state_version,
            entity_versions_json, context_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id || randomUUID(), row.taskId || '', row.contactId, row.conversationId || '',
          Number(row.stateVersion || 0), json(row.entityVersions || {}), json(row.context || {}),
          row.createdAt || timestamp
        );
      },
      insertReplyFeedbackEvent: row => {
        const columns = [
          'id', 'event_type', 'candidate_id', 'outbox_id', 'contact_id', 'conversation_id',
          'persona_profile_id', 'original_text', 'final_text', 'rejection_reason', 'signals_json'
        ];
        const values = [
          row.id, row.eventType || 'sent', row.candidateId || '', row.outboxId || '',
          row.contactId, row.conversationId || '', row.personaProfileId || 'owner',
          row.originalText || '', row.finalText || '', row.rejectionReason || '', json(row.signals || [])
        ];
        for (const [name, value] of [
          ['reply_source', row.source || 'local_model'],
          ['context_revision', Number(row.contextRevision || 0)],
          ['context_message_ids_json', json(row.contextMessageIds || [])],
          ['performance_mode', row.performanceMode || ''],
          ['platform', row.platform || ''],
          ['source_account_id', row.sourceAccountId || ''],
          ['platform_contact_identity', row.platformContactIdentity || ''],
          ['canonical_contact_id', row.canonicalContactId || ''],
          ['learning_mode', row.learningMode || ''],
          ['target_language', row.targetLanguage || ''],
          ['translated_zh', row.translatedZh || ''],
          ['translation_model', row.translationModel || ''],
          ['model_id', row.modelId || ''],
          ['model_name', row.model || ''],
          ['reply_task', row.replyTask || ''],
          ['style_variant', row.styleVariant || ''],
          ['generation_metadata_json', json(row.generationMetadata || {})]
        ]) {
          if (this._hasColumn('ai_reply_feedback_events', name)) { columns.push(name); values.push(value); }
        }
        columns.push('created_at');
        values.push(row.createdAt || timestamp);
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT OR IGNORE INTO ai_reply_feedback_events(${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
      },
      insertReplyLearningProjectionJob: row => {
        const at = row.createdAt || timestamp;
        db.prepare(`INSERT INTO reply_learning_projection_jobs(
          job_id,evidence_id,contact_id,conversation_id,state,scope_state,l1_state,attempts,claim_token,lease_expires_at,next_attempt_at,last_error,payload_json,created_at,updated_at,completed_at
        ) VALUES(?,?,?,?,'pending','pending','pending',0,'','','','',?,?,?,'')
        ON CONFLICT(evidence_id) DO UPDATE SET
          payload_json=excluded.payload_json,
          updated_at=CASE WHEN reply_learning_projection_jobs.state='completed' THEN reply_learning_projection_jobs.updated_at ELSE excluded.updated_at END
        `).run(
          row.jobId || `learnproj_${String(row.evidenceId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          row.evidenceId, row.contactId, row.conversationId || '', json(row.payload || {}), at, at
        );
      },
      upsertReplyFeedbackProfile: row => {
        const version = Number(row.version || row.profile?.version || 0);
        const updatedAt = row.updatedAt || timestamp;
        const profileJson = json(row.profile || {});
        db.prepare(`
          INSERT INTO ai_reply_feedback_profiles(scope_type, scope_id, profile_json, version, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(scope_type, scope_id) DO UPDATE SET
            profile_json=excluded.profile_json,
            version=excluded.version,
            updated_at=excluded.updated_at
        `).run(row.scopeType, row.scopeId, profileJson, version, updatedAt);
        db.prepare(`
          INSERT OR IGNORE INTO ai_reply_feedback_profile_versions(
            scope_type, scope_id, version, profile_json, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(row.scopeType, row.scopeId, version, profileJson, row.reason || 'learned', updatedAt);
      },
      purgeReplyFeedbackProfile: row => {
        db.prepare('DELETE FROM ai_reply_feedback_profiles WHERE scope_type=? AND scope_id=?')
          .run(row.scopeType, row.scopeId);
        if (row.purgeHistory === true) {
          db.prepare('DELETE FROM ai_reply_feedback_profile_versions WHERE scope_type=? AND scope_id=?')
            .run(row.scopeType, row.scopeId);
        }
      },
      forgetReplyFeedbackContact: row => {
        const contactId = clean(row.contactId);
        if (!contactId) return;
        db.prepare('DELETE FROM ai_reply_feedback_events WHERE contact_id=?').run(contactId);
        db.prepare("DELETE FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").run(contactId);
        db.prepare("DELETE FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").run(contactId);
        try {
          db.prepare("DELETE FROM store_event_log WHERE json_extract(payload_json, '$.contactId')=? AND (event_type LIKE 'ai.reply%' OR event_type LIKE 'outbox.%')")
            .run(contactId);
        } catch (_) {}
      },
      upsertOutboxItem: row => {
        const hasProfile = this._hasColumn('ai_reply_outbox', 'persona_profile_id');
        const hasVersion = this._hasColumn('ai_reply_outbox', 'persona_version_id');
        const hasHash = this._hasColumn('ai_reply_outbox', 'persona_policy_hash');
        const hasTargetLanguage = this._hasColumn('ai_reply_outbox', 'target_language');
        const hasFinalTextHash = this._hasColumn('ai_reply_outbox', 'final_text_sha256');
        const hasIdempotency = this._hasColumn('ai_reply_outbox', 'idempotency_key');
        const hasSendPolicy = this._hasColumn('ai_reply_outbox', 'send_policy_version');
        const hasCapabilitySnapshot = this._hasColumn('ai_reply_outbox', 'capability_snapshot_id');
        const hasApprovalReceipt = this._hasColumn('ai_reply_outbox', 'approval_receipt_id');
        const hasQualityReceipt = this._hasColumn('ai_reply_outbox', 'quality_route_receipt_json');
        const hasLearningEligible = this._hasColumn('ai_reply_outbox', 'learning_eligible');
        const columns = [
          'id', 'task_id', 'candidate_id', 'contact_id', 'conversation_id', 'account_id',
          'platform', 'text', 'original_text', 'state', 'user_approved', 'approved_at',
          'approved_by', 'send_queue_id', 'context_version', 'metadata_json'
        ];
        const values = [
          row.id, row.taskId, row.candidateId, row.contactId, row.conversationId,
          row.accountId || '', row.platform || '', row.text, row.originalText || '',
          row.state || 'draft', row.userApproved === true ? 1 : 0, row.approvedAt || '',
          row.approvedBy || '', row.sendQueueId || '', Number(row.contextVersion || 0), json(row.metadata || {})
        ];
        const updates = [
          'text=excluded.text', 'state=excluded.state', 'user_approved=excluded.user_approved',
          'approved_at=excluded.approved_at', 'approved_by=excluded.approved_by',
          'send_queue_id=excluded.send_queue_id', 'metadata_json=excluded.metadata_json'
        ];
        if (hasProfile) { columns.push('persona_profile_id'); values.push(clean(row.personaProfileId || 'owner')); updates.push('persona_profile_id=excluded.persona_profile_id'); }
        if (hasVersion) { columns.push('persona_version_id'); values.push(Number(row.personaVersionId || 0)); updates.push('persona_version_id=excluded.persona_version_id'); }
        if (hasHash) { columns.push('persona_policy_hash'); values.push(clean(row.personaPolicyHash || '')); updates.push('persona_policy_hash=excluded.persona_policy_hash'); }
        const metadata = row.metadata || {};
        const qualityRouteReceipt = row.qualityRouteReceipt || metadata.qualityRouteReceipt || metadata.generationMetadata?.qualityRouteReceipt || {};
        const emergencyMode = row.emergencyMode === true || metadata.emergencyMode === true || metadata.generationMetadata?.emergencyMode === true;
        if (hasTargetLanguage) {
          columns.push('target_language');
          values.push(clean(row.targetLanguage || metadata.targetLanguageCode || metadata.targetLanguage));
          updates.push('target_language=excluded.target_language');
        }
        if (hasFinalTextHash) {
          const textHash = clean(row.finalTextSha256 || metadata.finalTextSha256) || createHash('sha256').update(clean(row.text)).digest('hex');
          columns.push('final_text_sha256'); values.push(textHash); updates.push('final_text_sha256=excluded.final_text_sha256');
        }
        if (hasIdempotency) {
          columns.push('idempotency_key'); values.push(clean(row.idempotencyKey || metadata.idempotencyKey) || `ai-outbox:${clean(row.id)}`); updates.push('idempotency_key=excluded.idempotency_key');
        }
        if (hasSendPolicy) { columns.push('send_policy_version'); values.push(clean(row.sendPolicyVersion || metadata.sendPolicyVersion)); updates.push('send_policy_version=excluded.send_policy_version'); }
        if (hasCapabilitySnapshot) { columns.push('capability_snapshot_id'); values.push(clean(row.capabilitySnapshotId || metadata.capabilitySnapshotId)); updates.push('capability_snapshot_id=excluded.capability_snapshot_id'); }
        if (hasApprovalReceipt) { columns.push('approval_receipt_id'); values.push(clean(row.approvalReceiptId || metadata.approvalReceiptId)); updates.push('approval_receipt_id=excluded.approval_receipt_id'); }
        if (hasQualityReceipt) { columns.push('quality_route_receipt_json'); values.push(json(qualityRouteReceipt)); updates.push('quality_route_receipt_json=excluded.quality_route_receipt_json'); }
        if (hasLearningEligible) {
          const eligible = row.learningEligible !== false && metadata.learningEligible !== false && qualityRouteReceipt.learningEligible !== false && emergencyMode !== true;
          columns.push('learning_eligible'); values.push(eligible ? 1 : 0); updates.push('learning_eligible=excluded.learning_eligible');
        }
        columns.push('created_at', 'updated_at');
        values.push(row.createdAt || timestamp, timestamp);
        updates.push('updated_at=excluded.updated_at');
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT INTO ai_reply_outbox(${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`).run(...values);
      },
      upsertUiState: row => {
        db.prepare(`
          INSERT INTO r32_settings(namespace,key,value_json,updated_at)
          VALUES('store-ui-state','document',?,?)
          ON CONFLICT(namespace,key) DO UPDATE SET
            value_json=excluded.value_json,
            updated_at=excluded.updated_at
        `).run(json({
          readingMode: row.readingMode || 'comfortable',
          density: row.density || 'comfortable',
          contrastMode: row.contrastMode || 'high',
          ...normalizeAppearanceState(row),
          updatedAt: row.updatedAt || timestamp
        }), row.updatedAt || timestamp);
      },
      insertCorrection: row => {
        db.prepare(`
          INSERT INTO social_inference_corrections(
            id, contact_id, target_type, target_id, correction_json,
            reason, corrected_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id || randomUUID(), row.contactId, row.targetType,
          row.targetId || '', json(row.correction || {}), row.reason || '',
          row.correctedBy || 'user', row.createdAt || timestamp
        );
      },
      persistStoreMeta: row => {
        this.store.setMeta('storeStateVersion', Number(row.stateVersion || 0));
        this.store.setMeta('storeDomainVersions', row.domainVersions || {});
        this.store.setMeta('lastStoreTransactionId', row.transactionId || metadata.transactionId || '');
      },
      appendStoreEvents: rows => {
        const statement = db.prepare(`
          INSERT OR IGNORE INTO store_event_log(
            event_id, event_type, domain, entity_id, previous_version,
            state_version, occurred_at, source, command_type, command_id,
            correlation_id, payload_json, changed_paths_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows || []) statement.run(
          row.eventId, row.eventType, row.domain || '', row.entityId || '',
          Number(row.previousVersion || 0), Number(row.stateVersion || 0),
          row.occurredAt || timestamp, row.source || '', row.commandType || '',
          row.commandId || '', row.correlationId || '', json(row.payload || {}),
          json(row.changedPaths || [])
        );
      }
    };
  }
}

module.exports = {
  SqliteStorePersistenceAdapter,
  toAccount,
  toCustomer,
  toConversation,
  toMessage,
  toMemory,
  toRelationshipState,
  toPolicy,
  toOutbox
};
