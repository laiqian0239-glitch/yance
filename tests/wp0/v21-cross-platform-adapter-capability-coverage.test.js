'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PlatformAdapterFacade } = require('../../backend/services/platformAdapterPorts');
const { driverById } = require('../../backend/services/platformDriverRegistry');

const MESSAGING_DRIVERS = [
  'telegram-personal-mtproto',
  'facebook-page-official',
  'facebook-personal-messenger-mautrix-meta'
];

function command(platform) {
  return {
    schemaVersion: 1,
    commandType: 'OutboxCommand',
    platform,
    accountId: `${platform}-account-1`,
    commandId: `${platform}-command-1`,
    outboxId: `${platform}-outbox-1`,
    operation: 'text',
    idempotencyKey: `${platform}-idempotency-1`,
    contentFrozen: true,
    finalText: 'hello',
    conversationTarget: 'peer-1',
    sessionKey: 'session-1'
  };
}

function persistedAttempt(platform, input) {
  return Object.freeze({
    executionId: `${platform}-execution-1`,
    intentId: `${platform}-intent-1`,
    attemptId: `${platform}-attempt-1`,
    claimId: `${platform}-claim-1`,
    ownerId: `${platform}-owner-1`,
    idempotencyKey: input.idempotencyKey,
    requestContentSha256: 'a'.repeat(64),
    generation: 3,
    hostGeneration: 7,
    fencingToken: 11,
    platform,
    accountReference: input.accountId
  });
}

function facade(platform, calls) {
  return new PlatformAdapterFacade(platform, {
    eventLog: {
      append(input) {
        calls.events.push(input);
        return Object.freeze({ eventId: `${platform}-event-1` });
      }
    },
    egressAuthorizer: async input => {
      calls.authorizations.push(input.commandId);
      return Object.freeze({ authorized: true, queueId: input.commandId });
    },
    egressHandler: async (input, context) => {
      calls.physical.push({ input, context });
      return Object.freeze({
        success: true,
        platformMessageId: `${platform}-provider-message-1`,
        providerRequestId: `${platform}-provider-request-1`
      });
    },
    deliveryAuthority: {
      recordSuccess(input, result) {
        calls.delivery.push({ input, result });
        return Object.freeze({
          observationId: `${platform}-observation-1`,
          capabilityId: `${platform}-capability-1`
        });
      }
    }
  });
}

test('KF-P0-23/KF-P1-06 supported Telegram and Facebook messaging drivers expose matching physical messaging capability', () => {
  for (const driverId of MESSAGING_DRIVERS) {
    const driver = driverById[driverId];
    assert.ok(driver, driverId);
    assert.equal(driver.messagingSupported, true, driverId);
    assert.equal(typeof driver.sendText, 'function', driverId);
    assert.equal(typeof driver.sendMedia, 'function', driverId);
  }

  const identityOnly = driverById['facebook-personal-identity-official'];
  assert.ok(identityOnly);
  assert.equal(identityOnly.messagingSupported, false);
  assert.equal(identityOnly.supportLevel, 'identity-only');
});

for (const platform of ['telegram', 'facebook']) {
  test(`KF-P0-23/KF-P1-06 ${platform} public egress requires and preserves one persisted physical attempt`, async () => {
    const calls = { authorizations: [], physical: [], delivery: [], events: [] };
    const adapter = facade(platform, calls);
    const input = command(platform);

    await assert.rejects(
      () => adapter.executeEgress(input, null),
      error => error?.code === 'EGRESS_PERSISTED_ATTEMPT_REQUIRED'
    );
    assert.equal(calls.authorizations.length, 0);
    assert.equal(calls.physical.length, 0);

    const attempt = persistedAttempt(platform, input);
    const result = await adapter.executeEgress(input, attempt);
    assert.equal(result.success, true);
    assert.equal(result.platformMessageId, `${platform}-provider-message-1`);
    assert.equal(calls.authorizations.length, 1);
    assert.equal(calls.physical.length, 1);
    assert.equal(calls.delivery.length, 1);

    const context = calls.physical[0].context;
    assert.equal(context.physicalAttemptContext, attempt);
    assert.equal(context.platform, platform);
    assert.equal(context.accountReference, input.accountId);
    assert.equal(context.idempotencyKey, input.idempotencyKey);
    assert.equal(context.generation, 3);
    assert.equal(context.hostGeneration, 7);
    assert.equal(context.fencingToken, 11);
    assert.equal(Object.isFrozen(context), true);
  });
}
