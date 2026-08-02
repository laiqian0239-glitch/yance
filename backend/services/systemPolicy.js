'use strict';

const repository = require('./systemPolicyRepository');
const { normalizeSystemPolicy, assertWriteAllowedFromPolicy } = require('./systemPolicyCore');
const eventBus = require('./eventBus');
const logger = require('./logger');

function read() {
  const value = repository.read();
  return { ...value, ...normalizeSystemPolicy(value) };
}

async function update(patch = {}, actor = 'desktop-user') {
  if (Object.prototype.hasOwnProperty.call(patch, 'safeMode')) {
    const error = new Error('system-policy.safeMode is not a runtime authority; use OperatingModeTransitionGateway');
    error.code = 'SYSTEM_POLICY_OPERATING_MODE_FORBIDDEN';
    error.status = 409;
    throw error;
  }
  const allowed = ['emergencyStop', 'privacyMode', 'reason'];
  const nextPatch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) nextPatch[key] = patch[key];
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'emergencyStop')) nextPatch.emergencyStop = Boolean(nextPatch.emergencyStop);
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'privacyMode')) nextPatch.privacyMode = Boolean(nextPatch.privacyMode);
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'reason')) nextPatch.reason = String(nextPatch.reason || '').slice(0, 240);
  const value = await repository.update(nextPatch, actor);
  logger.warn('system', 'system-policy-updated', {
    emergencyStop: value.emergencyStop,
    privacyMode: value.privacyMode,
    actor: value.updatedBy
  });
  eventBus.publish('system:policy-updated', value);
  return { ...value, ...normalizeSystemPolicy(value) };
}

function assertWriteAllowed(action = 'write') {
  return assertWriteAllowedFromPolicy(read(), action);
}

module.exports = { read, update, assertWriteAllowed };
