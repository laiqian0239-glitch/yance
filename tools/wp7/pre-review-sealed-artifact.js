'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_RE = /^[0-9a-f]{40}$/;
const BUILD_SESSION_RE = /^[0-9a-f]{16,64}$/;
const ARTIFACT_CLASS = 'WP7_PRE_REVIEW_ONLY';
const EVIDENCE_CLASS = 'PRE_REVIEW_PACKAGED_INTEGRATION';
const SEALED_ARTIFACT_TYPE = 'TRUSTED_PRODUCT_BUILD_SESSION_SEAL_V1';
const DOCUMENT_TYPE = 'WP7_PRE_REVIEW_SEALED_ARTIFACT';
const STATUS = 'SEALED_PRE_REVIEW_ONLY';
const HASH_FIELDS = Object.freeze([
  'electronReleaseArchiveSha256',
  'productExecutableSha256',
  'releaseManifestSha256',
  'applicationPayloadSha256',
  'applicationPayloadFilesystemIdentitySha256',
  'payloadFilesSha256',
  'productionDependencyBindingSha256',
  'productionDependencyPackageGraphSha256',
  'productionDependencyFileTreeSha256',
  'productionDependencyModeTreeSha256',
  'productionDependencyDirectoryModeTreeSha256',
  'gitPayloadModeTreeSha256',
  'electronDistributionTreeSha256',
  'nodeRuntimeExecutableSha256',
  'nodeRuntimeTreeSha256',
  'nativeBinaryScanSha256'
]);
const REQUIRED_FIELDS = Object.freeze([
  'schemaVersion', 'documentType', 'status', 'generatedAtUtc', 'artifactClass', 'evidenceClass',
  'sealedArtifactType', 'finalInstaller', 'finalReleaseEvidence', 'formalWindowsEvidenceEligible',
  'buildSessionId', 'buildId', 'sourceCommit', 'sourceTree', ...HASH_FIELDS
]);

class PreReviewSealedArtifactError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'PreReviewSealedArtifactError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalJsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`, 'utf8');
}
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function canonicalUtc(value) {
  const timestamp = String(value || '');
  const parsed = new Date(timestamp);
  return timestamp.endsWith('Z') && !Number.isNaN(parsed.getTime()) && parsed.toISOString() === timestamp;
}
function fail(reasonCode, message, details = {}) {
  throw new PreReviewSealedArtifactError(reasonCode, message, details);
}
function validateDocument(document, expected = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'sealed artifact must be a JSON object');
  const unknown = Object.keys(document).filter((key) => !REQUIRED_FIELDS.includes(key));
  const missing = REQUIRED_FIELDS.filter((key) => !Object.prototype.hasOwnProperty.call(document, key));
  if (unknown.length || missing.length) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'sealed artifact fields are not exact', { unknown, missing });
  const exact = {
    schemaVersion: 1,
    documentType: DOCUMENT_TYPE,
    status: STATUS,
    artifactClass: ARTIFACT_CLASS,
    evidenceClass: EVIDENCE_CLASS,
    sealedArtifactType: SEALED_ARTIFACT_TYPE,
    finalInstaller: false,
    finalReleaseEvidence: false,
    formalWindowsEvidenceEligible: false
  };
  const schemaMismatches = Object.entries(exact).filter(([key, value]) => document[key] !== value).map(([key, value]) => ({ field: key, expected: value, actual: document[key] }));
  if (schemaMismatches.length) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'sealed artifact class or schema is invalid', { mismatches: schemaMismatches });
  if (!canonicalUtc(document.generatedAtUtc)) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'generatedAtUtc must be canonical UTC', { value: document.generatedAtUtc });
  if (!BUILD_SESSION_RE.test(document.buildSessionId) || typeof document.buildId !== 'string' || !document.buildId || !GIT_RE.test(document.sourceCommit) || !GIT_RE.test(document.sourceTree)) {
    fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'sealed artifact identity fields are malformed');
  }
  const invalidHashes = HASH_FIELDS.filter((field) => !SHA256_RE.test(document[field]));
  if (invalidHashes.length) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'sealed artifact SHA256 fields are malformed', { invalidHashes });
  const expectedMismatches = Object.entries(expected).filter(([, value]) => value !== undefined).filter(([key, value]) => document[key] !== value).map(([key, value]) => ({ field: key, expected: value, actual: document[key] }));
  if (expectedMismatches.length) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_IDENTITY_MISMATCH', 'sealed artifact does not bind the reviewed product identity', { mismatches: expectedMismatches });
  return document;
}
function createPreReviewSealedArtifact(filePath, data) {
  const absolute = path.resolve(filePath);
  const document = {
    schemaVersion: 1,
    documentType: DOCUMENT_TYPE,
    status: STATUS,
    generatedAtUtc: data.generatedAtUtc || new Date().toISOString(),
    artifactClass: ARTIFACT_CLASS,
    evidenceClass: EVIDENCE_CLASS,
    sealedArtifactType: SEALED_ARTIFACT_TYPE,
    finalInstaller: false,
    finalReleaseEvidence: false,
    formalWindowsEvidenceEligible: false,
    buildSessionId: data.buildSessionId,
    buildId: data.buildId,
    sourceCommit: data.sourceCommit,
    sourceTree: data.sourceTree,
    ...Object.fromEntries(HASH_FIELDS.map((field) => [field, data[field]]))
  };
  validateDocument(document);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, canonicalJsonBuffer(document), { mode: 0o600 });
  return Object.freeze({ path: absolute, sha256: sha256File(absolute), document });
}
function readAndVerifyPreReviewSealedArtifact(filePath, expected = {}) {
  const absolute = path.resolve(String(filePath || ''));
  if (!filePath || !path.isAbsolute(String(filePath)) || !fs.existsSync(absolute)) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_MISSING', 'pre-review sealed artifact path must name an existing absolute file', { filePath: absolute });
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_INVALID', 'pre-review sealed artifact must be a regular non-symlink file', { filePath: absolute });
  if (stat.size < 2 || stat.size > 1024 * 1024) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_INVALID', 'pre-review sealed artifact size is invalid', { sizeBytes: stat.size });
  let document;
  try { document = JSON.parse(fs.readFileSync(absolute, 'utf8')); }
  catch (error) { fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'pre-review sealed artifact is not valid JSON', { message: error.message }); }
  validateDocument(document, expected);
  return Object.freeze({ path: fs.realpathSync(absolute), sha256: sha256File(absolute), sizeBytes: stat.size, document });
}

module.exports = {
  ARTIFACT_CLASS,
  DOCUMENT_TYPE,
  EVIDENCE_CLASS,
  HASH_FIELDS,
  SEALED_ARTIFACT_TYPE,
  STATUS,
  PreReviewSealedArtifactError,
  createPreReviewSealedArtifact,
  readAndVerifyPreReviewSealedArtifact,
  validateDocument
};
