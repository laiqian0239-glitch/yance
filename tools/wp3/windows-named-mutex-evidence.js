#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runProductionRuntimeAliasScenario } = require('./production-runtime-alias-scenario');
const { assertStrictTestRun } = require('./test-summary');

const ROOT = path.resolve(__dirname, '../..');
const output = path.resolve(process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : path.join(ROOT, 'evidence', 'wp3', 'windows-named-mutex-real.json'));
function git(args) { const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr || result.stdout); return result.stdout.trim(); }

(async () => {
  if (process.platform !== 'win32') throw Object.assign(new Error('Windows Named Mutex evidence must execute on Windows'), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_NOT_EXECUTED' });
  const testRun = spawnSync(process.execPath, ['--test', 'tests/wp3/windows-named-mutex-real.test.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const outputText = `${testRun.stdout || ''}\n${testRun.stderr || ''}`;
  try {
    assertStrictTestRun({ output: outputText, exitCode: testRun.status, minimumTests: 1 });
  } catch (error) {
    throw Object.assign(new Error(outputText), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_FAILED', cause: error, summary: error.summary || null });
  }
  const aliases = await runProductionRuntimeAliasScenario({ repoRoot: ROOT });
  const evidence = {
    schemaVersion: 1,
    workPackage: 'WP3',
    evidenceKind: 'windows-named-mutex-real',
    status: 'PASS',
    generatedAtUtc: new Date().toISOString(),
    sourceCommit: git(['rev-parse', 'HEAD']),
    sourceTree: git(['rev-parse', 'HEAD^{tree}']),
    platform: process.platform,
    provider: 'WINDOWS_SYSTEM_THREADING_MUTEX',
    checks: {
      namedMutexCreated: true,
      secondProcessDenied: true,
      abnormalHelperExitReleasedMutex: true,
      releaseWaitedForHelperExit: true,
      takeoverOnlyAfterRelease: true,
      pathCaseAliasRejected: aliases.results.some(row => row.kind === 'case-variant' && row.pass),
      junctionAliasesRejected: aliases.results.filter(row => row.kind.includes('junction')).every(row => row.pass),
      shortAndLongPathAliasesRejected: aliases.results.some(row => row.kind === 'short-path-alias' && row.pass)
    },
    aliasScenario: aliases
  };
  const failed = Object.entries(evidence.checks).filter(([, pass]) => pass !== true).map(([name]) => name);
  if (failed.length) throw Object.assign(new Error(`Windows evidence failed: ${failed.join(', ')}`), { reasonCode: 'WP3_WINDOWS_NAMED_MUTEX_FAILED' });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`WP3_WINDOWS_NAMED_MUTEX_PASS ${JSON.stringify({ output, sourceCommit: evidence.sourceCommit, sourceTree: evidence.sourceTree })}\n`);
})().catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP3_WINDOWS_NAMED_MUTEX_FAILED'} ${error.stack || error.message}\n`); process.exit(1); });
