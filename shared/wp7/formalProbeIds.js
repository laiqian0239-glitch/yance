'use strict';

const FORMAL_PROBE_IDS = Object.freeze([
  'first-start',
  'controlled-stop',
  'restart',
  'offline-start',
  'crash-recovery',
  'safe-mode-negative',
  'credential-gate-negative',
  'event-gap-recovery',
  'boot-failure'
]);

function assertFormalProbeIdSet(candidate, reasonCode = 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT') {
  const actual = Array.isArray(candidate) ? candidate.map((value) => String(value)) : [];
  if (actual.length !== FORMAL_PROBE_IDS.length || actual.some((value, index) => value !== FORMAL_PROBE_IDS[index])) {
    const error = new Error('formal trusted-product probe ID set does not match the canonical executable scope');
    error.reasonCode = reasonCode;
    error.details = { expected: [...FORMAL_PROBE_IDS], actual };
    throw error;
  }
  return true;
}

module.exports = { FORMAL_PROBE_IDS, assertFormalProbeIdSet };
