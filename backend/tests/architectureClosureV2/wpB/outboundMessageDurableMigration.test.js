'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { deepFreeze } = require('../../../lib/deepFreeze');
const { OPERATION_KINDS } = require('../../../services/durableOperationRegistry');
const { CommunicationAuthority } = require('../../../services/communicationAuthority');
const channelRuntimeModule = require('../../../services/channelAdapterRuntime');

const { ChannelAdapterRuntime } = channelRuntimeModule;
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const HASH = 'a'.repeat(64);

function referenceCommand() {
  return deepFreeze({
    schemaVersion: 1,
    platform: 'telegram',
    accountReference: 'account-ref-1',
    commandReference: 'command-ref-1',
    credentialReference: 'credential-ref-1',
    requestContentSha256: HASH
  });
}

function facadeFixture(overrides = {}) {
  return {
    platform: 'telegram',
    contract: () => ({ bindings: {}, boundaries: {} }),
    auth: { execute: async input => input },
    ingress: { normalize: async input => input },
    egress: { execute: async input => ({ accepted: true, input }) },
    reconcile: { execute: async input => ({ outcome: 'REMOTE_RESULT_UNKNOWN', input }) },
    ...overrides
  };
}

test('M2-OUT-001 communication authority creates durable execution and intent without touching a platform', () => {
  const calls = [];
  const authority = new CommunicationAuthority({
    storeProvider() {
      throw Object.assign(new Error('legacy communication store must not be used'), {
        code: 'LEGACY_COMMUNICATION_STORE_FORBIDDEN'
      });
    },
    durableExecutionAuthority: Object.freeze({
      createExecution(input) {
        calls.push(['execution', input]);
        return Object.freeze({ executionId: 'execution-outbound-1' });
      }
    }),
    outboxAuthority: Object.freeze({
      createIntent(input) {
        calls.push(['intent', input]);
        return Object.freeze({ intentId: 'intent-outbound-1' });
      }
    }),
    issueTimestamp: purpose => purpose === 'outbound-message-execution'
      ? '2026-08-04T03:30:00.000Z'
      : '2026-08-04T03:30:01.000Z'
  });

  assert.equal(typeof authority.prepareOutboundMessageSend, 'function');
  const prepared = authority.prepareOutboundMessageSend({
    idempotencyKey: 'outbound-idempotency-1',
    traceId: 'trace-outbound-1',
    command: referenceCommand(),
    maxAttempts: 3
  });

  assert.deepEqual(calls.map(([kind]) => kind), ['execution', 'intent']);
  assert.equal(calls[0][1].operationKind, OPERATION_KINDS.OUTBOUND_MESSAGE_SEND);
  assert.equal(calls[1][1].actionKind, OPERATION_KINDS.OUTBOUND_MESSAGE_SEND);
  assert.equal(calls[1][1].executionId, 'execution-outbound-1');
  assert.deepEqual(prepared, {
    executionId: 'execution-outbound-1',
    intentId: 'intent-outbound-1',
    operationKind: OPERATION_KINDS.OUTBOUND_MESSAGE_SEND,
    idempotencyKey: 'outbound-idempotency-1'
  });
  assert.equal(Object.isFrozen(prepared), true);
});

test('M2-OUT-002 public channel send schedules durable work and never performs the physical send', async () => {
  let physicalCallCount = 0;
  const scheduled = [];
  const facade = facadeFixture({
    egress: {
      async execute() {
        physicalCallCount += 1;
        return { accepted: true };
      }
    }
  });
  const communication = Object.freeze({
    prepareOutboundMessageSend(input) {
      scheduled.push(input);
      return Object.freeze({
        executionId: 'execution-outbound-2',
        intentId: 'intent-outbound-2',
        operationKind: OPERATION_KINDS.OUTBOUND_MESSAGE_SEND,
        idempotencyKey: input.idempotencyKey
      });
    }
  });
  const runtime = new ChannelAdapterRuntime({
    platform: 'telegram',
    facade,
    communicationAuthority: communication,
    accountReader: () => null
  });

  assert.equal(runtime.describe().migrationMode, 'durable-outbox-only');
  const result = await runtime.sendMessage({
    traceId: 'trace-outbound-2',
    accountId: 'account-ref-1',
    idempotencyKey: 'outbound-idempotency-2',
    command: {
      platform: 'telegram',
      accountId: 'account-ref-1',
      commandReference: 'command-ref-2',
      credentialReference: 'credential-ref-2',
      requestContentSha256: HASH
    }
  });

  assert.equal(physicalCallCount, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].idempotencyKey, 'outbound-idempotency-2');
  assert.equal(scheduled[0].command.accountReference, 'account-ref-1');
  assert.equal(result.executionId, 'execution-outbound-2');
  assert.equal(result.intentId, 'intent-outbound-2');
});

test('M2-OUT-003 physical channel client is frozen and fail-closed before a complete fenced attempt identity', async () => {
  const { createChannelPhysicalClient } = channelRuntimeModule;
  assert.equal(typeof createChannelPhysicalClient, 'function');

  const calls = [];
  const client = createChannelPhysicalClient({
    platform: 'telegram',
    facade: facadeFixture({
      egress: {
        async execute(command, persistedContext) {
          calls.push({ command, persistedContext });
          return {
            accepted: true,
            platformMessageId: 'platform-message-1',
            providerRequestId: 'provider-request-1'
          };
        }
      }
    })
  });

  assert.equal(Object.isFrozen(client), true);
  assert.equal(typeof client.perform, 'function');
  assert.equal(typeof client.lookup, 'function');

  await assert.rejects(
    () => client.perform(deepFreeze({
      executionId: 'execution-outbound-3',
      intentId: 'intent-outbound-3',
      attemptId: 'attempt-outbound-3',
      claimId: 'claim-outbound-3',
      ownerId: 'owner-outbound-3',
      generation: 1,
      hostGeneration: 1,
      idempotencyKey: 'outbound-idempotency-3',
      requestContentSha256: HASH,
      command: Object.freeze({ commandReference: 'command-ref-3' }),
      credential: Object.freeze({ credentialReference: 'credential-ref-3' })
    })),
    error => error?.code === 'WP_B_CHANNEL_PHYSICAL_IDENTITY_REQUIRED'
  );
  assert.equal(calls.length, 0);

  const result = await client.perform(deepFreeze({
    executionId: 'execution-outbound-3',
    intentId: 'intent-outbound-3',
    attemptId: 'attempt-outbound-3',
    claimId: 'claim-outbound-3',
    ownerId: 'owner-outbound-3',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    idempotencyKey: 'outbound-idempotency-3',
    requestContentSha256: HASH,
    command: Object.freeze({ commandReference: 'command-ref-3' }),
    credential: Object.freeze({ credentialReference: 'credential-ref-3' })
  }));

  assert.equal(calls.length, 1);
  assert.equal(Object.isFrozen(calls[0].command), true);
  assert.equal(Object.isFrozen(calls[0].persistedContext), true);
  assert.equal(calls[0].command.commandReference, 'command-ref-3');
  assert.equal(Object.hasOwn(calls[0].command, 'attemptId'), false);
  assert.equal(Object.hasOwn(calls[0].command, 'fencingToken'), false);
  assert.equal(calls[0].persistedContext.attemptId, 'attempt-outbound-3');
  assert.equal(calls[0].persistedContext.fencingToken, 1);
  assert.equal(result.platformMessageId, 'platform-message-1');
});

test('M2-OUT-004 communication authority no longer writes a second delivery attempt or receipt state machine', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'services', 'communicationAuthority.js'),
    'utf8'
  );
  assert.match(source, /OUTBOUND_MESSAGE_SEND/u);
  assert.match(source, /createExecution/u);
  assert.match(source, /createIntent/u);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+communication_delivery_attempts/iu);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+communication_delivery_receipts/iu);
});
