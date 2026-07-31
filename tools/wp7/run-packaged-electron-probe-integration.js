#!/usr/bin/env node
'use strict';

const { numericOption, optionValue } = require('./cli-options');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { readInstallerIdentityReceipt } = require('../../installer/installedIdentityReceipt');
const { loadReleaseIdentity } = require('../../shared/release/releaseIdentity');
const { FORMAL_PROBE_IDS, validateMeasurements } = require('../../electron/wp7InstalledRuntimeProbe');
const { sha256File, verifyTrustedProductExecutable } = require('./packaged-product-trust');
const { validateApplicationPayloadClosure } = require('./packaged-payload-closure');
const { readFormalProbeScope, SCOPE_RELATIVE_PATH } = require('./trusted-product-probe-scope');
const { compileLinuxNetworkIsolation, readPreMainProof } = require('./linux-network-isolation');
const { WindowsNetworkIsolationProvider } = require('./windows-network-isolation-provider');
const { WindowsIsolationWatchdogController, createWindowsWatchdogLauncher } = require('./windows-network-isolation-watchdog-controller');
const {
  ARTIFACT_CLASS: PRE_REVIEW_ARTIFACT_CLASS,
  EVIDENCE_CLASS: PRE_REVIEW_EVIDENCE_CLASS,
  SEALED_ARTIFACT_TYPE,
  readAndVerifyPreReviewSealedArtifact
} = require('./pre-review-sealed-artifact');
const {
  processTreeSpawnOptions,
  terminateProcessTree,
  closeCapturedProcessStreams
} = require('./process-tree-custody');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_RE = /^[0-9a-f]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function assertPreReviewProductClassification(identity) {
  if (!identity || identity.artifactClass !== PRE_REVIEW_ARTIFACT_CLASS || identity.finalReleaseEvidence !== false) {
    fail('WP7_PRE_REVIEW_ARTIFACT_CLASSIFICATION_INVALID', 'pre-review packaged integration requires a PRE_REVIEW_ONLY product manifest', {
      artifactClass: identity?.artifactClass,
      finalReleaseEvidence: identity?.finalReleaseEvidence
    });
  }
  return true;
}
const ENV_BY_ARGUMENT = Object.freeze({
  '--electron-archive': 'WP7_ELECTRON_RELEASE_ARCHIVE',
  '--product-executable': 'WP7_PACKAGED_PRODUCT_EXECUTABLE',
  '--payload-root': 'WP7_PACKAGED_PAYLOAD_ROOT',
  '--resources-root': 'WP7_PACKAGED_RESOURCES_ROOT',
  '--output-root': 'WP7_PACKAGED_PROBE_OUTPUT_ROOT',
  '--pre-review-sealed-artifact': 'WP7_PRE_REVIEW_SEALED_ARTIFACT',
  '--timeout-ms': 'WP7_PACKAGED_PROBE_TIMEOUT_MS'
});
function arg(name, fallback = '') { return optionValue(name, { envName: ENV_BY_ARGUMENT[name], fallback }); }
function git(args, repoRoot = REPO_ROOT) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) fail('WP7_PACKAGED_APPLICATION_ARTIFACT_INVALID', 'cannot resolve repository identity for packaged integration', { args, stderr: result.stderr });
  return String(result.stdout || '').trim();
}
function parseUtc(value, field) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) fail('WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE', `probe result ${field} is not a valid UTC timestamp`, { field, value });
  return timestamp;
}
function validatePackagedPayload(payloadRoot, resourcesRoot = null, options = {}) {
  const closure = validateApplicationPayloadClosure(payloadRoot, resourcesRoot, { repoRoot: options.repoRoot || REPO_ROOT, platform: options.platform || process.platform, arch: options.arch || process.arch });
  const root = closure.root;
  const resources = closure.resources;
  const appRoot = path.join(resources, 'app');
  const packagePath = path.join(appRoot, 'package.json');
  const mainPath = path.join(appRoot, 'electron', 'main.js');
  for (const filePath of [packagePath, mainPath]) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail('WP7_PACKAGED_APPLICATION_ARTIFACT_INVALID', 'packaged application payload is incomplete', { filePath });
  }
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (pkg.main !== 'electron/main.js') fail('WP7_PACKAGED_APPLICATION_ARTIFACT_INVALID', 'packaged application main entry is not electron/main.js', { main: pkg.main });
  const mainSha256 = sha256File(mainPath);
  const reviewedMain = closure.source.projectFiles.find((row) => row.payloadPath === 'resources/app/electron/main.js');
  if (!reviewedMain || reviewedMain.sha256 !== mainSha256) fail('WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'packaged Electron main is not bound to the reviewed Git source', { mainSha256, reviewedMain });
  const bound = {
    productionDependencyBindingSha256: closure.dependencies.externalBindingSha256,
    productionDependencyPackageGraphSha256: closure.dependencies.packageGraphSha256,
    productionDependencyFileTreeSha256: closure.dependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: closure.dependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: closure.dependencies.dependencyDirectoryModeTreeSha256,
    productionDependencyFileModePolicy: closure.dependencies.fileModePolicy,
    productionDependencyDirectoryModePolicy: closure.dependencies.directoryModePolicy,
    productionDependencyPackageCount: closure.dependencies.packageCount,
    productionDependencyFileCount: closure.dependencies.fileCount,
    productionDependencyModeRecordCount: closure.dependencies.modeBoundFileCount,
    productionDependencyDirectoryCount: closure.dependencies.directoryCount,
    productionDependencyDirectoryModeRecordCount: closure.dependencies.modeBoundDirectoryCount,
    applicationPayloadFilesystemIdentitySha256: closure.applicationPayloadFilesystemIdentitySha256,
    gitPayloadModeTreeSha256: closure.source.gitPayloadModeTreeSha256,
    gitPayloadModeRecordCount: closure.source.gitPayloadModeRecordCount,
    nodeRuntimeVersion: closure.nodeRuntime.version,
    nodeRuntimeExecutablePath: `runtime/node22/${closure.nodeRuntime.executableRelativePath}`,
    nodeRuntimeExecutableSha256: closure.nodeRuntime.executableSha256,
    nodeRuntimeTreeSha256: closure.nodeRuntime.runtimeTreeSha256,
    nodeRuntimeFileCount: closure.nodeRuntime.fileCount,
    nodeRuntimeModeBoundFileCount: closure.nodeRuntime.modeBoundFileCount,
    nativeBinaryScanSha256: closure.nativeBinaryScanSha256,
    nativeBinaryFileCount: closure.nativeBinaryScan.fileCount,
    nativeBinaryFailureCount: closure.nativeBinaryScan.failureCount,
    nativeBinaryTargetPlatform: closure.nativeBinaryScan.targetPlatform,
    nativeBinaryTargetArch: closure.nativeBinaryScan.targetArch
  };
  const mismatches = Object.entries(bound).filter(([field, value]) => closure.identity[field] !== value).map(([field, value]) => ({ field, expected: closure.identity[field], actual: value }));
  if (mismatches.length) fail('WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE', 'dependency and Git mode closure identities do not match the release manifest', { mismatches });
  return Object.freeze({
    root,
    resources,
    appRoot,
    packagePath,
    mainPath,
    mainSha256,
    payloadManifestPath: closure.payloadFilesPath,
    payloadManifestSha256: closure.payloadFilesSha256,
    applicationPayloadSha256: closure.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: closure.applicationPayloadFilesystemIdentitySha256,
    payloadRecordCount: closure.records.length,
    reviewedProjectFileCount: closure.source.projectFileCount,
    gitPayloadModeTreeSha256: closure.source.gitPayloadModeTreeSha256,
    gitPayloadModeRecordCount: closure.source.gitPayloadModeRecordCount,
    productionDependencies: closure.dependencies,
    nodeRuntime: closure.nodeRuntime,
    nativeBinaryScan: closure.nativeBinaryScan,
    nativeBinaryScanSha256: closure.nativeBinaryScanSha256,
    sourceClosure: closure.source,
    releaseIdentity: closure.identity
  });
}
function readIdentity(resourcesRoot, repoRoot = REPO_ROOT) {
  const identity = loadReleaseIdentity({
    manifestPath: path.join(resourcesRoot, 'release-manifest.json'),
    detachedHashPath: path.join(resourcesRoot, 'release-manifest.sha256'),
    consumer: 'electron'
  });
  const installer = readInstallerIdentityReceipt(resourcesRoot, identity.buildId);
  const currentHead = git(['rev-parse', 'HEAD'], repoRoot);
  const currentTree = git(['rev-parse', 'HEAD^{tree}'], repoRoot);
  if (identity.sourceCommit !== currentHead || identity.sourceTree !== currentTree) {
    fail('WP7_PACKAGED_APPLICATION_ARTIFACT_INVALID', 'packaged release identity does not match the reviewed repository identity', {
      manifestCommit: identity.sourceCommit,
      currentHead,
      manifestTree: identity.sourceTree,
      currentTree
    });
  }
  return { identity, installer, currentHead, currentTree };
}
function spawnProduct(options) {
  return new Promise((resolve, reject) => {
    const treeOptions = processTreeSpawnOptions(process.platform);
    const child = spawn(options.executable, options.args || [], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: treeOptions.detached,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const startedAtUtc = new Date().toISOString();
    const startedMs = Date.now();
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timeoutTriggered = false;
    let forcedSettlementTimer = null;
    const maxBytes = 16 * 1024 * 1024;
    const capturedText = () => ({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    });
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forcedSettlementTimer);
      reject(error);
    };
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forcedSettlementTimer);
      resolve(value);
    };
    const terminate = (reasonCode, message, details = {}) => {
      const custody = terminateProcessTree(child, { signal: 'SIGKILL' });
      closeCapturedProcessStreams(child);
      const captured = capturedText();
      const error = Object.assign(new Error(message), {
        reasonCode,
        details: { pid: child.pid || 0, custody, ...details, ...captured }
      });
      forcedSettlementTimer = setTimeout(() => finishReject(error), 1000);
      return error;
    };
    const append = (chunks, chunk, key) => {
      if (settled) return;
      const bytes = Buffer.byteLength(chunk);
      if ((key === 'stdout' ? stdoutBytes : stderrBytes) + bytes > maxBytes) {
        const error = terminate(
          'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_FAILED',
          `packaged application ${key} exceeded the capture limit`,
          { stream: key, maxBytes }
        );
        finishReject(error);
        return;
      }
      if (key === 'stdout') stdoutBytes += bytes; else stderrBytes += bytes;
      chunks.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk) => append(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(stderr, chunk, 'stderr'));
    const timeoutMs = Number(options.timeoutMs || 180000);
    const timer = setTimeout(() => {
      if (settled) return;
      timeoutTriggered = true;
      const error = terminate(
        'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_TIMEOUT',
        'packaged Yance application exceeded the trusted probe execution timeout',
        { timeoutMs }
      );
      finishReject(error);
    }, timeoutMs);
    child.once('error', (error) => {
      finishReject(Object.assign(error, { reasonCode: 'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_FAILED' }));
    });
    child.once('close', (code, signal) => {
      const captured = capturedText();
      if (timeoutTriggered) {
        finishReject(Object.assign(new Error('packaged Yance application exceeded the trusted probe execution timeout'), {
          reasonCode: 'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_TIMEOUT',
          details: { pid: child.pid || 0, timeoutMs, status: code, signal, ...captured }
        }));
        return;
      }
      finishResolve({
        pid: child.pid,
        parentPid: process.pid,
        status: code,
        signal,
        startedAtUtc,
        startedMs,
        endedAtUtc: new Date().toISOString(),
        ...captured
      });
    });
  });
}
function validatePackagedProbeResult(report, expected) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE', 'packaged probe result must be an object');
  const exact = {
    schemaVersion: 1,
    documentType: 'WP7_INSTALLED_RUNTIME_PROBE_RESULT',
    probeId: expected.probeId,
    status: 'PASS',
    executionNonce: expected.executionNonce,
    actualPlatform: expected.actualPlatform,
    fixtureMode: false,
    executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    formalWindowsEvidenceEligible: false,
    buildSessionId: expected.buildSessionId,
    buildId: expected.buildId,
    frozenSourceCommit: expected.sourceCommit,
    frozenSourceTree: expected.sourceTree,
    preReviewSealedArtifactSha256: expected.preReviewSealedArtifactSha256,
    preReviewSealedArtifactType: expected.preReviewSealedArtifactType,
    producerPid: expected.producerPid,
    producerParentPid: expected.producerParentPid,
    producerExecutablePath: expected.productExecutable,
    producerExecutableSha256: expected.productExecutableSha256,
    producerMainEntryPath: expected.mainEntryPath,
    producerMainEntrySha256: expected.mainEntrySha256
  };
  const mismatches = Object.entries(exact).filter(([key, value]) => report[key] !== value).map(([key, value]) => ({ key, expected: value, actual: report[key] }));
  if (mismatches.length) fail('WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE', 'packaged probe result does not match the sealed execution context', { probeId: expected.probeId, mismatches });
  const started = parseUtc(report.startedAtUtc, 'startedAtUtc');
  const completed = parseUtc(report.completedAtUtc, 'completedAtUtc');
  const generated = parseUtc(report.generatedAtUtc, 'generatedAtUtc');
  if (started < expected.startedMs - 2000 || completed < started || generated < completed || completed > Date.now() + 5000) {
    fail('WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE', 'packaged probe result timestamps are outside the launched process interval', { started, completed, generated, launchedAt: expected.startedMs });
  }
  validateMeasurements(expected.probeId, report.measurements);
  return true;
}
async function runOneProbe(context, probeId) {
  const probeRoot = path.join(context.outputRoot, 'runs', probeId);
  fs.rmSync(probeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(probeRoot, 'probe-results'), { recursive: true });
  const outputPath = path.join(probeRoot, 'probe-results', `${probeId}.json`);
  const executionNonce = crypto.randomUUID();
  const env = {
    ...process.env,
    ...(context.env || {}),
    YANCE_RELEASE_RESOURCES_PATH: context.payload.resources,
    YANCE_DATA_DIR: path.join(probeRoot, 'user-data'),
    WP7_PROBE_EXECUTION_CLASS: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    WP7_PROBE_ID: probeId,
    WP7_PROBE_ROOT: probeRoot,
    WP7_PROBE_OUTPUT_PATH: outputPath,
    WP7_PROBE_EXECUTION_NONCE: executionNonce,
    WP7_PROBE_BUILD_SESSION_ID: context.buildSessionId,
    WP7_PROBE_PRE_REVIEW_SEALED_ARTIFACT_SHA256: context.preReviewSealedArtifact.sha256,
    WP7_PROBE_PRE_REVIEW_SEALED_ARTIFACT_TYPE: context.preReviewSealedArtifact.document.sealedArtifactType,
    WP7_PROBE_EXPECTED_BUILD_ID: context.identity.buildId,
    WP7_PROBE_EXPECTED_SOURCE_COMMIT: context.identity.sourceCommit,
    WP7_PROBE_EXPECTED_SOURCE_TREE: context.identity.sourceTree,
    WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: context.trust.productExecutableSha256,
    WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: context.payload.mainSha256,
    WP7_PROBE_INSTALLER_SHA256: context.installer.documentSha256,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  };
  let isolationProofPath = null;
  if (probeId === 'offline-start' && process.platform !== 'win32') {
    if (!context.networkIsolation) fail('WP7_NETWORK_ISOLATION_PLATFORM_UNSUPPORTED', 'offline-start requires reviewed Linux network isolation before product spawn', { platform: process.platform });
    const proofDir = path.join(probeRoot, 'network-isolation-proof');
    fs.mkdirSync(proofDir, { recursive: true });
    env.LD_PRELOAD = [context.networkIsolation.libraryPath, env.LD_PRELOAD].filter(Boolean).join(':');
    env.WP7_NETWORK_ISOLATION_PROOF_DIR = proofDir;
    env.WP7_NETWORK_ISOLATION_NONCE = executionNonce;
    env.WP7_NETWORK_ISOLATION_SOURCE_PATH = context.networkIsolation.sourcePath;
    env.WP7_NETWORK_ISOLATION_SOURCE_SHA256 = context.networkIsolation.sourceSha256;
    env.WP7_NETWORK_ISOLATION_LIBRARY_PATH = context.networkIsolation.libraryPath;
    env.WP7_NETWORK_ISOLATION_LIBRARY_SHA256 = context.networkIsolation.librarySha256;
    env.WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN = '1';
    isolationProofPath = path.join(proofDir, 'PENDING.json');
  }

  const spawnAndAssert = async () => {
    const result = await spawnProduct({
      executable: context.trust.productExecutable,
      args: ['--no-sandbox', '--disable-gpu'],
      cwd: context.trust.payloadRoot,
      env,
      timeoutMs: context.timeoutMs
    });
    if (result.status !== 0 || result.signal || !fs.existsSync(outputPath) || fs.statSync(outputPath).mtimeMs < result.startedMs) {
      fail('WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_FAILED', 'packaged Yance application did not produce a successful fresh probe result', {
        probeId,
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        outputPath
      });
    }
    return result;
  };

  let processResult;
  if (probeId === 'offline-start' && process.platform === 'win32') {
    if (!context.windowsNetworkIsolation) {
      fail('WP7_NETWORK_ISOLATION_PLATFORM_UNSUPPORTED', 'offline-start requires the first-party Windows network isolation provider', { platform: process.platform });
    }
    processResult = await context.windowsNetworkIsolation.withIsolation(async (handle) => {
      const isolationRoot = path.join(probeRoot, 'network-isolation');
      fs.mkdirSync(isolationRoot, { recursive: true });
      const attestationPath = path.join(isolationRoot, 'windows-control-attestation.json');
      isolationProofPath = path.join(isolationRoot, `${executionNonce}.json`);
      const attestation = context.windowsNetworkIsolation.createControlAttestation(handle, {
        producerPid: process.pid,
        executionNonce,
        buildSessionId: context.buildSessionId,
        buildId: context.identity.buildId,
        installerSha256: context.installer.documentSha256,
        productExecutableSha256: context.trust.productExecutableSha256,
        mainEntrySha256: context.payload.mainSha256,
        controlProgramSha256: sha256File(__filename)
      });
      fs.writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600 });
      env.WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN = '1';
      env.WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_PATH = attestationPath;
      env.WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_SHA256 = sha256File(attestationPath);
      env.WP7_WINDOWS_NETWORK_ISOLATION_PROOF_PATH = isolationProofPath;
      env.WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_SHA256 = attestation.requestSha256;
      env.WP7_WINDOWS_NETWORK_ISOLATION_STATE_SHA256 = attestation.isolatedStateSha256;
      env.WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_SHA256 = attestation.watchdogScriptSha256;
      env.WP7_WINDOWS_NETWORK_ISOLATION_LAUNCHER_SHA256 = attestation.launcherScriptSha256;
      env.WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_PROGRAM_SHA256 = attestation.controlProgramSha256;
      env.WP7_WINDOWS_NETWORK_ISOLATION_POWERSHELL_SHA256 = attestation.powerShellExecutableSha256;
      env.WP7_WINDOWS_NETWORK_ISOLATION_ELEVATED_PID = String(attestation.elevatedWatchdogPid);
      env.WP7_WINDOWS_NETWORK_ISOLATION_GUARDIAN_PID = String(attestation.guardianPid);
      return spawnAndAssert();
    }, {
      watchdogMs: Math.min(Number(context.timeoutMs || 180000) + 30000, 600000)
    });
  } else {
    processResult = await spawnAndAssert();
  }
  let networkIsolationProof = null;
  if (probeId === 'offline-start') {
    isolationProofPath = process.platform === 'win32' ? isolationProofPath : path.join(env.WP7_NETWORK_ISOLATION_PROOF_DIR, `${processResult.pid}.json`);
    networkIsolationProof = readPreMainProof(isolationProofPath, { pid: processResult.pid, parentPid: processResult.parentPid, nonce: executionNonce });
    const proofMs = networkIsolationProof.unixSeconds * 1000 + Math.floor(networkIsolationProof.unixNanoseconds / 1e6);
    if (proofMs > processResult.startedMs + 5000 || proofMs < processResult.startedMs - 5000) fail('WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_INVALID', 'network isolation proof timestamp is outside the product spawn boundary', { proofMs, startedMs: processResult.startedMs });
  }
  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  validatePackagedProbeResult(report, {
    probeId,
    executionNonce,
    actualPlatform: process.platform,
    buildSessionId: context.buildSessionId,
    buildId: context.identity.buildId,
    sourceCommit: context.identity.sourceCommit,
    sourceTree: context.identity.sourceTree,
    preReviewSealedArtifactSha256: context.preReviewSealedArtifact.sha256,
    preReviewSealedArtifactType: context.preReviewSealedArtifact.document.sealedArtifactType,
    producerPid: processResult.pid,
    producerParentPid: processResult.parentPid,
    productExecutable: context.trust.productExecutable,
    productExecutableSha256: context.trust.productExecutableSha256,
    mainEntryPath: context.payload.mainPath,
    mainEntrySha256: context.payload.mainSha256,
    startedMs: processResult.startedMs
  });
  const stdoutPath = path.join(probeRoot, 'stdout.log');
  const stderrPath = path.join(probeRoot, 'stderr.log');
  const custodyPath = path.join(probeRoot, 'process-custody.json');
  const executionContextPath = path.join(probeRoot, 'execution-context.json');
  fs.writeFileSync(stdoutPath, processResult.stdout, { mode: 0o600 });
  fs.writeFileSync(stderrPath, processResult.stderr, { mode: 0o600 });
  fs.writeFileSync(custodyPath, `${JSON.stringify({
    schemaVersion: 1,
    documentType: 'WP7_TRUSTED_PRODUCT_PROCESS_CUSTODY',
    probeId,
    executionNonce,
    productPid: processResult.pid,
    runnerPid: processResult.parentPid,
    startedAtUtc: processResult.startedAtUtc,
    endedAtUtc: processResult.endedAtUtc,
    exitCode: processResult.status,
    signal: processResult.signal,
    timeoutTriggered: false
  }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(executionContextPath, `${JSON.stringify({
    schemaVersion: 1,
    documentType: 'WP7_TRUSTED_PRODUCT_PROBE_EXECUTION_CONTEXT',
    probeId,
    executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    executionNonce,
    buildSessionId: context.buildSessionId,
    buildId: context.identity.buildId,
    sourceCommit: context.identity.sourceCommit,
    sourceTree: context.identity.sourceTree,
    preReviewSealedArtifactSha256: context.preReviewSealedArtifact.sha256,
    preReviewSealedArtifactType: context.preReviewSealedArtifact.document.sealedArtifactType,
    productExecutableSha256: context.trust.productExecutableSha256,
    mainEntrySha256: context.payload.mainSha256,
    networkIsolationRequired: probeId === 'offline-start'
  }, null, 2)}\n`, { mode: 0o600 });
  const relative = (filePath) => path.relative(context.outputRoot, filePath).split(path.sep).join('/');
  return {
    probeId,
    status: 'PASS',
    processPid: processResult.pid,
    processParentPid: processResult.parentPid,
    startedAtUtc: processResult.startedAtUtc,
    endedAtUtc: processResult.endedAtUtc,
    exitCode: processResult.status,
    signal: processResult.signal,
    stdoutSha256: crypto.createHash('sha256').update(processResult.stdout).digest('hex'),
    stderrSha256: crypto.createHash('sha256').update(processResult.stderr).digest('hex'),
    probeResultPath: relative(outputPath),
    probeResultSha256: sha256File(outputPath),
    stdoutPath: relative(stdoutPath),
    stderrPath: relative(stderrPath),
    processCustodyPath: relative(custodyPath),
    processCustodySha256: sha256File(custodyPath),
    executionContextPath: relative(executionContextPath),
    executionContextSha256: sha256File(executionContextPath),
    executionNonce,
    networkIsolation: networkIsolationProof ? {
      sourceSha256: context.networkIsolation.sourceSha256,
      librarySha256: context.networkIsolation.librarySha256,
      proofPath: relative(networkIsolationProof.proofPath),
      proofSha256: networkIsolationProof.proofSha256,
      proofPid: networkIsolationProof.pid,
      proofParentPid: networkIsolationProof.parentPid,
      proofNonce: networkIsolationProof.nonce
    } : null
  };
}
async function launchAll(options = {}) {
  const formalProbeScope = readFormalProbeScope(options.repoRoot || REPO_ROOT);
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const trust = verifyTrustedProductExecutable({
    repoRoot,
    electronArchivePath: options.electronArchivePath,
    productExecutablePath: options.productExecutablePath,
    payloadRoot: options.payloadRoot,
    platform: process.platform,
    arch: process.arch
  });
  const payload = validatePackagedPayload(trust.payloadRoot, options.resourcesRoot, { repoRoot, platform: process.platform, arch: process.arch });
  const { identity, installer } = readIdentity(payload.resources, repoRoot);
  const electronIdentityMismatches = [
    ['electronDistributionTreeSha256', trust.electronDistributionTreeSha256],
    ['electronDistributionFileCount', trust.electronDistributionFileCount],
    ['electronDistributionModeBoundFileCount', trust.electronDistributionModeBoundFileCount]
  ].filter(([field, value]) => identity[field] !== value).map(([field, value]) => ({ field, expected: identity[field], actual: value }));
  if (electronIdentityMismatches.length) fail('WP7_ELECTRON_DISTRIBUTION_TREE_IDENTITY_MISMATCH', 'Electron distribution content and unixMode identity do not match the release manifest', { mismatches: electronIdentityMismatches });
  assertPreReviewProductClassification(identity);
  const preReviewSealedArtifact = readAndVerifyPreReviewSealedArtifact(options.preReviewSealedArtifactPath, {
    artifactClass: PRE_REVIEW_ARTIFACT_CLASS,
    evidenceClass: PRE_REVIEW_EVIDENCE_CLASS,
    sealedArtifactType: SEALED_ARTIFACT_TYPE,
    buildId: identity.buildId,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    electronReleaseArchiveSha256: trust.archiveSha256,
    productExecutableSha256: trust.productExecutableSha256,
    releaseManifestSha256: identity.manifestSha256,
    applicationPayloadSha256: payload.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: payload.applicationPayloadFilesystemIdentitySha256,
    payloadFilesSha256: payload.payloadManifestSha256,
    productionDependencyBindingSha256: payload.productionDependencies.externalBindingSha256,
    productionDependencyPackageGraphSha256: payload.productionDependencies.packageGraphSha256,
    productionDependencyFileTreeSha256: payload.productionDependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: payload.productionDependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: payload.productionDependencies.dependencyDirectoryModeTreeSha256,
    gitPayloadModeTreeSha256: payload.gitPayloadModeTreeSha256,
    electronDistributionTreeSha256: trust.electronDistributionTreeSha256,
    nodeRuntimeExecutableSha256: payload.nodeRuntime.executableSha256,
    nodeRuntimeTreeSha256: payload.nodeRuntime.runtimeTreeSha256,
    nativeBinaryScanSha256: payload.nativeBinaryScanSha256
  });
  const outputRoot = path.resolve(options.outputRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-packaged-yance-probes-')));
  fs.mkdirSync(outputRoot, { recursive: true });
  const networkIsolation = process.platform === 'linux' ? compileLinuxNetworkIsolation({
    sourcePath: path.join(repoRoot, 'tools', 'wp7', 'network-isolation-preload.c'),
    outputPath: path.join(outputRoot, 'network-isolation', 'libwp7-network-isolation.so')
  }) : null;
  const windowsNetworkIsolation = process.platform === 'win32' ? (() => {
    const root = path.join(outputRoot, 'windows-network-isolation-control');
    const controller = new WindowsIsolationWatchdogController({
      root: path.join(root, 'requests'),
      launch: createWindowsWatchdogLauncher()
    });
    return new WindowsNetworkIsolationProvider({ controller });
  })() : null;
  const buildSessionId = preReviewSealedArtifact.document.buildSessionId;
  if (!GIT_RE.test(identity.sourceCommit) || !GIT_RE.test(identity.sourceTree)) fail('WP7_PACKAGED_APPLICATION_ARTIFACT_INVALID', 'packaged release identity is malformed');
  const context = { repoRoot, trust, payload, identity, installer, outputRoot, buildSessionId, preReviewSealedArtifact, timeoutMs: options.timeoutMs, env: options.env, networkIsolation, windowsNetworkIsolation };
  const requestedProbeId = String(options.probeId || '');
  if (requestedProbeId && !FORMAL_PROBE_IDS.includes(requestedProbeId)) fail('WP7_PACKAGED_PROBE_INTEGRATION_SCOPE_INCOMPLETE', 'requested probe is not in the formal probe authority', { requestedProbeId });
  const probeIds = requestedProbeId ? [requestedProbeId] : FORMAL_PROBE_IDS;
  const probeResults = [];
  for (const probeId of probeIds) probeResults.push(await runOneProbe(context, probeId));
  if (probeResults.length !== probeIds.length || probeResults.some((row) => row.status !== 'PASS')) {
    fail('WP7_PACKAGED_PROBE_INTEGRATION_SCOPE_INCOMPLETE', 'all nine packaged application probes must execute independently and pass', { probeResults });
  }
  return {
    schemaVersion: 2,
    documentType: 'WP7_PACKAGED_YANCE_NINE_PROBE_INTEGRATION_RESULT',
    status: 'PASS',
    generatedAtUtc: new Date().toISOString(),
    executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    formalWindowsEvidenceEligible: false,
    actualPlatform: process.platform,
    actualArch: process.arch,
    electronVersion: trust.electronVersion,
    electronReleaseArchiveFileName: path.basename(trust.archivePath),
    electronReleaseArchiveSha256: trust.archiveSha256,
    electronReleaseArchiveChecksumSource: trust.archiveChecksumSource,
    npmPackageIntegrity: trust.npmPackageIntegrity,
    productExecutableFileName: path.basename(trust.productExecutable),
    productExecutableSha256: trust.productExecutableSha256,
    packagedPayloadClass: 'TRUSTED_PRODUCT_ARCHIVE_PAYLOAD',
    packagedMainRelativePath: path.relative(trust.payloadRoot, payload.mainPath).split(path.sep).join('/'),
    packagedMainSha256: payload.mainSha256,
    payloadFilesSha256: payload.payloadManifestSha256,
    applicationPayloadSha256: payload.applicationPayloadSha256,
    payloadRecordCount: payload.payloadRecordCount,
    reviewedProjectFileCount: payload.reviewedProjectFileCount,
    electronDistributionFileCount: trust.electronDistributionFileCount,
    electronDistributionModeBoundFileCount: trust.electronDistributionModeBoundFileCount,
    electronDistributionTreeSha256: trust.electronDistributionTreeSha256,
    nodeRuntimeVersion: payload.nodeRuntime.version,
    nodeRuntimeExecutablePath: `runtime/node22/${payload.nodeRuntime.executableRelativePath}`,
    nodeRuntimeExecutableSha256: payload.nodeRuntime.executableSha256,
    nodeRuntimeTreeSha256: payload.nodeRuntime.runtimeTreeSha256,
    nodeRuntimeFileCount: payload.nodeRuntime.fileCount,
    nodeRuntimeModeBoundFileCount: payload.nodeRuntime.modeBoundFileCount,
    nativeBinaryScanSha256: payload.nativeBinaryScanSha256,
    nativeBinaryFileCount: payload.nativeBinaryScan.fileCount,
    nativeBinaryFailureCount: payload.nativeBinaryScan.failureCount,
    nativeBinaryTargetPlatform: payload.nativeBinaryScan.targetPlatform,
    nativeBinaryTargetArch: payload.nativeBinaryScan.targetArch,
    productionDependencyBindingSha256: payload.productionDependencies.externalBindingSha256,
    productionDependencyPackageGraphSha256: payload.productionDependencies.packageGraphSha256,
    productionDependencyFileTreeSha256: payload.productionDependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: payload.productionDependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: payload.productionDependencies.dependencyDirectoryModeTreeSha256,
    productionDependencyFileModePolicy: payload.productionDependencies.fileModePolicy,
    productionDependencyDirectoryModePolicy: payload.productionDependencies.directoryModePolicy,
    productionDependencyPackageCount: payload.productionDependencies.packageCount,
    productionDependencyFileCount: payload.productionDependencies.fileCount,
    productionDependencyModeRecordCount: payload.productionDependencies.modeBoundFileCount,
    productionDependencyDirectoryCount: payload.productionDependencies.directoryCount,
    productionDependencyDirectoryModeRecordCount: payload.productionDependencies.modeBoundDirectoryCount,
    applicationPayloadFilesystemIdentitySha256: payload.applicationPayloadFilesystemIdentitySha256,
    gitPayloadModeTreeSha256: payload.gitPayloadModeTreeSha256,
    gitPayloadModeRecordCount: payload.gitPayloadModeRecordCount,
    installerIdentityReceiptSha256: installer.documentSha256,
    buildSessionId,
    preReviewSealedArtifactFileName: path.basename(preReviewSealedArtifact.path),
    preReviewSealedArtifactSha256: preReviewSealedArtifact.sha256,
    preReviewSealedArtifactType: preReviewSealedArtifact.document.sealedArtifactType,
    artifactClass: identity.artifactClass,
    finalReleaseEvidence: identity.finalReleaseEvidence,
    buildId: identity.buildId,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    formalProbeAuthority: formalProbeScope.document.authorityModule,
    formalProbeScopePath: SCOPE_RELATIVE_PATH,
    networkIsolationSourceSha256: networkIsolation?.sourceSha256 || null,
    networkIsolationLibrarySha256: networkIsolation?.librarySha256 || null,
    requiredProbeIds: [...FORMAL_PROBE_IDS],
    executedProbeCount: probeResults.length,
    probeResults
  };
}

if (require.main === module) {
  launchAll({
    electronArchivePath: arg('--electron-archive'),
    productExecutablePath: arg('--product-executable'),
    payloadRoot: arg('--payload-root'),
    resourcesRoot: arg('--resources-root'),
    outputRoot: arg('--output-root'),
    preReviewSealedArtifactPath: arg('--pre-review-sealed-artifact'),
    timeoutMs: numericOption('--timeout-ms', { envName: ENV_BY_ARGUMENT['--timeout-ms'], fallback: 180000 }),
    probeId: arg('--probe-id')
  }).then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_FAILED', message: error.message, details: error.details || null }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertPreReviewProductClassification,
  launchAll,
  readIdentity,
  runOneProbe,
  spawnProduct,
  validatePackagedPayload,
  validatePackagedProbeResult
};
