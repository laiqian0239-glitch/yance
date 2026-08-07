'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assembleSignedReceipt } = require('../../tools/verification/assemble-signed-receipt');
const { canonicalPayloadBytes, validateFinalReceipt } = require('../../shared/verification/canonicalEvidenceReceipt');
const { createContext } = require('./fixtures/receiptFactory');

function unsignedFrom(context) {
  const candidate = structuredClone(context.receipt);
  candidate.authenticity = null;
  candidate.receiptSha256 = null;
  return candidate;
}

test('assembler accepts only detached Ed25519 signature bytes and immediately re-verifies', () => {
  const context = createContext();
  const candidate = unsignedFrom(context);
  const signatureBytes = crypto.sign(null, canonicalPayloadBytes(candidate), context.privateKey);
  const result = assembleSignedReceipt({ candidate, signatureBytes, executorRegistry: context.executorRegistry, commandSetRegistry: context.commandSetRegistry, expected: context.expected });
  assert.equal(result.pass, true);
  assert.equal(validateFinalReceipt(result.receipt).pass, true);
  assert.equal(result.receipt.authenticity.executorId, candidate.producer.executorId);
});

test('malformed signatures, wrong identity and digest-text signatures fail without output', () => {
  const malformed = createContext();
  assert.equal(assembleSignedReceipt({ candidate: unsignedFrom(malformed), signatureBytes: Buffer.alloc(12), executorRegistry: malformed.executorRegistry, commandSetRegistry: malformed.commandSetRegistry, expected: malformed.expected }).reasonCode, 'EVIDENCE_SIGNATURE_FILE_INVALID');

  const wrongGeneration = createContext();
  const candidate = unsignedFrom(wrongGeneration);
  candidate.producer.keyGeneration = 2;
  candidate.canonicalPayloadSha256 = require('../../shared/verification/canonicalEvidenceReceipt').computeCanonicalPayloadSha256(candidate);
  const signature = crypto.sign(null, canonicalPayloadBytes(candidate), wrongGeneration.privateKey);
  assert.equal(assembleSignedReceipt({ candidate, signatureBytes: signature, executorRegistry: wrongGeneration.executorRegistry, commandSetRegistry: wrongGeneration.commandSetRegistry, expected: wrongGeneration.expected }).reasonCode, 'EVIDENCE_KEY_GENERATION_INVALID');

  const digestText = createContext();
  const digestCandidate = unsignedFrom(digestText);
  const digestSignature = crypto.sign(null, Buffer.from(digestCandidate.canonicalPayloadSha256, 'utf8'), digestText.privateKey);
  assert.equal(assembleSignedReceipt({ candidate: digestCandidate, signatureBytes: digestSignature, executorRegistry: digestText.executorRegistry, commandSetRegistry: digestText.commandSetRegistry, expected: digestText.expected }).reasonCode, 'EVIDENCE_SIGNATURE_INVALID');

  const failedCommand = createContext();
  const failedCandidate = unsignedFrom(failedCommand);
  failedCandidate.execution.commands[0].exitCode = 1;
  failedCandidate.results[0].passed = false;
  failedCandidate.canonicalPayloadSha256 = require('../../shared/verification/canonicalEvidenceReceipt').computeCanonicalPayloadSha256(failedCandidate);
  const failedSignature = crypto.sign(null, canonicalPayloadBytes(failedCandidate), failedCommand.privateKey);
  assert.equal(assembleSignedReceipt({ candidate: failedCandidate, signatureBytes: failedSignature, executorRegistry: failedCommand.executorRegistry, commandSetRegistry: failedCommand.commandSetRegistry, expected: failedCommand.expected }).reasonCode, 'EVIDENCE_COMMAND_FAILED');
});

test('production CLI exposes no private-key or arbitrary registry options', () => {
  const cli = path.resolve(__dirname, '../../tools/verification/assemble-signed-receipt.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pvep-assemble-cli-'));
  for (const args of [['--private-key', 'key.pem'], ['--key', 'key.pem'], ['--registry', 'registry.json'], ['--unknown', 'x']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: temp, shell: false, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /EVIDENCE_CLI_ARGUMENT_INVALID/u);
  }
});
