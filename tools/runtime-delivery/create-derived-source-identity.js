'use strict';

const path = require('node:path');
const { createDerivedSourceIdentity } = require('./source-uat-delivery');

function value(argv, name) {
  const prefix = `--${name}=`;
  return argv.find(item => item.startsWith(prefix))?.slice(prefix.length) || '';
}

function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(value(argv, 'root') || process.cwd());
  const document = createDerivedSourceIdentity(repoRoot, {
    derivedVersion: value(argv, 'derived-version'),
    releaseBatch: value(argv, 'release-batch'),
    baseCommit: value(argv, 'base-commit'),
    baseTree: value(argv, 'base-tree')
  });
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

try { main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_DERIVED_IDENTITY_CREATE_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exitCode = 1;
}
