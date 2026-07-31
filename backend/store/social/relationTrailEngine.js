'use strict';

const { createRelationshipTimelineEvent } = require('./socialSignalSchema');
const messageSpeakerAuthority = require('../../services/messageSpeakerAuthority');

const ENGINE_VERSION = '2.0.0';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function timestamp(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function average(values) {
  const rows = values.filter(value => Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function isInbound(row) {
  return messageSpeakerAuthority.isPeerInbound(row);
}

function isOutbound(row) {
  return messageSpeakerAuthority.isSelfOutbound(row);
}

const SIGNAL_EFFECTS = Object.freeze({
  emotion_declining: { warmth: -0.07, openness: -0.05, tension: 0.12, energy: -0.09 },
  emotion_recovering: { warmth: 0.08, openness: 0.07, tension: -0.12, energy: 0.1 },
  defensiveness_increasing: { warmth: -0.11, openness: -0.16, trust: -0.07, tension: 0.18, socialDistance: 0.14 },
  fatigue_expressed: { energy: -0.16, tension: 0.04, openness: -0.03 },
  warmth_increasing: { warmth: 0.1, trust: 0.04, socialDistance: -0.05 },
  tension_increasing: { tension: 0.15, warmth: -0.05 },
  openness_increasing: { openness: 0.11, trust: 0.04, socialDistance: -0.04 },
  energy_decreasing: { energy: -0.13, initiative: -0.04 },

  initiative_declining: { initiative: -0.13, momentum: -0.08 },
  initiative_recovering: { initiative: 0.11, momentum: 0.08 },
  topic_depth_increasing: { openness: 0.09, trust: 0.05, intimacy: 0.06 },
  private_sharing: { openness: 0.13, trust: 0.09, intimacy: 0.08, socialDistance: -0.07 },
  trust_expressed: { trust: 0.16, warmth: 0.06, intimacy: 0.08, socialDistance: -0.09 },
  boundary_expressed: { tension: 0.05, socialDistance: 0.12 },
  distance_increasing: { warmth: -0.08, openness: -0.08, initiative: -0.09, socialDistance: 0.14 },
  relationship_rewarming: { warmth: 0.11, openness: 0.08, initiative: 0.07, momentum: 0.12, socialDistance: -0.06 },

  reply_speed_increasing: { initiative: 0.06, momentum: 0.06 },
  reply_speed_decreasing: { initiative: -0.05, momentum: -0.05 },
  reply_length_shortening: { openness: -0.04, energy: -0.04 },
  reply_length_increasing: { openness: 0.05, energy: 0.03 },
  consecutive_no_reply: { initiative: -0.12, momentum: -0.1, socialDistance: 0.08 },
  topic_avoidance: { openness: -0.1, tension: 0.08, socialDistance: 0.07 },
  question_tolerance_low: { tension: 0.06, openness: -0.05 },
  preferred_time_detected: {}
});

const EVENT_INTERPRETATIONS = Object.freeze({
  emotion_declining: '对方近期情绪或压力状态下降，互动应更克制。',
  emotion_recovering: '对方情绪较此前低点明显恢复，可适度提高共鸣与话题深度。',
  defensiveness_increasing: '对方防御感增强，应立即减少追问并尊重边界。',
  fatigue_expressed: '对方表达疲惫，应降低消息长度和互动负担。',
  warmth_increasing: '对方回应温暖度提升，关系氛围正在改善。',
  openness_increasing: '对方愿意分享更多内容，开放度正在提升。',
  initiative_declining: '对方主动性下降，下一步应减少主动联系。',
  initiative_recovering: '对方重新主动延续对话，互动意愿正在恢复。',
  topic_depth_increasing: '话题深度增加，可在不越界的前提下继续深入。',
  private_sharing: '对方主动分享私人信息，信任与开放度可能提升。',
  trust_expressed: '对方明确表达信任，应以稳重和保密感回应。',
  boundary_expressed: '对方明确表达边界，后续策略必须避开该方向。',
  relationship_rewarming: '此前偏冷的关系正在重新升温，但仍需逐步推进。',
  reply_speed_increasing: '回复速度明显变快，当前互动投入度提升。',
  reply_speed_decreasing: '回复速度明显变慢，应降低主动频率。',
  reply_length_shortening: '回复明显变短，可能忙碌、疲惫或互动意愿下降。',
  reply_length_increasing: '回复内容变长，当前表达意愿增强。',
  consecutive_no_reply: '连续未回复，自动主动互动应暂停。',
  topic_avoidance: '对方回避当前话题，应立即转向更安全的方向。',
  question_tolerance_low: '对连续提问的耐受度下降，回复中应减少问题。'
});

function basePotential(previous = {}) {
  const potential = previous.potential || {};
  const emotion = previous.emotion || {};
  return {
    relationshipStage: clean(potential.relationshipStage || previous.stage) || 'unknown',
    warmth: clamp01(potential.warmth ?? emotion.warmth, 0.42),
    openness: clamp01(potential.openness ?? emotion.openness, 0.4),
    trust: clamp01(potential.trust ?? emotion.trust, 0.35),
    initiative: clamp01(potential.initiative ?? previous.initiative, 0.4),
    tension: clamp01(potential.tension ?? emotion.tension, 0.25),
    intimacy: clamp01(potential.intimacy ?? previous.intimacy, 0.3),
    energy: clamp01(potential.energy ?? emotion.energy, 0.5),
    momentumScore: Number(potential.momentumScore || 0),
    socialDistanceScore: clamp01(potential.socialDistanceScore, 0.55),
    confidence: clamp01(potential.confidence, 0.45)
  };
}

function applySignals(previous, signals) {
  const next = basePotential(previous);
  let evidenceWeight = 0;
  let signedMomentum = 0;
  for (const signal of signals || []) {
    const effect = SIGNAL_EFFECTS[signal.signalType] || {};
    const weight = clamp01(signal.strength, 0.5) * clamp01(signal.confidence, 0.5);
    evidenceWeight += weight;
    signedMomentum += signal.direction === 'positive' ? weight : signal.direction === 'negative' ? -weight : 0;
    for (const [key, delta] of Object.entries(effect)) {
      const scaled = Number(delta) * weight;
      if (key === 'socialDistance') next.socialDistanceScore = clamp01(next.socialDistanceScore + scaled, next.socialDistanceScore);
      else if (key === 'momentum') next.momentumScore = Math.max(-1, Math.min(1, next.momentumScore + scaled));
      else next[key] = clamp01(Number(next[key] || 0) + scaled, next[key] || 0);
    }
  }
  next.momentumScore = Math.max(-1, Math.min(1, next.momentumScore * 0.65 + signedMomentum * 0.18));
  next.confidence = clamp01(0.45 + Math.min(0.45, evidenceWeight * 0.08), 0.45);
  return next;
}

function relationshipStage(potential) {
  if (potential.tension >= 0.72 || potential.socialDistanceScore >= 0.83) return 'cooling';
  const bond = potential.warmth * 0.25 + potential.openness * 0.25 + potential.trust * 0.3 + potential.intimacy * 0.2;
  if (bond >= 0.77) return 'deep_trust';
  if (bond >= 0.64) return 'trust_building';
  if (bond >= 0.52) return 'warming';
  if (bond >= 0.38) return 'familiar';
  return 'new';
}

function momentumLabel(score) {
  if (score >= 0.16) return 'improving';
  if (score <= -0.16) return 'declining';
  return 'stable';
}

function socialDistanceLabel(score) {
  if (score >= 0.75) return 'distant';
  if (score <= 0.35) return 'close';
  return 'moderate';
}

function currentEmotion(signals, potential) {
  const types = new Set((signals || []).map(row => row.signalType));
  if (types.has('defensiveness_increasing')) return 'defensive';
  if (types.has('fatigue_expressed')) return 'tired';
  if (types.has('emotion_declining')) return 'low';
  if (types.has('emotion_recovering')) return 'recovering';
  if (types.has('warmth_increasing') || types.has('trust_expressed')) return 'warm';
  if (potential.tension >= 0.6) return 'tense';
  if (potential.warmth >= 0.62) return 'relaxed';
  return 'neutral';
}

function calculateInteraction(messages = [], previous = {}) {
  const sorted = [...messages].filter(Boolean).sort((a, b) => timestamp(a.sentAt || a.timestamp) - timestamp(b.sentAt || b.timestamp));
  const inbound = sorted.filter(isInbound);
  const outbound = sorted.filter(isOutbound);
  const replyDelays = [];
  for (const incoming of inbound) {
    const incomingAt = timestamp(incoming.sentAt || incoming.timestamp);
    const preceding = outbound.filter(row => timestamp(row.sentAt || row.timestamp) < incomingAt).at(-1);
    if (preceding) {
      const delay = (incomingAt - timestamp(preceding.sentAt || preceding.timestamp)) / 60000;
      if (delay >= 0 && delay <= 60 * 24 * 14) replyDelays.push(delay);
    }
  }
  let unansweredOutgoingCount = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (isInbound(sorted[index])) break;
    if (isOutbound(sorted[index])) unansweredOutgoingCount += 1;
  }
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentInbound = inbound.filter(row => timestamp(row.sentAt || row.timestamp) >= sevenDaysAgo);
  const recentOutbound = outbound.filter(row => timestamp(row.sentAt || row.timestamp) >= sevenDaysAgo);
  const initiations = sorted.filter((row, index) => {
    if (!isInbound(row)) return false;
    const previousRow = sorted[index - 1];
    if (!previousRow) return true;
    return timestamp(row.sentAt || row.timestamp) - timestamp(previousRow.sentAt || previousRow.timestamp) >= 8 * 60 * 60 * 1000;
  });
  const hours = inbound.map(row => new Date(row.sentAt || row.timestamp).getHours()).filter(Number.isFinite);
  const hourBuckets = new Map();
  for (const hour of hours) hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
  const preferredHours = [...hourBuckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hour]) => `${String(hour).padStart(2, '0')}:00-${String((hour + 2) % 24).padStart(2, '0')}:00`);
  return {
    ...previous,
    averageReplyDelayMinutes: replyDelays.length ? Math.round(average(replyDelays)) : Number(previous.averageReplyDelayMinutes || 0),
    unansweredOutgoingCount,
    responseRate7d: recentOutbound.length ? clamp01(recentInbound.length / recentOutbound.length, 0) : (recentInbound.length ? 1 : clamp01(previous.responseRate7d, 0)),
    initiatesConversationRate: inbound.length ? clamp01(initiations.length / inbound.length, 0) : clamp01(previous.initiatesConversationRate, 0),
    lastInboundAt: clean(inbound.at(-1)?.sentAt || inbound.at(-1)?.timestamp),
    lastOutboundAt: clean(outbound.at(-1)?.sentAt || outbound.at(-1)?.timestamp),
    preferredActiveHours: preferredHours.length ? preferredHours : (previous.preferredActiveHours || [])
  };
}

function shouldTimeline(signal) {
  if (signal.status === 'confirmed') return true;
  return signal.confidence >= 0.68 && signal.strength >= 0.5;
}

function projectionKey(row = {}, fallback = '') {
  return clean(row.idempotencyKey || row.signalId || row.eventId || fallback);
}

function mergeProjectionRows(previous = [], incoming = []) {
  const rows = new Map();
  for (const row of [...(previous || []), ...(incoming || [])]) {
    if (!row) continue;
    const key = projectionKey(row, `${clean(row.messageId)}:${clean(row.signalType || row.eventType)}:${clean(row.parserVersion || row.engineVersion)}`);
    if (!key) continue;
    rows.set(key, row);
  }
  return [...rows.values()];
}

function buildTimelineEvents(input, before, after, options = {}) {
  const rows = [];
  for (const signal of input.signals || []) {
    if (!shouldTimeline(signal)) continue;
    rows.push(createRelationshipTimelineEvent({
      contactId: input.contactId,
      conversationId: input.conversationId,
      platform: signal.platform || input.platform,
      sourceAccountId: signal.sourceAccountId || input.sourceAccountId,
      platformMessageId: signal.platformMessageId || signal.messageId,
      projectionVersion: ENGINE_VERSION,
      eventType: signal.signalType,
      startedAt: signal.observedAt,
      confirmedAt: signal.observedAt,
      before,
      after,
      interpretation: EVENT_INTERPRETATIONS[signal.signalType] || '关系状态出现可解释变化。',
      evidenceMessageIds: signal.evidence?.messageIds || [signal.messageId],
      sourceSignalIds: [signal.signalId],
      confidence: signal.confidence,
      status: signal.status,
      engineVersion: ENGINE_VERSION
    }, { idFactory: options.idFactory }));
  }
  const recentNegative = (input.previous?.timeline || []).slice(-12).some(event =>
    ['emotion_declining', 'distance_increasing', 'initiative_declining', 'defensiveness_increasing'].includes(event.eventType) &&
    Date.now() - timestamp(event.confirmedAt) <= 7 * 24 * 60 * 60 * 1000
  );
  const recovering = (input.signals || []).some(signal => ['emotion_recovering', 'warmth_increasing', 'initiative_recovering'].includes(signal.signalType));
  if (recentNegative && recovering && !rows.some(row => row.eventType === 'relationship_rewarming')) {
    const evidence = (input.signals || []).filter(signal => ['emotion_recovering', 'warmth_increasing', 'initiative_recovering'].includes(signal.signalType));
    rows.push(createRelationshipTimelineEvent({
      contactId: input.contactId,
      conversationId: input.conversationId,
      platform: evidence[0]?.platform || input.platform,
      sourceAccountId: evidence[0]?.sourceAccountId || input.sourceAccountId,
      platformMessageId: evidence[0]?.platformMessageId || evidence[0]?.messageId,
      projectionVersion: ENGINE_VERSION,
      eventType: 'relationship_rewarming',
      startedAt: evidence[0]?.observedAt,
      confirmedAt: evidence.at(-1)?.observedAt,
      before,
      after,
      interpretation: EVENT_INTERPRETATIONS.relationship_rewarming,
      evidenceMessageIds: [...new Set(evidence.flatMap(signal => signal.evidence?.messageIds || [signal.messageId]))],
      sourceSignalIds: evidence.map(signal => signal.signalId),
      confidence: average(evidence.map(signal => signal.confidence)),
      status: 'candidate',
      engineVersion: ENGINE_VERSION
    }, { idFactory: options.idFactory }));
  }
  return rows;
}

function evolveRelationship(input = {}, options = {}) {
  const previous = input.previous || {};
  const previousSignals = Array.isArray(previous.signals) ? previous.signals : [];
  const existingSignalKeys = new Set(previousSignals.map(row => projectionKey(row, `${clean(row.messageId)}:${clean(row.signalType)}:${clean(row.parserVersion)}`)).filter(Boolean));
  const effectiveSignals = (input.signals || []).filter(row => {
    const key = projectionKey(row, `${clean(row.messageId)}:${clean(row.signalType)}:${clean(row.parserVersion)}`);
    return key && !existingSignalKeys.has(key);
  });
  const beforeRaw = basePotential(previous);
  const afterRaw = effectiveSignals.length ? applySignals(previous, effectiveSignals) : basePotential(previous);
  const stage = relationshipStage(afterRaw);
  const potential = {
    relationshipStage: stage,
    warmth: afterRaw.warmth,
    openness: afterRaw.openness,
    trust: afterRaw.trust,
    initiative: afterRaw.initiative,
    tension: afterRaw.tension,
    intimacy: afterRaw.intimacy,
    energy: afterRaw.energy,
    momentum: momentumLabel(afterRaw.momentumScore),
    momentumScore: afterRaw.momentumScore,
    stability: Math.abs(afterRaw.momentumScore) <= 0.18 ? 'stable' : 'changing',
    socialDistance: socialDistanceLabel(afterRaw.socialDistanceScore),
    socialDistanceScore: afterRaw.socialDistanceScore,
    confidence: afterRaw.confidence
  };
  const before = {
    relationshipStage: relationshipStage(beforeRaw),
    warmth: beforeRaw.warmth,
    openness: beforeRaw.openness,
    trust: beforeRaw.trust,
    initiative: beforeRaw.initiative,
    tension: beforeRaw.tension,
    intimacy: beforeRaw.intimacy,
    energy: beforeRaw.energy,
    momentum: momentumLabel(beforeRaw.momentumScore),
    socialDistance: socialDistanceLabel(beforeRaw.socialDistanceScore)
  };
  const interaction = calculateInteraction(input.recentMessages || [], previous.interaction || {});
  const emotion = {
    current: currentEmotion(effectiveSignals, potential),
    warmth: potential.warmth,
    openness: potential.openness,
    trust: potential.trust,
    tension: potential.tension,
    energy: potential.energy,
    trend: potential.momentum,
    volatility: Math.abs(potential.momentumScore) >= 0.38 ? 'high' : Math.abs(potential.momentumScore) >= 0.18 ? 'medium' : 'low'
  };
  const timelineEvents = buildTimelineEvents({ ...input, signals: effectiveSignals }, before, potential, options);
  return {
    version: Number(previous.version || 0) + 1,
    stage,
    relationship: {
      stage,
      intimacy: potential.intimacy,
      openness: potential.openness,
      trust: potential.trust,
      initiativeBalance: potential.initiative
    },
    potential,
    emotion,
    interaction,
    signals: mergeProjectionRows(previousSignals, input.signals || []).slice(-120),
    timeline: mergeProjectionRows(previous.timeline || [], timelineEvents).slice(-120),
    timelineEvents,
    sourceMessageId: clean(input.message?.id),
    sourceMessageAt: clean(input.message?.sentAt || input.message?.timestamp),
    calculatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION
  };
}

module.exports = {
  ENGINE_VERSION,
  SIGNAL_EFFECTS,
  evolveRelationship,
  calculateInteraction,
  relationshipStage,
  momentumLabel,
  socialDistanceLabel,
  mergeProjectionRows,
  buildTimelineEvents
};
