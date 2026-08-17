'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const receiptPath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-m3-authorization.json'
);
const verifierPath = path.join(
  repoRoot,
  'tools',
  'architecture-closure-v2',
  'verify-wp-b-m3-authorization.js'
);
const authorityPath = path.join(
  repoRoot,
  'shared',
  'release',
  'acv2ActiveWorkPackageAuthority.js'
);
const CLOSED_FIELDS = Object.freeze([
  'readyForPromotion',
  'mergeAuthorized',
  'productionUseAuthorized',
  'wpCAuthorized',
  'formalRelease',
  'publish',
  'temporaryBypassAllowed',
  'warningOnlyClosureAllowed'
]);

function loadAuthority() {
  delete require.cache[require.resolve(authorityPath)];
  return require(authorityPath);
}

function readReceiptWhenPresent() {
  if (!fs.existsSync(receiptPath)) return null;
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

test('M3-AUTH-001 machine-readable Milestone 3 authorization receipt exists', () => {
  assert.equal(fs.existsSync(receiptPath), true, 'M3-AUTH-001');
});

test('M3-AUTH-002 strict Milestone 3 authorization verifier exists', () => {
  assert.equal(fs.existsSync(verifierPath), true, 'M3-AUTH-002');
});

test('M3-AUTH-003 active work-package authority exposes an M3 resolver', () => {
  const authority = loadAuthority();
  assert.equal(
    typeof authority.resolveWpBM3ImplementationAuthority,
    'function',
    'M3-AUTH-003'
  );
});

test('M3-AUTH-004 active authority resolves Milestone 3 instead of inherited M2 authority', () => {
  const authority = loadAuthority();
  const resolved = typeof authority.resolveWpBM3ImplementationAuthority === 'function'
    ? authority.resolveWpBM3ImplementationAuthority({ repositoryRoot: repoRoot })
    : null;
  assert.equal(resolved?.milestone, 3, 'M3-AUTH-004');
});

test('M3-AUTH-005 receipt opens only Milestone 3 while downstream authority stays closed', () => {
  const receipt = readReceiptWhenPresent();
  assert.equal(receipt?.governance?.milestone3Authorized, true, 'M3-AUTH-005');
  assert.equal(receipt?.governance?.prMustRemainDraft, true, 'M3-AUTH-005');
  for (const field of CLOSED_FIELDS) {
    assert.equal(receipt?.governance?.[field], false, `M3-AUTH-005:${field}`);
  }
});

test('M3-AUTH-006 verifier rejects wildcard scope and downstream-governance mutations', () => {
  assert.equal(fs.existsSync(verifierPath), true, 'M3-AUTH-006');
  const verifier = require(verifierPath);
  const receipt = readReceiptWhenPresent();
  assert.equal(typeof verifier.validateReceipt, 'function', 'M3-AUTH-006');
  assert.ok(receipt, 'M3-AUTH-006');

  const wildcard = structuredClone(receipt);
  wildcard.allowedPaths.push('backend/**');
  assert.throws(
    () => verifier.validateReceipt(wildcard),
    error => error?.code === 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID',
    'M3-AUTH-006'
  );

  const opened = structuredClone(receipt);
  opened.governance.mergeAuthorized = true;
  assert.throws(
    () => verifier.validateReceipt(opened),
    error => error?.code === 'WP_B_M3_AUTHORIZATION_GOVERNANCE_OPEN',
    'M3-AUTH-006'
  );
});

test('M3-SC-DIAG-015 legacy send-queue startup owns no retry timer', () => {
  const servicePath = path.join(repoRoot, 'backend', 'services', 'sendQueueService.js');
  delete require.cache[require.resolve(servicePath)];
  const { SendQueueService } = require(servicePath);
  const service = new SendQueueService();
  const originalSetInterval = global.setInterval;
  let timerCalls = 0;

  global.setInterval = () => {
    timerCalls += 1;
    return { unref() {} };
  };
  try {
    service.start();
    service.stop();
    assert.equal(timerCalls, 0, 'M3-SC-DIAG-015:NO_LEGACY_RETRY_TIMER');
  } finally {
    global.setInterval = originalSetInterval;
    delete require.cache[require.resolve(servicePath)];
  }
});

test('M3-SC-DIAG-016 send-queue repository exposes no legacy scheduler mutation surface', () => {
  const repositoryPath = path.join(repoRoot, 'backend', 'repositories', 'sendQueueRepository.js');
  delete require.cache[require.resolve(repositoryPath)];
  const repository = require(repositoryPath);
  for (const method of [
    'claimNext',
    'recoverInterrupted',
    'retry',
    'cancel',
    'defer',
    'markResult',
    'checkpointDelivery'
  ]) {
    assert.equal(typeof repository[method], 'undefined', `M3-SC-DIAG-016:${method}`);
  }
});

test('M3-SC-DIAG-017 outbound compatibility facade dispatches one persisted attempt and never resends a terminal intent', async () => {
  const servicePath = path.join(repoRoot, 'backend', 'services', 'sendQueueService.js');
  const sendMessagePath = path.join(repoRoot, 'backend', 'services', 'sendMessageService.js');
  delete require.cache[require.resolve(servicePath)];
  const sendMessageService = require(sendMessagePath);
  const originalResolveAccount = sendMessageService.resolveAccount;
  let adapterCalls = 0;
  let adapterInput = null;
  let transitionCalls = 0;
  let execution = { executionId: 'execution-outbound-1', state: 'CREATED', stateVersion: 0, generation: 0 };
  let intent = {
    intentId: 'send-outbound-1',
    executionId: execution.executionId,
    claim: { state: 'READY', stateVersion: 0, generation: 0 }
  };
  const durableExecutionAuthority = {
    createExecution(input) {
      if (execution.state === 'CREATED' && execution.stateVersion === 0) {
        execution = { ...execution, executionId: input.executionId };
      }
      return execution;
    },
    schedule() {
      execution = { ...execution, state: 'SCHEDULED', stateVersion: 1 };
      return execution;
    },
    claim(input) {
      execution = {
        ...execution,
        state: 'CLAIMED',
        stateVersion: 2,
        generation: 1,
        ownerId: input.ownerId,
        claimId: input.claimId
      };
      return execution;
    },
    transition(input) {
      transitionCalls += 1;
      assert.deepEqual(input.allowedStates, ['CLAIMED']);
      execution = { ...execution, state: input.targetState, stateVersion: execution.stateVersion + 1 };
      return execution;
    }
  };
  const outboxAuthority = {
    createIntent(input) {
      intent = { ...intent, intentId: input.intentId, executionId: input.executionId };
      return intent;
    },
    intent() { return intent; },
    claimIntent(input) {
      intent = {
        ...intent,
        claim: {
          state: 'CLAIMED',
          stateVersion: 1,
          generation: 1,
          ownerId: input.ownerId,
          claimId: input.claimId,
          hostGeneration: input.hostGeneration,
          fencingToken: input.fencingToken
        }
      };
      return intent;
    },
    startAttempt(input) {
      intent = { ...intent, claim: { ...intent.claim, state: 'ATTEMPTED', stateVersion: 2 } };
      return {
        intentId: intent.intentId,
        attemptId: 'attempt-outbound-1',
        stateVersion: 2,
        generation: intent.claim.generation,
        ownerId: input.ownerId,
        claimId: input.claimId,
        hostGeneration: input.hostGeneration,
        fencingToken: input.fencingToken
      };
    },
    recordReceipt() {
      intent = { ...intent, claim: { ...intent.claim, state: 'COMPLETED', stateVersion: 3 } };
      return {
        receiptId: 'receipt-outbound-1',
        receiptType: 'SUCCESS',
        providerReceiptId: 'provider-receipt-outbound-1'
      };
    },
    recordFailureReceipt() { throw new Error('unexpected failure receipt'); },
    markUncertain() { throw new Error('unexpected uncertain receipt'); }
  };
  const adapter = {
    async perform(input) {
      adapterCalls += 1;
      adapterInput = input;
      return {
        providerReceiptId: 'provider-receipt-outbound-1',
        evidenceReference: 'provider:evidence:outbound-1',
        result: { accepted: true }
      };
    }
  };
  const row = {
    id: 'send-outbound-1',
    idempotency_key: 'idem-outbound-1',
    account_id: 'account-outbound-1',
    session_key: 'account-outbound-1:chat-outbound-1',
    message_type: 'text',
    state: 'pending',
    outbox_id: 'send-outbound-1',
    payload: {
      platform: 'whatsapp',
      chatJid: 'chat-outbound-1',
      outboxCommand: { commandSha256: 'a'.repeat(64) }
    }
  };
  sendMessageService.resolveAccount = () => ({
    platform: 'whatsapp',
    accountId: row.account_id,
    account: { credentialRef: 'credential-ref-outbound-1' }
  });
  try {
    const { SendQueueService } = require(servicePath);
    const service = new SendQueueService({
      communicationAuthority: { durableExecutionAuthority, outboxAuthority },
      sendPolicyAuthority: { verifyFrozenCommand() { return { ok: true }; } },
      authorityTokenProvider: () => ({ instanceId: 'host-outbound-1', hostGeneration: 1, fencingToken: 1 }),
      durableRuntime: { registry: { require(kind) { assert.equal(kind, 'OUTBOUND_MESSAGE_SEND'); return adapter; } } }
    });
    const first = await service.dispatchDurableQueueItem(row);
    assert.equal(first.state, 'sent');
    assert.equal(adapterCalls, 1);
    assert.equal(adapterInput.executionId, execution.executionId);
    assert.equal(adapterInput.intentId, intent.intentId);
    assert.equal(adapterInput.attemptId, 'attempt-outbound-1');
    assert.equal(adapterInput.request.commandReference, 'send-outbound-1');
    assert.equal(transitionCalls, 1);
    const second = await service.dispatchDurableQueueItem(row);
    assert.equal(second.state, 'sent');
    assert.equal(adapterCalls, 1, 'terminal durable intent must not perform a second physical send');
    assert.equal(transitionCalls, 1);
  } finally {
    sendMessageService.resolveAccount = originalResolveAccount;
    delete require.cache[require.resolve(servicePath)];
  }
});

test('M3-SC-DIAG-018 exact-six AI provider client preserves the full persisted attempt at the physical boundary', () => {
  const compositionPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeComposition.js');
  const source = fs.readFileSync(compositionPath, 'utf8');
  const start = source.indexOf('function createAiProviderClient()');
  const end = source.indexOf('function createMultiplexChannelClient()', start);
  assert.ok(start >= 0 && end > start, 'M3-SC-DIAG-018:AI_PROVIDER_CLIENT_BOUNDARY_REQUIRED');
  const clientSource = source.slice(start, end);
  assert.doesNotMatch(
    clientSource,
    /aiGateway\.execute\s*\(/u,
    'M3-SC-DIAG-018:LEGACY_AI_GATEWAY_EXECUTE_BYPASS_FORBIDDEN'
  );
  assert.match(
    clientSource,
    /aiGateway\.performPersistedAttempt\s*\(/u,
    'M3-SC-DIAG-018:PERSISTED_AI_PHYSICAL_ENTRY_REQUIRED'
  );
  for (const field of [
    'executionId', 'intentId', 'attemptId', 'claimId', 'ownerId',
    'generation', 'hostGeneration', 'fencingToken', 'idempotencyKey',
    'requestContentSha256', 'credential'
  ]) {
    assert.match(clientSource, new RegExp(`\\b${field}\\b`, 'u'), `M3-SC-DIAG-018:${field}`);
  }
});

test('M3-SC-DIAG-019 AI gateway validates persisted claim and fencing identity before Model Brain physical execution', () => {
  const gatewayPath = path.join(repoRoot, 'backend', 'services', 'aiGateway.js');
  const source = fs.readFileSync(gatewayPath, 'utf8');
  assert.match(
    source,
    /function validatePersistedAiPhysicalInput\s*\(/u,
    'M3-SC-DIAG-019:PERSISTED_AI_VALIDATOR_REQUIRED'
  );
  const start = source.indexOf('async performPersistedAttempt(');
  assert.ok(start >= 0, 'M3-SC-DIAG-019:PERSISTED_AI_PHYSICAL_ENTRY_REQUIRED');
  const validation = source.indexOf('validatePersistedAiPhysicalInput(', start);
  const physical = source.indexOf('this.runtime.execute(', start);
  assert.ok(validation >= start, 'M3-SC-DIAG-019:VALIDATION_CALL_REQUIRED');
  assert.ok(physical > validation, 'M3-SC-DIAG-019:VALIDATE_BEFORE_PHYSICAL_CALL');
  const physicalSource = source.slice(start, physical);
  for (const field of [
    'executionId', 'intentId', 'attemptId', 'claimId', 'ownerId',
    'generation', 'hostGeneration', 'fencingToken', 'idempotencyKey',
    'requestContentSha256'
  ]) {
    assert.match(physicalSource, new RegExp(`\\b${field}\\b`, 'u'), `M3-SC-DIAG-019:${field}`);
  }
});
