#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_FILE_NAME = 'PRODUCT_EXPERIENCE_MATERIALIZED_UAT_MANIFEST.json';
const DOCUMENT_TYPE = 'V21_PRODUCT_EXPERIENCE_MATERIALIZED_UAT_CANDIDATE';
const BUNDLE_CLASSES = Object.freeze({
  DESKTOP: 'PRODUCT_EXPERIENCE_MATERIALIZED_DESKTOP_UAT_ONLY',
  MATRIX: 'PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY'
});
const ALLOWED_CLASSES = new Set(Object.values(BUNDLE_CLASSES));

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = code;
  error.details = details;
  throw error;
}

function assertIdentity({ candidateBranch, candidateCommit, candidateTree }) {
  if (typeof candidateBranch !== 'string' || candidateBranch.trim() !== candidateBranch || candidateBranch.length === 0) {
    fail('MATERIALIZED_UAT_BRANCH_INVALID', 'candidateBranch must be a non-empty canonical branch name');
  }
  for (const [label, value] of [['candidateCommit', candidateCommit], ['candidateTree', candidateTree]]) {
    if (!/^[0-9a-f]{40}$/.test(String(value || ''))) {
      fail('MATERIALIZED_UAT_GIT_IDENTITY_INVALID', `${label} must be a lowercase 40-character Git object ID`, { label, value });
    }
  }
}

function assertBundleClass(bundleClass) {
  if (!ALLOWED_CLASSES.has(bundleClass)) {
    fail('MATERIALIZED_UAT_BUNDLE_CLASS_INVALID', 'bundle class is not authorized for Product Experience UAT', { bundleClass });
  }
}

function assertRoot(root) {
  const absolute = path.resolve(String(root || ''));
  if (!root || !fs.existsSync(absolute)) fail('MATERIALIZED_UAT_ROOT_MISSING', 'candidate root does not exist', { root: absolute });
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('MATERIALIZED_UAT_ROOT_INVALID', 'candidate root must be a real non-symlink directory', { root: absolute });
  return fs.realpathSync(absolute);
}

function normalizeRelative(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (!relative || path.isAbsolute(relative)) fail('MATERIALIZED_UAT_PATH_INVALID', 'candidate file identity must be relative', { absolutePath });
  const parts = relative.split(path.sep);
  if (parts.some(part => !part || part === '.' || part === '..')) fail('MATERIALIZED_UAT_PATH_ESCAPE', 'candidate file identity escapes the bundle root', { relative });
  const normalized = parts.join('/');
  if (normalized.includes('\\') || normalized.startsWith('/') || normalized === MANIFEST_FILE_NAME) {
    fail('MATERIALIZED_UAT_PATH_INVALID', 'candidate file identity is not canonical', { normalized });
  }
  return normalized;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function enumerateRegularFiles(root) {
  const records = [];
  const seen = new Set();
  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) fail('MATERIALIZED_UAT_SYMLINK_FORBIDDEN', 'symbolic links are forbidden in materialized UAT bundles', { path: absolute });
      if (stat.isDirectory()) {
        const real = fs.realpathSync(absolute);
        const relativeReal = path.relative(root, real);
        if (relativeReal === '..' || relativeReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativeReal)) {
          fail('MATERIALIZED_UAT_PATH_ESCAPE', 'candidate directory resolves outside the bundle root', { path: absolute, real });
        }
        walk(real);
        continue;
      }
      if (!stat.isFile()) fail('MATERIALIZED_UAT_FILE_TYPE_FORBIDDEN', 'only regular files are allowed in materialized UAT bundles', { path: absolute });
      const relative = normalizeRelative(root, absolute);
      if (relative === MANIFEST_FILE_NAME) continue;
      if (seen.has(relative)) fail('MATERIALIZED_UAT_DUPLICATE_IDENTITY', 'duplicate candidate file identity', { relative });
      seen.add(relative);
      records.push(Object.freeze({ path: relative, sizeBytes: stat.size, sha256: sha256File(absolute) }));
    }
  }
  walk(root);
  records.sort((a, b) => a.path.localeCompare(b.path));
  return records;
}

function validateManifestShape(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.documentType !== DOCUMENT_TYPE || manifest.formalRelease !== false) {
    fail('MATERIALIZED_UAT_MANIFEST_INVALID', 'materialized UAT manifest header is invalid');
  }
  assertBundleClass(manifest.bundleClass);
  assertIdentity(manifest);
  if (!Array.isArray(manifest.files)) fail('MATERIALIZED_UAT_MANIFEST_INVALID', 'manifest files must be an array');
  const seen = new Set();
  let previous = null;
  for (const row of manifest.files) {
    if (!row || typeof row.path !== 'string' || row.path.includes('\\') || row.path.startsWith('/') || path.posix.isAbsolute(row.path)) {
      fail('MATERIALIZED_UAT_PATH_INVALID', 'manifest contains a non-canonical file path', { row });
    }
    const parts = row.path.split('/');
    if (!row.path || parts.some(part => !part || part === '.' || part === '..') || row.path === MANIFEST_FILE_NAME) {
      fail('MATERIALIZED_UAT_PATH_ESCAPE', 'manifest file path escapes or collides with the manifest', { path: row.path });
    }
    if (seen.has(row.path)) fail('MATERIALIZED_UAT_DUPLICATE_IDENTITY', 'manifest contains duplicate file identity', { path: row.path });
    if (previous !== null && previous.localeCompare(row.path) >= 0) fail('MATERIALIZED_UAT_MANIFEST_INVALID', 'manifest file records must be strictly sorted by path');
    if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0 || !/^[0-9a-f]{64}$/.test(String(row.sha256 || ''))) {
      fail('MATERIALIZED_UAT_MANIFEST_INVALID', 'manifest file size or SHA-256 is invalid', { row });
    }
    seen.add(row.path);
    previous = row.path;
  }
  return manifest;
}

function sealCandidateBundle({ root, bundleClass, candidateBranch, candidateCommit, candidateTree }) {
  assertBundleClass(bundleClass);
  assertIdentity({ candidateBranch, candidateCommit, candidateTree });
  const canonicalRoot = assertRoot(root);
  const manifest = {
    schemaVersion: 1,
    documentType: DOCUMENT_TYPE,
    bundleClass,
    candidateBranch,
    candidateCommit,
    candidateTree,
    formalRelease: false,
    files: enumerateRegularFiles(canonicalRoot)
  };
  validateManifestShape(manifest);
  fs.writeFileSync(path.join(canonicalRoot, MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return manifest;
}

function verifyCandidateBundle({ root, expectedBundleClass, candidateBranch, candidateCommit, candidateTree } = {}) {
  const canonicalRoot = assertRoot(root);
  const manifestPath = path.join(canonicalRoot, MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath) || !fs.lstatSync(manifestPath).isFile() || fs.lstatSync(manifestPath).isSymbolicLink()) {
    fail('MATERIALIZED_UAT_MANIFEST_MISSING', 'materialized UAT manifest is missing or not a regular file');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    fail('MATERIALIZED_UAT_MANIFEST_INVALID', `materialized UAT manifest JSON is invalid: ${error.message}`);
  }
  validateManifestShape(manifest);
  if (expectedBundleClass && manifest.bundleClass !== expectedBundleClass) fail('MATERIALIZED_UAT_BUNDLE_CLASS_MISMATCH', 'bundle class mismatch', { expectedBundleClass, actual: manifest.bundleClass });
  for (const [label, expected] of [['candidateBranch', candidateBranch], ['candidateCommit', candidateCommit], ['candidateTree', candidateTree]]) {
    if (expected !== undefined && manifest[label] !== expected) fail('MATERIALIZED_UAT_IDENTITY_MISMATCH', `${label} mismatch`, { expected, actual: manifest[label] });
  }
  const actual = enumerateRegularFiles(canonicalRoot);
  if (actual.length !== manifest.files.length) fail('MATERIALIZED_UAT_FILE_SET_MISMATCH', 'bundle has unexpected or missing files', { expected: manifest.files.length, actual: actual.length });
  for (let index = 0; index < manifest.files.length; index += 1) {
    const expected = manifest.files[index];
    const observed = actual[index];
    if (!observed || observed.path !== expected.path) fail('MATERIALIZED_UAT_FILE_SET_MISMATCH', 'bundle file set does not match manifest', { expected: expected.path, actual: observed?.path || null });
    if (observed.sizeBytes !== expected.sizeBytes) fail('MATERIALIZED_UAT_SIZE_MISMATCH', 'bundle file size mismatch', { path: expected.path, expected: expected.sizeBytes, actual: observed.sizeBytes });
    if (observed.sha256 !== expected.sha256) fail('MATERIALIZED_UAT_SHA256_MISMATCH', 'bundle file SHA-256 mismatch', { path: expected.path, expected: expected.sha256, actual: observed.sha256 });
  }
  return manifest;
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  if (!['seal', 'verify'].includes(command)) fail('MATERIALIZED_UAT_COMMAND_INVALID', 'usage: create-materialized-uat-candidate.js <seal|verify> --root <dir> [identity options]');
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) fail('MATERIALIZED_UAT_ARGUMENT_INVALID', `invalid argument near ${key || '<end>'}`);
    if (Object.hasOwn(options, key)) fail('MATERIALIZED_UAT_ARGUMENT_INVALID', `duplicate argument ${key}`);
    options[key] = value;
  }
  if (!options['--root']) fail('MATERIALIZED_UAT_ARGUMENT_INVALID', '--root is required');
  return { command, options };
}

function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);
    const common = {
      root: path.resolve(options['--root']),
      candidateBranch: options['--candidate-branch'],
      candidateCommit: options['--candidate-commit'],
      candidateTree: options['--candidate-tree']
    };
    const result = command === 'seal'
      ? sealCandidateBundle({ ...common, bundleClass: options['--bundle-class'] })
      : verifyCandidateBundle({ ...common, expectedBundleClass: options['--bundle-class'] });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', manifest: result }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'MATERIALIZED_UAT_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  BUNDLE_CLASSES,
  DOCUMENT_TYPE,
  MANIFEST_FILE_NAME,
  enumerateRegularFiles,
  sealCandidateBundle,
  verifyCandidateBundle
};
