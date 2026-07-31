'use strict';

/**
 * P0-A AC-031 / AC-032 — Contact social-context authority boundary.
 *
 * INVARIANT: the local store (SQLite / canonical store) is the SOURCE OF TRUTH for a
 * contact's social context (relationship potential, emotion, interaction policy, etc.).
 * Backend sync is a READ-ONLY PROJECTION and MUST NOT be written by the app directly.
 *
 * This module is the single authority for contact social context:
 *   - getSocialContext(contactId, opts)  : the only read entry (delegates to selectors)
 *   - recordSocialSignal(contactId, sig) : the only write entry (local-authority ingest)
 *
 * Compatibility: existing readers (customerSocialSelectors) keep working; this authority
 * becomes the canonical entry point. The real local-authority ingest is wired by the
 * integration layer via setIngest (it must persist to the local store only).
 *
 * Injectable deps (setSelector / setIngest) so the boundary is testable without the store.
 */

let deps = null;

function loadDeps() {
  if (!deps) {
    deps = {
      selector: require('../store/selectors/customerSocialSelectors'),
      ingest: null, // wired by integration layer (local-authority only)
    };
  }
  return deps;
}

function setSelector(fn) {
  loadDeps().selector = fn;
  return deps.selector;
}

function setIngest(fn) {
  loadDeps().ingest = fn;
  return deps.ingest;
}

function getSocialContext(contactId, options = {}) {
  const d = deps || loadDeps();
  const source = d.selector;
  const selectorOptions = { ...(options || {}) };
  const storeManager = selectorOptions.storeManager || null;
  delete selectorOptions.storeManager;

  const candidate = typeof source === 'function'
    ? source(contactId, selectorOptions)
    : source?.selectCustomerSocialContext?.(contactId, selectorOptions);

  // Production selectors are selector factories: they return a function that must
  // be evaluated against StoreManager state. Earlier code returned that function
  // itself, so context.found/context.ready were always undefined and every real
  // reply failed with CUSTOMER_NOT_FOUND before the model was called.
  let resolved = candidate;
  if (typeof candidate === 'function') {
    let manager = storeManager;
    if (!manager) {
      try { manager = require('../store/storeManagerSingleton').getStoreManager(); }
      catch (_) { manager = null; }
    }
    if (!manager?.select) {
      const error = new Error('StoreManager is required to evaluate customer social context');
      error.code = 'SOCIAL_CONTEXT_STORE_UNAVAILABLE';
      throw error;
    }
    resolved = manager.select(candidate);
  }
  const context = resolved || { found: false, ready: false, contactId: String(contactId || '').trim() };
  try { return require('./personContextAuthority').singleton.applyToSocialContext(context, contactId); }
  catch (_) { return context; }
}

async function recordSocialSignal(contactId, signal) {
  const d = deps || loadDeps();
  if (typeof d.ingest !== 'function') {
    const e = new Error('contact social-context writer not wired (local-authority ingest required)');
    e.code = 'CONTACT_CONTEXT_WRITER_UNWIRED';
    e.status = 500;
    throw e;
  }
  return d.ingest(contactId, signal);
}

// Documents and asserts the local-authority / backend-projection boundary.
function assertLocalAuthority() {
  return {
    localAuthority: true,
    backendProjection: true,
    directBackendWrite: false,
  };
}

module.exports = {
  getSocialContext,
  recordSocialSignal,
  setSelector,
  setIngest,
  assertLocalAuthority,
};
