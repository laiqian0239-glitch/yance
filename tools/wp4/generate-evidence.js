#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { TRANSITIONS, STATES } = require('../../shared/credentialTransactionStateMachine');
const { TRANSITIONS: AUTHORITY_TRANSITIONS, STATES: AUTHORITY_STATES } = require('../../shared/credentialAuthorityLifecycleStateMachine');
const { ALLOWED: APPLICATION_TRANSITIONS, STATES: APPLICATION_STATES } = require('../../shared/desktopCredentialApplicationStateMachine');
const { runProductionCredentialScenario } = require('./production-credential-runtime');
const { scanSecretTransports } = require('./scan-secret-transports');
const { runTransactionFailureProbes } = require('./transaction-failure-probes');
const { runCredentialAuthorityClosureProbes } = require('./credential-authority-closure-probes');
const { runSecureBridgeFailureProbe } = require('./credential-secure-bridge-failure-probe');
const { runCredentialArchitectureFaultMatrix } = require('./credential-architecture-fault-matrix');
const { runCredentialAuthorityLifecycleMatrix } = require('./credential-authority-lifecycle-matrix');
const { runBackendOwnerExitMatrix } = require('./backend-owner-exit-probe');
const { runCredentialCompleteFaultMatrix } = require('./credential-complete-fault-matrix');
const { runDesktopCredentialApplicationLifecycleMatrix } = require('./desktop-credential-application-lifecycle-matrix');
const { DIRECT_CASES: CONTAINMENT_DIRECT_CASES, runDesktopCredentialContainmentJournalFaultMatrix } = require('./desktop-credential-containment-journal-fault-matrix');
const { runContainmentJournalOrderProbe } = require('./containment-journal-order-probe');
const { runDesktopCredentialStartHandshakeContainmentMatrix } = require('./desktop-credential-start-handshake-containment-matrix');
const { runCredentialMutationTests } = require('./run-credential-mutation-tests');

const WINDOWS_EVIDENCE_NOT_EXECUTED = 'NOT_EXECUTED_WINDOWS_REQUIRED';
const WINDOWS_EVIDENCE_GAP = 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_REAL_MACHINE_EVIDENCE_NOT_EXECUTED';
const WINDOWS_EVIDENCE_FINAL_PACKAGING_BLOCKER = 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_REAL_MACHINE_EVIDENCE_REQUIRED';

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.resolve(process.env.WP4_EVIDENCE_DIR || path.join(ROOT, 'evidence', 'wp4'));

function git(...args) {
  const result = childProcess.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr || `git ${args.join(' ')} failed`), { reasonCode: 'WP4_EVIDENCE_GIT_IDENTITY_FAILED' });
  return result.stdout.trim();
}
function write(name, value) { fs.mkdirSync(OUTPUT, { recursive: true }); fs.writeFileSync(path.join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function phase(name, detail = '') { process.stderr.write(`[wp4-evidence] ${name}${detail ? ` ${detail}` : ''}\n`); }
async function runPhase(name, operation) {
  phase(`${name}:start`);
  const startedAt = Date.now();
  const value = await operation();
  phase(`${name}:pass`, `${Date.now() - startedAt}ms`);
  return value;
}
function readJson(relative) { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')); }

function parseCollectorOutput(result, outputFile) {
  if (fs.existsSync(outputFile)) return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch (_) {}
  }
  return null;
}

function classifyWindowsCollectorExecution(result, value) {
  const exitCode = result?.status;
  const signal = result?.signal || '';
  if (result?.error || signal || !Number.isInteger(exitCode)) {
    const error = new Error('Windows owner process identity collector did not exit normally');
    error.reasonCode = 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_COLLECTOR_INVALID_EXECUTION';
    error.collector = { exitCode, signal, spawnError: result?.error?.message || '' };
    throw error;
  }
  if (exitCode === 0 && value?.status === 'PASS') return { ...value, exitCode, collectorExecutionValid: true };
  if (exitCode === 2 && value?.status === WINDOWS_EVIDENCE_NOT_EXECUTED) return { ...value, exitCode, collectorExecutionValid: true };
  const error = new Error('Windows owner process identity collector returned an unexpected result');
  error.reasonCode = 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_COLLECTOR_FAILED';
  error.collector = { exitCode, value: value || null };
  throw error;
}

function collectWindowsOwnerProcessIdentityEvidence(options = {}) {
  const root = path.resolve(options.root || path.join(OUTPUT, 'windows-owner-process-identity'));
  const outputFile = path.resolve(options.outputFile || path.join(OUTPUT, 'windows-owner-process-identity.json'));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const result = childProcess.spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'wp4', 'windows-owner-process-identity-evidence.js'),
    '--live', root, outputFile
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1' },
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180000
  });
  const value = parseCollectorOutput(result, outputFile);
  return classifyWindowsCollectorExecution(result, value);
}

function windowsEvidenceGovernance(value) {
  if (value?.status === 'PASS') return { knownGaps: [], finalPackagingBlockers: [] };
  if (value?.status !== WINDOWS_EVIDENCE_NOT_EXECUTED) {
    const error = new Error('Windows owner process identity evidence status is not acceptable');
    error.reasonCode = 'WP4_WINDOWS_OWNER_PROCESS_IDENTITY_EVIDENCE_STATUS_INVALID';
    throw error;
  }
  return {
    knownGaps: [{ reasonCode: WINDOWS_EVIDENCE_GAP, status: WINDOWS_EVIDENCE_NOT_EXECUTED }],
    finalPackagingBlockers: [{ reasonCode: WINDOWS_EVIDENCE_FINAL_PACKAGING_BLOCKER, status: WINDOWS_EVIDENCE_NOT_EXECUTED }]
  };
}

function mutationOracleExecution() {
  const id = String(process.env.WP4_MUTATION_ORACLE_ID || '');
  if (!id) return null;
  let tests;
  try { tests = JSON.parse(process.env.WP4_MUTATION_ORACLE_TESTS || '[]'); } catch (_) { tests = []; }
  const matrixType = String(process.env.WP4_MUTATION_ORACLE_MATRIX || 'TRANSACTION');
  const matrixScript = matrixType === 'LIFECYCLE' ? 'tools/wp4/credential-authority-lifecycle-matrix.js'
    : matrixType === 'OWNER' ? 'tools/wp4/backend-owner-exit-probe.js'
      : matrixType === 'F16' ? 'tools/wp4/credential-f16-fault-matrix.js'
        : matrixType === 'APPLICATION' ? 'tools/wp4/desktop-credential-application-lifecycle-matrix.js'
          : matrixType === 'APPLICATION_CONVERGENCE' ? 'tools/wp4/desktop-credential-application-convergence-matrix.js'
            : matrixType === 'CONTAINMENT' ? 'tools/wp4/desktop-credential-containment-journal-fault-matrix.js'
              : matrixType === 'START_HANDSHAKE' ? 'tools/wp4/desktop-credential-start-handshake-containment-matrix.js'
                : matrixType === 'HARNESS' ? 'tools/wp4/mutation-harness-classification-probe.js'
              : 'tools/wp4/credential-architecture-fault-matrix.js';
  const run = (args, timeout) => childProcess.spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WP4_MUTATION_ORACLE_ID: '', WP4_MUTATION_TARGET: id, NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1' }, maxBuffer: 30 * 1024 * 1024, timeout });
  const required = run(['--test', ...tests], 300000);
  if (required.status !== 0) throw Object.assign(new Error(`Mutation evidence required-test oracle rejected ${id}`), { reasonCode: 'WP4_MUTATION_EVIDENCE_REQUIRED_TEST_FAILED', oracle: { id, exitCode: required.status, outputTail: `${required.stdout || ''}
${required.stderr || ''}`.slice(-6000) } });
  const matrix = run([matrixScript], 480000);
  if (matrix.status !== 0) throw Object.assign(new Error(`Mutation evidence fault-matrix oracle rejected ${id}`), { reasonCode: 'WP4_MUTATION_EVIDENCE_FAULT_MATRIX_FAILED', oracle: { id, exitCode: matrix.status, outputTail: `${matrix.stdout || ''}
${matrix.stderr || ''}`.slice(-6000) } });
  return { status: 'PASS', id, tests, matrixScript, secretValueRecorded: false, secretHashRecorded: false };
}

function parseNodeTestSummary(text) {
  const number = label => {
    const match = String(text || '').match(new RegExp(`(?:^|\\n)(?:#|ℹ)\\s*${label}\\s+(\\d+)\\s*(?:\\r?\\n|$)`, 'i'));
    return Number(match?.[1] || 0);
  };
  return { tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped') };
}
function requiredWp4TestFiles() {
  return fs.readdirSync(path.join(ROOT, 'tests', 'wp4'))
    .filter(name => name.endsWith('.test.js'))
    .sort()
    .map(name => path.join('tests', 'wp4', name));
}
function testSuite() {
  const testFiles = requiredWp4TestFiles();
  const result = childProcess.spawnSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=2',
    ...testFiles
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1' },
    maxBuffer: 40 * 1024 * 1024,
    timeout: 900000
  });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const summary = parseNodeTestSummary(text);
  return {
    status: !result.error && !result.signal && result.status === 0 && summary.fail === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    signal: result.signal || '',
    spawnError: result.error?.message || '',
    fileCount: testFiles.length,
    ...summary,
    outputTail: text.slice(-16000)
  };
}

function productionJavaScriptFiles() {
  const files = [];
  const visit = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) visit(absolute); else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute); } };
  for (const root of ['backend', 'electron', 'shared']) visit(path.join(ROOT, root));
  return files;
}
function directCredentialVaultMutations() {
  const allowed = new Set([path.join(ROOT, 'electron', 'credentialVault.js'), path.join(ROOT, 'electron', 'desktopHost', 'CredentialVaultHost.js')]);
  const expressions = [
    /\b(?:vault|credentialVault|destinationVault)\s*\.\s*(?:set|remove|reset|replaceRaw)\s*\(/g,
    /\b(?:vault|credentialVault|destinationVault)\s*\[['"](?:set|remove|reset|replaceRaw)['"]\]\s*\(/g
  ];
  const matches = [];
  for (const file of productionJavaScriptFiles()) {
    if (allowed.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const expression of expressions) for (const match of text.matchAll(expression)) matches.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: text.slice(0, match.index).split('\n').length, expression: match[0] });
  }
  return matches;
}
function architectureAudit() {
  const invariants = readJson('docs/wp4/credential-invariants.json');
  const machine = readJson('docs/wp4/credential-transaction-state-machine.json');
  const architecture = fs.readFileSync(path.join(ROOT, 'docs/wp4/credential-authority-architecture.md'), 'utf8');
  const authorityLifecycle = readJson('docs/wp4/credential-authority-lifecycle-state-machine.json');
  const migrationLifecycle = readJson('docs/wp4/credential-migration-state-machine.json');
  const ownerLifecycle = readJson('docs/wp4/backend-owner-session-lifecycle.json');
  const applicationLifecycle = readJson('docs/wp4/desktop-credential-application-lifecycle-state-machine.json');
  const requiredStateFields = ['allowedInputs', 'allowedNextStates', 'diskState', 'vaultState', 'metadataState', 'runtimeState', 'backendMayContinueRunning', 'allowsNewTransactions', 'recovery'];
  const stateNames = Object.values(STATES);
  const stateFieldFailures = [];
  const transitionFailures = [];
  for (const state of stateNames) {
    const row = machine.states?.[state];
    for (const field of requiredStateFields) if (!row || !(field in row)) stateFieldFailures.push(`${state}.${field}`);
    const documented = new Set(row?.allowedNextStates || []);
    const implemented = TRANSITIONS[state] || new Set();
    if ([...documented].sort().join('|') !== [...implemented].sort().join('|')) transitionFailures.push({ state, documented: [...documented], implemented: [...implemented] });
  }
  const authorityStateFieldFailures = [];
  const authorityTransitionFailures = [];
  const authorityRequiredFields = ['allowedDiskFiles','vaultState','journalState','metadataState','desktopHostConstructionAllowed','fd5Allowed','fd6Allowed','backendStartAllowed','crashRecovery','allowedNextStates'];
  for (const state of Object.values(AUTHORITY_STATES)) {
    const row = authorityLifecycle.states?.[state];
    for (const field of authorityRequiredFields) if (!row || !(field in row)) authorityStateFieldFailures.push(`${state}.${field}`);
    const documented = new Set(row?.allowedNextStates || []);
    const implemented = AUTHORITY_TRANSITIONS[state] || new Set();
    if ([...documented].sort().join('|') !== [...implemented].sort().join('|')) authorityTransitionFailures.push({ state, documented: [...documented], implemented: [...implemented] });
  }
  const lifecycleDocumentFailures = [];
  if (!migrationLifecycle.states?.STRICT_READ || !migrationLifecycle.states?.COMPLETED || !migrationLifecycle.states?.FAIL_CLOSED) lifecycleDocumentFailures.push('WP3_MIGRATION_LIFECYCLE_INCOMPLETE');
  if (!Array.isArray(ownerLifecycle.identityFields) || !ownerLifecycle.identityFields.includes('startupNonce') || !ownerLifecycle.identityFields.includes('fd6PipeInstanceId') || !ownerLifecycle.states?.OWNER_EXIT_RECOVERY) lifecycleDocumentFailures.push('BACKEND_OWNER_LIFECYCLE_INCOMPLETE');

  const applicationTransitionFailures = [];
  const applicationStateFieldFailures = [];
  const applicationRequiredFields = ['allowedNextStates', 'owner', 'fd6', 'mutation', 'uiSuccess', 'recovery'];
  for (const state of Object.values(APPLICATION_STATES)) {
    const row = applicationLifecycle.states?.[state];
    for (const field of applicationRequiredFields) if (!row || !(field in row)) applicationStateFieldFailures.push(`${state}.${field}`);
    const documented = new Set(row?.allowedNextStates || []);
    const implemented = APPLICATION_TRANSITIONS[state] || new Set();
    if ([...documented].sort().join('|') !== [...implemented].sort().join('|')) applicationTransitionFailures.push({ state, documented: [...documented], implemented: [...implemented] });
  }

  const invariantIds = new Set((invariants.invariants || []).map(row => row.id));
  const requiredInvariantIds = new Set(Array.from({ length: 10 }, (_, index) => `I${index + 1}`));
  const missingInvariants = [...requiredInvariantIds].filter(id => !invariantIds.has(id));
  const architectureTerms = ['Vault authority', 'Generation authority', 'Transaction authority', 'Runtime authority', 'FD5', 'FD6', 'requestId', 'fail closed', 'Strict decrypt', 'SQLite', 'AppRuntime', 'SecureBridge'];
  const missingArchitectureTerms = architectureTerms.filter(term => !architecture.toLowerCase().includes(term.toLowerCase()));
  const directVaultMutations = directCredentialVaultMutations();
  const result = {
    status: !stateFieldFailures.length && !transitionFailures.length && !authorityStateFieldFailures.length && !authorityTransitionFailures.length && !applicationStateFieldFailures.length && !applicationTransitionFailures.length && !lifecycleDocumentFailures.length && !missingInvariants.length && !missingArchitectureTerms.length && !directVaultMutations.length ? 'PASS' : 'FAIL',
    authorityModel: machine.authorityModel,
    stateCount: stateNames.length,
    invariantCount: invariantIds.size,
    stateFieldFailures, transitionFailures, authorityStateFieldFailures, authorityTransitionFailures, lifecycleDocumentFailures, missingInvariants, missingArchitectureTerms, directVaultMutations,
    reviewedProductionModules: [
      'electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js', 'shared/credentialAuthorityLifecycleStateMachine.js', 'electron/desktopHost/CredentialVaultHost.js', 'electron/credentialVault.js', 'backend/services/credentialCustodyClient.js',
      'shared/credentialCustodyProtocol.js', 'electron/desktopHost/BackendProcessHost.js', 'electron/desktopHost/DesktopHost.js',
      'electron/main.js', 'backend/bootstrap/credentialHydrationPipe.js', 'backend/runtime/RuntimeStateStore.js',
      'backend/runtime/AppRuntime.js', 'backend/services/secureBridge.js', 'tools/wp4/generate-evidence.js'
    ]
  };
  if (result.status !== 'PASS') throw Object.assign(new Error('WP4 credential architecture audit failed'), { reasonCode: 'WP4_CREDENTIAL_ARCHITECTURE_AUDIT_FAILED', architectureAudit: result });
  return { result, invariants, machine, authorityLifecycle, migrationLifecycle, ownerLifecycle, applicationLifecycle };
}
function rejectedOwnerContainmentEvidence(matrix) {
  const value = matrix?.containmentProbes || {};
  const probes = value.probes || {};
  const requiredNames = [
    'rejectedReadyOwnerStopFailure',
    'rejectedRuntimeProjectionOwnerStopFailure',
    'rejectedOwnerFd6Containment',
    'rejectedOwnerAlreadyReadyBypass',
    'rejectedOwnerEventualExitRecovery'
  ];
  const failures = [];
  for (const name of requiredNames) if (!probes[name]) failures.push(`${name}-missing`);
  const ready = probes.rejectedReadyOwnerStopFailure?.generationMismatch;
  if (ready) {
    if (ready.childStillLive !== true) failures.push('rejected-ready-owner-not-live');
    if (ready.applicationFenceActive !== true) failures.push('rejected-ready-owner-fence-released');
    if (ready.fd6Closed !== true) failures.push('rejected-ready-owner-fd6-open');
    if (ready.coordinatorFinalState !== 'FATAL_OWNER_CONTAINMENT') failures.push('rejected-ready-owner-not-fatal-contained');
    if (ready.cleanupStopResult?.stopped === true || ready.cleanupStopResult?.exitConfirmed === true) failures.push('rejected-ready-owner-stop-result-invalid');
  }
  const runtime = probes.rejectedRuntimeProjectionOwnerStopFailure?.runtimeProjectionMismatch;
  if (runtime) {
    if (runtime.childStillLive !== true) failures.push('rejected-runtime-owner-not-live');
    if (runtime.applicationFenceActive !== true) failures.push('rejected-runtime-owner-fence-released');
    if (runtime.coordinatorFinalState !== 'FATAL_OWNER_CONTAINMENT') failures.push('rejected-runtime-owner-not-fatal-contained');
  }
  const fd6 = probes.rejectedOwnerFd6Containment;
  if (fd6) {
    if (fd6.prepareResult?.accepted !== false) failures.push('rejected-owner-fd6-prepare-accepted');
    if (fd6.commitResult?.accepted !== false) failures.push('rejected-owner-fd6-commit-accepted');
    if (!fd6.applicationFence) failures.push('rejected-owner-fd6-fence-missing');
    if (fd6.coordinatorFinalState !== 'FATAL_OWNER_CONTAINMENT') failures.push('rejected-owner-fd6-state-invalid');
  }
  const bypass = probes.rejectedOwnerAlreadyReadyBypass;
  if (bypass) {
    if (bypass.containedOwnerAlreadyReadyResult?.accepted !== false) failures.push('rejected-owner-already-ready-accepted');
    if (bypass.normalAlreadyReadyProjectionResult?.accepted !== false) failures.push('already-ready-projection-bypass-accepted');
    if (bypass.coordinatorFinalState !== 'FATAL_OWNER_CONTAINMENT') failures.push('rejected-owner-already-ready-state-invalid');
  }
  const recovery = probes.rejectedOwnerEventualExitRecovery;
  if (recovery) {
    if (recovery.beforeExit?.applicationFenceActive !== true || recovery.beforeExit?.childStillLive !== true) failures.push('eventual-exit-before-state-invalid');
    if (recovery.afterExit?.applicationFenceActive !== false || recovery.afterExit?.containmentActive !== false) failures.push('eventual-exit-fence-not-released');
    if (recovery.afterExit?.ownershipPresent !== false || Number(recovery.afterExit?.backendPid || 0) !== 0 || recovery.afterExit?.activeOwnerSession || recovery.afterExit?.pendingOwnerSession) failures.push('eventual-exit-owner-not-released');
    if (recovery.afterExit?.authorityState !== 'ACTIVE' || recovery.afterExit?.authorityAvailable !== true) failures.push('eventual-exit-authority-not-active');
    if (recovery.newOwnerStartResult?.accepted !== true) failures.push('eventual-exit-new-owner-not-started');
    if (recovery.finalState?.coordinatorState !== 'IDLE' || recovery.finalState?.backendRunning !== true) failures.push('eventual-exit-final-state-invalid');
  }
  if (value.status !== 'PASS') failures.push(...(value.failures || []));
  const evidence = {
    schemaVersion: 1,
    status: failures.length ? 'FAIL' : 'PASS',
    failures: [...new Set(failures)],
    ...probes,
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (evidence.status !== 'PASS') {
    throw Object.assign(new Error(`Rejected-owner containment evidence failed: ${evidence.failures.join(', ')}`), {
      reasonCode: 'WP4_REJECTED_OWNER_CONTAINMENT_EVIDENCE_FAILED',
      evidence
    });
  }
  return evidence;
}

function transportClosure() {
  const transport = scanSecretTransports();
  const directVaultMutations = directCredentialVaultMutations();
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  const recovery = fs.readFileSync(path.join(ROOT, 'electron/credentialVaultRecovery.js'), 'utf8');
  const coordinator = fs.readFileSync(path.join(ROOT, 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js'), 'utf8');
  const vaultHost = fs.readFileSync(path.join(ROOT, 'electron/desktopHost/CredentialVaultHost.js'), 'utf8');
  const checks = {
    genericSecretTransportAbsent: transport.status === 'PASS' && transport.genericNodeIpcSecretTransportCount === 0,
    desktopPersistUsesApplicationCoordinator: /desktopCredentialApplicationCoordinator\.applyVaultMutationWithRestart\(operation, key, value, options\)/.test(main) && /vaultHost\.executeDesktopMutation\(/.test(coordinator),
    desktopDeleteUsesApplicationCoordinator: /deleteCredentialFromDesktop/.test(main) && /applyVaultMutationWithRestart\('remove'/.test(main),
    migrationUsesApplicationLease: /credentialVaultHost\.persistFromMigration\(/.test(recovery) && /applicationLeaseToken/.test(recovery),
    applicationLeaseFencesFd6: /WP4_DESKTOP_CREDENTIAL_APPLICATION_BUSY_RETRY/.test(vaultHost) && /_assertApplicationCoordinatorLease/.test(vaultHost),
    noDirectProductionVaultMutation: directVaultMutations.length === 0
  };
  const value = { status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks, directVaultMutations, transport };
  if (value.status !== 'PASS') throw Object.assign(new Error('WP4 credential transport/mutation closure failed'), { reasonCode: 'WP4_CREDENTIAL_MUTATION_BYPASS', closure: value });
  return value;
}

async function main() {
  const mutationOracle = mutationOracleExecution();
  if (mutationOracle) { process.stdout.write(`${JSON.stringify(mutationOracle)}\n`); return; }
  const identity = { head: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'), branch: git('branch', '--show-current'), generatedAtUtc: new Date().toISOString() };
  phase('identity', `${identity.head} ${identity.sourceTree}`);
  const windowsOwnerProcessIdentityEvidence = await runPhase('windows-owner-process-identity-collector', async () => collectWindowsOwnerProcessIdentityEvidence());
  const windowsGovernance = windowsEvidenceGovernance(windowsOwnerProcessIdentityEvidence);
  const suite = await runPhase('required-tests', async () => testSuite());
  if (suite.status !== 'PASS') throw Object.assign(new Error('WP4 required tests failed'), { reasonCode: 'WP4_REQUIRED_TEST_FAILED', suite });
  const architecture = await runPhase('architecture-audit', async () => architectureAudit());
  const closure = await runPhase('transport-closure', async () => transportClosure());
  const production = await runPhase('production-chain', () => runProductionCredentialScenario());
  const transaction = await runPhase('transaction-failure-probes', () => runTransactionFailureProbes());
  const authorityClosure = await runPhase('authority-closure-probes', () => runCredentialAuthorityClosureProbes());
  const secureBridge = await runPhase('secure-bridge-failure-probe', () => runSecureBridgeFailureProbe());
  const ownerExit = await runPhase('owner-exit-matrix', () => runBackendOwnerExitMatrix());
  const authorityLifecycleMatrix = await runPhase('authority-lifecycle-matrix', () => runCredentialAuthorityLifecycleMatrix());
  const desktopApplicationLifecycleMatrix = await runPhase('desktop-application-lifecycle-matrix', () => runDesktopCredentialApplicationLifecycleMatrix());
  const containmentJournalMatrix = await runPhase('containment-journal-fault-matrix', () => runDesktopCredentialContainmentJournalFaultMatrix());
  const containmentJournalOrderProbe = await runPhase('containment-journal-order-probe', () => runContainmentJournalOrderProbe());
  const startHandshakeContainmentMatrix = await runPhase('start-handshake-containment-matrix', () => runDesktopCredentialStartHandshakeContainmentMatrix());
  const rejectedOwnerContainment = await runPhase('rejected-owner-containment-evidence', async () => rejectedOwnerContainmentEvidence(desktopApplicationLifecycleMatrix));
  const faultMatrix = await runPhase('transaction-fault-matrix', () => runCredentialArchitectureFaultMatrix({ transaction, closure: authorityClosure, secureBridge, production, ownerExit }));
  const directContainmentIds = new Set(CONTAINMENT_DIRECT_CASES.map(row => row[0]));
  const directContainmentCases = containmentJournalMatrix.cases.filter(row => directContainmentIds.has(row.id));
  const directContainmentMatrix = {
    ...containmentJournalMatrix,
    caseCount: directContainmentCases.length,
    cases: directContainmentCases,
    failedCaseIds: directContainmentCases.filter(row => row.status !== 'PASS').map(row => row.id)
  };
  const completeFaultMatrix = await runPhase('complete-fault-matrix', () => runCredentialCompleteFaultMatrix({ transaction: faultMatrix, authorityLifecycle: authorityLifecycleMatrix, ownerExit, desktopApplicationLifecycle: desktopApplicationLifecycleMatrix, containmentJournal: directContainmentMatrix, startHandshakeContainment: startHandshakeContainmentMatrix }));
  const mutationConcurrency = Math.max(1, Number(process.env.WP4_MUTATION_CONCURRENCY || 1));
  const mutationTests = await runPhase('mutation-tests', () => runCredentialMutationTests({ concurrency: mutationConcurrency }));
  const common = { schemaVersion: 8, stage: '6.4.5.9', workPackage: 'WP4', candidateType: 'WP4_CONVERGENCE_PRE_REVIEW', preReviewOnly: true, finalPackagingAuthorized: false, status: 'PASS', ...identity, secretValueRecorded: false, secretHashRecorded: false };

  const authorityModel = { ...common, architectureAudit: architecture.result, authorityArchitectureDocument: 'docs/wp4/credential-authority-architecture.md', durableAuthority: 'SEALED_AUTHORITY_EVENT_CHAIN', metadataRole: 'VALIDATED_HEAD_PROJECTION_ONLY', transactionRole: 'SEALED_DURABLE_REQUEST_AND_STATE_HISTORY', runtimeRole: 'ATOMIC_SQLITE_APPRUNTIME_SECUREBRIDGE_PROJECTION' };
  const stateMachine = { ...common, ...architecture.machine };
  const authorityLifecycleStateMachine = { ...common, ...architecture.authorityLifecycle };
  const migrationLifecycleStateMachine = { ...common, ...architecture.migrationLifecycle };
  const ownerLifecycleStateMachine = { ...common, ...architecture.ownerLifecycle };
  const applicationLifecycleStateMachine = { ...common, ...architecture.applicationLifecycle };
  const invariantEvidence = { ...common, ...architecture.invariants, provenBy: { requiredTests: suite.pass, faultMatrixCases: completeFaultMatrix.totalCaseCount, transactionFaultMatrixCases: faultMatrix.caseCount, authorityLifecycleCases: authorityLifecycleMatrix.caseCount, ownerExitCases: ownerExit.caseCount, desktopApplicationLifecycleCases: desktopApplicationLifecycleMatrix.caseCount, containmentJournalCases: containmentJournalMatrix.caseCount, startHandshakeContainmentCases: startHandshakeContainmentMatrix.caseCount, mutationTestsKilled: mutationTests.killedCount, productionScenario: production.status } };
  const requiredTests = { ...common, execution: suite };
  const transport = { ...common, ...closure, approvedSecretTransports: production.approvedSecretTransports, dedicatedCredentialPipeCount: production.dedicatedCredentialPipeCount, genericNodeIpcSecretTransportCount: production.genericNodeIpcSecretTransportCount };
  const secret = { ...common, productionFilesScanned: production.scannedFileCount, credentialSecretLeakCount: production.leakCount, scannedRepresentations: ['raw', 'sha256-lower-hex', 'sha256-upper-hex', 'sha256-base64', 'sha256-base64url', 'raw-base64', 'raw-base64url'], productionSecretAndHashesAbsent: production.checks.secretsAndHashesAbsentFromProductionFiles };
  const summary = {
    ...common,
    result: 'PASS',
    requiredTests: { total: suite.tests, passed: suite.pass, failed: suite.fail, skipped: suite.skipped },
    architectureAudit: architecture.result,
    transactionFaultMatrix: { status: faultMatrix.status, caseCount: faultMatrix.caseCount, failedCaseIds: faultMatrix.failedCaseIds },
    authorityLifecycleFaultMatrix: { status: authorityLifecycleMatrix.status, caseCount: authorityLifecycleMatrix.caseCount, failedCaseIds: authorityLifecycleMatrix.failedCaseIds },
    backendOwnerExitMatrix: { status: ownerExit.status, caseCount: ownerExit.caseCount, failedCaseIds: ownerExit.failedCaseIds, f16Synthetic: ownerExit.f16Synthetic },
    desktopCredentialApplicationLifecycleMatrix: { status: desktopApplicationLifecycleMatrix.status, caseCount: desktopApplicationLifecycleMatrix.caseCount, failedCaseIds: desktopApplicationLifecycleMatrix.cases.filter(row => row.status !== 'PASS').map(row => row.id) },
    desktopCredentialContainmentJournalMatrix: { status: containmentJournalMatrix.status, caseCount: containmentJournalMatrix.caseCount, failedCaseIds: containmentJournalMatrix.failedCaseIds },
    desktopCredentialStartHandshakeContainmentMatrix: { status: startHandshakeContainmentMatrix.status, caseCount: startHandshakeContainmentMatrix.caseCount, failedCaseIds: startHandshakeContainmentMatrix.failedCaseIds },
    containmentJournalOrderProbe: { status: containmentJournalOrderProbe.status, coordinatorFinalState: containmentJournalOrderProbe.coordinatorFinalState, authorityBoundaryUnchanged: containmentJournalOrderProbe.authorityBoundaryUnchanged },
    rejectedOwnerContainmentEvidence: { status: rejectedOwnerContainment.status, probeCount: 5, failures: rejectedOwnerContainment.failures },
    completeFaultMatrix: { status: completeFaultMatrix.status, caseCount: completeFaultMatrix.totalCaseCount },
    mutationTests: { status: mutationTests.status, mutationCount: mutationTests.mutationCount, killedCount: mutationTests.killedCount, survivorCount: mutationTests.survivorCount },
    productionCredentialChain: { status: production.status, generationChanges: production.generationChanges, checks: production.checks },
    transactionFailureProbes: { status: transaction.status, probeCount: transaction.probeCount },
    authorityClosureProbes: { status: authorityClosure.status, probeCount: authorityClosure.probeCount },
    secureBridgeFailureProbe: { status: secureBridge.status },
    windowsOwnerProcessIdentityEvidence: {
      status: windowsOwnerProcessIdentityEvidence.status,
      exitCode: windowsOwnerProcessIdentityEvidence.exitCode,
      platform: windowsOwnerProcessIdentityEvidence.platform,
      reasonCode: windowsOwnerProcessIdentityEvidence.reasonCode || '',
      collectorExecutionValid: windowsOwnerProcessIdentityEvidence.collectorExecutionValid === true
    },
    knownGaps: windowsGovernance.knownGaps,
    finalPackaging: { authorized: false, blockers: windowsGovernance.finalPackagingBlockers },
    governance: { wp4Status: 'ACTIVE', wp4Active: true, reviewStatus: 'PENDING_INDEPENDENT_REVIEW', wp5Status: 'BLOCKED_BY_WP4' },
    evidenceFiles: [
      'credential-authority-model.json', 'credential-authority-lifecycle-state-machine.json', 'credential-transaction-state-machine.json', 'credential-migration-lifecycle.json', 'backend-owner-session-lifecycle.json', 'desktop-credential-application-lifecycle-state-machine.json', 'credential-invariants.json',
      'credential-required-tests.json', 'credential-architecture-fault-matrix.json', 'credential-authority-lifecycle-fault-matrix.json', 'backend-owner-exit-matrix.json', 'desktop-credential-application-lifecycle-matrix.json', 'desktop-credential-containment-journal-fault-matrix.json', 'desktop-credential-start-handshake-containment-matrix.json', 'containment-journal-order-probe.json', 'rejected-owner-containment-probes.json', 'credential-complete-fault-matrix.json', 'credential-mutation-tests.json',
      'credential-authority-closure.json', 'credential-production-chain.json', 'credential-transaction-failure-probes.json',
      'credential-transaction-crash-recovery.json', 'credential-concurrent-mutation.json', 'credential-indeterminate-commit.json',
      'credential-transport-closure.json', 'secret-log-scan.json', 'windows-owner-process-identity.json', 'wp4-evidence-summary.json'
    ]
  };

  write('credential-authority-model.json', authorityModel);
  write('credential-authority-lifecycle-state-machine.json', authorityLifecycleStateMachine);
  write('credential-transaction-state-machine.json', stateMachine);
  write('credential-migration-lifecycle.json', migrationLifecycleStateMachine);
  write('backend-owner-session-lifecycle.json', ownerLifecycleStateMachine);
  write('desktop-credential-application-lifecycle-state-machine.json', applicationLifecycleStateMachine);
  write('credential-invariants.json', invariantEvidence);
  write('credential-required-tests.json', requiredTests);
  write('credential-architecture-fault-matrix.json', { ...common, ...faultMatrix });
  write('credential-authority-lifecycle-fault-matrix.json', { ...common, ...authorityLifecycleMatrix });
  write('backend-owner-exit-matrix.json', { ...common, ...ownerExit });
  write('desktop-credential-application-lifecycle-matrix.json', { ...common, ...desktopApplicationLifecycleMatrix });
  write('desktop-credential-containment-journal-fault-matrix.json', { ...common, ...containmentJournalMatrix });
  write('desktop-credential-start-handshake-containment-matrix.json', { ...common, ...startHandshakeContainmentMatrix });
  write('containment-journal-order-probe.json', { ...common, ...containmentJournalOrderProbe });
  write('rejected-owner-containment-probes.json', { ...common, ...rejectedOwnerContainment });
  write('credential-complete-fault-matrix.json', { ...common, ...completeFaultMatrix });
  write('credential-mutation-tests.json', { ...common, ...mutationTests });
  write('credential-authority-closure.json', { ...common, ...authorityClosure });
  write('credential-production-chain.json', { ...common, ...production });
  write('credential-transaction-failure-probes.json', { ...common, ...transaction });
  write('credential-transaction-crash-recovery.json', { ...common, ...transaction.crashRecoveryMatrix });
  write('credential-concurrent-mutation.json', { ...common, ...transaction.concurrencyProbes });
  write('credential-indeterminate-commit.json', { ...common, ...transaction.indeterminateCommitProbes });
  write('credential-transport-closure.json', transport);
  write('secret-log-scan.json', secret);
  write('wp4-evidence-summary.json', summary);
  phase('write-evidence:pass', OUTPUT);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', identity, requiredTests: summary.requiredTests, faultMatrix: summary.completeFaultMatrix, mutationTests: summary.mutationTests, outputDirectory: OUTPUT })}\n`);
}

function reportFailure(error) {
  const reasonCode = error.reasonCode || error.code || 'WP4_EVIDENCE_GENERATION_FAILED';
  process.stderr.write(`${reasonCode} ${error.stack || error.message}\n`);
  for (const field of ['suite', 'architectureAudit', 'closure', 'matrix', 'results', 'collector']) if (error[field]) process.stderr.write(`${JSON.stringify({ [field]: error[field] })}\n`);
  process.exit(1);
}

module.exports = {
  WINDOWS_EVIDENCE_NOT_EXECUTED,
  classifyWindowsCollectorExecution,
  collectWindowsOwnerProcessIdentityEvidence,
  windowsEvidenceGovernance,
  parseNodeTestSummary,
  requiredWp4TestFiles,
  testSuite
};

if (require.main === module) main().catch(reportFailure);
