#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { scanForPipelineTestArtifacts } = require('./lib');
const rootArg = process.argv[2];
if (!rootArg) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: 'WP1_STAGING_PATH_REQUIRED' }, null, 2)}\n`);
  process.exit(2);
}
const result = scanForPipelineTestArtifacts(path.resolve(rootArg));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.status === 'PASS' ? 0 : 3);
