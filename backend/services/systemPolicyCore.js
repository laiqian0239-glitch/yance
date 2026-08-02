'use strict';

const POLICY_SCHEMA_VERSION = 1;
const OPERATING_MODE_AUTHORITY = 'runtime_state.operating_mode';

function clean(value) { return String(value == null ? '' : value).trim(); }

function normalizeSystemPolicy(value = {}) {
  const schemaVersion = Math.max(1, Number(value.schemaVersion || POLICY_SCHEMA_VERSION));
  return Object.freeze({
    schemaVersion,
    emergencyStop: value.emergencyStop === true || value.emergencyStop === 1,
    privacyMode: value.privacyMode !== false && value.privacyMode !== 0,
    reason: clean(value.reason).slice(0, 240),
    operatingModeAuthority: OPERATING_MODE_AUTHORITY,
    sourceVersion: Math.max(1, Number(value.sourceVersion || schemaVersion))
  });
}

function assertWriteAllowedFromPolicy(policy = {}, action = 'write') {
  if (!normalizeSystemPolicy(policy).emergencyStop) return true;
  throw Object.assign(new Error(`Global emergency stop blocks operation: ${clean(action)}`), {
    code: 'GLOBAL_WRITE_BLOCKED',
    status: 423
  });
}

module.exports = {
  POLICY_SCHEMA_VERSION,
  OPERATING_MODE_AUTHORITY,
  normalizeSystemPolicy,
  assertWriteAllowedFromPolicy
};
