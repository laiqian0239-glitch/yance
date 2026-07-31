'use strict';

const {
  FEEDBACK_ACTIVATION_EVIDENCE,
  FEEDBACK_HISTORY_LIMIT
} = require('./learningPolicy');

const ENGINE_VERSION = '1.1.0';
const RECENT_EXAMPLE_LIMIT = 12;
const ALLOWED_KEYS = new Set(['replyLength', 'questionFrequency', 'emojiLevel', 'formality', 'tone']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function countQuestions(text) {
  return (clean(text).match(/[?？]/gu) || []).length;
}

function countEmoji(text) {
  return (clean(text).match(/\p{Extended_Pictographic}/gu) || []).length;
}

function textUnits(text) {
  const value = clean(text);
  if (!value) return 0;
  const words = value.split(/\s+/u).filter(Boolean).length;
  return words > 1 ? words : [...value].length;
}

function addSignal(signals, key, value, weight, reason) {
  if (!ALLOWED_KEYS.has(key) || !clean(value)) return;
  signals.push({ key, value: clean(value), weight: clamp01(weight, 0.5), reason: clean(reason) });
}

function parseReasonSignals(reason, signals) {
  const value = clean(reason).toLowerCase();
  if (!value) return;
  if (/(太长|过长|啰嗦|简短|短一点|too long|shorter|verbose|zu lang|kürzer)/iu.test(value)) {
    addSignal(signals, 'replyLength', 'short', 1, 'explicit-rejection-reason');
  }
  if (/(太短|详细|多说|展开|too short|longer|more detail|zu kurz|ausführlicher)/iu.test(value)) {
    addSignal(signals, 'replyLength', 'long', 1, 'explicit-rejection-reason');
  }
  if (/(问题太多|不要问|少问|像审问|too many questions|fewer questions|keine frage|weniger fragen)/iu.test(value)) {
    addSignal(signals, 'questionFrequency', 'low', 1, 'explicit-rejection-reason');
  }
  if (/(多问|加个问题|ask a question|more questions|mehr fragen)/iu.test(value)) {
    addSignal(signals, 'questionFrequency', 'high', 1, 'explicit-rejection-reason');
  }
  if (/(表情太多|不要表情|少用表情|emoji.*多|no emoji|fewer emoji|keine emojis)/iu.test(value)) {
    addSignal(signals, 'emojiLevel', 'low', 1, 'explicit-rejection-reason');
  }
  if (/(加表情|多点表情|more emoji|mehr emojis)/iu.test(value)) {
    addSignal(signals, 'emojiLevel', 'high', 1, 'explicit-rejection-reason');
  }
  if (/(太正式|不要.{0,4}正式|不自然|口语|casual|less formal|zu formell|lockerer)/iu.test(value)) {
    addSignal(signals, 'formality', 'casual', 1, 'explicit-rejection-reason');
  }
  if (/(正式一点|更礼貌|more formal|förmlicher)/iu.test(value)) {
    addSignal(signals, 'formality', 'formal', 1, 'explicit-rejection-reason');
  }
  if (/(调情|暧昧|性感|风骚|撩人|flirty|flirt|spielerisch|verführerisch)/iu.test(value)) {
    addSignal(signals, 'tone', 'flirty', 1, 'explicit-rejection-reason');
  }
  if (/(太暧昧|不要调情|普通一点|less flirty|no flirting|weniger flirt)/iu.test(value)) {
    addSignal(signals, 'tone', 'neutral', 1, 'explicit-rejection-reason');
  }
}

function inferFeedbackSignals(input = {}) {
  const eventType = clean(input.eventType) || 'sent';
  const originalText = clean(input.originalText);
  const finalText = clean(input.finalText);
  const rejectionReason = clean(input.rejectionReason);
  const signals = [];

  if (eventType === 'rejected') {
    parseReasonSignals(rejectionReason, signals);
    return signals;
  }

  if (!originalText || !finalText) return signals;
  const originalLength = textUnits(originalText);
  const finalLength = textUnits(finalText);
  const ratio = originalLength ? finalLength / originalLength : 1;
  if (ratio <= 0.78) addSignal(signals, 'replyLength', 'short', 0.9, 'user-shortened-sent-reply');
  else if (ratio >= 1.3) addSignal(signals, 'replyLength', 'long', 0.85, 'user-expanded-sent-reply');

  const originalQuestions = countQuestions(originalText);
  const finalQuestions = countQuestions(finalText);
  if (originalQuestions > finalQuestions) addSignal(signals, 'questionFrequency', 'low', 0.9, 'user-removed-questions');
  else if (finalQuestions > originalQuestions) addSignal(signals, 'questionFrequency', 'high', 0.8, 'user-added-questions');

  const originalEmoji = countEmoji(originalText);
  const finalEmoji = countEmoji(finalText);
  if (originalEmoji > finalEmoji) addSignal(signals, 'emojiLevel', 'low', 0.85, 'user-removed-emoji');
  else if (finalEmoji > originalEmoji) addSignal(signals, 'emojiLevel', 'high', 0.75, 'user-added-emoji');

  if (originalText === finalText && input.replyStrategy) {
    const strategy = input.replyStrategy || {};
    const length = clean(strategy.recommendedLength);
    if (['short', 'medium', 'long'].includes(length)) {
      addSignal(signals, 'replyLength', length, 0.45, 'unchanged-candidate-sent');
    }
    const maxQuestions = Number(strategy.maxQuestions);
    if (Number.isFinite(maxQuestions)) {
      addSignal(signals, 'questionFrequency', maxQuestions <= 0 ? 'low' : maxQuestions >= 2 ? 'high' : 'medium', 0.35, 'unchanged-candidate-sent');
    }
  }
  return signals;
}

function normalizeProfile(profile = {}) {
  const evidence = Array.isArray(profile.evidence) ? profile.evidence.slice(-FEEDBACK_HISTORY_LIMIT) : [];
  const counts = profile.counts && typeof profile.counts === 'object' ? { ...profile.counts } : {};
  const effective = profile.effective && typeof profile.effective === 'object' ? { ...profile.effective } : {};
  const recentExamples = Array.isArray(profile.recentExamples)
    ? profile.recentExamples.slice(-RECENT_EXAMPLE_LIMIT).map(row => ({
        id: clean(row?.id),
        finalText: clean(row?.finalText).slice(0, 1200),
        source: clean(row?.source),
        conversationId: clean(row?.conversationId),
        contextRevision: Number(row?.contextRevision || 0),
        contextMessageIds: Array.isArray(row?.contextMessageIds) ? row.contextMessageIds.map(clean).filter(Boolean).slice(-12) : [],
        performanceMode: clean(row?.performanceMode),
        platform: clean(row?.platform),
        sourceAccountId: clean(row?.sourceAccountId),
        platformContactIdentity: clean(row?.platformContactIdentity),
        canonicalContactId: clean(row?.canonicalContactId),
        targetLanguage: clean(row?.targetLanguage),
        translatedZh: clean(row?.translatedZh).slice(0, 1200),
        translationModel: clean(row?.translationModel),
        modelId: clean(row?.modelId),
        model: clean(row?.model),
        replyTask: clean(row?.replyTask),
        styleVariant: clean(row?.styleVariant),
        generationMetadata: row?.generationMetadata && typeof row.generationMetadata === 'object' ? { ...row.generationMetadata } : {},
        qualityWeight: clamp01(row?.qualityWeight, 0.7),
        createdAt: clean(row?.createdAt)
      })).filter(row => row.id && row.finalText)
    : [];
  return {
    version: Number(profile.version || 0),
    evidence,
    counts,
    effective,
    recentExamples,
    updatedAt: clean(profile.updatedAt),
    engineVersion: clean(profile.engineVersion) || ENGINE_VERSION
  };
}

function applySignals(profileInput, signals = [], evidence = {}, options = {}) {
  const profile = normalizeProfile(profileInput);
  const threshold = Math.max(2, Number(options.threshold || FEEDBACK_ACTIVATION_EVIDENCE));
  const now = clean(options.now) || new Date().toISOString();
  const evidenceId = clean(evidence.id);
  const acceptedSignals = signals.filter(row => ALLOWED_KEYS.has(row.key) && clean(row.value));
  const exampleText = clean(evidence.finalText).slice(0, 1200);
  const hasImmediateExample = clean(evidence.eventType) === 'sent' && Boolean(exampleText);
  if (!acceptedSignals.length && !hasImmediateExample) return { profile, changed: false, newlyEffective: {} };

  const next = {
    ...profile,
    version: profile.version + 1,
    counts: { ...profile.counts },
    effective: { ...profile.effective },
    recentExamples: [...profile.recentExamples],
    evidence: [...profile.evidence],
    updatedAt: now,
    engineVersion: ENGINE_VERSION
  };
  const newlyEffective = {};
  for (const signal of acceptedSignals) {
    const key = signal.key;
    const value = clean(signal.value);
    const bucket = next.counts[key] && typeof next.counts[key] === 'object' ? { ...next.counts[key] } : {};
    const current = bucket[value] && typeof bucket[value] === 'object' ? { ...bucket[value] } : { count: 0, weight: 0 };
    current.count = Number(current.count || 0) + 1;
    current.weight = Number((Number(current.weight || 0) + clamp01(signal.weight, 0.5)).toFixed(4));
    current.lastObservedAt = now;
    bucket[value] = current;
    next.counts[key] = bucket;

    const ranked = Object.entries(bucket)
      .map(([candidate, stats]) => ({ value: candidate, count: Number(stats.count || 0), weight: Number(stats.weight || 0) }))
      .sort((a, b) => b.count - a.count || b.weight - a.weight || a.value.localeCompare(b.value));
    const winner = ranked[0];
    const runnerUp = ranked[1];
    if (winner && winner.count >= threshold && (!runnerUp || winner.count > runnerUp.count || winner.weight >= runnerUp.weight + 0.75)) {
      const confidence = clamp01(0.45 + winner.count * 0.08 + Math.min(0.18, winner.weight * 0.02), 0.5);
      const previous = next.effective[key] || {};
      const effective = {
        value: winner.value,
        confidence: Number(confidence.toFixed(3)),
        evidenceCount: winner.count,
        source: 'user-feedback',
        updatedAt: now
      };
      next.effective[key] = effective;
      const milestone = [3, 4, 5, 8, 12, 20].includes(effective.evidenceCount);
      if (previous.value !== effective.value || !previous.value || milestone) {
        newlyEffective[key] = effective;
      }
    }
  }

  if (hasImmediateExample) {
    const source = clean(evidence.source) || 'local_model';
    const qualityWeights = { manual: 1, chatgpt_web_edited: 0.95, external_paste: 0.85, local_model: 0.75 };
    next.recentExamples = next.recentExamples
      .filter(row => clean(row.id) !== evidenceId && clean(row.finalText) !== exampleText)
      .concat({
        id: evidenceId,
        finalText: exampleText,
        source,
        conversationId: clean(evidence.conversationId),
        contextRevision: Number(evidence.contextRevision || 0),
        contextMessageIds: Array.isArray(evidence.contextMessageIds)
          ? evidence.contextMessageIds.map(clean).filter(Boolean).slice(-12)
          : [],
        performanceMode: clean(evidence.performanceMode),
        platform: clean(evidence.platform),
        sourceAccountId: clean(evidence.sourceAccountId),
        platformContactIdentity: clean(evidence.platformContactIdentity),
        canonicalContactId: clean(evidence.canonicalContactId),
        targetLanguage: clean(evidence.targetLanguage),
        translatedZh: clean(evidence.translatedZh).slice(0, 1200),
        translationModel: clean(evidence.translationModel),
        modelId: clean(evidence.modelId),
        model: clean(evidence.model),
        replyTask: clean(evidence.replyTask),
        styleVariant: clean(evidence.styleVariant),
        generationMetadata: evidence.generationMetadata && typeof evidence.generationMetadata === 'object' ? { ...evidence.generationMetadata } : {},
        qualityWeight: qualityWeights[source] || 0.7,
        createdAt: now
      })
      .slice(-RECENT_EXAMPLE_LIMIT);
  }

  next.evidence.push({
    id: evidenceId,
    eventType: clean(evidence.eventType),
    candidateId: clean(evidence.candidateId),
    outboxId: clean(evidence.outboxId),
    contactId: clean(evidence.contactId),
    conversationId: clean(evidence.conversationId),
    platform: clean(evidence.platform),
    sourceAccountId: clean(evidence.sourceAccountId),
    platformContactIdentity: clean(evidence.platformContactIdentity),
    canonicalContactId: clean(evidence.canonicalContactId),
    targetLanguage: clean(evidence.targetLanguage),
    translatedZh: clean(evidence.translatedZh).slice(0, 1200),
    modelId: clean(evidence.modelId),
    replyTask: clean(evidence.replyTask),
    styleVariant: clean(evidence.styleVariant),
    signals: acceptedSignals,
    createdAt: now
  });
  next.evidence = next.evidence.slice(-FEEDBACK_HISTORY_LIMIT);
  return { profile: next, changed: true, newlyEffective };
}

function learnedPersonaPatch(effective = {}) {
  const preferences = {};
  for (const [key, value] of Object.entries(effective || {})) {
    if (!ALLOWED_KEYS.has(key) || !value || typeof value !== 'object' || !clean(value.value)) continue;
    preferences[key] = {
      value: clean(value.value),
      confidence: clamp01(value.confidence, 0.5),
      evidenceCount: Number(value.evidenceCount || 0),
      source: 'user-feedback',
      updatedAt: clean(value.updatedAt) || new Date().toISOString()
    };
  }
  return Object.keys(preferences).length ? { preferences } : {};
}

module.exports = {
  ENGINE_VERSION,
  RECENT_EXAMPLE_LIMIT,
  inferFeedbackSignals,
  applySignals,
  learnedPersonaPatch,
  countQuestions,
  countEmoji,
  textUnits
};
