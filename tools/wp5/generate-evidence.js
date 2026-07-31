#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, OUTPUT, identity, sha256File, writeJson } = require('./common');

const REQUIRED_ARTIFACTS = [
  'fault-matrix.json',
  'concurrency-crash-matrix.json',
  'mutation-results.json',
  'source-closure-scan.json',
  'developer-adversarial-review.json',
  'windows-legacy-runtime-cutover.json',
  'windows-evidence-source-binding.json',
  'runtime-state-authority.json',
  'legacy-migration.json',
  'write-path-audit.json',
  'safe-mode-removal.json'
];

function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readJson(name) {
  const file = path.join(OUTPUT, name);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`Missing canonical evidence: ${name}`), { code: 'WP5_CANONICAL_EVIDENCE_MISSING' });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function parseTap(file) {
  if (!fs.existsSync(file)) return { status: 'NOT_EXECUTED', tests: 0, pass: 0, fail: 0, skipped: 0 };
  const text = fs.readFileSync(file, 'utf8');
  const number = label => Number((text.match(new RegExp(`# ${label} (\\d+)`)) || [])[1] || 0);
  const row = { tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'), log: path.relative(ROOT, file).replace(/\\/g, '/'), sha256: sha256File(file) };
  row.status = row.fail === 0 && row.tests > 0 ? 'PASS' : 'FAIL';
  return row;
}
function normalizeIdentity(value) {
  const row = value?.identity || {};
  return {
    sourceCommit: row.sourceCommit,
    sourceTree: row.sourceTree || row.worktreeSourceTree,
    repositoryClean: row.repositoryClean
  };
}
function artifact(name) {
  const file = path.join(OUTPUT, name);
  const value = readJson(name);
  return { name, path: path.relative(ROOT, file).replace(/\\/g, '/'), sha256: sha256File(file), value };
}
function historicalRegressions() {
  const result = {};
  for (const id of ['wp1', 'wp2', 'wp3']) result[id.toUpperCase()] = parseTap(path.join(OUTPUT, 'logs', `test-${id}.log`));
  for (const [key, name] of [['WP0', 'wp0-clean-snapshot-regression.json'], ['WP4', 'wp4-isolated-regression.json']]) {
    const file = path.join(OUTPUT, name);
    result[key] = fs.existsSync(file) ? { ...JSON.parse(fs.readFileSync(file, 'utf8')), sha256: sha256File(file) } : { status: 'NOT_EXECUTED' };
  }
  return result;
}

function main() {
  const current = identity();
  const currentTree = current.worktreeSourceTree;
  if (!current.repositoryClean) throw Object.assign(new Error('Aggregate evidence requires a clean repository'), { code: 'WP5_AGGREGATE_REPOSITORY_NOT_CLEAN' });
  const required = parseTap(path.join(OUTPUT, 'logs', 'test-wp5.log'));
  const artifacts = REQUIRED_ARTIFACTS.map(artifact);
  const identityMismatches = [];
  for (const row of artifacts) {
    const bound = normalizeIdentity(row.value);
    if (bound.sourceCommit !== current.sourceCommit || bound.sourceTree !== currentTree || bound.repositoryClean !== true) {
      identityMismatches.push({ artifact: row.name, expected: { sourceCommit: current.sourceCommit, sourceTree: currentTree, repositoryClean: true }, actual: bound });
    }
  }
  const statusFailures = artifacts.filter(row => row.value.status !== 'PASS').map(row => ({ artifact: row.name, status: row.value.status, reasonCode: row.value.reasonCode || null }));
  const windows = readJson('windows-legacy-runtime-cutover.json');
  if (windows.platform !== 'win32' || windows.productionChainExecuted !== true || windows.sourceBinding?.status !== 'PASS') statusFailures.push({ artifact: 'windows-legacy-runtime-cutover.json', status: 'FAIL', reasonCode: 'WP5_WINDOWS_EVIDENCE_SOURCE_BINDING_INVALID' });

  const regressions = historicalRegressions();
  const requireHistorical = process.env.WP5_REQUIRE_HISTORICAL_REGRESSIONS === '1';
  const historicalFailures = requireHistorical ? Object.entries(regressions).filter(([, value]) => value.status !== 'PASS').map(([workPackage, value]) => ({ workPackage, status: value.status })) : [];
  const knownGaps = [];
  const technicalBlockers = [];
  if (required.status !== 'PASS') technicalBlockers.push({ reasonCode: 'WP5_REQUIRED_TESTS_NOT_PASS', status: required.status });
  if (identityMismatches.length) technicalBlockers.push({ reasonCode: 'WP5_CANONICAL_EVIDENCE_IDENTITY_INCONSISTENT', identityMismatches });
  if (statusFailures.length) technicalBlockers.push({ reasonCode: 'WP5_CANONICAL_EVIDENCE_NOT_PASS', statusFailures });
  if (historicalFailures.length) technicalBlockers.push({ reasonCode: 'WP5_HISTORICAL_REGRESSION_NOT_PASS', historicalFailures });
  if (!requireHistorical && Object.values(regressions).some(row => row.status === 'NOT_EXECUTED')) knownGaps.push({ reasonCode: 'WP5_HISTORICAL_REGRESSIONS_NOT_INCLUDED_IN_THIS_VERIFY_RUN', status: 'DISCLOSED_NON_CORE_INPUT' });

  const status = required.status === 'PASS' && technicalBlockers.length === 0 ? 'PASS' : 'FAIL';
  const report = {
    schemaVersion: 2,
    stage: '6.4.5.9',
    workPackage: 'WP5',
    phase: 'CONVERGENCE_PRE_REVIEW',
    generatedAtUtc: new Date().toISOString(),
    status,
    reviewDecision: status === 'PASS' ? 'READY_FOR_INDEPENDENT_REVIEW' : 'BLOCKED',
    identity: { sourceCommit: current.sourceCommit, sourceTree: currentTree, worktreeSourceTree: currentTree, implementationCommit: current.sourceCommit, repositoryClean: true, statusPorcelain: [] },
    baselineIdentity: {
      wp4AcceptedFinalHead: '2b929258c4d51c10a4dc49e90fcecf8b9f8170c4',
      wp4AcceptedSourceTree: '8de896200f82a65d22a7d15db78cd83f813188bf',
      wp5ActivationCommit: '608c85c5b74ca41ac7fe276bc39ff6bd38ce766b',
      wp5ActivationBindingCommit: 'e52b9f6c6ddb59a45fc652aef43b195fbecb6aee',
      wp5ActivationBindingTree: '2737a812081f6de1daa79c1013989d9959e23faf'
    },
    governance: { productionImplementationAuthorized: true, candidateBindingCommit: null, finalDeliveryHead: null, finalPackagingAuthorized: false, wp6Activated: false },
    requiredTestResults: required,
    canonicalEvidence: artifacts.map(row => ({ name: row.name, path: row.path, sha256: row.sha256, status: row.value.status, identity: normalizeIdentity(row.value) })),
    r5RequiredEvidenceOutputs: ['runtime-state-authority.json', 'legacy-migration.json', 'write-path-audit.json', 'safe-mode-removal.json'],
    windowsLegacyRuntimeCutover: { status: windows.status, platform: windows.platform, productionChainExecuted: windows.productionChainExecuted, sourceBinding: windows.sourceBinding, provenance: windows.provenance, sha256: sha256File(path.join(OUTPUT, 'windows-legacy-runtime-cutover.json')) },
    historicalRegressions: regressions,
    requireHistoricalRegressions: requireHistorical,
    identityMismatches,
    knownGaps,
    technicalBlockers,
    wp5KnownProductionGaps: technicalBlockers,
    invariantBinding: { path: 'docs/wp5/invariant-binding.json', sha256: sha256File(path.join(ROOT, 'docs', 'wp5', 'invariant-binding.json')) },
    evidenceSchema: { path: 'docs/wp5/evidence-schema.json', sha256: sha256File(path.join(ROOT, 'docs', 'wp5', 'evidence-schema.json')) }
  };
  report.evidenceDigest = stableHash(report);
  const mainArtifact = writeJson('wp5-convergence-pre-review-evidence.json', report);
  const index = {
    schemaVersion: 2,
    stage: '6.4.5.9',
    workPackage: 'WP5',
    phase: 'CONVERGENCE_PRE_REVIEW',
    generatedAtUtc: report.generatedAtUtc,
    status,
    identity: report.identity,
    artifacts: fs.readdirSync(OUTPUT).filter(name => name.endsWith('.json')).sort().map(name => ({ name, sha256: sha256File(path.join(OUTPUT, name)) })),
    knownGaps,
    technicalBlockers
  };
  const indexArtifact = writeJson('evidence-index.json', index);
  console.log(JSON.stringify({ status, identity: report.identity, knownGaps, technicalBlockers, mainArtifact, indexArtifact }, null, 2));
  if (status !== 'PASS') process.exitCode = 1;
}

try { main(); }
catch (error) { console.error(JSON.stringify({ status: 'FAIL', reasonCode: error.code || 'WP5_EVIDENCE_AGGREGATION_FAILED', message: error.message }, null, 2)); process.exitCode = 1; }
