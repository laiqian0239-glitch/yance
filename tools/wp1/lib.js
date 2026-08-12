'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { validateReleaseManifest } = require('../../shared/release/releaseManifestSchema');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_SOURCE_PATH = path.join(REPO_ROOT, 'release', 'release-source.json');
const ARTIFACT_CLASS = 'PIPELINE_TEST_ONLY';
const FINAL_REUSE_REASON = 'FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT';
const PAYLOAD_EXCLUDED_PATHS = new Set([
  'payload-files.json',
  'release-manifest.json',
  'release-manifest.sha256',
  'release-evidence.json',
  'resources/payload-files.json',
  'resources/release-manifest.json',
  'resources/release-manifest.sha256'
]);
const RUNTIME_PAYLOAD_ALLOWLIST = Object.freeze([
  { source: 'backend', destination: 'backend', excludedPrefixes: ['tests/'] },
  { source: 'frontend', destination: 'frontend', excludedPrefixes: [] },
  { source: 'shared', destination: 'shared', excludedPrefixes: [] },
  { source: 'electron', destination: 'electron_runtime', excludedPrefixes: [] },
  { source: 'diagnostics', destination: 'diagnostics', excludedPrefixes: [] }
]);
const FORBIDDEN_RUNTIME_SEGMENTS = Object.freeze([
  'tests/', 'evidence/', 'verification/', 'tools/', 'installer/', 'installers/',
  'packaging/', 'build-scripts/', 'release-scripts/', 'docs/', 'blueprint/'
]);
const RELEASE_IDENTITY_SCAN_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.yml', '.yaml',
  '.ps1', '.cmd', '.bat', '.nsh', '.iss'
]);
const RELEASE_IDENTITY_SCAN_ROOTS = Object.freeze([
  'backend/', 'frontend/', 'electron/', 'installer/', 'installers/',
  'diagnostics/', 'shared/', 'tools/', 'packaging/', 'build-scripts/',
  'release-scripts/', 'release/', 'deploy/', '.github/workflows/'
]);
const RELEASE_IDENTITY_SCAN_EXCLUDED_PREFIXES = Object.freeze([
  'evidence/', 'verification/', 'tests/', 'fixtures/', 'test-fixtures/',
  'dist/', 'build/', 'release-output/', 'staging/', 'node_modules/', '.git/'
]);
const WP1_PROVENANCE_PROTECTED_PATHS = Object.freeze([
  '.wp1-pipeline-test-artifact.json',
  'Yance-PIPELINE-TEST-ONLY.bin',
  'pipeline-summary.json',
  'wp1-provenance-index.json',
  'build-session-receipt.json',
  'resources/release-manifest.json',
  'resources/release-manifest.sha256',
  'resources/payload-files.json',
  'release-evidence.json'
]);
const PROVENANCE_INDEX_REQUIRED_REASON = 'WP1_PROVENANCE_INDEX_REQUIRED';

class Wp1Error extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'Wp1Error';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function assertRuntimePayloadBranding(payloadRoot) {
  const auditScript = path.join(REPO_ROOT, 'scripts', 'branding', 'audit-yance-brand.js');
  const result = spawnSync(process.execPath, [auditScript, '--scan-root', payloadRoot, '--scope', 'PACKAGED'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  let report = null;
  try { report = JSON.parse(String(result.stdout || '')); } catch (_) {}
  if (result.status !== 0 || !report || report.status !== 'PASS') {
    throw new Wp1Error('WP1_RUNTIME_PAYLOAD_BRAND_VIOLATION', 'runtime payload contains an unexplained or user-visible legacy brand identifier', {
      payloadRoot,
      exitCode: result.status,
      signal: result.signal || null,
      stderr: String(result.stderr || '').slice(0, 4000),
      report
    });
  }
  return report;
}
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { return sha256Buffer(fs.readFileSync(filePath)); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
}
function canonicalJsonBuffer(value) { return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`, 'utf8'); }
function writeCanonicalJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, canonicalJsonBuffer(value));
}
function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitIdentity(repoRoot = REPO_ROOT) {
  const sourceCommit = git(['rev-parse', 'HEAD'], repoRoot);
  const sourceTree = git(['rev-parse', 'HEAD^{tree}'], repoRoot);
  const porcelain = git(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot);
  return { sourceCommit, sourceTree, repositoryClean: porcelain === '' };
}

function validateReleaseSource(source) {
  const required = [
    'productName', 'publicProductName', 'publicProductNameEnglish', 'productVersion', 'publicVersion',
    'internalProductId', 'executableName', 'installDirectoryName', 'userDataDirectoryName', 'brandingEpoch',
    'installerBaseName', 'internalName', 'originalFilename', 'appUserModelId',
    'stageVersion', 'phase', 'distributionMode', 'releaseChannel', 'onlineUpdatesEnabled', 'updateMode',
    'formalPublicReleaseAuthorized', 'legacyCompatibility',
    'apiContractVersion', 'credentialProtocolVersion', 'runtimeLockProtocolVersion'
  ];
  for (const key of required) {
    if (source[key] === undefined || source[key] === null || source[key] === '') {
      throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', `release source is missing ${key}`, { key });
    }
  }
  if ('databaseSchemaVersion' in source) {
    throw new Wp1Error('WP1_RELEASE_SOURCE_CONTAINS_DERIVED_FIELD', 'databaseSchemaVersion must be derived from migration authority, not maintained in release-source.json');
  }
  if (source.distributionMode !== 'LOCAL_PRIVATE_UNSIGNED') {
    throw new Wp1Error('WP1_DISTRIBUTION_MODE_INVALID', 'WP1 only permits LOCAL_PRIVATE_UNSIGNED');
  }
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(source.publicVersion))) {
    throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', 'publicVersion must use a numeric dotted version', { value: source.publicVersion });
  }
  if (!Number.isInteger(source.brandingEpoch) || source.brandingEpoch < 1) {
    throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', 'brandingEpoch must be a positive integer', { value: source.brandingEpoch });
  }
  const expectedBrand = {
    productName: '言策', publicProductName: '言策', publicProductNameEnglish: 'Yance',
    internalProductId: 'Yance', executableName: 'Yance.exe', installDirectoryName: 'Yance', userDataDirectoryName: 'Yance',
    installerBaseName: 'Yance-Setup', internalName: 'Yance', originalFilename: 'Yance.exe', appUserModelId: 'com.yance.desktop'
  };
  for (const [key, value] of Object.entries(expectedBrand)) {
    if (source[key] !== value) throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', `${key} must equal the approved Yance identity`, { key, expected: value, actual: source[key] });
  }
  if (source.releaseChannel !== 'INTERNAL_TEST_ONLY' || source.onlineUpdatesEnabled !== false || source.updateMode !== 'MANUAL_INSTALLER_ONLY' || source.formalPublicReleaseAuthorized !== false) {
    throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', 'current release source must remain internal-test-only, manual-update, and not publicly authorized');
  }
  const legacy = source.legacyCompatibility;
  if (!legacy || typeof legacy !== 'object' || legacy.userVisible !== false || !Number.isInteger(legacy.sunsetAfterBrandingEpoch) || legacy.sunsetAfterBrandingEpoch <= source.brandingEpoch) {
    throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', 'legacyCompatibility must be non-visible and time-bounded', { legacyCompatibility: legacy });
  }
  for (const field of ['productIds', 'executableNames', 'dataDirectoryNames', 'registryKeys', 'runtimeMutexPrefixes']) {
    if (!Array.isArray(legacy[field]) || legacy[field].length === 0 || legacy[field].some(value => typeof value !== 'string' || !value.trim())) {
      throw new Wp1Error('WP1_RELEASE_SOURCE_INVALID', `legacyCompatibility.${field} must be a non-empty string array`, { field });
    }
  }
  return source;
}
function readReleaseSource(filePath = RELEASE_SOURCE_PATH) { return validateReleaseSource(readJson(filePath)); }

function deriveDatabaseSchemaVersion(repoRoot = REPO_ROOT) {
  const migrationsRoot = path.join(repoRoot, 'backend', 'migrations');
  if (!fs.existsSync(migrationsRoot)) {
    throw new Wp1Error('WP1_DATABASE_SCHEMA_AUTHORITY_MISSING', 'backend migration directory is missing');
  }
  const authorities = [];
  for (const name of fs.readdirSync(migrationsRoot).sort()) {
    if (!/\.js$/i.test(name)) continue;
    const filePath = path.join(migrationsRoot, name);
    const text = fs.readFileSync(filePath, 'utf8');
    for (const match of text.matchAll(/\bTARGET_SCHEMA_VERSION\s*=\s*(\d+)\b/g)) {
      authorities.push({ path: `backend/migrations/${name}`, version: Number(match[1]) });
    }
  }
  if (!authorities.length) {
    throw new Wp1Error('WP1_DATABASE_SCHEMA_AUTHORITY_MISSING', 'no TARGET_SCHEMA_VERSION was found in real migrations');
  }
  const databaseSchemaVersion = Math.max(...authorities.map(item => item.version));
  return { databaseSchemaVersion, authorities };
}

function isReleaseIdentityScanCandidate(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized === 'package.json') return true;
  if (normalized === 'release/release-source.json') return false;
  if (RELEASE_IDENTITY_SCAN_EXCLUDED_PREFIXES.some(prefix => normalized.startsWith(prefix))) return false;
  if (/(^|\/)(evidence|verification|tests|fixtures?|test-fixtures|dist|build|release-output|staging|node_modules)(\/|$)/i.test(normalized)) return false;
  const isRootSource = !normalized.includes('/');
  if (!isRootSource && !RELEASE_IDENTITY_SCAN_ROOTS.some(prefix => normalized.startsWith(prefix))) return false;
  return RELEASE_IDENTITY_SCAN_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function releaseIdentityViolationsForText(relativePath, text, releaseSource) {
  const violations = [];
  const namedAssignment = /\b(?:const\s+|let\s+|var\s+)?(productVersion|stageVersion|buildId)\s*[:=]\s*(["'`])([^"'`]+)\2/g;
  for (const match of text.matchAll(namedAssignment)) {
    violations.push({
      path: relativePath,
      field: match[1],
      value: match[3],
      reasonCode: match[1] === 'buildId' ? 'WP1_RUNTIME_HARDCODED_BUILD_ID' : 'WP1_DUPLICATE_MANUAL_RELEASE_IDENTITY'
    });
  }
  const yamlOrJsonKey = /^\s*["']?(productVersion|stageVersion|buildId)["']?\s*:\s*["']([^"']+)["']/gm;
  for (const match of text.matchAll(yamlOrJsonKey)) {
    violations.push({
      path: relativePath,
      field: match[1],
      value: match[2],
      reasonCode: match[1] === 'buildId' ? 'WP1_RUNTIME_HARDCODED_BUILD_ID' : 'WP1_DUPLICATE_MANUAL_RELEASE_IDENTITY'
    });
  }
  const hardcodedBuildId = /\bYANCE-[0-9A-Za-z._-]+-S[0-9.]+-P1-[0-9a-f]{7,40}-[0-9TZ.-]+\b/g;
  for (const match of text.matchAll(hardcodedBuildId)) {
    violations.push({ path: relativePath, field: 'buildId', value: match[0], reasonCode: 'WP1_RUNTIME_HARDCODED_BUILD_ID' });
  }
  return violations;
}

function scanSingleHumanMaintainedReleaseSource(repoRoot = REPO_ROOT, releaseSource = readReleaseSource(path.join(repoRoot, 'release', 'release-source.json'))) {
  const violations = [];
  const packagePath = path.join(repoRoot, 'package.json');
  const pkg = readJson(packagePath);
  if (pkg.version !== '0.0.0-development') {
    violations.push({ path: 'package.json', field: 'version', reasonCode: 'WP1_PACKAGE_METADATA_RELEASE_IDENTITY_FORBIDDEN', value: pkg.version });
  }
  const packageDescription = String(pkg.description || '');
  if (packageDescription.includes(releaseSource.productVersion) || packageDescription.includes(releaseSource.stageVersion) || /Stage\s+\d+(?:\.\d+)+/i.test(packageDescription)) {
    violations.push({ path: 'package.json', field: 'description', reasonCode: 'WP1_PACKAGE_METADATA_RELEASE_IDENTITY_FORBIDDEN', value: packageDescription });
  }
  if (pkg.buildId || pkg.productVersion || pkg.stageVersion || pkg.yanceRelease?.productVersion || pkg.yanceRelease?.stageVersion || pkg.yanceRelease?.buildId) {
    violations.push({ path: 'package.json', field: 'releaseIdentityMetadata', reasonCode: 'WP1_PACKAGE_METADATA_RELEASE_IDENTITY_FORBIDDEN' });
  }

  const tracked = git(['ls-files', '-z'], repoRoot).split('\0').filter(Boolean);
  const candidates = tracked.filter(isReleaseIdentityScanCandidate);
  for (const relative of candidates) {
    const full = path.join(repoRoot, relative);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    violations.push(...releaseIdentityViolationsForText(relative, text, releaseSource));
  }

  const deduped = [];
  const seen = new Set();
  for (const violation of violations) {
    const key = `${violation.path}\0${violation.field || ''}\0${violation.reasonCode}\0${violation.value || ''}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(violation); }
  }
  return {
    status: deduped.length ? 'FAIL' : 'PASS',
    reasonCode: deduped.length ? deduped[0].reasonCode : null,
    releaseSourcePath: 'release/release-source.json',
    enumerationMethod: 'git ls-files -z',
    scannedTrackedFileCount: tracked.length,
    scanCandidateFileCount: candidates.length,
    scanRoots: RELEASE_IDENTITY_SCAN_ROOTS,
    excludedPrefixes: RELEASE_IDENTITY_SCAN_EXCLUDED_PREFIXES,
    violations: deduped
  };
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || !String(value).endsWith('Z')) {
    throw new Wp1Error('WP1_BUILD_TIMESTAMP_INVALID', 'build timestamp must be valid RFC3339 UTC');
  }
  return date.toISOString();
}
function buildIdFrom({ releaseSource, sourceCommit, buildTimestampUtc }) {
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))) {
    throw new Wp1Error('WP1_SOURCE_COMMIT_INVALID', 'sourceCommit must be a full lowercase 40-character Git commit');
  }
  const iso = normalizeTimestamp(buildTimestampUtc);
  const stamp = iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `YANCE-${releaseSource.productVersion}-S${releaseSource.stageVersion}-P1-${sourceCommit.slice(0, 12)}-${stamp}`;
}

function canonicalizeRelativePayloadPath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Wp1Error('WP1_PAYLOAD_PATH_INVALID', 'payload path must be a non-empty string without NUL');
  }
  const slash = input.replace(/\\/g, '/');
  if (slash.startsWith('/') || slash.startsWith('//') || /^[A-Za-z]:\//.test(slash) || path.posix.isAbsolute(slash)) {
    throw new Wp1Error('WP1_PAYLOAD_ABSOLUTE_PATH_REJECTED', 'absolute, drive-letter, and UNC payload paths are forbidden', { path: input });
  }
  const rawSegments = slash.split('/');
  if (rawSegments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    const reasonCode = rawSegments.includes('..') ? 'WP1_PAYLOAD_PARENT_TRAVERSAL_REJECTED' : 'WP1_PAYLOAD_PATH_INVALID';
    throw new Wp1Error(reasonCode, 'payload path contains invalid segments', { path: input });
  }
  return rawSegments.map(segment => segment.normalize('NFC')).join('/');
}
function compareUtf8(a, b) { return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); }
function canonicalizePayloadRecords(entries) {
  const normalized = [];
  const exact = new Map();
  const windowsFold = new Map();
  for (const entry of entries) {
    const canonicalPath = canonicalizeRelativePayloadPath(entry.path);
    const exactPrevious = exact.get(canonicalPath);
    if (exactPrevious) {
      throw new Wp1Error('WP1_PAYLOAD_UNICODE_NORMALIZATION_COLLISION', 'payload paths collide after Unicode NFC normalization', { path: entry.path, collidesWith: exactPrevious });
    }
    const folded = canonicalPath.toLowerCase();
    const foldedPrevious = windowsFold.get(folded);
    if (foldedPrevious && foldedPrevious !== canonicalPath) {
      throw new Wp1Error('WP1_PAYLOAD_WINDOWS_CASE_COLLISION', 'payload paths collide under Windows case-insensitive comparison', { path: canonicalPath, collidesWith: foldedPrevious });
    }
    exact.set(canonicalPath, entry.path);
    windowsFold.set(folded, canonicalPath);
    if (!Number.isSafeInteger(Number(entry.sizeBytes)) || Number(entry.sizeBytes) < 0) {
      throw new Wp1Error('WP1_PAYLOAD_SIZE_INVALID', 'payload sizeBytes must be a non-negative safe integer', { path: canonicalPath });
    }
    if (!/^[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) {
      throw new Wp1Error('WP1_PAYLOAD_SHA256_INVALID', 'payload sha256 must be a lowercase 64-character hexadecimal value', { path: canonicalPath });
    }
    normalized.push({ path: canonicalPath, sizeBytes: Number(entry.sizeBytes), sha256: String(entry.sha256) });
  }
  return normalized.sort((a, b) => compareUtf8(a.path, b.path));
}
function walkFiles(rootDir) {
  const output = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareUtf8(a.name, b.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Wp1Error('WP1_PAYLOAD_SYMLINK_REJECTED', 'symbolic links are not permitted', { path: path.relative(rootDir, fullPath) });
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) output.push(fullPath);
    }
  }
  if (fs.existsSync(rootDir)) visit(rootDir);
  return output;
}
function generatePayloadRecords(payloadRoot, options = {}) {
  const excludedPaths = new Set(options.excludedPaths || PAYLOAD_EXCLUDED_PATHS);
  const entries = [];
  for (const filePath of walkFiles(payloadRoot)) {
    const relativeRaw = path.relative(payloadRoot, filePath).split(path.sep).join('/');
    const canonicalRelative = canonicalizeRelativePayloadPath(relativeRaw);
    if (excludedPaths.has(canonicalRelative)) continue;
    const stat = fs.statSync(filePath);
    entries.push({ path: relativeRaw, sizeBytes: stat.size, sha256: sha256File(filePath) });
  }
  return canonicalizePayloadRecords(entries);
}
function payloadFilesDocument(records) {
  return {
    schemaVersion: 1,
    artifactClass: ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    canonicalization: { pathSeparator: '/', sort: 'UTF8_BYTE_ASCENDING', encoding: 'UTF-8', bom: false, lineEnding: 'LF', unicodeNormalization: 'NFC', windowsCaseCollisionPolicy: 'REJECT' },
    files: canonicalizePayloadRecords(records)
  };
}
function applicationPayloadSha256(records) {
  const chunks = canonicalizePayloadRecords(records).map(record => `${record.path}\0${record.sizeBytes}\0${record.sha256}\n`);
  return sha256Buffer(Buffer.from(chunks.join(''), 'utf8'));
}

function copyRuntimeTree(sourceRoot, destinationRoot, excludedPrefixes = []) {
  if (!fs.existsSync(sourceRoot)) return 0;
  let count = 0;
  for (const filePath of walkFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, filePath).split(path.sep).join('/');
    if (excludedPrefixes.some(prefix => relative === prefix.replace(/\/$/, '') || relative.startsWith(prefix))) continue;
    if (FORBIDDEN_RUNTIME_SEGMENTS.some(segment => relative.toLowerCase().startsWith(segment))) continue;
    const destination = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(filePath, destination);
    count += 1;
  }
  return count;
}
function generatedPackageMetadata(repoRoot, releaseSource, databaseSchemaVersion) {
  const sourcePackage = readJson(path.join(repoRoot, 'package.json'));
  return {
    name: sourcePackage.name,
    version: releaseSource.productVersion,
    private: true,
    description: `${releaseSource.productName} local private desktop runtime`,
    main: sourcePackage.main,
    type: sourcePackage.type,
    dependencies: sourcePackage.dependencies || {},
    engines: sourcePackage.engines || {},
    packageManager: sourcePackage.packageManager,
    yanceRelease: {
      generatedFrom: 'release/release-source.json',
      publicProductName: releaseSource.publicProductName,
      publicProductNameEnglish: releaseSource.publicProductNameEnglish,
      publicVersion: releaseSource.publicVersion,
      internalProductId: releaseSource.internalProductId,
      executableName: releaseSource.executableName,
      installDirectoryName: releaseSource.installDirectoryName,
      userDataDirectoryName: releaseSource.userDataDirectoryName,
      installerBaseName: releaseSource.installerBaseName,
      internalName: releaseSource.internalName,
      originalFilename: releaseSource.originalFilename,
      appUserModelId: releaseSource.appUserModelId,
      brandingEpoch: releaseSource.brandingEpoch,
      releaseChannel: releaseSource.releaseChannel,
      onlineUpdatesEnabled: releaseSource.onlineUpdatesEnabled,
      updateMode: releaseSource.updateMode,
      formalPublicReleaseAuthorized: releaseSource.formalPublicReleaseAuthorized,
      stageVersion: releaseSource.stageVersion,
      phase: releaseSource.phase,
      distributionMode: releaseSource.distributionMode,
      databaseSchemaVersion
    }
  };
}
function createApplicationPayload(repoRoot, payloadRoot, options = {}) {
  fs.rmSync(payloadRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });
  const releaseSource = options.releaseSource || readReleaseSource(path.join(repoRoot, 'release', 'release-source.json'));
  const schemaAuthority = options.schemaAuthority || deriveDatabaseSchemaVersion(repoRoot);
  const includedRoots = [];
  const copiedFilesByRoot = {};
  for (const mapping of RUNTIME_PAYLOAD_ALLOWLIST) {
    const count = copyRuntimeTree(path.join(repoRoot, mapping.source), path.join(payloadRoot, mapping.destination), mapping.excludedPrefixes);
    if (count > 0) includedRoots.push(mapping.destination);
    copiedFilesByRoot[mapping.destination] = count;
  }
  const packageDestination = path.join(payloadRoot, 'electron_runtime', 'package.json');
  writeCanonicalJson(packageDestination, generatedPackageMetadata(repoRoot, releaseSource, schemaAuthority.databaseSchemaVersion));
  copiedFilesByRoot.electron_runtime = (copiedFilesByRoot.electron_runtime || 0) + 1;
  const forbidden = generatePayloadRecords(payloadRoot).filter(record => FORBIDDEN_RUNTIME_SEGMENTS.some(segment => record.path.toLowerCase().includes(`/${segment}`) || record.path.toLowerCase().startsWith(segment)));
  if (forbidden.length) {
    throw new Wp1Error('WP1_RUNTIME_PAYLOAD_SCOPE_VIOLATION', 'runtime payload contains forbidden development or packaging files', { files: forbidden.map(item => item.path) });
  }
  const brandAudit = assertRuntimePayloadBranding(payloadRoot);
  return {
    includedRoots,
    copiedFilesByRoot,
    schemaAuthority,
    brandAudit: {
      status: brandAudit.status,
      findingCount: brandAudit.findingCount,
      unexplainedCount: brandAudit.unexplainedCount,
      visibleAllowanceCount: brandAudit.visibleAllowanceCount
    }
  };
}

function buildManifest({ releaseSource, sourceCommit, sourceTree, buildTimestampUtc, buildId, records, payloadFilesSha256, databaseSchemaVersion }) {
  const manifest = {
    schemaVersion: 1,
    artifactClass: ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    buildId,
    productName: releaseSource.productName,
    publicProductName: releaseSource.publicProductName,
    publicProductNameEnglish: releaseSource.publicProductNameEnglish,
    productVersion: releaseSource.productVersion,
    publicVersion: releaseSource.publicVersion,
    internalProductId: releaseSource.internalProductId,
    executableName: releaseSource.executableName,
    installDirectoryName: releaseSource.installDirectoryName,
    userDataDirectoryName: releaseSource.userDataDirectoryName,
    brandingEpoch: releaseSource.brandingEpoch,
    installerBaseName: releaseSource.installerBaseName,
    internalName: releaseSource.internalName,
    originalFilename: releaseSource.originalFilename,
    appUserModelId: releaseSource.appUserModelId,
    legacyCompatibility: releaseSource.legacyCompatibility,
    releaseChannel: releaseSource.releaseChannel,
    onlineUpdatesEnabled: releaseSource.onlineUpdatesEnabled,
    updateMode: releaseSource.updateMode,
    formalPublicReleaseAuthorized: releaseSource.formalPublicReleaseAuthorized,
    stageVersion: releaseSource.stageVersion,
    phase: releaseSource.phase,
    distributionMode: releaseSource.distributionMode,
    gitCommit: sourceCommit,
    sourceCommit,
    sourceTree,
    buildTimestampUtc: normalizeTimestamp(buildTimestampUtc),
    applicationPayloadSha256: applicationPayloadSha256(records),
    payloadFilesSha256,
    apiContractVersion: releaseSource.apiContractVersion,
    credentialProtocolVersion: releaseSource.credentialProtocolVersion,
    runtimeLockProtocolVersion: releaseSource.runtimeLockProtocolVersion,
    databaseSchemaVersion
  };
  try { validateReleaseManifest(manifest); }
  catch (error) { throw new Wp1Error(error.reasonCode || 'BOOT_MANIFEST_SCHEMA_INVALID', error.message, error.details || {}); }
  return manifest;
}
function detachedHashText(hash, fileName = 'release-manifest.json') { return `${hash}  ${fileName}\n`; }
function parseDetachedHash(text) {
  const match = String(text).match(/^([0-9a-f]{64})\s+\*?([^\r\n]+)\r?\n?$/);
  if (!match) throw new Wp1Error('WP1_MANIFEST_DETACHED_HASH_FORMAT_INVALID', 'detached manifest hash format is invalid');
  return { sha256: match[1], fileName: match[2].trim() };
}
function verifyDetachedManifest(manifestPath, detachedHashPath) {
  if (!fs.existsSync(manifestPath)) throw new Wp1Error('BOOT_MANIFEST_MISSING', 'release manifest is missing', { manifestPath });
  if (!fs.existsSync(detachedHashPath)) throw new Wp1Error('BOOT_MANIFEST_HASH_MISSING', 'release manifest detached hash is missing', { detachedHashPath });
  const parsed = parseDetachedHash(fs.readFileSync(detachedHashPath, 'utf8'));
  const actual = sha256File(manifestPath);
  if (path.basename(manifestPath) !== parsed.fileName || actual !== parsed.sha256) {
    throw new Wp1Error('BOOT_MANIFEST_HASH_MISMATCH', 'release manifest detached hash verification failed', { expected: parsed.sha256, actual, fileName: parsed.fileName });
  }
  const manifest = readJson(manifestPath);
  try { validateReleaseManifest(manifest); }
  catch (error) { throw new Wp1Error(error.reasonCode || 'BOOT_MANIFEST_SCHEMA_INVALID', error.message, error.details || {}); }
  return { manifestSha256: actual, manifest };
}

function writePipelineMarker(outputRoot, marker) {
  const markerPath = path.join(outputRoot, '.wp1-pipeline-test-artifact.json');
  writeCanonicalJson(markerPath, marker);
  return markerPath;
}
function generateReleaseEvidence({ manifestPath, detachedHashPath, installerPath, generatedAtUtc }) {
  const verified = verifyDetachedManifest(manifestPath, detachedHashPath);
  const manifest = verified.manifest;
  if (manifest.artifactClass !== ARTIFACT_CLASS || manifest.finalReleaseEvidence !== false) {
    throw new Wp1Error('WP1_PIPELINE_TEST_MARKER_MISSING', 'WP1 release evidence may only be generated from marked pipeline-test artifacts');
  }
  if (!fs.existsSync(installerPath)) throw new Wp1Error('WP1_TEST_INSTALLER_MISSING', 'pipeline-test installer fixture is missing');
  const stat = fs.statSync(installerPath);
  return {
    schemaVersion: 1,
    artifactClass: ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    buildId: manifest.buildId,
    gitCommit: manifest.gitCommit,
    sourceCommit: manifest.sourceCommit,
    sourceTree: manifest.sourceTree,
    releaseManifestSha256: verified.manifestSha256,
    applicationPayloadSha256: manifest.applicationPayloadSha256,
    payloadFilesSha256: manifest.payloadFilesSha256,
    installerFileName: path.basename(installerPath),
    installerSizeBytes: stat.size,
    installerSha256: sha256File(installerPath),
    generatedAtUtc: normalizeTimestamp(generatedAtUtc)
  };
}

function createWp1ProvenanceIndex(outputRoot) {
  const files = [];
  for (const filePath of walkFiles(outputRoot)) {
    const relative = path.relative(outputRoot, filePath).split(path.sep).join('/');
    if (relative === 'wp1-provenance-index.json') continue;
    files.push({
      path: relative,
      sizeBytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
      provenanceClass: WP1_PROVENANCE_PROTECTED_PATHS.includes(relative) ? 'WP1_PIPELINE_METADATA' : 'APPLICATION_PAYLOAD_OR_SUPPORTING_FILE'
    });
  }
  return {
    schemaVersion: 2,
    artifactClass: ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    protectedPaths: [...WP1_PROVENANCE_PROTECTED_PATHS],
    ordinaryApplicationPayloadHashesAreReuseEvidence: false,
    files: files.sort((a, b) => compareUtf8(a.path, b.path))
  };
}
function readProtectedProvenance(indexPaths = []) {
  if (!Array.isArray(indexPaths) || indexPaths.length === 0) {
    throw new Wp1Error(PROVENANCE_INDEX_REQUIRED_REASON, 'WP1 provenance index is required for post-generation provenance validation');
  }
  const protectedByHash = new Map();
  for (const indexPath of indexPaths) {
    if (typeof indexPath === 'string' && !fs.existsSync(indexPath)) {
      throw new Wp1Error(PROVENANCE_INDEX_REQUIRED_REASON, 'WP1 provenance index does not exist', { indexPath });
    }
    const index = typeof indexPath === 'string' ? readJson(indexPath) : indexPath;
    if (!index || index.artifactClass !== ARTIFACT_CLASS || !Array.isArray(index.files)) {
      throw new Wp1Error(PROVENANCE_INDEX_REQUIRED_REASON, 'WP1 provenance index is invalid');
    }
    const protectedPaths = new Set(index.protectedPaths || WP1_PROVENANCE_PROTECTED_PATHS);
    for (const file of index.files) {
      if (!protectedPaths.has(file.path)) continue;
      protectedByHash.set(file.sha256, file.path);
    }
  }
  return { protectedByHash };
}
function scanForPipelineTestArtifacts(rootDir, options = {}) {
  const violations = [];
  if (!fs.existsSync(rootDir)) return { status: 'PASS', reasonCode: null, violations };
  const provenance = options.requireProvenanceIndex === true
    ? readProtectedProvenance(options.provenanceIndexes || [])
    : { protectedByHash: new Map() };
  for (const filePath of walkFiles(rootDir)) {
    const relative = path.relative(rootDir, filePath).split(path.sep).join('/');
    const base = path.basename(filePath).toLowerCase();
    if (base === '.wp1-pipeline-test-artifact.json' || base === 'wp1-provenance-index.json' || base === 'pipeline-summary.json' || base.includes('pipeline-test-only')) {
      violations.push({ path: relative, kind: 'WP1_MARKER_TEST_INSTALLER_OR_PIPELINE_METADATA' });
      continue;
    }
    const hash = sha256File(filePath);
    const protectedSource = provenance.protectedByHash.get(hash);
    if (protectedSource) {
      violations.push({ path: relative, kind: 'WP1_PROTECTED_ARTIFACT_HASH_MATCH', sourceArtifact: protectedSource });
      continue;
    }
    if (path.extname(filePath).toLowerCase() === '.json') {
      let parsed;
      try { parsed = readJson(filePath); } catch { parsed = null; }
      if (parsed?.artifactClass === ARTIFACT_CLASS || parsed?.finalReleaseEvidence === false) {
        violations.push({ path: relative, kind: 'PIPELINE_TEST_METADATA' });
        continue;
      }
      if (base === 'build-session-receipt.json' && parsed?.builder?.artifactClass === ARTIFACT_CLASS) {
        violations.push({ path: relative, kind: 'WP1_BUILD_SESSION_RECEIPT' });
        continue;
      }
    }
  }
  return violations.length
    ? { status: 'FAIL', reasonCode: FINAL_REUSE_REASON, violations }
    : { status: 'PASS', reasonCode: null, violations: [], ordinaryApplicationPayloadHashesChecked: false };
}
function assertEmptyBeforeFinalBuild(stagingRoot) {
  const entries = fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [];
  if (entries.length) {
    throw new Wp1Error(FINAL_REUSE_REASON, 'WP7 staging must be empty before final build', { stagingRoot, entries: entries.sort() });
  }
  return { status: 'PASS', reasonCode: null, stagingRoot, empty: true };
}
function assertNoWp1ProvenanceAfterGeneration(stagingRoot, provenanceIndexes = []) {
  const result = scanForPipelineTestArtifacts(stagingRoot, { provenanceIndexes, requireProvenanceIndex: true });
  if (result.status !== 'PASS') throw new Wp1Error(FINAL_REUSE_REASON, 'WP1 pipeline metadata is forbidden in WP7 final staging', { violations: result.violations });
  return result;
}

function buildSessionIdFor({ sourceCommit, sourceTree, buildTimestampUtc, builderName }) {
  return sha256Buffer(Buffer.from(`${sourceCommit}\0${sourceTree}\0${normalizeTimestamp(buildTimestampUtc)}\0${builderName}`, 'utf8')).slice(0, 32);
}
function createBuildSessionReceipt({ sourceCommit, sourceTree, buildTimestampUtc, stagingInitiallyEmpty, builderName, generatedPaths, artifactClass = ARTIFACT_CLASS }) {
  return {
    schemaVersion: 1,
    buildSessionId: buildSessionIdFor({ sourceCommit, sourceTree, buildTimestampUtc, builderName }),
    sourceCommit,
    sourceTree,
    stagingInitiallyEmpty: stagingInitiallyEmpty === true,
    builder: {
      name: builderName,
      artifactClass,
      finalReleaseEvidence: artifactClass === ARTIFACT_CLASS ? false : null
    },
    generatedAtUtc: normalizeTimestamp(buildTimestampUtc),
    generatedPaths: [...generatedPaths].sort(compareUtf8)
  };
}

function buildPipelineTest(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const outputRoot = path.resolve(options.outputRoot);
  const identity = options.gitIdentity || gitIdentity(repoRoot);
  if (options.requireClean !== false && !identity.repositoryClean) throw new Wp1Error('WP1_PIPELINE_REPOSITORY_DIRTY', 'pipeline-test generation requires a clean repository');
  if (options.sourceCommit && options.sourceCommit !== identity.sourceCommit) {
    throw new Wp1Error('WP1_PIPELINE_SOURCE_COMMIT_MISMATCH', 'requested sourceCommit does not match actual HEAD', { requested: options.sourceCommit, actual: identity.sourceCommit });
  }
  const releaseSource = readReleaseSource(options.releaseSourcePath || path.join(repoRoot, 'release', 'release-source.json'));
  const singleSource = scanSingleHumanMaintainedReleaseSource(repoRoot, releaseSource);
  if (singleSource.status !== 'PASS') throw new Wp1Error(singleSource.reasonCode, 'duplicate manually maintained release identity detected', { violations: singleSource.violations });
  const schemaAuthority = deriveDatabaseSchemaVersion(repoRoot);
  const buildTimestampUtc = normalizeTimestamp(options.buildTimestampUtc);
  const buildId = buildIdFrom({ releaseSource, sourceCommit: identity.sourceCommit, buildTimestampUtc });
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const payloadRoot = path.join(outputRoot, 'application-payload');
  const payloadBuild = createApplicationPayload(repoRoot, payloadRoot, { releaseSource, schemaAuthority });
  const records = generatePayloadRecords(payloadRoot);
  const payloadDocument = payloadFilesDocument(records);
  const resourcesDir = path.join(outputRoot, 'resources');
  const payloadFilesPath = path.join(resourcesDir, 'payload-files.json');
  writeCanonicalJson(payloadFilesPath, payloadDocument);
  const payloadFilesSha256 = sha256File(payloadFilesPath);
  const manifest = buildManifest({
    releaseSource,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    buildTimestampUtc,
    buildId,
    records,
    payloadFilesSha256,
    databaseSchemaVersion: schemaAuthority.databaseSchemaVersion
  });
  const manifestPath = path.join(resourcesDir, 'release-manifest.json');
  writeCanonicalJson(manifestPath, manifest);
  const manifestSha256 = sha256File(manifestPath);
  const detachedHashPath = path.join(resourcesDir, 'release-manifest.sha256');
  fs.writeFileSync(detachedHashPath, detachedHashText(manifestSha256), 'utf8');
  const installerPath = path.join(outputRoot, 'Yance-PIPELINE-TEST-ONLY.bin');
  fs.writeFileSync(installerPath, canonicalJsonBuffer({ artifactClass: ARTIFACT_CLASS, finalReleaseEvidence: false, buildId, applicationPayloadSha256: manifest.applicationPayloadSha256, releaseManifestSha256: manifestSha256 }));
  const evidence = generateReleaseEvidence({ manifestPath, detachedHashPath, installerPath, generatedAtUtc: buildTimestampUtc });
  const evidencePath = path.join(outputRoot, 'release-evidence.json');
  writeCanonicalJson(evidencePath, evidence);
  const markerPath = writePipelineMarker(outputRoot, { schemaVersion: 1, artifactClass: ARTIFACT_CLASS, finalReleaseEvidence: false, buildId, gitCommit: identity.sourceCommit, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, generatedAtUtc: buildTimestampUtc, forbiddenInWp7FinalStaging: true, failureReasonCode: FINAL_REUSE_REASON });
  const summary = {
    schemaVersion: 1,
    status: 'PASS',
    artifactClass: ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    buildId,
    gitCommit: identity.sourceCommit,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    repositoryClean: identity.repositoryClean,
    buildTimestampUtc,
    includedRoots: payloadBuild.includedRoots,
    copiedFilesByRoot: payloadBuild.copiedFilesByRoot,
    databaseSchemaVersion: schemaAuthority.databaseSchemaVersion,
    databaseSchemaAuthorities: schemaAuthority.authorities,
    payloadFileCount: records.length,
    payloadFilesSha256,
    applicationPayloadSha256: manifest.applicationPayloadSha256,
    releaseManifestSha256: manifestSha256,
    paths: { payloadFiles: 'resources/payload-files.json', releaseManifest: 'resources/release-manifest.json', releaseManifestSha256: 'resources/release-manifest.sha256', releaseEvidence: 'release-evidence.json', marker: path.basename(markerPath), testInstaller: path.basename(installerPath), buildSessionReceipt: 'build-session-receipt.json', provenanceIndex: 'wp1-provenance-index.json' }
  };
  writeCanonicalJson(path.join(outputRoot, 'pipeline-summary.json'), summary);
  const buildSessionReceipt = createBuildSessionReceipt({
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    buildTimestampUtc,
    stagingInitiallyEmpty: true,
    builderName: 'tools/wp1/build-pipeline-test.js',
    artifactClass: ARTIFACT_CLASS,
    generatedPaths: [
      'application-payload/',
      'resources/payload-files.json',
      'resources/release-manifest.json',
      'resources/release-manifest.sha256',
      'release-evidence.json',
      '.wp1-pipeline-test-artifact.json',
      'Yance-PIPELINE-TEST-ONLY.bin',
      'pipeline-summary.json',
      'build-session-receipt.json',
      'wp1-provenance-index.json'
    ]
  });
  writeCanonicalJson(path.join(outputRoot, 'build-session-receipt.json'), buildSessionReceipt);
  const provenanceIndex = createWp1ProvenanceIndex(outputRoot);
  const provenanceIndexPath = path.join(outputRoot, 'wp1-provenance-index.json');
  writeCanonicalJson(provenanceIndexPath, provenanceIndex);
  return { outputRoot, payloadRoot, resourcesDir, records, manifest, evidence, summary, buildSessionReceipt, provenanceIndex, provenanceIndexPath };
}

module.exports = {
  assertRuntimePayloadBranding,
  ARTIFACT_CLASS,
  FINAL_REUSE_REASON,
  FORBIDDEN_RUNTIME_SEGMENTS,
  PROVENANCE_INDEX_REQUIRED_REASON,
  PAYLOAD_EXCLUDED_PATHS,
  RELEASE_SOURCE_PATH,
  REPO_ROOT,
  RUNTIME_PAYLOAD_ALLOWLIST,
  Wp1Error,
  applicationPayloadSha256,
  assertEmptyBeforeFinalBuild,
  assertNoWp1ProvenanceAfterGeneration,
  buildIdFrom,
  buildManifest,
  buildPipelineTest,
  canonicalJsonBuffer,
  canonicalizePayloadRecords,
  canonicalizeRelativePayloadPath,
  createApplicationPayload,
  createBuildSessionReceipt,
  createWp1ProvenanceIndex,
  deriveDatabaseSchemaVersion,
  detachedHashText,
  generatePayloadRecords,
  generateReleaseEvidence,
  generatedPackageMetadata,
  git,
  gitIdentity,
  normalizeTimestamp,
  parseDetachedHash,
  payloadFilesDocument,
  readJson,
  readReleaseSource,
  scanForPipelineTestArtifacts,
  scanSingleHumanMaintainedReleaseSource,
  sha256Buffer,
  sha256File,
  sortValue,
  verifyDetachedManifest,
  writeCanonicalJson
};
