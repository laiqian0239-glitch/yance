'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOutboundMessageSendOperation
} = require('../../backend/services/durableOperations/outboundMessageSendOperation');

function attemptEnvelope(overrides = {}) {
  return Object.freeze({
    executionId: 'execution-platform-accepted-1',
    intentId: 'intent-platform-accepted-1',
    attemptId: 'attempt-platform-accepted-1',
    claimId: 'claim-platform-accepted-1',
    ownerId: 'owner-platform-accepted-1',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    idempotencyKey: 'idempotency-platform-accepted-1',
    request: Object.freeze({
      platform: 'whatsapp',
      accountReference: 'account-platform-accepted-1',
      commandReference: 'command-platform-accepted-1',
      credentialReference: 'credential-platform-accepted-1',
      requestContentSha256: 'a'.repeat(64)
    }),
    ...overrides
  });
}

function operation({ perform, enqueueLocalPersistenceRepair }) {
  return createOutboundMessageSendOperation({
    resolveCommandReference() {
      return Object.freeze({ messageBody: 'ephemeral-only' });
    },
    resolveCredentialReference() {
      return Object.freeze({ session: 'ephemeral-only' });
    },
    enqueueLocalPersistenceRepair,
    channelClient: Object.freeze({
      perform,
      async lookup() {
        return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' });
      }
    })
  });
}

test('platform-accepted local projection failure is durably queued before outbound success escapes', async () => {
  const calls = [];
  const adapter = operation({
    async perform() {
      calls.push('physical-accepted');
      return Object.freeze({
        accepted: true,
        platformMessageId: 'remote-message-1',
        providerRequestId: 'provider-request-1',
        evidenceReference: 'provider-receipt:remote-message-1',
        localPersistencePending: true,
        localPersistenceRepair: Object.freeze({
          kind: 'message-upsert',
          message: Object.freeze({
            accountId: 'account-platform-accepted-1',
            conversationId: 'conversation-platform-accepted-1',
            externalMessageId: 'remote-message-1'
          })
        })
      });
    },
    enqueueLocalPersistenceRepair(input) {
      calls.push('repair-durable');
      assert.equal(input.id, 'local-repair-attempt-platform-accepted-1');
      assert.equal(input.queueId, 'command-platform-accepted-1');
      assert.equal(input.platform, 'whatsapp');
      assert.equal(input.accountId, 'account-platform-accepted-1');
      assert.equal(input.conversationId, 'conversation-platform-accepted-1');
      assert.equal(input.payload.kind, 'message-upsert');
      return Object.freeze({ id: input.id, state: 'pending' });
    }
  });

  const result = await adapter.perform(attemptEnvelope());
  calls.push('success-returned');

  assert.deepEqual(calls, ['physical-accepted', 'repair-durable', 'success-returned']);
  assert.deepEqual(result, {
    accepted: true,
    platformMessageId: 'remote-message-1',
    providerRequestId: 'provider-request-1',
    evidenceReference: 'provider-receipt:remote-message-1'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'localPersistenceRepair'), false);
});

test('repair durability failure converts post-call state to uncertain and blocks automatic resend', async () => {
  const adapter = operation({
    async perform() {
      return Object.freeze({
        accepted: true,
        platformMessageId: 'remote-message-2',
        localPersistencePending: true,
        localPersistenceRepair: Object.freeze({
          kind: 'message-upsert',
          message: Object.freeze({ conversationId: 'conversation-platform-accepted-2' })
        })
      });
    },
    enqueueLocalPersistenceRepair() {
      throw Object.assign(new Error('repair database unavailable'), { code: 'SQLITE_BUSY' });
    }
  });

  await assert.rejects(
    () => adapter.perform(attemptEnvelope({ attemptId: 'attempt-platform-accepted-2' })),
    error => error?.code === 'WP_B_OUTBOUND_LOCAL_REPAIR_DURABILITY_UNCERTAIN'
      && error?.platformAccepted === true
      && error?.remoteOutcomeUnknown === true
      && error?.outcomeUnknown === true
      && error?.automaticRetryBlocked === true
      && error?.platformMessageId === 'remote-message-2'
      && error?.causeCode === 'SQLITE_BUSY'
  );
});

test('normal outbound success does not allocate a local repair', async () => {
  let repairCalls = 0;
  const adapter = operation({
    async perform() {
      return Object.freeze({ accepted: true, platformMessageId: 'remote-message-3' });
    },
    enqueueLocalPersistenceRepair() {
      repairCalls += 1;
      throw new Error('must not be called');
    }
  });

  const result = await adapter.perform(attemptEnvelope({ attemptId: 'attempt-platform-accepted-3' }));
  assert.equal(result.platformMessageId, 'remote-message-3');
  assert.equal(repairCalls, 0);
});