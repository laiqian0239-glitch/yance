#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { computeCanonicalPayloadSha256, computeReceiptSha256, validateUnsignedCandidate, validRelativePath } = require('../../shared/verification/canonicalEvidenceReceipt');
const { loadCommandSet } = require('../../shared/verification/commandSetRegistry');
const { verifySignedExecutorReceipt } = require('../../shared/verification/signedExecutorVerifier');
const { REASON_CODES } = require('../../shared/verification/reasonCodes');

function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function codedError(code) { const error = new Error(code); error.code = code; return error; }

function assembleSignedReceipt({ candidate, signatureBytes, executorRegistry, commandSetRegistry, expected = {}, artifactResolver = null }) {
  const candidateValidation = validateUnsignedCandidate(candidate);
  if (!candidateValidation.pass) return candidateValidation;
  if (computeCanonicalPayloadSha256(candidate) !== candidate.canonicalPayloadSha256) return fail(REASON_CODES.EVIDENCE_CANONICAL_DIGEST_MISMATCH);
  if (!Buffer.isBuffer(signatureBytes)) signatureBytes = Buffer.from(signatureBytes || []);
  if (signatureBytes.length !== 64) return fail(REASON_CODES.EVIDENCE_SIGNATURE_FILE_INVALID);

  const receipt = structuredClone(candidate);
  receipt.authenticity = { scheme: 'ed25519', executorId: candidate.producer.executorId, keyGeneration: candidate.producer.keyGeneration, signatureBase64: signatureBytes.toString('base64') };
  receipt.receiptSha256 = computeReceiptSha256(receipt);
  const verification = verifySignedExecutorReceipt({ receipt, expected, executorRegistry, commandSetRegistry, artifactResolver });
  if (!verification.pass) return verification;
  return { pass: true, receipt, fact: verification.fact };
}

const ALLOWED = new Set(['--candidate', '--signature', '--output']);
function parse(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!ALLOWED.has(flag) || value === undefined || value.startsWith('--')) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
    values[flag.slice(2)] = value;
  }
  if (Object.keys(values).length !== ALLOWED.size || Object.values(values).some((value) => !validRelativePath(value))) throw codedError(REASON_CODES.EVIDENCE_CLI_ARGUMENT_INVALID);
  return values;
}

function main(argv = process.argv.slice(2), repoRoot = path.resolve(__dirname, '..', '..')) {
  const args = parse(argv);
  const candidate = JSON.parse(fs.readFileSync(path.join(repoRoot, args.candidate), 'utf8'));
  const signatureBytes = fs.readFileSync(path.join(repoRoot, args.signature));
  const executorRegistry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'governance/verification/trusted-executors.json'), 'utf8'));
  const commandSet = loadCommandSet({ repoRoot, commandSetId: candidate.commandSet.commandSetId });
  const commandSetRegistry = { [commandSet.commandSetId]: commandSet };
  const expected = { repository: candidate.repository, workPackage: candidate.workPackage, gateId: candidate.gateId, baseCommit: candidate.baseCommit, headCommit: candidate.headCommit };
  const artifactResolver = (artifact) => fs.readFileSync(path.join(repoRoot, artifact.relativePath));
  const result = assembleSignedReceipt({ candidate, signatureBytes, executorRegistry, commandSetRegistry, expected, artifactResolver });
  if (!result.pass) throw codedError(result.reasonCode);
  const outputPath = path.join(repoRoot, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result.receipt, null, 2)}\n`, 'utf8');
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; }
}
module.exports = { assembleSignedReceipt, main, parse };
