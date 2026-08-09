'use strict';

const { isPlainObject, clone, sha256Json } = require('./canonicalJson');

const STYLE_DIRECTIONS = Object.freeze({
  matureWarm: '成熟',
  femininity: '温柔',
  softWoman: '小女人',
  queen: '高冷',
  ambiguity: '暧昧',
  individuality: '个性',
  coquettish: '风骚',
  sensualPlayfulness: '俏皮',
  flirting: '调情',
  initiative: '主动',
  mystery: '神秘',
  humor: '幽默'
});
const REQUIRED_STYLE_LABELS = Object.freeze(['暧昧', '小女人', '风骚', '调情', '个性', '温柔', '成熟', '高冷', '主动', '神秘', '幽默', '俏皮']);
const STYLE_INTENSITIES = Object.freeze(['natural', 'obvious', 'strong']);
const DEFAULT_STYLE_WEIGHTS = Object.freeze({
  matureWarm: 20,
  femininity: 25,
  softWoman: 10,
  queen: 10,
  ambiguity: 10,
  individuality: 10,
  coquettish: 5,
  sensualPlayfulness: 5,
  flirting: 5,
  initiative: 0,
  mystery: 0,
  humor: 0
});
const QUICK_ADJUSTMENTS = Object.freeze({
  '更温柔': { matureWarm: 20 },
  '更有女人味': { femininity: 20 },
  '更像小女人': { softWoman: 20 },
  '更有女王感': { queen: 20 },
  '更暧昧': { ambiguity: 20 },
  '更风骚': { coquettish: 20 },
  '更有情趣': { sensualPlayfulness: 20 },
  '更会调情': { flirting: 20 },
  '更有个性': { individuality: 20 },
  '更主动': { initiative: 20 },
  '更短': { brevity: 30 },
  '更直接': { directness: 25 }
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : 0;
}
function normalizeDirectionKey(key) {
  const cleanKey = clean(key);
  if (Object.hasOwn(STYLE_DIRECTIONS, cleanKey)) return cleanKey;
  const aliases = {
    mature: 'matureWarm', warm: 'matureWarm', 成熟温柔: 'matureWarm', 成熟: 'matureWarm',
    feminine: 'femininity', 女人味: 'femininity', 温柔: 'femininity',
    littleWoman: 'softWoman', 小女人: 'softWoman', 柔软小女人感: 'softWoman',
    queenly: 'queen', 女王: 'queen', 女王感: 'queen', 高冷: 'queen',
    ambiguous: 'ambiguity', 暧昧: 'ambiguity',
    personality: 'individuality', 个性: 'individuality',
    sexy: 'coquettish', coquettishness: 'coquettish', 风骚: 'coquettish',
    playfulness: 'sensualPlayfulness', 情趣: 'sensualPlayfulness', 俏皮: 'sensualPlayfulness',
    flirt: 'flirting', 调情: 'flirting',
    initiative: 'initiative', 主动: 'initiative',
    mystery: 'mystery', 神秘: 'mystery',
    humor: 'humor', 幽默: 'humor'
  };
  return aliases[cleanKey] || '';
}
function normalizeDirections(value = {}) {
  const output = { ...DEFAULT_STYLE_WEIGHTS };
  if (!isPlainObject(value)) return output;
  for (const [key, weight] of Object.entries(value)) {
    const normalized = normalizeDirectionKey(key);
    if (normalized) output[normalized] = clamp(weight);
  }
  return output;
}
function normalizeStylePolicy(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const intensity = STYLE_INTENSITIES.includes(clean(source.intensity)) ? clean(source.intensity) : 'natural';
  return {
    directions: normalizeDirections(source.directions),
    intensity,
    allowBoldInitiative: source.allowBoldInitiative !== false,
    avoidMechanicalFlirting: source.avoidMechanicalFlirting !== false,
    forbiddenExpressions: Array.isArray(source.forbiddenExpressions) ? source.forbiddenExpressions.map(clean).filter(Boolean).slice(0, 100) : [],
    preferences: Array.isArray(source.preferences) ? source.preferences.map(clean).filter(Boolean).slice(0, 100) : []
  };
}
function mergeStylePolicy(base = {}, overlay = {}) {
  const normalizedBase = normalizeStylePolicy(base);
  const source = isPlainObject(overlay) ? overlay : {};
  const directions = { ...normalizedBase.directions };
  if (isPlainObject(source.directions)) {
    for (const [key, value] of Object.entries(source.directions)) {
      const normalized = normalizeDirectionKey(key);
      if (normalized) directions[normalized] = clamp(value);
    }
  }
  return normalizeStylePolicy({
    ...normalizedBase,
    ...clone(source),
    directions,
    forbiddenExpressions: source.forbiddenExpressions || normalizedBase.forbiddenExpressions,
    preferences: source.preferences || normalizedBase.preferences
  });
}
function candidateAdjustmentOverlay(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const quick = clean(source.quickAdjustment || source.variant);
  const mapped = QUICK_ADJUSTMENTS[quick] || {};
  const directions = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (Object.hasOwn(STYLE_DIRECTIONS, key)) directions[key] = value;
  }
  if (isPlainObject(source.styleWeights)) {
    for (const [key, value] of Object.entries(source.styleWeights)) {
      const normalized = normalizeDirectionKey(key);
      if (normalized) directions[normalized] = clamp(value);
    }
  }
  return {
    directions,
    intensity: STYLE_INTENSITIES.includes(clean(source.styleIntensity)) ? clean(source.styleIntensity) : undefined,
    candidateOnly: true,
    initiative: clamp(mapped.initiative || source.initiative),
    brevity: clamp(mapped.brevity || source.brevity),
    directness: clamp(mapped.directness || source.directness),
    label: quick
  };
}
function describeStylePolicy(policy = {}, presentationProfile = {}) {
  const normalized = normalizeStylePolicy(policy);
  const labels = Object.entries(normalized.directions)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, weight]) => ({ key, label: STYLE_DIRECTIONS[key], weight }));
  const expressionHabits = Array.isArray(presentationProfile?.expressionHabits) ? presentationProfile.expressionHabits.map(clean).filter(Boolean).slice(0, 32) : [];
  const replyStylePreferences = Array.isArray(presentationProfile?.replyStylePreferences) ? presentationProfile.replyStylePreferences.map(clean).filter(Boolean).slice(0, 32) : [];
  const forbiddenExpressions = [
    ...normalized.forbiddenExpressions,
    ...(Array.isArray(presentationProfile?.forbiddenExpressions) ? presentationProfile.forbiddenExpressions.map(clean).filter(Boolean) : [])
  ].filter(Boolean).slice(0, 64);
  return {
    ...normalized,
    expressionHabits,
    replyStylePreferences,
    forbiddenExpressions,
    labels,
    requiredLabels: [...REQUIRED_STYLE_LABELS]
  };
}
function stylePolicyHash(policy = {}) { return sha256Json(normalizeStylePolicy(policy)); }

module.exports = {
  STYLE_DIRECTIONS,
  REQUIRED_STYLE_LABELS,
  STYLE_INTENSITIES,
  DEFAULT_STYLE_WEIGHTS,
  QUICK_ADJUSTMENTS,
  normalizeDirectionKey,
  normalizeDirections,
  normalizeStylePolicy,
  mergeStylePolicy,
  candidateAdjustmentOverlay,
  describeStylePolicy,
  stylePolicyHash
};
