'use strict';

const AUTHORITY = 'OpenRouterFrontierCandidateAuthority';
const SCHEMA_VERSION = 2;
const DEFAULT_PREFERRED_PRIMARY_SLUG = 'anthropic/claude-opus-5';
const DEFAULT_PREFERRED_FALLBACK_SLUG = 'openai/gpt-5.6-sol';
const DEFAULT_SHORTLIST_LIMIT = 28;
const DEFAULT_CHALLENGER_LIMIT = 5;

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function providerOf(value) {
  const slug = lower(value?.id || value?.name || value);
  return slug.includes('/') ? slug.split('/')[0] : '';
}
function isBatchOnly(model = {}) {
  return model.batchOnly === true
    || /(?:^|[:/._-])batch(?:$|[:/._-])/iu.test(clean(model.id || model.name))
    || lower(model.catalogMetadata?.apiMode) === 'batch'
    || lower(model.catalogMetadata?.endpointType) === 'batch';
}
function interactiveReason(model = {}) {
  if (isBatchOnly(model)) return 'BATCH_ONLY_INTERACTIVE_FORBIDDEN';
  if (model.chatTextEligible !== true) return clean(model.excludedReason).toUpperCase().replace(/[^A-Z0-9]+/gu, '_') || 'INTERACTIVE_CHAT_NOT_SUPPORTED';
  return '';
}
function costPerMillion(model = {}) {
  return Math.max(0, finite(model.promptPerMillion, 0)) + Math.max(0, finite(model.completionPerMillion, 0));
}
function frontierScore(model = {}) {
  const text = lower(`${model.id} ${model.name} ${model.description}`);
  let score = 40;
  if (model.reasoning === true) score += 14;
  if (model.structuredOutput === true) score += 9;
  if (model.tools === true) score += 6;
  if (model.contextLength >= 1_000_000) score += 12;
  else if (model.contextLength >= 200_000) score += 8;
  else if (model.contextLength >= 100_000) score += 5;
  const created = finite(model.created, 0);
  if (created > 0) score += Math.min(18, Math.max(0, (created - 1_700_000_000) / 5_000_000));
  if (/\b(?:latest|flagship|opus|sol|ultra|max|pro)\b/u.test(text)) score += 8;
  if (/\b(?:mini|nano|small|lite)\b/u.test(text)) score -= 9;
  if (/:free$/u.test(lower(model.id))) score -= 7;
  const cost = costPerMillion(model);
  if (cost > 0) score -= Math.min(10, cost / 10);
  if (/[-:]fast(?:$|[-:])/u.test(lower(model.id))) score -= 2;
  return Number(score.toFixed(3));
}
function publicIntent(model, requestedSlug = '') {
  const slug = lower(model?.id || model?.name || requestedSlug);
  return {
    slug,
    provider: providerOf(slug),
    available: Boolean(model),
    reasonCode: model ? '' : 'PREFERRED_MODEL_NOT_IN_ACCOUNT_CATALOG'
  };
}
function addUnique(target, seen, model) {
  const slug = lower(model?.id || model?.name);
  if (!slug || seen.has(slug)) return;
  seen.add(slug);
  target.push(model);
}
function buildPlan(models = [], options = {}) {
  const primarySlug = lower(options.preferredPrimarySlug || DEFAULT_PREFERRED_PRIMARY_SLUG);
  const fallbackSlug = lower(options.preferredFallbackSlug || DEFAULT_PREFERRED_FALLBACK_SLUG);
  const limit = Math.max(2, Number(options.limit || DEFAULT_SHORTLIST_LIMIT));
  const challengerLimit = Math.max(2, Math.min(limit, Number(options.challengerLimit || DEFAULT_CHALLENGER_LIMIT)));
  const accepted = [];
  const rejected = [];
  for (const model of Array.isArray(models) ? models : []) {
    const reasonCode = interactiveReason(model);
    const slug = lower(model.id || model.name);
    if (reasonCode) {
      rejected.push({ slug, provider: providerOf(slug), reasonCode });
      continue;
    }
    accepted.push({ ...model, providerSlug: providerOf(slug), frontierScore: frontierScore(model) });
  }
  accepted.sort((left, right) => right.frontierScore - left.frontierScore || finite(right.created) - finite(left.created) || lower(left.id).localeCompare(lower(right.id)));
  const bySlug = new Map(accepted.map(model => [lower(model.id || model.name), model]));
  const preferredPrimaryModel = bySlug.get(primarySlug) || null;
  const preferredFallbackCandidate = bySlug.get(fallbackSlug) || null;
  const preferredFallbackModel = preferredFallbackCandidate && (!preferredPrimaryModel || providerOf(preferredFallbackCandidate) !== providerOf(preferredPrimaryModel))
    ? preferredFallbackCandidate
    : null;
  const shortlist = [];
  const seen = new Set();
  addUnique(shortlist, seen, preferredPrimaryModel);
  addUnique(shortlist, seen, preferredFallbackModel);
  const bestByProvider = new Map();
  for (const model of accepted) if (!bestByProvider.has(model.providerSlug)) bestByProvider.set(model.providerSlug, model);
  for (const model of bestByProvider.values()) addUnique(shortlist, seen, model);
  for (const model of accepted) addUnique(shortlist, seen, model);
  const inventoryShortlist = shortlist.slice(0, limit);
  const challengerShortlist = [];
  const challengerSeen = new Set();
  addUnique(challengerShortlist, challengerSeen, preferredPrimaryModel);
  addUnique(challengerShortlist, challengerSeen, preferredFallbackModel);
  for (const model of bestByProvider.values()) addUnique(challengerShortlist, challengerSeen, model);
  for (const model of accepted) addUnique(challengerShortlist, challengerSeen, model);
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    preferredPrimary: publicIntent(preferredPrimaryModel, primarySlug),
    preferredFallback: preferredFallbackCandidate && !preferredFallbackModel
      ? { ...publicIntent(null, fallbackSlug), reasonCode: 'PREFERRED_FALLBACK_PROVIDER_NOT_INDEPENDENT' }
      : publicIntent(preferredFallbackModel, fallbackSlug),
    shortlist: inventoryShortlist,
    inventoryShortlist,
    challengerShortlist: challengerShortlist.slice(0, challengerLimit),
    rejected,
    providerCoverage: [...new Set(inventoryShortlist.map(model => model.providerSlug).filter(Boolean))],
    challengerProviderCoverage: [...new Set(challengerShortlist.slice(0, challengerLimit).map(model => model.providerSlug).filter(Boolean))],
    catalogInteractiveCount: accepted.length,
    shortlistLimit: limit,
    challengerLimit
  };
}
function prioritizeRows(rows = [], plan = {}, options = {}) {
  const forcePreferred = options.forcePreferred === true;
  if (!forcePreferred) return [...rows];
  const bySlug = new Map((Array.isArray(rows) ? rows : []).map(row => [lower(row.id || row.name), row]));
  const ordered = [];
  const seen = new Set();
  addUnique(ordered, seen, bySlug.get(lower(plan.preferredPrimary?.slug)));
  addUnique(ordered, seen, bySlug.get(lower(plan.preferredFallback?.slug)));
  for (const row of rows) addUnique(ordered, seen, row);
  return ordered;
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  DEFAULT_PREFERRED_PRIMARY_SLUG,
  DEFAULT_PREFERRED_FALLBACK_SLUG,
  DEFAULT_SHORTLIST_LIMIT,
  DEFAULT_CHALLENGER_LIMIT,
  providerOf,
  isBatchOnly,
  interactiveReason,
  frontierScore,
  buildPlan,
  prioritizeRows
};
