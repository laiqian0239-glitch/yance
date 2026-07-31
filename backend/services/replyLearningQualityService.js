'use strict';

const { inferLanguage } = require('./bilingualUnderstandingService');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizedLanguage(value) {
  const text = clean(value).toLowerCase();
  const aliases = {
    german: 'de', deutsch: 'de', de: 'de',
    english: 'en', en: 'en',
    chinese: 'zh', mandarin: 'zh', zh: 'zh',
    french: 'fr', fr: 'fr',
    spanish: 'es', es: 'es',
    italian: 'it', it: 'it',
    portuguese: 'pt', pt: 'pt',
    russian: 'ru', ru: 'ru',
    arabic: 'ar', ar: 'ar',
    turkish: 'tr', tr: 'tr'
  };
  return aliases[text] || text.split(/[-_]/u)[0] || 'unknown';
}

function levenshtein(left, right) {
  const a = [...clean(left)];
  const b = [...clean(right)];
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function normalizedEditDistance(left, right) {
  const length = Math.max([...clean(left)].length, [...clean(right)].length, 1);
  return clamp01(levenshtein(left, right) / length);
}

function isRiskEvent(event = {}) {
  const reason = clean(event.rejectionReason || event.reason).toLowerCase();
  const metadata = event.generationMetadata && typeof event.generationMetadata === 'object' ? event.generationMetadata : {};
  const blockers = Array.isArray(metadata.quality?.blockers) ? metadata.quality.blockers : [];
  return blockers.length > 0 || /(风险|危险|不安全|误导|隐私|敏感|金钱|诈骗|risk|unsafe|privacy|sensitive|financial|scam)/iu.test(reason);
}

function learningApplied(event = {}) {
  const metadata = event.generationMetadata && typeof event.generationMetadata === 'object' ? event.generationMetadata : {};
  const application = metadata.learningApplication && typeof metadata.learningApplication === 'object'
    ? metadata.learningApplication
    : event.learningApplication && typeof event.learningApplication === 'object' ? event.learningApplication : {};
  return Array.isArray(application.applied) && application.applied.length > 0;
}

function summarize(eventsInput = []) {
  const events = Array.isArray(eventsInput) ? eventsInput : [];
  const sent = events.filter(row => clean(row.eventType).toLowerCase() === 'sent');
  const rejected = events.filter(row => clean(row.eventType).toLowerCase() === 'rejected');
  const decisions = sent.length + rejected.length;
  const edited = sent.filter(row => clean(row.originalText) && clean(row.finalText) && clean(row.originalText) !== clean(row.finalText));
  const unchanged = sent.filter(row => clean(row.originalText) && clean(row.originalText) === clean(row.finalText));
  const editDistances = edited.map(row => normalizedEditDistance(row.originalText, row.finalText));
  const languageChecked = sent.filter(row => clean(row.finalText) && normalizedLanguage(row.targetLanguage) !== 'unknown');
  const languageMismatches = languageChecked.filter(row => {
    const expected = normalizedLanguage(row.targetLanguage);
    const actual = inferLanguage(row.finalText);
    return actual !== 'unknown' && expected !== actual;
  });
  const riskEvents = events.filter(isRiskEvent);
  const learningEligible = events.filter(row => clean(row.eventType).toLowerCase() === 'sent' && row.generationMetadata);
  const learningHits = learningEligible.filter(learningApplied);
  const byModel = {};
  for (const row of sent) {
    const model = clean(row.modelId || row.model) || 'manual';
    const bucket = byModel[model] || { model, sent: 0, edited: 0, rejected: 0, averageEditDistance: 0, _distances: [] };
    bucket.sent += 1;
    if (clean(row.originalText) && clean(row.originalText) !== clean(row.finalText)) {
      bucket.edited += 1;
      bucket._distances.push(normalizedEditDistance(row.originalText, row.finalText));
    }
    byModel[model] = bucket;
  }
  for (const row of rejected) {
    const model = clean(row.modelId || row.model) || 'unknown';
    const bucket = byModel[model] || { model, sent: 0, edited: 0, rejected: 0, averageEditDistance: 0, _distances: [] };
    bucket.rejected += 1;
    byModel[model] = bucket;
  }
  const modelRows = Object.values(byModel).map(row => ({
    model: row.model,
    sent: row.sent,
    edited: row.edited,
    rejected: row.rejected,
    averageEditDistance: row._distances.length
      ? Number((row._distances.reduce((sum, value) => sum + value, 0) / row._distances.length).toFixed(3))
      : 0
  })).sort((a, b) => b.sent - a.sent || a.model.localeCompare(b.model));
  const acceptanceRate = decisions ? sent.length / decisions : 0;
  const averageEditDistance = editDistances.length ? editDistances.reduce((sum, value) => sum + value, 0) / editDistances.length : 0;
  const languageErrorRate = languageChecked.length ? languageMismatches.length / languageChecked.length : 0;
  const riskRate = events.length ? riskEvents.length / events.length : 0;
  const learningHitRate = learningEligible.length ? learningHits.length / learningEligible.length : 0;
  const sufficient = decisions >= 3;
  const status = !sufficient
    ? 'insufficient'
    : languageErrorRate > 0.1 || riskRate > 0.15 || acceptanceRate < 0.45
      ? 'watch'
      : 'healthy';
  return {
    schemaVersion: 1,
    sampleSize: events.length,
    decisionCount: decisions,
    sentCount: sent.length,
    rejectedCount: rejected.length,
    editedCount: edited.length,
    unchangedCount: unchanged.length,
    acceptanceRate: Number(acceptanceRate.toFixed(3)),
    averageEditDistance: Number(averageEditDistance.toFixed(3)),
    languageCheckedCount: languageChecked.length,
    languageMismatchCount: languageMismatches.length,
    languageErrorRate: Number(languageErrorRate.toFixed(3)),
    riskEventCount: riskEvents.length,
    riskRate: Number(riskRate.toFixed(3)),
    learningEligibleCount: learningEligible.length,
    learningHitCount: learningHits.length,
    learningHitRate: Number(learningHitRate.toFixed(3)),
    status,
    sufficientEvidence: sufficient,
    byModel: modelRows,
    thresholds: {
      minimumDecisionCount: 3,
      minimumAcceptanceRate: 0.45,
      maximumLanguageErrorRate: 0.1,
      maximumRiskRate: 0.15
    }
  };
}

module.exports = {
  summarize,
  normalizedEditDistance,
  levenshtein,
  normalizedLanguage,
  isRiskEvent,
  learningApplied
};
