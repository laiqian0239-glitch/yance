#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeWindowsPathLexically, resolveWindowsShortPath } = require('./windows-short-path');
const { atomicWriteJson } = require('../wp7/command-supervisor');

const EXPECTED_NODE = 'v22.16.0';
const EXPECTED_NPM = '10.9.2';
const MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${key || '<end>'}`);
    values[key.slice(2)] = value;
  }
  for (const required of ['output', 'source-root', 'temp-root', 'npm-cli']) {
    if (!values[required]) throw new Error(`missing required option --${required}`);
  }
  return values;
}

function normalizedExecutable(value) {
  const resolved = path.resolve(value || '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function hiddenIndexEntries(sourceRoot, spawn = spawnSync) {
  const result = spawn('git', ['-C', sourceRoot, 'ls-files', '-v'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || result.error) throw new Error(result.stderr || result.error?.message || 'git ls-files -v failed');
  return String(result.stdout || '').split(/\r?\n/).filter(Boolean).filter((line) => /^[a-zS]/.test(line));
}

function repositoryStatus(sourceRoot, spawn = spawnSync) {
  const result = spawn('git', ['-C', sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || result.error) throw new Error(result.stderr || result.error?.message || 'git status failed');
  return String(result.stdout || '').trim();
}

function npmRuntimeProbe(npmCli, tempRoot, spawn = spawnSync) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'yance-npm-runtime-probe-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
      private: true,
      scripts: { 'runtime-probe': 'node -p "process.execPath"' }
    }, null, 2)}\n`);
    const version = spawn(process.execPath, [npmCli, '--version'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const child = spawn(process.execPath, [npmCli, 'run', '--silent', 'runtime-probe'], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` } });
    return {
      npmVersion: String(version.stdout || '').trim(),
      npmVersionExitCode: version.status,
      npmScriptNodeExecutable: String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '',
      npmScriptExitCode: child.status,
      npmScriptStderr: String(child.stderr || '').trim()
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function runnerShortPathEvidence(tempRoot, evidencePath) {
  if (!evidencePath) return null;
  const resolvedEvidencePath = path.resolve(evidencePath);
  let evidence;
  try {
    const raw = fs.readFileSync(resolvedEvidencePath, 'utf8').replace(/^\uFEFF/, '');
    evidence = JSON.parse(raw);
  } catch (error) {
    return {
      applicable: true,
      status: 'FAIL',
      reasonCode: 'WINDOWS_RUNNER_TEMP_SELECTION_EVIDENCE_INVALID',
      evidencePath: resolvedEvidencePath,
      error: error.message
    };
  }
  const expectedRoot = normalizeWindowsPathLexically(path.resolve(tempRoot));
  const selectedRoot = normalizeWindowsPathLexically(evidence?.selected || '');
  const probes = Array.isArray(evidence?.probes) ? evidence.probes : [];
  const acceptedProbe = probes.find((probe) => (
    probe?.status === 'PASS' &&
    probe?.reasonCode === 'WINDOWS_SHORT_PATH_ALIAS_AVAILABLE' &&
    normalizeWindowsPathLexically(probe?.root || '') === expectedRoot &&
    probe?.shortPathExists === true &&
    probe?.lexicallyDistinct === true &&
    probe?.comparisonMethod === 'LEXICAL_CASE_INSENSITIVE_NO_CANONICALIZATION'
  ));
  const available = evidence?.status === 'PASS' && selectedRoot === expectedRoot && Boolean(acceptedProbe);
  return {
    applicable: true,
    status: available ? 'PASS' : 'FAIL',
    reasonCode: available
      ? 'WINDOWS_SHORT_PATH_ALIAS_PREVALIDATED_BY_RUNNER'
      : 'WINDOWS_RUNNER_TEMP_SELECTION_EVIDENCE_MISMATCH',
    evidencePath: resolvedEvidencePath,
    selected: evidence?.selected || '',
    expectedTempRoot: path.resolve(tempRoot),
    acceptedProbe: acceptedProbe || null,
    validationMethod: 'RUNNER_TEMP_SELECTION_EVIDENCE_REUSE'
  };
}

function windowsShortPathProbe(tempRoot, spawn = spawnSync, evidencePath = '') {
  if (process.platform !== 'win32') return { applicable: false, status: 'NOT_APPLICABLE', reasonCode: 'WINDOWS_SHORT_PATH_NOT_APPLICABLE' };
  const prevalidated = runnerShortPathEvidence(tempRoot, evidencePath);
  if (prevalidated) return prevalidated;
  const probe = fs.mkdtempSync(path.join(tempRoot, 'Yance Long Path Probe '));
  try {
    return { probePath: probe, ...resolveWindowsShortPath(probe, { spawn }) };
  } finally {
    fs.rmSync(probe, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function longPathsPolicy(spawn = spawnSync) {
  if (process.platform !== 'win32') return { applicable: false, status: 'NOT_APPLICABLE' };
  const result = spawn('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'], { encoding: 'utf8', windowsHide: true });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const enabled = /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(text);
  return { applicable: true, status: enabled ? 'PASS' : 'WARN', enabled, exitCode: result.status, output: text.trim() };
}

function adminState(spawn = spawnSync) {
  if (process.platform !== 'win32') return { applicable: false, status: 'NOT_APPLICABLE' };
  const result = spawn('net.exe', ['session'], { encoding: 'utf8', windowsHide: true });
  return { applicable: true, status: result.status === 0 ? 'PASS' : 'WARN', elevated: result.status === 0 };
}

function diskState(targetPath) {
  if (typeof fs.statfsSync !== 'function') return { status: 'WARN', reason: 'statfs unavailable' };
  const stats = fs.statfsSync(targetPath);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  return { status: freeBytes >= MIN_FREE_BYTES ? 'PASS' : 'FAIL', freeBytes, minimumRequiredBytes: MIN_FREE_BYTES };
}

function check(name, status, details = {}) { return { name, status, ...details }; }

function runPreflight(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const tempRoot = path.resolve(options.tempRoot);
  const npmCli = path.resolve(options.npmCli);
  fs.mkdirSync(tempRoot, { recursive: true });
  const npmProbe = npmRuntimeProbe(npmCli, tempRoot);
  const shortPath = windowsShortPathProbe(tempRoot, spawnSync, options.tempSelectionEvidence || '');
  const hidden = hiddenIndexEntries(sourceRoot);
  const dirty = repositoryStatus(sourceRoot);
  const disk = diskState(tempRoot);
  const longPaths = longPathsPolicy();
  const administrator = adminState();
  const checks = [
    check('host-platform', process.platform === 'win32' ? 'PASS' : 'WARN', { actual: process.platform, expected: 'win32 for official rounds' }),
    check('host-architecture', process.arch === 'x64' ? 'PASS' : 'FAIL', { actual: process.arch, expected: 'x64' }),
    check('node-version', process.version === (options.expectedNode || EXPECTED_NODE) ? 'PASS' : 'FAIL', { actual: process.version, expected: options.expectedNode || EXPECTED_NODE }),
    check('node-executable-binding', normalizedExecutable(process.execPath) === normalizedExecutable(options.expectedNodeExe || process.execPath) ? 'PASS' : 'FAIL', { actual: process.execPath, expected: options.expectedNodeExe || process.execPath }),
    check('npm-version', npmProbe.npmVersion === (options.expectedNpm || EXPECTED_NPM) && npmProbe.npmVersionExitCode === 0 ? 'PASS' : 'FAIL', { actual: npmProbe.npmVersion, expected: options.expectedNpm || EXPECTED_NPM, exitCode: npmProbe.npmVersionExitCode }),
    check('npm-script-node-binding', normalizedExecutable(npmProbe.npmScriptNodeExecutable) === normalizedExecutable(process.execPath) && npmProbe.npmScriptExitCode === 0 ? 'PASS' : 'FAIL', { actual: npmProbe.npmScriptNodeExecutable, expected: process.execPath, exitCode: npmProbe.npmScriptExitCode, stderr: npmProbe.npmScriptStderr }),
    check('repository-clean', dirty === '' ? 'PASS' : 'FAIL', { porcelain: dirty }),
    check('hidden-index-flags', hidden.length === 0 ? 'PASS' : 'FAIL', { entries: hidden }),
    check('temp-short-path-alias', shortPath.status, shortPath),
    check('free-disk-space', disk.status, disk),
    check('long-path-policy', longPaths.status, longPaths),
    check('administrator', administrator.status, administrator)
  ];
  const blockers = checks.filter((row) => row.status === 'FAIL');
  return {
    schemaVersion: 1,
    documentType: 'YANCE_WINDOWS_VERIFY_ENVIRONMENT_MANIFEST',
    generatedAtUtc: new Date().toISOString(),
    status: blockers.length === 0 ? 'PASS' : 'FAIL',
    sourceRoot,
    tempRoot,
    host: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, nodeExecutable: process.execPath, cpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
    npmCli,
    pathEntries: String(process.env.PATH || '').split(path.delimiter),
    checks,
    blockers: blockers.map((row) => row.name)
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = runPreflight({
    sourceRoot: args['source-root'],
    tempRoot: args['temp-root'],
    npmCli: args['npm-cli'],
    expectedNode: args['expected-node'] || EXPECTED_NODE,
    expectedNpm: args['expected-npm'] || EXPECTED_NPM,
    expectedNodeExe: args['expected-node-exe'] || process.execPath,
    tempSelectionEvidence: args['temp-selection-evidence'] || ''
  });
  atomicWriteJson(path.resolve(args.output), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = {
  EXPECTED_NODE,
  EXPECTED_NPM,
  MIN_FREE_BYTES,
  parseArgs,
  normalizedExecutable,
  hiddenIndexEntries,
  repositoryStatus,
  npmRuntimeProbe,
  runnerShortPathEvidence,
  windowsShortPathProbe,
  diskState,
  runPreflight
};
