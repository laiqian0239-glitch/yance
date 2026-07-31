'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_RE = /^[0-9a-f]{40}$/;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`${label} is missing: ${resolved}`);
  try { return { path: resolved, value: JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

function assertExpectedSha256(filePath, expected, label) {
  if (!SHA256_RE.test(String(expected || ''))) throw new Error(`${label} SHA256 must be lowercase 64-character hex`);
  const actual = sha256File(filePath);
  if (actual !== expected) throw new Error(`${label} SHA256 mismatch`);
  return actual;
}

function validateRoundResult(filePath, expectedSha256, expectedRound) {
  const loaded = readJson(filePath, `Round ${expectedRound} result`);
  const resultSha256 = assertExpectedSha256(loaded.path, expectedSha256, `Round ${expectedRound} result`);
  const row = loaded.value;
  const failures = [];
  const requireEqual = (field, expected) => { if (row[field] !== expected) failures.push(`${field}=${JSON.stringify(row[field])}, expected ${JSON.stringify(expected)}`); };
  requireEqual('documentType', 'YANCE_WINDOWS_VERIFY_WP7_ROUND_RESULT');
  requireEqual('round', expectedRound);
  requireEqual('status', 'PASS');
  requireEqual('verificationMode', 'STRICT');
  requireEqual('formalRoundEligible', true);
  requireEqual('repositoryCleanBefore', true);
  requireEqual('repositoryCleanAfter', true);
  requireEqual('gitFsckBefore', 'PASS');
  requireEqual('gitFsckAfter', 'PASS');
  requireEqual('verifyWp7ExitCode', 0);
  requireEqual('node', 'v22.16.0');
  requireEqual('npm', '10.9.2');
  if (!GIT_RE.test(String(row.commit || ''))) failures.push('commit is invalid');
  if (!GIT_RE.test(String(row.tree || ''))) failures.push('tree is invalid');
  if (!SHA256_RE.test(String(row.bundleSha256 || ''))) failures.push('bundleSha256 is invalid');
  if (!SHA256_RE.test(String(row.runnerSha256 || ''))) failures.push('runnerSha256 is invalid');
  if (failures.length) throw new Error(`Round ${expectedRound} is not formal-builder eligible: ${failures.join('; ')}`);
  return { path: loaded.path, resultSha256, row };
}

function validateRoundPair(options) {
  const round1 = validateRoundResult(options.round1Result, options.round1Sha256, 1);
  const round2 = validateRoundResult(options.round2Result, options.round2Sha256, 2);
  const sameFields = ['branch', 'commit', 'tree', 'bundleSha256', 'runnerSha256', 'node', 'npm'];
  const mismatches = sameFields.filter((field) => round1.row[field] !== round2.row[field]);
  if (mismatches.length) throw new Error(`Windows rounds are not identically bound: ${mismatches.join(', ')}`);
  if (options.expectedCommit && round1.row.commit !== options.expectedCommit) throw new Error('Windows rounds do not match expected commit');
  if (options.expectedTree && round1.row.tree !== options.expectedTree) throw new Error('Windows rounds do not match expected tree');
  if (options.expectedBranch && round1.row.branch !== options.expectedBranch) throw new Error('Windows rounds do not match expected branch');
  return {
    status: 'PASS',
    branch: round1.row.branch,
    commit: round1.row.commit,
    tree: round1.row.tree,
    bundleSha256: round1.row.bundleSha256,
    runnerSha256: round1.row.runnerSha256,
    node: round1.row.node,
    npm: round1.row.npm,
    round1: { path: round1.path, sha256: round1.resultSha256, completedAtUtc: round1.row.completedAtUtc },
    round2: { path: round2.path, sha256: round2.resultSha256, completedAtUtc: round2.row.completedAtUtc }
  };
}

module.exports = { SHA256_RE, GIT_RE, sha256File, validateRoundResult, validateRoundPair };
