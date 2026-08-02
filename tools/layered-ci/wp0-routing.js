'use strict';

const ROUTES = Object.freeze({
  GOVERNANCE: 'GOVERNANCE_WP0',
  PRODUCT: 'PRODUCT_WP0'
});

function outcome(values = {}) {
  return Object.freeze({ pass: false, reasonCode: 'WP0_ROUTE_INVALID', route: null, readyForPromotion: false, ...values, readyForPromotion: false });
}
function fail(reasonCode, details = {}) { return outcome({ reasonCode, ...details }); }

function normalizePath(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || /[*?[\]]/u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function validRules(values) {
  return Array.isArray(values)
    && values.length > 0
    && new Set(values).size === values.length
    && values.every(value => {
      const raw = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
      if (!raw || /[*?[\]]/u.test(raw) || raw.startsWith('/') || /^[A-Za-z]:\//u.test(raw)) return false;
      const normalized = raw.replace(/\/$/u, '');
      return normalized.split('/').every(segment => segment && segment !== '.' && segment !== '..');
    });
}

function validateWp0RoutingPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return fail('WP0_ROUTE_POLICY_INVALID');
  if (policy.schemaVersion !== 1 || policy.documentType !== 'YANCE_WP0_SCOPE_ROUTING_POLICY') return fail('WP0_ROUTE_POLICY_SCHEMA_INVALID');
  for (const field of ['governanceExactPaths', 'governancePrefixes', 'productExactPaths', 'productPrefixes']) {
    if (!validRules(policy[field])) return fail('WP0_ROUTE_RULE_INVALID', { field });
  }
  if (policy.mixedChangesEscalateToProduct !== true || policy.unknownPathFailsClosed !== true) return fail('WP0_ROUTE_FAIL_CLOSED_INVALID');
  if (policy.readyForPromotion !== false) return fail('WP0_ROUTE_PROMOTION_MUST_REMAIN_FALSE');
  return outcome({ pass: true, reasonCode: null });
}

function matchesExactOrPrefix(file, exact, prefixes) {
  if (exact.includes(file)) return true;
  return prefixes.some(prefix => file.startsWith(prefix));
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
  let product = false;
  const unknown = [];
  for (const file of files) {
    if (matchesExactOrPrefix(file, policy.governanceExactPaths, policy.governancePrefixes)) {
      governance = true;
      continue;
    }
    if (matchesExactOrPrefix(file, policy.productExactPaths, policy.productPrefixes)) {
      product = true;
      continue;
    }
    unknown.push(file);
  }
  if (unknown.length) return fail('WP0_ROUTE_UNKNOWN_PATH', { unknownPaths: unknown });
  const route = product ? ROUTES.PRODUCT : ROUTES.GOVERNANCE;
  return outcome({ pass: true, reasonCode: null, route, changedFiles: files, governanceChangesPresent: governance, productChangesPresent: product });
}

module.exports = { ROUTES, classifyWp0Route, normalizePath, validateWp0RoutingPolicy };
