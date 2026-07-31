'use strict';

const { createHash, randomUUID } = require('crypto');

const SIGNAL_DIMENSIONS = Object.freeze({
  emotion: 'emotion',
  relationship: 'relationship',
  interaction: 'interaction'
});

const SIGNAL_DIRECTIONS = Object.freeze({
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral'
});

const SIGNAL_TYPES = Object.freeze({
  emotion_declining: { dimension: 'emotion', direction: 'negative' },
  emotion_recovering: { dimension: 'emotion', direction: 'positive' },
  defensiveness_increasing: { dimension: 'emotion', direction: 'negative' },
  fatigue_expressed: { dimension: 'emotion', direction: 'negative' },
  warmth_increasing: { dimension: 'emotion', direction: 'positive' },
  tension_increasing: { dimension: 'emotion', direction: 'negative' },
  openness_increasing: { dimension: 'emotion', direction: 'positive' },
  energy_decreasing: { dimension: 'emotion', direction: 'negative' },

  initiative_declining: { dimension: 'relationship', direction: 'negative' },
  initiative_recovering: { dimension: 'relationship', direction: 'positive' },
  topic_depth_increasing: { dimension: 'relationship', direction: 'positive' },
  private_sharing: { dimension: 'relationship', direction: 'positive' },
  trust_expressed: { dimension: 'relationship', direction: 'positive' },
  boundary_expressed: { dimension: 'relationship', direction: 'neutral' },
  distance_increasing: { dimension: 'relationship', direction: 'negative' },
  relationship_rewarming: { dimension: 'relationship', direction: 'positive' },

  reply_speed_increasing: { dimension: 'interaction', direction: 'positive' },
  reply_speed_decreasing: { dimension: 'interaction', direction: 'negative' },
  reply_length_shortening: { dimension: 'interaction', direction: 'negative' },
  reply_length_increasing: { dimension: 'interaction', direction: 'positive' },
  consecutive_no_reply: { dimension: 'interaction', direction: 'negative' },
  topic_avoidance: { dimension: 'interaction', direction: 'negative' },
  question_tolerance_low: { dimension: 'interaction', direction: 'negative' },
  preferred_time_detected: { dimension: 'interaction', direction: 'neutral' }
});

const TIMELINE_EVENT_TYPES = Object.freeze(new Set([
  ...Object.keys(SIGNAL_TYPES),
  'emotion_shift',
  'relationship_stage_changed',
  'interaction_pattern_changed'
]));

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function iso(value, fallback = new Date().toISOString()) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];
}

function projectionHash(parts = []) {
  return createHash('sha256')
    .update(parts.map(value => clean(value)).join('\u001f'), 'utf8')
    .digest('hex');
}

function projectionIdentity(input = {}, kind = 'projection') {
  const platform = clean(input.platform);
  const sourceAccountId = clean(input.sourceAccountId || input.accountId);
  const conversationId = clean(input.conversationId);
  const platformMessageId = clean(input.platformMessageId || input.messageId || stringArray(input.evidenceMessageIds)[0]);
  const projectionVersion = clean(input.projectionVersion || input.parserVersion || input.engineVersion) || '1.0';
  const projectionType = clean(input.signalType || input.eventType || kind);
  const fallbackSource = platformMessageId || clean(input.startedAt || input.observedAt || input.confirmedAt);
  const digest = projectionHash([
    kind,
    platform,
    sourceAccountId,
    conversationId,
    fallbackSource,
    projectionType,
    projectionVersion
  ]);
  return Object.freeze({
    platform,
    sourceAccountId,
    platformMessageId,
    projectionVersion,
    idempotencyKey: `${kind}:${digest}`,
    deterministicId: `${kind}:${digest.slice(0, 32)}`
  });
}

function createStateSignal(input = {}, options = {}) {
  const signalType = clean(input.signalType);
  const descriptor = SIGNAL_TYPES[signalType];
  if (!descriptor) throw Object.assign(new Error(`Unknown social signal type: ${signalType}`), { code: 'UNKNOWN_SOCIAL_SIGNAL' });
  const contactId = clean(input.contactId);
  const messageId = clean(input.messageId);
  if (!contactId || !messageId) {
    throw Object.assign(new Error('Social signal requires contactId and messageId'), { code: 'INVALID_SOCIAL_SIGNAL' });
  }
  const identity = projectionIdentity({
    ...input,
    messageId,
    platformMessageId: input.platformMessageId || messageId,
    projectionVersion: input.projectionVersion || input.parserVersion
  }, 'social-signal');
  return Object.freeze({
    signalId: clean(input.signalId) || (options.idFactory ? options.idFactory() : identity.deterministicId),
    idempotencyKey: clean(input.idempotencyKey) || identity.idempotencyKey,
    platform: identity.platform,
    sourceAccountId: identity.sourceAccountId,
    platformMessageId: identity.platformMessageId,
    projectionVersion: identity.projectionVersion,
    contactId,
    conversationId: clean(input.conversationId),
    messageId,
    signalType,
    dimension: descriptor.dimension,
    direction: descriptor.direction,
    strength: clamp01(input.strength, 0.5),
    confidence: clamp01(input.confidence, 0.5),
    observedAt: iso(input.observedAt),
    evidence: Object.freeze({
      messageIds: stringArray(input.evidence?.messageIds || [messageId]),
      summary: clean(input.evidence?.summary)
    }),
    source: clean(input.source) || 'social_parser',
    parserVersion: clean(input.parserVersion) || '1.0',
    status: ['candidate', 'confirmed', 'dismissed'].includes(clean(input.status)) ? clean(input.status) : 'candidate'
  });
}

function createRelationshipTimelineEvent(input = {}, options = {}) {
  const eventType = clean(input.eventType);
  if (!TIMELINE_EVENT_TYPES.has(eventType)) {
    throw Object.assign(new Error(`Unknown relationship timeline event: ${eventType}`), { code: 'UNKNOWN_RELATIONSHIP_EVENT' });
  }
  const contactId = clean(input.contactId);
  if (!contactId) throw Object.assign(new Error('Timeline event requires contactId'), { code: 'INVALID_RELATIONSHIP_EVENT' });
  const evidenceMessageIds = stringArray(input.evidenceMessageIds);
  const identity = projectionIdentity({
    ...input,
    platformMessageId: input.platformMessageId || evidenceMessageIds[0],
    projectionVersion: input.projectionVersion || input.engineVersion
  }, 'relationship-event');
  return Object.freeze({
    eventId: clean(input.eventId) || (options.idFactory ? options.idFactory() : identity.deterministicId),
    idempotencyKey: clean(input.idempotencyKey) || identity.idempotencyKey,
    platform: identity.platform,
    sourceAccountId: identity.sourceAccountId,
    platformMessageId: identity.platformMessageId,
    projectionVersion: identity.projectionVersion,
    contactId,
    conversationId: clean(input.conversationId),
    eventType,
    startedAt: iso(input.startedAt),
    confirmedAt: iso(input.confirmedAt || input.startedAt),
    before: Object.freeze({ ...(input.before || {}) }),
    after: Object.freeze({ ...(input.after || {}) }),
    interpretation: clean(input.interpretation),
    evidenceMessageIds,
    sourceSignalIds: stringArray(input.sourceSignalIds),
    confidence: clamp01(input.confidence, 0.5),
    status: ['candidate', 'confirmed', 'dismissed'].includes(clean(input.status)) ? clean(input.status) : 'candidate',
    engineVersion: clean(input.engineVersion) || '1.0'
  });
}

module.exports = {
  SIGNAL_DIMENSIONS,
  SIGNAL_DIRECTIONS,
  SIGNAL_TYPES,
  TIMELINE_EVENT_TYPES,
  createStateSignal,
  createRelationshipTimelineEvent,
  projectionIdentity,
  projectionHash
};
