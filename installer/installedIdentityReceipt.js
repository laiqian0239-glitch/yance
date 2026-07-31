'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonical, identityTuple, sha256 } = require('../shared/release/identityObservation');

const FILE_NAME = 'installer-release-identity.json';
const HASH_FILE_NAME = 'installer-release-identity.sha256';

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function createInstallerIdentityReceipt(identity, options = {}) {
  const tuple = identityTuple(identity);
  return {
    schemaVersion: 1,
    documentType: 'YANCE_INSTALLER_RELEASE_IDENTITY',
    consumer: 'installer',
    producerType: 'nsis-embedded-identity',
    producerProcess: 'YanceFinalInstaller.nsi',
    producerPid: 0,
    sourceKind: 'installer-embedded-document',
    generatedAtUtc: String(options.generatedAtUtc || new Date().toISOString()),
    installerScriptSha256: String(options.installerScriptSha256 || ''),
    ...tuple
  };
}

function writeInstallerIdentityReceipt(resourcesRoot, identity, options = {}) {
  const root = path.resolve(resourcesRoot);
  fs.mkdirSync(root, { recursive: true });
  const document = createInstallerIdentityReceipt(identity, options);
  const filePath = path.join(root, FILE_NAME);
  const bytes = canonical(document);
  fs.writeFileSync(filePath, bytes, { mode: 0o644 });
  const documentSha256 = sha256(bytes);
  const hashPath = path.join(root, HASH_FILE_NAME);
  fs.writeFileSync(hashPath, `${documentSha256}  ${FILE_NAME}\n`, 'utf8');
  return { document, filePath, hashPath, documentSha256 };
}

function readInstallerIdentityReceipt(resourcesRoot, expectedBuildId) {
  const root = path.resolve(resourcesRoot);
  const filePath = path.join(root, FILE_NAME);
  const hashPath = path.join(root, HASH_FILE_NAME);
  if (!fs.existsSync(filePath) || !fs.existsSync(hashPath)) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'installer identity receipt is missing', { filePath, hashPath });
  let document;
  try { document = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'installer identity receipt JSON is invalid', { filePath, message: error.message }); }
  const actualSha256 = sha256(fs.readFileSync(filePath));
  const match = fs.readFileSync(hashPath, 'utf8').match(/^([0-9a-f]{64})\s+installer-release-identity\.json\r?\n?$/);
  if (!match || match[1] !== actualSha256) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'installer identity receipt hash is invalid', { filePath, hashPath, actualSha256 });
  if (document.documentType !== 'YANCE_INSTALLER_RELEASE_IDENTITY' || document.consumer !== 'installer' || document.producerType !== 'nsis-embedded-identity') {
    fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'installer identity receipt schema is invalid', { filePath });
  }
  if (expectedBuildId && document.buildId !== expectedBuildId) fail('WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE', 'installer identity receipt buildId mismatch', { expectedBuildId, actualBuildId: document.buildId });
  return { document, filePath, hashPath, documentSha256: actualSha256 };
}

module.exports = {
  FILE_NAME,
  HASH_FILE_NAME,
  createInstallerIdentityReceipt,
  readInstallerIdentityReceipt,
  writeInstallerIdentityReceipt
};
