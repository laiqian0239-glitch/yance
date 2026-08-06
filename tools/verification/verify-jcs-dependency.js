#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPECTED = Object.freeze({
  package: 'canonicalize',
  version: '2.1.0',
  license: 'Apache-2.0',
  sourceRepository: 'https://github.com/erdtman/canonicalize',
  sourceTag: 'v2.1.0',
  sourcePath: 'lib/canonicalize.js',
  moduleFormat: 'commonjs',
  runtimeDependencyCount: 0,
  distributionTarball: 'https://registry.npmjs.org/canonicalize/-/canonicalize-2.1.0.tgz',
  distributionIntegrity: 'sha512-F705O3xrsUtgt98j7leetNhTWPe+5S72rlL5O4jA1pKqBVQ/dT1O1D6PFxmSXvc0SUOinWS57DKx0I3CHrXJHQ==',
  vendoredPath: 'shared/verification/vendor/canonicalize-2.1.0.js'
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fail(message) {
  const error = new Error(message);
  error.code = 'EVIDENCE_SCHEMA_INVALID';
  throw error;
}

function verifyJcsDependency({ repoRoot }) {
  const metadataPath = path.join(
    repoRoot,
    'governance/verification/third-party/canonicalize-2.1.0.json'
  );
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  for (const [field, expected] of Object.entries(EXPECTED)) {
    if (metadata[field] !== expected) {
      fail(`canonicalize provenance mismatch: ${field}`);
    }
  }
  if (metadata.schemaVersion !== 1) {
    fail('canonicalize provenance schema mismatch');
  }
  if (!/^[0-9a-f]{64}$/u.test(metadata.vendoredSha256)) {
    fail('canonicalize vendored digest invalid');
  }
  const vendoredPath = path.resolve(repoRoot, metadata.vendoredPath);
  const relative = path.relative(repoRoot, vendoredPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('canonicalize vendored path escaped repository');
  }
  const actualSha256 = sha256File(vendoredPath);
  if (actualSha256 !== metadata.vendoredSha256) {
    fail('canonicalize vendored source digest mismatch');
  }
  return {
    pass: true,
    reasonCode: null,
    packageVersion: metadata.version,
    integrity: metadata.distributionIntegrity,
    sourceMode: 'vendored-upstream-tag',
    vendoredSha256: actualSha256
  };
}

if (require.main === module) {
  try {
    const result = verifyJcsDependency({
      repoRoot: path.resolve(__dirname, '..', '..')
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error.code || 'EVIDENCE_SCHEMA_INVALID'}: ${error.message}\n`
    );
    process.exitCode = 1;
  }
}

module.exports = { verifyJcsDependency };
