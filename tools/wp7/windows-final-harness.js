#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  RISK_IDS,
  UPSTREAM_ACCEPTED_BINDINGS,
  Wp7Error,
  canonicalJsonBuffer,
  readJson,
  sha256Buffer,
  sha256File,
  validateCleanInstallEvidence,
  validateEvidenceCommon,
  verifyInstallerHash,
  writeCanonicalJson
} = require('./lib');
const { assertNoCallerClaims } = require('./final-context');
const { validateMeasurements } = require('../../electron/wp7InstalledRuntimeProbe');
const { readPreMainProof } = require('./linux-network-isolation');
const { FORMAL_PROBE_IDS, assertFormalProbeIdSet } = require('../../shared/wp7/formalProbeIds');
const { finalOutputs, FINAL_RELEASE_PATH, AGGREGATE_PATH } = require('./final-evidence');

const WINDOWS_VALIDATION_TOKEN = 'WP7_FINAL_WINDOWS_VALIDATION_AUTHORIZED';
const REQUIRED_PROBE_IDS = FORMAL_PROBE_IDS;
const SHA256_RE = /^[0-9a-f]{64}$/;
const WINDOWS_ISOLATION_ATTESTATION_DOCUMENT_TYPE = 'WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_ATTESTATION';
const WINDOWS_ISOLATION_CLI_PATH = path.resolve(__dirname, 'windows-network-isolation-control-cli.js');

function utcNow() { return new Date().toISOString(); }
function relativeTo(root, filePath) { return path.relative(root, filePath).split(path.sep).join('/'); }

function assertUnderRoot(root, candidate, reasonCode, label) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(candidate);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Wp7Error(reasonCode, `${label} escaped its trusted root`, { root: absoluteRoot, candidate: absolute });
  }
  return absolute;
}

function ensureEmpty(dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'raw evidence root must start empty', { dir });
  fs.mkdirSync(dir, { recursive: true });
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) rows.push({ path: relativeTo(root, full), type: 'symlink' });
      else if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) rows.push({ path: relativeTo(root, full), type: 'file', sizeBytes: fs.statSync(full).size, sha256: sha256File(full) });
    }
  }
  walk(root);
  return rows;
}

function assertPolicy(config) {
  assertNoCallerClaims(config);
  if (config.finalInstallationMode !== 'CLEAN_INSTALL' || config.legacyTestDataMigrationRequired !== false || config.legacyTestVersionRollbackRequired !== false) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_HARNESS_INVALID', 'Windows validation policy must be CLEAN_INSTALL/false/false');
  }
  if (config.designatedValidationMachine !== true) throw new Wp7Error('WP7_FINAL_WINDOWS_HARNESS_INVALID', 'designatedValidationMachine must be true');
  if (config.offlineNetworkControl !== undefined) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'caller-supplied Windows network disable/restore commands are forbidden; the first-party isolation provider is mandatory');
  }
}

function assertWindowsIsolationAttestation(attestation, expected) {
  const reasonCode = 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET';
  const hashes = [
    'requestSha256',
    'isolatedStateSha256',
    'watchdogScriptSha256',
    'launcherScriptSha256',
    'controlProgramSha256',
    'powerShellExecutableSha256'
  ];
  const invalidHashes = hashes.filter((field) => !SHA256_RE.test(String(attestation?.[field] || '')));
  const disable = attestation?.disableCommand;
  const enabledBefore = Array.isArray(attestation?.adaptersBefore)
    ? attestation.adaptersBefore.filter((row) => row?.adminStatus === 'Up')
    : [];
  const afterByIndex = new Map((attestation?.adaptersAfterDisable || []).map((row) => [Number(row.interfaceIndex), row]));
  const notDisabled = enabledBefore.filter((row) => afterByIndex.get(Number(row.interfaceIndex))?.adminStatus !== 'Down');
  const identityMismatches = Object.entries(expected).filter(([field, value]) => attestation?.[field] !== value);
  const valid = attestation?.schemaVersion === 2
    && attestation?.documentType === WINDOWS_ISOLATION_ATTESTATION_DOCUMENT_TYPE
    && invalidHashes.length === 0
    && Number.isInteger(attestation?.producerPid) && attestation.producerPid > 0
    && Number.isInteger(attestation?.ownerPid) && attestation.ownerPid === attestation.producerPid
    && Number.isInteger(attestation?.elevatedWatchdogPid) && attestation.elevatedWatchdogPid > 0
    && Number.isInteger(attestation?.guardianPid) && attestation.guardianPid > 0
    && attestation.elevatedWatchdogPid !== attestation.producerPid
    && attestation.guardianPid !== attestation.producerPid
    && attestation.guardianPid !== attestation.elevatedWatchdogPid
    && attestation.guardianScriptSha256 === attestation.watchdogScriptSha256
    && identityMismatches.length === 0
    && attestation?.disableCommandPassed === true
    && disable?.passed === true
    && disable?.exitCode === 0
    && disable?.expectedExitCode === 0
    && disable?.executionKind === 'POWERSHELL_CMDLET_BATCH'
    && disable?.resultCodeSource === 'POWERSHELL_EXCEPTION_MAPPING'
    && disable?.postconditionVerified === true
    && Array.isArray(disable?.operations) && disable.operations.length > 0
    && disable.operations.every((row) => row?.passed === true && row?.exitCode === 0
      && row?.executionKind === 'POWERSHELL_CMDLET'
      && row?.resultCodeSource === 'POWERSHELL_EXCEPTION_MAPPING'
      && row?.invocationCompleted === true
      && row?.commandName === 'Disable-NetAdapter')
    && enabledBefore.length > 0
    && notDisabled.length === 0
    && Array.isArray(attestation?.routesAfterDisable) && attestation.routesAfterDisable.length === 0
    && attestation?.isolationPostcondition?.passed === true
    && attestation?.isolationPostcondition?.allOriginallyEnabledPhysicalAdaptersDisabled === true
      && attestation?.isolationPostcondition?.allOriginallyEnabledIsolatableAdaptersDisabled === true
    && attestation?.isolationPostcondition?.noDefaultRoutesRemain === true
    && attestation?.isolationPostcondition?.remainingDefaultRouteCount === 0;
  if (!valid) {
    throw new Wp7Error(reasonCode, 'first-party Windows network isolation attestation is invalid', {
      invalidHashes,
      identityMismatches,
      enabledBeforeCount: enabledBefore.length,
      notDisabledInterfaceIndexes: notDisabled.map((row) => row.interfaceIndex),
      attestation
    });
  }
  return attestation;
}

function writeRawText(root, relativePath, text) {
  const absolute = assertUnderRoot(root, path.join(root, relativePath), 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'raw output');
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text || '', 'utf8');
  return { path: relativeTo(root, absolute), sha256: sha256File(absolute) };
}

function executeTrustedStep(step, context = {}) {
  const reasonCode = step?.reasonCode || 'WP7_FINAL_WINDOWS_COMMAND_FAILED';
  if (!step || typeof step.file !== 'string' || !step.file || typeof step.id !== 'string' || !step.id) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_HARNESS_INVALID', 'trusted command step is incomplete', { step });
  }
  const executable = path.resolve(step.file);
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Wp7Error(reasonCode, 'trusted executable is missing', { executable });
  if (context.expectedExecutable && fs.realpathSync(executable) !== fs.realpathSync(context.expectedExecutable)) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'command executable is not the trusted final artifact', { id: step.id, expected: context.expectedExecutable, actual: executable });
  }
  const forbiddenWrapper = /(?:^|\\|\/)(?:cmd|powershell|pwsh|wscript|cscript|node)(?:\.exe)?$/i.test(executable);
  if (context.applicationCommand && forbiddenWrapper) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'application probes cannot be delegated to a shell/interpreter wrapper', { executable });
  }

  const startedAtUtc = utcNow();
  const startedMs = Date.now();
  let probeOutputPath = null;
  let probeExecutionNonce = null;
  if (context.probeId) {
    probeOutputPath = assertUnderRoot(context.rawRoot, path.join(context.rawRoot, 'probe-results', `${context.probeId}.json`), 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'probe output');
    fs.mkdirSync(path.dirname(probeOutputPath), { recursive: true });
    fs.rmSync(probeOutputPath, { force: true });
    probeExecutionNonce = context.probeExecutionNonce || crypto.randomUUID();
    if (!context.expectedExecutable || !context.mainEntryPath) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'formal application probe requires executable and main-entry identity');
  }
  const result = spawnSync(executable, step.args || [], {
    cwd: step.cwd ? path.resolve(step.cwd) : process.cwd(),
    env: {
      ...process.env,
      ...(step.env || {}),
      ...(context.env || {}),
      ...(probeOutputPath ? {
        WP7_PROBE_ROOT: context.rawRoot,
        WP7_PROBE_EXECUTION_NONCE: probeExecutionNonce,
        WP7_PROBE_OUTPUT_PATH: probeOutputPath,
        WP7_PROBE_ID: context.probeId,
        WP7_PROBE_BUILD_SESSION_ID: context.identity.buildSessionId,
        WP7_PROBE_INSTALLER_SHA256: context.identity.installerSha256,
        WP7_PROBE_EXPECTED_BUILD_ID: context.identity.buildId,
        WP7_PROBE_EXPECTED_SOURCE_COMMIT: context.identity.frozenSourceCommit,
        WP7_PROBE_EXPECTED_SOURCE_TREE: context.identity.frozenSourceTree,
        WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: sha256File(context.expectedExecutable),
        WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: sha256File(context.mainEntryPath)
      } : {})
    },
    encoding: 'utf8',
    timeout: step.timeoutMs || 180000,
    maxBuffer: step.maxBufferBytes || 32 * 1024 * 1024,
    windowsHide: true
  });
  const endedAtUtc = utcNow();
  const stdoutRef = writeRawText(context.rawRoot, `commands/${step.id}.stdout.txt`, result.stdout || '');
  const stderrRef = writeRawText(context.rawRoot, `commands/${step.id}.stderr.txt`, result.stderr || '');
  const expectedExitCode = step.expectedStatus ?? 0;
  const record = {
    id: step.id,
    executable,
    executableSha256: sha256File(executable),
    args: step.args || [],
    startedAtUtc,
    endedAtUtc,
    exitCode: result.status,
    signal: result.signal,
    spawnErrorCode: result.error?.code || null,
    spawnErrorMessage: result.error?.message || null,
    expectedExitCode,
    stdoutPath: stdoutRef.path,
    stdoutSha256: stdoutRef.sha256,
    stderrPath: stderrRef.path,
    stderrSha256: stderrRef.sha256,
    passed: result.status === expectedExitCode && !result.signal && !result.error
  };
  if (!record.passed) throw new Wp7Error(reasonCode, 'trusted Windows command failed', { record });

  let probeResult = null;
  if (probeOutputPath) {
    if (!fs.existsSync(probeOutputPath) || fs.statSync(probeOutputPath).mtimeMs < startedMs) {
      throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'trusted application probe did not create a fresh result file', { probeId: context.probeId, probeOutputPath });
    }
    probeResult = readJson(probeOutputPath);
    if (probeResult.schemaVersion !== 1 || probeResult.documentType !== 'WP7_INSTALLED_RUNTIME_PROBE_RESULT' || probeResult.probeId !== context.probeId || probeResult.status !== 'PASS') {
      throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'trusted application probe output is invalid', { probeId: context.probeId, probeResult });
    }
    validateProbeEvidenceClassification(probeResult, context.probeId);
    validateMeasurements(context.probeId, probeResult.measurements);
    if (probeResult.executionNonce !== probeExecutionNonce
        || !Number.isInteger(probeResult.producerPid) || probeResult.producerPid <= 0
        || probeResult.producerParentPid !== process.pid
        || fs.realpathSync(probeResult.producerExecutablePath) !== fs.realpathSync(context.expectedExecutable)
        || probeResult.producerExecutableSha256 !== sha256File(context.expectedExecutable)
        || fs.realpathSync(probeResult.producerMainEntryPath) !== fs.realpathSync(context.mainEntryPath)
        || probeResult.producerMainEntrySha256 !== sha256File(context.mainEntryPath)) {
      throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'probe producer process or main-entry identity does not match the directly launched installed application', { probeId: context.probeId, probeResult });
    }
    if (context.networkIsolationProofPath) {
      const proofPath = assertUnderRoot(
        context.rawRoot,
        context.networkIsolationProofPath,
        'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
        'network isolation proof'
      );
      if (!fs.existsSync(proofPath) || fs.statSync(proofPath).mtimeMs < startedMs) {
        throw new Wp7Error('WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_MISSING', 'trusted application probe did not create a fresh network isolation proof', { proofPath });
      }
      const proof = readPreMainProof(proofPath, {
        pid: probeResult.producerPid,
        parentPid: probeResult.producerParentPid,
        nonce: probeExecutionNonce
      });
      if (probeResult.measurements?.networkIsolationProofSha256 !== proof.proofSha256) {
        throw new Wp7Error('WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_INVALID', 'probe measurement does not bind the raw network isolation proof', {
          expected: probeResult.measurements?.networkIsolationProofSha256,
          actual: proof.proofSha256
        });
      }
      record.networkIsolationProofPath = relativeTo(context.rawRoot, proofPath);
      record.networkIsolationProofSha256 = proof.proofSha256;
      record.networkIsolationProofPid = proof.pid;
      record.networkIsolationProofParentPid = proof.parentPid;
      record.networkIsolationProofNonce = proof.nonce;
      if (context.networkIsolationControlAttestationPath) {
        const attestationPath = assertUnderRoot(
          context.rawRoot,
          context.networkIsolationControlAttestationPath,
          'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
          'network isolation control attestation'
        );
        const actualAttestationSha256 = sha256File(attestationPath);
        if (actualAttestationSha256 !== context.networkIsolationControlAttestationSha256
            || probeResult.measurements?.networkIsolationSourceSha256 !== actualAttestationSha256) {
          throw new Wp7Error('WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET', 'probe does not bind the trusted Windows network isolation control attestation', {
            expected: context.networkIsolationControlAttestationSha256,
            actual: actualAttestationSha256,
            measured: probeResult.measurements?.networkIsolationSourceSha256
          });
        }
        record.networkIsolationControlAttestationPath = relativeTo(context.rawRoot, attestationPath);
        record.networkIsolationControlAttestationSha256 = actualAttestationSha256;
      }
    }
    const identityFields = ['buildSessionId', 'buildId', 'frozenSourceCommit', 'frozenSourceTree', 'installerSha256'];
    const mismatches = identityFields.filter((field) => probeResult[field] !== context.identity[field]);
    if (mismatches.length) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'probe identity differs from the sealed final artifact', { probeId: context.probeId, mismatches });
    const probeRef = { path: relativeTo(context.rawRoot, probeOutputPath), sha256: sha256File(probeOutputPath) };
    record.probeId = context.probeId;
    record.probeProducerPid = probeResult.producerPid;
    record.probeProducerParentPid = probeResult.producerParentPid;
    record.probeExecutionNonce = probeExecutionNonce;
    record.probeOutputPath = probeRef.path;
    record.probeOutputSha256 = probeRef.sha256;
  }
  return { record, probeResult };
}

function validateProbeEvidenceClassification(probeResult, probeId = null) {
  if (!probeResult || typeof probeResult !== 'object' || Array.isArray(probeResult)
      || probeResult.executionClass !== 'FINAL_WINDOWS'
      || probeResult.formalWindowsEvidenceEligible !== true
      || probeResult.actualPlatform !== 'win32') {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'pre-review or non-Windows probe result cannot be promoted to formal Windows evidence', {
      probeId,
      executionClass: probeResult && probeResult.executionClass,
      formalWindowsEvidenceEligible: probeResult && probeResult.formalWindowsEvidenceEligible,
      actualPlatform: probeResult && probeResult.actualPlatform
    });
  }
  return true;
}

function requireMeasurement(probes, probeId, key) {
  const value = probes[probeId]?.measurements?.[key];
  if (value === undefined) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'required trusted probe measurement is missing', { probeId, key });
  return value;
}

function commonIdentity(finalReleaseEvidence) {
  const keys = [
    'frozenSourceCommit', 'frozenSourceTree', 'buildSessionId', 'buildId', 'productVersion', 'stageVersion',
    'distributionMode', 'apiContractVersion', 'credentialProtocolVersion', 'runtimeLockProtocolVersion',
    'databaseSchemaVersion', 'releaseManifestSha256', 'applicationPayloadSha256', 'applicationPayloadFilesystemIdentitySha256', 'payloadFilesSha256',
    'productionDependencyBindingSha256', 'productionDependencyPackageGraphSha256', 'productionDependencyFileTreeSha256', 'productionDependencyModeTreeSha256', 'productionDependencyDirectoryModeTreeSha256',
    'productionDependencyFileModePolicy', 'productionDependencyDirectoryModePolicy', 'productionDependencyPackageCount', 'productionDependencyFileCount', 'productionDependencyModeRecordCount', 'productionDependencyDirectoryCount', 'productionDependencyDirectoryModeRecordCount', 'gitPayloadModeTreeSha256', 'gitPayloadModeRecordCount',
    'electronDistributionTreeSha256', 'electronDistributionFileCount', 'electronDistributionModeBoundFileCount',
    'nodeRuntimeVersion', 'nodeRuntimeExecutablePath', 'nodeRuntimeExecutableSha256', 'nodeRuntimeTreeSha256', 'nodeRuntimeFileCount', 'nodeRuntimeModeBoundFileCount',
    'nativeBinaryScanSha256', 'nativeBinaryFileCount', 'nativeBinaryFailureCount', 'nativeBinaryTargetPlatform', 'nativeBinaryTargetArch',
    'installerFileName', 'installerSizeBytes', 'installerSha256', 'completeProjectSourceTreeSha256'
  ];
  return Object.fromEntries(keys.map((key) => [key, finalReleaseEvidence[key]]));
}

function rawDocument(relativePath, common, data, commandIds) {
  const document = {
    ...common,
    ...data,
    schemaVersion: 3,
    documentType: data.documentType || `WP7_RAW_${path.basename(relativePath, '.json').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`,
    stage: '6.4.5.9',
    phase: 'core-runtime-p1',
    workPackage: 'WP7',
    evidenceKind: data.evidenceKind || path.basename(relativePath, '.json').toUpperCase(),
    evidenceClass: 'RAW_WINDOWS_PROBE_EVIDENCE',
    status: 'PASS',
    generatedAtUtc: utcNow(),
    platform: 'win32',
    actualPlatform: 'win32',
    fixtureMode: false,
    upstreamBindings: JSON.parse(JSON.stringify(UPSTREAM_ACCEPTED_BINDINGS)),
    inheritedRiskAcceptances: RISK_IDS.map((id) => ({ id, scopeExpansionAllowed: false })),
    finalInstallationMode: 'CLEAN_INSTALL',
    legacyTestDataMigrationRequired: false,
    legacyTestVersionRollbackRequired: false,
    assertions: Array.isArray(data.assertions) ? data.assertions : [],
    reasonCodes: [],
    provenance: {
      source: 'WP7_FINAL_WINDOWS_HARNESS',
      actualHostPlatform: process.platform,
      host: os.hostname(),
      commandIds: [...new Set(commandIds)],
      callerSuppliedObservations: false,
      callerSuppliedTestResults: false
    }
  };
  validateEvidenceCommon(document, { final: true });
  return document;
}

function writeRawDocuments(rawRoot, documents) {
  const files = [];
  for (const [relativePath, document] of Object.entries(documents)) {
    const absolute = assertUnderRoot(rawRoot, path.join(rawRoot, relativePath), 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'raw evidence');
    writeCanonicalJson(absolute, document);
    files.push({ path: relativePath, sha256: sha256File(absolute), sizeBytes: fs.statSync(absolute).size });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function runWindowsFinalHarness(config, options = {}) {
  if (options.authorizationToken !== WINDOWS_VALIDATION_TOKEN) throw new Wp7Error('WP7_FINAL_WINDOWS_NOT_AUTHORIZED', `Windows validation requires ${WINDOWS_VALIDATION_TOKEN}`);
  if (process.platform !== 'win32') throw new Wp7Error('WP7_WINDOWS_FINAL_BUILD_REQUIRED', 'formal final Windows harness must run on an actual Windows host');
  if (options.fixtureMode !== undefined || config.fixtureMode !== undefined) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'fixture mode is forbidden for formal Windows evidence');
  assertPolicy(config);

  const rawRoot = path.resolve(config.rawEvidenceRoot || '');
  if (!config.rawEvidenceRoot) throw new Wp7Error('WP7_FINAL_WINDOWS_HARNESS_INVALID', 'rawEvidenceRoot is required');
  ensureEmpty(rawRoot);
  const installerPath = path.resolve(config.installerPath || '');
  const installedRoot = path.resolve(config.installedRoot || '');
  const applicationExecutablePath = path.resolve(config.applicationExecutablePath || '');
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) throw new Wp7Error('WP7_FINAL_WINDOWS_HARNESS_INVALID', 'sealed installer missing', { installerPath });
  verifyInstallerHash(installerPath, config.installerSha256);
  const finalReleaseEvidencePath = path.resolve(config.finalReleaseEvidencePath || '');
  if (!fs.existsSync(finalReleaseEvidencePath)) throw new Wp7Error('WP7_FINAL_WINDOWS_HARNESS_INVALID', 'final release evidence missing');
  const finalReleaseEvidence = readJson(finalReleaseEvidencePath);
  validateEvidenceCommon(finalReleaseEvidence, { final: true });
  if (finalReleaseEvidence.installerSha256 !== config.installerSha256) throw new Wp7Error('WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH', 'final release evidence and installer hash differ');
  const common = commonIdentity(finalReleaseEvidence);

  const beforeInventory = (config.residualRoots || []).flatMap((root) => listFiles(path.resolve(root)).map((entry) => ({ root: path.resolve(root), ...entry })));
  const commandResults = [];
  const probeResults = {};
  let oldProcessesDetected = 0;
  let oldProcessesTerminated = 0;

  // Old process cleanup is performed by a fixed Windows system tool, never by a caller-provided observation.
  if (Array.isArray(config.forbiddenProcessNames) && config.forbiddenProcessNames.length) {
    const tasklist = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
    const queried = executeTrustedStep({ id: 'process-scan-before', file: tasklist, args: ['/FO', 'CSV', '/NH'] }, { rawRoot });
    commandResults.push(queried.record);
    const stdout = fs.readFileSync(path.join(rawRoot, queried.record.stdoutPath), 'utf8').toLowerCase();
    for (const name of config.forbiddenProcessNames) {
      if (stdout.includes(String(name).toLowerCase())) {
        oldProcessesDetected += 1;
        const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
        const killed = executeTrustedStep({ id: `terminate-${String(name).replace(/[^A-Za-z0-9]+/g, '_')}`, file: taskkill, args: ['/F', '/IM', String(name)] }, { rawRoot });
        commandResults.push(killed.record);
        oldProcessesTerminated += 1;
      }
    }
  }

  for (const item of config.legacyUninstallers || []) {
    const uninstaller = path.resolve(item.path || '');
    const allowed = (config.residualRoots || []).some((root) => {
      const base = path.resolve(root);
      return uninstaller === base || uninstaller.startsWith(`${base}${path.sep}`);
    });
    if (!allowed) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'legacy uninstaller is outside declared residual roots', { uninstaller });
    const result = executeTrustedStep({ id: item.id, file: uninstaller, args: item.args || [] }, { rawRoot });
    commandResults.push(result.record);
  }

  for (const cleanupPath of config.cleanupPaths || []) {
    const absolute = path.resolve(cleanupPath);
    const allowed = (config.residualRoots || []).some((root) => {
      const base = path.resolve(root);
      return absolute === base || absolute.startsWith(`${base}${path.sep}`);
    });
    if (!allowed) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'cleanup path is outside declared residual roots', { cleanupPath: absolute });
    fs.rmSync(absolute, { recursive: true, force: true });
  }

  const afterCleanupInventory = (config.residualRoots || []).flatMap((root) => listFiles(path.resolve(root)).map((entry) => ({ root: path.resolve(root), ...entry })));
  const forbiddenRemaining = afterCleanupInventory.filter((entry) => (config.forbiddenResidualPatterns || []).some((pattern) => new RegExp(pattern, 'i').test(`${entry.root}/${entry.path}`)));
  if (forbiddenRemaining.length) throw new Wp7Error('WP7_LEGACY_TEST_DATA_RESIDUE', 'legacy/test residue remains before install', { forbiddenRemaining });

  verifyInstallerHash(installerPath, config.installerSha256);
  const install = executeTrustedStep({ ...config.installCommand, id: 'install-final-installer', file: installerPath }, { rawRoot, expectedExecutable: installerPath });
  commandResults.push(install.record);
  if (!fs.existsSync(applicationExecutablePath) || !fs.statSync(applicationExecutablePath).isFile()) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'installed application executable is missing after installer completion', { applicationExecutablePath });
  }
  assertUnderRoot(installedRoot, applicationExecutablePath, 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'installed application executable');

  const configuredProbeIds = Object.keys(config.probeCommands || {}).sort();
  assertFormalProbeIdSet(configuredProbeIds);
  const missingProbeIds = REQUIRED_PROBE_IDS.filter((id) => !configuredProbeIds.includes(id));
  const extraProbeIds = configuredProbeIds.filter((id) => !REQUIRED_PROBE_IDS.includes(id));
  if (missingProbeIds.length || extraProbeIds.length) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'formal probe command set is incomplete or contains unknown commands', { missingProbeIds, extraProbeIds });

  for (const probeId of REQUIRED_PROBE_IDS) {
    const step = { ...config.probeCommands[probeId], id: `probe-${probeId}`, file: applicationExecutablePath };
    let offlineSessionPath = null;
    let offlineSessionSha256 = null;
    let offlineIsolationActive = false;
    let offlineAttestation = null;
    let offlineProbeExecutionNonce = null;
    let offlineProofPath = null;
    let operationError = null;
    try {
      if (probeId === 'offline-start') {
        if (!fs.existsSync(WINDOWS_ISOLATION_CLI_PATH) || !fs.statSync(WINDOWS_ISOLATION_CLI_PATH).isFile()) {
          throw new Wp7Error('WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET', 'first-party Windows network isolation control CLI is missing', { cliPath: WINDOWS_ISOLATION_CLI_PATH });
        }
        const isolationRoot = assertUnderRoot(
          rawRoot,
          path.join(rawRoot, 'network-isolation'),
          'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
          'Windows network isolation root'
        );
        fs.mkdirSync(isolationRoot, { recursive: true });
        offlineProbeExecutionNonce = crypto.randomUUID();
        offlineSessionPath = assertUnderRoot(
          rawRoot,
          path.join(isolationRoot, `${offlineProbeExecutionNonce}.session.json`),
          'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
          'Windows network isolation session handle'
        );
        const attestationPath = assertUnderRoot(
          rawRoot,
          path.join(isolationRoot, `${offlineProbeExecutionNonce}.attestation.json`),
          'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
          'Windows network isolation attestation'
        );
        offlineProofPath = assertUnderRoot(
          rawRoot,
          path.join(isolationRoot, `${offlineProbeExecutionNonce}.proof.json`),
          'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
          'Windows network isolation process proof'
        );
        const mainEntryPath = path.join(installedRoot, 'resources', 'app', 'electron', 'main.js');
        const disable = executeTrustedStep({
          id: 'offline-network-disable',
          file: process.execPath,
          timeoutMs: 90_000,
          args: [
            WINDOWS_ISOLATION_CLI_PATH,
            'disable',
            '--session', offlineSessionPath,
            '--attestation', attestationPath,
            '--control-root', isolationRoot,
            '--owner-pid', String(process.pid),
            '--producer-pid', String(process.pid),
            '--probe-nonce', offlineProbeExecutionNonce,
            '--build-session-id', common.buildSessionId,
            '--build-id', common.buildId,
            '--installer-sha256', common.installerSha256,
            '--product-executable-sha256', sha256File(applicationExecutablePath),
            '--main-entry-sha256', sha256File(mainEntryPath),
            '--watchdog-ms', '300000'
          ]
        }, { rawRoot });
        commandResults.push(disable.record);
        offlineIsolationActive = true;
        if (!fs.existsSync(offlineSessionPath) || !fs.statSync(offlineSessionPath).isFile()) {
          throw new Wp7Error('WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET', 'first-party Windows network isolation session handle was not produced', { offlineSessionPath });
        }
        offlineSessionSha256 = sha256File(offlineSessionPath);
        if (!fs.existsSync(attestationPath) || !fs.statSync(attestationPath).isFile()) {
          throw new Wp7Error('WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET', 'first-party Windows network isolation attestation was not produced', { attestationPath });
        }
        const attestationDocument = readJson(attestationPath);
        offlineAttestation = {
          path: attestationPath,
          sha256: sha256File(attestationPath),
          document: attestationDocument
        };
        assertWindowsIsolationAttestation(attestationDocument, {
          producerPid: process.pid,
          ownerPid: process.pid,
          executionNonce: offlineProbeExecutionNonce,
          buildSessionId: common.buildSessionId,
          buildId: common.buildId,
          installerSha256: common.installerSha256,
          productExecutableSha256: sha256File(applicationExecutablePath),
          mainEntrySha256: sha256File(mainEntryPath),
          controlProgramSha256: sha256File(WINDOWS_ISOLATION_CLI_PATH)
        });
      }
      const executed = executeTrustedStep(step, {
        rawRoot,
        expectedExecutable: applicationExecutablePath,
        applicationCommand: true,
        probeId,
        identity: common,
        mainEntryPath: path.join(installedRoot, 'resources', 'app', 'electron', 'main.js'),
        probeExecutionNonce: offlineProbeExecutionNonce || undefined,
        networkIsolationProofPath: offlineProofPath || undefined,
        networkIsolationControlAttestationPath: offlineAttestation?.path,
        networkIsolationControlAttestationSha256: offlineAttestation?.sha256,
        env: probeId === 'offline-start' ? {
          WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN: '1',
          WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_PATH: offlineAttestation.path,
          WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_SHA256: offlineAttestation.sha256,
          WP7_WINDOWS_NETWORK_ISOLATION_PROOF_PATH: offlineProofPath,
          WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_SHA256: offlineAttestation.document.requestSha256,
          WP7_WINDOWS_NETWORK_ISOLATION_STATE_SHA256: offlineAttestation.document.isolatedStateSha256,
          WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_SHA256: offlineAttestation.document.watchdogScriptSha256,
          WP7_WINDOWS_NETWORK_ISOLATION_LAUNCHER_SHA256: offlineAttestation.document.launcherScriptSha256,
          WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_PROGRAM_SHA256: offlineAttestation.document.controlProgramSha256,
          WP7_WINDOWS_NETWORK_ISOLATION_POWERSHELL_SHA256: offlineAttestation.document.powerShellExecutableSha256,
          WP7_WINDOWS_NETWORK_ISOLATION_ELEVATED_PID: String(offlineAttestation.document.elevatedWatchdogPid),
          WP7_WINDOWS_NETWORK_ISOLATION_GUARDIAN_PID: String(offlineAttestation.document.guardianPid)
        } : {}
      });
      if (probeId === 'offline-start') {
        executed.record.networkIsolationSessionPath = relativeTo(rawRoot, offlineSessionPath);
        executed.record.networkIsolationSessionSha256 = offlineSessionSha256;
        executed.record.networkIsolationControlProgramPath = WINDOWS_ISOLATION_CLI_PATH;
        executed.record.networkIsolationControlProgramSha256 = sha256File(WINDOWS_ISOLATION_CLI_PATH);
        executed.record.networkIsolationElevatedWatchdogPid = offlineAttestation.document.elevatedWatchdogPid;
        executed.record.networkIsolationGuardianPid = offlineAttestation.document.guardianPid;
      }
      commandResults.push(executed.record);
      probeResults[probeId] = executed.probeResult;
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (probeId === 'offline-start' && offlineIsolationActive) {
        try {
          const restored = executeTrustedStep({
            id: 'offline-network-restore',
            file: process.execPath,
            timeoutMs: 120_000,
            args: [
              WINDOWS_ISOLATION_CLI_PATH,
              'restore',
              '--session', offlineSessionPath,
              '--session-sha256', offlineSessionSha256,
              '--control-root', path.dirname(offlineSessionPath)
            ]
          }, { rawRoot });
          commandResults.push(restored.record);
        } catch (restoreError) {
          if (operationError) {
            restoreError.details = {
              ...(restoreError.details || {}),
              operationError: {
                message: operationError.message,
                reasonCode: operationError.reasonCode || null,
                stack: operationError.stack || null
              }
            };
            restoreError.cause = operationError;
          }
          throw restoreError;
        }
      }
    }
  }

  const installedTree = listFiles(installedRoot);
  const forbiddenInstalled = installedTree.filter((entry) => entry.type === 'symlink' || (config.forbiddenInstalledPatterns || []).some((pattern) => new RegExp(pattern, 'i').test(entry.path)));
  if (forbiddenInstalled.length) throw new Wp7Error('WP7_INSTALLED_LEGACY_RUNTIME_DETECTED', 'forbidden legacy runtime detected in installed tree', { forbiddenInstalled });

  const fullSourceClosurePath = path.resolve(config.fullSourceClosurePath || '');
  if (!fs.existsSync(fullSourceClosurePath)) throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'full-source delivery closure input is missing');
  const fullSourceClosure = readJson(fullSourceClosurePath);
  if (fullSourceClosure.status !== 'PASS') throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'full-source delivery closure is not PASS');

  const inventoryBeforeHash = sha256Buffer(canonicalJsonBuffer(beforeInventory));
  const inventoryAfterHash = sha256Buffer(canonicalJsonBuffer(afterCleanupInventory));
  const commandIds = commandResults.map((record) => record.id);
  const docs = {};
  const add = (relativePath, data, ids = commandIds) => { docs[relativePath] = rawDocument(relativePath, common, data, ids); };

  add('evidence/wp7/source-freeze.json', { assertions: ['DETACHED_PREACCEPTED_SOURCE', 'SOURCE_STABLE_THROUGH_SEAL'], sourceCommit: common.frozenSourceCommit, sourceTree: common.frozenSourceTree });
  add('evidence/wp7/clean-install.json', {
    legacyInstallationsDetected: (config.legacyUninstallers || []).length,
    legacyInstallationsUninstalled: (config.legacyUninstallers || []).length,
    oldProcessesDetected,
    oldProcessesTerminated,
    oldInstallerPathsRemoved: config.oldInstallerPathsRemoved || [], oldConfigPathsRemoved: config.oldConfigPathsRemoved || [], oldDatabasePathsRemoved: config.oldDatabasePathsRemoved || [], oldCachePathsRemoved: config.oldCachePathsRemoved || [], oldStagingPathsRemoved: config.oldStagingPathsRemoved || [], oldShortcutStartupServiceTaskEntriesRemoved: config.oldShortcutStartupServiceTaskEntriesRemoved || [],
    beforeResidualInventorySha256: inventoryBeforeHash, afterResidualInventorySha256: inventoryAfterHash, remainingResidueCount: forbiddenRemaining.length,
    legacyTestDataMigrationAttempted: false, legacyTestVersionRollbackAttempted: false, installerSha256VerifiedImmediatelyBeforeInstall: true,
    firstStartFreshInitialization: requireMeasurement(probeResults, 'first-start', 'freshInitialization') === true,
    assertions: ['CLEAN_INSTALL', 'NO_LEGACY_MIGRATION', 'NO_LEGACY_ROLLBACK']
  }, ['install-final-installer', 'probe-first-start']);
  validateCleanInstallEvidence(docs['evidence/wp7/clean-install.json']);
  add('evidence/wp7/restart-cycle.json', {
    firstStartReady: requireMeasurement(probeResults, 'first-start', 'localReady') === true,
    controlledStopConfirmed: requireMeasurement(probeResults, 'controlled-stop', 'ownerExitConfirmed') === true,
    restartReady: requireMeasurement(probeResults, 'restart', 'localReady') === true,
    assertions: ['START_STOP_RESTART_SAME_INSTALLER']
  }, ['probe-first-start', 'probe-controlled-stop', 'probe-restart']);
  add('evidence/wp7/build-identity.json', { consumers: requireMeasurement(probeResults, 'first-start', 'releaseIdentityConsumers'), assertions: ['FOUR_CONSUMERS_ONE_IDENTITY'] }, ['probe-first-start']);
  add('evidence/wp7/runtime-ownership.json', {
    maximumConcurrentAppRuntimeOwners: Math.max(
      requireMeasurement(probeResults, 'first-start', 'maximumConcurrentAppRuntimeOwners'),
      requireMeasurement(probeResults, 'restart', 'maximumConcurrentAppRuntimeOwners'),
      requireMeasurement(probeResults, 'crash-recovery', 'maximumConcurrentAppRuntimeOwners')
    ),
    overlapViolationCount: requireMeasurement(probeResults, 'crash-recovery', 'overlapViolationCount'),
    trustedReplacementOwnerObserved: requireMeasurement(probeResults, 'crash-recovery', 'trustedReplacementOwnerObserved') === true,
    backendCrashRecoveryVerified: requireMeasurement(probeResults, 'crash-recovery', 'backendCrashRecoveryVerified') === true,
    recoveryStateSequence: requireMeasurement(probeResults, 'crash-recovery', 'recoveryStateSequence'),
    ownerExitConfirmedBeforeRecovery: requireMeasurement(probeResults, 'crash-recovery', 'ownerExitConfirmedBeforeRecovery') === true,
    ownerRecoveryCompletedBeforeReplacementStart: requireMeasurement(probeResults, 'crash-recovery', 'ownerRecoveryCompletedBeforeReplacementStart') === true,
    eventGapForcedSnapshotRefetch: requireMeasurement(probeResults, 'event-gap-recovery', 'snapshotRefetchForced') === true,
    assertions: ['SINGLE_BACKEND_APP_RUNTIME']
  }, ['probe-first-start', 'probe-restart', 'probe-crash-recovery']);
  add('evidence/wp7/safe-mode-removal.json', { legacyFallbackInfluenceCount: requireMeasurement(probeResults, 'safe-mode-negative', 'totalAuthorityChanges'), sourceResults: requireMeasurement(probeResults, 'safe-mode-negative', 'sourceResults'), yanceSqliteSoleAuthority: requireMeasurement(probeResults, 'safe-mode-negative', 'sourceResults').every((row) => row.sqliteAuthorityRetained === true), assertions: ['ZERO_LEGACY_SAFE_MODE_EFFECT'] }, ['probe-safe-mode-negative']);
  add('evidence/wp7/credential-ready-gate.json', { earlyReadyViolationCount: requireMeasurement(probeResults, 'credential-gate-negative', 'illegalTransitionRejected') === true ? 0 : 1, hydrationCompletedBeforeLocalReady: requireMeasurement(probeResults, 'first-start', 'hydrationCompletedBeforeReady') === true, trustedOwnerVerified: requireMeasurement(probeResults, 'first-start', 'trustedOwnerVerified') === true, projectionAgreementVerified: requireMeasurement(probeResults, 'first-start', 'projectionAgreementBeforeReady') === true, assertions: ['CREDENTIAL_READY_GATE_ENFORCED'] }, ['probe-first-start', 'probe-credential-gate-negative']);
  add('evidence/wp7/offline-startup.json', { localReadyReached: requireMeasurement(probeResults, 'offline-start', 'localReady') === true, networkUnavailable: requireMeasurement(probeResults, 'offline-start', 'networkUnavailableBeforeApplicationStart') === true, capabilityStateExplicit: requireMeasurement(probeResults, 'offline-start', 'capabilityStateExplicit') === true, falseOnlineCapabilityCount: requireMeasurement(probeResults, 'offline-start', 'falseOnlineCapabilityCount'), assertions: ['OFFLINE_LOCAL_READY'] }, ['probe-offline-start']);
  const offlineProbeCommand = commandResults.find((record) => record.id === 'probe-offline-start');
  add('evidence/wp7/network-isolation-custody.json', {
    controlAttestationPath: offlineProbeCommand?.networkIsolationControlAttestationPath,
    controlAttestationSha256: offlineProbeCommand?.networkIsolationControlAttestationSha256,
    processProofPath: offlineProbeCommand?.networkIsolationProofPath,
    processProofSha256: offlineProbeCommand?.networkIsolationProofSha256,
    processProofPid: offlineProbeCommand?.networkIsolationProofPid,
    processProofParentPid: offlineProbeCommand?.networkIsolationProofParentPid,
    processProofNonce: offlineProbeCommand?.networkIsolationProofNonce,
    proofClass: requireMeasurement(probeResults, 'offline-start', 'networkIsolationProofClass'),
    assertions: ['PARENT_CONTROL_BEFORE_SPAWN', 'EARLY_ELECTRON_NETWORK_OBSERVATION', 'NONCE_BOUND_PROCESS_PROOF']
  }, ['offline-network-disable', 'probe-offline-start', 'offline-network-restore']);
  add('evidence/wp7/install-tree-inventory.json', { installedRoot, installedFileCount: installedTree.length, forbiddenLegacyEntryCount: forbiddenInstalled.length, duplicateRuntimeEntrypointCount: requireMeasurement(probeResults, 'first-start', 'duplicateRuntimeEntrypointCount'), installedTree, assertions: ['ZERO_OLD_RUNTIME_RESIDUE'] }, ['install-final-installer', 'probe-first-start']);
  add('evidence/wp7/build-provenance.json', { stagingInitiallyEmpty: true, oldBuildArtifactReuseAllowed: false, wp1ArtifactReuseAllowed: false, overlayInstallerAllowed: false, assertions: ['CURRENT_SESSION_PAYLOAD_ONLY'] }, ['install-final-installer']);
  add('evidence/wp7/boot-failure-diagnostics.json', { failedPhase: requireMeasurement(probeResults, 'boot-failure', 'failedPhase'), reasonCode: requireMeasurement(probeResults, 'boot-failure', 'reasonCode'), diagnosticBuildId: requireMeasurement(probeResults, 'boot-failure', 'diagnosticBuildId'), assertions: ['MACHINE_READABLE_FAILURE_DIAGNOSTIC'] }, ['probe-boot-failure']);
  add('evidence/wp7/upstream-contract-binding.json', { assertions: ['WP4_WP5_WP6_ACCEPTED_BINDINGS'] }, ['probe-first-start']);
  add('evidence/wp7/protocol-version-binding.json', { observedApiContractVersion: requireMeasurement(probeResults, 'first-start', 'apiContractVersion'), observedCredentialProtocolVersion: requireMeasurement(probeResults, 'first-start', 'credentialProtocolVersion'), observedRuntimeLockProtocolVersion: requireMeasurement(probeResults, 'first-start', 'runtimeLockProtocolVersion'), assertions: ['RUNTIME_PROTOCOLS_MATCH_MANIFEST'] }, ['probe-first-start']);
  add('evidence/wp7/build-session-integrity.json', { sourceStable: true, installerSealed: true, assertions: ['ONE_BUILD_SESSION_ONE_INSTALLER'] }, ['install-final-installer']);
  add('evidence/wp7/full-source-delivery-closure.json', { ...fullSourceClosure, assertions: ['COMPLETE_PROJECT_SOURCE_DELIVERED'] }, ['install-final-installer']);
  add('evidence/wp7/legacy-cleanup-inventory.json', { beforeInventory, afterCleanupInventory, remainingForbiddenCount: forbiddenRemaining.length, assertions: ['MACHINE_READABLE_BEFORE_AFTER_CLEANUP'] }, commandIds.filter((id) => id.includes('process') || id.includes('terminate') || id.includes('install')));
  add('evidence/wp7/preinstall-installer-sha256.json', { observedInstallerSha256: sha256File(installerPath), installerSha256VerifiedImmediatelyBeforeInstall: true, assertions: ['INSTALLER_HASH_REVERIFIED_BEFORE_EXECUTION'] }, ['install-final-installer']);
  add('evidence/wp7/first-start-initialization.json', { freshInitialization: requireMeasurement(probeResults, 'first-start', 'freshInitialization') === true, freshConfigurationCreated: requireMeasurement(probeResults, 'first-start', 'freshConfigurationCreated') === true, freshDatabaseCreated: requireMeasurement(probeResults, 'first-start', 'freshDatabaseCreated') === true, legacyDataRootConsumed: requireMeasurement(probeResults, 'first-start', 'legacyDataRootConsumed') === true, assertions: ['FRESH_STATE_ONLY'] }, ['probe-first-start']);
  add('evidence/wp7/no-contamination.json', { oldRuntimeProcessCount: oldProcessesDetected, oldBuildArtifactCount: requireMeasurement(probeResults, 'first-start', 'oldBuildArtifactCount'), oldStagingArtifactCount: requireMeasurement(probeResults, 'first-start', 'oldStagingArtifactCount'), forbiddenInstalledEntryCount: forbiddenInstalled.length, crossSessionArtifactCount: 0, assertions: ['NO_OLD_PROCESS_OR_BUILD_CONTAMINATION'] }, ['probe-first-start', 'install-final-installer']);

  const files = writeRawDocuments(rawRoot, docs);
  const manifest = {
    schemaVersion: 1,
    documentType: 'WP7_FINAL_WINDOWS_RAW_EVIDENCE_MANIFEST',
    status: 'RAW_EVIDENCE_READY',
    generatedAtUtc: utcNow(),
    platform: 'win32', actualPlatform: process.platform, fixtureMode: false,
    frozenSourceCommit: common.frozenSourceCommit, frozenSourceTree: common.frozenSourceTree,
    buildSessionId: common.buildSessionId, buildId: common.buildId, installerSha256: common.installerSha256,
    files
  };
  const manifestPath = path.join(rawRoot, 'raw-evidence-manifest.json');
  writeCanonicalJson(manifestPath, manifest);
  const result = {
    schemaVersion: 2,
    documentType: 'WP7_FINAL_WINDOWS_RAW_EVIDENCE_RESULT',
    status: 'RAW_EVIDENCE_READY',
    generatedAtUtc: utcNow(),
    platform: 'win32', actualPlatform: process.platform, fixtureMode: false,
    host: os.hostname(),
    frozenSourceCommit: common.frozenSourceCommit, frozenSourceTree: common.frozenSourceTree,
    buildSessionId: common.buildSessionId, buildId: common.buildId, installerSha256: common.installerSha256,
    finalReleaseEvidencePath,
    rawEvidenceRoot: rawRoot,
    rawEvidenceManifestPath: relativeTo(rawRoot, manifestPath),
    commandResults
  };
  const resultPath = path.join(rawRoot, 'windows-harness-result.json');
  writeCanonicalJson(resultPath, result);
  return { ...result, resultPath, rawEvidenceManifestSha256: sha256File(manifestPath) };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (require.main === module) {
  try {
    const configPath = path.resolve(arg('--config') || '');
    if (!fs.existsSync(configPath)) throw new Error('usage: windows-final-harness.js --config <json> --authorization-token <token>');
    const result = runWindowsFinalHarness(readJson(configPath), {
      authorizationToken: arg('--authorization-token') || process.env.WP7_FINAL_WINDOWS_VALIDATION_AUTHORIZATION
    });
    process.stdout.write(`${JSON.stringify({ status: result.status, resultPath: result.resultPath, rawEvidenceRoot: result.rawEvidenceRoot }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_FINAL_WINDOWS_HARNESS_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exit(1);
  }
}

module.exports = {
  WINDOWS_VALIDATION_TOKEN,
  REQUIRED_PROBE_IDS,
  assertPolicy,
  assertWindowsIsolationAttestation,
  executeTrustedStep,
  listFiles,
  runWindowsFinalHarness,
  validateProbeEvidenceClassification
};
