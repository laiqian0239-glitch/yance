'use strict';

const {
  WindowsIsolationWatchdogController,
  withWindowsNetworkIsolation
} = require('./windows-network-isolation-watchdog-controller');

const ATTESTATION_DOCUMENT_TYPE = 'WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_ATTESTATION';
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_SESSION_RE = /^[0-9a-f]{16,64}$/;

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function assertIsoTimestamp(value, field) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', `${field} is not a valid timestamp`, { field, value });
  return String(value);
}

class WindowsNetworkIsolationProvider {
  constructor(options = {}) {
    this.controller = options.controller || new WindowsIsolationWatchdogController(options);
    if (!this.controller || typeof this.controller.acquire !== 'function' || typeof this.controller.release !== 'function') {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_PROVIDER_INVALID', 'provider requires a watchdog controller');
    }
  }

  acquire(options = {}) {
    return this.controller.acquire(options);
  }

  release(handle) {
    return this.controller.release(handle);
  }

  withIsolation(operation, options = {}) {
    if (typeof operation !== 'function') fail('WP7_WINDOWS_NETWORK_ISOLATION_PROVIDER_INVALID', 'isolation operation must be a function');
    return withWindowsNetworkIsolation(this, operation, options);
  }

  createControlAttestation(handle, metadata = {}) {
    const state = handle?.isolatedState;
    const receipt = handle?.launchReceipt;
    if (!state || state.state !== 'ISOLATED' || state.isolationPostcondition?.passed !== true) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', 'cannot attest an unverified isolation state', { state });
    }
    const stateBindingMismatches = [];
    for (const [field, expected] of [
      ['requestSha256', handle?.requestSha256],
      ['watchdogScriptSha256', receipt?.watchdogScriptSha256],
      ['launcherScriptSha256', receipt?.launcherScriptSha256],
      ['powerShellExecutableSha256', receipt?.powerShellExecutableSha256],
      ['elevatedWatchdogPid', receipt?.elevatedProcessId]
    ]) {
      if (state?.[field] !== expected) stateBindingMismatches.push({ field, expected, actual: state?.[field] });
    }
    if (!receipt || stateBindingMismatches.length > 0
        || String(state?.powerShellExecutablePath || '') !== String(receipt?.powerShellExecutablePath || '')) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', 'launch receipt and isolated state do not share one hash-bound elevated execution identity', {
        stateBindingMismatches,
        receiptPowerShellPath: receipt?.powerShellExecutablePath,
        statePowerShellPath: state?.powerShellExecutablePath
      });
    }
    const disableOperation = state.disableOperation;
    if (!disableOperation || disableOperation.passed !== true || disableOperation.exitCode !== 0
        || disableOperation.expectedExitCode !== 0
        || disableOperation.executionKind !== 'POWERSHELL_CMDLET_BATCH'
        || disableOperation.resultCodeSource !== 'POWERSHELL_EXCEPTION_MAPPING'
        || disableOperation.postconditionVerified !== true
        || !Array.isArray(disableOperation.operations) || disableOperation.operations.length < 1
        || disableOperation.operations.some((operation) => operation?.passed !== true || operation?.exitCode !== 0
          || operation?.executionKind !== 'POWERSHELL_CMDLET'
          || operation?.resultCodeSource !== 'POWERSHELL_EXCEPTION_MAPPING'
          || operation?.invocationCompleted !== true
          || operation?.commandName !== 'Disable-NetAdapter')) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', 'isolation state has no successful real disable operation', { disableOperation });
    }
    const enabledBefore = Array.isArray(state.adaptersBefore)
      ? state.adaptersBefore.filter((row) => row?.adminStatus === 'Up')
      : [];
    const afterByIndex = new Map((state.adaptersAfterDisable || []).map((row) => [Number(row.interfaceIndex), row]));
    const notDisabled = enabledBefore.filter((row) => afterByIndex.get(Number(row.interfaceIndex))?.adminStatus !== 'Down');
    if (enabledBefore.length < 1 || notDisabled.length > 0 || !Array.isArray(state.routesAfterDisable) || state.routesAfterDisable.length !== 0) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', 'isolation state does not prove all originally enabled visible adapters and default routes were isolated', {
        enabledBeforeCount: enabledBefore.length,
        notDisabledInterfaceIndexes: notDisabled.map((row) => row.interfaceIndex),
        routesAfterDisable: state.routesAfterDisable
      });
    }
    const producerPid = Number(metadata.producerPid);
    const executionNonce = String(metadata.executionNonce || '');
    const buildSessionId = String(metadata.buildSessionId || '');
    const hashes = {
      installerSha256: String(metadata.installerSha256 || ''),
      productExecutableSha256: String(metadata.productExecutableSha256 || ''),
      mainEntrySha256: String(metadata.mainEntrySha256 || ''),
      requestSha256: String(handle.requestSha256 || ''),
      isolatedStateSha256: String(handle.isolatedStateSha256 || ''),
      watchdogScriptSha256: String(receipt.watchdogScriptSha256 || ''),
      launcherScriptSha256: String(receipt.launcherScriptSha256 || ''),
      powerShellExecutableSha256: String(receipt.powerShellExecutableSha256 || ''),
      controlProgramSha256: String(metadata.controlProgramSha256 || '')
    };
    const invalidHashFields = Object.entries(hashes).filter(([, value]) => !SHA256_RE.test(value)).map(([field]) => field);
    if (!Number.isInteger(producerPid) || producerPid <= 0 || producerPid !== Number(state.ownerPid)
        || !Number.isInteger(state.guardianPid) || state.guardianPid <= 0
        || state.guardianPid === state.ownerPid || state.guardianPid === state.elevatedWatchdogPid
        || state.guardianScriptSha256 !== receipt.watchdogScriptSha256
        || !UUID_RE.test(executionNonce) || !BUILD_SESSION_RE.test(buildSessionId)
        || typeof metadata.buildId !== 'string' || !metadata.buildId
        || invalidHashFields.length > 0) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', 'attestation metadata is not bound to the owner and release identity', {
        producerPid,
        ownerPid: state.ownerPid,
        executionNonce,
        buildSessionId,
        buildId: metadata.buildId,
        invalidHashFields
      });
    }
    const document = {
      schemaVersion: 2,
      documentType: ATTESTATION_DOCUMENT_TYPE,
      generatedAtUtc: new Date().toISOString(),
      producerPid,
      ownerPid: Number(state.ownerPid),
      elevatedWatchdogPid: Number(state.elevatedWatchdogPid),
      guardianPid: Number(state.guardianPid),
      guardianScriptSha256: String(state.guardianScriptSha256 || ''),
      executionNonce,
      controlNonce: String(handle.executionNonce || ''),
      buildSessionId,
      buildId: String(metadata.buildId || ''),
      installerSha256: hashes.installerSha256,
      productExecutableSha256: hashes.productExecutableSha256,
      mainEntrySha256: hashes.mainEntrySha256,
      requestSha256: hashes.requestSha256,
      isolatedStateSha256: hashes.isolatedStateSha256,
      watchdogScriptSha256: hashes.watchdogScriptSha256,
      launcherScriptSha256: hashes.launcherScriptSha256,
      powerShellExecutablePath: String(receipt.powerShellExecutablePath || ''),
      powerShellExecutableSha256: hashes.powerShellExecutableSha256,
      controlProgramSha256: hashes.controlProgramSha256,
      protectedSessionRoot: String(handle.protectedSessionRoot || ''),
      staleRecoveryCount: Number(state.staleRecoveryCount || 0),
      disableCommandPassed: true,
      disableCommand: {
        id: 'windows-network-isolation-watchdog-disable',
        startedAtUtc: assertIsoTimestamp(disableOperation.startedAtUtc, 'disableOperation.startedAtUtc'),
        endedAtUtc: assertIsoTimestamp(disableOperation.endedAtUtc, 'disableOperation.endedAtUtc'),
        exitCode: 0,
        expectedExitCode: 0,
        passed: true,
        executionKind: disableOperation.executionKind,
        resultCodeSource: disableOperation.resultCodeSource,
        postconditionVerified: true,
        operationCount: Number(disableOperation.operationCount || 0),
        operations: disableOperation.operations || []
      },
      adaptersBefore: state.adaptersBefore,
      adaptersAfterDisable: state.adaptersAfterDisable,
      routesBefore: state.routesBefore,
      routesAfterDisable: state.routesAfterDisable,
      isolationPostcondition: state.isolationPostcondition
    };
    if (!Number.isInteger(document.producerPid) || document.producerPid <= 0
        || !Number.isInteger(document.ownerPid) || document.ownerPid <= 0
        || !Number.isInteger(document.elevatedWatchdogPid) || document.elevatedWatchdogPid <= 0
        || !Number.isInteger(document.guardianPid) || document.guardianPid <= 0) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_INVALID', 'attestation process custody is incomplete', { document });
    }
    return Object.freeze(document);
  }
}

module.exports = {
  ATTESTATION_DOCUMENT_TYPE,
  WindowsNetworkIsolationProvider
};
