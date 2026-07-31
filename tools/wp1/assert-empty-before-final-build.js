#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { assertEmptyBeforeFinalBuild, Wp1Error } = require('./lib');
const root = process.argv[2];
try {
  if (!root) throw new Wp1Error('WP1_STAGING_PATH_REQUIRED', 'staging path is required');
  process.stdout.write(`${JSON.stringify(assertEmptyBeforeFinalBuild(path.resolve(root)), null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP1_STAGING_CHECK_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(error.reasonCode ? 2 : 1);
}
