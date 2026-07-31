'use strict';

const HUMAN_TYPING_TIERS = Object.freeze({
  rapid: Object.freeze({
    silentDelayMinMs: 1_000,
    silentDelayMaxMs: 4_000,
    minBursts: 1,
    maxBursts: 2,
    burstMinMs: 1_500,
    burstMaxMs: 5_500,
    pauseMinMs: 600,
    pauseMaxMs: 1_800,
    totalMinMs: 3_000,
    totalMaxMs: 12_000
  }),
  simple: Object.freeze({
    silentDelayMinMs: 10_000,
    silentDelayMaxMs: 25_000,
    minBursts: 1,
    maxBursts: 2,
    burstMinMs: 4_000,
    burstMaxMs: 9_000,
    pauseMinMs: 2_000,
    pauseMaxMs: 4_000,
    totalMinMs: 18_000,
    totalMaxMs: 40_000
  }),
  normal: Object.freeze({
    silentDelayMinMs: 18_000,
    silentDelayMaxMs: 40_000,
    minBursts: 2,
    maxBursts: 4,
    burstMinMs: 6_000,
    burstMaxMs: 14_000,
    pauseMinMs: 2_000,
    pauseMaxMs: 6_000,
    totalMinMs: 45_000,
    totalMaxMs: 85_000
  }),
  complex: Object.freeze({
    silentDelayMinMs: 35_000,
    silentDelayMaxMs: 80_000,
    minBursts: 3,
    maxBursts: 5,
    burstMinMs: 8_000,
    burstMaxMs: 18_000,
    pauseMinMs: 3_000,
    pauseMaxMs: 8_000,
    totalMinMs: 80_000,
    totalMaxMs: 150_000
  })
});

const DEFAULT_TYPING_POLICY = Object.freeze({
  inboundTtlMs: 3000,
  outboundHeartbeatMs: 2200,

  // AI generation and quality review stay invisible to the remote party. The
  // platform presence starts only after the final reply has been frozen and
  // the user has explicitly confirmed sending it.
  platformDuringGeneration: false,
  platformAfterApproval: true,
  humanBurstPlatforms: Object.freeze(['whatsapp']),

  simpleMaxChars: 24,
  complexMinChars: 180,
  complexMinLines: 4,
  finalSendDelayMinMs: 150,
  finalSendDelayMaxMs: 700,
  finalDeliveryWaitMaxMs: 5_000,
  cancelOnNewIncomingMessage: true,
  cancelOnAccountChange: true,
  cancelOnConversationChange: true,
  cancelOnUserCancel: true,
  cancelOnManualTyping: true,
  tiers: HUMAN_TYPING_TIERS,

  // Backward-compatible single-burst policy for platforms that are not yet
  // enabled for the WhatsApp-style burst rhythm.
  baseSimulationMs: 600,
  perCharacterMs: 42,
  minSimulationMs: 1200,
  maxSimulationMs: 9000,
  jitterRatio: 0.14
});

function envNumber(env, key) {
  const value = Number(env?.[key]);
  return Number.isFinite(value) ? value : undefined;
}

function envBoolean(env, key) {
  const value = String(env?.[key] == null ? '' : env[key]).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return undefined;
}

function typingPolicyFromEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries({
    inboundTtlMs: envNumber(env, 'YANCE_TYPING_INBOUND_TTL_MS'),
    outboundHeartbeatMs: envNumber(env, 'YANCE_TYPING_HEARTBEAT_MS'),
    baseSimulationMs: envNumber(env, 'YANCE_TYPING_BASE_DELAY_MS'),
    perCharacterMs: envNumber(env, 'YANCE_TYPING_PER_CHARACTER_MS'),
    minSimulationMs: envNumber(env, 'YANCE_TYPING_MIN_DELAY_MS'),
    maxSimulationMs: envNumber(env, 'YANCE_TYPING_MAX_DELAY_MS'),
    jitterRatio: envNumber(env, 'YANCE_TYPING_JITTER_RATIO'),
    platformDuringGeneration: envBoolean(env, 'YANCE_TYPING_DURING_GENERATION'),
    platformAfterApproval: envBoolean(env, 'YANCE_TYPING_AFTER_APPROVAL'),
    simpleMaxChars: envNumber(env, 'YANCE_TYPING_SIMPLE_MAX_CHARS'),
    complexMinChars: envNumber(env, 'YANCE_TYPING_COMPLEX_MIN_CHARS'),
    complexMinLines: envNumber(env, 'YANCE_TYPING_COMPLEX_MIN_LINES'),
    finalSendDelayMinMs: envNumber(env, 'YANCE_TYPING_FINAL_SEND_MIN_MS'),
    finalSendDelayMaxMs: envNumber(env, 'YANCE_TYPING_FINAL_SEND_MAX_MS'),
    finalDeliveryWaitMaxMs: envNumber(env, 'YANCE_TYPING_FINAL_DELIVERY_WAIT_MS')
  }).filter(([, value]) => value !== undefined));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function boolean(value, fallback) {
  return value === undefined ? fallback : value === true;
}

function normalizeTier(input = {}, fallback = HUMAN_TYPING_TIERS.normal) {
  const silentDelayMinMs = clamp(input.silentDelayMinMs ?? fallback.silentDelayMinMs, 0, 120_000);
  const silentDelayMaxMs = clamp(input.silentDelayMaxMs ?? fallback.silentDelayMaxMs, silentDelayMinMs, 180_000);
  const minBursts = Math.round(clamp(input.minBursts ?? fallback.minBursts, 1, 8));
  const maxBursts = Math.round(clamp(input.maxBursts ?? fallback.maxBursts, minBursts, 8));
  const burstMinMs = clamp(input.burstMinMs ?? fallback.burstMinMs, 500, 60_000);
  const burstMaxMs = clamp(input.burstMaxMs ?? fallback.burstMaxMs, burstMinMs, 90_000);
  const pauseMinMs = clamp(input.pauseMinMs ?? fallback.pauseMinMs, 0, 30_000);
  const pauseMaxMs = clamp(input.pauseMaxMs ?? fallback.pauseMaxMs, pauseMinMs, 45_000);
  const totalMinMs = clamp(input.totalMinMs ?? fallback.totalMinMs, 1000, 240_000);
  const totalMaxMs = clamp(input.totalMaxMs ?? fallback.totalMaxMs, totalMinMs, 300_000);
  return Object.freeze({
    silentDelayMinMs,
    silentDelayMaxMs,
    minBursts,
    maxBursts,
    burstMinMs,
    burstMaxMs,
    pauseMinMs,
    pauseMaxMs,
    totalMinMs,
    totalMaxMs
  });
}

function normalizeTypingPolicy(input = {}) {
  const platforms = Array.isArray(input.humanBurstPlatforms)
    ? input.humanBurstPlatforms
    : DEFAULT_TYPING_POLICY.humanBurstPlatforms;
  const tiers = input.tiers || {};
  const finalSendDelayMinMs = clamp(input.finalSendDelayMinMs ?? DEFAULT_TYPING_POLICY.finalSendDelayMinMs, 0, 3000);
  const finalSendDelayMaxMs = clamp(input.finalSendDelayMaxMs ?? DEFAULT_TYPING_POLICY.finalSendDelayMaxMs, finalSendDelayMinMs, 5000);
  const minSimulationMs = clamp(input.minSimulationMs ?? DEFAULT_TYPING_POLICY.minSimulationMs, 500, 10000);
  const maxSimulationMs = clamp(input.maxSimulationMs ?? DEFAULT_TYPING_POLICY.maxSimulationMs, Math.max(1500, minSimulationMs), 30000);
  return Object.freeze({
    inboundTtlMs: clamp(input.inboundTtlMs ?? DEFAULT_TYPING_POLICY.inboundTtlMs, 800, 10000),
    outboundHeartbeatMs: clamp(input.outboundHeartbeatMs ?? DEFAULT_TYPING_POLICY.outboundHeartbeatMs, 900, 5000),
    platformDuringGeneration: boolean(input.platformDuringGeneration, DEFAULT_TYPING_POLICY.platformDuringGeneration),
    platformAfterApproval: boolean(input.platformAfterApproval, DEFAULT_TYPING_POLICY.platformAfterApproval),
    humanBurstPlatforms: Object.freeze([...new Set(platforms.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))]),
    simpleMaxChars: Math.round(clamp(input.simpleMaxChars ?? DEFAULT_TYPING_POLICY.simpleMaxChars, 1, 200)),
    complexMinChars: Math.round(clamp(input.complexMinChars ?? DEFAULT_TYPING_POLICY.complexMinChars, 40, 2000)),
    complexMinLines: Math.round(clamp(input.complexMinLines ?? DEFAULT_TYPING_POLICY.complexMinLines, 2, 20)),
    finalSendDelayMinMs,
    finalSendDelayMaxMs,
    finalDeliveryWaitMaxMs: clamp(input.finalDeliveryWaitMaxMs ?? DEFAULT_TYPING_POLICY.finalDeliveryWaitMaxMs, 500, 15000),
    cancelOnNewIncomingMessage: boolean(input.cancelOnNewIncomingMessage, DEFAULT_TYPING_POLICY.cancelOnNewIncomingMessage),
    cancelOnAccountChange: boolean(input.cancelOnAccountChange, DEFAULT_TYPING_POLICY.cancelOnAccountChange),
    cancelOnConversationChange: boolean(input.cancelOnConversationChange, DEFAULT_TYPING_POLICY.cancelOnConversationChange),
    cancelOnUserCancel: boolean(input.cancelOnUserCancel, DEFAULT_TYPING_POLICY.cancelOnUserCancel),
    cancelOnManualTyping: boolean(input.cancelOnManualTyping, DEFAULT_TYPING_POLICY.cancelOnManualTyping),
    tiers: Object.freeze({
      rapid: normalizeTier(tiers.rapid, HUMAN_TYPING_TIERS.rapid),
      simple: normalizeTier(tiers.simple, HUMAN_TYPING_TIERS.simple),
      normal: normalizeTier(tiers.normal, HUMAN_TYPING_TIERS.normal),
      complex: normalizeTier(tiers.complex, HUMAN_TYPING_TIERS.complex)
    }),
    baseSimulationMs: clamp(input.baseSimulationMs ?? DEFAULT_TYPING_POLICY.baseSimulationMs, 0, 5000),
    perCharacterMs: clamp(input.perCharacterMs ?? DEFAULT_TYPING_POLICY.perCharacterMs, 10, 120),
    minSimulationMs,
    maxSimulationMs,
    jitterRatio: clamp(input.jitterRatio ?? DEFAULT_TYPING_POLICY.jitterRatio, 0, 0.35)
  });
}

function characterCount(text) {
  return [...String(text == null ? '' : text)].length;
}

function calculateTypingDelay(text, inputPolicy = {}, entropy = Math.random()) {
  const policy = normalizeTypingPolicy(inputPolicy);
  const count = characterCount(text);
  const raw = policy.baseSimulationMs + count * policy.perCharacterMs;
  const normalizedEntropy = clamp(entropy, 0, 1);
  const jitter = 1 + ((normalizedEntropy * 2) - 1) * policy.jitterRatio;
  return Math.round(clamp(raw * jitter, policy.minSimulationMs, policy.maxSimulationMs));
}

function randomValue(random = Math.random) {
  const value = typeof random === 'function' ? random() : random;
  return clamp(value, 0, 1);
}

function randomBetween(min, max, random = Math.random) {
  if (max <= min) return Math.round(min);
  return Math.round(min + (max - min) * randomValue(random));
}

function randomInteger(min, max, random = Math.random) {
  if (max <= min) return Math.round(min);
  return Math.min(max, Math.floor(min + (max - min + 1) * randomValue(random)));
}

function resolveTypingTier(text, inputPolicy = {}, options = {}) {
  const policy = normalizeTypingPolicy(inputPolicy);
  const explicit = String(options.tier || options.complexityHint || '').trim().toLowerCase();
  if (['rapid', 'simple', 'normal', 'complex'].includes(explicit)) return explicit;
  if (/(rapid_chat|instant|fast|极速|热聊)/i.test(explicit)) return 'rapid';
  if (/(deep|emotional|emotion|complex|sensitive|情绪|复杂|敏感)/i.test(explicit)) return 'complex';
  const body = String(text == null ? '' : text).trim();
  const count = characterCount(body);
  const lines = body ? body.split(/\r?\n/).filter(line => line.trim()).length : 0;
  if (count <= policy.simpleMaxChars && lines <= 1) return 'simple';
  if (count >= policy.complexMinChars || lines >= policy.complexMinLines) return 'complex';
  return 'normal';
}

function adjustComponents(components, delta, direction, random = Math.random) {
  let remaining = Math.max(0, Math.round(delta));
  if (!remaining) return;
  const shuffled = components
    .map(component => ({ component, order: randomValue(random) }))
    .sort((a, b) => a.order - b.order)
    .map(row => row.component);
  let guard = 0;
  while (remaining > 0 && guard++ < 32) {
    const available = shuffled.filter(component => direction > 0
      ? component.value < component.max
      : component.value > component.min);
    if (!available.length) break;
    for (const component of available) {
      const capacity = direction > 0 ? component.max - component.value : component.value - component.min;
      if (capacity <= 0) continue;
      const share = Math.max(1, Math.ceil(remaining / available.length));
      const change = Math.min(capacity, share, remaining);
      component.value += direction * change;
      remaining -= change;
      if (remaining <= 0) break;
    }
  }
}

function buildHumanTypingPlan(text, inputPolicy = {}, options = {}) {
  const policy = normalizeTypingPolicy(inputPolicy);
  const tierName = resolveTypingTier(text, policy, options);
  const tier = policy.tiers[tierName];
  const random = options.random || Math.random;
  const count = characterCount(text);
  let burstCount = randomInteger(tier.minBursts, tier.maxBursts, random);
  if (tierName === 'rapid') {
    if (count <= 18) burstCount = 1;
    else burstCount = Math.min(2, Math.max(1, burstCount));
  }
  if (tierName === 'simple') {
    if (count <= 8) burstCount = 1;
    else if (count > Math.max(12, Math.floor(policy.simpleMaxChars * 0.66))) burstCount = Math.max(2, burstCount);
  }

  const silent = {
    kind: 'silent',
    min: tier.silentDelayMinMs,
    max: tier.silentDelayMaxMs,
    value: randomBetween(tier.silentDelayMinMs, tier.silentDelayMaxMs, random)
  };
  const bursts = Array.from({ length: burstCount }, () => ({
    kind: 'burst',
    min: tier.burstMinMs,
    max: tier.burstMaxMs,
    value: randomBetween(tier.burstMinMs, tier.burstMaxMs, random)
  }));
  const pauses = Array.from({ length: Math.max(0, burstCount - 1) }, () => ({
    kind: 'pause',
    min: tier.pauseMinMs,
    max: tier.pauseMaxMs,
    value: randomBetween(tier.pauseMinMs, tier.pauseMaxMs, random)
  }));
  const finalDelay = {
    kind: 'final',
    min: policy.finalSendDelayMinMs,
    max: policy.finalSendDelayMaxMs,
    value: randomBetween(policy.finalSendDelayMinMs, policy.finalSendDelayMaxMs, random)
  };
  const components = [silent, ...bursts, ...pauses, finalDelay];
  let total = components.reduce((sum, component) => sum + component.value, 0);
  if (total < tier.totalMinMs) adjustComponents(components, tier.totalMinMs - total, 1, random);
  total = components.reduce((sum, component) => sum + component.value, 0);
  if (total > tier.totalMaxMs) adjustComponents(components, total - tier.totalMaxMs, -1, random);
  total = components.reduce((sum, component) => sum + component.value, 0);

  return Object.freeze({
    kind: 'human-bursts',
    tier: tierName,
    characterCount: count,
    silentDelayMs: silent.value,
    bursts: Object.freeze(bursts.map((burst, index) => Object.freeze({
      durationMs: burst.value,
      pauseAfterMs: pauses[index]?.value || 0
    }))),
    finalSendDelayMs: finalDelay.value,
    totalMs: total
  });
}

function buildSingleTypingPlan(text, inputPolicy = {}, options = {}) {
  const delayMs = calculateTypingDelay(text, inputPolicy, randomValue(options.random || Math.random));
  return Object.freeze({
    kind: 'single-burst',
    tier: 'single',
    characterCount: characterCount(text),
    silentDelayMs: 0,
    bursts: Object.freeze([Object.freeze({ durationMs: delayMs, pauseAfterMs: 0 })]),
    finalSendDelayMs: 0,
    totalMs: delayMs
  });
}

function normalizeActivity(value) {
  const state = String(value == null ? '' : value).trim().toLowerCase();
  if (['composing', 'typing', 'sendmessagetypingaction'].includes(state)) return 'composing';
  if (/record|voice|audio/.test(state)) return 'recording';
  if (/upload|photo|video|document|sticker|file/.test(state)) return 'uploading';
  if (['paused', 'cancel', 'available', 'unavailable', 'offline', 'none', 'sendmessagecancelaction'].includes(state)) return 'paused';
  return state || 'paused';
}

function activityIsActive(value) {
  return ['composing', 'recording', 'uploading'].includes(normalizeActivity(value));
}

function incomingTypingLabel(activity = 'composing') {
  const normalized = normalizeActivity(activity);
  if (normalized === 'recording') return '对方正在录音…';
  if (normalized === 'uploading') return '对方正在发送附件…';
  return '对方正在输入…';
}

module.exports = {
  HUMAN_TYPING_TIERS,
  DEFAULT_TYPING_POLICY,
  normalizeTypingPolicy,
  calculateTypingDelay,
  buildHumanTypingPlan,
  buildSingleTypingPlan,
  resolveTypingTier,
  normalizeActivity,
  activityIsActive,
  incomingTypingLabel,
  characterCount,
  typingPolicyFromEnvironment,
  randomBetween,
  randomInteger
};
