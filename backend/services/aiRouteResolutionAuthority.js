'use strict';

const lifecycleAuthority = require('./aiBrainRoleLifecycleAuthority');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const championAuthority = require('./replyChampionAuthority');
const providerDomainAuthority = require('./modelProviderFailureDomainAuthority');

const AUTHORITY = 'AIRouteResolutionAuthority';
const SCHEMA_VERSION = 2;

function clean(value) { return String(value == null ? '' : value).trim(); }
function cleanModelId(value) {
  if (typeof value === 'string') {
    const id = value.trim();
    return (!id || ['[object Object]', 'configured-model', 'undefined', 'null'].includes(id)) ? '' : id;
  }
  if (value && typeof value === 'object') return cleanModelId(value.modelId || value.id || value.value);
  return '';
}
function selectionMode(value, fallback = 'auto') {
  const explicit = clean(value).toLowerCase();
  if (explicit === 'manual' || explicit === 'auto') return explicit;
  return fallback === 'manual' ? 'manual' : 'auto';
}
const providerFailureDomain = providerDomainAuthority.providerFailureDomain;
function normalizeRole(rawRole, legacyMode, legacyModelId) {
  if (rawRole && typeof rawRole === 'object' && !Array.isArray(rawRole)) {
    const mode = selectionMode(rawRole.mode, cleanModelId(rawRole.modelId) ? 'manual' : 'auto');
    return { mode, modelId: mode === 'manual' ? cleanModelId(rawRole.modelId) : '' };
  }
  const modelId = cleanModelId(legacyModelId);
  const mode = selectionMode(legacyMode, modelId ? 'manual' : 'auto');
  return { mode, modelId: mode === 'manual' ? modelId : '' };
}
function resolutionState(primaryModelId, fallbackModelId, requested) {
  if (!primaryModelId) return 'BLOCKED';
  if (fallbackModelId) return 'READY';
  if (requested?.fallback?.mode === 'auto') return 'PRIMARY_ONLY_CONDITIONAL';
  return 'PRIMARY_ONLY';
}
function normalizeRouteV2(route = {}, task = '') {
  const source = typeof route === 'string' ? { primary: route } : (route && typeof route === 'object' ? route : {});
  const nestedRequested = source.requested && typeof source.requested === 'object' ? source.requested : {};
  const nestedResolved = source.resolved && typeof source.resolved === 'object' ? source.resolved : {};
  const requestedEnabled = nestedRequested.enabled !== undefined
    ? nestedRequested.enabled !== false
    : source.requestedEnabled !== undefined
      ? source.requestedEnabled !== false
      : source.enabled !== false;
  const primary = normalizeRole(
    nestedRequested.primary,
    source.primarySelection,
    source.requestedPrimary || source.primary
  );
  const fallback = normalizeRole(
    nestedRequested.fallback,
    source.fallbackSelection,
    source.requestedFallback || source.fallback
  );
  const resolvedPrimaryId = cleanModelId(nestedResolved.primary?.modelId || source.primary);
  const resolvedFallbackId = cleanModelId(nestedResolved.fallback?.modelId || source.fallback);
  const requested = Object.freeze({ enabled: requestedEnabled, primary: Object.freeze(primary), fallback: Object.freeze(fallback) });
  const resolved = Object.freeze({
    primary: Object.freeze({
      modelId: resolvedPrimaryId,
      provider: clean(nestedResolved.primary?.provider),
      reasonCode: clean(nestedResolved.primary?.reasonCode || (resolvedPrimaryId ? (primary.mode === 'manual' ? 'MANUAL_MODEL_SELECTED' : 'AUTO_PRIMARY_SELECTED') : 'PRIMARY_MODEL_UNRESOLVED'))
    }),
    fallback: Object.freeze({
      modelId: resolvedFallbackId,
      provider: clean(nestedResolved.fallback?.provider),
      reasonCode: clean(nestedResolved.fallback?.reasonCode || (resolvedFallbackId ? (fallback.mode === 'manual' ? 'MANUAL_MODEL_SELECTED' : 'AUTO_FALLBACK_PROVIDER_INDEPENDENT') : (fallback.mode === 'auto' ? 'NO_QUALIFIED_INDEPENDENT_FALLBACK' : 'FALLBACK_NOT_REQUESTED')))
    })
  });
  const state = clean(source.resolutionState) || resolutionState(resolvedPrimaryId, resolvedFallbackId, requested);
  const reasonCodes = Array.isArray(source.reasonCodes)
    ? [...new Set(source.reasonCodes.map(clean).filter(Boolean))]
    : [resolved.primary.reasonCode, resolved.fallback.reasonCode].filter(Boolean);
  const legacy = Object.freeze({
    primary: resolvedPrimaryId,
    fallback: resolvedFallbackId,
    requestedPrimary: primary.mode === 'manual' ? primary.modelId : '',
    requestedFallback: fallback.mode === 'manual' ? fallback.modelId : '',
    primarySelection: primary.mode,
    fallbackSelection: fallback.mode,
    requestedEnabled,
    enabled: requestedEnabled,
    operational: requestedEnabled && Boolean(resolvedPrimaryId)
  });
  return Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    task: clean(task),
    requested,
    resolved,
    resolutionState: state,
    reasonCodes: Object.freeze(reasonCodes),
    legacy
  });
}

function formalCandidateRows(models, task, options = {}) {
  return championAuthority.rank(models, task, options).ranking || [];
}
function conditionalCandidateRows(models, task) {
  return (Array.isArray(models) ? models : [])
    .map(model => ({ model, qualification: replyBrainAuthority.taskQualification(model, task) }))
    .filter(row => row.qualification.selectable === true)
    .sort((a, b) => Number(b.qualification.score || 0) - Number(a.qualification.score || 0));
}
function publicResolved(model, reasonCode) {
  return {
    modelId: cleanModelId(model?.id),
    provider: providerFailureDomain(model || {}),
    reasonCode: clean(reasonCode)
  };
}

function resolvePrimary(models, task, requested, options = {}) {
  const byId = new Map((Array.isArray(models) ? models : []).map(model => [cleanModelId(model.id), model]));
  const champion = championAuthority.decide(models, task, options).champion;
  if (requested.primary.mode === 'auto') {
    const model = champion ? byId.get(champion.modelId) : (options.allowConditional === true ? conditionalCandidateRows(models, task)[0]?.model : null);
    return model
      ? { model, resolved: publicResolved(model, champion ? 'AUTO_CHAMPION_SELECTED' : 'AUTO_CONDITIONAL_CHALLENGER_SELECTED') }
      : { model: null, resolved: publicResolved(null, 'NO_QUALIFIED_PRIMARY_MODEL') };
  }
  const model = byId.get(requested.primary.modelId);
  if (!model) return { model: null, resolved: publicResolved(null, 'REQUESTED_PRIMARY_MODEL_NOT_FOUND') };
  const lifecycle = lifecycleAuthority.deriveModelTaskLifecycle(model, task, {
    now: options.now,
    championModelId: champion?.modelId || ''
  });
  if (lifecycleAuthority.isMutableAlias(model)) {
    return { model: null, resolved: publicResolved(null, 'MUTABLE_MODEL_ALIAS_NOT_FORMALLY_QUALIFIABLE') };
  }
  if (champion && champion.modelId !== model.id) {
    return { model: null, resolved: publicResolved(null, 'REQUESTED_PRIMARY_NOT_TASK_CHAMPION') };
  }
  if (lifecycle.routable === true || (options.allowConditional === true && replyBrainAuthority.manualRouteEligible(model, task))) {
    return { model, resolved: publicResolved(model, lifecycle.routable ? 'MANUAL_CHAMPION_SELECTED' : 'MANUAL_CONDITIONAL_CHALLENGER_SELECTED') };
  }
  return { model: null, resolved: publicResolved(null, lifecycle.reasonCode || 'REQUESTED_PRIMARY_NOT_QUALIFIED') };
}

function resolveFallback(models, task, requested, primaryModel, options = {}) {
  if (!primaryModel) return { model: null, resolved: publicResolved(null, 'PRIMARY_REQUIRED_BEFORE_FALLBACK') };
  const byId = new Map((Array.isArray(models) ? models : []).map(model => [cleanModelId(model.id), model]));
  const primaryDomain = providerFailureDomain(primaryModel);
  if (requested.fallback.mode === 'manual') {
    const model = byId.get(requested.fallback.modelId);
    if (!model) return { model: null, resolved: publicResolved(null, 'REQUESTED_FALLBACK_MODEL_NOT_FOUND') };
    if (model.id === primaryModel.id) return { model: null, resolved: publicResolved(null, 'FALLBACK_MUST_DIFFER_FROM_PRIMARY') };
    const lifecycle = lifecycleAuthority.deriveModelTaskLifecycle(model, task, { now: options.now });
    if (lifecycle.routable !== true && !(options.allowConditional === true && replyBrainAuthority.manualRouteEligible(model, task))) {
      return { model: null, resolved: publicResolved(null, lifecycle.reasonCode || 'REQUESTED_FALLBACK_NOT_QUALIFIED') };
    }
    return { model, resolved: publicResolved(model, providerFailureDomain(model) === primaryDomain ? 'MANUAL_FALLBACK_SHARED_PROVIDER_DOMAIN' : 'MANUAL_FALLBACK_PROVIDER_INDEPENDENT') };
  }

  const maximumGap = Math.max(0, Number(options.maxFallbackScoreGap ?? championAuthority.DEFAULT_MAX_FALLBACK_SCORE_GAP));
  const formalRows = formalCandidateRows(models, task, options);
  const primaryRow = formalRows.find(row => row.modelId === primaryModel.id);
  const fallbackRow = formalRows.find(row => row.modelId !== primaryModel.id
    && providerFailureDomain(row.model) !== primaryDomain
    && (!primaryRow || Number(primaryRow.taskScore || 0) - Number(row.taskScore || 0) <= maximumGap));
  if (fallbackRow) return { model: fallbackRow.model, resolved: publicResolved(fallbackRow.model, 'AUTO_FALLBACK_PROVIDER_INDEPENDENT') };

  if (options.allowConditional === true) {
    const conditional = conditionalCandidateRows(models, task).find(row => row.model.id !== primaryModel.id && providerFailureDomain(row.model) !== primaryDomain);
    if (conditional) return { model: conditional.model, resolved: publicResolved(conditional.model, 'AUTO_CONDITIONAL_FALLBACK_PROVIDER_INDEPENDENT') };
  }
  return { model: null, resolved: publicResolved(null, 'NO_QUALIFIED_INDEPENDENT_FALLBACK') };
}

function resolveRoute(models = [], task = '', rawRequested = {}, options = {}) {
  const base = normalizeRouteV2({ requested: rawRequested }, task);
  const requested = base.requested;
  if (requested.enabled === false) {
    return normalizeRouteV2({ requested, resolved: {
      primary: publicResolved(null, 'ROUTE_DISABLED'),
      fallback: publicResolved(null, 'ROUTE_DISABLED')
    }, resolutionState: 'DISABLED', reasonCodes: ['ROUTE_DISABLED'] }, task);
  }
  const primary = resolvePrimary(models, task, requested, options);
  const fallback = resolveFallback(models, task, requested, primary.model, options);
  const state = resolutionState(primary.resolved.modelId, fallback.resolved.modelId, requested);
  const reasonCodes = [...new Set([primary.resolved.reasonCode, fallback.resolved.reasonCode].filter(Boolean))];
  return normalizeRouteV2({ requested, resolved: { primary: primary.resolved, fallback: fallback.resolved }, resolutionState: state, reasonCodes }, task);
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  providerFailureDomain,
  normalizeRouteV2,
  resolveRoute
};
