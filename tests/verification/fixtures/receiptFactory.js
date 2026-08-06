'use strict';

const crypto = require('node:crypto');
const { canonicalSha256, sha256Hex } = require('../../../shared/verification/jcs');
const { canonicalPayloadBytes, computeCanonicalPayloadSha256, computeReceiptSha256 } = require('../../../shared/verification/canonicalEvidenceReceipt');
const { commandSetDigest } = require('../../../shared/verification/commandSetRegistry');

const EMPTY_SHA256 = sha256Hex(Buffer.alloc(0));
const EMPTY_PATH_SET_SHA256 = sha256Hex(Buffer.from('\n'));
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);

function createCommandSet() {
  return { schemaVersion: 1, commandSetId: 'pvep-linux-selftest-v1', platform: 'linux', commands: [{ commandId: 'pvep-required-tests', executable: 'node', argv: ['tools/verification/run-required-tests.js'], expectedExitCode: 0, generatedRoots: ['.pvep-output'], artifacts: ['.pvep-output/report.json'] }] };
}
function commandArgvDigest(command) { return canonicalSha256({ executable: command.executable, argv: command.argv }); }

function createContext() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const commandSet = createCommandSet();
  const digest = commandSetDigest(commandSet);
  const artifactBytes = Buffer.from('{"pass":true}\n');
  const executor = {
    executorId: 'linux-executor-01', platform: 'linux', architecture: 'x64', keyAlgorithm: 'Ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), keyGeneration: 1, status: 'ACTIVE',
    validFrom: '2026-08-07T00:00:00.000Z', allowedCommandSetDigests: [digest],
    signerIsolation: { status: 'VERIFIED', runnerPrincipal: 'runner', signerPrincipal: 'signer', keyCustody: 'OS_KEYSTORE_NON_EXPORTABLE', evidenceSha256: 'c'.repeat(64) }
  };
  const receipt = {
    schemaVersion: 1, recordType: 'YANCE_PORTABLE_VERIFICATION_EVIDENCE_RECEIPT', repository: 'laiqian0239-glitch/yance', workPackage: 'PVEP', gateId: 'pvep-linux-selftest', baseCommit: BASE, headCommit: HEAD, adapterType: 'signed-executor-v1',
    producer: { executorId: executor.executorId, platform: 'linux', architecture: 'x64', nodeVersion: '22.16.0', npmVersion: '10.9.2', keyGeneration: 1 },
    commandSet: { commandSetId: commandSet.commandSetId, commandSetDigest: digest, platform: 'linux' },
    execution: { startedAt: '2026-08-07T00:00:00.000Z', completedAt: '2026-08-07T00:00:01.000Z', commands: [{ commandId: 'pvep-required-tests', argvDigest: commandArgvDigest(commandSet.commands[0]), exitCode: 0, startedAt: '2026-08-07T00:00:00.000Z', completedAt: '2026-08-07T00:00:01.000Z', stdoutSha256: EMPTY_SHA256, stderrSha256: EMPTY_SHA256 }] },
    workspace: { preHead: HEAD, postHead: HEAD, preTrackedDiffSha256: EMPTY_SHA256, postTrackedDiffSha256: EMPTY_SHA256, preUnexpectedUntrackedPathSetSha256: EMPTY_PATH_SET_SHA256, postUnexpectedUntrackedPathSetSha256: EMPTY_PATH_SET_SHA256, allowedGeneratedRootSetSha256: canonicalSha256(['.pvep-output']) },
    results: [{ commandId: 'pvep-required-tests', passed: true }],
    artifacts: [{ artifactId: 'report', relativePath: '.pvep-output/report.json', sha256: sha256Hex(artifactBytes), sizeBytes: artifactBytes.length, mediaType: 'application/json', producerCommandId: 'pvep-required-tests' }],
    canonicalPayloadSha256: null, authenticity: null, receiptSha256: null
  };
  function reseal(target = receipt) {
    target.canonicalPayloadSha256 = computeCanonicalPayloadSha256(target);
    const signature = crypto.sign(null, canonicalPayloadBytes(target), privateKey);
    target.authenticity = { scheme: 'ed25519', executorId: target.producer.executorId, keyGeneration: target.producer.keyGeneration, signatureBase64: signature.toString('base64') };
    target.receiptSha256 = computeReceiptSha256(target);
    return target;
  }
  reseal(receipt);
  return { receipt, commandSet, commandSetRegistry: { [commandSet.commandSetId]: commandSet }, executorRegistry: { schemaVersion: 1, executors: [executor] }, artifactBytes, privateKey, reseal, expected: { repository: receipt.repository, workPackage: receipt.workPackage, gateId: receipt.gateId, baseCommit: BASE, headCommit: HEAD } };
}

module.exports = { BASE, HEAD, createContext, EMPTY_PATH_SET_SHA256, EMPTY_SHA256 };
