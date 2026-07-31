'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.resolve(process.env.WP5_EVIDENCE_DIR || path.join(ROOT, 'evidence', 'wp5', 'development'));

function ensureOutput() { fs.mkdirSync(OUTPUT, { recursive: true }); return OUTPUT; }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeJson(name, value) {
  ensureOutput();
  const file = path.join(OUTPUT, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return { file, sha256: sha256File(file) };
}
function git(...args) {
  const result = childProcess.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr || `git ${args.join(' ')} failed`), { code: 'WP5_GIT_IDENTITY_FAILED' });
  return result.stdout.trim();
}
function worktreeTree() {
  ensureOutput();
  const index = path.join(os.tmpdir(), `wp5-index-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    let result = childProcess.spawnSync('git', ['read-tree', 'HEAD'], { cwd: ROOT, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(result.stderr || 'git read-tree failed');
    result = childProcess.spawnSync('git', ['add', '-A', '--', '.'], { cwd: ROOT, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(result.stderr || 'git add failed');
    result = childProcess.spawnSync('git', ['write-tree'], { cwd: ROOT, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(result.stderr || 'git write-tree failed');
    return result.stdout.trim();
  } finally { try { fs.rmSync(index, { force: true }); } catch (_) {} try { fs.rmSync(`${index}.lock`, { force: true }); } catch (_) {} }
}
function identity() {
  return {
    sourceCommit: git('rev-parse', 'HEAD'),
    worktreeSourceTree: worktreeTree(),
    repositoryClean: git('status', '--porcelain').trim() === '',
    statusPorcelain: git('status', '--porcelain').split(/\r?\n/).filter(Boolean)
  };
}
function resultEnvelope(name, cases, extra = {}) {
  const passed = cases.filter(row => row.status === 'PASS').length;
  const failed = cases.filter(row => row.status !== 'PASS').length;
  return {
    schemaVersion: 1,
    stage: '6.4.5.9',
    workPackage: 'WP5',
    phase: 'DEVELOPMENT',
    name,
    generatedAtUtc: new Date().toISOString(),
    identity: identity(),
    status: failed === 0 ? 'PASS' : 'FAIL',
    summary: { total: cases.length, passed, failed },
    cases,
    ...extra
  };
}
async function runCase(id, operation) {
  const started = Date.now();
  try {
    const detail = await operation();
    return { id, status: 'PASS', durationMs: Date.now() - started, detail: detail ?? null };
  } catch (error) {
    return { id, status: 'FAIL', durationMs: Date.now() - started, error: { code: error?.reasonCode || error?.code || '', message: error?.message || String(error), stack: String(error?.stack || '').split('\n').slice(0, 8).join('\n') } };
  }
}
function runNode(args, options = {}) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ...options.env },
    timeout: options.timeout || 120000,
    maxBuffer: options.maxBuffer || 30 * 1024 * 1024,
    shell: options.shell === true
  });
}
function classifyProcess(result) {
  if (result.error) return { classification: 'HARNESS_ERROR', exitCode: result.status, signal: result.signal || '', error: result.error.message };
  if (result.signal) return { classification: 'SIGNAL', exitCode: result.status, signal: result.signal };
  if (!Number.isInteger(result.status)) return { classification: 'HARNESS_ERROR', exitCode: result.status, signal: '' };
  return { classification: result.status === 0 ? 'PASS' : 'TEST_FAILURE', exitCode: result.status, signal: '' };
}
module.exports = { ROOT, OUTPUT, classifyProcess, git, identity, resultEnvelope, runCase, runNode, sha256File, writeJson };
