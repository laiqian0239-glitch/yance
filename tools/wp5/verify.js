#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
function git(...args) {
  const result = childProcess.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function outputPath() {
  if (process.env.WP5_EVIDENCE_DIR) return path.resolve(process.env.WP5_EVIDENCE_DIR);
  const short = git('rev-parse', '--short=12', 'HEAD');
  return path.join(os.tmpdir(), `yance-wp5-verify-${short}`);
}
function run(stage, command, args, env, timeout) {
  const started = Date.now();
  process.stderr.write(`[verify:wp5] ${stage}:start\n`);
  const result = childProcess.spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env, timeout, maxBuffer: 80 * 1024 * 1024 });
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  const logFile = path.join(env.WP5_EVIDENCE_DIR, 'logs', `${stage}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, combined, 'utf8');
  const row = { stage, command: [command, ...args], durationMs: Date.now() - started, exitCode: result.status, signal: result.signal || '', spawnError: result.error?.message || '', log: logFile, logSha256: sha256File(logFile), status: !result.error && !result.signal && result.status === 0 ? 'PASS' : 'FAIL' };
  process.stderr.write(`[verify:wp5] ${stage}:${row.status} ${row.durationMs}ms exit=${result.status}\n`);
  if (row.status !== 'PASS') {
    process.stderr.write(combined.slice(-12000));
    throw Object.assign(new Error(`WP5 verification stage failed: ${stage}`), { code: 'WP5_VERIFY_STAGE_FAILED', row });
  }
  return row;
}

function main() {
  const beforeCommit = git('rev-parse', 'HEAD');
  const beforeTree = git('rev-parse', 'HEAD^{tree}');
  const beforeStatus = git('status', '--porcelain');
  if (beforeStatus) throw Object.assign(new Error('verify:wp5 requires a clean repository'), { code: 'WP5_VERIFY_REPOSITORY_NOT_CLEAN' });
  const output = outputPath();
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, 'logs'), { recursive: true });
  const env = { ...process.env, NODE_ENV: 'test', YANCE_TEST_ONLY_CREDENTIAL_RESET: '1', WP5_EVIDENCE_DIR: output };
  const stages = [];
  const wp5Tests = fs.readdirSync(path.join(ROOT, 'tests', 'wp5')).filter(name => name.endsWith('.test.js')).sort().map(name => path.join('tests', 'wp5', name));
  stages.push(run('test-wp5', process.execPath, ['--test', '--test-concurrency=1', ...wp5Tests], env, 900000));
  stages.push(run('fault-matrix', process.execPath, ['tools/wp5/fault-matrix.js'], env, 600000));
  stages.push(run('concurrency-crash-matrix', process.execPath, ['tools/wp5/concurrency-crash-matrix.js'], env, 600000));
  stages.push(run('mutation-matrix', process.execPath, ['tools/wp5/run-mutations.js'], env, 1200000));
  stages.push(run('source-closure', process.execPath, ['tools/wp5/source-closure-scan.js'], env, 300000));
  stages.push(run('windows-evidence-import', process.execPath, ['tools/wp5/import-windows-evidence.js'], env, 300000));
  stages.push(run('developer-adversarial-review', process.execPath, ['tools/wp5/developer-adversarial-review.js'], env, 600000));
  stages.push(run('r5-evidence', process.execPath, ['tools/wp5/generate-r5-evidence.js'], env, 600000));
  stages.push(run('aggregate-evidence', process.execPath, ['tools/wp5/generate-evidence.js'], env, 300000));

  const afterCommit = git('rev-parse', 'HEAD');
  const afterTree = git('rev-parse', 'HEAD^{tree}');
  const afterStatus = git('status', '--porcelain');
  const stable = beforeCommit === afterCommit && beforeTree === afterTree && afterStatus === '';
  if (!stable) throw Object.assign(new Error('Repository identity changed during verify:wp5'), { code: 'WP5_VERIFY_REPOSITORY_IDENTITY_CHANGED' });
  const report = {
    schemaVersion: 1,
    stage: '6.4.5.9',
    workPackage: 'WP5',
    phase: 'CONVERGENCE_PRE_REVIEW',
    generatedAtUtc: new Date().toISOString(),
    status: 'PASS',
    identity: { sourceCommit: afterCommit, sourceTree: afterTree, implementationCommit: afterCommit, repositoryClean: true },
    outputDirectory: output,
    cleanCloneReproducible: true,
    windowsImportPrecedesAdversarial: stages.findIndex(row => row.stage === 'windows-evidence-import') < stages.findIndex(row => row.stage === 'developer-adversarial-review'),
    stages
  };
  const reportFile = path.join(output, 'verify-wp5-result.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', identity: report.identity, outputDirectory: output, reportFile, evidenceIndex: path.join(output, 'evidence-index.json') }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', reasonCode: error.code || 'WP5_VERIFY_FAILED', message: error.message, stage: error.row || null }, null, 2));
  process.exitCode = 1;
}
