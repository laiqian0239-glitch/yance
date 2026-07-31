#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertStrictTestRun, parseFinalTestSummary } = require('../tools/wp3/test-summary');
const { EXPECTED_ROUND11_PRELAUNCH_TESTS } = require('../tools/runtime-delivery/round11-prelaunch-contract');

const ACCEPTANCE_PACKAGE_KIND = 'YANCE_BATCH40_FIX6D_WINDOWS_FULL_AUTOMATED_ACCEPTANCE';
const ACCEPTANCE_MANIFEST_NAME = 'BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json';
const MANDATORY_ACCEPTANCE_FILES = Object.freeze([
  'RUN_ACCEPTANCE.cmd',
  'RUN_ACCEPTANCE.ps1',
  'RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd',
  'BATCH40_WINDOWS_ACCEPTANCE_ZH.md',
  'BATCH40_EXTERNAL_EVIDENCE_TEMPLATE.json'
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function assertExactTestRun({ output, exitCode, expectedTests, label = 'Test run' }) {
  const expected = assertPositiveInteger(expectedTests, `${label} expected test count`);
  const summary = assertStrictTestRun({ output, exitCode, minimumTests: 1 });
  if (summary.tests !== expected) {
    throw new Error(`${label} test count ${summary.tests} does not equal required ${expected}`);
  }
  return summary;
}


function assertThemeAuditPass({ output, exitCode }) {
  if (Number(exitCode) !== 0) throw new Error(`FIX6D theme audit exit code was ${exitCode}`);
  const text = String(output || '');
  if (!/^Theme color audit PASS\./mu.test(text)) throw new Error('FIX6D theme audit did not pass');
  return { status: 'PASS' };
}

function parseBackendRun(output) {
  const text = String(output || '');
  const allDoneMatches = [...text.matchAll(/^========== ALL DONE \((\d+) files\) ==========$/gmu)];
  const completedFiles = Number(allDoneMatches.at(-1)?.[1] || 0);
  const allDoneIndex = allDoneMatches.at(-1)?.index ?? text.length;
  const runMatches = [...text.slice(0, allDoneIndex).matchAll(/^========== RUNNING: (.+) ==========$/gmu)];
  if (!completedFiles) throw new Error('Backend runner completion marker is missing');
  if (runMatches.length !== completedFiles) {
    throw new Error(`Backend runner section count ${runMatches.length} does not equal completion file count ${completedFiles}`);
  }

  const aggregate = {
    completedFiles,
    totalTests: 0,
    totalPass: 0,
    totalFail: 0,
    totalSkipped: 0,
    totalCancelled: 0,
    totalTodo: 0,
    allPassed: /(?:^|\r?\n)ALL PASSED\s*$/u.test(text)
  };

  for (let index = 0; index < runMatches.length; index += 1) {
    const current = runMatches[index];
    const start = current.index + current[0].length;
    const end = index + 1 < runMatches.length ? runMatches[index + 1].index : allDoneIndex;
    const summary = parseFinalTestSummary(text.slice(start, end));
    if (!summary) throw new Error(`Backend test summary is missing for ${current[1]}`);
    aggregate.totalTests += summary.tests;
    aggregate.totalPass += summary.pass;
    aggregate.totalFail += summary.fail;
    aggregate.totalSkipped += summary.skipped;
    aggregate.totalCancelled += summary.cancelled;
    aggregate.totalTodo += summary.todo;
  }
  return aggregate;
}

function runtimeIdentity(environment = process.env) {
  return {
    platform: process.platform,
    nodeVersion: process.versions.node,
    npmVersion: String(environment.npm_config_user_agent || '').match(/\bnpm\/([^\s]+)/)?.[1] || ''
  };
}

function verifySourceArchive(sourceArchive, expectedSourceSha256) {
  if (!sourceArchive || sourceArchive === '-') {
    return { name: null, sha256: null, bindingStatus: 'GIT_WORKTREE_ONLY' };
  }
  if (!fs.existsSync(sourceArchive) || !fs.statSync(sourceArchive).isFile()) {
    throw new Error(`Source archive is missing: ${sourceArchive}`);
  }
  const expected = String(expectedSourceSha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expected)) throw new Error('Expected source SHA-256 is invalid');
  const actual = sha256(sourceArchive);
  if (actual !== expected) throw new Error(`Source archive SHA-256 mismatch: ${actual} !== ${expected}`);
  return { name: path.basename(sourceArchive), sha256: actual, bindingStatus: 'SHA256_VERIFIED' };
}

function verifyAcceptancePackage({
  packageManifest,
  packageRoot,
  sourceArchive,
  expectedSourceSha256,
  sourceCommit,
  sourceTree,
  expectedGates
}) {
  if (!packageManifest || packageManifest === '-' || !packageRoot || packageRoot === '-') {
    return {
      packageKind: null,
      manifestName: null,
      manifestSha256: null,
      packageFilesVerified: 0,
      bindingStatus: 'GIT_WORKTREE_ONLY'
    };
  }
  const manifestPath = path.resolve(packageManifest);
  const root = path.resolve(packageRoot);
  const expectedManifestPath = path.join(root, ACCEPTANCE_MANIFEST_NAME);
  if (manifestPath !== expectedManifestPath) {
    throw new Error(`Acceptance package manifest must be inside package root: ${expectedManifestPath}`);
  }
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`Acceptance package manifest is missing: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    throw new Error(`Acceptance package manifest is invalid JSON: ${error.message}`);
  }
  if (manifest.schemaVersion !== 4) throw new Error(`Acceptance package manifest schema ${manifest.schemaVersion} is not 4`);
  if (manifest.packageKind !== ACCEPTANCE_PACKAGE_KIND) {
    throw new Error(`Acceptance package kind mismatch: ${manifest.packageKind || 'missing'}`);
  }
  if (manifest.sourceCommit !== sourceCommit) throw new Error('Acceptance package source commit mismatch');
  if (manifest.sourceTree !== sourceTree) throw new Error('Acceptance package source tree mismatch');
  if (manifest.sourceArchive !== path.basename(sourceArchive)) throw new Error('Acceptance package source archive name mismatch');
  if (String(manifest.sourceSha256 || '').toLowerCase() !== String(expectedSourceSha256 || '').toLowerCase()) {
    throw new Error('Acceptance package source SHA-256 mismatch');
  }
  for (const key of ['batch14', 'themeLayout', 'focused', 'fix6dPrelaunch', 'backendFiles', 'backendTests']) {
    if (Number(manifest.exactAutomatedGates?.[key]) !== Number(expectedGates?.[key])) {
      throw new Error(`Acceptance package exact automated gates mismatch: ${key}`);
    }
  }
  const files = manifest.packageFiles;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length < 1) {
    throw new Error('Acceptance package file hash map is missing');
  }
  const mandatoryFiles = [...MANDATORY_ACCEPTANCE_FILES, path.basename(sourceArchive)];
  for (const requiredName of mandatoryFiles) {
    if (!Object.prototype.hasOwnProperty.call(files, requiredName)) {
      throw new Error(`Acceptance package mandatory file hash is missing: ${requiredName}`);
    }
  }
  const verified = {};
  for (const [relativeName, expectedHashValue] of Object.entries(files)) {
    if (!relativeName || path.isAbsolute(relativeName) || relativeName.split(/[\\/]+/u).includes('..')) {
      throw new Error(`Acceptance package file path is unsafe: ${relativeName}`);
    }
    const expectedHash = String(expectedHashValue || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(expectedHash)) {
      throw new Error(`Acceptance package file SHA-256 is invalid: ${relativeName}`);
    }
    const file = path.resolve(root, relativeName);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Acceptance package file escapes package root: ${relativeName}`);
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Acceptance package file is missing: ${relativeName}`);
    }
    const actualHash = sha256(file);
    if (actualHash !== expectedHash) {
      throw new Error(`Acceptance package file SHA-256 mismatch: ${relativeName}: ${actualHash} !== ${expectedHash}`);
    }
    verified[relativeName] = actualHash;
  }
  return {
    packageKind: manifest.packageKind,
    manifestName: path.basename(manifestPath),
    manifestSha256: sha256(manifestPath),
    packageFilesVerified: Object.keys(verified).length,
    packageFiles: verified,
    bindingStatus: 'MANIFEST_AND_FILES_SHA256_VERIFIED'
  };
}

function verifyEvidence({
  batch14Log,
  batch14Exit,
  themeLog,
  themeExit,
  focusedLog,
  focusedExit,
  prelaunchLog,
  prelaunchExit,
  themeAuditLog,
  themeAuditExit,
  backendLog,
  backendExit,
  expectedBatch14Tests = 3,
  expectedThemeTests = 43,
  expectedFocusedTests = 66,
  expectedPrelaunchTests = EXPECTED_ROUND11_PRELAUNCH_TESTS,
  expectedBackendFiles = 200,
  expectedBackendTests = 1201,
  expectedNodeVersion,
  expectedNpmVersion,
  sourceArchive,
  expectedSourceSha256,
  sourceCommit,
  sourceTree,
  packageManifest,
  packageRoot,
  runtime = runtimeIdentity()
}) {
  if (runtime.platform !== 'win32') throw new Error('Batch40 external acceptance requires win32');
  if (runtime.nodeVersion !== expectedNodeVersion) {
    throw new Error(`Node version mismatch: ${runtime.nodeVersion} !== ${expectedNodeVersion}`);
  }
  if (runtime.npmVersion !== expectedNpmVersion) {
    throw new Error(`npm version mismatch: ${runtime.npmVersion || 'unknown'} !== ${expectedNpmVersion}`);
  }

  const expectedGates = {
    batch14: Number(expectedBatch14Tests),
    themeLayout: Number(expectedThemeTests),
    focused: Number(expectedFocusedTests),
    fix6dPrelaunch: Number(expectedPrelaunchTests),
    backendFiles: Number(expectedBackendFiles),
    backendTests: Number(expectedBackendTests)
  };
  const acceptancePackage = verifyAcceptancePackage({
    packageManifest,
    packageRoot,
    sourceArchive,
    expectedSourceSha256,
    sourceCommit,
    sourceTree,
    expectedGates
  });
  const source = verifySourceArchive(sourceArchive, expectedSourceSha256);
  const batch14 = assertExactTestRun({
    output: fs.readFileSync(batch14Log, 'utf8'),
    exitCode: Number(batch14Exit),
    expectedTests: expectedBatch14Tests,
    label: 'Batch14'
  });
  const themeLayout = assertExactTestRun({
    output: fs.readFileSync(themeLog, 'utf8'),
    exitCode: Number(themeExit),
    expectedTests: expectedThemeTests,
    label: 'Theme/layout'
  });
  const focused = assertExactTestRun({
    output: fs.readFileSync(focusedLog, 'utf8'),
    exitCode: Number(focusedExit),
    expectedTests: expectedFocusedTests,
    label: 'Batch40 focused'
  });
  const fix6dPrelaunch = assertExactTestRun({
    output: fs.readFileSync(prelaunchLog, 'utf8'),
    exitCode: Number(prelaunchExit),
    expectedTests: expectedPrelaunchTests,
    label: 'FIX6D UI prelaunch'
  });
  const fix6cThemeAudit = assertThemeAuditPass({
    output: fs.readFileSync(themeAuditLog, 'utf8'),
    exitCode: Number(themeAuditExit)
  });

  if (Number(backendExit) !== 0) throw new Error(`Backend runner exit code was ${backendExit}`);
  const backend = parseBackendRun(fs.readFileSync(backendLog, 'utf8'));
  const requiredFiles = assertPositiveInteger(expectedBackendFiles, 'Expected backend file count');
  const requiredTests = assertPositiveInteger(expectedBackendTests, 'Expected backend total test count');
  if (backend.completedFiles !== requiredFiles) {
    throw new Error(`Backend completed file count ${backend.completedFiles} does not equal required ${requiredFiles}`);
  }
  if (backend.totalTests !== requiredTests) {
    throw new Error(`Backend total test count ${backend.totalTests} does not equal required ${requiredTests}`);
  }
  if (!backend.allPassed || backend.totalPass !== backend.totalTests ||
      backend.totalFail !== 0 || backend.totalSkipped !== 0 ||
      backend.totalCancelled !== 0 || backend.totalTodo !== 0) {
    throw new Error('Backend runner summaries are not strict all-pass results');
  }

  return {
    schemaVersion: 4,
    evidenceStatus: 'AUTOMATED_SOURCE_GATES_COMPLETE_EXTERNAL_PLATFORM_EVIDENCE_REQUIRED',
    sourceCommit,
    sourceTree,
    acceptancePackage,
    sourceArchive: source,
    platform: runtime.platform,
    nodeVersion: runtime.nodeVersion,
    npmVersion: runtime.npmVersion,
    batch14: { ...batch14, exitCode: Number(batch14Exit), logSha256: sha256(batch14Log) },
    themeLayout: { ...themeLayout, exitCode: Number(themeExit), logSha256: sha256(themeLog) },
    focused: { ...focused, exitCode: Number(focusedExit), logSha256: sha256(focusedLog) },
    fix6dPrelaunch: { ...fix6dPrelaunch, exitCode: Number(prelaunchExit), logSha256: sha256(prelaunchLog) },
    fix6cThemeAudit: { ...fix6cThemeAudit, exitCode: Number(themeAuditExit), logSha256: sha256(themeAuditLog) },
    backend: { ...backend, exitCode: Number(backendExit), logSha256: sha256(backendLog) },
    governance: { readyForPromotion: false, formalRelease: false }
  };
}

function main() {
  const [
    batch14Log, batch14Exit, themeLog, themeExit, focusedLog, focusedExit,
    prelaunchLog, prelaunchExit, themeAuditLog, themeAuditExit, backendLog, backendExit,
    expectedBatch14Tests, expectedThemeTests, expectedFocusedTests, expectedPrelaunchTests, expectedBackendFiles, expectedBackendTests,
    expectedNodeVersion, expectedNpmVersion, sourceArchive,
    expectedSourceSha256, sourceCommit, sourceTree, packageManifest, packageRoot, output
  ] = process.argv.slice(2);
  const receipt = verifyEvidence({
    batch14Log, batch14Exit, themeLog, themeExit, focusedLog, focusedExit,
    prelaunchLog, prelaunchExit, themeAuditLog, themeAuditExit, backendLog, backendExit,
    expectedBatch14Tests, expectedThemeTests, expectedFocusedTests, expectedPrelaunchTests, expectedBackendFiles, expectedBackendTests,
    expectedNodeVersion, expectedNpmVersion, sourceArchive,
    expectedSourceSha256, sourceCommit, sourceTree, packageManifest, packageRoot
  });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertExactTestRun,
  assertThemeAuditPass,
  parseBackendRun,
  runtimeIdentity,
  verifySourceArchive,
  verifyAcceptancePackage,
  verifyEvidence
};
