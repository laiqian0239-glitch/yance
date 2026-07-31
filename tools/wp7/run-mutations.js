#!/usr/bin/env node
'use strict';
const { readJson, MATRICES_PATH } = require('./lib');
const { runReasonOracle } = require('./oracles');
const mutations = readJson(MATRICES_PATH).mutationMatrix || [];
const results = [];
let survived = 0, invalid = 0, harnessError = 0;
for (const item of mutations) {
  try {
    const result = runReasonOracle(item.expectedReasonCode);
    if (result.status === 'KILLED') results.push({ id: item.id, status: 'KILLED', expectedReasonCode: item.expectedReasonCode, observedReasonCode: result.reasonCode });
    else { survived += 1; results.push({ id: item.id, status: 'SURVIVED', expectedReasonCode: item.expectedReasonCode }); }
  } catch (error) {
    harnessError += 1;
    results.push({ id: item.id, status: 'HARNESS_ERROR', expectedReasonCode: item.expectedReasonCode, error: error.message });
  }
}
const killed = mutations.length - survived - invalid - harnessError;
const status = survived || invalid || harnessError ? 'FAIL' : 'PASS';
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, documentType: 'WP7_MUTATION_RESULT', total: mutations.length, killed, survived, invalid, timeout: 0, signal: 0, harnessError, status, results }, null, 2)}\n`);
process.exit(status === 'PASS' ? 0 : 1);
