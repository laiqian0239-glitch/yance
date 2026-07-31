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

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
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
  const raw = clean(value) || 'stable';
  return MOMENTUM_LABELS[raw] || raw;
}

function percent(value) {
  return Math.round(clamp01(value) * 100);
}

function presentationScalar(value, key) {
  const text = clean(value);
  return {
    key,
    sourceText: text,
    translatedZh: '',
    displayText: text,
    translationStatus: text ? 'source-zh' : 'pending',
    translationPending: !text,
    displayOriginal: false
  };
}

function timelinePresentationRows(timeline = [], signals = []) {
  const eventRows = array(timeline).slice().reverse().map(row => {
    const title = clean(row.interpretation || row.event_type || row.eventType) || '关系状态变化';
    const confidence = Math.round(clamp01(row.confidence, 0.5) * 100);
    return [
      clean(row.confirmed_at || row.confirmedAt || row.started_at || row.startedAt),
      title,
      title,
      /declin|defens|tension|distance|avoid/u.test(clean(row.event_type || row.eventType)) ? 'risk' : 'fact',
      `关系权威 · 置信度 ${confidence}%`
    ];
  });
  if (eventRows.length) return eventRows;
  return array(signals).slice().reverse().map(row => {
    const title = clean(row.evidence?.summary || row.signal_type || row.signalType) || '关系信号';
    const confidence = Math.round(clamp01(row.confidence, 0.5) * 100);
    return [
      clean(row.observed_at || row.observedAt),
      title,
      title,
      clean(row.direction) === 'negative' ? 'risk' : 'signal',
      `关系权威 · 置信度 ${confidence}%`
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
      relationship: parseJson(socialRow.relationship_json, {}),
      emotion: parseJson(socialRow.emotion_json, {}),
      interaction: parseJson(socialRow.interaction_json, {}),
      strategy: parseJson(socialRow.strategy_json, {}),
      potential: parseJson(socialRow.potential_json, {}),
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

function ruleProjection({ messages = [], social = {}, timeline = [], signals = [], fallback = {} } = {}) {
  const potential = object(social.potential);
  const emotion = object(social.emotion);
  const interaction = object(social.interaction);
  const strategy = object(social.strategy);
  const stage = normalizeStage(potential.relationshipStage || social.relationship?.stage || fallback.stage, fallback.stage || (messages.length ? '初步了解' : '待建立'));
  const momentum = normalizeMomentum(potential.momentum || emotion.trend || fallback.momentum);
  const warmth = clamp01(potential.warmth ?? emotion.warmth);
  const openness = clamp01(potential.openness ?? emotion.openness);
  const trust = clamp01(potential.trust ?? emotion.trust);
  const initiative = clamp01(potential.initiative ?? interaction.initiatesConversationRate);
  const tension = clamp01(potential.tension ?? emotion.tension);
  const nodeCount = timeline.length;
  const signalCount = signals.length;
  const evidenceCount = Math.max(nodeCount, signalCount);
  const summary = evidenceCount
    ? `已根据 ${evidenceCount} 条真实关系信号形成规则投影：当前阶段为${stage}，关系动能${momentum}；开放度 ${percent(openness)}%，主动度 ${percent(initiative)}%，风险压力 ${percent(tension)}%。`
    : messages.length
      ? `已根据 ${messages.length} 条真实消息形成基础关系投影：当前阶段为${stage}。尚未形成足够的稳定关系信号。`
      : '';
  const riskHigh = tension >= 0.45;
  const next = riskHigh
    ? '当前存在压力或防御信号，建议降低追问和主动频率，先回应对方已经表达的内容。'
    : openness >= 0.55 || trust >= 0.55
      ? `保持${clean(strategy.recommendedTone) || '自然、稳重'}的语气承接当前话题，在不越界的前提下适度深入。`
      : '继续观察真实互动，保持自然承接，不主动拔高关系或增加联系频率。';
  return {
    stage,
    momentum,
    temperature: Math.round(((warmth + openness + trust) / 3) * 100),
    activity: Math.min(100, messages.length * 3),
    initiative: percent(initiative),
    depth: percent(openness),
    opportunity: Math.round(((warmth + openness + trust) / 3) * 100),
    risk: percent(tension),
    summary,
    next,
    opportunityText: openness >= 0.55 ? '开放度正在形成，可在保持分寸的前提下适度深入。' : '继续观察真实互动，不主动拔高关系。',
    riskText: riskHigh ? '当前存在压力或防御信号，应降低追问和主动频率。' : '当前未见强烈负向信号，但仍需遵守互动频率策略。'
  };
}

function project(input = {}) {
  const insight = object(input.insight);
  const messages = array(input.messages);
  const social = object(input.social);
  const timeline = array(input.timeline);
  const signals = array(input.signals);
  const fallback = object(input.fallback);
  const pendingTranslationCount = countPendingTranslations(messages);
  const aiAnalysisCurrent = input.analysisCurrent === true;
  const aiAnalysisAvailable = aiAnalysisCurrent || input.analysisEvidenceAvailable === true;
  const aiAnalysisCommitted = input.analysisCommitted === true;
  const substantiveInsight = hasSubstantiveInsight(insight) && aiAnalysisAvailable;
  const stale = isInsightStale(insight, messages);
  const evidenceCount = Math.max(timeline.length, signals.length);
  const hasSocialProjection = ['relationship', 'emotion', 'interaction', 'strategy', 'potential']
    .some(key => Object.keys(object(social[key])).length > 0);
  const baseline = ruleProjection({ messages, social, timeline, signals, fallback });

  let state = STATES.EMPTY;
  let source = 'empty';
  if (substantiveInsight) {
    state = (!aiAnalysisCurrent || stale) ? STATES.STALE : STATES.READY;
    source = 'ai_analysis';
  } else if (pendingTranslationCount > 0 && messages.length > 0) {
    state = STATES.PENDING_TRANSLATION;
    source = evidenceCount || hasSocialProjection ? 'social_rule_projection' : 'message_baseline';
  } else if (messages.length > 0 || evidenceCount > 0) {
    state = STATES.PENDING_ANALYSIS;
    source = evidenceCount || hasSocialProjection ? 'social_rule_projection' : 'message_baseline';
  }

  const aiStage = normalizeStage(insight.relationshipStage || insight.stage, baseline.stage);
  const rulePresentation = substantiveInsight ? null : {
    summary: presentationScalar(baseline.summary, 'summary'),
    stage: presentationScalar(baseline.stage, 'relationshipStage'),
    opportunity: presentationScalar(baseline.opportunityText, 'opportunityText'),
    risk: presentationScalar(baseline.riskText, 'riskText'),
    next: presentationScalar(baseline.next, 'nextAction'),
    evidence: [],
    events: [],
    topics: [],
    analysisSummary: presentationScalar('', 'analysisSummary'),
    sourceMessageCount: messages.length,
    analyzedThroughMessageId: '',
    truthRules: {
      originalIsAuthoritative: true,
      chineseIsPresentationLayer: true,
      pendingTranslationMustBeVisible: true,
      inferenceIsNotFact: true,
      ruleProjectionIsNotAiAnalysis: true
    }
  };
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
        : state === STATES.PENDING_TRANSLATION ? '部分消息待中文理解，已显示规则投影'
          : state === STATES.PENDING_ANALYSIS ? 'AI 分析待执行，已显示规则投影'
            : '尚无真实关系数据',
    stage: substantiveInsight ? aiStage : baseline.stage,
    summary: substantiveInsight ? clean(insight.summary) || baseline.summary : baseline.summary,
    next: substantiveInsight ? clean(insight.nextAction || insight.next) || baseline.next : baseline.next,
    momentum: clean(insight.momentum) || baseline.momentum,
    temperature: substantiveInsight ? Number(insight.intimacyScore ?? insight.intimacy ?? baseline.temperature) : baseline.temperature,
    activity: substantiveInsight ? Number(insight.activityScore ?? insight.activity ?? baseline.activity) : baseline.activity,
    initiative: substantiveInsight ? Number(insight.initiativeScore ?? insight.initiative ?? baseline.initiative) : baseline.initiative,
    depth: substantiveInsight ? Number(insight.depth ?? insight.dimensions?.depth ?? baseline.depth) : baseline.depth,
    opportunity: substantiveInsight ? Number(insight.opportunityScore ?? insight.opportunity ?? baseline.opportunity) : baseline.opportunity,
    risk: substantiveInsight ? Number(insight.riskScore ?? insight.risk ?? baseline.risk) : baseline.risk,
    opportunityText: substantiveInsight ? clean(insight.opportunityText || insight.summary) || baseline.opportunityText : baseline.opportunityText,
    riskText: substantiveInsight ? clean(insight.riskText || insight.hiddenNeed) || baseline.riskText : baseline.riskText,
    events: timelinePresentationRows(timeline, signals),
    ...(rulePresentation ? { bilingualPresentation: rulePresentation } : {})
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
