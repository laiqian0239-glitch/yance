'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { FORMAL_PROBE_IDS, validateMeasurements } = require('../../electron/wp7InstalledRuntimeProbe');
const { readPreMainProof } = require('./linux-network-isolation');
const {
  ARTIFACT_CLASS,
  EVIDENCE_CLASS,
  SEALED_ARTIFACT_TYPE,
  readAndVerifyPreReviewSealedArtifact
} = require('./pre-review-sealed-artifact');

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_RE = /^[0-9a-f]{40}$/;
const ABSOLUTE_OR_TEMP_RE = /^(?:\/|[A-Za-z]:[\\/])|(?:^|[\\/])tmp[\\/]/;

class PreReviewEvidencePackageError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'PreReviewEvidencePackageError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}
function fail(reasonCode, message, details = {}) {
  throw new PreReviewEvidencePackageError(reasonCode, message, details);
}
function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalBuffer(value) {
  return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`, 'utf8');
}
function normalizeRelativePath(value, field) {
  const raw = String(value || '').replace(/\\/g, '/').normalize('NFC');
  if (!raw || path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.includes('\0')) {
    fail('WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID', `${field} must be a canonical relative path`, { field, value });
  }
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail('WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID', `${field} contains an unsafe path segment`, { field, value });
  }
  return raw;
}
function resolveEvidenceFile(root, relativePath, field) {
  const normalized = normalizeRelativePath(relativePath, field);
  const absolute = path.resolve(root, ...normalized.split('/'));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID', `${field} escapes the evidence root`, { field, relativePath: normalized });
  }
  if (!fs.existsSync(absolute)) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING', `${field} is missing`, { field, relativePath: normalized });
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING', `${field} is not a regular non-symlink file`, { field, relativePath: normalized });
  return { absolute, relativePath: normalized, sizeBytes: stat.size, sha256: sha256File(absolute) };
}
function readJsonFile(record, reasonCode = 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID') {
  try { return JSON.parse(fs.readFileSync(record.absolute, 'utf8')); }
  catch (error) { fail(reasonCode, 'raw evidence file is not valid JSON', { path: record.relativePath, message: error.message }); }
}
function assertNoAbsoluteOrTempReferences(value, currentPath = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAbsoluteOrTempReferences(item, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && ABSOLUTE_OR_TEMP_RE.test(value)) {
      fail('WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID', 'evidence contains an absolute or temporary execution path', { jsonPath: currentPath, value });
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) assertNoAbsoluteOrTempReferences(child, `${currentPath}.${key}`);
}
function assertEqual(actual, expected, reasonCode, message, details = {}) {
  if (actual !== expected) fail(reasonCode, message, { ...details, expected, actual });
}
function validateAggregateIdentity(aggregate) {
  if (!aggregate || aggregate.schemaVersion !== 2 || aggregate.documentType !== 'WP7_PACKAGED_YANCE_NINE_PROBE_INTEGRATION_RESULT' || aggregate.status !== 'PASS') {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'nine-probe aggregate schema or status is invalid');
  }
  if (aggregate.executionClass !== EVIDENCE_CLASS || aggregate.formalWindowsEvidenceEligible !== false || aggregate.artifactClass !== ARTIFACT_CLASS || aggregate.finalReleaseEvidence !== false) {
    fail('WP7_PRE_REVIEW_ARTIFACT_CLASSIFICATION_INVALID', 'nine-probe aggregate is not classified as Pre-Review-only evidence', {
      executionClass: aggregate.executionClass,
      formalWindowsEvidenceEligible: aggregate.formalWindowsEvidenceEligible,
      artifactClass: aggregate.artifactClass,
      finalReleaseEvidence: aggregate.finalReleaseEvidence
    });
  }
  if (!GIT_RE.test(aggregate.sourceCommit) || !GIT_RE.test(aggregate.sourceTree) || typeof aggregate.buildId !== 'string' || !aggregate.buildId || typeof aggregate.buildSessionId !== 'string' || !aggregate.buildSessionId) {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'nine-probe aggregate source or build identity is malformed');
  }
  if (!SHA256_RE.test(aggregate.nativeBinaryScanSha256 || '') || !Number.isInteger(aggregate.nativeBinaryFileCount) || aggregate.nativeBinaryFileCount < 0 || aggregate.nativeBinaryFailureCount !== 0 || !['linux', 'win32'].includes(aggregate.nativeBinaryTargetPlatform) || aggregate.nativeBinaryTargetArch !== 'x64') {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'nine-probe aggregate native binary identity is malformed');
  }
  if (!SHA256_RE.test(aggregate.preReviewSealedArtifactSha256) || aggregate.preReviewSealedArtifactType !== SEALED_ARTIFACT_TYPE) {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'nine-probe aggregate sealed artifact identity is malformed');
  }
  assertNoAbsoluteOrTempReferences(aggregate);
}
function validateRawProbeRecord({ evidenceRoot, aggregate, row, probeId }) {
  if (!row || row.probeId !== probeId || row.status !== 'PASS' || row.exitCode !== 0 || row.signal !== null) {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'probe aggregate row is not a successful exact probe record', { probeId, row });
  }
  if (!Number.isInteger(row.processPid) || row.processPid <= 0 || !Number.isInteger(row.processParentPid) || row.processParentPid <= 0 || typeof row.executionNonce !== 'string' || !row.executionNonce) {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'probe process custody identity is malformed', { probeId });
  }
  const fileFields = [
    ['probeResultPath', 'probeResultSha256'],
    ['stdoutPath', 'stdoutSha256'],
    ['stderrPath', 'stderrSha256'],
    ['processCustodyPath', 'processCustodySha256'],
    ['executionContextPath', 'executionContextSha256']
  ];
  const files = {};
  for (const [pathField, hashField] of fileFields) {
    if (!SHA256_RE.test(row[hashField])) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', `${hashField} is malformed`, { probeId, value: row[hashField] });
    const record = resolveEvidenceFile(evidenceRoot, row[pathField], pathField);
    if (record.sha256 !== row[hashField]) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', `${pathField} SHA256 does not match the aggregate`, { probeId, path: record.relativePath, expected: row[hashField], actual: record.sha256 });
    files[pathField] = record;
  }
  const result = readJsonFile(files.probeResultPath);
  const exactResult = {
    schemaVersion: 1,
    documentType: 'WP7_INSTALLED_RUNTIME_PROBE_RESULT',
    probeId,
    status: 'PASS',
    executionNonce: row.executionNonce,
    executionClass: EVIDENCE_CLASS,
    formalWindowsEvidenceEligible: false,
    fixtureMode: false,
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    frozenSourceCommit: aggregate.sourceCommit,
    frozenSourceTree: aggregate.sourceTree,
    preReviewSealedArtifactSha256: aggregate.preReviewSealedArtifactSha256,
    preReviewSealedArtifactType: aggregate.preReviewSealedArtifactType,
    producerPid: row.processPid,
    producerParentPid: row.processParentPid,
    producerExecutableSha256: aggregate.productExecutableSha256,
    producerMainEntrySha256: aggregate.packagedMainSha256
  };
  for (const [field, expected] of Object.entries(exactResult)) assertEqual(result[field], expected, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'raw probe result does not match the aggregate identity', { probeId, field });
  validateMeasurements(probeId, result.measurements);

  const custody = readJsonFile(files.processCustodyPath);
  const exactCustody = {
    schemaVersion: 1,
    documentType: 'WP7_TRUSTED_PRODUCT_PROCESS_CUSTODY',
    probeId,
    executionNonce: row.executionNonce,
    productPid: row.processPid,
    runnerPid: row.processParentPid,
    exitCode: 0,
    signal: null,
    timeoutTriggered: false
  };
  for (const [field, expected] of Object.entries(exactCustody)) assertEqual(custody[field], expected, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'process custody record does not match the probe execution', { probeId, field });

  const context = readJsonFile(files.executionContextPath);
  const exactContext = {
    schemaVersion: 1,
    documentType: 'WP7_TRUSTED_PRODUCT_PROBE_EXECUTION_CONTEXT',
    probeId,
    executionClass: EVIDENCE_CLASS,
    executionNonce: row.executionNonce,
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    sourceCommit: aggregate.sourceCommit,
    sourceTree: aggregate.sourceTree,
    preReviewSealedArtifactSha256: aggregate.preReviewSealedArtifactSha256,
    preReviewSealedArtifactType: aggregate.preReviewSealedArtifactType,
    productExecutableSha256: aggregate.productExecutableSha256,
    mainEntrySha256: aggregate.packagedMainSha256,
    networkIsolationRequired: probeId === 'offline-start'
  };
  for (const [field, expected] of Object.entries(exactContext)) assertEqual(context[field], expected, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'execution context does not match the probe execution', { probeId, field });

  if (probeId === 'offline-start') {
    if (!row.networkIsolation || !SHA256_RE.test(row.networkIsolation.proofSha256)) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING', 'offline-start network isolation proof is missing', { probeId });
    const proof = resolveEvidenceFile(evidenceRoot, row.networkIsolation.proofPath, 'networkIsolation.proofPath');
    if (proof.sha256 !== row.networkIsolation.proofSha256) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'offline-start network isolation proof SHA256 mismatch', { expected: row.networkIsolation.proofSha256, actual: proof.sha256 });
    if (row.networkIsolation.sourceSha256 !== aggregate.networkIsolationSourceSha256 || row.networkIsolation.librarySha256 !== aggregate.networkIsolationLibrarySha256) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'offline-start network isolation implementation identity mismatch');
    readPreMainProof(proof.absolute, { pid: row.processPid, parentPid: row.processParentPid, nonce: row.executionNonce });
    files.networkIsolationProofPath = proof;
  } else if (row.networkIsolation !== null) {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'non-offline probe unexpectedly contains a network isolation proof', { probeId });
  }
  return Object.values(files).map(({ relativePath, sha256, sizeBytes }) => ({ path: relativePath, sha256, sizeBytes, probeId }));
}
function validateNineProbeRawEvidence(options = {}) {
  const evidenceRoot = fs.realpathSync(path.resolve(options.evidenceRoot || ''));
  const aggregateRelativePath = normalizeRelativePath(options.aggregateRelativePath || 'nine-fresh-final-result.json', 'aggregateRelativePath');
  const aggregateRecord = resolveEvidenceFile(evidenceRoot, aggregateRelativePath, 'aggregateRelativePath');
  const aggregate = readJsonFile(aggregateRecord);
  validateAggregateIdentity(aggregate);
  const sealPath = path.resolve(String(options.sealedArtifactPath || ''));
  const seal = readAndVerifyPreReviewSealedArtifact(sealPath, {
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    sourceCommit: aggregate.sourceCommit,
    sourceTree: aggregate.sourceTree,
    electronReleaseArchiveSha256: aggregate.electronReleaseArchiveSha256,
    productExecutableSha256: aggregate.productExecutableSha256,
    releaseManifestSha256: aggregate.releaseManifestSha256,
    applicationPayloadSha256: aggregate.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: aggregate.applicationPayloadFilesystemIdentitySha256,
    payloadFilesSha256: aggregate.payloadFilesSha256,
    productionDependencyBindingSha256: aggregate.productionDependencyBindingSha256,
    productionDependencyPackageGraphSha256: aggregate.productionDependencyPackageGraphSha256,
    productionDependencyFileTreeSha256: aggregate.productionDependencyFileTreeSha256,
    productionDependencyModeTreeSha256: aggregate.productionDependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: aggregate.productionDependencyDirectoryModeTreeSha256,
    gitPayloadModeTreeSha256: aggregate.gitPayloadModeTreeSha256,
    electronDistributionTreeSha256: aggregate.electronDistributionTreeSha256,
    nodeRuntimeExecutableSha256: aggregate.nodeRuntimeExecutableSha256,
    nodeRuntimeTreeSha256: aggregate.nodeRuntimeTreeSha256,
    nativeBinaryScanSha256: aggregate.nativeBinaryScanSha256
  });
  assertEqual(seal.sha256, aggregate.preReviewSealedArtifactSha256, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'aggregate sealed artifact SHA256 does not match the supplied file');
  if (!Array.isArray(aggregate.requiredProbeIds) || JSON.stringify(aggregate.requiredProbeIds) !== JSON.stringify(FORMAL_PROBE_IDS) || aggregate.executedProbeCount !== FORMAL_PROBE_IDS.length || !Array.isArray(aggregate.probeResults) || aggregate.probeResults.length !== FORMAL_PROBE_IDS.length) {
    fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING', 'nine-probe aggregate does not contain exactly the canonical nine probes');
  }
  const probeArtifacts = [];
  aggregate.probeResults.forEach((row, index) => probeArtifacts.push(...validateRawProbeRecord({ evidenceRoot, aggregate, row, probeId: FORMAL_PROBE_IDS[index] })));
  const uniquePaths = new Set(probeArtifacts.map((row) => row.path));
  if (uniquePaths.size !== probeArtifacts.length) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'multiple raw evidence records reference the same file');
  return Object.freeze({
    evidenceRoot,
    aggregatePath: aggregateRecord.absolute,
    aggregateSha256: aggregateRecord.sha256,
    aggregate,
    sealedArtifact: seal,
    artifactRecords: [{ path: aggregateRecord.relativePath, sha256: aggregateRecord.sha256, sizeBytes: aggregateRecord.sizeBytes, class: 'NINE_PROBE_AGGREGATE' }, ...probeArtifacts]
  });
}
function walkRegularFiles(root, relativeRoot = '') {
  const records = [];
  const base = fs.realpathSync(path.resolve(root));
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const full = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail('WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID', 'evidence package contains a symlink', { path: relative });
      if (stat.isDirectory()) visit(full, relative);
      else if (stat.isFile()) records.push({ path: relativeRoot ? `${relativeRoot}/${relative}` : relative, sizeBytes: stat.size, sha256: sha256File(full) });
      else fail('WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID', 'evidence package contains an unsupported filesystem object', { path: relative });
    }
  }
  visit(base, '');
  return records;
}

module.exports = {
  PreReviewEvidencePackageError,
  canonicalBuffer,
  normalizeRelativePath,
  resolveEvidenceFile,
  sha256File,
  validateNineProbeRawEvidence,
  walkRegularFiles
};
