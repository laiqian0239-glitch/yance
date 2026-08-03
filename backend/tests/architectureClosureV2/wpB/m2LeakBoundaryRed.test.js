'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const registryPath = path.join(repoRoot, 'backend', 'services', 'durableOperationRegistry.js');
const operationRoot = path.join(repoRoot, 'backend', 'services', 'durableOperations');
const operationFiles = Object.freeze([
  'aiProviderExecutionOperation.js',
  'outboundMessageSendOperation.js',
  'deliveryReceiptReconciliationOperation.js',
  'mediaTransferOperation.js',
  'historySynchronizationOperation.js',
  'sessionRestoreOperation.js'
]);
const FORBIDDEN_PERSISTED_FIELDS = Object.freeze([
  'apiKey',
  'oauthToken',
  'accessToken',
  'refreshToken',
  'cookie',
  'sessionMaterial',
  'messageBody',
  'promptBody',
  'binaryPayload'
]);

function readRequired(filePath, code) {
  assert.equal(fs.existsSync(filePath), true, `${code}: ${path.relative(repoRoot, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('M2-LEAK-001 operation registry validates reference-only immutable envelopes', () => {
  const text = readRequired(registryPath, 'WP_B_M2_OPERATION_REGISTRY_REQUIRED');
  assert.match(text, /assertReferenceOnlyEnvelope|REFERENCE_ONLY_ENVELOPE/u);
  assert.match(text, /Object\.freeze|deepFreeze/u);
  for (const field of FORBIDDEN_PERSISTED_FIELDS) assert.match(text, new RegExp(field, 'u'));
});

test('M2-LEAK-002 every operation Adapter resolves custody references only at the physical boundary', () => {
  for (const fileName of operationFiles) {
    const text = readRequired(path.join(operationRoot, fileName), 'WP_B_M2_OPERATION_ADAPTER_REQUIRED');
    assert.match(text, /secretReference|credentialReference|custody/u, fileName);
    assert.match(text, /perform\s*\(/u, fileName);
    assert.doesNotMatch(text, /persist\w*\([^)]*(?:apiKey|oauthToken|cookie|messageBody|promptBody|binaryPayload)/iu, fileName);
  }
});

test('M2-LEAK-003 M2 evidence producers expose explicit zero-leak counters', () => {
  for (const relativePath of [
    'tools/architecture-closure-v2/run-wp-b-m2-contracts.js',
    'tools/architecture-closure-v2/wp-b-process-fault-matrix.js'
  ]) {
    const text = readRequired(path.join(repoRoot, relativePath), 'WP_B_M2_EVIDENCE_PRODUCER_REQUIRED');
    assert.match(text, /secretLeakCount/u, relativePath);
    assert.match(text, /businessContentLeakCount/u, relativePath);
  }
});

test('M2-LEAK-004 channel runtime no longer writes message or provider content into receipt payloads', () => {
  const text = readRequired(
    path.join(repoRoot, 'backend', 'services', 'channelAdapterRuntime.js'),
    'WP_B_M2_CHANNEL_RUNTIME_REQUIRED'
  );
  assert.doesNotMatch(text, /payload:\s*\{[^}]*source:\s*['"]ChannelAdapterRuntime\.sendMessage['"]/u);
  assert.match(text, /contentHash|commandContentSha256/u);
});
