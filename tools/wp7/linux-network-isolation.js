'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function assertRegular(filePath, reasonCode, label) {
  const resolved = path.resolve(filePath || '');
  if (!filePath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile() || fs.lstatSync(resolved).isSymbolicLink()) fail(reasonCode, `${label} must be a regular non-symlink file`, { filePath: resolved });
  return fs.realpathSync(resolved);
}
function compileLinuxNetworkIsolation(options = {}) {
  if (process.platform !== 'linux') fail('WP7_NETWORK_ISOLATION_PLATFORM_UNSUPPORTED', 'reviewed LD_PRELOAD network isolation is Linux-only', { platform: process.platform });
  const sourcePath = assertRegular(options.sourcePath, 'WP7_NETWORK_ISOLATION_SOURCE_MISSING', 'reviewed network isolation source');
  const outputPath = path.resolve(options.outputPath || '');
  if (!options.outputPath) fail('WP7_NETWORK_ISOLATION_LIBRARY_MISSING', 'network isolation output path is required');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const compiler = String(options.compiler || process.env.CC || 'cc');
  const args = ['-shared', '-fPIC', '-O2', '-Wall', '-Wextra', '-Werror', sourcePath, '-o', outputPath, '-ldl'];
  const result = spawnSync(compiler, args, { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (result.status !== 0) fail('WP7_NETWORK_ISOLATION_COMPILE_FAILED', 'reviewed network isolation library did not compile', { compiler, args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  const libraryPath = assertRegular(outputPath, 'WP7_NETWORK_ISOLATION_LIBRARY_MISSING', 'compiled network isolation library');
  return Object.freeze({
    sourcePath,
    sourceSha256: sha256File(sourcePath),
    libraryPath,
    librarySha256: sha256File(libraryPath),
    compiler,
    compileArgs: args
  });
}
function verifyNetworkIsolationIdentity(options = {}) {
  const sourcePath = assertRegular(options.sourcePath, 'WP7_NETWORK_ISOLATION_SOURCE_MISSING', 'reviewed network isolation source');
  const libraryPath = assertRegular(options.libraryPath, 'WP7_NETWORK_ISOLATION_LIBRARY_MISSING', 'compiled network isolation library');
  const sourceSha256 = sha256File(sourcePath);
  const librarySha256 = sha256File(libraryPath);
  const mismatches = [];
  if (options.expectedSourceSha256 !== undefined && sourceSha256 !== options.expectedSourceSha256) mismatches.push({ field: 'sourceSha256', expected: options.expectedSourceSha256, actual: sourceSha256 });
  if (options.expectedLibrarySha256 !== undefined && librarySha256 !== options.expectedLibrarySha256) mismatches.push({ field: 'librarySha256', expected: options.expectedLibrarySha256, actual: librarySha256 });
  if (mismatches.length) fail('WP7_NETWORK_ISOLATION_IDENTITY_MISMATCH', 'reviewed network isolation source or compiled library identity mismatch', { mismatches });
  return Object.freeze({ sourcePath, sourceSha256, libraryPath, librarySha256 });
}

function readPreMainProof(proofPath, expected = {}) {
  const resolved = assertRegular(proofPath, 'WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_MISSING', 'network isolation pre-main proof');
  let proof;
  try { proof = JSON.parse(fs.readFileSync(resolved, 'utf8')); }
  catch (error) { fail('WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_INVALID', 'network isolation pre-main proof is invalid JSON', { message: error.message }); }
  const mismatches = [];
  if (proof.schemaVersion !== 1 || proof.documentType !== 'WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF') mismatches.push({ field: 'schema', actual: proof });
  for (const [field, value] of Object.entries({ pid: expected.pid, parentPid: expected.parentPid, nonce: expected.nonce })) if (value !== undefined && proof[field] !== value) mismatches.push({ field, expected: value, actual: proof[field] });
  if (!Number.isInteger(proof.unixSeconds) || proof.unixSeconds < 1 || !Number.isInteger(proof.unixNanoseconds) || proof.unixNanoseconds < 0) mismatches.push({ field: 'timestamp', actual: { unixSeconds: proof.unixSeconds, unixNanoseconds: proof.unixNanoseconds } });
  if (mismatches.length) fail('WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_INVALID', 'network isolation pre-main proof identity mismatch', { mismatches });
  return Object.freeze({ ...proof, proofPath: resolved, proofSha256: sha256File(resolved) });
}

module.exports = { compileLinuxNetworkIsolation, verifyNetworkIsolationIdentity, readPreMainProof, sha256File };
