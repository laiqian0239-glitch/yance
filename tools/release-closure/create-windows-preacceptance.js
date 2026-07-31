#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { atomicWriteJson } = require('../wp7/command-supervisor');
const { validateRoundPair } = require('./windows-round-binding');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${key || '<end>'}`);
    result[key.slice(2)] = value;
  }
  for (const required of ['output', 'round1-result', 'round1-sha256', 'round2-result', 'round2-sha256']) {
    if (!result[required]) throw new Error(`missing required option --${required}`);
  }
  return result;
}

function createRecord(options) {
  const binding = validateRoundPair({
    round1Result: options.round1Result,
    round1Sha256: options.round1Sha256,
    round2Result: options.round2Result,
    round2Sha256: options.round2Sha256,
    expectedCommit: options.expectedCommit,
    expectedTree: options.expectedTree,
    expectedBranch: options.expectedBranch
  });
  return {
    schemaVersion: 2,
    documentType: 'WP7_PREACCEPTANCE_BINDING',
    decision: 'WP7_PREACCEPTED_FOR_FINAL_PACKAGING',
    independentReview: true,
    productionImplementationAccepted: true,
    implementationCommit: binding.commit,
    implementationSourceTree: binding.tree,
    implementationBranch: binding.branch,
    windowsInternalValidation: {
      status: 'PASS_TWO_INDEPENDENT_STRICT_ROUNDS',
      bundleSha256: binding.bundleSha256,
      runnerSha256: binding.runnerSha256,
      node: binding.node,
      npm: binding.npm,
      round1ResultSha256: binding.round1.sha256,
      round2ResultSha256: binding.round2.sha256
    },
    generatedAtUtc: new Date().toISOString()
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const record = createRecord({
    round1Result: args['round1-result'],
    round1Sha256: args['round1-sha256'],
    round2Result: args['round2-result'],
    round2Sha256: args['round2-sha256'],
    expectedCommit: args['expected-commit'],
    expectedTree: args['expected-tree'],
    expectedBranch: args['expected-branch']
  });
  const output = path.resolve(args.output);
  atomicWriteJson(output, record);
  process.stdout.write(`${output}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { parseArgs, createRecord };
