#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validRelativePath } = require('../../shared/verification/canonicalEvidenceReceipt');
const { loadCommandSet } = require('../../shared/verification/commandSetRegistry');
const { verifyEvidenceReceipt } = require('../../shared/verification/trustedEvidencePolicy');
const { REASON_CODES } = require('../../shared/verification/reasonCodes');

const COMMIT_RE = /^[0-9a-f]{40}$/u;
const ALLOWED = new Set(['--receipt', '--expected-base', '--expected-head']);

function codedError(code) { const error = new Error(code); error.code = code; return error; }
function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!ALLOWED.has(flag) || value === undefined || value.startsWith('--')) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
    if (Object.hasOwn(values, flag)) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
    values[flag] = value;
  }
  if (Object.keys(values).length !== ALLOWED.size) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
  if (!validRelativePath(values['--receipt']) || !COMMIT_RE.test(values['--expected-base']) || !COMMIT_RE.test(values['--expected-head'])) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
  return { receipt: values['--receipt'], expectedBaseCommit: values['--expected-base'], expectedHeadCommit: values['--expected-head'] };
}

async function verifyReceiptObject({ receipt, expectedBaseCommit, expectedHeadCommit, executorRegistry, commandSetRegistry, artifactResolver = null, githubActionsClient = null }) {
  if (!COMMIT_RE.test(expectedBaseCommit || '') || !COMMIT_RE.test(expectedHeadCommit || '')) return { pass: false, reasonCode: REASON_CODES.EVIDENCE_SCHEMA_INVALID };
  return verifyEvidenceReceipt({
    receipt,
    expected: { repository: 'laiqian0239-glitch/yance', baseCommit: expectedBaseCommit, headCommit: expectedHeadCommit },
    registries: { executorRegistry, commandSetRegistry },
    adapters: { artifactResolver, githubActionsClient }
  });
}

async function main(argv = process.argv.slice(2), repoRoot = path.resolve(__dirname, '..', '..')) {
  const args = parse(argv);
  const receipt = JSON.parse(fs.readFileSync(path.join(repoRoot, args.receipt), 'utf8'));
  const executorRegistry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'governance/verification/trusted-executors.json'), 'utf8'));
  const commandSet = loadCommandSet({ repoRoot, commandSetId: receipt.commandSet.commandSetId });
  const commandSetRegistry = { [commandSet.commandSetId]: commandSet };
  const artifactResolver = (artifact) => fs.readFileSync(path.join(repoRoot, artifact.relativePath));
  const result = await verifyReceiptObject({ receipt, expectedBaseCommit: args.expectedBaseCommit, expectedHeadCommit: args.expectedHeadCommit, executorRegistry, commandSetRegistry, artifactResolver });
  if (!result.pass) throw codedError(result.reasonCode);
  process.stdout.write(`${JSON.stringify(result.fact)}\n`);
  return result;
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
module.exports = { main, parse, verifyReceiptObject };
