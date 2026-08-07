#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validRelativePath } = require('../../shared/verification/canonicalEvidenceReceipt');
const { loadCommandSet, commandSetDigest } = require('../../shared/verification/commandSetRegistry');
const { verifyEvidenceReceipt } = require('../../shared/verification/trustedEvidencePolicy');
const { aggregateRequirementSet } = require('../../shared/verification/requirementAggregator');
const { REASON_CODES } = require('../../shared/verification/reasonCodes');

const COMMIT_RE = /^[0-9a-f]{40}$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;
const ALLOWED = new Set(['--manifest', '--receipts', '--expected-base', '--expected-head']);

function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function codedError(code) { const error = new Error(code); error.code = code; return error; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!ALLOWED.has(flag) || value === undefined || value.startsWith('--') || Object.hasOwn(values, flag)) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
    values[flag] = value;
  }
  if (Object.keys(values).length !== ALLOWED.size) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
  if (!validRelativePath(values['--manifest']) || !validRelativePath(values['--receipts']) || !COMMIT_RE.test(values['--expected-base']) || !COMMIT_RE.test(values['--expected-head'])) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
  return { manifest: values['--manifest'], receipts: values['--receipts'], expectedBaseCommit: values['--expected-base'], expectedHeadCommit: values['--expected-head'] };
}

function validateRequirementManifest({ manifest, repoRoot }) {
  if (!exactKeys(manifest, ['schemaVersion', 'requirementSetId', 'commandSetIds', 'requirements']) || manifest.schemaVersion !== 1 || manifest.requirementSetId !== 'pvep-selftest-v1') return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (!exactKeys(manifest.commandSetIds, ['linux', 'windows']) || !Array.isArray(manifest.requirements) || manifest.requirements.length !== 2) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const requirements = [];
  const commandSetRegistry = {};
  const seenPlatforms = new Set();
  for (const requirement of manifest.requirements) {
    if (!exactKeys(requirement, ['gateId', 'platform', 'commandSetDigest']) || !['linux', 'windows'].includes(requirement.platform) || typeof requirement.gateId !== 'string' || !HASH_RE.test(requirement.commandSetDigest || '') || seenPlatforms.has(requirement.platform)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    seenPlatforms.add(requirement.platform);
    const commandSetId = manifest.commandSetIds[requirement.platform];
    if (typeof commandSetId !== 'string' || requirement.gateId !== commandSetId.replace(/-v1$/u, '')) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    let commandSet;
    try { commandSet = loadCommandSet({ repoRoot, commandSetId }); } catch (error) { return fail(error.code || REASON_CODES.EVIDENCE_COMMAND_SET_UNKNOWN); }
    const digest = commandSetDigest(commandSet);
    if (digest !== requirement.commandSetDigest) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_DIGEST_MISMATCH, { platform: requirement.platform });
    commandSetRegistry[commandSetId] = commandSet;
    requirements.push(structuredClone(requirement));
  }
  if (!seenPlatforms.has('linux') || !seenPlatforms.has('windows')) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  return { pass: true, requirements, commandSetRegistry };
}

async function verifyRequirementSetObjects({ manifest, receipts, expectedBaseCommit, expectedHeadCommit, repoRoot, executorRegistry, adapters = {} }) {
  const manifestResult = validateRequirementManifest({ manifest, repoRoot });
  if (!manifestResult.pass) return manifestResult;
  if (!Array.isArray(receipts)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const facts = [];
  for (const receipt of receipts) {
    const result = await verifyEvidenceReceipt({
      receipt,
      expected: { repository: 'laiqian0239-glitch/yance', baseCommit: expectedBaseCommit, headCommit: expectedHeadCommit },
      registries: { executorRegistry, commandSetRegistry: manifestResult.commandSetRegistry },
      adapters
    });
    if (!result.pass) return result;
    facts.push(result.fact);
  }
  return aggregateRequirementSet({ requirements: manifestResult.requirements, facts, expectedBaseCommit, expectedHeadCommit });
}

async function main(argv = process.argv.slice(2), repoRoot = path.resolve(__dirname, '..', '..')) {
  const args = parse(argv);
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, args.manifest), 'utf8'));
  const receiptRoot = path.join(repoRoot, args.receipts);
  const names = fs.readdirSync(receiptRoot).filter((name) => name.endsWith('.json')).sort();
  const receipts = names.map((name) => JSON.parse(fs.readFileSync(path.join(receiptRoot, name), 'utf8')));
  const executorRegistry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'governance/verification/trusted-executors.json'), 'utf8'));
  const artifactResolver = (artifact) => fs.readFileSync(path.join(repoRoot, artifact.relativePath));
  const result = await verifyRequirementSetObjects({ manifest, receipts, expectedBaseCommit: args.expectedBaseCommit, expectedHeadCommit: args.expectedHeadCommit, repoRoot, executorRegistry, adapters: { artifactResolver } });
  if (!result.pass) throw codedError(result.reasonCode);
  process.stdout.write(`${JSON.stringify({ pass: true, matchedReceiptSha256: result.matchedFacts.map((fact) => fact.receiptSha256) })}\n`);
  return result;
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
module.exports = { main, parse, validateRequirementManifest, verifyRequirementSetObjects };
