'use strict';

const { parameterBillions } = require('./replyBrainModelAuthority');

const SCENARIO_TOKEN_LIMITS = Object.freeze({
  german_whatsapp: 160,
  english_whatsapp: 160,
  persona_boundary: 180,
  director_schema: 220,
  german_alternative: 180
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function observedLatencyMs(model = {}) {
  return Math.max(
    finite(model.lastLatencyMs),
    finite(model.lastSuccessfulInvocation?.latencyMs),
    finite(model.lastSuccessfulInvocation?.totalMs),
    finite(model.lastTest?.summary?.averageLatencyMs),
    finite(model.lastQualificationTest?.summary?.averageLatencyMs)
  );
}

function sizeClassFor(model = {}) {
  const billions = parameterBillions(model);
  if (billions > 0 && billions <= 6.5) return 'small';
  if (billions > 0 && billions <= 11) return 'medium';
  if (billions > 0 && billions <= 18) return 'large';
  if (billions > 18) return 'xlarge';
  return 'unknown';
}

function defaultsForClass(sizeClass) {
  if (sizeClass === 'small') return { warmupTimeoutMs: 180000, scenarioTimeoutMs: 180000, baseQualificationTimeoutMs: 180000, latencyThresholdMs: 140000, estimatedBatchMinutes: 9 };
  if (sizeClass === 'medium') return { warmupTimeoutMs: 210000, scenarioTimeoutMs: 210000, baseQualificationTimeoutMs: 210000, latencyThresholdMs: 170000, estimatedBatchMinutes: 12 };
  if (sizeClass === 'large') return { warmupTimeoutMs: 240000, scenarioTimeoutMs: 240000, baseQualificationTimeoutMs: 270000, latencyThresholdMs: 200000, estimatedBatchMinutes: 17 };
  if (sizeClass === 'xlarge') return { warmupTimeoutMs: 300000, scenarioTimeoutMs: 300000, baseQualificationTimeoutMs: 360000, latencyThresholdMs: 260000, estimatedBatchMinutes: 24 };
  return { warmupTimeoutMs: 210000, scenarioTimeoutMs: 210000, baseQualificationTimeoutMs: 240000, latencyThresholdMs: 170000, estimatedBatchMinutes: 14 };
}

function profileForModel(model = {}, options = {}) {
  const parameterSizeBillions = parameterBillions(model);
  const sizeClass = sizeClassFor(model);
  const defaults = defaultsForClass(sizeClass);
  const observed = observedLatencyMs(model);
  const observedBudget = observed > 0 ? Math.ceil(observed * 2.4) : 0;
  const explicit = finite(options.timeoutMs);
  const scenarioTimeoutMs = clamp(explicit > 0 ? explicit : Math.max(defaults.scenarioTimeoutMs, observedBudget), 180000, 600000);
  const warmupTimeoutMs = clamp(finite(options.warmupTimeoutMs) || Math.max(defaults.warmupTimeoutMs, observedBudget), 180000, 600000);
  const baseQualificationTimeoutMs = clamp(finite(options.baseQualificationTimeoutMs) || Math.max(defaults.baseQualificationTimeoutMs, observedBudget), 180000, 600000);
  const latencyThresholdMs = clamp(finite(options.latencyThresholdMs) || Math.max(defaults.latencyThresholdMs, observed ? Math.ceil(observed * 1.7) : 0), 60000, 480000);
  return {
    schemaVersion: 1,
    authority: 'ReplyBrainBenchmarkRuntimePolicy',
    modelId: String(model.id || ''),
    model: String(model.name || model.id || ''),
    provider: String(model.provider || ''),
    parameterSizeBillions,
    sizeClass,
    observedLatencyMs: observed,
    warmupTimeoutMs,
    scenarioTimeoutMs,
    baseQualificationTimeoutMs,
    latencyThresholdMs,
    keepAlive: String(options.keepAlive || '45m'),
    estimatedBatchMinutes: defaults.estimatedBatchMinutes,
    serialRequired: true,
    warmupRequired: model.provider === 'ollama'
  };
}

function scenarioOptions(profile = {}, scenario = {}) {
  const id = String(scenario.id || '');
  return {
    maxTokens: SCENARIO_TOKEN_LIMITS[id] || 180,
    timeoutMs: clamp(profile.scenarioTimeoutMs || 180000, 180000, 600000),
    keepAlive: String(profile.keepAlive || '45m')
  };
}

function qualificationTimeoutMs(model = {}, testName = '', options = {}) {
  const profile = options.runtimeProfile || profileForModel(model, options);
  const base = Number(profile.baseQualificationTimeoutMs || 180000);
  const floor = 180000;
  return clamp(Number(options.timeoutMs || 0) || base, floor, 600000);
}

module.exports = {
  SCENARIO_TOKEN_LIMITS,
  observedLatencyMs,
  sizeClassFor,
  profileForModel,
  scenarioOptions,
  qualificationTimeoutMs
};
