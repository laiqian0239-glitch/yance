'use strict';

function applyCredentialSnapshot(entries, options = {}) {
  const bridge = options.secureBridge || require('../services/secureBridge');
  const rows = Array.isArray(entries) ? entries : [];
  const result = bridge.replaceRuntimeSnapshot(rows);
  if (Number(result.entryCount) !== rows.length) {
    const error = new Error('Credential runtime reference count does not match FD5 frame');
    error.reasonCode = 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH';
    throw error;
  }
  return Object.freeze({ entryCount: result.entryCount, refs: result.refs });
}

module.exports = { applyCredentialSnapshot };
