#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadCommandSet } = require('../../shared/verification/commandSetRegistry');
const { runRegisteredCommandSet } = require('../../shared/verification/commandSetRunner');
const { REASON_CODES } = require('../../shared/verification/reasonCodes');

const ALLOWED = new Set(['--command-set-id', '--base', '--head', '--output']);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!ALLOWED.has(flag) || value === undefined || value.startsWith('--')) fail(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
    values[flag.slice(2)] = value;
  }
  if (Object.keys(values).length !== ALLOWED.size) fail(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
  return values;
}
function main(argv = process.argv.slice(2), repoRoot = path.resolve(__dirname, '..', '..')) {
  const args = parse(argv);
  const commandSet = loadCommandSet({ repoRoot, commandSetId: args['command-set-id'] });
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'governance/verification/trusted-executors.json'), 'utf8'));
  const active = registry.executors.filter((entry) => entry.status === 'ACTIVE' && entry.platform === commandSet.platform);
  if (active.length !== 1) fail('EVIDENCE_EXECUTOR_UNKNOWN');
  const executor = active[0];
  return runRegisteredCommandSet({ repoRoot, repository: 'laiqian0239-glitch/yance', workPackage: 'PVEP', gateId: commandSet.commandSetId, baseCommit: args.base, headCommit: args.head, commandSet, producer: { executorId: executor.executorId, platform: executor.platform, architecture: executor.architecture, nodeVersion: process.versions.node, npmVersion: 'unknown', keyGeneration: executor.keyGeneration }, outputPath: args.output });
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; }
}
module.exports = { main, parse };
