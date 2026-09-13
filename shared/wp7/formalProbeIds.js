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

const PRE_ENTITLEMENT_PROBE_IDS = Object.freeze([
  'first-start',
  'offline-start',
  'crash-recovery',
  'safe-mode-negative',
  'credential-gate-negative',
  'boot-failure'
]);

const ENTITLED_PRODUCT_PROBE_IDS = Object.freeze([
  'controlled-stop',
  'restart',
  'event-gap-recovery'
]);

// Catastrophic harness safety bound only. Formal probe startup/runtime lifecycle
// remains owned by the packaged Product and its mature subsystem owners.
// This value must stay comfortably above the complete bounded Product startup
// chain so validation never becomes a second lifecycle authority.
const FORMAL_PROBE_FAILSAFE_WATCHDOG_MS = 3_600_000;

function assertExactProbeIdSet(candidate, expected, reasonCode, message) {
  const actual = Array.isArray(candidate) ? candidate.map((value) => String(value)) : [];
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    const error = new Error(message);
    error.reasonCode = reasonCode;
    error.details = { expected: [...expected], actual };
    throw error;
  }
  return true;
}

function assertFormalProbeIdSet(candidate, reasonCode = 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT') {
  return assertExactProbeIdSet(
    candidate,
    FORMAL_PROBE_IDS,
    reasonCode,
    'formal trusted-product probe ID set does not match the canonical executable scope'
  );
}

function assertPreEntitlementProbeIdSet(candidate, reasonCode = 'WP7_PRE_ENTITLEMENT_PROBE_ID_SET_INCONSISTENT') {
  return assertExactProbeIdSet(
    candidate,
    PRE_ENTITLEMENT_PROBE_IDS,
    reasonCode,
    'pre-entitlement probe ID set does not match the canonical local-control scope'
  );
}

function assertEntitledProductProbeIdSet(candidate, reasonCode = 'WP7_ENTITLED_PRODUCT_PROBE_ID_SET_INCONSISTENT') {
  return assertExactProbeIdSet(
    candidate,
    ENTITLED_PRODUCT_PROBE_IDS,
    reasonCode,
    'entitled Product probe ID set does not match the canonical Product API scope'
  );
}

function probeAccessClass(probeId) {
  const id = String(probeId || '');
  if (PRE_ENTITLEMENT_PROBE_IDS.includes(id)) return 'PRE_ENTITLEMENT_LOCAL_CONTROL';
  if (ENTITLED_PRODUCT_PROBE_IDS.includes(id)) return 'ENTITLED_PRODUCT_API';
  const error = new Error('probe ID is outside the canonical formal probe scope');
  error.reasonCode = 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT';
  error.details = { probeId: id };
  throw error;
}

module.exports = {
  ENTITLED_PRODUCT_PROBE_IDS,
  FORMAL_PROBE_FAILSAFE_WATCHDOG_MS,
  FORMAL_PROBE_IDS,
  PRE_ENTITLEMENT_PROBE_IDS,
  assertEntitledProductProbeIdSet,
  assertFormalProbeIdSet,
  assertPreEntitlementProbeIdSet,
  probeAccessClass
};
