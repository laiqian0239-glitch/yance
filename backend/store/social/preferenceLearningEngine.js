'use strict';

const { RECENT_SOCIAL_MESSAGE_LIMIT, MIN_INTERACTION_PREFERENCE_EVIDENCE } = require('./learningPolicy');
const messageSpeakerAuthority = require('../../services/messageSpeakerAuthority');

const ENGINE_VERSION = '1.1.0';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp01(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function isInbound(row) {
  return messageSpeakerAuthority.isPeerInbound(row);
}

function textLength(row) {
  const text = clean(row?.text);
  if (!text) return 0;
  const words = text.split(/\s+/u).filter(Boolean).length;
  return words > 1 ? words : text.length;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function confidence(evidenceCount, stability = 1) {
  return clamp01(0.35 + Math.min(0.5, evidenceCount * 0.045) * stability, 0.35);
}

function inferInteractionPreferences(messages = [], previous = {}) {
  const inbound = messages.filter(isInbound).filter(row => clean(row.text)).slice(-RECENT_SOCIAL_MESSAGE_LIMIT);
  if (inbound.length < MIN_INTERACTION_PREFERENCE_EVIDENCE) return { ...previous, evidenceCount: inbound.length, engineVersion: ENGINE_VERSION };

  const lengths = inbound.map(textLength).filter(Boolean);
  const avgLength = average(lengths);
  const shortShare = lengths.filter(value => value <= 8).length / lengths.length;
  const longShare = lengths.filter(value => value >= 35).length / lengths.length;
  const emojiMessages = inbound.filter(row => /[\p{Extended_Pictographic}]/u.test(clean(row.text))).length;
  const questionMessages = inbound.filter(row => /[?？]/u.test(clean(row.text))).length;
  const humorMessages = inbound.filter(row => /\b(lol|haha|witzig|lustig|witz|hehe)\b/iu.test(clean(row.text)) || /哈哈|好笑|笑死/u.test(clean(row.text))).length;
  const formalMessages = inbound.filter(row => /\b(Sie|Ihnen|Sehr geehrte|Mit freundlichen Grüßen)\b/u.test(clean(row.text))).length;
  const directMessages = inbound.filter(row => /^(ja|nein|ok|okay|klar|yes|no|sure|好|可以|不行)[.! ]/iu.test(clean(row.text))).length;

  const preferredLength = shortShare >= 0.62 ? 'short' : longShare >= 0.38 ? 'long' : avgLength >= 20 ? 'medium' : 'adaptive';
  const evidence = {
    messageCount: inbound.length,
    averageLength: Number(avgLength.toFixed(2)),
    shortShare: Number(shortShare.toFixed(3)),
    longShare: Number(longShare.toFixed(3)),
    emojiShare: Number((emojiMessages / inbound.length).toFixed(3)),
    questionShare: Number((questionMessages / inbound.length).toFixed(3))
  };

  return {
    ...previous,
    preferredLength,
    humorAffinity: clamp01(humorMessages / Math.max(3, inbound.length * 0.35), previous.humorAffinity ?? 0.35),
    formality: clamp01(formalMessages / Math.max(2, inbound.length * 0.25), previous.formality ?? 0.35),
    directness: clamp01(0.35 + directMessages / inbound.length, previous.directness ?? 0.5),
    emojiTolerance: clamp01(emojiMessages / Math.max(2, inbound.length * 0.4), previous.emojiTolerance ?? 0.2),
    questionTolerance: clamp01(0.3 + questionMessages / Math.max(2, inbound.length * 0.9), previous.questionTolerance ?? 0.5),
    preferredDepth: longShare >= 0.3 ? 'medium' : 'adaptive',
    evidenceCount: inbound.length,
    confidence: confidence(inbound.length, 1 - Math.abs(shortShare - longShare) * 0.25),
    evidence,
    engineVersion: ENGINE_VERSION,
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  ENGINE_VERSION,
  inferInteractionPreferences
};
