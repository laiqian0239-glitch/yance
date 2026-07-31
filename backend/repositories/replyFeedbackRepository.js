'use strict';

const { getStore } = require('./storeProvider');
const resilientLeaseClock = require('../lib/resilientLeaseClock');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

class ReplyFeedbackRepository {
  constructor(store = getStore()) {
    this.store = store;
  }

  getProfile(scopeType, scopeId) {
    const row = this.store.db.prepare(`
      SELECT scope_type AS scopeType, scope_id AS scopeId, profile_json AS profileJson,
             version, updated_at AS updatedAt
      FROM ai_reply_feedback_profiles
      WHERE scope_type=? AND scope_id=?
    `).get(clean(scopeType), clean(scopeId));
    if (!row) return null;
    return {
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      profile: parseJson(row.profileJson, {}) || {},
      version: Number(row.version || 0),
      updatedAt: row.updatedAt
    };
  }

  listVersions(scopeType, scopeId, options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
    return this.store.db.prepare(`
      SELECT scope_type AS scopeType, scope_id AS scopeId, version,
             profile_json AS profileJson, reason, created_at AS createdAt
      FROM ai_reply_feedback_profile_versions
      WHERE scope_type=? AND scope_id=?
      ORDER BY version DESC
      LIMIT ?
    `).all(clean(scopeType), clean(scopeId), limit).map(row => ({
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      version: Number(row.version || 0),
      profile: parseJson(row.profileJson, {}) || {},
      reason: row.reason,
      createdAt: row.createdAt
    }));
  }

  getVersion(scopeType, scopeId, version) {
    const row = this.store.db.prepare(`
      SELECT scope_type AS scopeType, scope_id AS scopeId, version,
             profile_json AS profileJson, reason, created_at AS createdAt
      FROM ai_reply_feedback_profile_versions
      WHERE scope_type=? AND scope_id=? AND version=?
    `).get(clean(scopeType), clean(scopeId), Number(version));
    if (!row) return null;
    return {
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      version: Number(row.version || 0),
      profile: parseJson(row.profileJson, {}) || {},
      reason: row.reason,
      createdAt: row.createdAt
    };
  }

  listEvents(options = {}) {
    const contactId = clean(options.contactId);
    const personaProfileId = clean(options.personaProfileId);
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
    const where = [];
    const params = [];
    if (contactId) { where.push('contact_id=?'); params.push(contactId); }
    if (personaProfileId) { where.push('persona_profile_id=?'); params.push(personaProfileId); }
    params.push(limit);
    const columns = new Set(this.store.db.prepare('PRAGMA table_info(ai_reply_feedback_events)').all().map(row => row.name));
    const optional = [
      columns.has('reply_source') ? 'reply_source AS source' : "'local_model' AS source",
      columns.has('context_revision') ? 'context_revision AS contextRevision' : '0 AS contextRevision',
      columns.has('context_message_ids_json') ? 'context_message_ids_json AS contextMessageIdsJson' : "'[]' AS contextMessageIdsJson",
      columns.has('performance_mode') ? 'performance_mode AS performanceMode' : "'' AS performanceMode",
      columns.has('platform') ? 'platform' : "'' AS platform",
      columns.has('source_account_id') ? 'source_account_id AS sourceAccountId' : "'' AS sourceAccountId",
      columns.has('platform_contact_identity') ? 'platform_contact_identity AS platformContactIdentity' : "'' AS platformContactIdentity",
      columns.has('canonical_contact_id') ? 'canonical_contact_id AS canonicalContactId' : "'' AS canonicalContactId",
      columns.has('learning_mode') ? 'learning_mode AS learningMode' : "'' AS learningMode",
      columns.has('target_language') ? 'target_language AS targetLanguage' : "'' AS targetLanguage",
      columns.has('translated_zh') ? 'translated_zh AS translatedZh' : "'' AS translatedZh",
      columns.has('translation_model') ? 'translation_model AS translationModel' : "'' AS translationModel",
      columns.has('model_id') ? 'model_id AS modelId' : "'' AS modelId",
      columns.has('model_name') ? 'model_name AS model' : "'' AS model",
      columns.has('reply_task') ? 'reply_task AS replyTask' : "'' AS replyTask",
      columns.has('style_variant') ? 'style_variant AS styleVariant' : "'' AS styleVariant",
      columns.has('generation_metadata_json') ? 'generation_metadata_json AS generationMetadataJson' : "'{}' AS generationMetadataJson"
    ];
    return this.store.db.prepare(`
      SELECT id, event_type AS eventType, candidate_id AS candidateId, outbox_id AS outboxId,
             contact_id AS contactId, conversation_id AS conversationId,
             persona_profile_id AS personaProfileId, original_text AS originalText,
             final_text AS finalText, rejection_reason AS rejectionReason,
             ${optional.join(', ')}, signals_json AS signalsJson, created_at AS createdAt
      FROM ai_reply_feedback_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...params).map(row => ({
      ...row,
      contextRevision: Number(row.contextRevision || 0),
      contextMessageIds: parseJson(row.contextMessageIdsJson, []) || [],
      signals: parseJson(row.signalsJson, []) || [],
      generationMetadata: parseJson(row.generationMetadataJson, {}) || {},
      contextMessageIdsJson: undefined,
      signalsJson: undefined,
      generationMetadataJson: undefined
    }));
  }

  listPendingSuccessfulSends(options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 250)));
    const tableExists = name => Boolean(this.store.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name));
    if (!tableExists('ai_reply_outbox') || !tableExists('ai_reply_candidates') || !tableExists('ai_reply_feedback_events')) return [];

    const columns = table => new Set(this.store.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    const outboxColumns = columns('ai_reply_outbox');
    const candidateColumns = columns('ai_reply_candidates');
    const contactColumns = tableExists('contacts') ? columns('contacts') : new Set();
    const hasEventLog = tableExists('store_event_log');
    const o = (name, fallback = "''") => outboxColumns.has(name) ? `o.${name}` : fallback;
    const c = (name, fallback = "''") => candidateColumns.has(name) ? `c.${name}` : fallback;
    const contact = (name, fallback = "''") => contactColumns.has(name) ? `ct.${name}` : fallback;
    const contactJoin = tableExists('contacts')
      ? `LEFT JOIN contacts ct ON ct.id=COALESCE(NULLIF(${o('contact_id')}, ''), ${c('contact_id')})`
      : '';
    const sourceReconciliationJoin = tableExists('reply_learning_source_reconciliation')
      ? `LEFT JOIN reply_learning_source_reconciliation sr ON sr.source_key=('sent:' || o.id)`
      : '';
    const sourceReconciliationWhere = tableExists('reply_learning_source_reconciliation')
      ? `AND (sr.source_key IS NULL OR (sr.state='retry' AND (sr.next_attempt_at='' OR sr.next_attempt_at<=?)))`
      : '';
    const observedAt = hasEventLog
      ? `(SELECT MAX(e.occurred_at) FROM store_event_log e WHERE e.event_type='outbox.sent' AND e.entity_id=o.id)`
      : "''";

    const rows = this.store.db.prepare(`
      SELECT
        o.id AS outboxId,
        ${o('candidate_id')} AS candidateId,
        COALESCE(NULLIF(${o('contact_id')}, ''), ${c('contact_id')}) AS contactId,
        COALESCE(NULLIF(${o('conversation_id')}, ''), ${c('conversation_id')}) AS conversationId,
        ${o('account_id')} AS sourceAccountId,
        ${o('platform')} AS platform,
        ${o('text')} AS finalText,
        COALESCE(NULLIF(${o('original_text')}, ''), ${c('original_text')}, ${c('text')}) AS originalText,
        ${o('metadata_json', "'{}'")} AS metadataJson,
        COALESCE(NULLIF(${o('persona_profile_id')}, ''), ${c('persona_profile_id', "'owner'")}, 'owner') AS personaProfileId,
        ${c('reply_strategy_json', "'{}'")} AS replyStrategyJson,
        ${c('model_id')} AS candidateModelId,
        ${c('model_name')} AS candidateModel,
        ${c('reply_source', "'local_model'")} AS candidateSource,
        ${c('context_revision', '0')} AS candidateContextRevision,
        ${c('context_message_ids_json', "'[]'")} AS candidateContextMessageIdsJson,
        ${c('performance_mode')} AS candidatePerformanceMode,
        ${contact('external_id')} AS platformContactIdentity,
        ${contact('phone')} AS contactPhone,
        ${contact('canonical_contact_id')} AS canonicalContactId,
        COALESCE(NULLIF(${observedAt}, ''), ${o('updated_at')}, ${o('created_at')}) AS observedAt
      FROM ai_reply_outbox o
      LEFT JOIN ai_reply_candidates c ON c.candidate_id=o.candidate_id
      ${contactJoin}
      ${sourceReconciliationJoin}
      LEFT JOIN ai_reply_feedback_events f ON f.id=('sent:' || o.id)
      WHERE o.state='sent' AND f.id IS NULL
        AND LOWER(COALESCE(NULLIF(json_extract(${o('metadata_json', "'{}'")}, '$.learningMode'), ''), 'send_and_learn'))
            NOT IN ('send_only', 'exception', 'do_not_learn')
        ${sourceReconciliationWhere}
      ORDER BY COALESCE(${o('updated_at')}, ${o('created_at')}) ASC, o.id ASC
      LIMIT ?
    `).all(...(sourceReconciliationWhere ? [resilientLeaseClock.iso()] : []), limit);

    return rows.map(row => {
      const metadata = parseJson(row.metadataJson, {}) || {};
      const replyStrategy = parseJson(row.replyStrategyJson, {}) || {};
      const generationMetadata = {
        ...(replyStrategy._generation && typeof replyStrategy._generation === 'object' ? replyStrategy._generation : {}),
        ...(metadata.generationMetadata && typeof metadata.generationMetadata === 'object' ? metadata.generationMetadata : {})
      };
      const director = {
        ...(replyStrategy._director && typeof replyStrategy._director === 'object' ? replyStrategy._director : {}),
        ...(metadata.director && typeof metadata.director === 'object' ? metadata.director : {})
      };
      return {
        outboxId: clean(row.outboxId),
        candidateId: clean(row.candidateId),
        contactId: clean(row.contactId),
        conversationId: clean(row.conversationId),
        personaProfileId: clean(row.personaProfileId) || 'owner',
        originalText: clean(row.originalText),
        finalText: clean(row.finalText),
        platform: clean(row.platform),
        sourceAccountId: clean(row.sourceAccountId),
        platformContactIdentity: clean(row.platformContactIdentity || row.contactPhone),
        canonicalContactId: clean(row.canonicalContactId || row.contactId),
        learningMode: clean(metadata.learningMode || 'send_and_learn').toLowerCase(),
        source: clean(metadata.replySource || row.candidateSource || 'local_model'),
        contextRevision: Number(metadata.conversationRevision || row.candidateContextRevision || 0),
        contextMessageIds: Array.isArray(metadata.contextMessageIds)
          ? metadata.contextMessageIds
          : (parseJson(row.candidateContextMessageIdsJson, []) || []),
        performanceMode: clean(metadata.performanceMode || row.candidatePerformanceMode),
        targetLanguage: clean(metadata.targetLanguage || generationMetadata.targetLanguage),
        translatedZh: clean(metadata.translatedZh),
        translationModel: clean(metadata.translationModel),
        modelId: clean(metadata.modelId || row.candidateModelId || generationMetadata.modelId),
        model: clean(metadata.model || row.candidateModel || generationMetadata.model),
        replyTask: clean(metadata.replyTask || generationMetadata.replyTask),
        styleVariant: clean(metadata.styleVariant || generationMetadata.styleVariant || director.variant),
        replyStrategy,
        director,
        generationMetadata: { ...generationMetadata, director },
        observedAt: clean(row.observedAt)
      };
    }).filter(row => !['send_only', 'exception', 'do_not_learn'].includes(row.learningMode));
  }


  listPendingRejectedCandidates(options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 250)));
    const tableExists = name => Boolean(this.store.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name));
    if (!tableExists('store_event_log') || !tableExists('ai_reply_candidates') || !tableExists('ai_reply_feedback_events')) return [];

    const columns = table => new Set(this.store.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    const candidateColumns = columns('ai_reply_candidates');
    const contactColumns = tableExists('contacts') ? columns('contacts') : new Set();
    const c = (name, fallback = "''") => candidateColumns.has(name) ? `c.${name}` : fallback;
    const contact = (name, fallback = "''") => contactColumns.has(name) ? `ct.${name}` : fallback;
    const contactJoin = tableExists('contacts') ? `LEFT JOIN contacts ct ON ct.id=${c('contact_id')}` : '';
    const sourceReconciliationJoin = tableExists('reply_learning_source_reconciliation')
      ? `LEFT JOIN reply_learning_source_reconciliation sr ON sr.source_key=('rejected:' || e.entity_id)`
      : '';
    const sourceReconciliationWhere = tableExists('reply_learning_source_reconciliation')
      ? `AND (sr.source_key IS NULL OR (sr.state='retry' AND (sr.next_attempt_at='' OR sr.next_attempt_at<=?)))`
      : '';

    const rows = this.store.db.prepare(`
      SELECT
        e.event_id AS eventId,
        e.entity_id AS eventEntityId,
        e.occurred_at AS observedAt,
        e.payload_json AS payloadJson,
        ${c('candidate_id')} AS candidateId,
        ${c('contact_id')} AS candidateContactId,
        ${c('conversation_id')} AS candidateConversationId,
        ${c('text')} AS candidateText,
        ${c('original_text')} AS candidateOriginalText,
        ${c('persona_profile_id', "'owner'")} AS personaProfileId,
        ${c('reply_strategy_json', "'{}'")} AS replyStrategyJson,
        ${c('model_id')} AS modelId,
        ${c('model_name')} AS model,
        ${c('reply_source', "'local_model'")} AS source,
        ${c('context_revision', '0')} AS contextRevision,
        ${c('context_message_ids_json', "'[]'")} AS contextMessageIdsJson,
        ${c('performance_mode')} AS performanceMode,
        ${contact('platform')} AS platform,
        ${contact('account_id')} AS sourceAccountId,
        ${contact('external_id')} AS platformContactIdentity,
        ${contact('phone')} AS contactPhone,
        ${contact('canonical_contact_id')} AS canonicalContactId
      FROM store_event_log e
      LEFT JOIN ai_reply_candidates c ON c.candidate_id=e.entity_id
      ${contactJoin}
      ${sourceReconciliationJoin}
      LEFT JOIN ai_reply_feedback_events f ON f.id=('rejected:' || e.entity_id)
      WHERE e.event_type='ai.replyCandidate.rejected' AND f.id IS NULL
        ${sourceReconciliationWhere}
      ORDER BY e.occurred_at ASC, e.event_id ASC
      LIMIT ?
    `).all(...(sourceReconciliationWhere ? [resilientLeaseClock.iso()] : []), limit);

    return rows.map(row => {
      const payload = parseJson(row.payloadJson, {}) || {};
      const replyStrategy = parseJson(row.replyStrategyJson, {}) || {};
      const generationMetadata = replyStrategy._generation && typeof replyStrategy._generation === 'object'
        ? { ...replyStrategy._generation }
        : {};
      const director = replyStrategy._director && typeof replyStrategy._director === 'object'
        ? { ...replyStrategy._director }
        : {};
      if (Object.keys(director).length) generationMetadata.director = director;
      return {
        eventId: clean(row.eventId),
        eventType: 'rejected',
        candidateId: clean(row.candidateId || payload.candidateId || row.eventEntityId),
        outboxId: '',
        contactId: clean(row.candidateContactId || payload.contactId),
        conversationId: clean(row.candidateConversationId || payload.conversationId),
        personaProfileId: clean(row.personaProfileId) || 'owner',
        originalText: clean(row.candidateOriginalText || payload.originalText || row.candidateText),
        finalText: clean(row.candidateText || payload.finalText),
        rejectionReason: clean(payload.rejectionReason),
        replyStrategy,
        source: clean(row.source || 'local_model'),
        contextRevision: Number(row.contextRevision || 0),
        contextMessageIds: parseJson(row.contextMessageIdsJson, []) || [],
        performanceMode: clean(row.performanceMode),
        platform: clean(row.platform),
        sourceAccountId: clean(row.sourceAccountId),
        platformContactIdentity: clean(row.platformContactIdentity || row.contactPhone),
        canonicalContactId: clean(row.canonicalContactId || row.candidateContactId || payload.contactId),
        modelId: clean(row.modelId || generationMetadata.modelId),
        model: clean(row.model || generationMetadata.model),
        replyTask: clean(generationMetadata.replyTask),
        styleVariant: clean(generationMetadata.styleVariant || director.variant),
        director,
        generationMetadata,
        observedAt: clean(row.observedAt)
      };
    }).filter(row => row.candidateId && row.contactId && row.rejectionReason);
  }

  countPendingLearningSources() {
    const tableExists = name => Boolean(this.store.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name));
    const now = resilientLeaseClock.iso();
    let successful = 0;
    let rejected = 0;
    if (tableExists('ai_reply_outbox') && tableExists('ai_reply_feedback_events')) {
      const outboxColumns = new Set(this.store.db.prepare('PRAGMA table_info(ai_reply_outbox)').all().map(row => row.name));
      const metadata = outboxColumns.has('metadata_json') ? 'o.metadata_json' : "'{}'";
      const sourceJoin = tableExists('reply_learning_source_reconciliation')
        ? "LEFT JOIN reply_learning_source_reconciliation sr ON sr.source_key=('sent:' || o.id)"
        : '';
      const sourceWhere = tableExists('reply_learning_source_reconciliation')
        ? "AND (sr.source_key IS NULL OR (sr.state='retry' AND (sr.next_attempt_at='' OR sr.next_attempt_at<=?)))"
        : '';
      const row = this.store.db.prepare(`SELECT COUNT(*) AS count FROM ai_reply_outbox o
        LEFT JOIN ai_reply_feedback_events f ON f.id=('sent:' || o.id)
        ${sourceJoin}
        WHERE o.state='sent' AND f.id IS NULL
          AND LOWER(COALESCE(NULLIF(json_extract(${metadata}, '$.learningMode'), ''), 'send_and_learn'))
              NOT IN ('send_only','exception','do_not_learn')
          ${sourceWhere}`).get(...(sourceWhere ? [now] : []));
      successful = Number(row?.count || 0);
    }
    if (tableExists('store_event_log') && tableExists('ai_reply_feedback_events')) {
      const sourceJoin = tableExists('reply_learning_source_reconciliation')
        ? "LEFT JOIN reply_learning_source_reconciliation sr ON sr.source_key=('rejected:' || e.entity_id)"
        : '';
      const sourceWhere = tableExists('reply_learning_source_reconciliation')
        ? "AND (sr.source_key IS NULL OR (sr.state='retry' AND (sr.next_attempt_at='' OR sr.next_attempt_at<=?)))"
        : '';
      const row = this.store.db.prepare(`SELECT COUNT(*) AS count FROM store_event_log e
        LEFT JOIN ai_reply_feedback_events f ON f.id=('rejected:' || e.entity_id)
        ${sourceJoin}
        WHERE e.event_type='ai.replyCandidate.rejected' AND f.id IS NULL ${sourceWhere}`)
        .get(...(sourceWhere ? [now] : []));
      rejected = Number(row?.count || 0);
    }
    return { successful, rejected, total: successful + rejected };
  }


  listLifecycleEvents(options = {}) {
    const contactId = clean(options.contactId);
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
    if (!contactId) return [];
    const candidates = new Map(this.store.db.prepare(`
      SELECT candidate_id AS candidateId, contact_id AS contactId,
             conversation_id AS conversationId, text, original_text AS originalText,
             model_id AS modelId, model_name AS model, reply_source AS source,
             state, created_at AS createdAt, updated_at AS updatedAt
      FROM ai_reply_candidates WHERE contact_id=?
    `).all(contactId).map(row => [clean(row.candidateId), row]));
    const outboxes = new Map(this.store.db.prepare(`
      SELECT id, candidate_id AS candidateId, contact_id AS contactId,
             conversation_id AS conversationId, account_id AS sourceAccountId,
             platform, text AS finalText, original_text AS originalText,
             state, metadata_json AS metadataJson, created_at AS createdAt,
             updated_at AS updatedAt
      FROM ai_reply_outbox WHERE contact_id=?
    `).all(contactId).map(row => [clean(row.id), {
      ...row,
      metadata: parseJson(row.metadataJson, {}) || {}
    }]));
    const learnedIds = new Set(this.listEvents({ contactId, limit: 500 }).map(row => clean(row.id)));
    const eventTypes = [
      'ai.replyCandidate.ready', 'ai.replyCandidate.userApproved', 'ai.replyCandidate.rejected',
      'outbox.userRevised', 'outbox.sendConfirmed', 'outbox.queued', 'outbox.sent', 'outbox.failed'
    ];
    const placeholders = eventTypes.map(() => '?').join(',');
    const rows = this.store.db.prepare(`
      SELECT event_id AS eventId, event_type AS eventType, entity_id AS entityId,
             occurred_at AS occurredAt, source, payload_json AS payloadJson,
             state_version AS stateVersion
      FROM store_event_log
      WHERE event_type IN (${placeholders})
      ORDER BY occurred_at DESC, state_version DESC
      LIMIT ?
    `).all(...eventTypes, Math.max(limit * 8, 200));
    const stageMap = {
      'ai.replyCandidate.ready': ['generated', '候选已生成'],
      'ai.replyCandidate.userApproved': ['accepted', '候选已接受'],
      'outbox.userRevised': ['edited', '候选已编辑'],
      'ai.replyCandidate.rejected': ['rejected', '候选已拒绝'],
      'outbox.sendConfirmed': ['send_confirmed', '发送已确认'],
      'outbox.queued': ['queued', '已进入发送队列'],
      'outbox.sent': ['sent', '真实发送成功'],
      'outbox.failed': ['failed', '真实发送失败']
    };
    const output = [];
    for (const row of rows) {
      const payload = parseJson(row.payloadJson, {}) || {};
      const candidateId = clean(payload.candidateId || (row.eventType.startsWith('ai.replyCandidate.') ? row.entityId : ''));
      const outboxId = clean(payload.outboxId || (row.eventType.startsWith('outbox.') ? row.entityId : ''));
      const candidate = candidates.get(candidateId) || null;
      const outbox = outboxes.get(outboxId) || null;
      const resolvedContactId = clean(payload.contactId || candidate?.contactId || outbox?.contactId);
      if (resolvedContactId !== contactId) continue;
      const [stage, statusLabel] = stageMap[row.eventType] || [row.eventType, row.eventType];
      const learningMode = clean(outbox?.metadata?.learningMode || payload.learningMode || 'send_and_learn').toLowerCase();
      const feedbackId = stage === 'sent' ? `sent:${outboxId}` : stage === 'rejected' ? `rejected:${candidateId}` : '';
      const learningEligible = stage === 'rejected' || (stage === 'sent' && !['send_only', 'exception', 'do_not_learn'].includes(learningMode));
      const learningApplied = Boolean(feedbackId && learnedIds.has(feedbackId));
      output.push({
        eventId: clean(row.eventId),
        eventType: clean(row.eventType),
        stage,
        statusLabel,
        statusTruth: stage === 'failed' ? 'failed' : stage === 'sent' ? 'success' : 'recorded',
        candidateId,
        outboxId,
        contactId,
        conversationId: clean(payload.conversationId || candidate?.conversationId || outbox?.conversationId),
        platform: clean(payload.platform || outbox?.platform),
        sourceAccountId: clean(payload.accountId || payload.sourceAccountId || outbox?.sourceAccountId),
        originalText: clean(payload.originalText || outbox?.originalText || candidate?.originalText),
        finalText: clean(payload.finalText || outbox?.finalText || candidate?.text),
        rejectionReason: clean(payload.rejectionReason),
        error: clean(payload.error),
        source: clean(outbox?.metadata?.replySource || candidate?.source || row.source),
        targetLanguage: clean(outbox?.metadata?.targetLanguage),
        modelId: clean(outbox?.metadata?.modelId || candidate?.modelId),
        model: clean(outbox?.metadata?.model || candidate?.model),
        learningMode,
        learningEligible,
        learningApplied,
        sampleClass: stage === 'rejected' ? 'negative' : stage === 'sent' ? 'positive' : 'lifecycle',
        reviewStatus: stage === 'generated' ? 'pending' : ['accepted', 'edited', 'rejected'].includes(stage) ? 'reviewed' : 'system',
        occurredAt: clean(row.occurredAt),
        stateVersion: Number(row.stateVersion || 0)
      });
      if (output.length >= limit) break;
    }
    return output;
  }
}

module.exports = { ReplyFeedbackRepository };
