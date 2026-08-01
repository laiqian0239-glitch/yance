'use strict';

const { POLICY_SCHEMA_VERSION, normalizeSystemPolicy } = require('./systemPolicyCore');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function createSystemPolicySnapshot(policy = {}, context = {}) {
  const normalized = normalizeSystemPolicy(policy);
  return deepFreeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    emergencyStop: normalized.emergencyStop,
    privacyMode: normalized.privacyMode,
    operatingModeAuthority: normalized.operatingModeAuthority,
    createdAt: String(context.createdAt || new Date().toISOString()),
    sourceVersion: Math.max(1, Number(context.sourceVersion || normalized.sourceVersion))
  });
}

module.exports = { createSystemPolicySnapshot };
