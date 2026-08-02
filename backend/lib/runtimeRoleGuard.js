'use strict';

const ROLES = Object.freeze({
  DESKTOP_HOST: 'desktop-host',
  MODEL_EXECUTION_WORKER: 'model-execution-worker',
  TEST_FIXTURE: 'test-fixture'
});

function currentProcessRole() {
  return String(process.env.YANCE_PROCESS_ROLE || ROLES.DESKTOP_HOST).trim().toLowerCase();
}

function storageForbidden() {
  return currentProcessRole() === ROLES.MODEL_EXECUTION_WORKER ||
    String(process.env.YANCE_SQLITE_ACCESS || '').trim().toLowerCase() === 'forbidden';
}

function assertStorageAccess(operation = 'storage-access') {
  if (!storageForbidden()) return true;
  throw Object.assign(new Error('Model execution workers cannot access application storage'), {
    code: 'MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN',
    status: 403,
    operation: String(operation || 'storage-access')
  });
}

function assertHostProcess(operation = 'host-authority') {
  if (currentProcessRole() !== ROLES.MODEL_EXECUTION_WORKER) return true;
  throw Object.assign(new Error('Model execution worker cannot invoke host authority'), {
    code: 'MODEL_WORKER_HOST_AUTHORITY_FORBIDDEN',
    status: 403,
    operation: String(operation || 'host-authority')
  });
}

module.exports = { ROLES, currentProcessRole, assertStorageAccess, assertHostProcess };
