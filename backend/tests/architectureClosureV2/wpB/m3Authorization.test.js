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

test('M3-AUTH-007 successor branch authority is delegated by trusted main, never by historical branch mutation', () => {
  const authority = loadAuthority();
  const legacyAuthority = Object.freeze({ authorizedBranch: 'acv2/wp-b-durable-execution-outbox' });
  const successor = 'product/acv2-wp-b-m3-source-closure-successor';
  const successorAuthorizationPath = 'governance/layered-ci/acv2-wp-b-m3-source-closure-successor-authorization.json';

  assert.equal(authority.isAuthorizedWpBImplementationBranch(
    'acv2/wp-b-durable-execution-outbox', legacyAuthority
  ), true, 'M3-AUTH-007:HISTORICAL_AUTHORITY_PRESERVED');

  assert.equal(authority.isAuthorizedWpBImplementationBranch(successor, legacyAuthority, {
    evaluateTrustedDelegatedGovernanceBranch: () => Object.freeze({
      pass: true,
      authorityMode: 'TRUSTED_MAIN_DELEGATED_GOVERNANCE',
      authorizationPath: successorAuthorizationPath
    })
  }), true, 'M3-AUTH-007:TRUSTED_MAIN_SUCCESSOR_REQUIRED');

  assert.equal(authority.isAuthorizedWpBImplementationBranch(successor, legacyAuthority, {
    evaluateTrustedDelegatedGovernanceBranch: () => Object.freeze({
      pass: true,
      authorityMode: 'TRUSTED_MAIN_DELEGATED_GOVERNANCE',
      authorizationPath: 'governance/layered-ci/unrelated-authorization.json'
    })
  }), false, 'M3-AUTH-007:UNRELATED_DELEGATED_AUTHORITY_FORBIDDEN');

  assert.equal(authority.isAuthorizedWpBImplementationBranch(successor, legacyAuthority, {
    evaluateTrustedDelegatedGovernanceBranch: () => Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID'
    })
  }), false, 'M3-AUTH-007:FAIL_CLOSED');
});

test('M3-AUTH-008 WP-B successor workflows derive branch identity from active trusted authority seams', () => {
  const trustedMainDelegatedWorkflow = '.github/workflows/wp-b-m2-red.yml';
  const workflowPaths = [
    '.github/workflows/wp-b-m2-authorization.yml',
    trustedMainDelegatedWorkflow,
    '.github/workflows/wp-b-m2-independent-review-integrity.yml',
    '.github/workflows/wp-b-m3-authorization.yml'
  ];
  for (const repositoryPath of workflowPaths) {
    const source = fs.readFileSync(path.join(repoRoot, repositoryPath), 'utf8');
    assert.match(source, /IMPLEMENTATION_BRANCH:\s*\$\{\{ github\.head_ref \|\| github\.ref_name \}\}/u,
      `M3-AUTH-008:${repositoryPath}:EVENT_BRANCH_REQUIRED`);
    assert.doesNotMatch(source,
      /test\s+"\$\{IMPLEMENTATION_BRANCH\}"\s*=\s*"acv2\/wp-b-durable-execution-outbox"/u,
      `M3-AUTH-008:${repositoryPath}:HISTORICAL_BRANCH_GATE_FORBIDDEN`);

    if (repositoryPath === trustedMainDelegatedWorkflow) {
      assert.match(source,
        /VALIDATION_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/u,
        `M3-AUTH-008:${repositoryPath}:EXACT_HEAD_REQUIRED`);
      assert.match(source,
        /TRUSTED_POLICY_SHA="\$\{PULL_REQUEST_BASE_SHA\}"[\s\S]*TRUSTED_POLICY_SHA="\$\(git rev-parse refs\/remotes\/origin\/main\)"/u,
        `M3-AUTH-008:${repositoryPath}:TRUSTED_POLICY_SHA_REQUIRED`);
      assert.match(source, /shared\/release\/implementationBranchPolicy\.js/u,
        `M3-AUTH-008:${repositoryPath}:TRUSTED_IMPLEMENTATION_POLICY_REQUIRED`);
      assert.match(source, /const\s+trustedMainHead\s*=\s*process\.env\.TRUSTED_POLICY_SHA/u,
        `M3-AUTH-008:${repositoryPath}:TRUSTED_MAIN_HEAD_REQUIRED`);
      assert.match(source, /const\s+evaluatedHead\s*=\s*process\.env\.VALIDATION_SHA/u,
        `M3-AUTH-008:${repositoryPath}:EVALUATED_HEAD_REQUIRED`);
      assert.match(source, /const\s+branch\s*=\s*process\.env\.IMPLEMENTATION_BRANCH/u,
        `M3-AUTH-008:${repositoryPath}:EVALUATED_BRANCH_REQUIRED`);
      assert.match(source,
        /policy\.isAuthorizedImplementationBranch\s*\(\s*branch\s*,\s*releaseSource\.stageVersion\s*,\s*\{\s*delegatedGovernance:\s*\{\s*trustedMainHead\s*,\s*evaluatedHead\s*\}\s*\}\s*\)/u,
        `M3-AUTH-008:${repositoryPath}:TRUSTED_DELEGATED_GOVERNANCE_REQUIRED`);
      assert.doesNotMatch(source, /isAuthorizedWpBImplementationBranch/u,
        `M3-AUTH-008:${repositoryPath}:RETIRED_DIRECT_AUTHORITY_FORBIDDEN`);
      continue;
    }

    assert.match(source, /isAuthorizedWpBImplementationBranch/u,
      `M3-AUTH-008:${repositoryPath}:ACTIVE_AUTHORITY_REQUIRED`);
  }
});

test('M3-AUTH-009 historical M2/M3 verifiers accept a successor only through active WP-B branch authority', () => {
  for (const repositoryPath of [
    'tools/architecture-closure-v2/verify-wp-b-m2-review.js',
    'tools/architecture-closure-v2/verify-wp-b-m3-authorization.js'
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, repositoryPath), 'utf8');
    assert.match(source, /isAuthorizedWpBImplementationBranch/u,
      `M3-AUTH-009:${repositoryPath}:ACTIVE_AUTHORITY_REQUIRED`);
  }
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

test('M3-SC-DIAG-020 Telegram registry preserves and revalidates the persisted attempt at every physical egress boundary', () => {
  const registryPath = path.join(repoRoot, 'backend', 'services', 'platformDriverRegistry.js');
  const source = fs.readFileSync(registryPath, 'utf8');
  assert.match(source, /validatePersistedEgressContext/u, 'M3-SC-DIAG-020:PERSISTED_EGRESS_VALIDATOR_REQUIRED');
  assert.match(source, /function\s+requirePersistedEgressAttempt\s*\(/u, 'M3-SC-DIAG-020:REGISTRY_FAIL_CLOSED_HELPER_REQUIRED');
  const telegramStart = source.indexOf('telegram: Object.freeze({');
  const facebookStart = source.indexOf('facebook: Object.freeze({', telegramStart);
  assert.ok(telegramStart >= 0 && facebookStart > telegramStart, 'M3-SC-DIAG-020:TELEGRAM_DRIVER_BOUNDARY_REQUIRED');
  const telegramSource = source.slice(telegramStart, facebookStart);
  for (const operation of ['sendText', 'sendMedia', 'sendReaction', 'revokeMessage', 'sendNativeExpression', 'sendPresence', 'markRead']) {
    const start = telegramSource.indexOf(`async ${operation}(`);
    assert.ok(start >= 0, `M3-SC-DIAG-020:${operation}:METHOD_REQUIRED`);
    const next = telegramSource.indexOf('\n    async ', start + 1);
    const methodSource = telegramSource.slice(start, next > start ? next : telegramSource.length);
    assert.match(methodSource, /requirePersistedEgressAttempt\s*\(/u, `M3-SC-DIAG-020:${operation}:ATTEMPT_REVALIDATION_REQUIRED`);
    assert.match(methodSource, /physicalAttemptContext/u, `M3-SC-DIAG-020:${operation}:ATTEMPT_FORWARDING_REQUIRED`);
  }
});

test('M3-SC-DIAG-021 Telegram egress abort quarantines the stale generation without owning reconnect authority', () => {
  const adapterPath = path.join(repoRoot, 'backend', 'services', 'telegramAdapter.js');
  const source = fs.readFileSync(adapterPath, 'utf8');
  const start = source.indexOf('bindEgressAbort(accountId, row, options = {})');
  const end = source.indexOf('\n  assertEgressActive(', start);
  assert.ok(start >= 0 && end > start, 'M3-SC-DIAG-021:ABORT_BOUNDARY_REQUIRED');
  const abortSource = source.slice(start, end);
  assert.doesNotMatch(abortSource, /this\.connect\s*\(/u, 'M3-SC-DIAG-021:INDEPENDENT_RECONNECT_FORBIDDEN');
  assert.match(abortSource, /telegram:egress-recovery-required/u, 'M3-SC-DIAG-021:DURABLE_RECOVERY_SIGNAL_REQUIRED');
  assert.match(abortSource, /automaticRetryBlocked:\s*true/u, 'M3-SC-DIAG-021:AUTOMATIC_RETRY_MUST_REMAIN_BLOCKED');
});

test('M3-SC-DIAG-022 domain projection retry ownership is canonical Schema 23 durability, not projection-table SQL', () => {
  const repositoryPath = path.join(repoRoot, 'backend', 'repositories', 'messageRepository.js');
  const authorityPath = path.join(repoRoot, 'backend', 'services', 'domainEventProjectionAuthority.js');
  const repositorySource = fs.readFileSync(repositoryPath, 'utf8');
  const authoritySource = fs.readFileSync(authorityPath, 'utf8');
  assert.match(repositorySource, /DurableInternalOperationAuthority|currentRuntimeInternalOperationAuthority/u, 'M3-SC-DIAG-022:CANONICAL_INTERNAL_OPERATION_REQUIRED');
  assert.doesNotMatch(repositorySource, /UPDATE\s+domain_event_projection_jobs/iu, 'M3-SC-DIAG-022:REPOSITORY_RETRY_SQL_FORBIDDEN');
  assert.doesNotMatch(authoritySource, /UPDATE\s+domain_event_projection_jobs/iu, 'M3-SC-DIAG-022:AUTHORITY_RETRY_SQL_FORBIDDEN');
  assert.doesNotMatch(authoritySource, /setInterval\s*\(\s*\(\)\s*=>\s*this\.drainProjectionJobs/u, 'M3-SC-DIAG-022:SECOND_SCHEDULER_FORBIDDEN');
  assert.match(authoritySource, /currentRuntimeRecoveryAuthority|DurableExecutionRecoveryAuthority/u, 'M3-SC-DIAG-022:CANONICAL_RECOVERY_AUTHORITY_REQUIRED');
});

test('M3-SC-DIAG-023 proven Telegram and projection boundaries are terminalized only after authority closure', () => {
  const inventoryPath = path.join(
    repoRoot,
    'governance',
    'architecture-closure-v2',
    'wp-b-operation-inventory.json'
  );
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const entries = new Map((inventory.entries || []).map(entry => [entry.id, entry]));
  const messageProjection = entries.get('WPB-MESSAGE-PROJECTION-REPOSITORY');
  const platformRegistry = entries.get('WPB-PLATFORM-DRIVER-REGISTRY');
  const telegramAdapter = entries.get('WPB-TELEGRAM-ADAPTER');

  assert.equal(messageProjection?.closureState, 'DELEGATES_TO_WP_B_AUTHORITY', 'M3-SC-DIAG-023:MESSAGE_PROJECTION_TERMINAL');
  assert.doesNotMatch(
    (messageProjection?.currentResponsibilities || []).join('|'),
    /EXPIRED_CLAIM_RECOVERY|RETRY_BACKOFF|STALE_COMPLETION_REJECTION/u,
    'M3-SC-DIAG-023:MESSAGE_PROJECTION_SECOND_RECOVERY_AUTHORITY_FORBIDDEN'
  );
  assert.equal(platformRegistry?.closureState, 'DELEGATES_TO_WP_B_AUTHORITY', 'M3-SC-DIAG-023:PLATFORM_REGISTRY_TERMINAL');
  assert.ok(
    (platformRegistry?.currentResponsibilities || []).includes('PERSISTED_ATTEMPT_EGRESS_VALIDATION'),
    'M3-SC-DIAG-023:PLATFORM_REGISTRY_ATTEMPT_VALIDATION_REQUIRED'
  );
  assert.equal(telegramAdapter?.closureState, 'DELEGATES_TO_WP_B_AUTHORITY', 'M3-SC-DIAG-023:TELEGRAM_ADAPTER_TERMINAL');
  assert.doesNotMatch(
    (telegramAdapter?.currentResponsibilities || []).join('|'),
    /^(?:RECONNECT|RECOVERY)$|\|(?:RECONNECT|RECOVERY)(?:\||$)/u,
    'M3-SC-DIAG-023:TELEGRAM_RECONNECT_RECOVERY_AUTHORITY_FORBIDDEN'
  );
  assert.ok((telegramAdapter?.currentResponsibilities || []).includes('DURABLE_RECOVERY_SIGNAL'), 'M3-SC-DIAG-023:TELEGRAM_DURABLE_RECOVERY_SIGNAL_REQUIRED');
});

test('M3-SC-DIAG-024 session restore and isolated model execution boundaries are terminal only after durable authority closure', () => {
  const inventoryPath = path.join(
    repoRoot,
    'governance',
    'architecture-closure-v2',
    'wp-b-operation-inventory.json'
  );
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const entries = new Map((inventory.entries || []).map(entry => [entry.id, entry]));
  const accountManager = entries.get('WPB-ACCOUNT-MANAGER');
  const modelHost = entries.get('WPB-MODEL-EXECUTION-HOST');
  const modelWorker = entries.get('WPB-MODEL-EXECUTION-WORKER');

  const accountPath = path.join(repoRoot, 'backend', 'services', 'accountManager.js');
  const accountSource = fs.readFileSync(accountPath, 'utf8');
  const accountStart = accountSource.indexOf('function requestSessionRestore(input = {})');
  const accountEnd = accountSource.indexOf('\nfunction requestPersistedSessionRestores', accountStart);
  assert.ok(accountStart >= 0 && accountEnd > accountStart, 'M3-SC-DIAG-024:SESSION_RESTORE_BOUNDARY_REQUIRED');
  const accountBoundary = accountSource.slice(accountStart, accountEnd);
  assert.match(accountBoundary, /prepareSessionRestore\s*\(/u, 'M3-SC-DIAG-024:DURABLE_SESSION_PREPARATION_REQUIRED');
  assert.doesNotMatch(accountBoundary, /setTimeout|setInterval|\.connect\s*\(|\.send\s*\(|fetch\s*\(/u,
    'M3-SC-DIAG-024:ACCOUNT_MANAGER_PHYSICAL_RETRY_FORBIDDEN');
  assert.equal(accountManager?.closureState, 'DELEGATES_TO_WP_B_AUTHORITY',
    'M3-SC-DIAG-024:ACCOUNT_MANAGER_TERMINAL');

  const hostPath = path.join(repoRoot, 'backend', 'services', 'modelExecutionHost.js');
  const hostSource = fs.readFileSync(hostPath, 'utf8');
  const hostStart = hostSource.indexOf('function startModelExecution({');
  const persistedValidation = hostSource.indexOf('validatePersistedAttempt(', hostStart);
  const physicalFork = hostSource.indexOf('childProcessFactory(', hostStart);
  assert.ok(hostStart >= 0 && persistedValidation > hostStart && physicalFork > persistedValidation,
    'M3-SC-DIAG-024:PERSISTED_ATTEMPT_MUST_PRECEDE_FORK');
  assert.match(hostSource, /ExternalActionDispatcher/u,
    'M3-SC-DIAG-024:DURABLE_DISPATCHER_REQUIRED');
  assert.match(hostSource, /UNCERTAIN_REMOTE_OUTCOME|markUncertain/u,
    'M3-SC-DIAG-024:UNCERTAIN_RECONCILIATION_REQUIRED');
  assert.equal(modelHost?.closureState, 'DELEGATES_TO_WP_B_AUTHORITY',
    'M3-SC-DIAG-024:MODEL_HOST_TERMINAL');

  const workerPath = path.join(repoRoot, 'backend', 'services', 'modelExecutionWorker.js');
  const workerSource = fs.readFileSync(workerPath, 'utf8');
  const envelopeValidation = workerSource.indexOf('verifyModelExecutionEnvelope(');
  const providerExecution = workerSource.indexOf('executeIsolatedModel(');
  assert.ok(envelopeValidation >= 0 && providerExecution > envelopeValidation,
    'M3-SC-DIAG-024:WORKER_ENVELOPE_VALIDATION_REQUIRED');
  assert.doesNotMatch(workerSource, /r32Store|storeProvider|sqlite|securityGuard/iu,
    'M3-SC-DIAG-024:WORKER_DATABASE_AUTHORITY_FORBIDDEN');
  assert.equal(modelWorker?.closureState, 'DELEGATES_TO_WP_B_AUTHORITY',
    'M3-SC-DIAG-024:MODEL_WORKER_TERMINAL');
});
test('M3-SC-DIAG-025 composed runtime, startup recovery and Electron supervision terminalize only after authority proof', () => {
  const inventoryPath = path.join(
    repoRoot,
    'governance',
    'architecture-closure-v2',
    'wp-b-operation-inventory.json'
  );
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const entries = new Map((inventory.entries || []).map(entry => [entry.id, entry]));

  const channelRuntime = entries.get('WPB-CHANNEL-ADAPTER-RUNTIME');
  const backendServer = entries.get('WPB-BACKEND-SERVER');
  const electronMain = entries.get('WPB-ELECTRON-MAIN');

  const runtimePath = path.join(repoRoot, 'backend', 'services', 'channelAdapterRuntime.js');
  const enginePath = path.join(repoRoot, 'backend', 'services', 'channelRuntimeEngine.js');
  const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
  const engineSource = fs.readFileSync(enginePath, 'utf8');

  assert.match(
    runtimeSource,
    /migrationMode:\s*'durable-outbox-only'/u,
    'M3-SC-DIAG-025:CHANNEL_RUNTIME_DURABLE_OUTBOX_ONLY'
  );
  assert.match(
    engineSource,
    /function\s+validatePhysicalEnvelope\s*\(/u,
    'M3-SC-DIAG-025:CHANNEL_PHYSICAL_ENVELOPE_VALIDATOR_REQUIRED'
  );
  const physicalPerform = engineSource.indexOf('async perform(input = {})');
  const physicalValidate = engineSource.indexOf('const attempt = validatePhysicalEnvelope(input);', physicalPerform);
  const physicalEgress = engineSource.indexOf('return facade.egress.execute(', physicalPerform);
  assert.ok(
    physicalPerform >= 0 && physicalValidate > physicalPerform && physicalEgress > physicalValidate,
    'M3-SC-DIAG-025:VALIDATE_PERSISTED_ATTEMPT_BEFORE_CHANNEL_IO'
  );
  const physicalSource = engineSource.slice(physicalPerform, physicalEgress + 400);
  assert.match(
    physicalSource,
    /persistedAttemptContext\s*\(\s*attempt\s*,\s*normalizedPlatform\s*\)/u,
    'M3-SC-DIAG-025:CHANNEL_PERSISTED_ATTEMPT_FORWARDING_REQUIRED'
  );
  assert.equal(
    channelRuntime?.closureState,
    'DELEGATES_TO_WP_B_AUTHORITY',
    'M3-SC-DIAG-025:CHANNEL_RUNTIME_TERMINAL'
  );

  const serverPath = path.join(repoRoot, 'backend', 'server.js');
  const factoryPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeFactory.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const factorySource = fs.readFileSync(factoryPath, 'utf8');
  const composition = serverSource.indexOf('APP_RUNTIME.configureProductionServices()');
  const readiness = serverSource.indexOf('AppRuntimeFactory.assertAuthorityReady()', composition);
  const recovery = serverSource.indexOf("'startup.recoverDurableExecutions'", readiness);
  assert.ok(
    composition >= 0 && readiness > composition && recovery > readiness,
    'M3-SC-DIAG-025:WRITE_HOST_READINESS_MUST_PRECEDE_STARTUP_RECOVERY'
  );
  assert.match(
    factorySource,
    /assertCurrentAuthorityWriteHostToken\s*\(/u,
    'M3-SC-DIAG-025:CURRENT_WRITE_HOST_TOKEN_REQUIRED'
  );
  assert.match(
    factorySource,
    /durableExecutionRecoveryReady/u,
    'M3-SC-DIAG-025:DURABLE_RECOVERY_AUTHORITY_READINESS_REQUIRED'
  );
  assert.equal(
    backendServer?.closureState,
    'DELEGATES_TO_WP_B_AUTHORITY',
    'M3-SC-DIAG-025:BACKEND_SERVER_TERMINAL'
  );

  const electronPath = path.join(repoRoot, 'electron', 'main.js');
  const electronSource = fs.readFileSync(electronPath, 'utf8');
  assert.doesNotMatch(
    electronSource,
    /require\s*\(\s*['"]\.\.\/backend\/services\/(?!learningPolicyRuntimeAdapter(?:\.js)?['"])/u,
    'M3-SC-DIAG-025:ELECTRON_BACKEND_BUSINESS_SERVICE_IMPORT_FORBIDDEN'
  );
  for (const processBoundary of [
    'createBackendStartupSupervisor',
    'DesktopHost',
    'backendShutdownCoordinator'
  ]) {
    assert.match(
      electronSource,
      new RegExp(`\\b${processBoundary}\\b`, 'u'),
      `M3-SC-DIAG-025:ELECTRON_PROCESS_BOUNDARY:${processBoundary}`
    );
  }
  assert.equal(
    electronMain?.closureState,
    'DELEGATES_TO_WP_B_AUTHORITY',
    'M3-SC-DIAG-025:ELECTRON_MAIN_TERMINAL'
  );
  assert.doesNotMatch(
    (electronMain?.currentResponsibilities || []).join('|'),
    /BUSINESS_RETRY|SESSION_RESTORE|HISTORY_SYNCHRONIZATION/u,
    'M3-SC-DIAG-025:ELECTRON_BUSINESS_RECOVERY_AUTHORITY_FORBIDDEN'
  );
});