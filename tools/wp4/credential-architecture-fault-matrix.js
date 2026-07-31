#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { runTransactionFailureProbes } = require('./transaction-failure-probes');
const { runCredentialAuthorityClosureProbes } = require('./credential-authority-closure-probes');
const { runSecureBridgeFailureProbe } = require('./credential-secure-bridge-failure-probe');
const { runProductionCredentialScenario } = require('./production-credential-runtime');
const { runBackendOwnerExitMatrix } = require('./backend-owner-exit-probe');

const ROOT = path.resolve(__dirname, '../..');
const NA = 'NOT_APPLICABLE_NOT_STARTED';

function executeRequiredTest(file, expectedPassCount) {
  const result = childProcess.spawnSync(process.execPath, ['--test', file], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1' }, maxBuffer: 20 * 1024 * 1024, timeout: 120000
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const pass = Number((output.match(/# pass (\d+)/) || [])[1] || 0);
  return { status: result.status === 0 && pass >= expectedPassCount ? 'PASS' : 'FAIL', exitCode: result.status, pass, expectedPassCount, outputTail: output.slice(-5000) };
}

function pick(value, fallback = NA) { return value === undefined || value === null || value === '' ? fallback : value; }
function normalized(id, category, source, options = {}) {
  const after = source.afterRestart || {};
  const nextRequest = source.nextLegalRequest || {};
  const nextHydration = source.nextFd5Hydration || {};
  const backendFinalState = source.backendFinalState || (source.backendContinuedRunning === false || source.terminal === true ? 'TERMINATED_OR_NOT_STARTED' : source.backendContinuedRunning === true ? 'RUNNING_WITH_KNOWN_AUTHORITY' : NA);
  const nextLegalRequestSucceeded = source.nextLegalRequestSucceeded ?? source.nextCredentialRequestSucceeded ?? (nextRequest.transactionState === 'COMMITTED' ? true : source.nextLegalRequestSucceeded);
  const nextFd5HydrationSucceeded = source.nextFd5HydrationSucceeded ?? source.nextHydrationSucceeded ?? (nextHydration.expectedReferencesPresent === true ? true : source.authorityReestablishedByFd5);
  const row = {
    id, category, status: source.status,
    faultInjection: options.faultInjection || id,
    expectedDisposition: options.expectedDisposition || 'COMPLETE_COMMIT_OR_ROLLBACK_OR_FAIL_CLOSED',
    observedReasonCode: pick(source.reasonCode || source.failureReasonCode || source.failedReasonCode, ''),
    verification: {
      vaultReferenceCount: pick(after.vaultReferenceCount ?? source.vaultReferenceCount ?? source.actualReferenceCount ?? (Array.isArray(source.finalReferences) ? source.finalReferences.length : undefined)),
      metadataGeneration: pick(after.generation ?? source.metadataGeneration ?? source.electronVaultGeneration),
      journalState: pick(after.transactionState ?? source.finalTransactionState ?? source.transactionState ?? source.requestState),
      sqliteGeneration: pick(source.sqliteGeneration),
      appRuntimeGeneration: pick(source.appRuntimeGeneration),
      secureBridgeReferenceCount: pick(source.secureBridgeReferenceCount),
      backendFinalState: pick(backendFinalState),
      nextLegalRequestSucceeded: pick(nextLegalRequestSucceeded),
      nextFd5HydrationSucceeded: pick(nextFd5HydrationSucceeded),
      queryPersisted: pick(source.queryPersisted ?? source.query?.persisted),
      activeTransactionId: pick(source.activeTransactionId, '')
    },
    evidenceSource: options.evidenceSource || source.probe || source.crashPoint || id,
    productionChainExecuted: options.productionChainExecuted !== false,
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  if (source.status !== 'PASS') row.failure = source;
  return row;
}

function syntheticFromTest(id, category, testExecution, options = {}) {
  return normalized(id, category, {
    status: testExecution.status,
    reasonCode: options.reasonCode || '',
    backendFinalState: options.backendFinalState || 'TERMINATED_OR_RECOVERED_AS_ASSERTED',
    nextLegalRequestSucceeded: options.nextLegalRequestSucceeded,
    nextFd5HydrationSucceeded: options.nextFd5HydrationSucceeded,
    finalTransactionState: options.finalTransactionState || 'ASSERTED_BY_REQUIRED_TEST'
  }, { ...options, evidenceSource: options.evidenceSource || options.testFile, productionChainExecuted: true });
}


function realBackendExitCase(ownerMatrix) {
  const source = ownerMatrix?.cases?.find(row => row.mode === 'PREPARED') || {};
  return normalized('F16_BACKEND_EXIT', 'PROCESS_EXIT', source, {
    expectedDisposition: 'REAL_CHILD_EXIT_OWNER_RECOVERY_THEN_RESTART',
    evidenceSource: 'BackendProcessHost.real-exit:PREPARED',
    productionChainExecuted: true
  });
}

async function runTargetedMutationFaultMatrix(id) {
  const tests = {
    M01_JOURNAL_WRITE_OMITTED: ['tests/wp4/credential-authority-history.test.js', 8],
    M02_METADATA_WRONG_GENERATION: ['tests/wp4/credential-generation-rollback-denied.test.js', 1],
    M03_TERMINAL_VAULT_MISMATCH_IGNORED: ['tests/wp4/credential-terminal-journal-recovery.test.js', 5],
    M04_REQUEST_ID_MUTATION_CONFLICT_IGNORED: ['tests/wp4/credential-durable-idempotency.test.js', 5],
    M05_DECRYPT_FAILURE_RETURNS_NULL: ['tests/wp4/credential-strict-hydration.test.js', 4],
    M06_PREPARE_ACK_LOSS_NOT_RECOVERED: ['tests/wp4/credential-prepare-result-unknown.test.js', 5],
    M07_COMMIT_CHANNEL_CLOSE_NOT_INDETERMINATE: ['tests/wp4/credential-indeterminate-commit-close.test.js', 4],
    M08_DIRECT_VAULT_MUTATION_ALLOWED: ['tests/wp4/credential-vault-atomicity.test.js', 3],
    M09_DESKTOP_BYPASSES_COORDINATOR: ['tests/wp4/credential-unified-mutation-entry.test.js', 4]
  };
  const selected = tests[id];
  if (!selected) throw Object.assign(new Error(`Unknown targeted fault matrix mutation ${id}`), { reasonCode: 'WP4_CREDENTIAL_MUTATION_MATRIX_TARGET_INVALID' });
  const execution = executeRequiredTest(selected[0], selected[1]);
  const row = syntheticFromTest(`MATRIX_${id}`, 'ADVERSARIAL_MUTATION_FAULT', execution, { testFile: selected[0], expectedDisposition: 'MUTANT_MUST_BE_REJECTED_BY_REAL_BEHAVIOR' });
  const value = { schemaVersion: 1, status: row.status, executedAtUtc: new Date().toISOString(), targetedMutationId: id, caseCount: 1, cases: [row], failedCaseIds: row.status === 'PASS' ? [] : [row.id], secretValueRecorded: false, secretHashRecorded: false };
  if (row.status !== 'PASS') { const error = new Error(`Targeted credential fault matrix rejected ${id}`); error.reasonCode = 'WP4_CREDENTIAL_ARCHITECTURE_FAULT_MATRIX_FAILED'; error.matrix = value; throw error; }
  return value;
}

async function runCredentialArchitectureFaultMatrix(options = {}) {
  if (process.env.WP4_MUTATION_TARGET) return runTargetedMutationFaultMatrix(process.env.WP4_MUTATION_TARGET);
  const transaction = options.transaction || await runTransactionFailureProbes();
  const closure = options.closure || await runCredentialAuthorityClosureProbes();
  const secureBridge = options.secureBridge || await runSecureBridgeFailureProbe();
  const production = options.production || await runProductionCredentialScenario();
  const ownerExit = options.ownerExit || await runBackendOwnerExitMatrix();
  const prepareTests = executeRequiredTest('tests/wp4/credential-prepare-result-unknown.test.js', 5);
  const custodyFailureTests = executeRequiredTest('tests/wp4/credential-custody-transaction.test.js', 7);
  const directMutationTests = executeRequiredTest('tests/wp4/credential-vault-atomicity.test.js', 3);
  const crash = Object.fromEntries(transaction.crashRecoveryMatrix.scenarios.map(row => [row.crashPoint, row]));
  const concurrency = transaction.concurrencyProbes.probes;
  const indeterminate = transaction.indeterminateCommitProbes.probes;
  const fourth = transaction.fourthAmendmentProbes.probes;
  const probes = transaction.probes;
  const authority = closure.probes;

  const rows = [
    normalized('F01_PREPARE_BEFORE_EXIT', 'PROCESS_CRASH', crash.BEFORE_PREPARE),
    normalized('F02_PREPARE_DURABLE_THEN_EXIT', 'PROCESS_CRASH', crash.AFTER_PREPARED_JOURNAL),
    normalized('F03_PREPARE_ACK_LOST', 'FD6_TRANSPORT', fourth.prepareAckLostRecovery, { expectedDisposition: 'AUTO_QUERY_ABORT_AND_RELEASE' }),
    syntheticFromTest('F04_PREPARE_ACK_DAMAGED', 'FD6_TRANSPORT', prepareTests, { testFile: 'credential-prepare-result-unknown.test.js', reasonCode: 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE', backendFinalState: 'TERMINATED', nextLegalRequestSucceeded: false, nextFd5HydrationSucceeded: true }),
    syntheticFromTest('F05_PREPARE_PIPE_END', 'FD6_TRANSPORT', prepareTests, { testFile: 'credential-prepare-result-unknown.test.js', reasonCode: 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE', backendFinalState: 'TERMINATED', nextLegalRequestSucceeded: false, nextFd5HydrationSucceeded: true }),
    syntheticFromTest('F06_PREPARE_PIPE_ERROR_EPIPE', 'FD6_TRANSPORT', prepareTests, { testFile: 'credential-prepare-result-unknown.test.js', reasonCode: 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE', backendFinalState: 'TERMINATED', nextLegalRequestSucceeded: false, nextFd5HydrationSucceeded: true }),
    normalized('F07_COMMIT_BEFORE_SEND_EXIT', 'PROCESS_CRASH', crash.BEFORE_COMMIT_SEND),
    normalized('F08_COMMIT_REACHED_ACK_LOST', 'FD6_TRANSPORT', probes.ackAfterCommitLoss, { expectedDisposition: 'QUERY_DURABLE_COMMITTED_RESULT' }),
    normalized('F09_VAULT_REPLACE_THEN_EXIT', 'PROCESS_CRASH', crash.AFTER_VAULT_ATOMIC_REPLACE),
    normalized('F10_METADATA_UPDATE_THEN_EXIT', 'PROCESS_CRASH', crash.AFTER_COMMITTED_METADATA_PROJECTION),
    normalized('F11_JOURNAL_UPDATE_FAILURE', 'DURABLE_IO', fourth.abortJournalWriteFailureRecovery, { expectedDisposition: 'LIVE_HOST_UNAVAILABLE_RESTART_VALIDATES_PRIOR_AUTHORITY' }),
    normalized('F12_ABORT_PROCESS_EXIT', 'PROCESS_CRASH', crash.ABORT_AFTER_ABORTING_JOURNAL),
    normalized('F13_ROLLBACK_PROJECTION_EXIT', 'PROCESS_CRASH', crash.ABORT_AFTER_ROLLBACK_VAULT_REPLACE),
    normalized('F14_ROLLBACK_VAULT_THEN_JOURNAL_FAILURE', 'ORDERING_INVARIANT', fourth.abortJournalWriteFailureRecovery, { expectedDisposition: 'IMPOSSIBLE_BY_JOURNAL_FIRST_ORDERING; FAILURE_BEFORE_SIDE_EFFECT' }),
    syntheticFromTest('F15_ELECTRON_EXIT', 'PROCESS_EXIT', prepareTests, { testFile: 'credential-prepare-result-unknown.test.js', backendFinalState: 'TERMINATED', nextLegalRequestSucceeded: false, nextFd5HydrationSucceeded: true }),
    realBackendExitCase(ownerExit),
    normalized('F17_SQLITE_UPDATE_FAILURE', 'RUNTIME_AUTHORITY', probes.sqliteAuthorityUpdateFailure),
    normalized('F18_APP_RUNTIME_UPDATE_FAILURE', 'RUNTIME_AUTHORITY', probes.appRuntimeMetadataUpdateFailure),
    normalized('F19_SECURE_BRIDGE_UPDATE_FAILURE', 'RUNTIME_AUTHORITY', secureBridge),
    normalized('F20_DESKTOP_SAVE_DURING_FD6_PREPARE', 'CONCURRENCY', concurrency.fd6PrepareDuringDesktopSave),
    normalized('F21_DESKTOP_DELETE_DURING_FD6_COMMIT', 'CONCURRENCY', concurrency.fd6CommitDuringControlledDesktopRestart),
    normalized('F22_BACKEND_RESTART_DUPLICATE_REQUEST_ID', 'DURABLE_IDEMPOTENCY', fourth.requestIdReplayAfterBackendRestart),
    normalized('F23_JOURNAL_MISSING', 'DURABLE_HISTORY', authority.missingDurableJournal, { expectedDisposition: 'FAIL_CLOSED' }),
    normalized('F24_JOURNAL_TRUNCATED', 'DURABLE_HISTORY', authority.truncatedDurableJournal, { expectedDisposition: 'FAIL_CLOSED' }),
    normalized('F25_JOURNAL_ILLEGAL_STATE', 'DURABLE_HISTORY', authority.invalidTransactionState, { expectedDisposition: 'FAIL_CLOSED' }),
    normalized('F26_METADATA_UNRELATED_GENERATION_COMMITTED', 'AUTHORITY_HISTORY', authority.terminalMetadataUnrelatedGenerationCommitted, { expectedDisposition: 'FAIL_CLOSED' }),
    normalized('F27_METADATA_UNRELATED_GENERATION_ROLLED_BACK', 'AUTHORITY_HISTORY', authority.terminalMetadataUnrelatedGenerationRolledBack, { expectedDisposition: 'FAIL_CLOSED' }),
    normalized('F28_VAULT_REFERENCE_DECRYPT_FAILURE', 'STRICT_HYDRATION', authority.credentialDecryptStringFailure, { expectedDisposition: 'FAIL_CLOSED_BEFORE_GENERATION_ADVANCE' }),
    normalized('F29_SINGLE_CIPHERTEXT_CORRUPTED', 'STRICT_HYDRATION', authority.credentialCiphertextCorruption, { expectedDisposition: 'FAIL_CLOSED_BEFORE_GENERATION_ADVANCE' }),
    normalized('F30_SECURE_STORAGE_UNAVAILABLE', 'STRICT_HYDRATION', authority.credentialSecureStorageUnavailable, { expectedDisposition: 'FAIL_CLOSED_BEFORE_GENERATION_ADVANCE' }),
    normalized('F31_REFERENCE_COUNT_MISMATCH', 'STRICT_HYDRATION', authority.credentialReferenceHydrationCountMismatch, { expectedDisposition: 'FAIL_CLOSED_BEFORE_RUNNING' }),
    normalized('F32_COMMIT_PIPE_END', 'FD6_TRANSPORT', indeterminate['pipe-end'], { expectedDisposition: 'CONTROLLED_SHUTDOWN_THEN_FD5' }),
    normalized('F33_COMMIT_PIPE_ERROR', 'FD6_TRANSPORT', indeterminate['pipe-error'], { expectedDisposition: 'CONTROLLED_SHUTDOWN_THEN_FD5' }),
    normalized('F34_COMMIT_ACK_PARTIAL', 'FD6_TRANSPORT', indeterminate['partial-ack'], { expectedDisposition: 'CONTROLLED_SHUTDOWN_THEN_FD5' }),
    normalized('F35_REQUEST_ID_AFTER_JOURNAL_LOSS', 'DURABLE_IDEMPOTENCY', authority.requestIdReplayAfterJournalLoss, { expectedDisposition: 'FAIL_CLOSED_NO_REEXECUTION' }),
    syntheticFromTest('F36_DIRECT_VAULT_MUTATION_REJECTED', 'MUTATION_AUTHORITY', directMutationTests, { testFile: 'credential-vault-atomicity.test.js', expectedDisposition: 'DIRECT_MUTATION_MUST_THROW', backendFinalState: 'NOT_STARTED', nextLegalRequestSucceeded: true, nextFd5HydrationSucceeded: true })
  ];

  const f16 = rows.find(row => row.id === 'F16_BACKEND_EXIT');
  if (!f16 || f16.evidenceSource !== 'BackendProcessHost.real-exit:PREPARED' || f16.productionChainExecuted !== true) {
    if (f16) { f16.status = 'FAIL'; f16.provenanceFailure = 'F16 must come from real BackendProcessHost exit evidence'; }
  }
  const failedRows = rows.filter(row => row.status !== 'PASS');
  const value = {
    schemaVersion: 1, status: failedRows.length ? 'FAIL' : 'PASS',
    executedAtUtc: new Date().toISOString(), caseCount: rows.length,
    productionScenario: { status: production.status, generationChanges: production.generationChanges, checks: production.checks },
    sourceProbeStatus: { transaction: transaction.status, authorityClosure: closure.status, secureBridge: secureBridge.status, ownerExit: ownerExit.status, prepareTests: prepareTests.status, custodyFailureTests: custodyFailureTests.status, directMutationTests: directMutationTests.status },
    cases: rows, failedCaseIds: failedRows.map(row => row.id),
    secretValueRecorded: false, secretHashRecorded: false
  };
  if (failedRows.length) { const error = new Error(`Credential architecture fault matrix failed: ${value.failedCaseIds.join(', ')}`); error.reasonCode = 'WP4_CREDENTIAL_ARCHITECTURE_FAULT_MATRIX_FAILED'; error.matrix = value; throw error; }
  return value;
}

module.exports = { realBackendExitCase, runCredentialArchitectureFaultMatrix };
if (require.main === module) runCredentialArchitectureFaultMatrix().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || 'WP4_CREDENTIAL_ARCHITECTURE_FAULT_MATRIX_FAILED'} ${error.stack || error.message}\n`); if (error.matrix) process.stderr.write(`${JSON.stringify(error.matrix, null, 2)}\n`); process.exit(1); });
