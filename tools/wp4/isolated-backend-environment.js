'use strict';

const ISOLATED_BACKEND_AUTHORITY_KEYS = Object.freeze([
  'WORKBUDDY_DATA_DIR',
  'YANCE_LEGACY_DATA_DIR',
  'YANCE_PRIMARY_SQLITE_PATH',
  'YANCE_SETTINGS_SQLITE_PATH',
  'YANCE_RUNTIME_MUTEX_NAME'
]);

function isolatedBackendEnvironment(overrides = {}, source = process.env) {
  const environment = { ...(source || {}) };
  for (const key of ISOLATED_BACKEND_AUTHORITY_KEYS) delete environment[key];
  return { ...environment, ...overrides };
}

module.exports = { ISOLATED_BACKEND_AUTHORITY_KEYS, isolatedBackendEnvironment };
