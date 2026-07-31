'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PREACCEPTANCE_RECORD_ENV,
  PREACCEPTANCE_HASH_ENV,
  Wp7Error,
  canonicalJsonBuffer,
  readJson,
  readPreacceptanceBinding,
  sha256Buffer,
  sha256File,
  validateEvidenceCommon,
  verifyInstallerHash
} = require('./lib');
const { readPreMainProof } = require('./linux-network-isolation');

const FINAL_CONTEXT_VERSION = 2;
const FORBIDDEN_CALLER_FIELDS = Object.freeze(['observations', 'testResults', 'platform', 'actualPlatform', 'fixtureMode']);
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_RE = /^[0-9a-f]{40}$/;

function requireFile(filePath, reasonCode, label) {
  const resolved = path.resolve(filePath || '');
  if (!filePath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Wp7Error(reasonCode, `${label} is missing`, { filePath: resolved });
  }
  return resolved;
}

function requireDirectory(dirPath, reasonCode, label) {
  const resolved = path.resolve(dirPath || '');
  if (!dirPath || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Wp7Error(reasonCode, `${label} is missing`, { dirPath: resolved });
  }
  return resolved;
}

function assertNoCallerClaims(document, reasonCode = 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS') {
  const present = FORBIDDEN_CALLER_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(document || {}, field));
  if (present.length) throw new Wp7Error(reasonCode, 'caller-supplied final claims are forbidden', { present });
}

function loadAndVerifyJsonReference(reference, baseDir, reasonCode, label) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new Wp7Error(reasonCode, `${label} reference is invalid`);
  }
  const filePath = requireFile(path.resolve(baseDir, reference.path || ''), reasonCode, label);
  const actualSha256 = sha256File(filePath);
  if (!SHA256_RE.test(reference.sha256 || '') || reference.sha256 !== actualSha256) {
    throw new Wp7Error(reasonCode, `${label} SHA256 mismatch`, { expected: reference.sha256, actual: actualSha256, filePath });
  }
  return { filePath, document: readJson(filePath), sha256: actualSha256 };
}

function validateHarnessResult(result, options = {}) {
  const reasonCode = 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS';
  if (!result || result.documentType !== 'WP7_FINAL_WINDOWS_RAW_EVIDENCE_RESULT' || result.status !== 'RAW_EVIDENCE_READY') {
    throw new Wp7Error(reasonCode, 'Windows harness result is not a raw evidence result');
  }
  if (result.actualPlatform !== 'win32' || result.platform !== 'win32' || result.fixtureMode !== false) {
    throw new Wp7Error(reasonCode, 'formal Windows evidence must be generated on an actual non-fixture win32 host', {
      actualPlatform: result.actualPlatform,
      platform: result.platform,
      fixtureMode: result.fixtureMode
    });
  }
  if (!SHA256_RE.test(result.installerSha256 || '') || !GIT_RE.test(result.frozenSourceCommit || '') || !GIT_RE.test(result.frozenSourceTree || '')) {
    throw new Wp7Error(reasonCode, 'Windows harness identity is incomplete');
  }
  if (!Array.isArray(result.commandResults) || !result.commandResults.length) {
    throw new Wp7Error(reasonCode, 'Windows harness command provenance is missing');
  }
  for (const record of result.commandResults) {
    const required = ['id', 'startedAtUtc', 'endedAtUtc', 'exitCode', 'stdoutSha256', 'stderrSha256', 'stdoutPath', 'stderrPath', 'executableSha256'];
    const missing = required.filter((key) => record[key] === undefined || record[key] === null || record[key] === '');
    if (missing.length || !SHA256_RE.test(record.stdoutSha256) || !SHA256_RE.test(record.stderrSha256) || !SHA256_RE.test(record.executableSha256)) {
      throw new Wp7Error(reasonCode, 'command provenance record is incomplete', { id: record.id, missing });
    }
    if (options.rootDir) {
      const root = path.resolve(options.rootDir);
      const verifyRawReference = (key, hashKey, label) => {
        const absolute = path.resolve(root, record[key] || '');
        if (!record[key] || !SHA256_RE.test(record[hashKey] || '')
            || (absolute !== root && !absolute.startsWith(`${root}${path.sep}`))
            || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()
            || sha256File(absolute) !== record[hashKey]) {
          throw new Wp7Error(reasonCode, `${label} provenance mismatch`, { id: record.id, key, absolute });
        }
        return absolute;
      };
      for (const [key, hashKey] of [['stdoutPath', 'stdoutSha256'], ['stderrPath', 'stderrSha256']]) {
        verifyRawReference(key, hashKey, 'command raw output');
      }
      if (record.id === 'probe-offline-start') {
        const proofPath = verifyRawReference('networkIsolationProofPath', 'networkIsolationProofSha256', 'network isolation proof');
        const attestationPath = verifyRawReference('networkIsolationControlAttestationPath', 'networkIsolationControlAttestationSha256', 'network isolation control attestation');
        const sessionPath = verifyRawReference('networkIsolationSessionPath', 'networkIsolationSessionSha256', 'network isolation serialized session');
        const controlProgramPath = path.resolve(String(record.networkIsolationControlProgramPath || ''));
        if (!fs.existsSync(controlProgramPath) || !fs.statSync(controlProgramPath).isFile()
            || sha256File(controlProgramPath) !== record.networkIsolationControlProgramSha256
            || !SHA256_RE.test(String(record.networkIsolationControlProgramSha256 || ''))
            || !Number.isInteger(record.networkIsolationElevatedWatchdogPid) || record.networkIsolationElevatedWatchdogPid <= 0
            || !Number.isInteger(record.networkIsolationGuardianPid) || record.networkIsolationGuardianPid <= 0
            || record.networkIsolationGuardianPid === record.networkIsolationElevatedWatchdogPid) {
          throw new Wp7Error(reasonCode, 'network isolation command record is missing source and process custody', { id: record.id });
        }
        const serializedSession = readJson(sessionPath);
        const proof = readPreMainProof(proofPath, {
          pid: record.probeProducerPid,
          parentPid: record.probeProducerParentPid,
          nonce: record.probeExecutionNonce
        });
        if (proof.pid !== record.networkIsolationProofPid
            || proof.parentPid !== record.networkIsolationProofParentPid
            || proof.nonce !== record.networkIsolationProofNonce) {
          throw new Wp7Error(reasonCode, 'network isolation proof custody fields do not match the command record', { id: record.id });
        }
        const attestation = readJson(attestationPath);
        const enabledBefore = Array.isArray(attestation?.adaptersBefore)
          ? attestation.adaptersBefore.filter((row) => row?.adminStatus === 'Up')
          : [];
        const afterByIndex = new Map((attestation?.adaptersAfterDisable || []).map((row) => [Number(row.interfaceIndex), row]));
        const allEnabledDisabled = enabledBefore.length > 0
          && enabledBefore.every((row) => afterByIndex.get(Number(row.interfaceIndex))?.adminStatus === 'Down');
        const hashFields = ['requestSha256', 'isolatedStateSha256', 'watchdogScriptSha256', 'launcherScriptSha256', 'controlProgramSha256', 'powerShellExecutableSha256'];
        const hashesValid = hashFields.every((field) => SHA256_RE.test(String(attestation?.[field] || '')));
        const disable = attestation?.disableCommand;
        if (attestation?.schemaVersion !== 2
            || attestation?.documentType !== 'WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_ATTESTATION'
            || attestation?.executionNonce !== record.probeExecutionNonce
            || attestation?.producerPid !== record.probeProducerParentPid
            || attestation?.ownerPid !== record.probeProducerParentPid
            || !Number.isInteger(attestation?.elevatedWatchdogPid)
            || attestation.elevatedWatchdogPid <= 0
            || !Number.isInteger(attestation?.guardianPid)
            || attestation.guardianPid <= 0
            || attestation.elevatedWatchdogPid === record.probeProducerParentPid
            || attestation.guardianPid === record.probeProducerParentPid
            || attestation.guardianPid === attestation.elevatedWatchdogPid
            || attestation.guardianScriptSha256 !== attestation.watchdogScriptSha256
            || attestation.controlProgramSha256 !== record.networkIsolationControlProgramSha256
            || attestation.elevatedWatchdogPid !== record.networkIsolationElevatedWatchdogPid
            || attestation.guardianPid !== record.networkIsolationGuardianPid
            || serializedSession?.schemaVersion !== 2
            || serializedSession?.documentType !== 'WP7_WINDOWS_NETWORK_ISOLATION_SERIALIZED_HANDLE'
            || serializedSession?.attestationSha256 !== record.networkIsolationControlAttestationSha256
            || serializedSession?.requestSha256 !== attestation.requestSha256
            || serializedSession?.isolatedStateSha256 !== attestation.isolatedStateSha256
            || serializedSession?.controlProgramSha256 !== attestation.controlProgramSha256
            || serializedSession?.powerShellExecutableSha256 !== attestation.powerShellExecutableSha256
            || !hashesValid
            || attestation?.disableCommandPassed !== true
            || disable?.passed !== true
            || disable?.exitCode !== 0
            || disable?.expectedExitCode !== 0
            || disable?.executionKind !== 'POWERSHELL_CMDLET_BATCH'
            || disable?.resultCodeSource !== 'POWERSHELL_EXCEPTION_MAPPING'
            || disable?.postconditionVerified !== true
            || !Array.isArray(disable?.operations)
            || disable.operations.length === 0
            || !disable.operations.every((row) => row?.passed === true && row?.exitCode === 0
              && row?.executionKind === 'POWERSHELL_CMDLET'
              && row?.resultCodeSource === 'POWERSHELL_EXCEPTION_MAPPING'
              && row?.invocationCompleted === true
              && row?.commandName === 'Disable-NetAdapter')
            || !allEnabledDisabled
            || !Array.isArray(attestation?.routesAfterDisable)
            || attestation.routesAfterDisable.length !== 0
            || attestation?.isolationPostcondition?.passed !== true
            || attestation?.isolationPostcondition?.allOriginallyEnabledPhysicalAdaptersDisabled !== true
            || attestation?.isolationPostcondition?.allOriginallyEnabledIsolatableAdaptersDisabled !== true
            || attestation?.isolationPostcondition?.noDefaultRoutesRemain !== true
            || proof.controlAttestationSha256 !== record.networkIsolationControlAttestationSha256) {
          throw new Wp7Error(reasonCode, 'network isolation control attestation custody is invalid', { id: record.id, attestation });
        }
      }
    }
  }
  return result;
}

function validateRawEvidenceManifest(manifest, rawEvidenceRoot) {
  const reasonCode = 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS';
  if (!manifest || manifest.documentType !== 'WP7_FINAL_WINDOWS_RAW_EVIDENCE_MANIFEST' || manifest.status !== 'RAW_EVIDENCE_READY') {
    throw new Wp7Error(reasonCode, 'raw evidence manifest is invalid');
  }
  if (manifest.actualPlatform !== 'win32' || manifest.fixtureMode !== false) {
    throw new Wp7Error(reasonCode, 'raw evidence manifest platform/fixture binding is invalid');
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Wp7Error(reasonCode, 'raw evidence manifest is empty');
  const seen = new Set();
  for (const ref of manifest.files) {
    if (!ref || typeof ref.path !== 'string' || !SHA256_RE.test(ref.sha256 || '') || seen.has(ref.path)) {
      throw new Wp7Error(reasonCode, 'raw evidence manifest reference is invalid', { ref });
    }
    seen.add(ref.path);
    const absolute = path.resolve(rawEvidenceRoot, ref.path);
    const root = path.resolve(rawEvidenceRoot);
    if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute) || sha256File(absolute) !== ref.sha256) {
      throw new Wp7Error(reasonCode, 'raw evidence file SHA256 mismatch', { ref, absolute });
    }
    const document = readJson(absolute);
    if (document.actualPlatform !== 'win32' || document.platform !== 'win32' || document.fixtureMode !== false) {
      throw new Wp7Error(reasonCode, 'raw child evidence platform/fixture mismatch', { path: ref.path });
    }
    if (!document.provenance || !Array.isArray(document.provenance.commandIds) || !document.provenance.commandIds.length) {
      throw new Wp7Error(reasonCode, 'raw child evidence provenance is missing', { path: ref.path });
    }
  }
  return manifest;
}

function validateFinalExecutionContext(context, options = {}) {
  const mode = options.mode || context?.executionPhase;
  const reasonCode = 'WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS';
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Wp7Error(reasonCode, 'final execution context is missing');
  assertNoCallerClaims(context, reasonCode);
  if (context.schemaVersion !== FINAL_CONTEXT_VERSION || context.documentType !== 'WP7_FINAL_EXECUTION_CONTEXT') {
    throw new Wp7Error(reasonCode, 'final execution context schema mismatch');
  }
  if (!['FINAL_PACKAGING', 'FINAL_WINDOWS', 'ALL_FINAL'].includes(mode)) throw new Wp7Error(reasonCode, 'invalid final execution phase', { mode });
  const phaseCompatible = context.executionPhase === mode || context.executionPhase === 'ALL_FINAL' || (mode === 'ALL_FINAL' && context.executionPhase === 'ALL_FINAL');
  if (!phaseCompatible) {
    throw new Wp7Error(reasonCode, 'final execution context phase mismatch', { expected: mode, actual: context.executionPhase });
  }

  const baseDir = path.resolve(options.baseDir || process.cwd());
  const installerPath = requireFile(path.resolve(baseDir, context.installerPath || ''), reasonCode, 'final installer');
  if (!SHA256_RE.test(context.installerSha256 || '')) throw new Wp7Error(reasonCode, 'final installer SHA256 is missing');
  verifyInstallerHash(installerPath, context.installerSha256);
  const payloadRoot = requireDirectory(path.resolve(baseDir, context.payloadRoot || ''), reasonCode, 'final payload root');
  const releaseManifestPath = requireFile(path.resolve(baseDir, context.releaseManifestPath || ''), reasonCode, 'final release manifest');
  const payloadFilesPath = requireFile(path.resolve(baseDir, context.payloadFilesPath || ''), reasonCode, 'final payload files manifest');
  const finalReleaseEvidencePath = requireFile(path.resolve(baseDir, context.finalReleaseEvidencePath || ''), reasonCode, 'final release evidence');
  const finalReleaseEvidence = readJson(finalReleaseEvidencePath);
  validateEvidenceCommon(finalReleaseEvidence, { final: true });
  if (finalReleaseEvidence.installerSha256 !== context.installerSha256 || finalReleaseEvidence.buildSessionId !== context.buildSessionId) {
    throw new Wp7Error(reasonCode, 'final release evidence does not bind the final installer/session');
  }
  if (sha256File(releaseManifestPath) !== finalReleaseEvidence.releaseManifestSha256 || sha256File(payloadFilesPath) !== finalReleaseEvidence.payloadFilesSha256) {
    throw new Wp7Error(reasonCode, 'final manifest/payload metadata hashes do not match release evidence');
  }
  const releaseManifest = readJson(releaseManifestPath);
  const closureFields = [
    'productionDependencyBindingSha256', 'productionDependencyPackageGraphSha256', 'productionDependencyFileTreeSha256', 'productionDependencyModeTreeSha256', 'productionDependencyDirectoryModeTreeSha256',
    'productionDependencyFileModePolicy', 'productionDependencyDirectoryModePolicy', 'productionDependencyPackageCount', 'productionDependencyFileCount', 'productionDependencyModeRecordCount', 'productionDependencyDirectoryCount', 'productionDependencyDirectoryModeRecordCount', 'applicationPayloadFilesystemIdentitySha256', 'gitPayloadModeTreeSha256', 'gitPayloadModeRecordCount',
    'electronDistributionTreeSha256', 'electronDistributionFileCount', 'electronDistributionModeBoundFileCount',
    'nodeRuntimeVersion', 'nodeRuntimeExecutablePath', 'nodeRuntimeExecutableSha256', 'nodeRuntimeTreeSha256', 'nodeRuntimeFileCount', 'nodeRuntimeModeBoundFileCount',
    'nativeBinaryScanSha256', 'nativeBinaryFileCount', 'nativeBinaryFailureCount', 'nativeBinaryTargetPlatform', 'nativeBinaryTargetArch'
  ];
  const closureMismatches = closureFields.filter((field) => finalReleaseEvidence[field] !== releaseManifest[field]).map((field) => ({ field, manifest: releaseManifest[field], evidence: finalReleaseEvidence[field] }));
  if (closureMismatches.length) throw new Wp7Error(reasonCode, 'final dependency, Git mode, or Electron distribution identity differs between manifest and release evidence', { closureMismatches });
  if (!fs.realpathSync(releaseManifestPath).startsWith(`${fs.realpathSync(payloadRoot)}${path.sep}`) || !fs.realpathSync(payloadFilesPath).startsWith(`${fs.realpathSync(payloadRoot)}${path.sep}`)) {
    throw new Wp7Error(reasonCode, 'final metadata is not inside the final payload root');
  }

  const preacceptance = readPreacceptanceBinding({
    recordPath: path.resolve(baseDir, context.preacceptanceRecordPath || process.env[PREACCEPTANCE_RECORD_ENV] || ''),
    recordSha256: context.preacceptanceRecordSha256 || process.env[PREACCEPTANCE_HASH_ENV]
  });
  if (preacceptance.implementationCommit !== finalReleaseEvidence.frozenSourceCommit || preacceptance.implementationSourceTree !== finalReleaseEvidence.frozenSourceTree) {
    throw new Wp7Error(reasonCode, 'final context does not bind the independently preaccepted implementation');
  }

  const finalDeliveryIdentityPath = requireFile(path.resolve(baseDir, context.finalDeliveryIdentityPath || ''), reasonCode, 'final delivery identity');
  const finalDeliveryIdentity = readJson(finalDeliveryIdentityPath);
  if (!GIT_RE.test(finalDeliveryIdentity.finalDeliveryHead || '') || !GIT_RE.test(finalDeliveryIdentity.finalDeliveryTree || '')) {
    throw new Wp7Error(reasonCode, 'sealed Final Delivery identity is incomplete');
  }
  if (finalDeliveryIdentity.implementationCommit !== preacceptance.implementationCommit || finalDeliveryIdentity.implementationSourceTree !== preacceptance.implementationSourceTree) {
    throw new Wp7Error(reasonCode, 'Final Delivery identity is not bound to the preaccepted implementation');
  }
  const finalDeliveryRepo = requireDirectory(path.resolve(baseDir, context.finalDeliveryRepo || ''), reasonCode, 'Final Delivery repository');
  const gitDir = path.join(finalDeliveryRepo, '.git');
  if (!fs.existsSync(gitDir)) throw new Wp7Error(reasonCode, 'Final Delivery repository is not a Git repository', { finalDeliveryRepo });
  const { execFileSync } = require('node:child_process');
  const observedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: finalDeliveryRepo, encoding: 'utf8' }).trim();
  const observedTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: finalDeliveryRepo, encoding: 'utf8' }).trim();
  const porcelain = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: finalDeliveryRepo, encoding: 'utf8' }).trim();
  if (observedHead !== finalDeliveryIdentity.finalDeliveryHead || observedTree !== finalDeliveryIdentity.finalDeliveryTree || porcelain) {
    throw new Wp7Error(reasonCode, 'Final Delivery repository does not match the sealed clean identity', { observedHead, observedTree, porcelain });
  }

  const rawEvidenceRoot = requireDirectory(path.resolve(baseDir, context.rawWindowsEvidenceRoot || ''), reasonCode, 'raw Windows evidence root');
  const harnessResultPath = requireFile(path.resolve(baseDir, context.windowsHarnessResultPath || ''), reasonCode, 'Windows harness result');
  const harnessResult = validateHarnessResult(readJson(harnessResultPath), { rootDir: rawEvidenceRoot });
  if (harnessResult.installerSha256 !== context.installerSha256 || harnessResult.buildSessionId !== context.buildSessionId) {
    throw new Wp7Error(reasonCode, 'Windows harness result is not bound to the final installer/session');
  }
  const rawManifestPath = requireFile(path.resolve(rawEvidenceRoot, context.rawEvidenceManifestPath || 'raw-evidence-manifest.json'), reasonCode, 'raw evidence manifest');
  const rawManifest = validateRawEvidenceManifest(readJson(rawManifestPath), rawEvidenceRoot);
  if (rawManifest.installerSha256 !== context.installerSha256 || rawManifest.buildSessionId !== context.buildSessionId) {
    throw new Wp7Error(reasonCode, 'raw evidence manifest is not bound to the final installer/session');
  }

  const normalized = {
    schemaVersion: FINAL_CONTEXT_VERSION,
    documentType: 'WP7_FINAL_EXECUTION_CONTEXT',
    executionPhase: mode,
    buildSessionId: context.buildSessionId,
    installerPath,
    installerSha256: context.installerSha256,
    payloadRoot,
    releaseManifestPath,
    payloadFilesPath,
    finalReleaseEvidencePath,
    rawWindowsEvidenceRoot: rawEvidenceRoot,
    windowsHarnessResultPath: harnessResultPath,
    rawEvidenceManifestPath: rawManifestPath,
    preacceptanceRecordPath: preacceptance.recordPath,
    preacceptanceRecordSha256: preacceptance.recordSha256,
    implementationCommit: preacceptance.implementationCommit,
    implementationSourceTree: preacceptance.implementationSourceTree,
    finalDeliveryIdentityPath,
    finalDeliveryRepo,
    finalDeliveryHead: finalDeliveryIdentity.finalDeliveryHead,
    finalDeliveryTree: finalDeliveryIdentity.finalDeliveryTree
  };
  const contextSha256 = sha256Buffer(canonicalJsonBuffer(normalized));
  return { ...normalized, contextSha256, finalReleaseEvidence, harnessResult, rawManifest, finalDeliveryIdentity };
}

function readFinalExecutionContext(contextPath, options = {}) {
  const resolved = requireFile(contextPath, 'WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', 'final execution context');
  const context = readJson(resolved);
  return { contextPath: resolved, ...validateFinalExecutionContext(context, { ...options, baseDir: path.dirname(resolved) }) };
}

module.exports = {
  FINAL_CONTEXT_VERSION,
  FORBIDDEN_CALLER_FIELDS,
  assertNoCallerClaims,
  validateHarnessResult,
  validateRawEvidenceManifest,
  validateFinalExecutionContext,
  readFinalExecutionContext,
  loadAndVerifyJsonReference
};
