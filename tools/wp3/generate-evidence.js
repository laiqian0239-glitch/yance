#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runProductionApiV2Scenario } = require('./production-api-v2-runtime');
const { runProductionRuntimeAliasScenario } = require('./production-runtime-alias-scenario');
const { auditRuntimeAuthority } = require('./runtime-authority-audit');
const { parseFinalTestSummary, assertStrictTestRun } = require('./test-summary');

const ROOT = path.resolve(__dirname, '../..');
function arg(name, fallback = '') { return process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback; }
const OUTPUT = path.resolve(arg('--output-dir', process.env.WP3_EVIDENCE_DIR || path.join(ROOT, 'evidence', 'wp3')));
const WINDOWS_EVIDENCE = arg('--windows-evidence', process.env.YANCE_WP3_WINDOWS_EVIDENCE || '');
const requiredTests = fs.readdirSync(path.join(ROOT, 'tests', 'wp3')).filter(name => name.endsWith('.test.js')).sort();
const WP3_ISOLATED_ENV_KEYS = Object.freeze([
  'WORKBUDDY_DATA_DIR',
  'YANCE_DATA_DIR',
  'YANCE_LEGACY_DATA_DIR',
  'YANCE_PRIMARY_SQLITE_PATH',
  'YANCE_SETTINGS_SQLITE_PATH',
  'YANCE_RUNTIME_MUTEX_NAME',
  'YANCE_SAFE_MODE'
]);
function isolatedWp3Environment(source = process.env) {
  const env = { ...source, NODE_ENV: 'test', YANCE_TEST_ONLY_SQLITE_BROKER_RESET: '1' };
  for (const key of WP3_ISOLATED_ENV_KEYS) delete env[key];
  return env;
}
function parseLastJsonLine(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch (_) {}
  }
  return null;
}
function runRuntimeSingletonScenarioIsolated() {
  const script = path.join(ROOT, 'tools', 'wp3', 'runtime-singleton-scenario.js');
  const run = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: isolatedWp3Environment(),
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000
  });
  const value = parseLastJsonLine(run.stdout);
  if (run.status !== 0 || !value || value.status !== 'PASS') {
    const error = new Error('WP3 runtime singleton scenario did not complete in an isolated process');
    error.reasonCode = 'WP3_RUNTIME_SINGLETON_ISOLATED_EXECUTION_FAILED';
    error.execution = {
      exitCode: run.status,
      signal: run.signal || '',
      spawnError: run.error?.message || '',
      outputTail: `${run.stdout || ''}\n${run.stderr || ''}`.slice(-8000)
    };
    throw error;
  }
  return value;
}
function git(args) { const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr || result.stdout); return result.stdout.trim(); }
function write(name, value) { fs.mkdirSync(OUTPUT, { recursive: true }); fs.writeFileSync(path.join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function base(kind, identity) { return { schemaVersion: 2, stage: '6.4.5.9', phase: 'core-runtime-p1', workPackage: 'WP3', evidenceKind: kind, status: 'PASS', generatedAtUtc: new Date().toISOString(), sourceCommit: identity.commit, sourceTree: identity.tree, activationCommit: '74cca0187aa80c5d9ab8bff958cccdd5a92fa1f2', acceptedWp2Head: '3474d37d8bea07d1ea0294801e7f78284aae6ff8', riskAcceptanceId: 'WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION' }; }
function validateWindowsEvidence(identity) {
  let file = WINDOWS_EVIDENCE;
  if (process.platform === 'win32' && !file) {
    const temp = path.join(os.tmpdir(), `yance-wp3-windows-evidence-${process.pid}-${Date.now()}.json`);
    const run = spawnSync(process.execPath, ['tools/wp3/windows-named-mutex-evidence.js', '--output', temp], { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    if (run.status !== 0) throw Object.assign(new Error(`${run.stdout || ''}\n${run.stderr || ''}`), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_FAILED' });
    file = temp;
  }
  if (!file || !fs.existsSync(file)) throw Object.assign(new Error('Windows Named Mutex evidence was not executed or supplied'), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_NOT_EXECUTED' });
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (evidence.status !== 'PASS' || evidence.provider !== 'WINDOWS_SYSTEM_THREADING_MUTEX') throw Object.assign(new Error('Windows Named Mutex evidence is not PASS'), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_FAILED' });
  if (evidence.sourceCommit !== identity.commit || evidence.sourceTree !== identity.tree) throw Object.assign(new Error('Windows Named Mutex evidence identity does not match current source'), { reasonCode: 'WP3_WINDOWS_EVIDENCE_IDENTITY_MISMATCH' });
  const failed = Object.entries(evidence.checks || {}).filter(([, pass]) => pass !== true).map(([name]) => name);
  if (failed.length) throw Object.assign(new Error(`Windows Named Mutex checks failed: ${failed.join(', ')}`), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_FAILED' });
  return evidence;
}

async function main() {
  const identity = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
  const testPaths = requiredTests.map(name => `tests/wp3/${name}`);
  const testRun = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...testPaths], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: isolatedWp3Environment()
  });
  const output = `${testRun.stdout || ''}\n${testRun.stderr || ''}`;
  let summary;
  try {
    summary = assertStrictTestRun({ output, exitCode: testRun.status, minimumTests: testPaths.length });
  } catch (error) {
    process.stderr.write(output);
    throw Object.assign(error, {
      reasonCode: 'WP3_REQUIRED_TESTS_FAILED',
      summary: error.summary || parseFinalTestSummary(output),
      expectedTestFiles: testPaths.length
    });
  }
  const production = await runProductionApiV2Scenario({ repoRoot: ROOT });
  const aliases = await runProductionRuntimeAliasScenario({ repoRoot: ROOT });
  const singleton = runRuntimeSingletonScenarioIsolated();
  const authority = auditRuntimeAuthority(ROOT);
  if (authority.status !== 'PASS') throw Object.assign(new Error(JSON.stringify(authority.findings)), { reasonCode: authority.findings[0]?.reasonCode || 'WP3_DUPLICATE_PRODUCTION_RUNTIME' });
  const windows = validateWindowsEvidence(identity);

  const ownership = {
    ...base('runtime-ownership', identity),
    requiredTests: { ...summary, files: requiredTests },
    pathCanonicalization: { implementation: 'backend/runtime/RuntimePathIdentity.js', mutexIdentitySource: process.platform === 'win32' ? 'Windows physical database-directory file identity plus database filename' : 'canonical SQLite path identity', productionAliasScenario: aliases },
    mutex: { portableProvider: { status: 'PASS', provider: aliases.provider, scenario: aliases }, windowsProvider: windows },
    runtimeAuthority: { staticAudit: authority, productionCounts: production.constructionCounts, factory: production.runtimeAuthority },
    singletonIntegrity: singleton,
    sqliteOpenedAfterMutex: true,
    production
  };
  const takeover = { ...base('runtime-takeover-order', identity), sequence: ['canonicalize_data_and_database_paths','acquire_process_wide_named_mutex','open_sqlite','increment_fencing_token_and_replace_runtime_lease_owner_in_one_transaction','create_single_app_runtime','start_local_workers'], leaseExpiryBypassHeldMutex: false, portableProvider: aliases, windowsProvider: windows, productionRestart: production };
  const auth = { ...base('api-session-auth', identity), endpoints: production.endpoints, authorization: 'Bearer apiSessionToken', rotateOnEveryBackendRestart: true, oldTokenRejected: true, production };
  const fencing = { ...base('fencing-enforcement', identity), runtimeStateWritesRequireFencing: true, outboxClaimAckRetryRequireFencing: true, staleReasonCode: 'STALE_FENCING_TOKEN', monotonicFencingToken: true, production };
  const contract = { ...base('api-v2-contract', identity), contractVersion: 2, header: 'X-Yance-Contract-Version: 2', mismatchHttpStatus: 426, mismatchReasonCode: 'API_CONTRACT_MISMATCH', failClosedBeforeSideEffect: true, production };
  const idempotency = { ...base('command-idempotency', identity), persistentStore: 'command_idempotency', sameEnvelopeDuplicateReturnsOriginal: true, reuseMismatchReasonCode: 'COMMAND_ID_REUSE_MISMATCH', stateConflictReasonCode: 'STATE_VERSION_CONFLICT', production };
  const events = { ...base('event-sequence', identity), persistentStore: 'runtime_event', strictlyMonotonic: true, maxPageSize: 500, gapReasonCode: 'EVENT_SEQUENCE_GAP', restartPersistenceObserved: true, production };
  const authorityEvidence = { ...base('runtime-authority', identity), staticAudit: authority, production: { constructionCounts: production.constructionCounts, factory: production.runtimeAuthority, checks: Object.fromEntries(Object.entries(production.checks).filter(([name]) => /Runtime|Lifecycle|factory|legacy/.test(name))) }, singletonIntegrity: singleton };
  const aliasEvidence = { ...base('runtime-path-aliases', identity), portableProvider: aliases, windowsProvider: windows, canonicalizationImplementation: 'backend/runtime/RuntimePathIdentity.js', failureReasonCode: 'BOOT_RUNTIME_MUTEX_HELD' };
  const dependency = { ...base('dependency-reproducibility', identity), packageManager: 'npm@10.9.2', lockFile: 'package-lock.json', cleanSourceInstallVerificationRequired: true, nodeModulesExcludedFromSourceZip: true };

  write('runtime-ownership.json', ownership);
  write('runtime-takeover-order.json', takeover);
  write('api-session-auth.json', auth);
  write('fencing-enforcement.json', fencing);
  write('api-v2-contract.json', contract);
  write('command-idempotency.json', idempotency);
  write('event-sequence.json', events);
  write('runtime-authority.json', authorityEvidence);
  write('runtime-path-aliases.json', aliasEvidence);
  write('windows-named-mutex-real.json', windows);
  write('dependency-reproducibility.json', dependency);
  process.stdout.write(`WP3_EVIDENCE_PASS ${JSON.stringify({ sourceCommit: identity.commit, sourceTree: identity.tree, tests: summary, files: requiredTests.length })}\n`);
}

function reportFailure(error) {
  process.stderr.write(`${error.reasonCode || error.code || 'WP3_EVIDENCE_FAILED'} ${error.stack || error.message}\n`);
  if (error.execution) process.stderr.write(`${JSON.stringify({ execution: error.execution })}\n`);
  process.exit(1);
}

module.exports = {
  WP3_ISOLATED_ENV_KEYS,
  isolatedWp3Environment,
  parseLastJsonLine,
  testSummary: parseFinalTestSummary,
  requiredTestSummaryComplete: (summary, requiredFileCount) => {
    try {
      return assertStrictTestRun({
        output: Object.entries(summary || {}).map(([name, value]) => `# ${name} ${value}`).join('\n'),
        exitCode: 0,
        minimumTests: requiredFileCount
      }) != null;
    } catch (_) {
      return false;
    }
  },
  runRuntimeSingletonScenarioIsolated,
  main,
  reportFailure
};

if (require.main === module) main().catch(reportFailure);
