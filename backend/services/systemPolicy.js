'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const eventBus = require('./eventBus');
const logger = require('./logger');

const store = new SqliteDocumentStore('system-policy', {
  schemaVersion: 1,
  emergencyStop: false,
  privacyMode: true,
  reason: '',
  updatedAt: '',
  updatedBy: 'system'
});

function read() {
  const { safeMode: _legacySafeMode, ...value } = store.read();
  return { ...value, operatingModeAuthority: 'runtime_state.operating_mode' };
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
  const value = await store.update(current => ({
    ...current,
    ...nextPatch,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || 'desktop-user').slice(0, 80)
  }));
  logger.warn('system', 'system-policy-updated', {
    emergencyStop: value.emergencyStop,
    privacyMode: value.privacyMode,
    actor: value.updatedBy
  });
  eventBus.publish('system:policy-updated', value);
  return value;
}

function assertWriteAllowed(action = 'write') {
  const value = read();
  if (!value.emergencyStop) return true;
  const error = new Error(`全局紧急停止已开启，已阻止操作：${action}`);
  error.code = 'GLOBAL_WRITE_BLOCKED';
  error.status = 423;
  throw error;
}

module.exports = { read, update, assertWriteAllowed };
