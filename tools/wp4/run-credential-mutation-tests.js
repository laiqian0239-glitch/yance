#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const NODE_MODULES = path.join(ROOT, 'node_modules');
// Mutation workers each launch real backend processes and nested evidence oracles.
// Default to one worker so an infrastructure OOM/SIGKILL cannot be misreported as a surviving mutant.
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.WP4_MUTATION_CONCURRENCY || 1)));

function copyRepository(destination) {
  fs.cpSync(ROOT, destination, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source).replace(/\\/g, '/');
      if (!relative) return true;
      if (relative === '.git' || relative.startsWith('.git/')) return false;
      if (relative === 'node_modules' || relative.startsWith('node_modules/')) return false;
      if (relative.startsWith('evidence/wp4/')) return false;
      return true;
    }
  });
  if (fs.existsSync(NODE_MODULES)) fs.symlinkSync(NODE_MODULES, path.join(destination, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}
function mutateFile(root, relative, find, replace, options = {}) {
  const file = path.join(root, relative);
  const text = fs.readFileSync(file, 'utf8');
  const occurrences = text.split(find).length - 1;
  const expectedOccurrences = Number(options.expectedOccurrences || 1);
  const occurrence = Number(options.occurrence || 1);
  if (occurrences !== expectedOccurrences) throw new Error(`Mutation anchor count for ${relative} must be ${expectedOccurrences}, got ${occurrences}`);
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > occurrences) throw new Error(`Mutation anchor occurrence for ${relative} is invalid: ${occurrence}`);
  let offset = -1;
  let from = 0;
  for (let index = 0; index < occurrence; index += 1) {
    offset = text.indexOf(find, from);
    from = offset + find.length;
  }
  fs.writeFileSync(file, `${text.slice(0, offset)}${replace}${text.slice(offset + find.length)}`, 'utf8');
}
function execute(root, command, args, env = {}, timeout = 360000) {
  const helper = path.join(ROOT, 'tools', 'wp4', 'run-isolated-command.js');
  const payload = {
    command,
    args,
    cwd: root,
    timeoutMs: timeout,
    maxOutputBytes: 30 * 1024 * 1024,
    env: { NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1', ...env }
  };
  const result = childProcess.spawnSync(process.execPath, [helper], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, WP4_ISOLATED_COMMAND: JSON.stringify(payload) },
    maxBuffer: 35 * 1024 * 1024,
    timeout: timeout + 30000
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    return { exitCode: result.status, signal: result.signal || '', timedOut: result.error?.code === 'ETIMEDOUT', outputTail: output.slice(-7000), harnessError: 'isolated-command-helper-failed' };
  }
  let parsed;
  try { parsed = JSON.parse(String(result.stdout || '').trim()); }
  catch (error) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    return { exitCode: 1, signal: '', timedOut: false, outputTail: output.slice(-7000), harnessError: `isolated-command-output-invalid: ${error.message}` };
  }
  const output = `${parsed.stdout || ''}\n${parsed.stderr || ''}`;
  return { exitCode: parsed.exitCode, signal: parsed.signal || '', timedOut: parsed.timedOut === true, outputTail: output.slice(-7000), spawnError: parsed.spawnError || null };
}
function runTests(root, files, env = {}) { return execute(root, process.execPath, ['--test', ...files], env, 300000); }

function appendMutationProgress(progressFile, record) {
  if (!progressFile) return;
  const target = path.resolve(progressFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(record)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function mutationCatalogSha256(mutations = MUTATIONS) {
  return crypto.createHash('sha256').update(JSON.stringify(mutations), 'utf8').digest('hex');
}

function readMutationSourceIdentity(root = ROOT) {
  const runGit = args => childProcess.execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  const commit = runGit(['rev-parse', 'HEAD']);
  const tree = runGit(['rev-parse', 'HEAD^{tree}']);
  const dirty = runGit(['status', '--porcelain', '--untracked-files=no']);
  if (dirty) {
    const error = new Error('Credential mutation source repository must be clean before execution');
    error.reasonCode = 'WP4_CREDENTIAL_MUTATION_SOURCE_DIRTY';
    error.details = { commit, tree, dirtyPaths: dirty.split(/\r?\n/).filter(Boolean) };
    throw error;
  }
  return { commit, tree };
}

function writeFileAtomicDurable(file, content) {
  const target = path.resolve(file);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
    let parentFd;
    try {
      parentFd = fs.openSync(parent, fs.constants.O_RDONLY);
      fs.fsyncSync(parentFd);
    } catch (_) {
      // Some Windows filesystems do not allow opening or syncing directories.
    } finally {
      if (parentFd !== undefined) fs.closeSync(parentFd);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}

function validateMutationCheckpoint(value, options = {}) {
  const mutations = options.mutations || MUTATIONS;
  const sourceIdentity = options.sourceIdentity;
  const catalogSha256 = options.catalogSha256 || mutationCatalogSha256(mutations);
  const fail = (reasonCode, message, details = {}) => {
    const error = new Error(message);
    error.reasonCode = reasonCode;
    error.details = details;
    throw error;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_INVALID', 'Mutation checkpoint must be a JSON object');
  if (value.schemaVersion !== 1) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_SCHEMA_INVALID', 'Mutation checkpoint schemaVersion must be 1', { actual: value.schemaVersion });
  if (!sourceIdentity || value.sourceCommit !== sourceIdentity.commit || value.sourceTree !== sourceIdentity.tree) {
    fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_SOURCE_MISMATCH', 'Mutation checkpoint source Commit/Tree does not match the current source identity', {
      expectedCommit: sourceIdentity?.commit || '', expectedTree: sourceIdentity?.tree || '',
      actualCommit: value.sourceCommit || '', actualTree: value.sourceTree || ''
    });
  }
  if (value.mutationCatalogSha256 !== catalogSha256) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_CATALOG_MISMATCH', 'Mutation checkpoint catalog hash does not match the current mutation definitions', { expected: catalogSha256, actual: value.mutationCatalogSha256 || '' });
  if (value.mutationCount !== mutations.length) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_COUNT_MISMATCH', 'Mutation checkpoint count does not match the current mutation catalog', { expected: mutations.length, actual: value.mutationCount });
  if (!Array.isArray(value.results) || value.results.length > mutations.length) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_RESULTS_INVALID', 'Mutation checkpoint results must be a bounded array');
  value.results.forEach((result, index) => {
    if (!result || typeof result !== 'object' || result.id !== mutations[index].id) {
      fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_SEQUENCE_INVALID', 'Mutation checkpoint must contain an exact contiguous prefix of the current mutation catalog', {
        index, expectedId: mutations[index].id, actualId: result?.id || ''
      });
    }
    if (!['PASS', 'FAIL', 'INVALID'].includes(result.status) || typeof result.killed !== 'boolean') {
      fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_RESULT_INVALID', 'Mutation checkpoint contains an invalid completed result', { index, id: result.id, status: result.status, killed: result.killed });
    }
    if (result.status === 'PASS') {
      const oracleResults = result.oracleResults;
      const requiredOracles = oracleResults && typeof oracleResults === 'object'
        ? Object.values(oracleResults).filter(row => row && row.status !== 'NOT_REQUIRED')
        : [];
      const passShapeValid = result.killed === true
        && result.allRequiredOracleExecutionsValid === true
        && result.allRequiredOraclesKilled === true
        && result.invalidOracleCount === 0
        && result.survivingOracleCount === 0
        && requiredOracles.length > 0
        && requiredOracles.every(row => row.status === 'KILLED' && row.valid === true && row.killed === true)
        && result.secretValueRecorded === false
        && result.secretHashRecorded === false;
      if (!passShapeValid) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_PASS_RESULT_INVALID', 'Mutation checkpoint PASS result does not contain complete valid killed-oracle evidence', { index, id: result.id });
    } else if (!result.harnessError && (!result.oracleResults || typeof result.oracleResults !== 'object')) {
      fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_FAILURE_RESULT_INVALID', 'Mutation checkpoint failure result must retain harness or oracle evidence', { index, id: result.id, status: result.status });
    }
  });
  if (value.completedCount !== value.results.length) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_COMPLETED_COUNT_INVALID', 'Mutation checkpoint completedCount does not match results length', { completedCount: value.completedCount, resultsLength: value.results.length });
  const expectedResultsSha256 = crypto.createHash('sha256').update(JSON.stringify(value.results), 'utf8').digest('hex');
  if (value.resultsSha256 !== expectedResultsSha256) fail('WP4_CREDENTIAL_MUTATION_CHECKPOINT_RESULTS_HASH_MISMATCH', 'Mutation checkpoint result hash does not match the persisted result sequence', { expected: expectedResultsSha256, actual: value.resultsSha256 || '' });
  return { ...value, results: value.results.slice() };
}

function loadMutationCheckpoint(checkpointFile, options = {}) {
  if (!checkpointFile || !fs.existsSync(path.resolve(checkpointFile))) return null;
  let value;
  try { value = JSON.parse(fs.readFileSync(path.resolve(checkpointFile), 'utf8')); }
  catch (cause) {
    const error = new Error(`Mutation checkpoint is not valid JSON: ${cause.message}`);
    error.reasonCode = 'WP4_CREDENTIAL_MUTATION_CHECKPOINT_JSON_INVALID';
    throw error;
  }
  return validateMutationCheckpoint(value, options);
}

function writeMutationCheckpoint(checkpointFile, value) {
  if (!checkpointFile) return;
  writeFileAtomicDurable(checkpointFile, `${JSON.stringify(value, null, 2)}\n`);
}

function checkpointValue({ sourceIdentity, catalogSha256, mutations = MUTATIONS, results, status = 'IN_PROGRESS' }) {
  return {
    schemaVersion: 1,
    status,
    sourceCommit: sourceIdentity.commit,
    sourceTree: sourceIdentity.tree,
    mutationCatalogSha256: catalogSha256,
    mutationCount: mutations.length,
    completedCount: results.length,
    resultsSha256: crypto.createHash('sha256').update(JSON.stringify(results), 'utf8').digest('hex'),
    results,
    updatedAtUtc: new Date().toISOString()
  };
}

function classifyOracleExecution(result, options = {}) {
  if (options.required === false) {
    return { status: 'NOT_REQUIRED', valid: true, killed: true, reasonCode: '' };
  }
  const invalidReasons = [];
  if (!result || typeof result !== 'object') invalidReasons.push('oracle-result-missing');
  else {
    if (result.harnessError) invalidReasons.push('harness-error');
    if (result.spawnError) invalidReasons.push('spawn-error');
    if (result.timedOut === true) invalidReasons.push('timeout');
    if (String(result.signal || '')) invalidReasons.push('signal');
    if (!Number.isInteger(result.exitCode)) invalidReasons.push('exit-code-invalid');
    const output = String(result.outputTail || '');
    if (/WP4_[A-Z0-9_]*MUTATION[A-Z0-9_]*TARGET_INVALID|Unknown targeted (?:fault matrix )?mutation/i.test(output)) invalidReasons.push('oracle-target-invalid');
  }
  if (invalidReasons.length) {
    return {
      status: 'INVALID',
      valid: false,
      killed: false,
      reasonCode: 'WP4_MUTATION_ORACLE_HARNESS_INVALID',
      invalidReasons
    };
  }
  if (result.exitCode === 0) {
    return { status: 'SURVIVED', valid: true, killed: false, reasonCode: 'WP4_MUTATION_ORACLE_DID_NOT_KILL_MUTANT', invalidReasons: [] };
  }
  return { status: 'KILLED', valid: true, killed: true, reasonCode: '', invalidReasons: [] };
}

function matrixScript(mutation) {
  if (mutation.matrix === 'LIFECYCLE') return 'tools/wp4/credential-authority-lifecycle-matrix.js';
  if (mutation.matrix === 'OWNER') return 'tools/wp4/backend-owner-exit-probe.js';
  if (mutation.matrix === 'F16') return 'tools/wp4/credential-f16-fault-matrix.js';
  if (mutation.matrix === 'APPLICATION') return 'tools/wp4/desktop-credential-application-lifecycle-matrix.js';
  if (mutation.matrix === 'APPLICATION_CONVERGENCE') return 'tools/wp4/desktop-credential-application-convergence-matrix.js';
  if (mutation.matrix === 'CONTAINMENT') return 'tools/wp4/desktop-credential-containment-journal-fault-matrix.js';
  if (mutation.matrix === 'START_HANDSHAKE') return 'tools/wp4/desktop-credential-start-handshake-containment-matrix.js';
  if (mutation.matrix === 'HARNESS') return 'tools/wp4/mutation-harness-classification-probe.js';
  return 'tools/wp4/credential-architecture-fault-matrix.js';
}

const MUTATIONS = [
  {
    id: 'M01_JOURNAL_WRITE_OMITTED', invariant: 'I8', description: 'Skip durable authority-journal atomic write.',
    file: 'electron/desktopHost/CredentialVaultHost.js',
    find: '    atomicWriteJson(this.transactionPath, this.journal, this.fs);',
    replace: '    void this.transactionPath; // MUTANT: journal write omitted',
    tests: ['tests/wp4/credential-authority-history.test.js', 'tests/wp4/credential-durable-idempotency.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M02_METADATA_WRONG_GENERATION', invariant: 'I6', description: 'Persist metadata with a generation unrelated to the authority event.',
    file: 'electron/desktopHost/CredentialVaultHost.js',
    find: '    const value = { ...clone(next), updatedAtUtc: this.clock() };',
    replace: '    const value = { ...clone(next), generation: Number(next.generation) + 7, updatedAtUtc: this.clock() }; // MUTANT',
    tests: ['tests/wp4/credential-production-chain.test.js', 'tests/wp4/credential-generation-rollback-denied.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M03_TERMINAL_VAULT_MISMATCH_IGNORED', invariant: 'I2', description: 'Accept terminal authority metadata without the matching vault image.',
    file: 'electron/desktopHost/CredentialVaultHost.js',
    edits: [
      { find: '    if (metadataIsHead && vaultIsHead) return;', replace: '    if (metadataIsHead) return; // MUTANT: head projection ignores vault' },
      { find: "    if (digestRaw(raw) !== head.vaultDigest || referenceCount(raw) !== head.referenceCount) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Vault is not the authority journal head projection');", replace: "    if (false) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'MUTANT'); // MUTANT" }
    ],
    tests: ['tests/wp4/credential-terminal-journal-recovery.test.js', 'tests/wp4/credential-recovery-ambiguous.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M04_REQUEST_ID_MUTATION_CONFLICT_IGNORED', invariant: 'I5', description: 'Reuse requestId without mutation identity verification.',
    file: 'electron/desktopHost/CredentialVaultHost.js',
    find: "    if (tx.mutationSha256 !== request.payload?.mutationSha256 || tx.operation !== request.operation || tx.ref !== request.payload?.ref) throw this._error('CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT', 'requestId was already used for a different credential mutation');",
    replace: "    if (false) throw this._error('CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT', 'MUTANT');",
    tests: ['tests/wp4/credential-durable-idempotency.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M05_DECRYPT_FAILURE_RETURNS_NULL', invariant: 'I7', description: 'Convert an operating-system decrypt failure into a normal missing value.',
    file: 'electron/credentialVault.js',
    find: "    catch (cause) { throw error(DECRYPT_FAILED, 'Credential vault entry decryption failed', { ref: key, cause }); }",
    replace: '    catch (cause) { return null; } // MUTANT: decrypt failure hidden',
    tests: ['tests/wp4/credential-strict-hydration.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M06_PREPARE_ACK_LOSS_NOT_RECOVERED', invariant: 'I1', description: 'Return PREPARE communication error without QUERY or ABORT.',
    file: 'backend/services/credentialCustodyClient.js',
    find: "  async _recoverPrepareOutcome(context, record, originalError) {\n    record.state = 'PREPARE_RESULT_UNKNOWN';",
    replace: "  async _recoverPrepareOutcome(context, record, originalError) {\n    throw originalError; // MUTANT\n    record.state = 'PREPARE_RESULT_UNKNOWN';",
    tests: ['tests/wp4/credential-prepare-result-unknown.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M07_COMMIT_CHANNEL_CLOSE_NOT_INDETERMINATE', invariant: 'I9', description: 'Keep backend operational after an indeterminate COMMIT close.',
    file: 'backend/services/credentialCustodyClient.js',
    find: '    this.terminal = true;', replace: '    this.terminal = false; // MUTANT',
    tests: ['tests/wp4/credential-indeterminate-commit-close.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M08_DIRECT_VAULT_MUTATION_ALLOWED', invariant: 'I10', description: 'Allow direct CredentialVault.set bypass.',
    file: 'electron/credentialVault.js',
    find: "  set() { throw error(DIRECT_MUTATION_FORBIDDEN, 'Direct CredentialVault.set is forbidden'); }",
    replace: '  set() { return true; } // MUTANT',
    tests: ['tests/wp4/credential-vault-atomicity.test.js'], matrix: 'TRANSACTION'
  },
  {
    id: 'M09_DESKTOP_BYPASSES_COORDINATOR', invariant: 'A2', description: 'Commit a desktop mutation without stopping and recovering the old backend owner.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "        await this._stopAndRecover(token, { reason: 'desktop-credential-mutation' });",
    replace: "        void token; // MUTANT: old owner remains live during desktop mutation",
    tests: ['tests/wp4/desktop-credential-application-lifecycle.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M10_WP3_VAULT_TREATED_AS_JOURNAL_MISSING', invariant: 'L1', description: 'Reject a supported WP3 vault instead of entering controlled migration.',
    file: 'electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js',
    find: '      if (vaultExists) {',
    replace: "      if (vaultExists) { throw error(JOURNAL_MISSING, 'MUTANT: legacy vault rejected');",
    tests: ['tests/wp4/credential-authority-lifecycle-production.test.js', 'tests/wp4/credential-recovery-ambiguous.test.js'], matrix: 'LIFECYCLE'
  },
  {
    id: 'M11_GENESIS_FORMAL_VAULT_BEFORE_INTENT', invariant: 'L2', description: 'Write the formal vault before a recoverable bootstrap intent.',
    file: 'electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js',
    find: "      this._crash('GENESIS_BEFORE_ANY_FILE');",
    replace: "      if (typeof this.replaceVault === 'function') this.replaceVault({}); // MUTANT\n      this._crash('GENESIS_BEFORE_ANY_FILE');",
    tests: ['tests/wp4/credential-authority-lifecycle-matrix.test.js'], matrix: 'LIFECYCLE'
  },
  {
    id: 'M12_MIGRATION_COMPLETED_MARKER_OMITTED', invariant: 'L3', description: 'Remove the durable migration completion marker.',
    file: 'electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js',
    find: '    } else this._writeCompleted(marker);',
    replace: "    } else if (!migration) this._writeCompleted(marker); // MUTANT: migration marker omitted",
    tests: ['tests/wp4/credential-authority-lifecycle-production.test.js', 'tests/wp4/credential-authority-lifecycle-matrix.test.js'], matrix: 'LIFECYCLE'
  },
  {
    id: 'M13_MIGRATION_FAILURE_CLEARS_LEGACY_VAULT', invariant: 'L4', description: 'Destroy the WP3 source vault when migration fails.',
    file: 'electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js',
    find: "    } catch (cause) {\n      if (this.lifecycle.state !== STATES.UNAVAILABLE) {",
    replace: "    } catch (cause) {\n      if (this.lifecycle.operationType === 'MIGRATION' && typeof this.replaceVault === 'function') this.replaceVault({}); // MUTANT\n      if (this.lifecycle.state !== STATES.UNAVAILABLE) {",
    tests: ['tests/wp4/credential-authority-lifecycle-matrix.test.js'], matrix: 'LIFECYCLE'
  },
  {
    id: 'M14_BACKEND_EXIT_SKIPS_AUTHORITY_RECOVERY', invariant: 'L5', description: 'Close the old FD6 channel without recovering the owner transaction.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: "      const recoveryPromise = ownerContext && typeof attempt.handleBackendOwnerExit === 'function'",
    replace: "      const recoveryPromise = false && ownerContext && typeof attempt.handleBackendOwnerExit === 'function' // MUTANT",
    tests: ['tests/wp4/backend-owner-exit-recovery.test.js'], matrix: 'OWNER'
  },
  {
    id: 'M15_RESTART_IGNORES_ACTIVE_OWNER_TRANSACTION', invariant: 'L6', description: 'Allow new FD5 while the old owner or transaction is still active.',
    file: 'electron/desktopHost/CredentialVaultHost.js',
    edits: [
      { find: "    if (this.activeOwnerSession) throw this._error('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_ACTIVE', 'A backend owner session is still active; owner-exit recovery must finish before a new FD5 hydration', { retryable: true });", replace: '    if (false) throw new Error(\'MUTANT\');' },
      { find: "    if (this.activeTransactionId || this.pendingOperations > 0) throw this._error(TRANSACTION_BUSY, 'Credential hydration cannot start while a mutation is pending', { retryable: true });", replace: '    if (false) throw new Error(\'MUTANT\');' }
    ],
    tests: ['tests/wp4/backend-owner-exit-recovery.test.js'], matrix: 'OWNER'
  },
  {
    id: 'M16_OWNER_SESSION_BINDS_PID_ONLY', invariant: 'L7', description: 'Treat PID equality as sufficient owner identity.',
    file: 'shared/credentialAuthorityLifecycleStateMachine.js',
    find: "  const fields = ['backendPid', 'startupNonce', 'backendSessionId', 'manifestSha256', 'vaultEpoch', 'hydrationGeneration', 'fd6PipeInstanceId'];",
    replace: "  const fields = ['backendPid']; // MUTANT: PID-only owner identity",
    tests: ['tests/wp4/credential-authority-lifecycle-state-machine.test.js', 'tests/wp4/backend-owner-exit-recovery.test.js'], matrix: 'OWNER'
  },
  {
    id: 'M17_F16_SYNTHETIC_BACKEND_EXIT_PASS', invariant: 'L8', description: 'Replace real F16 child-exit evidence with a synthetic PASS.',
    file: 'tools/wp4/credential-architecture-fault-matrix.js',
    find: "function realBackendExitCase(ownerMatrix) {\n  const source = ownerMatrix?.cases?.find(row => row.mode === 'PREPARED') || {};\n  return normalized('F16_BACKEND_EXIT', 'PROCESS_EXIT', source, {\n    expectedDisposition: 'REAL_CHILD_EXIT_OWNER_RECOVERY_THEN_RESTART',\n    evidenceSource: 'BackendProcessHost.real-exit:PREPARED',\n    productionChainExecuted: true\n  });\n}",
    replace: "function realBackendExitCase() {\n  return normalized('F16_BACKEND_EXIT', 'PROCESS_EXIT', { status: 'PASS', backendFinalState: 'RUNNING_WITH_KNOWN_AUTHORITY', nextLegalRequestSucceeded: true, nextFd5HydrationSucceeded: true }, { evidenceSource: 'syntheticFromTest', productionChainExecuted: true }); // MUTANT\n}",
    tests: ['tests/wp4/backend-owner-exit-recovery.test.js'], matrix: 'F16'
  },
  {
    id: 'M18_APPLICATION_LEASE_OMITTED', invariant: 'A1', description: 'Run desktop replacement without the application-level lease.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '        token = await this._acquireLease(applicationOperation);',
    replace: '        token = null; // MUTANT: application lease omitted',
    tests: ['tests/wp4/desktop-credential-application-lifecycle.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M19_STOP_FAILURE_IGNORED', invariant: 'A3', description: 'Continue replacement after backend stop or exit confirmation failure.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: `    if (result?.stopped !== true || result?.exitConfirmed !== true) {
      this._assertBoundaryUnchanged(before);`,
    replace: `    if (false && (result?.stopped !== true || result?.exitConfirmed !== true)) { // MUTANT
      this._assertBoundaryUnchanged(before);`,
    tests: ['tests/wp4/desktop-credential-application-lifecycle.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M20_READY_FAILURES_IGNORED', invariant: 'A6', description: 'Accept a new backend owner despite FD5, FD6, generation or authority mismatch.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "    if (failures.length) throw makeError(APPLICATION_READY_MISMATCH, 'New backend owner did not satisfy the credential application READY boundary', { failures, backend, authority, expectedAuthority });",
    replace: "    if (false && failures.length) throw makeError(APPLICATION_READY_MISMATCH, 'MUTANT', { failures });",
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M21_READY_GENERATION_UNBOUND', invariant: 'A6', description: 'Remove generation binding between backend, owner session, FD6 and vault authority.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    edits: [
      { find: "    if (Number(backend.credentialGeneration || 0) !== Number(authority.generation || 0)) failures.push('generation-mismatch');", replace: "    void authority.generation; // MUTANT: backend generation unchecked" },
      { find: "      if (Number(owner.hydrationGeneration || 0) !== Number(backend.credentialGeneration || 0)) failures.push('owner-generation-mismatch');", replace: "      void owner.hydrationGeneration; // MUTANT" },
      { find: "      if (Number(custodyOwner.hydrationGeneration || 0) !== Number(backend.credentialGeneration || 0)) failures.push('fd6-owner-generation-mismatch');", replace: "      void custodyOwner.hydrationGeneration; // MUTANT" }
    ],
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M22_READY_AUTHORITY_DIGEST_UNBOUND', invariant: 'A6', description: 'Ignore the authority digest advertised by the new backend owner.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "    if (String(backend.credentialAuthorityHeadDigest || '') !== String(authority.authorityHeadDigest || '')) failures.push('authority-digest-mismatch');",
    replace: "    void backend.credentialAuthorityHeadDigest; // MUTANT: authority digest unchecked",
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M23_IDEMPOTENT_REQUEST_ID_DISCARDED', invariant: 'A5', description: 'Use a fresh requestId when retrying a committed desktop mutation.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: `          requestId,
          mutationSha256: fingerprint,`,
    replace: `          requestId: this.randomUUID(), // MUTANT: durable replay identity discarded
          mutationSha256: fingerprint,`,
    tests: ['tests/wp4/desktop-credential-application-lifecycle.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M24_SHUTDOWN_BEFORE_COMMIT_IGNORED', invariant: 'A4', description: 'Commit a desktop mutation after application shutdown becomes pending.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "        this._assertOperationMayContinue(options, 'before-desktop-mutation-commit');",
    replace: "        void options; // MUTANT: shutdown fence ignored before commit",
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M25_REJECTED_NEW_OWNER_NOT_CLEANED', invariant: 'A7', description: 'Leave a backend running after READY or runtime projection rejection.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: `    } catch (cause) {
      await this._cleanupRejectedNewOwner(token, cause, options);
      throw cause;
    }
    this._transition(STATES.NEW_OWNER_READY, '', {`,
    replace: `    } catch (cause) {
      void token; // MUTANT: rejected owner left running
      throw cause;
    }
    this._transition(STATES.NEW_OWNER_READY, '', {`,
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M26_RUNTIME_PROJECTION_NOT_VALIDATED', invariant: 'A6', description: 'Await the runtime projection but do not compare SQLite, AppRuntime and SecureBridge authority.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '      runtimeProjection = this._assertRuntimeProjection(await this.validateRuntimeProjection({ result, ready, applicationLeaseToken: token }), ready);',
    replace: '      runtimeProjection = await this.validateRuntimeProjection({ result, ready, applicationLeaseToken: token }); // MUTANT: projection unchecked',
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M27_APPLICATION_INTERRUPTION_JOURNAL_IGNORED', invariant: 'A8', description: 'Discard an interrupted committed application operation on coordinator restart.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '      const persistedOperation = clone(parsed.currentOperation || parsed.interruptedOperation || null);',
    replace: '      const persistedOperation = null; // MUTANT: interrupted operation discarded',
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M28_UI_SUCCESS_BEFORE_RUNTIME_PROJECTION', invariant: 'A9', description: 'Return desktop mutation success without awaiting runtime authority convergence.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '      runtimeProjection = this._assertRuntimeProjection(await this.validateRuntimeProjection({ result, ready, applicationLeaseToken: token }), ready);',
    replace: '      this.validateRuntimeProjection({ result, ready, applicationLeaseToken: token }); runtimeProjection = null; // MUTANT: UI may resolve early',
    tests: ['tests/wp4/desktop-credential-application-lifecycle.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION'
  },
  {
    id: 'M29_CLEANUP_FAILURE_RELEASES_APPLICATION_FENCE', invariant: 'A10', description: 'Release the durable application fence after rejected-owner cleanup fails.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "    try { this._persistContainmentSentinel('rejected-owner-still-live'); }\n    catch (cause2) {\n      const failure = this._recordPersistenceFailure('containment-sentinel-still-live', cause2);\n      this.containment.persistenceFailure = failure;\n      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });\n    }\n    return clone(this.containment);",
    replace: "    try { this._persistContainmentSentinel('rejected-owner-still-live'); }\n    catch (cause2) {\n      const failure = this._recordPersistenceFailure('containment-sentinel-still-live', cause2);\n      this.containment.persistenceFailure = failure;\n      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_SENTINEL_WRITE_FAILED', { failure });\n    }\n    this.vaultHost.clearApplicationFence?.({ force: true }); // MUTANT: live rejected owner unfenced\n    return clone(this.containment);",
    tests: ['tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION', completeMatrix: true
  },
  {
    id: 'M30_CLEANUP_FAILURE_LEAVES_FD6_OPEN', invariant: 'A11', description: 'Keep the rejected owner FD6 pipe available after containment.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: "    this.rejectedOwner = Object.freeze({ ...base, apiAuthorityRevoked: true, fd6Closed: false, ownerRecordDurable: false });\n\n    const custody = this.credentialCustodyHost;\n    this.credentialCustodyHost = null;",
    replace: "    this.rejectedOwner = Object.freeze({ ...base, apiAuthorityRevoked: true, fd6Closed: false, ownerRecordDurable: false });\n\n    const custody = this.credentialCustodyHost;\n    void custody; // MUTANT: rejected owner FD6 remains open",
    tests: ['tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION', completeMatrix: true
  },
  {
    id: 'M31_FAILED_SAFE_LIVE_OWNER_RESETS_IDLE', invariant: 'A12', description: 'Allow FAILED_SAFE to reset to IDLE while a backend owner or FD6 remains live.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    edits: [
      { find: "    const containmentRecovery = operationType === 'APPLICATION_SHUTDOWN' || operationType === 'BACKEND_EXIT_RECOVERY' || options.allowContainmentRecovery === true;\n    if (this.isRejectedOwnerContainmentActive() && !containmentRecovery) throw this._containmentError();\n    if (this.lifecycle.state === STATES.FAILED_SAFE && !containmentRecovery) this._assertFailedSafeResettable();", replace: "    const containmentRecovery = operationType === 'APPLICATION_SHUTDOWN' || operationType === 'BACKEND_EXIT_RECOVERY' || options.allowContainmentRecovery === true;\n    if (this.isRejectedOwnerContainmentActive() && !containmentRecovery) throw this._containmentError();\n    void this.lifecycle.state; // MUTANT: FAILED_SAFE reset boundary skipped" },
      { find: "    if ([STATES.FAILED_SAFE, STATES.STOPPED, STATES.NEW_OWNER_READY].includes(this.lifecycle.state)) {\n      if (this.lifecycle.state === STATES.FAILED_SAFE && !containmentRecovery) this._assertFailedSafeResettable();\n      if (!this.isRejectedOwnerContainmentActive()) this._transition(STATES.IDLE, 'operation-begin-reset');\n    }", replace: "    if ([STATES.FAILED_SAFE, STATES.STOPPED, STATES.NEW_OWNER_READY].includes(this.lifecycle.state)) {\n      void containmentRecovery; // MUTANT: live owner may reset to IDLE\n      if (!this.isRejectedOwnerContainmentActive()) this._transition(STATES.IDLE, 'operation-begin-reset');\n    }" }
    ],
    tests: ['tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION', completeMatrix: true
  },
  {
    id: 'M32_ALREADY_READY_SKIPS_RUNTIME_PROJECTION', invariant: 'A13', description: 'Accept an already-running backend without revalidating runtime projections.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '            runtimeProjection = this._assertRuntimeProjection(await this.validateRuntimeProjection({ alreadyReady: true, ready, applicationLeaseToken: token }), ready);',
    replace: '            runtimeProjection = { mutant: true }; // MUTANT: alreadyReady projection skipped',
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION', completeMatrix: true
  },
  {
    id: 'M33_LIVE_REJECTED_OWNER_ALLOWS_FD6_PREPARE', invariant: 'A14', description: 'Allow FD6 PREPARE while a rejected owner remains live.',
    file: 'electron/desktopHost/CredentialVaultHost.js',
    find: '  prepareCustodyTransaction(request = {}) {\n    return this._enqueue(async () => {\n      this._assertApplicationAccess();',
    replace: '  prepareCustodyTransaction(request = {}) {\n    return this._enqueue(async () => {\n      void this.applicationFence; // MUTANT: live rejected owner PREPARE accepted',
    tests: ['tests/wp4/desktop-credential-rejected-owner-containment.test.js', 'tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION', completeMatrix: true
  },
  {
    id: 'M34_CLEANUP_FAILURE_ALLOWS_UI_MUTATION', invariant: 'A15', description: 'Allow desktop UI mutation while rejected-owner containment is active.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '    if (this.isRejectedOwnerContainmentActive() && !containmentRecovery) throw this._containmentError();',
    replace: "    if (this.isRejectedOwnerContainmentActive() && !containmentRecovery && operationType !== 'DESKTOP_MUTATION') throw this._containmentError(); // MUTANT",
    tests: ['tests/wp4/desktop-credential-application-mutation-oracle.test.js'], matrix: 'APPLICATION', completeMatrix: true
  },
  {
    id: 'M35_JOURNAL_BEFORE_ENFORCEMENT', invariant: 'A16', description: 'Persist containment lifecycle state before revoking the owner, closing FD6 and installing the application fence.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "    let marker = null;\n    this._containmentCrashPoint('before-backend-owner-revocation', { backendPid, containmentId, rejectionReasonCode });",
    replace: "    this._persist(); // MUTANT: fallible journal write before real enforcement\n    let marker = null;\n    this._containmentCrashPoint('before-backend-owner-revocation', { backendPid, containmentId, rejectionReasonCode });",
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M36_OWNER_REVOCATION_REMOVED', invariant: 'A16', description: 'Do not revoke the rejected BackendProcessHost owner or API authority before bookkeeping.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "      marker = this.desktopHost.containRejectedBackendOwner?.({\n        backendPid,\n        startupNonce: backend.startupNonce,\n        backendSessionId: backend.backendSessionId,\n        fd6PipeInstanceId: backend.fd6PipeInstanceId,\n        reasonCode: rejectionReasonCode,\n        persistOwnerRecord: false\n      }) || null;",
    replace: "      marker = null; // MUTANT: owner and API authority remain trusted",
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M37_APPLICATION_FENCE_REMOVED', invariant: 'A16', description: 'Do not install the persistent application credential fence during rejected-owner containment.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "      fence = this.vaultHost.setApplicationFence?.({\n        containmentId,\n        reasonCode: APPLICATION_CONTAINMENT_ACTIVE,\n        rejectionReasonCode,\n        cleanupReasonCode: this.containment.cleanupReasonCode,\n        coordinatorState: STATES.REJECTED_OWNER_TERMINATION_PENDING,\n        backendPid,\n        ownerSession: this.containment.ownerSession,\n        retryable: true,\n        fatal: options.fatal === true\n      }) || this.vaultHost.applicationFenceSnapshot?.() || null;",
    replace: "      fence = null; // MUTANT: no application fence",
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M38_STATE_ONLY_CONTAINMENT_WITHOUT_FENCE', invariant: 'A16', description: 'Claim established containment from state/facts while omitting the real CredentialVaultHost fence.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    edits: [
      {
        find: "      fence = this.vaultHost.setApplicationFence?.({\n        containmentId,\n        reasonCode: APPLICATION_CONTAINMENT_ACTIVE,\n        rejectionReasonCode,\n        cleanupReasonCode: this.containment.cleanupReasonCode,\n        coordinatorState: STATES.REJECTED_OWNER_TERMINATION_PENDING,\n        backendPid,\n        ownerSession: this.containment.ownerSession,\n        retryable: true,\n        fatal: options.fatal === true\n      }) || this.vaultHost.applicationFenceSnapshot?.() || null;",
        replace: "      fence = null; // MUTANT: no production fence"
      },
      { find: '      applicationFenceInstalled: Boolean(fence),', replace: '      applicationFenceInstalled: true, // MUTANT: fact substitutes for real fence' }
    ],
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M39_CLEANUP_EXCEPTION_RELEASES_LEASE_UNFENCED', invariant: 'A16', description: 'Clear the application fence before releasing the short application lease after cleanup failure.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: '    const released = await this.vaultHost.releaseApplicationLease(token);',
    replace: '    this.vaultHost.clearApplicationFence?.({ force: true }); // MUTANT: cleanup failure releases lease without fence\n    const released = await this.vaultHost.releaseApplicationLease(token);',
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M40_CONTAINMENT_PERSISTENCE_ERROR_SWALLOWED', invariant: 'A16', description: 'Treat a failed containment lifecycle journal write as durable success without establishing fatal containment.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: `    } catch (journalCause) {
      this.containment.enforcementFacts.containmentJournalDurable = false;
      const failure = this._recordPersistenceFailure('containment-lifecycle-journal-write', journalCause, { state, backendPid: this.containment.backendPid });
      this.containment.persistenceFailure = failure;
      this.lifecycle.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.lifecycle.reasonCode = failure.reasonCode;
      this.lifecycle.updatedAtUtc = this.clock();
      this.containment.state = STATES.FATAL_OWNER_CONTAINMENT;
      this.containment.cleanupReasonCode = failure.reasonCode;
      this.vaultHost.setApplicationFence?.({
        containmentId: this.containment.containmentId,
        reasonCode: APPLICATION_CONTAINMENT_ACTIVE,
        rejectionReasonCode: this.containment.rejectionReasonCode,
        cleanupReasonCode: failure.reasonCode,
        coordinatorState: STATES.FATAL_OWNER_CONTAINMENT,
        backendPid: this.containment.backendPid,
        ownerSession: this.containment.ownerSession,
        retryable: false,
        fatal: true
      });
      try { this._persistContainmentSentinel('lifecycle-journal-write-failed'); } catch (sentinelCause) {
        this._recordPersistenceFailure('containment-sentinel-after-journal-failure', sentinelCause, { state });
      }
      this._requestFailStop('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_JOURNAL_WRITE_FAILED', { failure });
      return false;
    }`,
    replace: `    } catch (journalCause) {
      void journalCause; // MUTANT: failed lifecycle journal is reported as durable success
      this.containment.enforcementFacts.containmentJournalDurable = true;
      return true;
    }`,
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M41_API_TOKEN_RETAINED', invariant: 'A16', description: 'Keep the rejected owner API session token valid during containment.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: "    if (session) this.session = Object.freeze({ ...session, apiSessionToken: '', rejected: true });",
    replace: "    if (session) this.session = Object.freeze({ ...session, rejected: true }); // MUTANT: API token retained",
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M42_FD6_CLOSE_NOOP', invariant: 'A16', description: 'Leave the rejected owner FD6 custody host attached and usable.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: "    this.rejectedOwner = Object.freeze({ ...base, apiAuthorityRevoked: true, fd6Closed: false, ownerRecordDurable: false });\n\n    const custody = this.credentialCustodyHost;\n    this.credentialCustodyHost = null;",
    replace: "    this.rejectedOwner = Object.freeze({ ...base, apiAuthorityRevoked: true, fd6Closed: false, ownerRecordDurable: false });\n\n    const custody = this.credentialCustodyHost;\n    void custody; // MUTANT: FD6 host remains attached",
    tests: ['tests/wp4/desktop-credential-containment-journal-order.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M43_IS_CONTAINMENT_ACTIVE_STATE_ONLY', invariant: 'A16', description: 'Determine containment solely from the coordinator state name instead of production enforcement objects.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "  isRejectedOwnerContainmentActive() {\n    const backend = this._backend();",
    replace: "  isRejectedOwnerContainmentActive() {\n    return this._containmentStates().includes(this.lifecycle.state); // MUTANT: state-only containment\n    const backend = this._backend();",
    tests: ['tests/wp4/desktop-credential-rejected-owner-containment.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M44_FENCE_CLEARED_BEFORE_OWNER_RECOVERY', invariant: 'A17', description: 'Clear the application fence before real child exit and owner-exit recovery complete.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: "  async _resolveRejectedOwnerContainment(child = null, options = {}) {\n    if (child) {",
    replace: "  async _resolveRejectedOwnerContainment(child = null, options = {}) {\n    this.vaultHost.clearApplicationFence?.({ force: true }); // MUTANT: fence cleared before recovery\n    if (child) {",
    tests: ['tests/wp4/desktop-credential-rejected-owner-containment.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M45_REJECTED_MARKER_CLEARED_WHILE_PID_LIVE', invariant: 'A17', description: 'Permit the rejected owner marker to be cleared while its PID is still live.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: "    if (options.force !== true && ((child && !processExited(child)) || (probe.alive === true && probe.identityMatch !== false))) {",
    replace: "    if (false && options.force !== true && ((child && !processExited(child)) || (probe.alive === true && probe.identityMatch !== false))) { // MUTANT",
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M46_CORRUPT_JOURNAL_FALLS_BACK_IDLE', invariant: 'A18', description: 'Ignore corrupt lifecycle journal and durable owner-registry danger evidence, falling back to IDLE.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    edits: [
      {
        find: "    } catch (cause) {\n      this.lifecycle.state = STATES.UNAVAILABLE;\n      this.lifecycle.reasonCode = APPLICATION_UNAVAILABLE;\n      this.lastFailure = { atUtc: this.clock(), reasonCode: APPLICATION_UNAVAILABLE, message: cause.message };\n    }",
        replace: "    } catch (cause) {\n      this.lifecycle.state = STATES.IDLE; // MUTANT: corrupt journal ignored\n      this.lifecycle.reasonCode = '';\n      this.lastFailure = null;\n    }"
      },
      {
        find: "    const recoveryIntent = Boolean(\n      this.containment?.active === true ||\n      this.containmentSentinel?.active === true ||\n      this._containmentStates().includes(this.lifecycle.state) ||\n      this.vaultHost.applicationFenceSnapshot?.() ||\n      backend.rejectedOwner ||\n      backend.ownerTrusted === false ||\n      backend.ownerRegistryFailure\n    );",
        replace: "    const recoveryIntent = Boolean(\n      this.containment?.active === true ||\n      this.containmentSentinel?.active === true ||\n      this._containmentStates().includes(this.lifecycle.state) ||\n      this.vaultHost.applicationFenceSnapshot?.()\n    ); // MUTANT: owner registry danger ignored"
      }
    ],
    tests: ['tests/wp4/desktop-credential-containment-crash-recovery.test.js'], matrix: 'APPLICATION_CONVERGENCE', completeMatrix: true
  },
  {
    id: 'M47_OWNER_POSITIVE_PID_VALIDATION_REMOVED', invariant: 'A19', description: 'Remove the positive PID requirement for an active persisted owner.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    find: `    if (record.backendPid < 1) {
      throw registryValidationError('Active backend owner backendPid must be greater than zero', { field: 'backendPid', value: record.backendPid });
    }`,
    replace: `    if (false && record.backendPid < 1) { // MUTANT: positive PID validation removed
      throw registryValidationError('Active backend owner backendPid must be greater than zero', { field: 'backendPid', value: record.backendPid });
    }`,
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M48_OWNER_PID_ZERO_ACCEPTED', invariant: 'A19', description: 'Change active owner PID validation from greater-than-zero to greater-than-or-equal-zero.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    find: `    if (record.backendPid < 1) {
      throw registryValidationError('Active backend owner backendPid must be greater than zero', { field: 'backendPid', value: record.backendPid });
    }`,
    replace: `    if (record.backendPid < 0) { // MUTANT: PID zero accepted
      throw registryValidationError('Active backend owner backendPid must be greater than zero', { field: 'backendPid', value: record.backendPid });
    }`,
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M49_OWNER_STATE_ENUM_VALIDATION_REMOVED', invariant: 'A19', description: 'Accept unknown persisted owner lifecycle states.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    find: `  if (typeof record.state !== 'string' || !ALLOWED_STATES.has(record.state)) {
    throw registryValidationError('Backend owner registry state is not recognized', { field: 'state', value: record.state });
  }`,
    replace: `  if (false && (typeof record.state !== 'string' || !ALLOWED_STATES.has(record.state))) { // MUTANT
    throw registryValidationError('Backend owner registry state is not recognized', { field: 'state', value: record.state });
  }`,
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M50_OWNER_STATE_ACTIVE_CONSISTENCY_REMOVED', invariant: 'A19', description: 'Ignore contradictions between owner state and ownershipActive.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    find: `  if (liveState !== record.ownershipActive) {
    throw registryValidationError('Backend owner registry state and ownershipActive contradict each other', { state: record.state, ownershipActive: record.ownershipActive });
  }`,
    replace: `  if (false && liveState !== record.ownershipActive) { // MUTANT
    throw registryValidationError('Backend owner registry state and ownershipActive contradict each other', { state: record.state, ownershipActive: record.ownershipActive });
  }`,
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M51_OWNER_SESSION_IDENTITY_MISSING_ACCEPTED', invariant: 'A19', description: 'Permit an active persisted owner without backendSessionId.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    find: "    for (const field of ['startupNonce', 'backendSessionId', 'fd6PipeInstanceId']) {",
    replace: "    for (const field of ['startupNonce', 'fd6PipeInstanceId']) { // MUTANT: backendSessionId omitted",
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M52_OWNER_PROCESS_IDENTITY_MISSING_ACCEPTED', invariant: 'A19', description: 'Permit active owner records without process identity.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    find: "    if (options.requireProcessIdentity !== false) validateProcessIdentity(record.processIdentity);",
    replace: "    if (false && options.requireProcessIdentity !== false) validateProcessIdentity(record.processIdentity); // MUTANT",
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M53_OWNER_SEMANTIC_FAILURE_RESET_EMPTY', invariant: 'A19', description: 'Automatically reset a semantic-invalid owner record to an empty recovered record.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    edits: [
      { find: `      this.record = null;
      this.loadFailure = {`, replace: `      this.record = { schemaVersion: SCHEMA_VERSION, state: 'RECOVERED', ownershipActive: false, trusted: false, backendPid: 0 }; // MUTANT
      this.loadFailure = null;
      const ignoredFailure = {` }
    ],
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M54_OWNER_SEMANTIC_FAILURE_START_ALLOWED', invariant: 'A19', description: 'Allow replacement backend start while owner registry failure is active.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: "    if (this.ownerRegistryFailure) throw startupFailure(this.ownerRegistryFailure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID', 'Backend owner registry is unavailable; refusing to create a new credential owner', { registryFailure: this.ownerRegistryFailure });",
    replace: "    if (false && this.ownerRegistryFailure) throw startupFailure(this.ownerRegistryFailure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID', 'Backend owner registry is unavailable; refusing to create a new credential owner', { registryFailure: this.ownerRegistryFailure }); // MUTANT",
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M55_OWNER_CORRUPTION_INTERPRETED_NO_OWNERSHIP', invariant: 'A19', description: 'Interpret a damaged active owner record as ownershipPresent=false without recovery.',
    file: 'electron/desktopHost/BackendOwnerRegistry.js',
    edits: [
      { find: `      this.record = null;
      this.loadFailure = {`, replace: `      this.record = parsed ? { ...parsed, state: 'RECOVERED', ownershipActive: false, trusted: false, backendPid: 0 } : null; // MUTANT
      this.loadFailure = null;
      const ignoredFailure = {` }
    ],
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M56_OWNER_FAILURE_CLEARED_BEFORE_RECOVERY', invariant: 'A19', description: 'Clear a registry-invalid rejected owner before explicit recovery completes.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: `    if (this.ownerRegistryFailure && options.force !== true) {
      throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED', 'Rejected owner marker cannot be cleared while the durable owner registry is invalid or unavailable', { registryFailure: this.ownerRegistryFailure });
    }`,
    replace: `    if (false && this.ownerRegistryFailure && options.force !== true) { // MUTANT
      throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED', 'Rejected owner marker cannot be cleared while the durable owner registry is invalid or unavailable', { registryFailure: this.ownerRegistryFailure });
    }`,
    tests: ['tests/wp4/backend-owner-registry-containment-recovery.test.js'], matrix: 'CONTAINMENT', completeMatrix: true
  },
  {
    id: 'M57_START_FAILURE_SKIPS_HOST_CONTAINMENT', invariant: 'A20', description: 'Skip BackendProcessHost authority and FD6 containment before fallible startup-failure termination.',
    file: 'electron/desktopHost/BackendProcessHost.js',
    find: `            error.rejectedOwnerContainment = this.containRejectedOwner({
              reasonCode,
              ownerSession: attempt.ownerContext || null,
              persistOwnerRecord: false
            });`,
    replace: `            error.rejectedOwnerContainment = null; // MUTANT: failed live child is not contained before termination`,
    tests: ['tests/wp4/desktop-credential-start-handshake-containment.test.js'], matrix: 'START_HANDSHAKE', completeMatrix: true
  },
  {
    id: 'M58_START_FAILURE_SKIPS_APPLICATION_CONTAINMENT', invariant: 'A20', description: 'Allow an unresolved failed startup owner to bypass application-level rejected-owner containment.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: `      if (unresolvedOwner) await this._cleanupRejectedNewOwner(token, cause, options);`,
    replace: `      if (false && unresolvedOwner) await this._cleanupRejectedNewOwner(token, cause, options); // MUTANT`,
    tests: ['tests/wp4/desktop-credential-start-handshake-containment.test.js'], matrix: 'START_HANDSHAKE', completeMatrix: true
  },
  {
    id: 'M59_START_FAILURE_CLEANUP_NOT_FATAL', invariant: 'A20', description: 'Leave a live rejected startup owner in retryable containment instead of fatal fail-stop.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    edits: [
      {
        find: `      this._engageRejectedOwnerContainment(cause, { cleanupReasonCode, stopResult: stopped, fatal: true });`,
        replace: `      this._engageRejectedOwnerContainment(cause, { cleanupReasonCode, stopResult: stopped, fatal: false }); // MUTANT`
      },
      {
        find: `      this._markRejectedOwnerStillLive(cleanupCause, stopped);`,
        replace: `      void cleanupCause; void stopped; // MUTANT: live owner is not promoted to fatal containment`
      }
    ],
    tests: ['tests/wp4/desktop-credential-start-handshake-containment.test.js'], matrix: 'START_HANDSHAKE', completeMatrix: true
  },
  {
    id: 'M60_RELAUNCH_DROPS_CONTAINMENT_FAIL_STOP', invariant: 'A20', description: 'Restore persistent rejected-owner containment without restoring fail-stopRequired.',
    file: 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js',
    find: `      this.failStopRequired = this.containmentSentinel?.failStopRequired === true ||
        this.containment?.active === true ||
        this._containmentStates().includes(this.lifecycle.state);`,
    replace: `      this.failStopRequired = false; // MUTANT: relaunch drops durable fail-stop`,
    tests: ['tests/wp4/desktop-credential-start-handshake-containment.test.js'], matrix: 'START_HANDSHAKE', completeMatrix: true
  },
  {
    id: 'M61_MUTATION_SIGNAL_MISCLASSIFIED_AS_KILL', invariant: 'A21', description: 'Ignore a terminating signal when classifying a mutation oracle execution.',
    file: 'tools/wp4/run-credential-mutation-tests.js',
    find: `    if (String(result.signal || '')) invalidReasons.push('signal');`,
    replace: `    if (false && String(result.signal || '')) invalidReasons.push('signal'); // MUTANT`,
    occurrence: 1, expectedOccurrences: 2,
    tests: ['tests/wp4/credential-mutation-harness-classification.test.js'], matrix: 'HARNESS'
  },
  {
    id: 'M62_MUTATION_NULL_EXIT_MISCLASSIFIED_AS_KILL', invariant: 'A21', description: 'Accept a null or non-integer oracle exit code as a valid mutation result.',
    file: 'tools/wp4/run-credential-mutation-tests.js',
    find: `    if (!Number.isInteger(result.exitCode)) invalidReasons.push('exit-code-invalid');`,
    replace: `    if (false && !Number.isInteger(result.exitCode)) invalidReasons.push('exit-code-invalid'); // MUTANT`,
    occurrence: 1, expectedOccurrences: 2,
    tests: ['tests/wp4/credential-mutation-harness-classification.test.js'], matrix: 'HARNESS'
  }

];

function validateMutationAnchors(root = ROOT, mutations = MUTATIONS) {
  const errors = [];
  let editCount = 0;
  for (const mutation of mutations) {
    const file = path.join(root, mutation.file);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (cause) {
      errors.push({ id: mutation.id, file: mutation.file, reasonCode: 'WP4_MUTATION_ANCHOR_FILE_UNREADABLE', message: cause.message });
      continue;
    }
    const edits = mutation.edits || [{ find: mutation.find, replace: mutation.replace }];
    for (const [index, edit] of edits.entries()) {
      editCount += 1;
      const expectedOccurrences = Number(edit.expectedOccurrences || mutation.expectedOccurrences || 1);
      const occurrence = Number(edit.occurrence || mutation.occurrence || 1);
      const occurrences = text.split(edit.find).length - 1;
      if (occurrences !== expectedOccurrences) {
        errors.push({
          id: mutation.id,
          file: mutation.file,
          editIndex: index,
          reasonCode: 'WP4_MUTATION_ANCHOR_COUNT_INVALID',
          expectedOccurrences,
          actualOccurrences: occurrences
        });
      } else if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > occurrences) {
        errors.push({
          id: mutation.id,
          file: mutation.file,
          editIndex: index,
          reasonCode: 'WP4_MUTATION_ANCHOR_OCCURRENCE_INVALID',
          occurrence,
          actualOccurrences: occurrences
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    status: errors.length ? 'FAIL' : 'PASS',
    mutationCount: mutations.length,
    editCount,
    errorCount: errors.length,
    errors
  };
}

function runOneMutation(mutation) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-${mutation.id.toLowerCase()}-`));
  const mutantRoot = path.join(parent, 'repo');
  try {
    copyRepository(mutantRoot);
    const edits = mutation.edits || [{ find: mutation.find, replace: mutation.replace }];
    for (const edit of edits) mutateFile(mutantRoot, mutation.file, edit.find, edit.replace, {
      occurrence: edit.occurrence || mutation.occurrence,
      expectedOccurrences: edit.expectedOccurrences || mutation.expectedOccurrences
    });
    if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] required-start\n`);
    const required = runTests(mutantRoot, mutation.tests, { WP4_MUTATION_TARGET: mutation.id });
    if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] required-end ${required.exitCode}\n`);
    if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] matrix-start\n`);
    const matrix = execute(mutantRoot, process.execPath, [matrixScript(mutation)], { WP4_MUTATION_TARGET: mutation.id }, 480000);
    if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] matrix-end ${matrix.exitCode}\n`);
    let completeMatrix = { exitCode: 1, signal: '', timedOut: false, outputTail: 'not-run' };
    if (mutation.completeMatrix === true || mutation.matrix === 'APPLICATION' || mutation.matrix === 'APPLICATION_CONVERGENCE') {
      if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] complete-matrix-start\n`);
      completeMatrix = execute(mutantRoot, process.execPath, ['tools/wp4/credential-complete-fault-matrix.js'], { WP4_MUTATION_TARGET: mutation.id }, 480000);
      if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] complete-matrix-end ${completeMatrix.exitCode}\n`);
    }
    if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] evidence-start\n`);
    const evidence = execute(mutantRoot, process.execPath, ['tools/wp4/generate-evidence.js'], {
      WP4_MUTATION_ORACLE_ID: mutation.id,
      WP4_MUTATION_ORACLE_TESTS: JSON.stringify(mutation.tests),
      WP4_MUTATION_ORACLE_MATRIX: mutation.matrix
    }, 480000);
    if (process.env.WP4_MUTATION_DEBUG === '1') process.stderr.write(`[${mutation.id}] evidence-end ${evidence.exitCode}\n`);
    const requiresCompleteMatrix = mutation.completeMatrix === true || mutation.matrix === 'APPLICATION' || mutation.matrix === 'APPLICATION_CONVERGENCE';
    const oracleResults = {
      requiredTest: classifyOracleExecution(required),
      faultMatrix: classifyOracleExecution(matrix),
      completeFaultMatrix: classifyOracleExecution(completeMatrix, { required: requiresCompleteMatrix }),
      evidenceGenerator: classifyOracleExecution(evidence)
    };
    const requiredOracles = Object.entries(oracleResults).filter(([, value]) => value.status !== 'NOT_REQUIRED');
    const invalidOracles = requiredOracles.filter(([, value]) => value.valid !== true).map(([name, value]) => ({ name, ...value }));
    const survivingOracles = requiredOracles.filter(([, value]) => value.valid === true && value.killed !== true).map(([name, value]) => ({ name, ...value }));
    const killed = invalidOracles.length === 0 && survivingOracles.length === 0 && requiredOracles.every(([, value]) => value.killed === true);
    const status = invalidOracles.length ? 'INVALID' : (killed ? 'PASS' : 'FAIL');
    return {
      id: mutation.id, invariant: mutation.invariant, description: mutation.description, mutatedFile: mutation.file, tests: mutation.tests,
      requiredTestKilled: oracleResults.requiredTest.killed,
      faultMatrixKilled: oracleResults.faultMatrix.killed,
      completeFaultMatrixKilled: oracleResults.completeFaultMatrix.killed,
      evidenceGeneratorKilled: oracleResults.evidenceGenerator.killed,
      killed,
      status,
      oracleResults,
      invalidOracleCount: invalidOracles.length,
      invalidOracles,
      survivingOracleCount: survivingOracles.length,
      survivingOracles,
      allRequiredOracleExecutionsValid: invalidOracles.length === 0,
      allRequiredOraclesKilled: killed,
      requiredTest: required, faultMatrix: matrix, completeFaultMatrix: completeMatrix, evidenceGenerator: evidence,
      secretValueRecorded: false, secretHashRecorded: false
    };
  } catch (error) {
    return { id: mutation.id, invariant: mutation.invariant, description: mutation.description, status: 'INVALID', killed: false, harnessError: error.stack || error.message, secretValueRecorded: false, secretHashRecorded: false };
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}

function worker(id) {
  const mutation = MUTATIONS.find(row => row.id === id);
  if (!mutation) throw new Error(`Unknown mutation ${id}`);
  fs.writeSync(1, `${JSON.stringify(runOneMutation(mutation))}\n`);
}
function spawnWorker(mutation) {
  return new Promise(resolve => {
    const child = childProcess.spawn(process.execPath, [__filename, '--worker', mutation.id], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ id: mutation.id, status: 'FAIL', killed: false, workerSignal: 'SIGKILL', harnessError: 'Mutation worker exceeded deterministic 720000ms deadline', stdoutTail: stdout.slice(-3000), stderrTail: stderr.slice(-3000) });
    }, 720000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', (code, signal) => {
      let result;
      try { result = JSON.parse(stdout.trim().split(/\n/).filter(Boolean).at(-1)); }
      catch (error) { result = { id: mutation.id, status: 'FAIL', killed: false, workerExitCode: code, workerSignal: signal || '', harnessError: `Worker output parse failed: ${error.message}`, stdoutTail: stdout.slice(-3000), stderrTail: stderr.slice(-3000) }; }
      finish(result);
    });
  });
}
async function runCredentialMutationTests(options = {}) {
  const mutations = MUTATIONS;
  const anchorValidation = validateMutationAnchors(ROOT, mutations);
  if (anchorValidation.status !== 'PASS') {
    const error = new Error(`Credential mutation anchor preflight rejected ${anchorValidation.errorCount} invalid anchor(s)`);
    error.reasonCode = 'WP4_CREDENTIAL_MUTATION_ANCHOR_INVALID';
    error.results = anchorValidation;
    throw error;
  }
  const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_CONCURRENCY));
  const progressFile = String(options.progressFile || process.env.WP4_MUTATION_PROGRESS_FILE || '').trim();
  const checkpointFile = String(options.checkpointFile || process.env.WP4_MUTATION_CHECKPOINT_FILE || '').trim();
  const sourceIdentity = readMutationSourceIdentity(ROOT);
  const catalogSha256 = mutationCatalogSha256(mutations);
  const checkpoint = loadMutationCheckpoint(checkpointFile, { mutations, sourceIdentity, catalogSha256 });
  const completedResults = checkpoint ? checkpoint.results.slice() : [];
  const results = new Array(mutations.length);
  completedResults.forEach((result, index) => { results[index] = result; });
  let next = completedResults.length;
  if (progressFile) {
    fs.mkdirSync(path.dirname(path.resolve(progressFile)), { recursive: true });
    if (!checkpoint) fs.writeFileSync(path.resolve(progressFile), '', { encoding: 'utf8', mode: 0o600 });
    appendMutationProgress(progressFile, {
      schemaVersion: 1,
      event: checkpoint ? 'RESUME' : 'START',
      mutationCount: mutations.length,
      completedCount: completedResults.length,
      concurrency,
      pid: process.pid,
      sourceCommit: sourceIdentity.commit,
      sourceTree: sourceIdentity.tree,
      mutationCatalogSha256: catalogSha256,
      startedAtUtc: new Date().toISOString()
    });
  }
  if (checkpointFile && !checkpoint) {
    writeMutationCheckpoint(checkpointFile, checkpointValue({ sourceIdentity, catalogSha256, mutations, results: [] }));
  }
  let persistChain = Promise.resolve();
  const persistResult = (index, result) => {
    persistChain = persistChain.then(() => {
      const prefix = [];
      for (let cursor = 0; cursor < results.length && results[cursor]; cursor += 1) prefix.push(results[cursor]);
      writeMutationCheckpoint(checkpointFile, checkpointValue({ sourceIdentity, catalogSha256, mutations, results: prefix }));
      appendMutationProgress(progressFile, {
        schemaVersion: 1,
        event: 'RESULT',
        index,
        ordinal: index + 1,
        mutationCount: mutations.length,
        id: mutations[index].id,
        status: result.status || 'UNKNOWN',
        killed: result.killed === true,
        harnessError: String(result.harnessError || ''),
        completedAtUtc: new Date().toISOString()
      });
    });
    return persistChain;
  };
  async function consume() {
    while (true) {
      const index = next++;
      if (index >= mutations.length) return;
      const result = await spawnWorker(mutations[index]);
      results[index] = result;
      await persistResult(index, result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, mutations.length) }, consume));
  await persistChain;
  const invalid = results.filter(row => row.status === 'INVALID' || Boolean(row.harnessError));
  const survivors = results.filter(row => !row.harnessError && (row.status === 'FAIL' || (!row.killed && row.status !== 'INVALID')));
  const killedCount = results.filter(row => row.killed === true).length;
  const status = invalid.length ? 'INVALID' : (survivors.length ? 'FAIL' : 'PASS');
  const value = {
    schemaVersion: 3,
    status,
    oraclePolicy: 'A_KILL_REQUIRES_A_VALID_ORACLE_PROCESS_WITH_INTEGER_NONZERO_EXIT_AND_NO_SIGNAL_TIMEOUT_SPAWN_OR_HARNESS_ERROR',
    mutationCount: results.length,
    killedCount,
    survivorCount: survivors.length,
    invalidCount: invalid.length,
    allMutationExecutionsValid: invalid.length === 0,
    results,
    secretValueRecorded: false,
    secretHashRecorded: false
  };
  writeMutationCheckpoint(checkpointFile, checkpointValue({ sourceIdentity, catalogSha256, mutations, results, status }));
  appendMutationProgress(progressFile, {
    schemaVersion: 1,
    event: 'SUMMARY',
    status,
    mutationCount: results.length,
    killedCount,
    survivorCount: survivors.length,
    invalidCount: invalid.length,
    completedAtUtc: new Date().toISOString()
  });
  if (invalid.length) {
    const error = new Error(`Credential mutation tests produced ${invalid.length} invalid harness result(s)`);
    error.reasonCode = 'WP4_CREDENTIAL_MUTATION_HARNESS_INVALID';
    error.results = value;
    throw error;
  }
  if (survivors.length) { const error = new Error(`Credential mutation tests left ${survivors.length} surviving mutant(s)`); error.reasonCode = 'WP4_CREDENTIAL_MUTATION_TEST_SURVIVED'; error.results = value; throw error; }
  return value;
}
module.exports = { MUTATIONS, appendMutationProgress, checkpointValue, classifyOracleExecution, loadMutationCheckpoint, mutationCatalogSha256, readMutationSourceIdentity, validateMutationAnchors, validateMutationCheckpoint, writeMutationCheckpoint, runCredentialMutationTests, runOneMutation };
if (require.main === module) {
  if (process.argv[2] === '--worker') { try { worker(process.argv[3]); process.exit(0); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); } }
  else runCredentialMutationTests().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || 'WP4_CREDENTIAL_MUTATION_TEST_FAILED'} ${error.stack || error.message}\n`); if (error.results) process.stderr.write(`${JSON.stringify(error.results, null, 2)}\n`); process.exit(1); });
}
