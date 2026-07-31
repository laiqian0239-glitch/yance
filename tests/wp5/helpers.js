'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeOwnership } = require('../../backend/runtime/RuntimeOwnership');
const { RuntimeAuthorityMigrationCoordinator } = require('../../backend/runtime/RuntimeAuthorityMigrationCoordinator');

function tempRoot(prefix = 'yance-wp5-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function removeRoot(root) { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }

async function createAuthorityHarness(options = {}) {
  const parent = options.parent || tempRoot('yance-wp5-parent-');
  const currentRoot = options.currentRoot || path.join(parent, process.platform === 'win32' ? 'Yance' : '.yance');
  const legacyRoot = options.legacyRoot || path.join(parent, process.platform === 'win32' ? 'Yance27' : '.yance27');
  fs.mkdirSync(currentRoot, { recursive: true });
  const ownership = new RuntimeOwnership({
    dataRoot: currentRoot,
    buildId: options.buildId || 'wp5-test',
    initializeRuntimeState: false,
    ownerInstanceId: options.ownerInstanceId
  });
  await ownership.acquire();
  const migration = new RuntimeAuthorityMigrationCoordinator({ store: ownership.store, ownership, currentRoot, legacyRoot });
  if (options.initialize !== false) migration.ensureAuthority();
  return {
    parent, currentRoot, legacyRoot, ownership, store: ownership.store, migration,
    async close({ remove = true } = {}) {
      await ownership.release();
      if (remove) removeRoot(parent);
    }
  };
}

function envelope({ commandId = 'wp5-command-1', expectedStateVersion = 1, operatingMode = 'safeMode', reason = 'test', source = 'test' } = {}) {
  return {
    contractVersion: 2,
    commandId,
    commandType: 'runtime.setOperatingMode',
    expectedStateVersion,
    issuedAtUtc: '2026-07-05T00:00:00.000Z',
    payload: { operatingMode, reason, source }
  };
}

module.exports = { createAuthorityHarness, envelope, tempRoot, removeRoot };
