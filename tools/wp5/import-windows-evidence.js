#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, OUTPUT, identity, sha256File, writeJson } = require('./common');
const { readZipEntries } = require('./zip-utils');
const { REQUIRED_CHECK_IDS, finalizeReport } = require('./windows-legacy-runtime-cutover-evidence');

const FIXTURE_ROOT = path.join(ROOT, 'tests', 'wp5', 'fixtures', 'windows-cutover');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function parseArgs() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const exact = args.find(item => item.startsWith(`${flag}=`));
    if (exact) return path.resolve(exact.slice(flag.length + 1));
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
  };
  return {
    kit: value('--kit', path.join(FIXTURE_ROOT, 'WP5_Windows_Cutover_Validation_Kit_2026-07-05_v2.zip')),
    evidence: value('--evidence', path.join(FIXTURE_ROOT, 'WP5_Windows_Cutover_Evidence_2026-07-05.zip'))
  };
}
function parseJson(buffer, name) {
  try { return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw Object.assign(new Error(`Invalid JSON in ${name}: ${error.message}`), { code: 'WP5_WINDOWS_EVIDENCE_JSON_INVALID' }); }
}
function requireEntry(entries, name) {
  if (entries.has(name)) return entries.get(name);
  const suffix = `/${name}`;
  const matches = [...entries.entries()].filter(([entryName]) => entryName.endsWith(suffix));
  if (matches.length === 1) return matches[0][1];
  throw Object.assign(new Error(`Missing or ambiguous ZIP entry: ${name}`), { code: 'WP5_WINDOWS_EVIDENCE_ZIP_ENTRY_MISSING' });
}
function copyFile(source, name) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const target = path.join(OUTPUT, name);
  fs.copyFileSync(source, target);
  return { path: target, sha256: sha256File(target), sizeBytes: fs.statSync(target).size };
}

function main() {
  const args = parseArgs();
  const rawIdentity = identity();
  const currentIdentity = { ...rawIdentity, sourceTree: rawIdentity.worktreeSourceTree, implementationCommit: rawIdentity.sourceCommit };
  if (!currentIdentity.repositoryClean) throw Object.assign(new Error('Windows evidence import requires a clean repository'), { code: 'WP5_WINDOWS_IMPORT_REPOSITORY_NOT_CLEAN' });

  const kitZip = readZipEntries(args.kit);
  const manifestBytes = requireEntry(kitZip.entries, 'KIT_MANIFEST.json');
  const manifest = parseJson(manifestBytes, 'KIT_MANIFEST.json');
  const kitRows = [];
  const sourceRows = [];
  for (const expected of manifest.files || []) {
    const bytes = requireEntry(kitZip.entries, expected.path);
    const actual = { path: expected.path, sha256: sha256(bytes), sizeBytes: bytes.length };
    actual.matchesManifest = actual.sha256 === expected.sha256 && actual.sizeBytes === expected.sizeBytes;
    kitRows.push(actual);
    if (!actual.matchesManifest) throw Object.assign(new Error(`Validation kit file mismatch: ${expected.path}`), { code: 'WP5_WINDOWS_KIT_FILE_MISMATCH' });
    if (/^(electron|tests|tools)\//.test(expected.path)) {
      const sourceFile = path.join(ROOT, expected.path);
      const sourceExists = fs.existsSync(sourceFile);
      const sourceSha256 = sourceExists ? sha256File(sourceFile) : null;
      const sourceMatch = sourceExists && sourceSha256 === expected.sha256;
      sourceRows.push({ path: expected.path, sourceExists, expectedSha256: expected.sha256, sourceSha256, sourceMatch });
      if (!sourceMatch) throw Object.assign(new Error(`Windows execution source mismatch: ${expected.path}`), { code: 'WP5_WINDOWS_EXECUTION_SOURCE_MISMATCH' });
    }
  }

  const evidenceZip = readZipEntries(args.evidence);
  const rawBytes = requireEntry(evidenceZip.entries, 'windows-legacy-runtime-cutover.json');
  const raw = parseJson(rawBytes, 'windows-legacy-runtime-cutover.json');
  const recomputed = finalizeReport(raw.checks || [], raw.platform);
  const checkIdsExact = JSON.stringify(raw.requiredCheckIds || []) === JSON.stringify(REQUIRED_CHECK_IDS);
  const rawValid = raw.status === 'PASS' && raw.platform === 'win32' && raw.productionChainExecuted === true
    && checkIdsExact && recomputed.status === 'PASS'
    && (raw.completeness?.missing || []).length === 0
    && (raw.completeness?.duplicates || []).length === 0
    && (raw.completeness?.failed || []).length === 0;
  if (!rawValid) throw Object.assign(new Error('Windows raw evidence failed completeness or real-host validation'), { code: 'WP5_WINDOWS_RAW_EVIDENCE_INVALID' });

  const kitCopy = copyFile(args.kit, 'WP5_Windows_Cutover_Validation_Kit_2026-07-05_v2.zip');
  const evidenceCopy = copyFile(args.evidence, 'WP5_Windows_Cutover_Evidence_2026-07-05.zip');
  fs.writeFileSync(path.join(OUTPUT, 'KIT_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUTPUT, 'windows-legacy-runtime-cutover.windows.raw.json'), rawBytes);
  for (const optional of ['WP5_Windows_Validation_Report.md', 'LOG_FILES_NOTE.txt']) {
    const bytes = evidenceZip.entries.get(optional);
    if (bytes) fs.writeFileSync(path.join(OUTPUT, optional), bytes);
  }

  const report = {
    ...raw,
    schemaVersion: 2,
    phase: 'CONVERGENCE_PRE_REVIEW',
    identity: currentIdentity,
    sourceBinding: {
      status: 'PASS',
      implementationCommit: currentIdentity.sourceCommit,
      implementationSourceTree: currentIdentity.worktreeSourceTree,
      repositoryClean: currentIdentity.repositoryClean,
      validationKitDeclaredSourceTree: manifest.worktreeSourceTree,
      validationKitActivationBindingCommit: manifest.activationBindingCommit,
      executionFiles: sourceRows,
      executionFilesMatched: sourceRows.length,
      executionFilesMismatched: sourceRows.filter(row => !row.sourceMatch).length,
      bindingMethod: 'SELF_CONTAINED_VALIDATION_KIT_ZIP_MANIFEST_AND_FILE_HASH_RECONSTRUCTION'
    },
    provenance: {
      rawEvidenceSha256: sha256(rawBytes),
      validationKitZipSha256: kitCopy.sha256,
      evidenceBundleZipSha256: evidenceCopy.sha256,
      kitManifestSha256: sha256(manifestBytes),
      rawGeneratedAtUtc: raw.generatedAtUtc
    }
  };
  const artifact = writeJson('windows-legacy-runtime-cutover.json', report);
  const verification = writeJson('windows-evidence-source-binding.json', {
    schemaVersion: 1,
    stage: '6.4.5.9',
    workPackage: 'WP5',
    phase: 'CONVERGENCE_PRE_REVIEW',
    generatedAtUtc: new Date().toISOString(),
    status: 'PASS',
    identity: currentIdentity,
    rawEvidence: { status: raw.status, platform: raw.platform, productionChainExecuted: raw.productionChainExecuted, sha256: sha256(rawBytes) },
    validationKit: { manifest, files: kitRows, zipSha256: kitCopy.sha256 },
    implementationBinding: { sourceRows, allMatched: sourceRows.every(row => row.sourceMatch) }
  });
  console.log(JSON.stringify({ status: 'PASS', identity: currentIdentity, artifact, verification, kitCopy, evidenceCopy }, null, 2));
}

try { main(); }
catch (error) { console.error(JSON.stringify({ status: 'FAIL', reasonCode: error.code || 'WP5_WINDOWS_IMPORT_FAILED', message: error.message }, null, 2)); process.exitCode = 1; }
