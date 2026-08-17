'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicesRoot = path.join(__dirname, '..', '..', '..', 'services');
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
