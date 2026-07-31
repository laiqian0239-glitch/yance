'use strict';

const {
  chineseFirst,
  chineseOverlay,
  localizedScalar,
  containsChinese
} = require('./localizedContentAuthority');
const customerProfileEvidenceAuthority = require('./customerProfileEvidenceAuthority');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
}

function confidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function scalar(value) {
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join('、');
  if (value == null || typeof value === 'object') return '';
  return clean(value);
}

function rowText(row = {}) {
  if (typeof row === 'string' || typeof row === 'number') return clean(row);
  const item = object(row);
  return clean(item.text || item.summary || item.description || item.value || item.fact || item.content || item.title || item.label);
}

function translatedText(row = {}) {
  const item = object(row);
  return clean(item.translatedZh || item.translationZh || item.textZh || item.chinese || item.displayTextZh);
}

function translatedRowText(row = {}) {
  if (typeof row === 'string' || typeof row === 'number') return clean(row);
  const item = object(row);
  return clean(item.translatedZh || item.translationZh || item.textZh || item.chinese || item.displayTextZh || item.text || item.summary || item.description || item.value || item.fact || item.content);
}

function pairForRow(sourceRow, translatedRow, fallback = '') {
  const sourceText = rowText(sourceRow) || clean(fallback);
  const explicitTranslation = translatedText(sourceRow) || translatedRowText(translatedRow);
  const pair = localizedScalar(sourceText, explicitTranslation, fallback);
  return {
    sourceText,
    translatedZh: pair.translatedZh,
    displayText: pair.primaryZh,
    translationStatus: pair.pending ? 'pending' : (pair.hasTranslation ? 'success' : 'source-zh'),
    translationPending: pair.pending,
    displayOriginal: pair.displayOriginal
  };
}

function evidenceRows(value, translatedValue = []) {
  const sources = array(value);
  const translated = array(translatedValue);
  return sources.map((row, index) => {
    if (Array.isArray(row)) {
      const translatedRow = Array.isArray(translated[index]) ? translated[index] : [];
      const pair = localizedScalar(row[0], row[4] || translatedRow[4] || translatedRow[0]);
      return {
        id: `evidence:${index}`,
        sourceText: clean(row[0]),
        translatedZh: pair.translatedZh,
        displayText: pair.primaryZh,
        translationStatus: pair.pending ? 'pending' : (pair.hasTranslation ? 'success' : 'source-zh'),
        translationPending: pair.pending,
        label: clean(row[1] || translatedRow[1]),
        source: clean(row[2] || '真实消息'),
        confidence: confidence(row[3], 0.7),
        messageId: clean(row[5])
      };
    }
    const item = object(row);
    const translatedItem = object(translated[index]);
    const sourceText = clean(item.sourceText || item.originalText || item.quote || item.text || item.summary || item.description);
    const translatedZh = clean(
      item.translatedZh || item.textZh || item.chinese || item.translationZh ||
      translatedItem.translatedZh || translatedItem.text || translatedItem.quote || translatedItem.summary
    );
    const pair = localizedScalar(sourceText, translatedZh);
    return {
      id: clean(item.id || item.messageId || item.sourceMessageId) || `evidence:${index}`,
      sourceText,
      translatedZh: pair.translatedZh,
      displayText: pair.primaryZh,
      translationStatus: pair.pending ? 'pending' : (pair.hasTranslation ? 'success' : 'source-zh'),
      translationPending: pair.pending,
      label: clean(translatedItem.label || item.label || item.claim || item.type),
      source: clean(item.source || item.sourceType || '真实消息'),
      confidence: confidence(item.confidence, 0.7),
      messageId: clean(item.messageId || item.sourceMessageId)
    };
  }).filter(row => row.sourceText || row.translatedZh || row.label);
}

function normalizeItem(sourceRow, translatedRow, kind, index, defaults = {}) {
  const source = typeof sourceRow === 'object' && sourceRow !== null ? object(sourceRow) : sourceRow;
  const translated = typeof translatedRow === 'object' && translatedRow !== null ? object(translatedRow) : translatedRow;
  const pair = pairForRow(source, translated, defaults.text || '');
  const item = object(source);
  const translatedItem = object(translated);
  if (!pair.sourceText && !pair.translatedZh && !clean(item.label || item.title || item.name)) return null;
  const evidenceSource = item.evidence || item.sources || item.sourceEvidence;
  const evidenceTranslated = translatedItem.evidence || translatedItem.sources || translatedItem.sourceEvidence;
  return {
    id: clean(item.id || item.key || item.targetId || item.messageId) || `${kind}:${index}`,
    kind,
    title: clean(translatedItem.title || translatedItem.label || translatedItem.name || item.title || item.label || item.name || defaults.title),
    sourceText: pair.sourceText,
    translatedZh: pair.translatedZh,
    displayText: pair.displayText,
    translationStatus: pair.translationStatus,
    translationPending: pair.translationPending,
    displayOriginal: pair.displayOriginal,
    confidence: confidence(item.confidence, defaults.confidence ?? (kind === 'fact' ? 1 : 0.5)),
    status: clean(item.status || item.reviewStatus || defaults.status) || (kind === 'fact' ? 'confirmed' : 'review'),
    source: clean(item.source || item.sourceType || defaults.source) || 'analysis',
    key: clean(item.key || item.factKey || item.field),
    value: scalar(item.value || item.factValue || item.fieldValue),
    messageId: clean(item.messageId || item.sourceMessageId || item.platformMessageId),
    sourceMessageId: clean(item.sourceMessageId || item.messageId || item.platformMessageId),
    platformMessageId: clean(item.platformMessageId || item.messageId || item.sourceMessageId),
    direction: clean(item.direction),
    speaker: clean(item.speaker),
    extractionMethod: clean(item.extractionMethod),
    extractionVersion: clean(item.extractionVersion),
    evidence: evidenceRows(evidenceSource, evidenceTranslated),
    userConfirmed: item.userConfirmed === true || item.confirmed === true || clean(item.status).toLowerCase() === 'confirmed',
    completed: item.done === true || item.completed === true || clean(item.status).toLowerCase() === 'completed',
    updatedAt: clean(item.updatedAt || item.confirmedAt || item.observedAt || item.createdAt),
    dueAt: clean(item.dueAt || item.dueDate || item.deadline),
    level: clean(item.level || item.severity || defaults.level)
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    if (!row) return false;
    const key = `${row.kind}:${clean(row.id)}:${clean(row.sourceText || row.displayText).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localizedArrays(document, keys = []) {
  const source = object(document);
  const overlay = chineseOverlay(source);
  for (const key of keys) {
    const sourceRows = array(source[key]);
    const translatedRows = array(overlay[key]);
    if (sourceRows.length || translatedRows.length) return { sourceRows, translatedRows };
  }
  return { sourceRows: [], translatedRows: [] };
}

function rowsFrom(document, keys, kind, defaults = {}) {
  const { sourceRows, translatedRows } = localizedArrays(document, keys);
  return uniqueRows(Array.from({ length: Math.max(sourceRows.length, translatedRows.length) }, (_, index) =>
    normalizeItem(sourceRows[index], translatedRows[index], kind, index, defaults)
  ));
}

function factRows(profile = {}) {
  const rows = rowsFrom(profile, ['confirmed', 'confirmedFacts'], 'fact', {
    title: '已确认事实', confidence: 1, status: 'confirmed', source: 'confirmed-profile'
  });
  const sourceFacts = object(profile.facts || profile.contact);
  const translatedFacts = object(chineseOverlay(profile).facts || chineseOverlay(profile).contact);
  const representedFacts = new Set(rows.map(row => `${clean(row.key).toLowerCase()}${clean(row.value || row.sourceText).normalize('NFKC').toLowerCase()}`));
  let index = rows.length;
  for (const key of new Set([...Object.keys(sourceFacts), ...Object.keys(translatedFacts)])) {
    const sourceValue = scalar(sourceFacts[key]);
    const translatedValue = scalar(translatedFacts[key]);
    if (!sourceValue && !translatedValue) continue;
    if (representedFacts.has(`${clean(key).toLowerCase()}${clean(sourceValue).normalize('NFKC').toLowerCase()}`)) continue;
    rows.push(normalizeItem(
      { id: `fact:${key}`, title: key, text: sourceValue, confidence: 1, status: 'confirmed', source: 'customer-profile' },
      { title: key, text: translatedValue },
      'fact', index++, { confidence: 1, status: 'confirmed' }
    ));
  }
  return uniqueRows(rows);
}

function inferenceRows(profile = {}, insights = {}, analysis = {}) {
  return uniqueRows([
    ...rowsFrom(profile, ['inferences', 'inferredFacts'], 'inference', { title: 'AI 推断', confidence: 0.55, status: 'review', source: 'customer-profile-ai' }),
    ...rowsFrom(insights, ['inferences'], 'inference', { title: 'AI 推断', confidence: 0.55, status: 'review', source: 'relationship-analysis' }),
    ...rowsFrom(analysis, ['inferences'], 'inference', { title: 'AI 推断', confidence: 0.55, status: 'review', source: 'ai-analysis' })
  ]);
}

function commitmentRows(profile = {}, insights = {}) {
  return uniqueRows([
    ...rowsFrom(profile, ['commitments', 'promises', 'openLoops'], 'commitment', { title: '承诺与开放事项', confidence: 1, status: 'open', source: 'customer-profile' }),
    ...rowsFrom(insights, ['openLoops', 'commitments', 'promises'], 'commitment', { title: '承诺与开放事项', confidence: 0.8, status: 'open', source: 'relationship-analysis' })
  ]);
}

function boundaryRows(profile = {}, insights = {}, analysis = {}) {
  return uniqueRows([
    ...rowsFrom(profile, ['boundaries'], 'boundary', { title: '沟通边界', confidence: 1, status: 'active', source: 'customer-profile' }),
    ...rowsFrom(insights, ['boundaries', 'riskBoundaries'], 'boundary', { title: '沟通边界', confidence: 0.75, status: 'review', source: 'relationship-analysis' }),
    ...rowsFrom(analysis, ['boundaries', 'riskBoundaries'], 'boundary', { title: '沟通边界', confidence: 0.75, status: 'review', source: 'ai-analysis' })
  ]);
}

function milestoneRows(profile = {}, insights = {}) {
  const normalizeMilestones = (document, sourceName) => {
    const { sourceRows, translatedRows } = localizedArrays(document, ['milestones', 'events']);
    return Array.from({ length: Math.max(sourceRows.length, translatedRows.length) }, (_, index) => {
      const row = sourceRows[index];
      const translated = translatedRows[index];
      if (Array.isArray(row)) {
        return normalizeItem(
          { id: `milestone:${index}`, title: row[1], text: row[2], observedAt: row[0], source: row[4] || sourceName },
          Array.isArray(translated) ? { title: translated[1], text: translated[2] } : translated,
          'milestone', index, { title: '关系里程碑', confidence: 1, status: 'observed', source: sourceName }
        );
      }
      return normalizeItem(row, translated, 'milestone', index, { title: '关系里程碑', confidence: 1, status: 'observed', source: sourceName });
    });
  };
  return uniqueRows([
    ...normalizeMilestones(profile, 'customer-profile'),
    ...normalizeMilestones(insights, 'relationship-analysis')
  ]);
}

function riskRows(profile = {}, insights = {}, analysis = {}) {
  const rows = uniqueRows([
    ...rowsFrom(profile, ['risks'], 'risk', { title: '需关注风险', confidence: 0.65, status: 'review', source: 'customer-profile' }),
    ...rowsFrom(insights, ['risks', 'riskBoundaries'], 'risk', { title: '需关注风险', confidence: 0.65, status: 'review', source: 'risk-analysis' }),
    ...rowsFrom(analysis, ['risks', 'riskBoundaries'], 'risk', { title: '需关注风险', confidence: 0.65, status: 'review', source: 'risk-analysis' })
  ]);
  const sourceInsights = object(insights);
  const translatedInsights = chineseOverlay(insights);
  const sourceAnalysis = object(analysis);
  const translatedAnalysis = chineseOverlay(analysis);
  const scalars = [
    ['riskText', sourceInsights.riskText || sourceInsights.hiddenNeed, translatedInsights.riskText || translatedInsights.hiddenNeed],
    ['analysisRisk', sourceAnalysis.riskText || object(sourceAnalysis.risk).text, translatedAnalysis.riskText || object(translatedAnalysis.risk).text]
  ];
  scalars.forEach(([id, sourceText, translatedTextValue], index) => {
    if (!clean(sourceText) && !clean(translatedTextValue)) return;
    rows.push(normalizeItem(
      { id, text: sourceText, title: '需关注风险', confidence: sourceInsights.riskConfidence || sourceAnalysis.riskConfidence },
      { text: translatedTextValue, title: '需关注风险' },
      'risk', index, { title: '需关注风险', confidence: 0.65, status: 'review', source: 'risk-analysis' }
    ));
  });
  return uniqueRows(rows);
}

function recommendationRows(profile = {}, insights = {}, analysis = {}) {
  const rows = uniqueRows([
    ...rowsFrom(insights, ['recommendations', 'actions', 'nextActions'], 'recommendation', { title: '下一步建议', confidence: 0.65, status: 'advisory', source: 'relationship-director' }),
    ...rowsFrom(analysis, ['recommendations', 'actions', 'nextActions'], 'recommendation', { title: '下一步建议', confidence: 0.65, status: 'advisory', source: 'relationship-director' })
  ]);
  const candidates = [
    ['profileNext', profile.next || profile.nextAction, chineseOverlay(profile).next || chineseOverlay(profile).nextAction],
    ['insightNext', insights.next || insights.nextAction, chineseOverlay(insights).next || chineseOverlay(insights).nextAction],
    ['analysisNext', analysis.next || analysis.nextAction, chineseOverlay(analysis).next || chineseOverlay(analysis).nextAction]
  ];
  candidates.forEach(([id, sourceText, translatedTextValue], index) => {
    if (!clean(sourceText) && !clean(translatedTextValue)) return;
    rows.push(normalizeItem(
      { id, text: sourceText, title: '下一步建议', source: 'relationship-director' },
      { text: translatedTextValue, title: '下一步建议' },
      'recommendation', index, { title: '下一步建议', confidence: 0.65, status: 'advisory', source: 'relationship-director' }
    ));
  });
  return uniqueRows(rows);
}

function relationshipScalar(document, keys, fallback = '') {
  const source = object(document);
  const overlay = chineseOverlay(source);
  const key = keys.find(name => clean(source[name]) || clean(overlay[name]));
  const original = key ? clean(source[key]) : clean(fallback);
  const translated = key ? clean(overlay[key]) : '';
  const pair = localizedScalar(original, translated, fallback);
  return {
    key: key || keys[0],
    sourceText: original,
    translatedZh: pair.translatedZh,
    displayText: pair.primaryZh,
    translationStatus: pair.pending ? 'pending' : (pair.hasTranslation ? 'success' : 'source-zh'),
    translationPending: pair.pending,
    displayOriginal: pair.displayOriginal
  };
}

function topicRows(insights = {}) {
  const { sourceRows, translatedRows } = localizedArrays(insights, ['topics']);
  return sourceRows.map((row, index) => {
    const source = Array.isArray(row) ? row : [rowText(row), object(row).score, object(row).description];
    const translated = Array.isArray(translatedRows[index]) ? translatedRows[index] : [];
    const titlePair = localizedScalar(source[0], translated[0]);
    const detailPair = localizedScalar(source[2], translated[2]);
    return {
      id: `topic:${index}`,
      title: titlePair.primaryZh,
      sourceTitle: clean(source[0]),
      translatedTitleZh: titlePair.translatedZh,
      detail: detailPair.primaryZh,
      sourceDetail: clean(source[2]),
      translatedDetailZh: detailPair.translatedZh,
      translationPending: titlePair.pending || detailPair.pending,
      score: Number(source[1] || translated[1] || 0)
    };
  });
}

function buildRelationshipPresentation(insights = {}, analysis = {}) {
  const localized = chineseFirst(insights);
  return {
    summary: relationshipScalar(insights, ['summary'], ''),
    stage: relationshipScalar(insights, ['relationshipStage', 'stage'], localized.relationshipStage || localized.stage || '待分析'),
    opportunity: relationshipScalar(insights, ['opportunityText', 'summary'], ''),
    risk: relationshipScalar(insights, ['riskText', 'hiddenNeed'], ''),
    next: relationshipScalar(insights, ['nextAction', 'next'], '等待真实分析。'),
    evidence: evidenceRows(insights.evidence, chineseOverlay(insights).evidence),
    events: milestoneRows({}, insights),
    topics: topicRows(insights),
    analysisSummary: relationshipScalar(analysis, ['summary'], ''),
    sourceMessageCount: Number(insights.sourceMessageCount || 0),
    analyzedThroughMessageId: clean(insights.analyzedThroughMessageId),
    truthRules: {
      originalIsAuthoritative: true,
      chineseIsPresentationLayer: true,
      pendingTranslationMustBeVisible: true,
      inferenceIsNotFact: true
    }
  };
}

function buildSocialAnalysisPresentation(input = {}) {
  const evidenceOptions = {
    messages: array(input.messages),
    scope: object(input.scope || input.insights?.sourceScope || input.insights?.payload?.sourceScope),
    projectionVersion: clean(input.projectionVersion || customerProfileEvidenceAuthority.DEFAULT_PROJECTION_VERSION),
    preserveId: true
  };
  const closeRows = (rows, defaultType) => customerProfileEvidenceAuthority.dedupeRows(rows, { ...evidenceOptions, defaultType });
  const facts = closeRows(factRows(input.profile), 'fact');
  const inferences = closeRows(inferenceRows(input.profile, input.insights, input.analysis), 'inference');
  const commitments = closeRows(commitmentRows(input.profile, input.insights), 'commitment');
  const boundaries = closeRows(boundaryRows(input.profile, input.insights, input.analysis), 'boundary');
  const milestones = closeRows(milestoneRows(input.profile, input.insights), 'milestone');
  const risks = closeRows(riskRows(input.profile, input.insights, input.analysis), 'risk');
  const recommendations = closeRows(recommendationRows(input.profile, input.insights, input.analysis), 'recommendation');
  const relationshipSource = buildRelationshipPresentation(input.insights, input.analysis);
  const relationship = {
    ...relationshipSource,
    evidence: closeRows(relationshipSource.evidence, 'relationship-evidence'),
    events: closeRows(relationshipSource.events, 'relationship-event')
  };
  const allRows = [facts, inferences, commitments, boundaries, milestones, risks, recommendations].flat();
  return {
    schemaVersion: 3,
    facts,
    inferences,
    commitments,
    boundaries,
    milestones,
    risks,
    recommendations,
    relationship,
    counts: {
      facts: facts.length,
      inferences: inferences.length,
      commitments: commitments.length,
      boundaries: boundaries.length,
      milestones: milestones.length,
      risks: risks.length,
      recommendations: recommendations.length,
      pendingReview: inferences.filter(row => row.status !== 'confirmed').length + risks.filter(row => row.status !== 'resolved').length,
      pendingTranslations: allRows.filter(row => row.translationPending).length + [relationship.summary, relationship.stage, relationship.opportunity, relationship.risk, relationship.next].filter(row => row.translationPending).length
    },
    truthRules: {
      factsRequireConfirmation: true,
      inferencesAreNotFacts: true,
      recommendationsRequireUserDecision: true,
      originalIsAuthoritative: true,
      chineseIsPresentationLayer: true,
      pendingTranslationMustBeVisible: true
    }
  };
}

module.exports = {
  buildSocialAnalysisPresentation,
  buildRelationshipPresentation,
  normalizeItem,
  evidenceRows,
  confidence,
  factRows,
  inferenceRows,
  commitmentRows,
  boundaryRows,
  milestoneRows,
  riskRows,
  recommendationRows,
  containsChinese
};
