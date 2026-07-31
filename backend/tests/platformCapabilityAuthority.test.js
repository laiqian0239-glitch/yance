'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/platformCapabilityAuthority');

function account(overrides = {}) {
  return {
    id: 'account-1',
    platform: 'whatsapp',
    state: 'connected',
    credentialReady: true,
    canAttemptSend: true,
    canSend: false,
    sendVerified: false,
    canReceive: true,
    deliveryTruth: {
      capabilities: {
        'message.text.send': { availability: 'ready', evidence: { ackStatus: 'accepted', platformMessageId: 'test-platform-mid' } }
      }
    },
    capabilities: {},
    capabilityAvailability: {},
    ...overrides
  };
}

test('capability authority exposes canonical capability ids without losing legacy ids', () => {
  const definitions = authority.definitionsForPlatform('whatsapp');
  const text = definitions.find(row => row.capabilityId === 'message.text.send');
  assert.ok(text);
  assert.equal(text.legacyId, 'text');
  assert.equal(text.support, authority.SUPPORT.SUPPORTED);
  assert.equal(text.direction, 'egress');
});

test('facebook policy capability remains constrained while current account can send', () => {
  const state = {
    accounts: [account({
      id: 'fb-1', platform: 'facebook', state: 'limited',
      subscriptionReady: true, relayState: 'connected', webhook: 'relay-connected',
      historySyncAvailable: false,
      capabilityAvailability: { proactiveSend: { availableNow: true, reason: 'ready' } }
    })]
  };
  const decision = authority.decision(state, { platform: 'facebook', accountId: 'fb-1', capabilityId: 'message.proactive.send' });
  assert.equal(decision.support, authority.SUPPORT.CONSTRAINED);
  assert.equal(decision.availability, authority.AVAILABILITY.READY);
  assert.equal(decision.enabled, true);
});

test('whatsapp identity degradation does not disable text sending', () => {
  const state = {
    accounts: [account({
      id: 'wa-1',
      identityReconciliationLastError: 'collision requires review',
      capabilityAvailability: {
        text: { availableNow: true, reason: 'ready' }
      }
    })]
  };
  const text = authority.decision(state, { platform: 'whatsapp', accountId: 'wa-1', capabilityId: 'message.text.send' });
  const identity = authority.decision(state, { platform: 'whatsapp', accountId: 'wa-1', capabilityId: 'identity.merge' });
  assert.equal(text.availability, authority.AVAILABILITY.READY);
  assert.equal(identity.availability, authority.AVAILABILITY.BLOCKED);
  assert.equal(identity.reasonCode, 'CAPABILITY_IDENTITY_FAILED');
});

test('telegram onboarding is account scoped and never escalates to global failure', () => {
  const projection = authority.evaluate({
    accounts: [account({ id: 'tg-1', platform: 'telegram', state: 'waiting-verification', credentialReady: false, canSend: false, canReceive: false })]
  });
  assert.equal(projection.platforms.telegram.availability, authority.AVAILABILITY.ONBOARDING);
  assert.equal(projection.global.health, authority.AVAILABILITY.READY);
  assert.equal(projection.global.platformFailuresDoNotEscalateToGlobal, true);
});

test('unknown capability is explicitly unavailable rather than defaulting to supported', () => {
  const state = { accounts: [account({ id: 'wa-1' })] };
  const result = authority.decision(state, { platform: 'whatsapp', accountId: 'wa-1', capabilityId: 'message.telepathy.send' });
  assert.equal(result.support, authority.SUPPORT.UNKNOWN);
  assert.equal(result.availability, authority.AVAILABILITY.UNKNOWN);
  assert.equal(result.enabled, false);
  assert.equal(result.reasonCode, 'CAPABILITY_NOT_DECLARED');
});

test('history synchronization can degrade independently from real-time send and receive', () => {
  const state = {
    accounts: [account({
      id: 'tg-1', platform: 'telegram',
      historySyncLastError: 'one dialog failed',
      capabilityAvailability: {
        text: { availableNow: true, reason: 'ready' },
        historySync: { availableNow: true, reason: 'ready' }
      }
    })]
  };
  const text = authority.decision(state, { platform: 'telegram', accountId: 'tg-1', capabilityId: 'message.text.send' });
  const history = authority.decision(state, { platform: 'telegram', accountId: 'tg-1', capabilityId: 'history.sync' });
  assert.equal(text.availability, authority.AVAILABILITY.READY);
  assert.equal(history.availability, authority.AVAILABILITY.DEGRADED);
  assert.equal(history.enabled, true);
});
