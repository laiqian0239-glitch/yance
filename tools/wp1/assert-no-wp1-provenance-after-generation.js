#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { assertNoWp1ProvenanceAfterGeneration, Wp1Error } = require('./lib');
function values(flag) {
  const out = [];
  for (let i = 2; i < process.argv.length; i += 1) if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[++i]);
  return out;
}
const stagingRoot = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
try {
  if (!stagingRoot) throw new Wp1Error('WP1_STAGING_PATH_REQUIRED', 'staging path is required');
  const indexes = values('--provenance-index').map(item => path.resolve(item));
  process.stdout.write(`${JSON.stringify(assertNoWp1ProvenanceAfterGeneration(path.resolve(stagingRoot), indexes), null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP1_STAGING_CHECK_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(error.reasonCode ? 2 : 1);
}
