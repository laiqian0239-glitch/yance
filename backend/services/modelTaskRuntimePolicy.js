'use strict';

const LIMITS = Object.freeze({
  translation: Object.freeze({ min: 128, default: 1800, max: 2400 }),
  understanding: Object.freeze({ min: 160, default: 520, max: 800 }),
  relationship: Object.freeze({ min: 160, default: 620, max: 900 }),
  director: Object.freeze({ min: 120, default: 360, max: 520 }),
  quick_reply: Object.freeze({ min: 80, default: 220, max: 320 }),
  deep_reply: Object.freeze({ min: 160, default: 480, max: 650 }),
  quality_review: Object.freeze({ min: 120, default: 420, max: 620 }),
  summary: Object.freeze({ min: 160, default: 520, max: 800 }),
  fact_extraction: Object.freeze({ min: 160, default: 460, max: 700 }),
  memory_extraction: Object.freeze({ min: 160, default: 520, max: 800 }),
  media_analysis: Object.freeze({ min: 180, default: 720, max: 1200 }),
  material_analysis: Object.freeze({ min: 160, default: 620, max: 900 }),
  persona_rewrite: Object.freeze({ min: 120, default: 420, max: 700 }),
  speech_transcription: Object.freeze({ min: 128, default: 1800, max: 2400 })
});

const TIMEOUT_LIMITS = Object.freeze({
  translation: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  understanding: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  relationship: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  director: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  quick_reply: Object.freeze({ min: 180000, default: 180000, max: 900000 }),
  deep_reply: Object.freeze({ min: 240000, default: 300000, max: 1200000 }),
  quality_review: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  summary: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  fact_extraction: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  memory_extraction: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  media_analysis: Object.freeze({ min: 240000, default: 300000, max: 1200000 }),
  material_analysis: Object.freeze({ min: 240000, default: 300000, max: 1200000 }),
  persona_rewrite: Object.freeze({ min: 180000, default: 240000, max: 900000 }),
  speech_transcription: Object.freeze({ min: 240000, default: 300000, max: 1200000 })
});

const DEFAULT_TOKEN_POLICY = Object.freeze({ min: 128, default: 600, max: 1000 });
const DEFAULT_TIMEOUT_POLICY = Object.freeze({ min: 180000, default: 240000, max: 900000 });

function normalizedTask(task = '') {
  return String(task || '').trim();
}

function policyForTask(task = '') {
  return LIMITS[normalizedTask(task)] || DEFAULT_TOKEN_POLICY;
}

function timeoutPolicyForTask(task = '') {
  return TIMEOUT_LIMITS[normalizedTask(task)] || DEFAULT_TIMEOUT_POLICY;
}

function normalizeMaxTokens(task, value) {
  const policy = policyForTask(task);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return policy.default;
  return Math.round(Math.max(policy.min, Math.min(policy.max, number)));
}

function normalizeTimeoutMs(task, value) {
  const policy = timeoutPolicyForTask(task);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return policy.default;
  return Math.round(Math.max(policy.min, Math.min(policy.max, number)));
}

module.exports = {
  LIMITS,
  TIMEOUT_LIMITS,
  policyForTask,
  timeoutPolicyForTask,
  normalizeMaxTokens,
  normalizeTimeoutMs
};
