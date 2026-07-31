#!/usr/bin/env node
'use strict';
const { readJson, MATRICES_PATH, writeCanonicalJson } = require('./lib');
const { runReasonOracle } = require('./oracles');

const matrix = readJson(MATRICES_PATH).faultMatrix || [];
const results = [];
let failed = 0;
for (const item of matrix) {
  try {
    const oracle = runReasonOracle(item.reasonCode);
    results.push({ id: item.id, status: 'PASS', expectedReasonCode: item.reasonCode, observedReasonCode: oracle.reasonCode });
  } catch (error) {
    failed += 1;
    results.push({ id: item.id, status: 'FAIL', expectedReasonCode: item.reasonCode, error: error.message });
  }
}
const summary = { schemaVersion: 1, documentType: 'WP7_FAULT_MATRIX_RESULT', total: matrix.length, passed: matrix.length - failed, failed, status: failed ? 'FAIL' : 'PASS', results };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exit(failed ? 1 : 0);
