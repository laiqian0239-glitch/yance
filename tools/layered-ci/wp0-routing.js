'use strict';

const ROUTES = Object.freeze({
  GOVERNANCE: 'GOVERNANCE_WP0',
  PRODUCT_DOCUMENTATION: 'PRODUCT_DOCUMENTATION_WP0',
  PRODUCT: 'PRODUCT_WP0'
});

const PATH_CONTROL_OR_GLOB = /[\u0000-\u001F\u007F*?\[\]]/u;

function outcome(values = {}) {
  return Object.freeze({
    pass: false,
    reasonCode: 'WP0_ROUTE_INVALID',
    route: null,
    changedFiles: [],
    governanceChangesPresent: false,
    productDocumentationChangesPresent: false,
    productChangesPresent: false,
    ...values,
    executionAuthorized: false,
    buildAuthorized: false,
    packageAuthorized: false,
    releaseAuthorized: false,
    publishAuthorized: false,
    productionUseAuthorized: false,
    readyForPromotion: false
  });
}

function fail(reasonCode, details = {}) {
  return outcome({ reasonCode, ...details });
}

function hasOuterWhitespace(value) {
  return value !== value.trim();
}

function hasInvalidPathIdentity(value) {
  return !value
    || hasOuterWhitespace(value)
    || PATH_CONTROL_OR_GLOB.test(value)
    || value.includes('\\')
    || value.startsWith('./')
    || value.startsWith('/')
    || value.endsWith('/')
    || /^[A-Za-z]:\//u.test(value);
}

function hasInvalidSegments(value) {
  return value.split('/').some(segment => !segment || segment === '.' || segment === '..');
}

function normalizePath(value) {
  const raw = String(value || '');
  if (hasInvalidPathIdentity(raw) || hasInvalidSegments(raw)) return '';
  return raw;
}

function validRules(values, { prefixRules = false } = {}) {
  return Array.isArray(values)
    && values.length > 0
    && new Set(values).size === values.length
    && values.every(value => {
      const raw = String(value || '');
      if (!raw
        || hasOuterWhitespace(raw)
        || PATH_CONTROL_OR_GLOB.test(raw)
        || raw.includes('\\')
        || raw.startsWith('./')
        || raw.startsWith('/')
        || /^[A-Za-z]:\//u.test(raw)) return false;
      if (!prefixRules && raw.endsWith('/')) return false;
      const segmentsValue = prefixRules && raw.endsWith('/') ? raw.slice(0, -1) : raw;
      return Boolean(segmentsValue) && !hasInvalidSegments(segmentsValue);
    });
}

function validExtensions(values) {
  return Array.isArray(values)
    && values.length > 0
    && new Set(values).size === values.length
    && values.every(value => /^\.[a-z0-9]+$/u.test(String(value || '')));
}

function validateWp0RoutingPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return fail('WP0_ROUTE_POLICY_INVALID');
  if (policy.schemaVersion !== 2 || policy.documentType !== 'YANCE_WP0_SCOPE_ROUTING_POLICY') {
    return fail('WP0_ROUTE_POLICY_SCHEMA_INVALID');
  }
  for (const field of ['governanceExactPaths', 'productExactPaths']) {
    if (!validRules(policy[field])) return fail('WP0_ROUTE_RULE_INVALID', { field });
  }
  for (const field of [
    'governancePrefixes',
    'productDocumentationPrefixes',
    'productPrefixes'
  ]) {
    if (!validRules(policy[field], { prefixRules: true })) {
      return fail('WP0_ROUTE_RULE_INVALID', { field });
    }
  }
  if (!validExtensions(policy.productDocumentationExtensions)) {
    return fail('WP0_ROUTE_EXTENSION_RULE_INVALID', { field: 'productDocumentationExtensions' });
  }
  if (policy.mixedChangesEscalateToProduct !== true || policy.unknownPathFailsClosed !== true) {
    return fail('WP0_ROUTE_FAIL_CLOSED_INVALID');
  }
  if (policy.readyForPromotion !== false) return fail('WP0_ROUTE_PROMOTION_MUST_REMAIN_FALSE');
  return outcome({ pass: true, reasonCode: null });
}

function matchesExactOrPrefix(file, exact, prefixes) {
  if (exact.includes(file)) return true;
  return prefixes.some(prefix => file.startsWith(prefix));
}

function matchesProductDocumentation(file, policy) {
  return policy.productDocumentationPrefixes.some(prefix => file.startsWith(prefix))
    && policy.productDocumentationExtensions.some(extension => file.endsWith(extension));
}

function classifyWp0Route(policy, changedFiles = []) {
  const validation = validateWp0RoutingPolicy(policy);
  if (!validation.pass) return validation;
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return fail('WP0_ROUTE_CHANGED_FILES_INVALID');
  const normalized = changedFiles.map(normalizePath);
  const invalidIndex = normalized.findIndex(value => !value);
  if (invalidIndex >= 0) return fail('WP0_ROUTE_PATH_INVALID', { path: changedFiles[invalidIndex] });
  const files = [...new Set(normalized)].sort();
  let governance = false;
  let productDocumentation = false;
  let product = false;
  const unknown = [];

  for (const file of files) {
    if (matchesExactOrPrefix(file, policy.governanceExactPaths, policy.governancePrefixes)) {
      governance = true;
      continue;
    }
    if (matchesProductDocumentation(file, policy)) {
      productDocumentation = true;
      continue;
    }
    if (matchesExactOrPrefix(file, policy.productExactPaths, policy.productPrefixes)) {
      product = true;
      continue;
    }
    unknown.push(file);
  }

  if (unknown.length) return fail('WP0_ROUTE_UNKNOWN_PATH', { unknownPaths: unknown });
  const mixedDocumentationAndGovernance = productDocumentation && governance;
  const route = product || mixedDocumentationAndGovernance
    ? ROUTES.PRODUCT
    : productDocumentation
      ? ROUTES.PRODUCT_DOCUMENTATION
      : ROUTES.GOVERNANCE;

  return outcome({
    pass: true,
    reasonCode: null,
    route,
    changedFiles: files,
    governanceChangesPresent: governance,
    productDocumentationChangesPresent: productDocumentation,
    productChangesPresent: product || mixedDocumentationAndGovernance
  });
}

module.exports = {
  ROUTES,
  classifyWp0Route,
  normalizePath,
  validateWp0RoutingPolicy
};
