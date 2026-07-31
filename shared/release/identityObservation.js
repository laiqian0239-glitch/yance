'use strict';

const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/;
const CONSUMER_PROFILES = Object.freeze({
  electron: Object.freeze({ producerType: 'electron-main', sourceKind: 'electron-runtime-observation' }),
  backend: Object.freeze({ producerType: 'backend-ready-endpoint', sourceKind: 'http-endpoint' }),
  installer: Object.freeze({ producerType: 'nsis-embedded-identity', sourceKind: 'installer-embedded-document' }),
  diagnostics: Object.freeze({ producerType: 'backend-diagnostics-endpoint', sourceKind: 'http-endpoint' })
});
const IDENTITY_FIELDS = Object.freeze(['buildId','productVersion','stageVersion','sourceCommit','sourceTree','manifestSha256']);

function canonical(value) {
  const sort = input => Array.isArray(input)
    ? input.map(sort)
    : (!input || typeof input !== 'object'
      ? input
      : Object.fromEntries(Object.keys(input).sort().map(key => [key, sort(input[key])])));
  return Buffer.from(`${JSON.stringify(sort(value), null, 2)}\n`, 'utf8');
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : canonical(value);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function identityTuple(identity = {}) {
  return {
    buildId: String(identity.buildId || ''),
    productVersion: String(identity.productVersion || ''),
    stageVersion: String(identity.stageVersion || ''),
    sourceCommit: String(identity.sourceCommit || identity.gitCommit || '').toLowerCase(),
    sourceTree: String(identity.sourceTree || '').toLowerCase(),
    manifestSha256: String(identity.manifestSha256 || '').toLowerCase()
  };
}

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function validateTuple(tuple, label = 'identity') {
  for (const field of IDENTITY_FIELDS) {
    const value = tuple[field];
    if (typeof value !== 'string' || !value.trim()) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', `${label}.${field} is required`, { label, field });
  }
  if (!/^[0-9a-f]{40}$/.test(tuple.sourceCommit) || !/^[0-9a-f]{40}$/.test(tuple.sourceTree) || !SHA256_RE.test(tuple.manifestSha256)) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', `${label} identity hashes are invalid`, { label, tuple });
  }
  return tuple;
}

function createIdentityObservation(options = {}) {
  const consumer = String(options.consumer || '');
  const profile = CONSUMER_PROFILES[consumer];
  if (!profile) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'unsupported release identity consumer', { consumer });
  const tuple = validateTuple(identityTuple(options.identity), consumer);
  const producerType = String(options.producerType || '');
  const sourceKind = String(options.sourceKind || '');
  if (producerType !== profile.producerType || sourceKind !== profile.sourceKind) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity producer profile does not match consumer', {
      consumer, producerType, sourceKind, expected: profile
    });
  }
  const observationSource = String(options.observationSource || '');
  const producerProcess = String(options.producerProcess || '');
  const observedAtUtc = String(options.observedAtUtc || new Date().toISOString());
  if (!observationSource || !producerProcess || !Number.isFinite(Date.parse(observedAtUtc))) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity provenance metadata is incomplete', {
      consumer, observationSource, producerProcess, observedAtUtc
    });
  }
  const producerPid = Number(options.producerPid || 0);
  if (!Number.isInteger(producerPid) || producerPid < 0) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'producerPid is invalid', { consumer, producerPid });
  const observedDocument = options.observedDocument;
  if (!observedDocument || typeof observedDocument !== 'object' || Array.isArray(observedDocument)) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'raw observed identity document is required', { consumer });
  }
  const rawDocumentConsumer = String(options.rawDocumentConsumer || observedDocument.consumer || consumer);
  if (rawDocumentConsumer !== consumer) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'raw identity document consumer does not match provenance consumer', { consumer, rawDocumentConsumer });
  }
  const sourceDocumentSha256 = sha256(observedDocument);
  const observation = {
    schemaVersion: 1,
    documentType: 'WP7_RELEASE_IDENTITY_CONSUMER_OBSERVATION',
    consumer,
    producerType,
    producerProcess,
    producerPid,
    sourceKind,
    observationSource,
    observedAtUtc,
    rawDocumentConsumer,
    sourceDocumentSha256,
    ...tuple
  };
  return Object.freeze({ ...observation, observationSha256: sha256(observation) });
}

function validateObservation(observation, expectedConsumer) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity observation must be an object');
  const consumer = String(expectedConsumer || observation.consumer || '');
  const profile = CONSUMER_PROFILES[consumer];
  if (!profile || observation.consumer !== consumer || observation.rawDocumentConsumer !== consumer) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity observation consumer is invalid', { expectedConsumer, observationConsumer: observation.consumer, rawDocumentConsumer: observation.rawDocumentConsumer });
  }
  if (Object.prototype.hasOwnProperty.call(observation, 'independentlyObserved')) {
    fail('WP7_RUNTIME_PROBE_ACCEPTANCE_ORACLE_SELF_CONFIRMATION', 'release identity independence must be derived from provenance, not self-declared', { consumer });
  }
  if (observation.producerType !== profile.producerType || observation.sourceKind !== profile.sourceKind) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity producer profile is invalid', { consumer, expected: profile, actual: { producerType: observation.producerType, sourceKind: observation.sourceKind } });
  }
  validateTuple(identityTuple(observation), consumer);
  for (const field of ['producerProcess','observationSource','observedAtUtc']) {
    if (typeof observation[field] !== 'string' || !observation[field].trim()) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', `${consumer}.${field} is required`, { consumer, field });
  }
  if (!Number.isInteger(observation.producerPid) || observation.producerPid < 0 || !Number.isFinite(Date.parse(observation.observedAtUtc))) {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity provenance values are invalid', { consumer });
  }
  for (const field of ['sourceDocumentSha256','observationSha256']) if (!SHA256_RE.test(String(observation[field] || ''))) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', `${consumer}.${field} is invalid`, { consumer, field });
  const unsigned = { ...observation };
  delete unsigned.observationSha256;
  if (sha256(unsigned) !== observation.observationSha256) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity observation hash is invalid', { consumer });
  return observation;
}

function assertIndependentObservations(observations) {
  const names = Object.keys(CONSUMER_PROFILES);
  const rows = names.map(name => validateObservation(observations?.[name], name));
  const sourceKeys = new Set();
  const sourcePaths = new Set();
  const sourceHashes = new Set();
  const producerKeys = new Set();
  for (const row of rows) {
    const sourceKey = `${row.sourceKind}:${row.observationSource}`;
    const producerKey = `${row.producerType}:${row.producerProcess}:${row.producerPid}`;
    if (sourceKeys.has(sourceKey) || sourcePaths.has(row.observationSource) || sourceHashes.has(row.sourceDocumentSha256) || producerKeys.has(producerKey)) {
      fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'release identity consumers do not have independent provenance', {
        consumer: row.consumer,
        sourceKey,
        sourceDocumentSha256: row.sourceDocumentSha256,
        producerKey
      });
    }
    sourceKeys.add(sourceKey);
    sourcePaths.add(row.observationSource);
    sourceHashes.add(row.sourceDocumentSha256);
    producerKeys.add(producerKey);
  }
  const reference = rows[0];
  const mismatches = [];
  for (const row of rows) for (const field of IDENTITY_FIELDS) if (row[field] !== reference[field]) mismatches.push({ consumer: row.consumer, field, expected: reference[field], actual: row[field] });
  if (mismatches.length) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'independently observed release identities disagree', { mismatches });
  return true;
}

module.exports = {
  CONSUMER_PROFILES,
  IDENTITY_FIELDS,
  assertIndependentObservations,
  canonical,
  createIdentityObservation,
  identityTuple,
  sha256,
  validateObservation
};
