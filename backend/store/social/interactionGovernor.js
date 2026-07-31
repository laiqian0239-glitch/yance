'use strict';

const GOVERNOR_VERSION = '1.0.0';

const DEFAULT_CONFIG = Object.freeze({
  stagePolicies: {
    new: { proactiveBudget7d: 1, minimumIntervalHours: 36, unansweredLimit: 1, maxQuestions: 1, depth: 'light' },
    familiar: { proactiveBudget7d: 2, minimumIntervalHours: 24, unansweredLimit: 1, maxQuestions: 1, depth: 'light_personal' },
    warming: { proactiveBudget7d: 3, minimumIntervalHours: 18, unansweredLimit: 1, maxQuestions: 1, depth: 'slightly_deeper' },
    trust_building: { proactiveBudget7d: 4, minimumIntervalHours: 14, unansweredLimit: 2, maxQuestions: 1, depth: 'personal' },
    deep_trust: { proactiveBudget7d: 5, minimumIntervalHours: 10, unansweredLimit: 2, maxQuestions: 2, depth: 'personal' },
    cooling: { proactiveBudget7d: 0, minimumIntervalHours: 72, unansweredLimit: 0, maxQuestions: 0, depth: 'light' },
    unknown: { proactiveBudget7d: 1, minimumIntervalHours: 36, unansweredLimit: 1, maxQuestions: 1, depth: 'light' }
  },
  negativeSignalTypes: [
    'defensiveness_increasing',
    'fatigue_expressed',
    'tension_increasing',
    'reply_speed_decreasing',
    'reply_length_shortening',
    'topic_avoidance',
    'consecutive_no_reply',
    'distance_increasing',
    'initiative_declining'
  ],
  strongBoundarySignals: [
    'defensiveness_increasing',
    'boundary_expressed',
    'topic_avoidance'
  ],
  positiveSignalTypes: [
    'emotion_recovering',
    'warmth_increasing',
    'openness_increasing',
    'initiative_recovering',
    'private_sharing',
    'trust_expressed',
    'topic_depth_increasing',
    'relationship_rewarming'
  ],
  freezeAfterUnanswered: 2,
  manualApprovalRequired: true,
  proactiveAutomationEnabled: false
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function mergeConfig(input = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...input,
    stagePolicies: {
      ...DEFAULT_CONFIG.stagePolicies,
      ...(input.stagePolicies || {})
    },
    negativeSignalTypes: Array.isArray(input.negativeSignalTypes) ? input.negativeSignalTypes : DEFAULT_CONFIG.negativeSignalTypes,
    strongBoundarySignals: Array.isArray(input.strongBoundarySignals) ? input.strongBoundarySignals : DEFAULT_CONFIG.strongBoundarySignals,
    positiveSignalTypes: Array.isArray(input.positiveSignalTypes) ? input.positiveSignalTypes : DEFAULT_CONFIG.positiveSignalTypes
  };
}

function dateAfterHours(base, hours) {
  const time = base ? new Date(base).getTime() : Date.now();
  return new Date((Number.isFinite(time) ? time : Date.now()) + Math.max(0, Number(hours || 0)) * 3600000).toISOString();
}

function signalScore(signals, types) {
  return (signals || [])
    .filter(signal => types.includes(signal.signalType))
    .reduce((sum, signal) => sum + clamp01(signal.strength, 0.5) * clamp01(signal.confidence, 0.5), 0);
}

function toneWeights(input) {
  const potential = input.relationship?.potential || {};
  const memory = input.memory || {};
  const preferences = memory.preferences || input.relationship?.preferences || {};
  const negative = input.negativeScore;
  const positive = input.positiveScore;
  return {
    warmth: clamp01(0.48 + Number(potential.warmth || 0.4) * 0.35 + positive * 0.05 - negative * 0.05, 0.55),
    empathy: clamp01(0.42 + Number(potential.tension || 0.2) * 0.36 + negative * 0.08, 0.55),
    humor: clamp01(Number(preferences.humorAffinity ?? 0.45) - negative * 0.18, 0.3),
    formality: clamp01(Number(preferences.formality ?? 0.45), 0.45),
    directness: clamp01(Number(preferences.directness ?? 0.5) - Number(potential.tension || 0) * 0.12, 0.45),
    depth: clamp01(0.25 + Number(potential.openness || 0.4) * 0.45 + positive * 0.06 - negative * 0.14, 0.4),
    brevity: clamp01(preferences.preferredLength === 'short' ? 0.82 : preferences.preferredLength === 'long' ? 0.32 : 0.58 + negative * 0.12, 0.6),
    initiative: clamp01(Number(potential.initiative || 0.4) * 0.55 + positive * 0.07 - negative * 0.2, 0.35)
  };
}

function recommendedTone(weights, strongBoundary, tired) {
  if (strongBoundary) return 'respectful_reserved';
  if (tired) return 'gentle_low_pressure';
  if (weights.empathy >= 0.68) return 'warm_empathetic';
  if (weights.warmth >= 0.68) return 'warm_calm';
  return 'calm_natural';
}

function calculateInteractionPolicy(input = {}, customConfig = {}) {
  const config = mergeConfig(customConfig);
  const relationship = input.relationship || {};
  const stage = clean(relationship.potential?.relationshipStage || relationship.stage) || 'unknown';
  const stageConfig = { ...(config.stagePolicies[stage] || config.stagePolicies.unknown) };
  const signals = input.signals || relationship.signals || [];
  const recentSignals = signals.slice(-16);
  const negativeScore = signalScore(recentSignals, config.negativeSignalTypes);
  const positiveScore = signalScore(recentSignals, config.positiveSignalTypes);
  const strongBoundary = recentSignals.some(signal => config.strongBoundarySignals.includes(signal.signalType) && signal.confidence >= 0.65);
  const tired = recentSignals.some(signal => signal.signalType === 'fatigue_expressed' && signal.confidence >= 0.6);
  const unanswered = Number(relationship.interaction?.unansweredOutgoingCount || 0);
  const archived = Boolean(input.customer?.archived || input.customer?.archivedAt);

  let policy = 'reply_normally';
  let allowReplies = !archived;
  let allowProactive = !archived && config.proactiveAutomationEnabled === true;
  let blocked = false;
  let blockReason = '';
  let minimumIntervalHours = Number(stageConfig.minimumIntervalHours || 18);
  let proactiveBudget7d = Number(stageConfig.proactiveBudget7d || 0);
  let unansweredLimit = Number(stageConfig.unansweredLimit ?? 1);
  let maxQuestions = Number(stageConfig.maxQuestions ?? 1);
  let depth = clean(stageConfig.depth) || 'light_personal';
  const avoid = [];

  if (archived) {
    policy = 'manual_only';
    allowReplies = false;
    allowProactive = false;
    blocked = true;
    blockReason = 'ARCHIVED_CUSTOMER_READ_ONLY';
  } else if (strongBoundary) {
    policy = 'social_distance';
    allowProactive = false;
    minimumIntervalHours = Math.max(minimumIntervalHours, 48);
    proactiveBudget7d = 0;
    maxQuestions = 0;
    depth = 'light';
    avoid.push('连续追问', '推进私人话题', '解释或挑战对方边界');
  } else if (unanswered >= Math.max(config.freezeAfterUnanswered, unansweredLimit + 1)) {
    policy = 'wait_for_reply';
    allowProactive = false;
    minimumIntervalHours = Math.max(minimumIntervalHours, 72);
    proactiveBudget7d = 0;
    maxQuestions = 0;
    avoid.push('重复发送', '催促回复', '新增问题');
  } else if (unanswered > unansweredLimit) {
    policy = 'wait_for_reply';
    allowProactive = false;
    minimumIntervalHours = Math.max(minimumIntervalHours, 48);
    proactiveBudget7d = 0;
    maxQuestions = 0;
    avoid.push('再次主动联系', '连续追问');
  } else if (negativeScore >= 0.75 || tired) {
    policy = 'low_pressure';
    allowProactive = false;
    minimumIntervalHours = Math.max(minimumIntervalHours, 36);
    proactiveBudget7d = Math.min(proactiveBudget7d, 1);
    maxQuestions = Math.min(maxQuestions, 1);
    depth = 'light';
    avoid.push('过度热情', '长篇回复', '多个问题', '高压建议');
  } else if (positiveScore >= 0.9 && ['warming', 'trust_building', 'deep_trust'].includes(stage)) {
    policy = 'gentle_deepen';
    minimumIntervalHours = Math.max(8, minimumIntervalHours - 4);
    depth = stage === 'deep_trust' ? 'personal' : 'slightly_deeper';
  }

  const weights = toneWeights({ relationship, memory: input.memory, negativeScore, positiveScore });
  if (strongBoundary || unanswered > unansweredLimit) weights.initiative = Math.min(weights.initiative, 0.15);
  if (tired) {
    weights.brevity = Math.max(weights.brevity, 0.82);
    weights.humor = Math.min(weights.humor, 0.25);
  }

  const preferredLength = clean(input.memory?.preferences?.preferredLength || relationship.preferences?.preferredLength);
  let recommendedLength = preferredLength || (weights.brevity >= 0.72 ? 'short' : weights.brevity <= 0.38 ? 'long' : 'medium');
  if (strongBoundary || tired || negativeScore >= 0.75) recommendedLength = 'short';

  const baseTime = relationship.interaction?.lastOutboundAt || new Date().toISOString();
  const nextAllowedProactiveAt = dateAfterHours(baseTime, minimumIntervalHours);
  const confidence = clamp01(0.55 + Math.min(0.35, (positiveScore + negativeScore) * 0.07), 0.55);

  return {
    version: Number(input.previousPolicy?.version || 0) + 1,
    policy,
    allowReplies,
    allowProactive,
    blocked,
    blockReason,
    proactiveMessageBudget7d: proactiveBudget7d,
    usedThisWeek: Number(input.previousPolicy?.usedThisWeek || 0),
    unansweredLimit,
    minimumIntervalHours,
    nextAllowedProactiveAt,
    manualApprovalRequired: config.manualApprovalRequired !== false,
    replyStrategy: {
      recommendedTone: recommendedTone(weights, strongBoundary, tired),
      recommendedLength,
      recommendedDepth: depth,
      maxQuestions,
      toneWeights: weights,
      avoid: [...new Set(avoid)],
      confidence
    },
    config: {
      governorVersion: GOVERNOR_VERSION,
      proactiveAutomationEnabled: config.proactiveAutomationEnabled === true,
      manualApprovalRequired: config.manualApprovalRequired !== false
    },
    calculatedAt: new Date().toISOString()
  };
}

module.exports = {
  GOVERNOR_VERSION,
  DEFAULT_CONFIG,
  mergeConfig,
  calculateInteractionPolicy
};
