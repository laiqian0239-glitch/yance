'use strict';

const ROLES = Object.freeze({
  DESKTOP_HOST: 'desktop-host',
  MODEL_EXECUTION_WORKER: 'model-execution-worker',
  CHANNEL_PROTOCOL_WORKER: 'channel-protocol-worker',
  MEDIA_WORKER: 'media-worker',
  UAT_PROBE: 'uat-probe',
  UTILITY_PROCESS: 'utility-process',
  RENDERER: 'renderer',
  SECONDARY_BACKEND: 'secondary-backend',
  TEST_FIXTURE: 'test-fixture',
  UNASSIGNED: 'unassigned'
});

function hasConfiguredDesktopHostContext() {
  try {
    const { getDesktopStartupContext } = require('../bootstrap/desktopStartupContext');
    const context = getDesktopStartupContext();
    return Number(context?.backendPid || 0) === Number(process.pid);
  } catch (_) {
    return false;
  }
}

function currentProcessRole() {
  const explicit = String(process.env.YANCE_PROCESS_ROLE || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') return ROLES.TEST_FIXTURE;
  if (hasConfiguredDesktopHostContext()) return ROLES.DESKTOP_HOST;
  return ROLES.UNASSIGNED;
}

function storageForbidden() {
  const role = currentProcessRole();
  return ![ROLES.DESKTOP_HOST, ROLES.TEST_FIXTURE].includes(role)
    || String(process.env.YANCE_SQLITE_ACCESS || '').trim().toLowerCase() === 'forbidden';
}

function assertPrimarySqliteHost(operation = 'primary-sqlite-access') {
  const role = currentProcessRole();
  const explicitForbid = String(process.env.YANCE_SQLITE_ACCESS || '').trim().toLowerCase() === 'forbidden';
  const allowed = !explicitForbid && (
    role === ROLES.DESKTOP_HOST
    || (role === ROLES.TEST_FIXTURE && Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test'))
  );
  if (allowed) return true;
  throw Object.assign(new Error(`Process role ${role} cannot access the live primary SQLite database`), {
    code: 'PRIMARY_SQLITE_HOST_ROLE_FORBIDDEN',
    reasonCode: 'PRIMARY_SQLITE_HOST_ROLE_FORBIDDEN',
    status: 403,
    operation: String(operation || 'primary-sqlite-access'),
    processRole: role
  });
}

function assertStorageAccess(operation = 'storage-access') {
  if (!storageForbidden()) return true;
  const role = currentProcessRole();
  throw Object.assign(new Error(`Process role ${role} cannot access application storage`), {
    code: role === ROLES.MODEL_EXECUTION_WORKER
      ? 'MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN'
      : 'PRIMARY_SQLITE_HOST_ROLE_FORBIDDEN',
    reasonCode: role === ROLES.MODEL_EXECUTION_WORKER
      ? 'MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN'
      : 'PRIMARY_SQLITE_HOST_ROLE_FORBIDDEN',
    status: 403,
    operation: String(operation || 'storage-access'),
    processRole: role
  });
}

function assertHostProcess(operation = 'host-authority') {
  const role = currentProcessRole();
  if (role === ROLES.DESKTOP_HOST || role === ROLES.TEST_FIXTURE) return true;
  throw Object.assign(new Error(`Process role ${role} cannot invoke host authority`), {
    code: role === ROLES.MODEL_EXECUTION_WORKER
      ? 'MODEL_WORKER_HOST_AUTHORITY_FORBIDDEN'
      : 'HOST_AUTHORITY_ROLE_FORBIDDEN',
    reasonCode: role === ROLES.MODEL_EXECUTION_WORKER
      ? 'MODEL_WORKER_HOST_AUTHORITY_FORBIDDEN'
      : 'HOST_AUTHORITY_ROLE_FORBIDDEN',
    status: 403,
    operation: String(operation || 'host-authority'),
    processRole: role
  });
}

module.exports = {
  ROLES,
  currentProcessRole,
  assertStorageAccess,
  assertHostProcess,
  assertPrimarySqliteHost
};
