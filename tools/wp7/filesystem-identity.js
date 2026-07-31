'use strict';

const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/;

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function applicationPayloadFilesystemIdentitySha256(input) {
  const fields = [
    'applicationPayloadSha256',
    'productionDependencyFileTreeSha256',
    'productionDependencyModeTreeSha256',
    'productionDependencyDirectoryModeTreeSha256',
    'gitPayloadModeTreeSha256',
    'electronDistributionTreeSha256',
    'nodeRuntimeTreeSha256',
    'nativeBinaryScanSha256'
  ];
  for (const field of fields) {
    if (!SHA256_RE.test(String(input?.[field] || ''))) {
      const error = new Error(`filesystem identity input ${field} is invalid`);
      error.reasonCode = 'WP7_APPLICATION_PAYLOAD_FILESYSTEM_IDENTITY_INVALID';
      error.details = { field, value: input?.[field] };
      throw error;
    }
  }
  const document = {
    schemaVersion: 4,
    identityClass: 'APPLICATION_PAYLOAD_CONTENT_FILE_MODE_DIRECTORY_MODE_DISTRIBUTION_NODE_RUNTIME_AND_NATIVE_SCAN_IDENTITY',
    ...Object.fromEntries(fields.map((field) => [field, input[field]]))
  };
  return crypto.createHash('sha256').update(Buffer.from(`${JSON.stringify(sortValue(document), null, 2)}\n`, 'utf8')).digest('hex');
}

module.exports = { applicationPayloadFilesystemIdentitySha256 };
