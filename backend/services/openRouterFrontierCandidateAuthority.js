'use strict';

const AUTHORITY = 'YanceOpenRouterCatalogFacts';
const SCHEMA_VERSION = 1;
function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function providerOf(model = {}) {
  const explicit = lower(model.catalogMetadata?.topProvider || model.topProvider || model.providerName || model.provider);
  if (explicit) return explicit;
  const id = lower(model.name || model.id);
  return id.includes('/') ? id.split('/')[0] : 'openrouter';
}
function isBatchOnly(model = {}) {
  return /(?:^|[:/._-])batch(?:$|[:/._-])/u.test(lower(model.name || model.id)) || lower(model.catalogMetadata?.apiMode) === 'batch';
}
function interactiveReason(model = {}) {
  if (isBatchOnly(model)) return 'batch-only-model';
  if (model.available === false) return 'catalog-unavailable';
  return '';
}
function describeCatalog(models = []) {
  const rows = (Array.isArray(models) ? models : []).map(model => ({
    id: clean(model.id || model.name),
    name: clean(model.name || model.id),
    provider: providerOf(model),
    available: model.available !== false,
    capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : [],
    contextLength: Number(model.contextLength || model.catalogMetadata?.contextLength || 0),
    reason: interactiveReason(model)
  }));
  return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, models: rows };
}

module.exports = { AUTHORITY, SCHEMA_VERSION, providerOf, isBatchOnly, interactiveReason, describeCatalog };
