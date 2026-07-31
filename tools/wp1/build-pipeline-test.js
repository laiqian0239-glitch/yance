#!/usr/bin/env node
'use strict';

const path = require('node:path');
const os = require('node:os');
const { buildPipelineTest, Wp1Error } = require('./lib');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

try {
  const outputRoot = path.resolve(arg('--output-dir', path.join(os.tmpdir(), 'yance-wp1-pipeline-test')));
  const result = buildPipelineTest({
    repoRoot: path.resolve(arg('--repo-root', path.resolve(__dirname, '..', '..'))),
    outputRoot,
    sourceCommit: arg('--source-commit'),
    buildTimestampUtc: arg('--build-timestamp-utc', new Date().toISOString()),
    requireClean: !process.argv.includes('--allow-dirty')
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', reasonCode: null, ...result.summary }, null, 2)}\n`);
} catch (error) {
  const reasonCode = error.reasonCode || 'WP1_PIPELINE_TEST_FAILED';
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode, message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(error instanceof Wp1Error ? 2 : 1);
}
