#!/usr/bin/env node
'use strict';

const { configureBackendFromDesktopFrame, readStartupFrame } = require('./bootstrap/desktopStartupPipe');
const { buildBootFailureLifecycleMessage, sendParentLifecycleMessage } = require('./bootstrap/parentLifecycleChannel');
const path = require('node:path');
const os = require('node:os');

function assertNodeSqliteAvailable() {
  try {
    require('node:sqlite');
    return true;
  } catch (error) {
    const wrapped = new Error(`node:sqlite is unavailable in the backend Node runtime: ${error.message}`);
    wrapped.reasonCode = 'NODE_SQLITE_UNAVAILABLE';
    wrapped.code = 'NODE_SQLITE_UNAVAILABLE';
    throw wrapped;
  }
}

function phaseFailure(error, reasonCode) {
  const candidate = String(error?.reasonCode || error?.code || '');
  const approvedSpecificReason = candidate === 'NODE_SQLITE_UNAVAILABLE' ||
    candidate === 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH' ||
    candidate === 'CREDENTIAL_GENERATION_MISMATCH' ||
    candidate.startsWith('BOOT_');
  if (approvedSpecificReason) return error;
  const wrapped = new Error(error?.message || String(error || reasonCode));
  wrapped.reasonCode = reasonCode;
  wrapped.code = reasonCode;
  wrapped.failedPhase = String(error?.failedPhase || (reasonCode === 'BOOT_SERVER_IMPORT_FAILED' ? 'server_startup' : 'runtime_boot'));
  wrapped.cause = error;
  return wrapped;
}

async function bootDesktopHostedBackend(options = {}) {
  assertNodeSqliteAvailable();
  const frame = await readStartupFrame(options);
  const context = configureBackendFromDesktopFrame(frame);
  // Nothing that can acquire the production SQLite database is loaded before
  // Boot Phase 0 has completed. This preserves Windows restore semantics even
  // when a required module gains a future top-level repository import.
  let startupRestore;
  try {
    const { runBootPhase0Restore } = require('./bootstrap/bootPhase0Restore');
    startupRestore = runBootPhase0Restore();
  } catch (error) {
    throw phaseFailure(error, 'BOOT_PHASE_0_RESTORE_FAILED');
  }

  const defaultRoot = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Yance')
    : path.join(os.homedir(), '.yance');
  const dataRoot = path.resolve(context.dataDir || process.env.YANCE_DATA_DIR || process.env.WORKBUDDY_DATA_DIR || defaultRoot);
  const primarySqlitePath = path.join(dataRoot, 'store', 'yance-r32.db');
  process.env.YANCE_PRIMARY_SQLITE_PATH = primarySqlitePath;

  let sqliteBroker;
  try {
    const { createSqliteConnectionBroker } = require('./lib/sqliteConnectionBroker');
    sqliteBroker = createSqliteConnectionBroker({ dbPath: primarySqlitePath });
  } catch (error) {
    throw phaseFailure(error, 'BOOT_SQLITE_BROKER_FAILED');
  }
  globalThis.__YANCE_STARTUP_RESTORE__ = startupRestore;
  globalThis.__YANCE_SQLITE_BROKER__ = sqliteBroker;
  const { initializeAppRuntime } = require('./runtime');
  const { OwnerRecovery } = require('./services/ownerRecovery');
  const secureBridge = require('./services/secureBridge');
  // M4: the backend must survive an owner (DesktopHost) restart instead of
  // suiciding on an indeterminate commit. A lost custody channel now triggers a
  // recoverable lifecycle that waits for the relaunched owner to re-attach.
  const ownerRecovery = options.ownerRecovery || new OwnerRecovery({
    recoveryWindowMs: Number(options.ownerRecoveryWindowMs || 30000),
    onRecoveryExpired: options.onRecoveryExpired || ((reasonCode) => {
      try { process.kill(process.pid, 'SIGTERM'); } catch (_) { process.exitCode = 1; }
    })
  });
  const onOwnerLost = (reasonCode) => { try { ownerRecovery.markOwnerExited(reasonCode || 'CREDENTIAL_VAULT_UNAVAILABLE'); } catch (_) {} };
  secureBridge.configureCustody(context, {
    ...(options.credentialCustody || {}),
    onChannelLost: onOwnerLost,
    onIndeterminateCommit: (info) => onOwnerLost(info?.reasonCode || 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE')
  });
  secureBridge.setOwnerRecovery(ownerRecovery);
  const productionServerEntry = require.resolve('./server');
  const serverEntry = options.serverEntry || productionServerEntry;
  let runtimeCoordinator = null;
  if (options.initializeRuntime === true || (options.initializeRuntime !== false && serverEntry === productionServerEntry)) {
    try {
      runtimeCoordinator = await initializeAppRuntime({
        context,
        requireCredentialHydration: true,
        sqliteBroker,
        onCredentialHydrated(metadata) {
          try { sendParentLifecycleMessage({ type: 'backend:credential-hydrated', pid: process.pid, startupNonce: context.startupNonce, ...metadata }); } catch (_) {}
        }
      });
    } catch (error) {
      try { sqliteBroker.checkpointAndClose(); } catch (_) {}
      throw phaseFailure(error, 'BOOT_RUNTIME_INITIALIZATION_FAILED');
    }
  }
  try {
    require(serverEntry);
  } catch (error) {
    await runtimeCoordinator?.stop('server-import-failed').catch(() => {});
    try { sqliteBroker.checkpointAndClose(); } catch (_) {}
    throw phaseFailure(error, 'BOOT_SERVER_IMPORT_FAILED');
  }
  return context;
}

if (require.main === module) {
  bootDesktopHostedBackend().catch(error => {
    const payload = buildBootFailureLifecycleMessage(error, { pid: process.pid });
    try { sendParentLifecycleMessage(payload); } catch (_) {}
    try { process.stderr.write(`YANCE_DESKTOP_HOSTED_BOOT_FAILED ${JSON.stringify(payload)}\n`); } catch (_) {}
    process.exitCode = 1;
  });
}

module.exports = { bootDesktopHostedBackend };
