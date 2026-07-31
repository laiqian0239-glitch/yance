#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  REPO_ROOT, readJson, ADVERSARIAL_REQUIREMENTS_PATH, assertActivationBinding, gitIdentity, validateRiskRegister,
  validateAcceptanceMapping, validatePhaseModel, validateWorkstreamTraceability, protectedTarget, canonicalJsonBuffer,
  validateEvidenceCommon
} = require('./lib');
const { runReasonOracle, runGovernanceMutation } = require('./oracles');

const requirements = readJson(ADVERSARIAL_REQUIREMENTS_PATH).challenges || [];
const results = [];
function check(id, fn) {
  const startedAt = Date.now();
  process.stderr.write(`START ${id}\n`);
  try { const detail = fn(); results.push({ id, status: 'PASS', detail: detail || null }); }
  catch (error) { results.push({ id, status: 'FAIL', reasonCode: error.reasonCode || 'ADVERSARIAL_CHECK_FAILED', message: error.message }); }
  process.stderr.write(`END ${id} ${Date.now() - startedAt}ms\n`);
}
check('AR01', () => assertActivationBinding(REPO_ROOT, { identity: gitIdentity(), requireClean: false, requireBranch: true }));
check('AR02', () => { runReasonOracle('WP7_WP0_GATE_BRANCH_MISMATCH'); runReasonOracle('WP7_SOURCE_NOT_CLEAN'); try { protectedTarget('package', { outputRoot: path.join(os.tmpdir(), 'x') }); } catch (e) { if (e.reasonCode !== 'WP7_FINAL_PACKAGING_NOT_AUTHORIZED') throw e; return 'unauthorized package/release denied'; } throw new Error('package unexpectedly authorized'); });
check('AR03', () => { runReasonOracle('FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT'); runReasonOracle('WP7_CROSS_SESSION_ARTIFACT_REUSE'); });
check('AR04', () => { runReasonOracle('WP1_PAYLOAD_PATH_INVALID'); runReasonOracle('WP1_PAYLOAD_SYMLINK_REJECTED'); });
check('AR05', () => runReasonOracle('WP7_PAYLOAD_HASH_MISMATCH'));
check('AR06', () => { runReasonOracle('BOOT_BUILD_ID_MISMATCH'); runReasonOracle('WP7_PROTOCOL_VERSION_BINDING_MISMATCH'); });
check('AR07', () => { runReasonOracle('WP7_BUILD_SESSION_BUSY'); runReasonOracle('WP7_BUILD_SESSION_ID_MISMATCH'); });
check('AR08', () => { const r = spawnSync(process.execPath, ['tools/wp7/concurrency-crash-matrix.js'], { cwd: REPO_ROOT, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stdout || r.stderr); return 'K01-K15 fail-safe recovery passed'; });
check('AR09', () => { runReasonOracle('WP7_INSTALLER_HASH_MISMATCH'); runReasonOracle('WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH'); });
check('AR10', () => { for (const code of ['WP7_LEGACY_TEST_INSTALLATION_RESIDUE','WP7_OLD_RUNTIME_PROCESS_RESIDUE','WP7_LEGACY_TEST_DATA_RESIDUE','WP7_OLD_INSTALLER_RESIDUE']) runReasonOracle(code); });
check('AR11', () => { runReasonOracle('WP7_LEGACY_TEST_DATA_MIGRATION_FORBIDDEN'); runReasonOracle('WP7_FIRST_START_NOT_CLEAN'); });
check('AR12', () => { runReasonOracle('WP7_INSTALLED_DUAL_RUNTIME_OWNER'); runReasonOracle('WP7_EVENT_GAP_RECOVERY_BYPASS'); });
check('AR13', () => { runReasonOracle('WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION'); runReasonOracle('WP7_EVIDENCE_IDENTITY_SPLIT'); });
check('AR14', () => { runReasonOracle('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED'); runReasonOracle('WP7_COMPLETE_GIT_HISTORY_REQUIRED'); });
check('AR15', () => runReasonOracle('WP7_INHERITED_RISK_RECORD_MISMATCH'));
check('AR16', () => {
  const root = path.join(REPO_ROOT, 'evidence', 'wp7', 'pre-review');
  const hits = [];
  if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) if (name.endsWith('.json')) {
    const doc = readJson(path.join(root, name));
    try { validateEvidenceCommon(doc); } catch (e) { hits.push({ name, reasonCode: e.reasonCode }); }
  }
  if (hits.length) throw new Error(`evidence secret/schema scan failed: ${JSON.stringify(hits)}`);
  return 'no secret-bearing evidence fields';
});
check('AR17', () => { const r = spawnSync(process.execPath, ['tools/wp7/run-mutations.js'], { cwd: REPO_ROOT, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stdout || r.stderr); const d = JSON.parse(r.stdout); if (d.killed !== 44 || d.survived || d.invalid || d.harnessError) throw new Error('mutation closure incomplete'); return '44/44 killed'; });
check('AR18', () => { const a = canonicalJsonBuffer({ b: 2, a: 1 }), b = canonicalJsonBuffer({ a: 1, b: 2 }); if (!a.equals(b)) throw new Error('canonical inventory is nondeterministic'); return 'canonical bytes exact'; });
check('AR19', () => { const tracked = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean); const bad = tracked.filter((x) => /Final.*Installer.*\.exe|phase1-acceptance-evidence\.json/i.test(x)); if (bad.length) throw new Error(`premature final artifacts: ${bad}`); return 'no final installer or final acceptance claim'; });
check('AR20', () => { try { protectedTarget('release', { outputRoot: path.join(os.tmpdir(), 'x') }); } catch (e) { if (e.reasonCode === 'WP7_FINAL_PACKAGING_NOT_AUTHORIZED') return 'final packaging gate enforced'; throw e; } throw new Error('release unexpectedly authorized'); });
check('AR21', () => runGovernanceMutation('acceptance'));
check('AR22', () => runGovernanceMutation('phase'));
check('AR23', () => runGovernanceMutation('trace'));
check('AR24', () => {
  const prevalidatedPath = process.env.WP7_CONVERGENCE_EVIDENCE_PATH;
  if (prevalidatedPath) {
    const result = JSON.parse(fs.readFileSync(prevalidatedPath, 'utf8'));
    if (result.total !== 128 || result.killed + result.notApplicable !== 128 || result.survived || result.invalid || result.harnessError) throw new Error('Prevalidated convergence correction matrix incomplete');
    const nonApplicableRows = (result.results || []).filter((row) => row.status === 'NOT_APPLICABLE');
    if (nonApplicableRows.some((row) => row.applicable !== false || !/NOT_APPLICABLE$/.test(row.observedReasonCode || ''))) throw new Error('Prevalidated convergence correction matrix contains unaudited platform exclusions');
    return `validated prior same-run convergence evidence: ${result.killed} killed, ${result.notApplicable} platform-not-applicable`;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-adversarial-correction-matrix-'));
  const stdoutPath = path.join(root, 'stdout.json');
  const stderrPath = path.join(root, 'stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let r;
  try {
    r = spawnSync(process.execPath, ['tools/wp7/convergence-correction-matrix.js'], { cwd: REPO_ROOT, timeout: 1800000, stdio: ['ignore', stdoutFd, stderrFd] });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  const stdout = fs.readFileSync(stdoutPath, 'utf8');
  const stderr = fs.readFileSync(stderrPath, 'utf8');
  if (r.status !== 0) throw new Error(stdout || stderr || `correction matrix terminated by ${r.signal || 'unknown'}`);
  const result = JSON.parse(stdout);
  if (result.total !== 128 || result.killed + result.notApplicable !== 128 || result.survived || result.invalid || result.harnessError) throw new Error('Convergence correction matrix incomplete');
  const nonApplicableRows = (result.results || []).filter((row) => row.status === 'NOT_APPLICABLE');
  if (nonApplicableRows.some((row) => row.applicable !== false || !/NOT_APPLICABLE$/.test(row.observedReasonCode || ''))) throw new Error('Convergence correction matrix contains unaudited platform exclusions');
  return `128/128 correction checks closed (${result.killed} killed, ${result.notApplicable} platform-not-applicable), including trusted Node 22, restricted SQLite bridge, pre-spawn offline isolation, ordered crash recovery, packaged runtime identity-reader closure, direct BackendProcessHost authority projection, safe CONNECTING WebSocket restart disposal, inert same-origin renderer-storage custody, packaged process-tree timeout closure, allowlisted boot-failure child launch continuity, verified Pre-Review sealed artifact identity and complete relative raw evidence paths`;
});
check('AR25', () => {
  const installedProbeTestSource = [
    'tests/wp7/installed-runtime-probe-protocol.test.js',
    'tests/wp7/installed-runtime-probe-operations.test.js',
    'tests/wp7/installed-application-probe-entry-integration.test.js',
    'tests/wp7/pre-review-evidence-package.test.js',
    'tests/wp7/pre-review-candidate-package.test.js',
    'tests/wp7/windows-harness-horizontal-closure.test.js'
  ].map((testPath) => fs.readFileSync(path.join(REPO_ROOT, testPath), 'utf8')).join('\n');
  const requiredDynamicCases = [
    'all nine formal semantic measurement fixtures are accepted',
    'semantic omissions and self-confirming shortcuts are rejected',
    'all nine installed runtime probe producers return semantically valid measurements',
    'production dependency external binding rejects replacement, injection, deletion and joint internal re-signing',
    'production dependency file modes are exact, mode-hashed and resist joint internal re-signing',
    'dependency mode identity deletion, forgery and malformed external mode records are rejected',
    'formal trusted-product probe IDs have one executable and governance authority',
    'package-lock graph, integrity, version and source mutations are rejected by the external dependency authority',
    'replaced or re-signed dependency binding is rejected against the reviewed Git blob',
    'production dependency directory modes bind root, scope, package and nested directories and resist joint internal re-signing',
    'dependency directory mode identity deletion, forgery and external binding mutation are rejected',
    'Git 100755 and 100644 modes are compared exactly and bound into release identity',
    'Electron unixMode is compared per file and included in the bound distribution tree hash',
    'assembled product payload carries exact production main and independent installer identity receipt',
    'complete nine-probe raw evidence validates every result, log, custody, context and offline proof',
    'missing raw stdout evidence is rejected',
    'temporary absolute path references in the aggregate are rejected',
    'formal pre-review product and evidence commands require actual reviewed inputs and cannot claim final release',
    'candidate Source ZIP is independently verified as exact Git content and mode projection',
    'candidate Source ZIP verifier rejects an unreviewed extra file'
  ];
  for (const testName of requiredDynamicCases) if (!installedProbeTestSource.includes(testName)) throw new Error(`required installed-probe dynamic case is not registered: ${testName}`);
  const main = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
  const producer = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbe.js'), 'utf8');
  const provenance = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'release', 'identityObservation.js'), 'utf8');
  const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
  const body = main.match(/async function runWp7InstalledRuntimeProbe\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  if (!body.includes('return runInstalledRuntimeProbeApplicationEntry({') || /executeInstalledRuntimeProbe\s*\(/.test(body) || !producer.includes('WP7_PROBE_ID')) throw new Error('installed application probe production entry is broken');
  if (!provenance.includes('sourceDocumentSha256') || !provenance.includes('sourcePaths.has') || provenance.includes('independentlyObserved: true')) throw new Error('release identity provenance remains self-confirming');
  const packagedScript = String(pkg.scripts?.['test:wp7:packaged-electron'] || '');
  const runner = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
  const trust = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'packaged-product-trust.js'), 'utf8');
  const payloadClosure = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'packaged-payload-closure.js'), 'utf8');
  const dependencyClosure = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'production-dependency-binding.js'), 'utf8');
  const sealedArtifact = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'pre-review-sealed-artifact.js'), 'utf8');
  const evidencePackage = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'pre-review-evidence-package.js'), 'utf8');
  const buildLib = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'lib.js'), 'utf8');
  const preReviewProductBuilder = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'create-pre-review-trusted-product.js'), 'utf8');
  const preReviewEvidenceGenerator = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'generate-pre-review-evidence.js'), 'utf8');
  const candidateBuilder = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'create-convergence-pre-review-candidate.js'), 'utf8');
  const candidateVerifier = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'verify-convergence-pre-review-candidate.js'), 'utf8');
  const bindingPath = path.join(REPO_ROOT, 'release', 'production-dependency-binding.json');
  const formalProbeAuthority = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'wp7', 'formalProbeIds.js'), 'utf8');
  const formalProbeScope = readJson(path.join(REPO_ROOT, 'governance', 'wp7', 'formal-trusted-product-probe-scope.json'));
  const blockerGenerator = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'trusted-product-probe-scope.js'), 'utf8');
  const windowsHarness = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'windows-final-harness.js'), 'utf8');
  const windowsFinalBuilderWrapper = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'RUN_WINDOWS_FINAL_BUILDER.ps1'), 'utf8');
  if (packagedScript !== 'node tools/wp7/run-packaged-electron-probe-integration.js' || /\$WP7_|%WP7_|--installer-sha256|--probe-id\s+first-start/.test(packagedScript) || !runner.includes('--product-executable') || !runner.includes('--electron-archive') || !runner.includes('--pre-review-sealed-artifact') || !runner.includes('WP7_PACKAGED_PRODUCT_EXECUTABLE') || !runner.includes('WP7_ELECTRON_RELEASE_ARCHIVE') || !runner.includes('WP7_PRE_REVIEW_SEALED_ARTIFACT')) throw new Error('formal nine-probe packaged product command or Windows-safe CLI/env authority is missing, narrowed or still accepts a bare installer hash');
  if ((!runner.includes('const probeIds = requestedProbeId ? [requestedProbeId] : FORMAL_PROBE_IDS') || !runner.includes('for (const probeId of probeIds)')) || !runner.includes('producerPid: expected.producerPid') || !runner.includes('validateMeasurements(expected.probeId, report.measurements)') || !runner.includes('readAndVerifyPreReviewSealedArtifact') || !runner.includes('processCustodySha256') || !runner.includes('executionContextSha256') || !runner.includes("artifactClass !== PRE_REVIEW_ARTIFACT_CLASS") || runner.includes('electronReleaseArchivePath: trust.archivePath')) throw new Error('packaged product runner does not bind all nine results, the actual sealed artifact file, relative raw evidence and Pre-Review-only classification');
  if (!sealedArtifact.includes("DOCUMENT_TYPE = 'WP7_PRE_REVIEW_SEALED_ARTIFACT'") || !sealedArtifact.includes("SEALED_ARTIFACT_TYPE = 'TRUSTED_PRODUCT_BUILD_SESSION_SEAL_V1'") || !sealedArtifact.includes('readAndVerifyPreReviewSealedArtifact') || !sealedArtifact.includes('finalInstaller: false') || !sealedArtifact.includes('formalWindowsEvidenceEligible: false')) throw new Error('Pre-Review sealed artifact schema and file verification are incomplete');
  if (!evidencePackage.includes('validateNineProbeRawEvidence') || !evidencePackage.includes('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING') || !evidencePackage.includes('processCustodySha256') || !evidencePackage.includes('executionContextSha256') || !evidencePackage.includes('readPreMainProof') || !evidencePackage.includes('assertNoAbsoluteOrTempReferences')) throw new Error('raw nine-probe evidence, process custody, network isolation proof or relative-path verification is incomplete');
  if (!trust.includes('archiveSha256 !== trust.archive.sha256') || !trust.includes('productExecutableSha256 !== officialExecutableSha256') || !trust.includes('unixMode') || !trust.includes('expectedDistributionTreeSha256') || !trust.includes('verifyElectronDistributionTree')) throw new Error('complete official Electron content and unixMode distribution trust is not enforced');
  if (!payloadClosure.includes('applicationPayloadSha256') || !payloadClosure.includes('payloadFilesSha256') || !payloadClosure.includes('validateReviewedApplicationSourceClosure') || !payloadClosure.includes('WP7_GIT_PAYLOAD_MODE_BINDING_INVALID') || !payloadClosure.includes('gitPayloadModeTreeSha256')) throw new Error('complete application payload and exact reviewed Git file mode closure are not enforced');
  if (!fs.existsSync(bindingPath) || !dependencyClosure.includes("git(root, ['show', `${commit}:${BINDING_RELATIVE_PATH}`]") || !dependencyClosure.includes('workingBytes.equals(reviewedBytes)') || !dependencyClosure.includes('dependencyFileTreeSha256') || !dependencyClosure.includes('dependencyModeTreeSha256') || !dependencyClosure.includes('dependencyDirectoryModeTreeSha256') || !dependencyClosure.includes('normalizedDependencyMode') || !dependencyClosure.includes('normalizedDependencyDirectoryMode') || !dependencyClosure.includes('packageGraphSha256') || !dependencyClosure.includes('NPM_DOT_BIN_DIRECTORIES_EXCLUDED_FROM_PACKAGED_PAYLOAD_V1')) throw new Error('external reviewed production dependency binding is incomplete');
  if (!formalProbeAuthority.includes("'first-start'") || !formalProbeAuthority.includes("'boot-failure'") || formalProbeScope.requiredProbeCount !== 9 || JSON.stringify(formalProbeScope.formalProbeIds) !== JSON.stringify(['first-start','controlled-stop','restart','offline-start','crash-recovery','safe-mode-negative','credential-gate-negative','event-gap-recovery','boot-failure']) || !blockerGenerator.includes('formalProbeIds: [...FORMAL_PROBE_IDS]') || !windowsHarness.includes('assertFormalProbeIdSet(configuredProbeIds)')) throw new Error('trusted-product executable probe IDs do not have one shared authority across governance, blocker and Windows execution');
  if (!preReviewProductBuilder.includes('WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD') || !preReviewProductBuilder.includes('artifactClass: PRE_REVIEW_ARTIFACT_CLASS') || !preReviewProductBuilder.includes('finalReleaseEvidence: false') || !preReviewProductBuilder.includes('validateApplicationPayloadClosure') || !preReviewProductBuilder.includes('verifyTrustedProductExecutable') || !preReviewProductBuilder.includes('WP7_RCEDIT_PATH') || !preReviewProductBuilder.includes('rceditSha256')) throw new Error('Pre-Review trusted product builder does not independently bind product identity or classification');
  if (!preReviewEvidenceGenerator.includes('validateNineProbeRawEvidence') || !preReviewEvidenceGenerator.includes('WP7_PRE_REVIEW_EVIDENCE_INDEX.json') || !preReviewEvidenceGenerator.includes('WP7_PRE_REVIEW_INTERNAL_SHA256.txt') || !preReviewEvidenceGenerator.includes('complete verification output')) throw new Error('Pre-Review evidence generator does not require actual raw probes and complete verification outputs');
  if (!candidateBuilder.includes('WP7_CPR_R9_CONVERGENCE_PRE_REVIEW_CANDIDATE_DELIVERY') || !candidateBuilder.includes('preAcceptanceIssued: false') || !candidateBuilder.includes('finalPackagingAuthorized: false') || !candidateBuilder.includes("finalAcceptanceStatus: 'NOT_ACCEPTED'") || !candidateBuilder.includes('WP7_CPR_R9_ARTIFACT_MANIFEST') || !candidateBuilder.includes('WP7_CPR_R9_INTERNAL_SHA256.txt') || !candidateBuilder.includes('createDeterministicZip') || /run\(['"]zip['"]/.test(candidateBuilder)) throw new Error('CPR-R9 candidate builder does not preserve review-only status, complete package inventory, or Windows-safe deterministic archive creation');
  if (!candidateVerifier.includes('verifyReviewBundle') || !candidateVerifier.includes('verifyPatch') || !candidateVerifier.includes('verifySourceZip') || !candidateVerifier.includes('verifyInternalHashes') || !candidateVerifier.includes('verifyArtifactManifest') || !candidateVerifier.includes('readAndVerifyPreReviewSealedArtifact')) throw new Error('CPR-R9 independent candidate verifier does not rebuild all package identity surfaces');
  if (!windowsFinalBuilderWrapper.includes("$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'") || !windowsFinalBuilderWrapper.includes('Expand-ValidatedElectronArchive $ElectronArchive') || !windowsFinalBuilderWrapper.includes('Electron archive path escapes destination') || !windowsFinalBuilderWrapper.includes('electron-offline-bootstrap.json') || windowsFinalBuilderWrapper.indexOf("$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'") > windowsFinalBuilderWrapper.indexOf('& $NodeExe $NpmCli ci --no-audit --no-fund') || windowsFinalBuilderWrapper.indexOf('Expand-ValidatedElectronArchive $ElectronArchive') < windowsFinalBuilderWrapper.indexOf('& $NodeExe $NpmCli ci --no-audit --no-fund')) throw new Error('Windows Final Builder does not bootstrap the reviewed Electron archive after npm package installation without network binary download');
  if (!buildLib.includes("'--no-bin-links'") || !buildLib.includes('copyProductionDependencyTree') || !buildLib.includes('GENERATED_NPM_BIN_SHIM_POLICY') || !buildLib.includes("'installer/installedIdentityReceipt.js'") || !buildLib.includes('productionDependencyBindingSha256') || !buildLib.includes('productionDependencyModeTreeSha256') || !buildLib.includes('productionDependencyDirectoryModeTreeSha256') || !buildLib.includes('applicationPayloadFilesystemIdentitySha256') || !buildLib.includes('gitPayloadModeTreeSha256') || !buildLib.includes('electronDistributionTreeSha256') || !buildLib.includes('nodeRuntimeTreeSha256') || !buildLib.includes('nodeRuntimeExecutableSha256') || !buildLib.includes('nativeBinaryScanSha256')) throw new Error('final builder does not bind runtime identity reader, dependency, Git mode, Electron mode and trusted Node runtime identities');
  if (!runner.includes('validateApplicationPayloadClosure') || runner.includes("spawnSync(trust.productExecutable, ['--version']") || !runner.includes('electronDistributionTreeSha256') || !runner.includes('productionDependencyBindingSha256') || !runner.includes('productionDependencyModeTreeSha256') || !runner.includes('productionDependencyDirectoryModeTreeSha256') || !runner.includes('applicationPayloadFilesystemIdentitySha256') || !runner.includes('gitPayloadModeTreeSha256') || !runner.includes('nodeRuntimeTreeSha256') || !runner.includes('nativeBinaryScanSha256') || !runner.includes('compileLinuxNetworkIsolation') || !runner.includes('env.LD_PRELOAD =')) throw new Error('packaged integration does not consume dependency, Git mode, Electron distribution, trusted Node runtime and pre-spawn offline closure without an invalid renamed-binary version preflight');
  const electronMain = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
  const sqliteBridge = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'sqliteSettingsBridge.js'), 'utf8');
  const crashCoordinator = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'desktopHost', 'DesktopCredentialApplicationCoordinator.js'), 'utf8');
  const shutdownCoordinator = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'backendShutdownCoordinator.js'), 'utf8');
  const eventSocketLifecycle = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'eventSocketLifecycle.js'), 'utf8');
  const eventSocketRegression = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-event-socket-restart-safety.test.js'), 'utf8');
  const rendererStorageNavigation = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7RendererStorageProbeNavigation.js'), 'utf8');
  const installedRuntimeProductionHost = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeProductionHost.js'), 'utf8');
  const rendererStorageRegression = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-renderer-storage-navigation-recovery.test.js'), 'utf8');
  const rendererStorageDocument = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'wp7', 'rendererStorageProbeDocument.js'), 'utf8');
  const backendServer = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'server.js'), 'utf8');
  const processTreeCustody = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'process-tree-custody.js'), 'utf8');
  const processTreeRegression = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-packaged-runner-process-custody.test.js'), 'utf8');
  const bootFailureAdapter = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeMainAdapter.js'), 'utf8');
  const bootFailureRegression = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-boot-failure-diagnostics.test.js'), 'utf8');
  if (!electronMain.includes('resolveTrustedNodeRuntime') || !electronMain.includes('trustedBackendProjection()') || !electronMain.includes('wp7VerifyNetworkIsolationProof') || electronMain.includes("require('node:sqlite')")) throw new Error('Electron main still bypasses trusted Node, nested authority or offline proof boundaries');
  if (!sqliteBridge.includes('spawnSync(this.runtime.executablePath') || !sqliteBridge.includes('delete this.environment.ELECTRON_RUN_AS_NODE')) throw new Error('restricted SQLite bridge does not execute under the reviewed trusted Node boundary');
  if (!crashCoordinator.includes("this._transition(STATES.OWNER_EXIT_CONFIRMED, 'backend-exit-confirmed'") || !crashCoordinator.includes("this._transition(STATES.OWNER_RECOVERING, 'backend-exit-observed'")) throw new Error('unexpected backend exit recovery does not preserve ordered OWNER_EXIT_CONFIRMED and OWNER_RECOVERING states');
  if (!shutdownCoordinator.includes('desktopHost?.backendProcessHost') || !shutdownCoordinator.includes('processHost?.snapshot?.()') || shutdownCoordinator.indexOf('processHost?.snapshot?.()') > shutdownCoordinator.indexOf('desktopHost?.snapshot?.()')) throw new Error('backend authority still permits recursive aggregate DesktopHost snapshot projection');
  if (!electronMain.includes('disposeEventSocket(socket, WebSocket)') || !eventSocketLifecycle.includes("socket.on('error', () => {})") || !eventSocketLifecycle.includes('initialReadyState === connecting') || !eventSocketLifecycle.includes('socket.terminate()') || !eventSocketRegression.includes('without an uncaught asynchronous ws error')) throw new Error('controlled restart does not safely dispose a CONNECTING event socket');
  if (!electronMain.includes('createElectronRendererStorageSession({') || !electronMain.includes('waitForReady: () => wp7ProbeBackendReadyDocument()') || !electronMain.includes('const authority = trustedBackendProjection()') || !installedRuntimeProductionHost.includes('createRendererStorageProbeSession({') || !installedRuntimeProductionHost.includes('verifyView: async (view)') || !rendererStorageNavigation.includes("phase === 'navigation'") || !rendererStorageNavigation.includes("phase = 'document-verification'") || !rendererStorageNavigation.includes('view = createView({ attempt })') || !rendererStorageNavigation.includes('WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_FAILED') || !rendererStorageNavigation.includes('if (usableView(retainedView))') || !rendererStorageNavigation.includes('retainedView = acquired.view') || !installedRuntimeProductionHost.includes('WP7_RENDERER_STORAGE_PROBE_PATH') || !installedRuntimeProductionHost.includes('WP7_RENDERER_STORAGE_PROBE_MARKER') || !electronMain.includes('wp7ProbeRendererStorageSession?.dispose?.()') || !rendererStorageRegression.includes('renderer storage probe document is exact, inert') || !rendererStorageRegression.includes('later matrix scenarios must not require another local navigation') || !rendererStorageDocument.includes("connect-src 'none'") || !rendererStorageDocument.includes("String(env.WP7_PROBE_ID || '').trim() === 'safe-mode-negative'") || !backendServer.includes('app.get(WP7_RENDERER_STORAGE_PROBE_PATH')) throw new Error('safe-mode renderer storage probe does not preserve bounded inert same-origin document custody');
  if (!runner.includes('detached: treeOptions.detached') || !runner.includes('WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_TIMEOUT') || !processTreeCustody.includes('kill(-child.pid, signal)') || !processTreeCustody.includes("taskkill.exe") || !processTreeRegression.includes('settles without inherited-pipe hang')) throw new Error('packaged probe runner does not preserve whole-process-tree timeout custody');
  if (!bootFailureAdapter.includes("BOOT_FAILURE_CHILD_ALLOWED_SWITCHES = new Set(['--no-sandbox', '--disable-gpu'])") || !bootFailureAdapter.includes('normalizeBootFailureChildArguments(deps.bootFailureChildArguments?.() || [])') || !electronMain.includes("bootFailureChildArguments: () => ['no-sandbox', 'disable-gpu']") || !electronMain.includes('app.commandLine.hasSwitch(name)') || !bootFailureRegression.includes('inherits only the already active Chromium launch switches')) throw new Error('boot-failure child does not preserve the allowlisted parent product launch boundary');
  return 'production entry, independent provenance, external dependency authority, dependency directory modes, exact Git modes, Electron unixMode distribution trust, nine-probe scope, verified Pre-Review sealed artifact identity, complete relative raw evidence, safe CONNECTING WebSocket restart disposal, inert same-origin renderer-storage custody, packaged process-tree timeout closure, allowlisted boot-failure child launch continuity and independently executed dynamic cases are registered';
});
const expectedIds = requirements.map((x) => x.id);
const missing = expectedIds.filter((id) => !results.some((r) => r.id === id));
const failed = results.filter((r) => r.status !== 'PASS');
const status = missing.length || failed.length ? 'FAIL' : 'PASS';
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, documentType: 'WP7_DEVELOPER_ADVERSARIAL_REVIEW_RESULT', total: expectedIds.length, passed: results.length - failed.length, failed: failed.length, missing, status, results }, null, 2)}\n`);
process.exit(status === 'PASS' ? 0 : 1);
