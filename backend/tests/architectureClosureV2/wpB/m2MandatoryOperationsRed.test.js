'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const servicesRoot = path.join(repoRoot, 'backend', 'services');
const operationsRoot = path.join(servicesRoot, 'durableOperations');

const REQUIRED_OPERATIONS = Object.freeze([
  ['AI_PROVIDER_EXECUTION', 'aiProviderExecutionOperation.js'],
  ['OUTBOUND_MESSAGE_SEND', 'outboundMessageSendOperation.js'],
  ['DELIVERY_RECEIPT_RECONCILIATION', 'deliveryReceiptReconciliationOperation.js'],
  ['MEDIA_TRANSFER', 'mediaTransferOperation.js'],
  ['HISTORY_SYNCHRONIZATION', 'historySynchronizationOperation.js'],
  ['SESSION_RESTORE', 'sessionRestoreOperation.js']
]);

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertProductionFile(relativePath, code) {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${code}: ${relativePath}`);
}

test('M2-OPS-001 durable operation registry owns the exact six operation kinds', () => {
  const relativePath = 'backend/services/durableOperationRegistry.js';
  assertProductionFile(relativePath, 'WP_B_M2_OPERATION_REGISTRY_REQUIRED');
  const text = source(relativePath);
  for (const [operationKind] of REQUIRED_OPERATIONS) assert.match(text, new RegExp(`['"]${operationKind}['"]`, 'u'));
  assert.doesNotMatch(text, /TEMPORARY|BYPASS|FALLBACK/iu);
});

for (const [operationKind, fileName] of REQUIRED_OPERATIONS) {
  test(`M2-OPS-${String(REQUIRED_OPERATIONS.findIndex(row => row[0] === operationKind) + 2).padStart(3, '0')} ${operationKind} has physical-call and reconciliation Adapter`, () => {
    const relativePath = `backend/services/durableOperations/${fileName}`;
    assertProductionFile(relativePath, 'WP_B_M2_OPERATION_ADAPTER_REQUIRED');
    const text = source(relativePath);
    assert.match(text, /\bperform\s*\(/u);
    assert.match(text, /\breconcile\s*\(/u);
    assert.match(text, new RegExp(`OPERATION_KINDS\\.${operationKind}\\b`, 'u'));
  });
}

test('M2-OPS-008 channel runtime no longer exposes dual-write physical-send ownership', () => {
  const text = source('backend/services/channelAdapterRuntime.js');
  assert.doesNotMatch(text, /migrationMode:\s*['"]dual-write-shadow['"]/u);
  assert.match(text, /migrationMode:\s*['"]durable-outbox-only['"]/u);
  assert.match(text, /attemptId/u);
  assert.match(text, /fencingToken/u);
});

test('M2-OPS-009 model execution creates durable AI execution and intent before worker fork', () => {
  const text = source('backend/services/modelExecutionHost.js');
  assert.match(text, /AI_PROVIDER_EXECUTION/u);
  assert.match(text, /createExecution/u);
  assert.match(text, /createIntent/u);
  assert.match(text, /startAttempt|ExternalActionDispatcher/u);
  assert.match(text, /UNCERTAIN_REMOTE_OUTCOME/u);
});

test('M2-OPS-010 communication authority delegates four communication operation kinds to WP-B', () => {
  const text = source('backend/services/communicationAuthority.js');
  for (const operationKind of [
    'OUTBOUND_MESSAGE_SEND',
    'DELIVERY_RECEIPT_RECONCILIATION',
    'MEDIA_TRANSFER',
    'HISTORY_SYNCHRONIZATION'
  ]) assert.match(text, new RegExp(operationKind, 'u'));
  assert.match(text, /createIntent/u);
  assert.doesNotMatch(text, /dual-write-shadow/u);
});

test('M2-OPS-011 startup session restoration is a durable request rather than direct SDK execution', () => {
  const accountManager = source('backend/services/accountManager.js');
  const composition = source('backend/runtime/AppRuntimeComposition.js');
  assert.match(accountManager, /SESSION_RESTORE/u);
  assert.match(accountManager, /createExecution|createIntent/u);
  assert.match(composition, /durableOperationRegistry|sessionRestoreOperation/u);
});
