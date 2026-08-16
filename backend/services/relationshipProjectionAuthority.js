'use strict';

const STATES = Object.freeze({
  EMPTY: 'empty',
  PENDING_TRANSLATION: 'pending_translation',
  PENDING_ANALYSIS: 'pending_analysis',
  READY: 'ready',
  STALE: 'stale',
  REBUILD_REQUIRED: 'rebuild_required'
});

const AUTHORITY_ID = 'RelationshipProjectionAuthority';
const PROJECTION_VERSION = '1.0.0';

const STAGE_LABELS = Object.freeze({
  unknown: '待建立',
  new: '初步了解',
  familiar: '熟悉互动',
  warming: '关系升温',
  trust_building: '信任建立',
  deep_trust: '深度信任',
  cooling: '关系降温',
  pending: '待建立',
  ready: '稳定互动'
});

const MOMENTUM_LABELS = Object.freeze({
  improving: '正在改善',
  declining: '正在下降',
  stable: '基本稳定',
  recovering: '正在恢复'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function timestamp(value) {
  const at = value ? new Date(value).getTime() : 0;
  return Number.isFinite(at) ? at : 0;
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(clean(value));
}

function normalizeStage(value, fallback = '待建立') {
  const raw = clean(value);
  if (!raw || ['unknown', '待分析', '待建立'].includes(raw)) return fallback;
  return STAGE_LABELS[raw] || raw;
}

function normalizeMomentum(value) {
  const raw = clean(value);
  return raw ? (MOMENTUM_LABELS[raw] || raw) : '';
}

function boundedMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function isGraphitiInferenceRow(row = {}) {
  const engine = clean(row.engine_version || row.engineVersion).toLowerCase();
  const sources = parseJson(row.source_signal_ids_json || row.sourceSignalIdsJson, []);
  return clean(row.event_type || row.eventType) === 'graphiti_inference'
    && engine.startsWith('graphiti:')
    && array(sources).some(value => clean(value).startsWith('graphiti:'));
}

function isManualTimelineAnnotation(row = {}) {
  return Boolean(row.is_key_node || row.isKeyNode)
    && clean(row.marked_by || row.markedBy).toLowerCase() === 'user';
}

function selectRelationshipTimeline(timeline = []) {
  const rows = array(timeline);
  const graphitiRows = rows.filter(isGraphitiInferenceRow);
  const visibleRows = rows.filter(row => isGraphitiInferenceRow(row) || isManualTimelineAnnotation(row));
  return {
    timeline: visibleRows,
    signals: [],
    authority: graphitiRows.length
      ? 'graphiti_temporal_inference'
      : visibleRows.length ? 'user_annotation' : 'empty'
  };
}

function timelinePresentationRows(timeline = []) {
  return array(timeline).slice().reverse().map(row => {
    const title = clean(row.interpretation || row.event_type || row.eventType) || '关系状态变化';
    const graphitiInference = isGraphitiInferenceRow(row);
    const manualAnnotation = isManualTimelineAnnotation(row);
    const userConfirmedGraphitiFact = graphitiInference
      && manualAnnotation
      && clean(row.node_kind || row.nodeKind) === 'fact';
    if (graphitiInference) {
      return [
        clean(row.confirmed_at || row.confirmedAt || row.started_at || row.startedAt),
        title,
        title,
        userConfirmedGraphitiFact ? 'fact' : 'inference',
        userConfirmedGraphitiFact ? '用户确认 · Graphiti 来源' : 'Graphiti · AI 推断 · 未评分'
      ];
    }
    return [
      clean(row.confirmed_at || row.confirmedAt || row.started_at || row.startedAt),
      title,
      title,
      clean(row.node_kind || row.nodeKind) === 'inference' ? 'inference' : 'fact',
      '用户标注'
    ];
  });
}

function hasSubstantiveInsight(insight = {}) {
  const stage = clean(insight.relationshipStage || insight.stage);
  const summary = clean(insight.summary);
  const next = clean(insight.nextAction || insight.next);
  const placeholderSummary = new Set(['暂无可确认内容', '暂无可确认的关系结论。']);
  const placeholderNext = new Set(['等待真实分析。', '等待真实分析', '等待真实互动与人工确认后生成建议。']);
  return Boolean(
    (summary && !placeholderSummary.has(summary)) ||
    (next && !placeholderNext.has(next)) ||
    (stage && !['待分析', 'unknown', '待建立'].includes(stage)) ||
    array(insight.evidence).length
  );
}

function latestMessage(messages = []) {
  return [...array(messages)].sort((a, b) => timestamp(a.sentAt || a.timestamp) - timestamp(b.sentAt || b.timestamp)).at(-1) || null;
}

function countPendingTranslations(messages = []) {
  return array(messages).filter(row => {
    const inbound = row?.fromMe !== true && !/outbound|outgoing/i.test(clean(row?.direction));
    const source = clean(row?.sourceText || row?.text);
    const translated = clean(row?.translatedZh || row?.translationZh || row?.payload?.lastSuccessfulTranslatedZh);
    if (!inbound || !source || containsChinese(source)) return false;
    return !translated && clean(row?.translationStatus).toLowerCase() !== 'success';
  }).length;
}

function isInsightStale(insight = {}, messages = []) {
  if (!hasSubstantiveInsight(insight)) return false;
  const rows = array(messages);
  const latest = latestMessage(rows);
  if (!latest) return false;
  const analyzedId = clean(insight.analyzedThroughMessageId);
  const latestId = clean(latest.id || latest.messageId || latest.platformMessageId);
  const analyzedAt = timestamp(insight.analyzedThroughAt || insight.updatedAt || insight.updated);
  const latestAt = timestamp(latest.sentAt || latest.timestamp);
  const sourceCount = Number(insight.sourceMessageCount || 0);
  if (analyzedId && latestId && analyzedId !== latestId) return true;
  if (sourceCount > 0 && rows.length > sourceCount) return true;
  if (analyzedAt > 0 && latestAt > analyzedAt) return true;
  return false;
}

function tableHasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
  } catch (_) {
    return false;
  }
}

function loadSource(store, contactId, conversationId) {
  const db = store?.db;
  if (!db) return { social: {}, timeline: [], signals: [], keyNodeCount: 0 };
  const socialRow = db.prepare('SELECT * FROM customer_social_state WHERE contact_id=?').get(clean(contactId));
  const timeline = db.prepare(`
    SELECT * FROM relationship_timeline_events
    WHERE contact_id=? AND (?='' OR conversation_id=?)
    ORDER BY confirmed_at ASC, event_id ASC
  `).all(clean(contactId), clean(conversationId), clean(conversationId));
  const signals = db.prepare(`
    SELECT * FROM relationship_state_signals
    WHERE contact_id=? AND (?='' OR conversation_id=?)
    ORDER BY observed_at ASC, signal_id ASC
  `).all(clean(contactId), clean(conversationId), clean(conversationId));
  const keyNodeCount = tableHasColumn(db, 'relationship_timeline_events', 'is_key_node')
    ? Number(db.prepare(`
        SELECT COUNT(*) AS count FROM relationship_timeline_events
        WHERE contact_id=? AND is_key_node=1 AND (?='' OR conversation_id=? OR conversation_id='')
      `).get(clean(contactId), clean(conversationId), clean(conversationId))?.count || 0)
    : 0;
  return {
    social: socialRow ? {
      version: Number(socialRow.version || 0),
      sourceMessageId: clean(socialRow.source_message_id),
      sourceMessageAt: clean(socialRow.source_message_at),
      calculatedAt: clean(socialRow.calculated_at || socialRow.updated_at),
      engineVersion: clean(socialRow.engine_version)
    } : {},
    timeline,
    signals,
    keyNodeCount
  };
}

function project(input = {}) {
  const insight = object(input.insight);
  const messages = array(input.messages);
  const social = object(input.social);
  const timeline = array(input.timeline);
  const signals = array(input.signals);
  const pendingTranslationCount = countPendingTranslations(messages);
  const aiAnalysisCurrent = input.analysisCurrent === true;
  const aiAnalysisAvailable = aiAnalysisCurrent || input.analysisEvidenceAvailable === true;
  const aiAnalysisCommitted = input.analysisCommitted === true;
  const substantiveInsight = hasSubstantiveInsight(insight) && aiAnalysisAvailable;
  const stale = isInsightStale(insight, messages);
  const relationshipTimelineSource = selectRelationshipTimeline(timeline);
  const evidenceCount = relationshipTimelineSource.timeline.length;

  let state = STATES.EMPTY;
  let source = 'empty';
  if (substantiveInsight) {
    state = (!aiAnalysisCurrent || stale) ? STATES.STALE : STATES.READY;
    source = 'ai_analysis';
  } else if (pendingTranslationCount > 0 && messages.length > 0) {
    state = STATES.PENDING_TRANSLATION;
  } else if (messages.length > 0 || evidenceCount > 0) {
    state = STATES.PENDING_ANALYSIS;
  }

  const aiStage = substantiveInsight
    ? normalizeStage(insight.relationshipStage || insight.stage, '待建立')
    : '待建立';
  const trajectory = {
    authorityId: AUTHORITY_ID,
    projectionVersion: PROJECTION_VERSION,
    projectionState: state,
    projectionSource: source,
    sourceType: source,
    analysisRunId: aiAnalysisAvailable ? clean(input.analysisRunId) : '',
    analysisCommitted: aiAnalysisCommitted,
    analysisRequired: [STATES.PENDING_ANALYSIS, STATES.PENDING_TRANSLATION, STATES.STALE].includes(state),
    analysisStatusLabel: state === STATES.READY ? 'AI 分析已就绪'
      : state === STATES.STALE ? '已有新消息，关系分析待更新'
        : state === STATES.PENDING_TRANSLATION ? '部分消息待中文理解，关系分析待执行'
          : state === STATES.PENDING_ANALYSIS ? 'AI 分析待执行'
            : '尚无真实关系数据',
    stage: aiStage,
    summary: substantiveInsight ? clean(insight.summary) : '',
    next: substantiveInsight ? clean(insight.nextAction || insight.next) : '',
    momentum: substantiveInsight ? normalizeMomentum(insight.momentum) : '',
    temperature: substantiveInsight ? boundedMetric(insight.intimacyScore ?? insight.intimacy) : 0,
    activity: substantiveInsight ? boundedMetric(insight.activityScore ?? insight.activity) : 0,
    initiative: substantiveInsight ? boundedMetric(insight.initiativeScore ?? insight.initiative) : 0,
    depth: substantiveInsight ? boundedMetric(insight.depth ?? insight.dimensions?.depth) : 0,
    opportunity: substantiveInsight ? boundedMetric(insight.opportunityScore ?? insight.opportunity) : 0,
    risk: substantiveInsight ? boundedMetric(insight.riskScore ?? insight.risk) : 0,
    opportunityText: substantiveInsight ? clean(insight.opportunityText || insight.summary) : '',
    riskText: substantiveInsight ? clean(insight.riskText || insight.hiddenNeed) : '',
    timelineAuthority: relationshipTimelineSource.authority,
    events: timelinePresentationRows(relationshipTimelineSource.timeline)
  };

  return {
    schemaVersion: 1,
    authorityId: AUTHORITY_ID,
    projectionVersion: PROJECTION_VERSION,
    state,
    source,
    sourceType: source,
    analysisCurrent: aiAnalysisCurrent,
    analysisAvailable: aiAnalysisAvailable,
    analysisCommitted: aiAnalysisCommitted,
    analysisRunId: aiAnalysisAvailable ? clean(input.analysisRunId) : '',
    analysisRequired: trajectory.analysisRequired,
    analysisStatusLabel: trajectory.analysisStatusLabel,
    sourceMessageCount: messages.length,
    analyzedThroughMessageId: clean(insight.analyzedThroughMessageId),
    analyzedThroughAt: clean(insight.analyzedThroughAt),
    pendingTranslationCount,
    socialNodeCount: timeline.length,
    signalCount: signals.length,
    relationshipEvidenceCount: evidenceCount,
    keyNodeCount: Number(input.keyNodeCount || 0),
    socialStateVersion: Number(social.version || 0),
    sourceScope: object(input.sourceScope),
    trajectory
  };
}

function projectFromStore(input = {}) {
  const source = loadSource(input.store, input.contactId, input.conversationId);
  return project({
    ...input,
    ...source,
    sourceScope: input.sourceScope || {
      platform: clean(input.platform),
      sourceAccountId: clean(input.sourceAccountId),
      platformContactIdentity: clean(input.platformContactIdentity),
      conversationId: clean(input.conversationId),
      canonicalContactId: clean(input.canonicalContactId || input.contactId)
    }
  });
}

module.exports = {
  STATES,
  AUTHORITY_ID,
  PROJECTION_VERSION,
  normalizeStage,
  hasSubstantiveInsight,
  isInsightStale,
  loadSource,
  project,
  projectFromStore
};
