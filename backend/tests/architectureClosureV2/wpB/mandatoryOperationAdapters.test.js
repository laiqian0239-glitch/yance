'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicesRoot = path.join(__dirname, '..', '..', '..', 'services');
const whatsappAdapterPath = path.join(servicesRoot, 'whatsappAdapter.js');
const platformDriverRegistryPath = path.join(servicesRoot, 'platformDriverRegistry.js');
const accountContextPath = path.join(__dirname, '..', '..', '..', 'core', 'accountContext.js');
const registryPath = path.join(servicesRoot, 'durableOperationRegistry.js');
const outboundOperationPath = path.join(
  servicesRoot,
  'durableOperations',
  'outboundMessageSendOperation.js'
);
const EXPECTED_KINDS = Object.freeze({
  AI_PROVIDER_EXECUTION: 'AI_PROVIDER_EXECUTION',
  OUTBOUND_MESSAGE_SEND: 'OUTBOUND_MESSAGE_SEND',
  DELIVERY_RECEIPT_RECONCILIATION: 'DELIVERY_RECEIPT_RECONCILIATION',
  MEDIA_TRANSFER: 'MEDIA_TRANSFER',
  HISTORY_SYNCHRONIZATION: 'HISTORY_SYNCHRONIZATION',
  SESSION_RESTORE: 'SESSION_RESTORE'
});

function registryModule() {
  assert.equal(fs.existsSync(registryPath), true, 'WP_B_M2_OPERATION_REGISTRY_REQUIRED');
  delete require.cache[require.resolve(registryPath)];
  return require(registryPath);
}

function outboundOperationModule() {
  assert.equal(
    fs.existsSync(outboundOperationPath),
    true,
    'WP_B_M2_OUTBOUND_MESSAGE_OPERATION_REQUIRED'
  );
  delete require.cache[require.resolve(outboundOperationPath)];
  return require(outboundOperationPath);
}

function frozenAdapter(operationKind) {
  return Object.freeze({
    operationKind,
    async perform() { return Object.freeze({ status: 'performed' }); },
    async reconcile() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
  });
}

function outboundAttemptEnvelope(overrides = {}) {
  const request = Object.freeze({
    platform: 'whatsapp',
    accountReference: 'account-ref-1',
    commandReference: 'command-ref-1',
    credentialReference: 'credential-ref-1',
    requestContentSha256: 'b'.repeat(64),
    ...overrides.request
  });
  return Object.freeze({
    executionId: 'execution-message-1',
    intentId: 'intent-message-1',
    attemptId: 'attempt-message-1',
    claimId: 'claim-message-1',
    ownerId: 'owner-message-1',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    idempotencyKey: 'idempotency-message-1',
    request,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'request')
    )
  });
}

test('M2-REG-001 registry exports the exact deeply frozen six-kind vocabulary', () => {
  const { OPERATION_KINDS } = registryModule();
  assert.deepEqual(OPERATION_KINDS, EXPECTED_KINDS);
  assert.equal(Object.isFrozen(OPERATION_KINDS), true);
  assert.equal(Object.keys(OPERATION_KINDS).length, 6);
});

test('M2-REG-002 registry is fail-closed for invalid, duplicate, unknown and post-seal mutations', () => {
  const { OPERATION_KINDS, createDurableOperationRegistry } = registryModule();
  const registry = createDurableOperationRegistry();
  assert.equal(Object.getPrototypeOf(registry), null);
  for (const method of ['register', 'require', 'list', 'seal']) {
    assert.equal(typeof registry[method], 'function', method);
  }

  assert.throws(
    () => registry.register(OPERATION_KINDS.AI_PROVIDER_EXECUTION, {
      operationKind: OPERATION_KINDS.AI_PROVIDER_EXECUTION,
      perform() {},
      reconcile() {}
    }),
    error => error?.code === 'WP_B_OPERATION_ADAPTER_INVALID'
  );

  const adapter = frozenAdapter(OPERATION_KINDS.AI_PROVIDER_EXECUTION);
  assert.equal(registry.register(OPERATION_KINDS.AI_PROVIDER_EXECUTION, adapter), adapter);
  assert.equal(registry.require(OPERATION_KINDS.AI_PROVIDER_EXECUTION), adapter);
  assert.deepEqual(registry.list(), [OPERATION_KINDS.AI_PROVIDER_EXECUTION]);

  assert.throws(
    () => registry.register(OPERATION_KINDS.AI_PROVIDER_EXECUTION, adapter),
    error => error?.code === 'WP_B_OPERATION_ADAPTER_DUPLICATE'
  );
  assert.throws(
    () => registry.require(OPERATION_KINDS.OUTBOUND_MESSAGE_SEND),
    error => error?.code === 'WP_B_OPERATION_ADAPTER_NOT_REGISTERED'
  );
  assert.throws(
    () => registry.register('UNAUTHORIZED_OPERATION', frozenAdapter('UNAUTHORIZED_OPERATION')),
    error => error?.code === 'WP_B_OPERATION_KIND_INVALID'
  );

  const sealed = registry.seal();
  assert.equal(sealed, registry);
  assert.equal(Object.isFrozen(registry.list()), true);
  assert.throws(
    () => registry.register(OPERATION_KINDS.OUTBOUND_MESSAGE_SEND, frozenAdapter(OPERATION_KINDS.OUTBOUND_MESSAGE_SEND)),
    error => error?.code === 'WP_B_OPERATION_REGISTRY_SEALED'
  );
});

test('M2-REG-003 reference-only attempt envelopes are recursively frozen and reject persisted secrets or business bodies', () => {
  const { assertReferenceOnlyEnvelope } = registryModule();
  const valid = Object.freeze({
    executionId: 'execution-1',
    intentId: 'intent-1',
    attemptId: 'attempt-1',
    idempotencyKey: 'idempotency-1',
    request: Object.freeze({
      modelReference: 'model-ref-1',
      promptReference: 'prompt-ref-1',
      credentialReference: 'credential-ref-1',
      requestContentSha256: 'a'.repeat(64)
    })
  });
  assert.equal(assertReferenceOnlyEnvelope(valid), valid);

  const notFrozen = { ...valid };
  assert.throws(
    () => assertReferenceOnlyEnvelope(notFrozen),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );

  for (const [field, value] of [
    ['apiKey', 'secret'],
    ['oauthToken', 'secret'],
    ['accessToken', 'secret'],
    ['refreshToken', 'secret'],
    ['cookie', 'secret'],
    ['sessionMaterial', 'secret'],
    ['messageBody', 'private message'],
    ['promptBody', 'private prompt'],
    ['binaryPayload', 'private bytes']
  ]) {
    const invalid = Object.freeze({ ...valid, request: Object.freeze({ ...valid.request, [field]: value }) });
    assert.throws(
      () => assertReferenceOnlyEnvelope(invalid),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD' && error?.field === field,
      field
    );
  }
});

test('M2-MSG-001 outbound message Adapter is frozen and exposes the exact durable operation kind', () => {
  const {
    OPERATION_KIND,
    createOutboundMessageSendOperation
  } = outboundOperationModule();
  assert.equal(OPERATION_KIND, 'OUTBOUND_MESSAGE_SEND');
  const adapter = createOutboundMessageSendOperation({
    resolveCommandReference() {
      return Object.freeze({ messageBody: 'ephemeral message' });
    },
    resolveCredentialReference() {
      return Object.freeze({ session: 'ephemeral session' });
    },
    channelClient: Object.freeze({
      async perform() {
        return Object.freeze({ accepted: true, platformMessageId: 'platform-message-1' });
      },
      async lookup() {
        return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' });
      }
    })
  });
  assert.equal(adapter.operationKind, OPERATION_KIND);
  assert.equal(typeof adapter.perform, 'function');
  assert.equal(typeof adapter.reconcile, 'function');
  assert.equal(Object.isFrozen(adapter), true);
});

test('M2-MSG-002 perform resolves ephemeral command and credential capabilities only at the physical boundary', async () => {
  const { createOutboundMessageSendOperation } = outboundOperationModule();
  const calls = [];
  const command = Object.freeze({ messageBody: 'private message body' });
  const credential = Object.freeze({ session: 'private session material' });
  const adapter = createOutboundMessageSendOperation({
    resolveCommandReference(reference, context) {
      calls.push(['resolveCommandReference', reference, context.attemptId]);
      return command;
    },
    resolveCredentialReference(reference, context) {
      calls.push(['resolveCredentialReference', reference, context.attemptId]);
      return credential;
    },
    channelClient: Object.freeze({
      async perform(input) {
        calls.push([
          'physicalCall',
          input.attemptId,
          input.command === command,
          input.credential === credential
        ]);
        return Object.freeze({
          accepted: true,
          platformMessageId: 'platform-message-2',
          providerRequestId: 'provider-request-message-2',
          evidenceReference: 'evidence-message-2',
          messageBody: 'must-not-escape',
          sessionMaterial: 'must-not-escape'
        });
      },
      async lookup() {
        return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' });
      }
    })
  });

  const result = await adapter.perform(outboundAttemptEnvelope());
  assert.deepEqual(calls, [
    ['resolveCommandReference', 'command-ref-1', 'attempt-message-1'],
    ['resolveCredentialReference', 'credential-ref-1', 'attempt-message-1'],
    ['physicalCall', 'attempt-message-1', true, true]
  ]);
  assert.deepEqual(result, {
    accepted: true,
    platformMessageId: 'platform-message-2',
    providerRequestId: 'provider-request-message-2',
    evidenceReference: 'evidence-message-2'
  });
  assert.equal(JSON.stringify(result).includes('private message body'), false);
  assert.equal(JSON.stringify(result).includes('private session material'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('M2-MSG-003 perform rejects mutable envelopes, missing attempt identity, and inline persisted business or secret fields', async () => {
  const { createOutboundMessageSendOperation } = outboundOperationModule();
  const adapter = createOutboundMessageSendOperation({
    resolveCommandReference() {
      throw new Error('invalid envelope must not resolve command');
    },
    resolveCredentialReference() {
      throw new Error('invalid envelope must not resolve credential');
    },
    channelClient: Object.freeze({
      async perform() {
        throw new Error('invalid envelope must not perform');
      },
      async lookup() {
        return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' });
      }
    })
  });

  await assert.rejects(
    () => adapter.perform({ ...outboundAttemptEnvelope() }),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );
  await assert.rejects(
    () => adapter.perform(Object.freeze({ ...outboundAttemptEnvelope(), attemptId: '' })),
    error => error?.code === 'WP_B_OUTBOUND_MESSAGE_ATTEMPT_ID_REQUIRED'
  );
  for (const field of [
    'apiKey',
    'oauthToken',
    'cookie',
    'sessionMaterial',
    'messageBody',
    'binaryPayload'
  ]) {
    await assert.rejects(
      () => adapter.perform(outboundAttemptEnvelope({ request: { [field]: 'forbidden-value' } })),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD' && error?.field === field,
      field
    );
  }
});

test('M2-MSG-004 reconciliation performs lookup only and returns bounded remote evidence', async () => {
  const { createOutboundMessageSendOperation } = outboundOperationModule();
  const calls = [];
  const credential = Object.freeze({ session: 'ephemeral lookup session' });
  const adapter = createOutboundMessageSendOperation({
    resolveCommandReference() {
      calls.push(['resolveCommandReference']);
      throw new Error('reconciliation must not resolve message body');
    },
    resolveCredentialReference(reference) {
      calls.push(['resolveCredentialReference', reference]);
      return credential;
    },
    channelClient: Object.freeze({
      async perform() {
        calls.push(['perform']);
        throw new Error('reconciliation must not send');
      },
      async lookup(input) {
        calls.push([
          'lookup',
          input.idempotencyKey,
          input.providerRequestId,
          input.platformMessageId,
          input.credential === credential
        ]);
        return Object.freeze({
          outcome: 'REMOTE_SUCCESS_PROVEN',
          platformMessageId: input.platformMessageId,
          providerRequestId: input.providerRequestId,
          evidenceReference: 'evidence-message-reconciled',
          messageBody: 'must-not-escape'
        });
      }
    })
  });

  const result = await adapter.reconcile(outboundAttemptEnvelope({
    providerRequestId: 'provider-request-message-4',
    platformMessageId: 'platform-message-4'
  }));
  assert.deepEqual(calls, [
    ['resolveCredentialReference', 'credential-ref-1'],
    [
      'lookup',
      'idempotency-message-1',
      'provider-request-message-4',
      'platform-message-4',
      true
    ]
  ]);
  assert.deepEqual(result, {
    outcome: 'REMOTE_SUCCESS_PROVEN',
    platformMessageId: 'platform-message-4',
    providerRequestId: 'provider-request-message-4',
    evidenceReference: 'evidence-message-reconciled'
  });
  assert.equal(Object.isFrozen(result), true);
});


test('M2-WA-003 AccountContext preserves persisted platform operation context through auth and reconcile bindings', () => {
  const source = fs.readFileSync(accountContextPath, 'utf8');
  assert.match(source, /function\s+physicalOperationOptions\(request\s*=\s*\{\}\)[\s\S]*?signal:\s*request\.signal[\s\S]*?operationGeneration:[\s\S]*?request\.operationGeneration[\s\S]*?physicalOperationContext:\s*request\.physicalOperationContext/u, 'M2-WA-003:PHYSICAL_OPTIONS_REQUIRED');
  for (const pattern of [
    /this\.lifecycle\.start\(accountId,\s*\{\s*action:\s*'connect',\s*\.\.\.physicalOperationOptions\(request\)\s*\}\)/u,
    /this\.lifecycle\.restart\(accountId,\s*\{\s*action:\s*'reconnect',\s*\.\.\.physicalOperationOptions\(request\)\s*\}\)/u,
    /this\.accountManager\.beginFacebookOAuth\(accountId,\s*physicalOperationOptions\(request\)\)/u,
    /this\.accountManager\.pollFacebookOAuth\(accountId,\s*request\.flowId,\s*physicalOperationOptions\(request\)\)/u,
    /this\.accountManager\.selectFacebookPage\(accountId,\s*request\.flowId,\s*request\.pageId,\s*physicalOperationOptions\(request\)\)/u,
    /this\.accountManager\.cancelFacebookOAuth\(accountId,\s*request\.flowId,\s*physicalOperationOptions\(request\)\)/u,
    /this\.accountManager\.sync\(accountId,\s*\{[\s\S]*?\.\.\.physicalOperationOptions\(request\)[\s\S]*?executionGeneration:\s*request\.operationGeneration[\s\S]*?\}\)/u
  ]) assert.match(source, pattern, `M2-WA-003:CONTEXT_PROPAGATION_REQUIRED:${pattern}`);
});

test('M2-WA-004 platform driver preserves persisted WhatsApp operation context into the physical adapter', () => {
  const source = fs.readFileSync(platformDriverRegistryPath, 'utf8');
  assert.match(
    source,
    /async\s+connect\(account,\s*options\s*=\s*\{\}\)\s*\{[\s\S]*?whatsapp\.start\(account,\s*\{[\s\S]*?physicalOperationContext:\s*options\.physicalOperationContext[\s\S]*?\}\)/u,
    'M2-WA-004:CONNECT_CONTEXT_REQUIRED'
  );
  assert.match(
    source,
    /async\s+sync\(account,\s*options\s*=\s*\{\}\)\s*\{\s*return\s+withPersistedOperationContext\(options,\s*\(\)\s*=>\s*whatsapp\.sync\(account,\s*options\)\);\s*\}/u,
    'M2-WA-004:SYNC_CONTEXT_REQUIRED'
  );
});

test('M2-WA-001 WhatsApp physical adapter is fail-closed behind persisted WP-B operation contexts', () => {
  const source = fs.readFileSync(whatsappAdapterPath, 'utf8');
  assert.match(source, /validatePersistedEgressContext/u, 'M2-WA-001:PERSISTED_CONTEXT_VALIDATOR_REQUIRED');
  assert.match(source, /requirePersistedWhatsAppOperation/u, 'M2-WA-001:ADAPTER_BOUNDARY_REQUIRED');
  assert.match(source, /async\s+start\([^)]*options[^)]*\)[\s\S]*?requirePersistedWhatsAppOperation\(options\.physicalOperationContext/u, 'M2-WA-001:start:CONTEXT_REQUIRED');
  assert.match(source, /async\s+sync\([^)]*options[^)]*\)[\s\S]*?requirePersistedWhatsAppOperation\(options\.physicalOperationContext/u, 'M2-WA-001:sync:CONTEXT_REQUIRED');
  for (const method of ['sendText', 'sendMedia', 'sendReaction', 'revokeMessage', 'sendPresence', 'markRead']) {
    assert.match(source, new RegExp(`async\\s+${method}\\(\\{[^}]*physicalAttemptContext`, 'u'), `M2-WA-001:${method}:CONTEXT_REQUIRED`);
  }
});

test('M2-WA-002 WhatsApp connection close returns an observation and owns no reconnect retry timer', () => {
  const source = fs.readFileSync(whatsappAdapterPath, 'utf8');
  assert.doesNotMatch(source, /reconnectTimers/u, 'M2-WA-002:RECONNECT_TIMER_MAP_FORBIDDEN');
  assert.doesNotMatch(source, /reconnect-blocked-by-lifecycle|reconnect-cancelled-by-lifecycle|reconnect-failed/u, 'M2-WA-002:LOCAL_RECONNECT_AUTHORITY_FORBIDDEN');
  assert.doesNotMatch(source, /this\.start\(latest\)/u, 'M2-WA-002:LOCAL_RESTART_FORBIDDEN');
  assert.match(source, /whatsapp:state/u, 'M2-WA-002:CLOSE_OBSERVATION_REQUIRED');
});

test('M2-SYNC-001 legacy sync repository is read-only and durable checkpoint mutation delegates to the canonical CAS authority', () => {
  const repositoryPath = path.join(__dirname, '..', '..', '..', 'repositories', 'syncCheckpointRepository.js');
  const servicePath = path.join(servicesRoot, 'syncCheckpointService.js');
  const repositorySource = fs.readFileSync(repositoryPath, 'utf8');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');
  const driverSource = fs.readFileSync(platformDriverRegistryPath, 'utf8');
  assert.doesNotMatch(repositorySource, /UPDATE\s+sync_checkpoints/iu, 'M2-SYNC-001:LEGACY_CHECKPOINT_MUTATION_FORBIDDEN');
  assert.match(repositorySource, /WP_B_SYNC_CHECKPOINT_DIRECT_MUTATION_FORBIDDEN/u, 'M2-SYNC-001:DIRECT_MUTATION_FAIL_CLOSED_REQUIRED');
  assert.match(repositorySource, /mutationPerformed:\s*false/u, 'M2-SYNC-001:RECOVERY_MUST_BE_OBSERVATION_ONLY');
  assert.match(serviceSource, /AsyncLocalStorage/u, 'M2-SYNC-001:EXECUTION_SCOPE_REQUIRED');
  assert.match(serviceSource, /applyHistoryCheckpointObservation/u, 'M2-SYNC-001:CANONICAL_CHECKPOINT_AUTHORITY_REQUIRED');
  assert.match(serviceSource, /batchExpectedVersion/u, 'M2-SYNC-001:BEGIN_VERSION_MUST_FLOW_TO_COMMIT');
  assert.match(driverSource, /withPersistedOperationContext\(options,[\s\S]*?telegram\.sync/u, 'M2-SYNC-001:TELEGRAM_SYNC_SCOPE_REQUIRED');
  assert.match(driverSource, /withPersistedOperationContext\(options,[\s\S]*?whatsapp\.sync/u, 'M2-SYNC-001:WHATSAPP_SYNC_SCOPE_REQUIRED');
});

test('M2-SYNC-002 sync checkpoint compatibility service rejects stale begin versions through canonical CAS', () => {
  const servicePath = path.join(servicesRoot, 'syncCheckpointService.js');
  delete require.cache[require.resolve(servicePath)];
  const { SyncCheckpointService } = require(servicePath);
  const current = { row: null };
  const observations = [];
  const authority = {
    getSyncCheckpoint() { return current.row; },
    applyHistoryCheckpointObservation(input) {
      observations.push(input);
      const expected = Number(input.checkpoint.expectedVersion);
      const actual = Number(current.row?.version || 0);
      if (expected !== actual) throw Object.assign(new Error('stale'), { code: 'WP_B_HISTORY_CHECKPOINT_CAS_REJECTED' });
      if (input.observation.outcome === 'REMOTE_RESULT_UNKNOWN') return { state: 'REMOTE_RESULT_UNKNOWN', checkpointAdvanced: false };
      current.row = {
        checkpointId: input.checkpoint.checkpointId,
        version: actual + 1,
        cursor: input.observation.cursorReference,
        highWatermark: input.observation.highWatermarkReference,
        gapClosed: input.observation.gapClosed,
        updatedAt: '2026-08-18T08:00:00.000Z'
      };
      return { state: 'PAGE_OBSERVED', checkpointAdvanced: true };
    }
  };
  const operation = Object.freeze({
    executionId: 'history-execution-1', operationId: 'history-execution-1', operationKind: 'HISTORY_SYNCHRONIZATION',
    state: 'RUNNING', stateVersion: 4, generation: 2, ownerId: 'host-1', claimId: 'claim-1', hostGeneration: 3, fencingToken: 7
  });
  const context = Object.freeze({ ...operation, platform: 'telegram', accountId: 'account-1' });
  const service = new SyncCheckpointService({
    checkpointRepository: {
      read() { return null; }, claimRemoteMessage() {}, releaseRemoteMessage() {}, receiptRemoteKey() {}, recoverInterrupted() { return []; }
    },
    authority,
    lifecycleProvider: () => ({ read() { return operation; } })
  });
  service.withPhysicalOperationContext(context, () => {
    const first = service.begin({ platform: 'telegram', accountId: 'account-1', scopeId: 'chat-1' });
    const stale = service.begin({ platform: 'telegram', accountId: 'account-1', scopeId: 'chat-1' });
    const committed = service.commit({ platform: 'telegram', accountId: 'account-1', scopeId: 'chat-1', batchId: first.batchId, cursor: '42', remoteTimestamp: '2026-08-18T08:00:00.000Z' });
    assert.equal(committed.version, 1, 'M2-SYNC-002:VERSION_ADVANCED');
    assert.throws(
      () => service.commit({ platform: 'telegram', accountId: 'account-1', scopeId: 'chat-1', batchId: stale.batchId, cursor: '43' }),
      error => error?.code === 'WP_B_HISTORY_CHECKPOINT_CAS_REJECTED',
      'M2-SYNC-002:STALE_BEGIN_MUST_FAIL_CLOSED'
    );
    const next = service.begin({ platform: 'telegram', accountId: 'account-1', scopeId: 'chat-1' });
    const failed = service.fail({ platform: 'telegram', accountId: 'account-1', scopeId: 'chat-1', batchId: next.batchId, error: 'remote unknown' });
    assert.equal(failed.payload.checkpointAdvanced, false, 'M2-SYNC-002:UNKNOWN_MUST_NOT_ADVANCE');
  });
  assert.equal(observations[0].executionClaim.stateVersion, 4, 'M2-SYNC-002:STATE_VERSION_REQUIRED');
  assert.equal(observations[0].executionClaim.fencingToken, 7, 'M2-SYNC-002:FENCING_REQUIRED');
});

test('M2-DEADLINE-001 port-level deadlines are persisted absolute authority timestamps and local timeout cannot prove remote failure', async () => {
  const deadlinePath = path.join(servicesRoot, 'executionDeadline.js');
  const lifecyclePath = path.join(servicesRoot, 'durableInternalOperationAuthority.js');
  const portSource = fs.readFileSync(path.join(servicesRoot, 'platformAdapterPorts.js'), 'utf8');
  const deadlineSource = fs.readFileSync(deadlinePath, 'utf8');
  const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');
  assert.match(lifecycleSource, /deadlineAt:\s*optionalString\(input\.deadlineAt/u, 'M2-DEADLINE-001:DURABLE_CREATE_MUST_PERSIST_DEADLINE');
  assert.match(lifecycleSource, /deadlineAt:\s*execution\.deadlineAt/u, 'M2-DEADLINE-001:DURABLE_SNAPSHOT_MUST_EXPOSE_DEADLINE');
  assert.match(portSource, /persistedAuthorityDeadlineAt\(lifecycle,\s*'auth'/u, 'M2-DEADLINE-001:AUTH_PERSISTED_DEADLINE_REQUIRED');
  assert.match(portSource, /persistedAuthorityDeadlineAt\(lifecycle,\s*'reconcile'/u, 'M2-DEADLINE-001:RECONCILE_PERSISTED_DEADLINE_REQUIRED');
  assert.match(portSource, /deadlineAt:\s*created\.deadlineAt/u, 'M2-DEADLINE-001:PHYSICAL_PORT_MUST_CONSUME_PERSISTED_DEADLINE');
  assert.match(deadlineSource, /deadlineAuthority:\s*deadlineAt\s*\?\s*'PERSISTED_AUTHORITY_TIMESTAMP'/u, 'M2-DEADLINE-001:DEADLINE_AUTHORITY_CLASSIFICATION_REQUIRED');
  assert.match(deadlineSource, /outcomeUnknown:\s*options\.outcomeKnownLocal\s*===\s*true\s*\?\s*false\s*:\s*true/u, 'M2-DEADLINE-001:TIMEOUT_REMOTE_TRUTH_UNKNOWN_REQUIRED');
  assert.match(deadlineSource, /automaticRetryBlocked:[\s\S]*?true/u, 'M2-DEADLINE-001:TIMEOUT_AUTORETRY_BLOCK_REQUIRED');

  delete require.cache[require.resolve(deadlinePath)];
  const { executeWithDeadline } = require(deadlinePath);
  const deadlineAt = new Date(Date.now() + 20).toISOString();
  await assert.rejects(
    executeWithDeadline(() => new Promise(() => {}), { deadlineAt, operation: 'persisted-deadline-contract' }),
    error => error?.code === 'EXECUTION_DEADLINE_EXCEEDED'
      && error?.deadlineAt === deadlineAt
      && error?.deadlineAuthority === 'PERSISTED_AUTHORITY_TIMESTAMP'
      && error?.outcomeUnknown === true
      && error?.automaticRetryBlocked === true
  );
});


test('M2-FB-001 Facebook OAuth worker probes require one persisted operation and use its authority deadline', () => {
  const source = fs.readFileSync(path.join(servicesRoot, 'facebookOAuthService.js'), 'utf8');
  assert.match(source, /requirePersistedFacebookOperation/u, 'M2-FB-001:PERSISTED_OPERATION_VALIDATOR_REQUIRED');
  assert.match(source, /async\s+function\s+workerRequest[\s\S]*?requirePersistedFacebookOperation\(operation/u, 'M2-FB-001:WORKER_REQUEST_MUST_FAIL_CLOSED');
  assert.match(source, /executeWithDeadline/u, 'M2-FB-001:AUTHORITY_DEADLINE_ADAPTER_REQUIRED');
  assert.match(source, /deadlineAt:\s*persisted\.deadlineAt/u, 'M2-FB-001:PERSISTED_DEADLINE_REQUIRED');
});

test('M2-FB-002 legacy Facebook relay binds every signed request to a persisted attempt and owns no poll retry loop', () => {
  const source = fs.readFileSync(path.join(servicesRoot, 'facebookRelayClient.js'), 'utf8');
  assert.match(source, /function\s+persistedOperationIdentity/u, 'M2-FB-002:PERSISTED_IDENTITY_REQUIRED');
  assert.match(source, /function\s+appendPersistedOperationIdentity/u, 'M2-FB-002:SIGNED_QUERY_IDENTITY_REQUIRED');
  assert.match(source, /async\s+request\([^)]*options[\s\S]*?persistedOperationIdentity\(options/u, 'M2-FB-002:REQUEST_FAIL_CLOSED_REQUIRED');
  assert.match(source, /appendPersistedOperationIdentity\([^,]+,\s*persisted/u, 'M2-FB-002:IDENTITY_MUST_ENTER_SIGNED_URL');
  assert.doesNotMatch(source, /row\.timer|row\.backoff|setTimeout\(loop/u, 'M2-FB-002:RELAY_RETRY_LOOP_FORBIDDEN');
});

test('M2-FB-003 Facebook Worker desktop physical routes require signed persisted-attempt query identity', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'services', 'facebook-worker', 'src', 'index.js'), 'utf8');
  assert.match(source, /function\s+requirePersistedAttemptQuery/u, 'M2-FB-003:WORKER_ATTEMPT_QUERY_VALIDATOR_REQUIRED');
  assert.match(source, /function\s+isPhysicalDesktopRoute/u, 'M2-FB-003:PHYSICAL_ROUTE_CLASSIFIER_REQUIRED');
  assert.match(source, /isPhysicalDesktopRoute\(path, request\.method\)\s*\?\s*requirePersistedAttemptQuery\(url\)/u, 'M2-FB-003:PHYSICAL_ROUTE_GUARD_REQUIRED');
  assert.doesNotMatch(source, /path\.startsWith\('\/api\/desktop\/'\)\s*\?\s*requirePersistedAttemptQuery/u, 'M2-FB-003:READ_ONLY_DESKTOP_GUARD_FORBIDDEN');
  assert.match(source, /authenticateDesktop/u, 'M2-FB-003:MEDIA_SIGNATURE_AUTH_REQUIRED');
  assert.match(source, /cacheEventMedia\([^)]*persistedAttempt/u, 'M2-FB-003:MEDIA_FETCH_ATTEMPT_REQUIRED');
});

test('M2-FB-004 Facebook Worker media performs one persisted attempt and owns no retry schedule', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'services', 'facebook-worker', 'src', 'media.js'), 'utf8');
  assert.match(source, /FACEBOOK_MEDIA_PERSISTED_ATTEMPT_REQUIRED/u, 'M2-FB-004:MEDIA_FAIL_CLOSED_REQUIRED');
  assert.match(source, /if\s*\(!attemptIdentity\)\s*return\s+recordEventMediaReferences/u, 'M2-FB-004:WEBHOOK_MUST_BE_METADATA_ONLY');
  assert.doesNotMatch(source, /function\s+retryAt\b|retryPendingMedia/u, 'M2-FB-004:MEDIA_RETRY_AUTHORITY_FORBIDDEN');
  assert.doesNotMatch(source, /mediaRetryBaseSeconds|mediaRetryMaxAttempts/u, 'M2-FB-004:LOCAL_BACKOFF_POLICY_FORBIDDEN');
});

test('M2-FB-005 Facebook Worker scheduled cleanup owns no media retry or physical media deletion authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'services', 'facebook-worker', 'src', 'cleanup.js'), 'utf8');
  assert.doesNotMatch(source, /retryPendingMedia|cleanupExpiredMedia/u, 'M2-FB-005:SCHEDULED_MEDIA_AUTHORITY_FORBIDDEN');
  assert.doesNotMatch(source, /mediaRetry|mediaDeleted/u, 'M2-FB-005:SCHEDULED_MEDIA_RESULT_FORBIDDEN');
});

test('M2-FB-006 production Facebook driver is Chatwoot and legacy Page adapter is not a runtime importer', () => {
  const source = fs.readFileSync(platformDriverRegistryPath, 'utf8');
  assert.match(source, /require\('\.\/facebookChatwootMatrixBridge'\)/u, 'M2-FB-006:CHATWOOT_PRODUCTION_DRIVER_REQUIRED');
  assert.doesNotMatch(source, /require\('\.\/facebookAdapter'\)/u, 'M2-FB-006:LEGACY_ADAPTER_RUNTIME_IMPORT_FORBIDDEN');
});

test('M2-FB-007 legacy Facebook Page adapter retains projection helpers but owns no autonomous physical retry or background I/O', () => {
  const source = fs.readFileSync(path.join(servicesRoot, 'facebookAdapter.js'), 'utf8');
  assert.match(source, /requirePersistedLegacyFacebookOperation/u, 'M2-FB-007:PERSISTED_OPERATION_GUARD_REQUIRED');
  assert.match(source, /async\s+connect\([^)]*options[\s\S]*?requirePersistedLegacyFacebookOperation\(options/u, 'M2-FB-007:CONNECT_FAIL_CLOSED');
  assert.match(source, /async\s+sync\([^)]*options[\s\S]*?requirePersistedLegacyFacebookOperation\(options/u, 'M2-FB-007:SYNC_FAIL_CLOSED');
  assert.doesNotMatch(source, /schedule\(policy\.intervalMs|reconciliationTimer\s*=\s*setTimeout/u, 'M2-FB-007:PERIODIC_RECONCILIATION_FORBIDDEN');
  assert.doesNotMatch(source, /avatarBufferWithRetry[\s\S]*?for\s*\(let\s+attempt/u, 'M2-FB-007:AVATAR_RETRY_LOOP_FORBIDDEN');
  assert.doesNotMatch(source, /setImmediate\(\(\)\s*=>\s*this\.cacheWebhookAttachments/u, 'M2-FB-007:WEBHOOK_MEDIA_BACKGROUND_IO_FORBIDDEN');
  assert.doesNotMatch(source, /this\.scheduleWebhookContactEnrichment\(/u, 'M2-FB-007:WEBHOOK_PROFILE_BACKGROUND_IO_FORBIDDEN');
});

test('M2-FB-008 experimental Facebook Personal connect and sync are projection-only while physical egress remains persisted-attempt fenced', () => {
  const source = fs.readFileSync(path.join(servicesRoot, 'facebookPersonalMessengerExperimentalAdapter.js'), 'utf8');
  assert.doesNotMatch(source, /facebookRelayClient/u, 'M2-FB-008:SESSION_PROJECTION_MUST_NOT_IMPORT_PHYSICAL_RELAY');
  assert.doesNotMatch(source, /function\s+persistedOperation/u, 'M2-FB-008:SESSION_PROJECTION_MUST_NOT_CLAIM_PERSISTED_PHYSICAL_OPERATION');
  assert.match(source, /async\s+function\s+connect\([^)]*[\s\S]*?sessions\.set\(/u, 'M2-FB-008:CONNECT_REMAINS_LOCAL_SESSION_PROJECTION');
  assert.match(source, /async\s+function\s+sync\([^)]*[\s\S]*?sessionIsolationKey/u, 'M2-FB-008:SYNC_REMAINS_LOCAL_SESSION_PROJECTION');
  assert.match(source, /function\s+persistedEgressAttempt/u, 'M2-FB-008:EGRESS_PERSISTED_ATTEMPT_VALIDATOR_REQUIRED');
  assert.match(source, /async\s+function\s+sendText\([^)]*[\s\S]*?persistedEgressAttempt\(/u, 'M2-FB-008:SEND_TEXT_FAIL_CLOSED');
  assert.match(source, /async\s+function\s+sendMedia\([^)]*[\s\S]*?persistedEgressAttempt\(/u, 'M2-FB-008:SEND_MEDIA_FAIL_CLOSED');
});

test('M2-FB-009 Facebook Worker observations echo signed provider request IDs on success as well as failure', () => {
  const relaySource = fs.readFileSync(path.join(servicesRoot, 'facebookRelayClient.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'services', 'facebook-worker', 'src', 'index.js'), 'utf8');
  assert.match(workerSource, /x-yance-request-id/u, 'M2-FB-009:WORKER_REQUEST_ID_ECHO_REQUIRED');
  assert.match(relaySource, /providerRequestId/u, 'M2-FB-009:RELAY_PROVIDER_REQUEST_ID_REQUIRED');
  assert.match(relaySource, /response\.headers\?\.get\?\.\('x-yance-request-id'\)/u, 'M2-FB-009:PROVIDER_REQUEST_ID_FROM_WORKER_RESPONSE');
});
