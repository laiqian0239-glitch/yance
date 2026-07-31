#!/usr/bin/env node
'use strict';

const { optionValue } = require('./cli-options');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const yauzl = require('yauzl');
const { REPO_ROOT, sha256File, writeCanonicalJson } = require('./lib');
const { normalizeRelativePath, walkRegularFiles } = require('./pre-review-evidence-package');
const { readAndVerifyPreReviewSealedArtifact } = require('./pre-review-sealed-artifact');
const { verifyReviewBundle } = require('./verify-review-bundle');

const ENV_BY_ARGUMENT = Object.freeze({
  '--pack-root': 'WP7_CANDIDATE_PACK_ROOT',
  '--zip': 'WP7_CANDIDATE_ZIP',
  '--external-sha256': 'WP7_CANDIDATE_ZIP_SHA256',
  '--output': 'WP7_CANDIDATE_EXTERNAL_VERIFICATION',
  '--branch-ref': 'WP7_CANDIDATE_BRANCH_REF'
});
function arg(name, fallback = null) { return optionValue(name, { envName: ENV_BY_ARGUMENT[name], fallback }); }
function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}
function readJson(filePath, reasonCode) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(reasonCode, 'invalid JSON document', { filePath, message: error.message }); }
}
function assertRelativeSafe(value) {
  return normalizeRelativePath(value, 'candidate.path');
}
function parseInternalHashFile(packRoot, relativePath) {
  const filePath = path.join(packRoot, ...relativePath.split('/'));
  const rows = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) fail('WP7_CANDIDATE_INTERNAL_SHA256_INVALID', 'invalid internal hash line', { line });
    return { sha256: match[1], path: assertRelativeSafe(match[2]) };
  });
  if (new Set(rows.map((row) => row.path)).size !== rows.length) fail('WP7_CANDIDATE_INTERNAL_SHA256_INVALID', 'duplicate path in internal hash file');
  return rows;
}
function verifyInternalHashes(packRoot, relativePath) {
  const expected = walkRegularFiles(packRoot).filter((row) => row.path !== relativePath);
  const actual = parseInternalHashFile(packRoot, relativePath);
  const expectedMap = new Map(expected.map((row) => [row.path, row.sha256]));
  const actualMap = new Map(actual.map((row) => [row.path, row.sha256]));
  const missing = [...expectedMap.keys()].filter((key) => !actualMap.has(key));
  const extra = [...actualMap.keys()].filter((key) => !expectedMap.has(key));
  const mismatches = [...expectedMap.entries()].filter(([key, value]) => actualMap.get(key) !== value).map(([pathName, expectedSha256]) => ({ path: pathName, expectedSha256, actualSha256: actualMap.get(pathName) }));
  if (missing.length || extra.length || mismatches.length) fail('WP7_CANDIDATE_INTERNAL_SHA256_INVALID', 'internal hash inventory mismatch', { missing, extra, mismatches });
  return { count: expected.length };
}
function verifyArtifactManifest(packRoot, relativePath, excluded) {
  const document = readJson(path.join(packRoot, ...relativePath.split('/')), 'WP7_CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  if (document.documentType !== 'WP7_CPR_R9_ARTIFACT_MANIFEST' || !Array.isArray(document.artifacts) || document.artifactCount !== document.artifacts.length) fail('WP7_CANDIDATE_ARTIFACT_MANIFEST_INVALID', 'artifact manifest schema is invalid');
  const expected = walkRegularFiles(packRoot).filter((row) => !excluded.has(row.path));
  const actualMap = new Map();
  for (const row of document.artifacts) {
    const normalized = assertRelativeSafe(row.path);
    if (actualMap.has(normalized)) fail('WP7_CANDIDATE_ARTIFACT_MANIFEST_INVALID', 'duplicate artifact manifest path', { path: normalized });
    actualMap.set(normalized, row);
  }
  const missing = expected.filter((row) => !actualMap.has(row.path)).map((row) => row.path);
  const extra = [...actualMap.keys()].filter((key) => !expected.some((row) => row.path === key));
  const mismatches = expected.filter((row) => {
    const actual = actualMap.get(row.path);
    return actual && (actual.sha256 !== row.sha256 || actual.sizeBytes !== row.sizeBytes);
  }).map((row) => ({ path: row.path, expected: row, actual: actualMap.get(row.path) }));
  if (missing.length || extra.length || mismatches.length) fail('WP7_CANDIDATE_ARTIFACT_MANIFEST_INVALID', 'artifact manifest inventory mismatch', { missing, extra, mismatches });
  return { count: expected.length, document };
}
function parseGitTree(repoRoot, commit) {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', commit], { cwd: repoRoot, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  const records = new Map();
  for (const record of raw.toString('utf8').split('\0').filter(Boolean)) {
    const match = record.match(/^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/s);
    if (!match || match[2] !== 'blob') fail('WP7_CANDIDATE_SOURCE_ZIP_INVALID', 'candidate Git tree contains unsupported entry', { record });
    records.set(match[4], { mode: match[1], objectId: match[3] });
  }
  return records;
}
function readZipRecords(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const records = new Map();
      const unsafe = [];
      zip.readEntry();
      zip.on('entry', (entry) => {
        let name;
        try { name = assertRelativeSafe(entry.fileName.replace(/\/$/, '')); }
        catch (error) { unsafe.push(entry.fileName); zip.readEntry(); return; }
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        if (records.has(name)) { zip.close(); return reject(Object.assign(new Error('duplicate ZIP entry'), { reasonCode: 'WP7_CANDIDATE_SOURCE_ZIP_INVALID', details: { name } })); }
        const rawMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        // git archive emits ordinary 100644 ZIP members with DOS creator metadata
        // and no POSIX mode, while executable 100755 members carry Unix mode bits.
        // Treat only the exact zero-mode regular-file form as 100644; all non-zero
        // modes remain explicitly compared to the reviewed Git tree.
        const mode = rawMode === 0 ? '100644' : rawMode.toString(8).padStart(6, '0');
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { zip.close(); return reject(streamError); }
          const sha1 = crypto.createHash('sha1');
          sha1.update(`blob ${entry.uncompressedSize}\0`);
          const sha256 = crypto.createHash('sha256');
          let size = 0;
          stream.on('data', (chunk) => { size += chunk.length; sha1.update(chunk); sha256.update(chunk); });
          stream.on('error', (error) => { zip.close(); reject(error); });
          stream.on('end', () => {
            records.set(name, { mode, objectId: sha1.digest('hex'), sha256: sha256.digest('hex'), sizeBytes: size });
            zip.readEntry();
          });
        });
      });
      zip.on('error', reject);
      zip.on('end', () => {
        if (unsafe.length) return reject(Object.assign(new Error('unsafe ZIP paths'), { reasonCode: 'WP7_CANDIDATE_SOURCE_ZIP_INVALID', details: { unsafe } }));
        resolve(records);
      });
    });
  });
}
function readOuterCandidateZipRecords(zipPath, expectedRootName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const records = new Map();
      const unsafe = [];
      zip.readEntry();
      zip.on('entry', (entry) => {
        const rawName = entry.fileName.replace(/\/+$/, '');
        let name;
        try { name = assertRelativeSafe(rawName); }
        catch (error) { unsafe.push(entry.fileName); zip.readEntry(); return; }
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        const prefix = `${expectedRootName}/`;
        if (!name.startsWith(prefix)) {
          unsafe.push(entry.fileName);
          zip.readEntry();
          return;
        }
        const relative = assertRelativeSafe(name.slice(prefix.length));
        if (records.has(relative)) {
          zip.close();
          return reject(Object.assign(new Error('duplicate candidate ZIP entry'), { reasonCode: 'WP7_CANDIDATE_OUTER_ZIP_INVALID', details: { path: relative } }));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { zip.close(); return reject(streamError); }
          const sha256 = crypto.createHash('sha256');
          let sizeBytes = 0;
          stream.on('data', (chunk) => { sizeBytes += chunk.length; sha256.update(chunk); });
          stream.on('error', (error) => { zip.close(); reject(error); });
          stream.on('end', () => {
            records.set(relative, { path: relative, sizeBytes, sha256: sha256.digest('hex') });
            zip.readEntry();
          });
        });
      });
      zip.on('error', reject);
      zip.on('end', () => {
        if (unsafe.length) return reject(Object.assign(new Error('unsafe or wrongly rooted candidate ZIP paths'), { reasonCode: 'WP7_CANDIDATE_OUTER_ZIP_INVALID', details: { unsafe } }));
        resolve(records);
      });
    });
  });
}

async function verifyOuterCandidateZip(packRoot, zipPath) {
  const rootName = path.basename(packRoot);
  const expectedRows = walkRegularFiles(packRoot);
  const expected = new Map(expectedRows.map((row) => [row.path, row]));
  const actual = await readOuterCandidateZipRecords(zipPath, rootName);
  const missing = [...expected.keys()].filter((key) => !actual.has(key));
  const extra = [...actual.keys()].filter((key) => !expected.has(key));
  const mismatches = [];
  for (const [filePath, row] of expected) {
    const got = actual.get(filePath);
    if (got && (got.sha256 !== row.sha256 || got.sizeBytes !== row.sizeBytes)) mismatches.push({ path: filePath, expected: row, actual: got });
  }
  if (missing.length || extra.length || mismatches.length) {
    fail('WP7_CANDIDATE_OUTER_ZIP_INVALID', 'outer candidate ZIP is not an exact projection of packRoot', { missing, extra, mismatches });
  }
  return { rootName, fileCount: expected.size, missing: 0, extra: 0, mismatches: 0 };
}

async function verifySourceZip(repoRoot, candidateHead, zipPath) {
  const expected = parseGitTree(repoRoot, candidateHead);
  const actual = await readZipRecords(zipPath);
  const missing = [...expected.keys()].filter((key) => !actual.has(key));
  const extra = [...actual.keys()].filter((key) => !expected.has(key));
  const mismatches = [];
  for (const [filePath, row] of expected) {
    const got = actual.get(filePath);
    if (got && (got.objectId !== row.objectId || got.mode !== row.mode)) mismatches.push({ path: filePath, expected: row, actual: got });
  }
  if (missing.length || extra.length || mismatches.length) fail('WP7_CANDIDATE_SOURCE_ZIP_INVALID', 'source ZIP is not an exact Git tree projection', { missing, extra, mismatches });
  return { trackedBlobCount: expected.size, zipFileCount: actual.size, missing: 0, extra: 0, contentOrModeMismatches: 0 };
}
function verifyPatch(bundlePath, baseline, patchPath, expectedTree) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-candidate-patch-'));
  const repo = path.join(root, 'repo');
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-checkout', bundlePath, repo], { stdio: 'ignore' });
    execFileSync('git', ['checkout', '--detach', baseline], { cwd: repo, stdio: 'ignore' });
    const result = spawnSync('git', ['apply', '--index', '--binary', patchPath], { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    if (result.status !== 0) fail('WP7_CANDIDATE_PATCH_RECONSTRUCTION_FAILED', 'candidate patch failed to apply', { baseline, patchPath, stdout: result.stdout, stderr: result.stderr });
    const actualTree = git(['write-tree'], repo);
    if (actualTree !== expectedTree) fail('WP7_CANDIDATE_PATCH_RECONSTRUCTION_FAILED', 'candidate patch reconstructed wrong tree', { baseline, patchPath, expectedTree, actualTree });
    return { expectedTree, actualTree };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function verifyDelivery(packRoot) {
  const relative = 'delivery/WP7_CPR_R9_CANDIDATE_DELIVERY.json';
  const document = readJson(path.join(packRoot, ...relative.split('/')), 'WP7_CANDIDATE_DELIVERY_INVALID');
  const expected = {
    documentType: 'WP7_CPR_R9_CONVERGENCE_PRE_REVIEW_CANDIDATE_DELIVERY',
    deliveryStatus: 'CANDIDATE_PENDING_INDEPENDENT_REVIEW',
    artifactClass: 'WP7_PRE_REVIEW_ONLY',
    evidenceClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    trustedProductProbeExecutions: 'PASS_9_OF_9',
    independentReviewStatus: 'PENDING',
    preAcceptanceIssued: false,
    finalPackagingAuthorized: false,
    finalAcceptanceStatus: 'NOT_ACCEPTED',
    formalWindowsEvidenceEligible: false
  };
  const mismatches = Object.entries(expected).filter(([key, value]) => document[key] !== value).map(([field, value]) => ({ field, expected: value, actual: document[field] }));
  if (mismatches.length) fail('WP7_CANDIDATE_DELIVERY_INVALID', 'candidate delivery status or classification is invalid', { mismatches });
  if (!/^[0-9a-f]{40}$/.test(document.implementationCommit) || !/^[0-9a-f]{40}$/.test(document.candidateGovernanceHead)) fail('WP7_CANDIDATE_DELIVERY_INVALID', 'candidate delivery identity is incomplete');
  return document;
}
async function verifyCandidate(options) {
  const packRoot = fs.realpathSync(options.packRoot);
  const delivery = verifyDelivery(packRoot);
  const bundle = fs.readdirSync(path.join(packRoot, 'git')).filter((name) => name.endsWith('.bundle'));
  const source = fs.readdirSync(path.join(packRoot, 'source')).filter((name) => name.endsWith('.zip'));
  const patches = fs.readdirSync(path.join(packRoot, 'patch')).filter((name) => name.endsWith('.patch'));
  if (bundle.length !== 1 || source.length !== 1 || patches.length !== 3) fail('WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'candidate core Git artifacts are incomplete', { bundle, source, patches });
  const bundlePath = path.join(packRoot, 'git', bundle[0]);
  const branchRef = options.branchRef || 'refs/heads/stage/6.4.5.9-architecture-closure';
  const bundleVerification = verifyReviewBundle(bundlePath, { branchRef });
  if (bundleVerification.branchHead !== delivery.candidateGovernanceHead) fail('WP7_CANDIDATE_BUNDLE_HEAD_MISMATCH', 'bundle head differs from delivery identity');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-candidate-verify-'));
  const repo = path.join(temp, 'repo');
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-checkout', bundlePath, repo], { stdio: 'ignore' });
    const implementationTree = git(['rev-parse', `${delivery.implementationCommit}^{tree}`], repo);
    const candidateTree = git(['rev-parse', `${delivery.candidateGovernanceHead}^{tree}`], repo);
    if (implementationTree !== delivery.implementationTree || candidateTree !== delivery.candidateGovernanceTree) fail('WP7_CANDIDATE_DELIVERY_INVALID', 'delivery tree identities mismatch bundle objects');
    if (git(['rev-parse', `${delivery.candidateGovernanceHead}^`], repo) !== delivery.implementationCommit) fail('WP7_CANDIDATE_GOVERNANCE_PARENT_INVALID', 'candidate is not a direct child of implementation');

    const completePatch = patches.find((name) => name.includes('Complete_From_Rejected'));
    const implementationPatch = patches.find((name) => name.includes('Implementation_From_Rejected'));
    const governancePatch = patches.find((name) => name.includes('Candidate_Governance'));
    if (!completePatch || !implementationPatch || !governancePatch) fail('WP7_CANDIDATE_PATCH_RECONSTRUCTION_FAILED', 'required candidate patch classes are missing', { patches });
    const patchReconstruction = {
      completeFromRejected: verifyPatch(bundlePath, delivery.rejectedCandidateBaseline, path.join(packRoot, 'patch', completePatch), candidateTree),
      implementationFromRejected: verifyPatch(bundlePath, delivery.rejectedCandidateBaseline, path.join(packRoot, 'patch', implementationPatch), implementationTree),
      candidateGovernance: verifyPatch(bundlePath, delivery.implementationCommit, path.join(packRoot, 'patch', governancePatch), candidateTree)
    };
    const sourceZip = await verifySourceZip(repo, delivery.candidateGovernanceHead, path.join(packRoot, 'source', source[0]));

    const sealFiles = fs.readdirSync(path.join(packRoot, 'trusted-product')).filter((name) => name.includes('SEALED') && name.endsWith('.json'));
    if (sealFiles.length !== 1) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_MISSING', 'candidate must contain exactly one Pre-Review sealed artifact', { sealFiles });
    const seal = readAndVerifyPreReviewSealedArtifact(path.join(packRoot, 'trusted-product', sealFiles[0]), {
      sourceCommit: delivery.implementationCommit,
      sourceTree: delivery.implementationTree,
      buildSessionId: delivery.buildSessionId,
      buildId: delivery.buildId
    });
    if (seal.sha256 !== delivery.preReviewSealedArtifactSha256) fail('WP7_CANDIDATE_DELIVERY_INVALID', 'delivery seal SHA does not match actual file');

    const internal = verifyInternalHashes(packRoot, 'delivery/WP7_CPR_R9_INTERNAL_SHA256.txt');
    const manifest = verifyArtifactManifest(packRoot, 'delivery/WP7_CPR_R9_ARTIFACT_MANIFEST.json', new Set([
      'delivery/WP7_CPR_R9_ARTIFACT_MANIFEST.json',
      'delivery/WP7_CPR_R9_INTERNAL_SHA256.txt',
      'verification/WP7_CANDIDATE_PACKAGE_CORE_VALIDATION.json'
    ]));

    let outerZip = null;
    if (options.zipPath) {
      const zipPath = fs.realpathSync(options.zipPath);
      const externalShaPath = options.externalShaPath ? fs.realpathSync(options.externalShaPath) : `${zipPath}.sha256`;
      const match = fs.readFileSync(externalShaPath, 'utf8').trim().match(/^([0-9a-f]{64})  (.+)$/);
      if (!match || match[1] !== sha256File(zipPath) || match[2] !== path.basename(zipPath)) fail('WP7_CANDIDATE_EXTERNAL_SHA256_INVALID', 'outer candidate ZIP external SHA256 is invalid');
      outerZip = await verifyOuterCandidateZip(packRoot, zipPath);
    }

    return {
      schemaVersion: 1,
      documentType: 'WP7_CANDIDATE_PACKAGE_EXTERNAL_VERIFICATION',
      status: 'PASS',
      verifiedAtUtc: new Date().toISOString(),
      implementationCommit: delivery.implementationCommit,
      implementationTree,
      candidateGovernanceHead: delivery.candidateGovernanceHead,
      candidateGovernanceTree: candidateTree,
      bundleVerification: 'PASS_COMPLETE_HISTORY_AND_REQUIRED_ANNOTATED_TAG',
      patchReconstruction,
      sourceZip,
      internalHashCount: internal.count,
      artifactManifestCount: manifest.count,
      outerCandidateZip: outerZip,
      preReviewSealedArtifactSha256: seal.sha256,
      deliveryStatus: delivery.deliveryStatus,
      preAcceptanceIssued: delivery.preAcceptanceIssued,
      finalPackagingAuthorized: delivery.finalPackagingAuthorized,
      finalAcceptanceStatus: delivery.finalAcceptanceStatus
    };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (require.main === module) {
  verifyCandidate({
    packRoot: arg('--pack-root'),
    zipPath: arg('--zip') || undefined,
    externalShaPath: arg('--external-sha256') || undefined,
    branchRef: arg('--branch-ref') || undefined
  }).then((result) => {
    const output = arg('--output');
    if (output) writeCanonicalJson(path.resolve(output), result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_CANDIDATE_VERIFY_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exit(1);
  });
}

module.exports = { readOuterCandidateZipRecords, verifyCandidate, verifyOuterCandidateZip, verifySourceZip };
