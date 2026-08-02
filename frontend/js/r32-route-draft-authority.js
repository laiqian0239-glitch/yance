(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceRouteDraftAuthority = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CONDITIONAL_REPLY_TASKS = new Set(['quick_reply', 'deep_reply', 'director']);
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
  const DEFAULT_TIMEOUT_POLICY = Object.freeze({ min: 180000, default: 240000, max: 900000 });

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function selection(value) {
    return clean(value) === 'auto' ? 'auto' : 'manual';
  }

  function timeoutPolicyForTask(task) {
    return TIMEOUT_LIMITS[clean(task)] || DEFAULT_TIMEOUT_POLICY;
  }

  function normalizeTimeoutMs(task, value) {
    const policy = timeoutPolicyForTask(task);
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return policy.default;
    return Math.round(Math.max(policy.min, Math.min(policy.max, number)));
  }

  function serviceById(services, id) {
    return (Array.isArray(services) ? services : []).find(service => clean(service?.id) === clean(id));
  }

  function isConditionalForTask(service, task) {
    const qualification = service?.taskQualifications?.[task];
    return qualification?.selectable === true && qualification?.full !== true;
  }

  function project(route = {}, services = [], options = {}) {
    const task = clean(route.id || route.task);
    const purpose = clean(options.purpose) === 'test' ? 'test' : 'persist';
    const primaryMode = selection(route.main);
    const fallbackMode = selection(route.backup);
    const requestedPrimary = primaryMode === 'manual' ? clean(route.main) : '';
    const requestedFallback = fallbackMode === 'manual' ? clean(route.backup) : '';
    const resolvedPrimary = purpose === 'test'
      ? clean(route.actualMain || requestedPrimary)
      : requestedPrimary;
    const resolvedFallback = purpose === 'test'
      ? clean(route.actualBackup || requestedFallback)
      : requestedFallback;
    const selectedServices = [resolvedPrimary, resolvedFallback]
      .map(id => serviceById(services, id))
      .filter(Boolean);
    const conditional = CONDITIONAL_REPLY_TASKS.has(task) && (
      route.allowConditional === true
      || route.humanReviewRequired === true
      || selectedServices.some(service => isConditionalForTask(service, task))
    );
    const enabled = route.requestedEnabled !== undefined
      ? route.requestedEnabled !== false
      : route.enabled !== false;

    const draft = {
      schemaVersion: 2,
      requested: {
        enabled,
        primary: { mode: primaryMode, modelId: requestedPrimary },
        fallback: { mode: fallbackMode, modelId: requestedFallback }
      },
      primary: resolvedPrimary,
      fallback: resolvedFallback,
      primarySelection: primaryMode,
      fallbackSelection: fallbackMode,
      requestedPrimary,
      requestedFallback,
      maxTokens: Number(route.limit || route.maxTokens || 0),
      timeoutMs: normalizeTimeoutMs(task, route.timeoutMs),
      requestedEnabled: enabled,
      enabled,
      allowExperimental: route.allowExperimental === true
        || selectedServices.some(service => service?.qualification === 'experimental'),
      allowConditional: conditional,
      humanReviewRequired: conditional
    };

    if (purpose === 'test') {
      draft.resolved = {
        primary: {
          modelId: resolvedPrimary,
          provider: clean(route.resolvedPrimaryProvider),
          reasonCode: clean(route.primaryReasonCode || (resolvedPrimary ? 'CURRENT_RESOLVED_PRIMARY' : 'PRIMARY_MODEL_UNRESOLVED'))
        },
        fallback: {
          modelId: resolvedFallback,
          provider: clean(route.resolvedFallbackProvider),
          reasonCode: clean(route.fallbackReasonCode || (resolvedFallback ? 'CURRENT_RESOLVED_FALLBACK' : 'NO_QUALIFIED_INDEPENDENT_FALLBACK'))
        }
      };
      draft.resolutionState = clean(route.resolutionState) || (resolvedPrimary ? (resolvedFallback ? 'READY' : 'PRIMARY_ONLY_CONDITIONAL') : 'BLOCKED');
      draft.reasonCodes = [draft.resolved.primary.reasonCode, draft.resolved.fallback.reasonCode].filter(Boolean);
    }

    return draft;
  }

  return Object.freeze({ TIMEOUT_LIMITS, timeoutPolicyForTask, normalizeTimeoutMs, project });
});
