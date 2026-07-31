#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  WindowsIsolationWatchdogController,
  createWindowsWatchdogLauncher,
  canonical,
  sha256File
} = require('./windows-network-isolation-watchdog-controller');
const {
  ATTESTATION_DOCUMENT_TYPE,
  WindowsNetworkIsolationProvider
} = require('./windows-network-isolation-provider');

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function value(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function requireValue(name) {
  const result = value(name);
  if (!result) fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', `missing required option ${name}`);
  return result;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', `${label} is invalid JSON`, { filePath, message: error.message });
  }
}

function requireExpectedHash(optionName, filePath, label) {
  const expected = requireValue(optionName).toLowerCase();
  if (!SHA256_RE.test(expected)) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', `${label} expected SHA256 is invalid`, { expected });
  }
  const actual = sha256File(filePath);
  if (actual !== expected) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', `${label} SHA256 mismatch`, { filePath, expected, actual });
  }
  return actual;
}

function atomicWrite(filePath, document) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, canonical(document), { mode: 0o600 });
  fs.renameSync(temp, target);
  return target;
}

function defaultProtectedRoot() {
  const programData = String(process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData');
  return path.win32.join(programData, 'Yance', 'WP7NetworkIsolation');
}

function createProvider(controlRoot, protectedRoot = defaultProtectedRoot()) {
  const controller = new WindowsIsolationWatchdogController({
    root: path.join(controlRoot, 'requests'),
    protectedRoot,
    launch: createWindowsWatchdogLauncher()
  });
  return new WindowsNetworkIsolationProvider({ controller });
}

async function disable() {
  const sessionPath = path.resolve(requireValue('--session'));
  const attestationPath = path.resolve(requireValue('--attestation'));
  const controlRoot = path.resolve(value('--control-root', path.join(path.dirname(sessionPath), 'control')));
  const protectedRoot = value('--protected-root', defaultProtectedRoot());
  const provider = createProvider(controlRoot, protectedRoot);
  const handle = await provider.acquire({
    ownerPid: Number(value('--owner-pid', process.ppid)),
    watchdogMs: Number(value('--watchdog-ms', '180000'))
  });
  const attestation = provider.createControlAttestation(handle, {
    producerPid: Number(value('--producer-pid', process.ppid)),
    executionNonce: requireValue('--probe-nonce'),
    buildSessionId: requireValue('--build-session-id'),
    buildId: requireValue('--build-id'),
    installerSha256: requireValue('--installer-sha256'),
    productExecutableSha256: requireValue('--product-executable-sha256'),
    mainEntrySha256: requireValue('--main-entry-sha256'),
    controlProgramSha256: sha256File(__filename)
  });
  atomicWrite(attestationPath, attestation);
  const handleSha256 = crypto.createHash('sha256').update(canonical(handle)).digest('hex');
  atomicWrite(sessionPath, {
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_SERIALIZED_HANDLE',
    generatedAtUtc: new Date().toISOString(),
    protectedRoot,
    controlNonce: handle.executionNonce,
    ownerPid: handle.ownerPid,
    requestSha256: handle.requestSha256,
    isolatedStateSha256: handle.isolatedStateSha256,
    watchdogScriptSha256: handle.launchReceipt.watchdogScriptSha256,
    launcherScriptSha256: handle.launchReceipt.launcherScriptSha256,
    powerShellExecutablePath: handle.launchReceipt.powerShellExecutablePath,
    powerShellExecutableSha256: handle.launchReceipt.powerShellExecutableSha256,
    controlProgramSha256: attestation.controlProgramSha256,
    elevatedWatchdogPid: handle.launchReceipt.elevatedProcessId,
    guardianPid: handle.isolatedState.guardianPid,
    guardianScriptSha256: handle.isolatedState.guardianScriptSha256,
    attestationPath,
    attestationSha256: sha256File(attestationPath),
    handleSha256,
    handle
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_DISABLE_RESULT',
    status: 'PASS',
    sessionPath,
    sessionSha256: sha256File(sessionPath),
    attestationPath,
    attestationSha256: sha256File(attestationPath),
    elevatedWatchdogPid: attestation.elevatedWatchdogPid,
    requestSha256: attestation.requestSha256,
    isolatedStateSha256: attestation.isolatedStateSha256,
    watchdogScriptSha256: attestation.watchdogScriptSha256,
    launcherScriptSha256: attestation.launcherScriptSha256,
    powerShellExecutableSha256: attestation.powerShellExecutableSha256,
    controlProgramSha256: attestation.controlProgramSha256
  }, null, 2)}\n`);
}

async function restore() {
  const sessionPath = path.resolve(requireValue('--session'));
  if (!fs.existsSync(sessionPath) || !fs.statSync(sessionPath).isFile()) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'serialized isolation handle is missing', { sessionPath });
  }
  const sessionSha256 = requireExpectedHash('--session-sha256', sessionPath, 'serialized isolation handle');
  const serialized = readJson(sessionPath, 'serialized isolation handle');
  if (serialized?.schemaVersion !== 2
      || serialized?.documentType !== 'WP7_WINDOWS_NETWORK_ISOLATION_SERIALIZED_HANDLE'
      || !serialized?.handle) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'serialized isolation session schema is invalid', { sessionPath });
  }
  const protectedRoot = defaultProtectedRoot();
  if (path.win32.resolve(String(serialized.protectedRoot || '')) !== path.win32.resolve(protectedRoot)) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'serialized isolation session escaped the audited ProgramData root', {
      expected: protectedRoot,
      actual: serialized.protectedRoot
    });
  }
  const expectedBindings = {
    controlNonce: String(serialized.controlNonce || ''),
    ownerPid: Number(serialized.ownerPid),
    requestSha256: String(serialized.requestSha256 || ''),
    isolatedStateSha256: String(serialized.isolatedStateSha256 || ''),
    watchdogScriptSha256: String(serialized.watchdogScriptSha256 || ''),
    launcherScriptSha256: String(serialized.launcherScriptSha256 || ''),
    powerShellExecutableSha256: String(serialized.powerShellExecutableSha256 || ''),
    elevatedWatchdogPid: Number(serialized.elevatedWatchdogPid),
    guardianPid: Number(serialized.guardianPid),
    guardianScriptSha256: String(serialized.guardianScriptSha256 || ''),
    controlProgramSha256: String(serialized.controlProgramSha256 || '')
  };
  if (!UUID_RE.test(expectedBindings.controlNonce)
      || !SHA256_RE.test(expectedBindings.requestSha256)
      || !SHA256_RE.test(expectedBindings.isolatedStateSha256)
      || !SHA256_RE.test(expectedBindings.watchdogScriptSha256)
      || !SHA256_RE.test(expectedBindings.launcherScriptSha256)
      || !SHA256_RE.test(expectedBindings.controlProgramSha256)
      || !SHA256_RE.test(expectedBindings.powerShellExecutableSha256)
      || !Number.isInteger(expectedBindings.ownerPid) || expectedBindings.ownerPid <= 0
      || !Number.isInteger(expectedBindings.elevatedWatchdogPid) || expectedBindings.elevatedWatchdogPid <= 0
      || !Number.isInteger(expectedBindings.guardianPid) || expectedBindings.guardianPid <= 0
      || expectedBindings.guardianPid === expectedBindings.elevatedWatchdogPid
      || expectedBindings.guardianPid === expectedBindings.ownerPid
      || expectedBindings.guardianScriptSha256 !== expectedBindings.watchdogScriptSha256) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'serialized isolation session binding fields are invalid', { expectedBindings });
  }
  const actualHandleSha256 = crypto.createHash('sha256').update(canonical(serialized.handle)).digest('hex');
  if (!SHA256_RE.test(String(serialized.handleSha256 || '')) || serialized.handleSha256 !== actualHandleSha256) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'serialized watchdog handle SHA256 mismatch', {
      expected: serialized.handleSha256,
      actual: actualHandleSha256
    });
  }

  let attestationPath = null;
  let attestationSha256 = null;
  const attestationArgument = value('--attestation');
  const attestationHashArgument = value('--attestation-sha256');
  if (attestationArgument || attestationHashArgument) {
    if (!attestationArgument || !attestationHashArgument) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'attestation path and SHA256 must be provided together');
    }
    attestationPath = path.resolve(attestationArgument);
    if (!fs.existsSync(attestationPath) || !fs.statSync(attestationPath).isFile()) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'network isolation attestation is missing', { attestationPath });
    }
    attestationSha256 = requireExpectedHash('--attestation-sha256', attestationPath, 'network isolation attestation');
    const attestation = readJson(attestationPath, 'network isolation attestation');
    const bindingMismatches = Object.entries(expectedBindings).filter(([field, expected]) => {
      return attestation?.[field] !== expected;
    });
    const expectedAttestationPath = path.resolve(String(serialized.attestationPath || ''));
    if (attestation?.schemaVersion !== 2
        || attestation?.documentType !== ATTESTATION_DOCUMENT_TYPE
        || expectedAttestationPath !== attestationPath
        || serialized.attestationSha256 !== attestationSha256
        || bindingMismatches.length > 0) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'network isolation attestation does not match the serialized session', {
        expectedAttestationPath,
        attestationPath,
        serializedAttestationSha256: serialized.attestationSha256,
        attestationSha256,
        bindingMismatches
      });
    }
  }

  const sessionRoot = path.win32.join(protectedRoot, expectedBindings.controlNonce);
  const handle = {
    ...serialized.handle,
    executionNonce: expectedBindings.controlNonce,
    ownerPid: expectedBindings.ownerPid,
    requestSha256: expectedBindings.requestSha256,
    statePath: path.win32.join(sessionRoot, 'state.json'),
    isolatedStatePath: path.win32.join(sessionRoot, 'isolated-state.json'),
    releasePath: path.win32.join(sessionRoot, 'release.signal'),
    protectedSessionRoot: sessionRoot,
    expected: {
      executionNonce: expectedBindings.controlNonce,
      requestSha256: expectedBindings.requestSha256,
      watchdogScriptSha256: expectedBindings.watchdogScriptSha256,
      launcherScriptSha256: expectedBindings.launcherScriptSha256,
      powerShellExecutableSha256: expectedBindings.powerShellExecutableSha256,
      ownerPid: expectedBindings.ownerPid,
      elevatedWatchdogPid: expectedBindings.elevatedWatchdogPid
    }
  };
  const controlRoot = path.resolve(value('--control-root', path.join(path.dirname(sessionPath), 'control')));
  const controller = new WindowsIsolationWatchdogController({
    root: path.join(controlRoot, 'requests'),
    protectedRoot,
    launch: async () => { throw new Error('launcher is not available during restore'); }
  });
  const provider = new WindowsNetworkIsolationProvider({ controller });
  const restored = await provider.release(handle);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 2,
    documentType: 'WP7_WINDOWS_NETWORK_ISOLATION_RESTORE_RESULT',
    status: 'PASS',
    sessionPath,
    sessionSha256,
    attestationPath,
    attestationSha256,
    restoredState: restored.state,
    restoredStateSha256: restored.stateSha256,
    reason: restored.reason,
    restorePostcondition: restored.restorePostcondition
  }, null, 2)}\n`);
}

async function main() {
  if (process.platform !== 'win32') fail('WP7_NETWORK_ISOLATION_PLATFORM_UNSUPPORTED', 'Windows network isolation control CLI requires win32', { platform: process.platform });
  const command = String(process.argv[2] || '');
  if (command === 'disable') return disable();
  if (command === 'restore') return restore();
  fail('WP7_WINDOWS_NETWORK_ISOLATION_CLI_INVALID', 'usage: windows-network-isolation-control-cli.js <disable|restore> [options]');
}

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({
      status: 'FAIL',
      reasonCode: error.reasonCode || 'WP7_WINDOWS_NETWORK_ISOLATION_CLI_FAILED',
      message: error.message,
      details: error.details || {}
    }, null, 2)}\n`);
    process.exit(1);
  });
}

module.exports = { atomicWrite, createProvider, defaultProtectedRoot, disable, restore };
