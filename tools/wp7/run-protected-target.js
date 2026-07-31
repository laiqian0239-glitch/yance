#!/usr/bin/env node
'use strict';
const os = require('node:os');
const path = require('node:path');
const { protectedTarget, Wp7Error } = require('./lib');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const command = process.argv[2];
try {
  const outputRoot = path.resolve(arg('--output-dir', path.join(os.tmpdir(), `yance-wp7-${command || 'unknown'}-${process.pid}`)));
  const result = protectedTarget(command, {
    outputRoot,
    buildTimestampUtc: arg('--build-timestamp-utc', new Date().toISOString()),
    authorizationToken: arg('--authorization-token', process.env.WP7_FINAL_PACKAGING_AUTHORIZATION || null),
    preacceptanceRecordPath: arg('--preacceptance-record', process.env.WP7_PREACCEPTANCE_RECORD || null),
    preacceptanceRecordSha256: arg('--preacceptance-record-sha256', process.env.WP7_PREACCEPTANCE_RECORD_SHA256 || null)
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', reasonCode: null, command, outputRoot, sourceCommit: result.identity?.sourceCommit, sourceTree: result.identity?.sourceTree, buildId: result.buildId, artifactClass: result.evidenceClass || 'WP7_PRE_REVIEW_ONLY' }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_PROTECTED_COMMAND_FAILED', command, message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(error instanceof Wp7Error ? 2 : 1);
}
