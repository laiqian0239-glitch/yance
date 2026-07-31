'use strict';

const MODES = Object.freeze({
  rapid: Object.freeze({
    id: 'rapid',
    label: '极速',
    recentMessages: 12,
    confirmedFacts: 4,
    memoriesPerType: 3,
    timelineEvents: 3,
    signals: 4,
    maxContextChars: 9000,
    maxTokens: 180,
    timeoutMs: 180000,
    keepAlive: '30m',
    candidateCount: 3,
    quietWindowMs: 1200,
    maxAggregationMs: 3500
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: '平衡',
    recentMessages: 24,
    confirmedFacts: 8,
    memoriesPerType: 6,
    timelineEvents: 6,
    signals: 8,
    maxContextChars: 16000,
    maxTokens: 260,
    timeoutMs: 180000,
    keepAlive: '20m',
    candidateCount: 3,
    quietWindowMs: 2500,
    maxAggregationMs: 6500
  }),
  deep: Object.freeze({
    id: 'deep',
    label: '深度',
    recentMessages: 40,
    confirmedFacts: 12,
    memoriesPerType: 10,
    timelineEvents: 12,
    signals: 12,
    maxContextChars: 28000,
    maxTokens: 480,
    timeoutMs: 240000,
    keepAlive: '15m',
    candidateCount: 5,
    quietWindowMs: 3500,
    maxAggregationMs: 10000
  })
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeMode(value, fallback = 'balanced') {
  const mode = clean(value).toLowerCase();
  if (mode === 'rapid' || mode === '极速' || mode === 'fast' || mode === 'rapid_chat' || mode === 'instant') return 'rapid';
  if (mode === 'deep' || mode === '深度' || mode === 'deep_reply' || mode === 'quality') return 'deep';
  if (mode === '平衡' || mode === 'normal' || mode === 'balanced') return 'balanced';
  return MODES[fallback] ? fallback : 'balanced';
}

function elapsedMs(left, right) {
  const a = Date.parse(clean(left));
  const b = Date.parse(clean(right));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) : Number.POSITIVE_INFINITY;
}

function inferMode(input = {}, packet = {}) {
  const explicit = clean(input.performanceMode || input.speedMode || input.replyMode);
  if (explicit) return normalizeMode(explicit);

  const messages = Array.isArray(packet.recentMessages) ? packet.recentMessages : [];
  const latest = messages.slice(-6);
  const incomingText = clean(packet.incomingMessage?.text);
  const rapidIntervals = [];
  for (let index = 1; index < latest.length; index += 1) {
    const delta = elapsedMs(latest[index - 1]?.sentAt || latest[index - 1]?.timestamp, latest[index]?.sentAt || latest[index]?.timestamp);
    if (Number.isFinite(delta)) rapidIntervals.push(delta);
  }
  const activeRapidChat = rapidIntervals.length >= 2 && rapidIntervals.slice(-4).filter(value => value <= 120000).length >= 2;
  const complex = incomingText.length >= 420 || /(?:误会|争执|道歉|关系|分开|见面|承诺|情绪|复杂|serious|relationship|apolog|missunderstand)/iu.test(incomingText);
  if (complex) return 'deep';
  if (activeRapidChat || incomingText.length <= 80) return 'rapid';
  return 'balanced';
}

function policyFor(input = {}, packet = {}) {
  const mode = inferMode(input, packet);
  return MODES[mode] || MODES.balanced;
}

function generationOptions(input = {}, packet = {}) {
  const policy = policyFor(input, packet);
  const temperature = Number(input.temperature);
  const maxTokens = Number(input.maxTokens);
  const timeoutMs = Number(input.timeoutMs);
  return {
    mode: policy.id,
    policy,
    options: {
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(1.2, temperature)) : (policy.id === 'rapid' ? 0.48 : policy.id === 'deep' ? 0.58 : 0.52),
      maxTokens: Number.isFinite(maxTokens) ? Math.max(48, Math.min(1200, Math.round(maxTokens))) : policy.maxTokens,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(5000, Math.min(300000, Math.round(timeoutMs))) : policy.timeoutMs,
      keepAlive: clean(input.keepAlive) || policy.keepAlive
    }
  };
}

module.exports = {
  MODES,
  normalizeMode,
  inferMode,
  policyFor,
  generationOptions
};
