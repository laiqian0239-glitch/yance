'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/platformProductionReadinessAuthority');
const { accountReadiness } = require('../services/diagnosticReadiness');
const platformDrivers = require('../services/platformDriverRegistry');

test('unconfigured Telegram accounts remain onboarding and never become a global critical failure', () => {
  const state = {
    accounts: [{ id: 'tg-pending', platform: 'telegram', state: 'unconfigured', credentialReady: false, canSend: false, canReceive: false }]
  };
  const readiness = accountReadiness(state, []);
  assert.equal(readiness.activeAccounts.length, 0);
  assert.equal(readiness.onboardingAccounts.length, 1);
  assert.equal(readiness.unreadyAccounts.length, 0);
  const projection = authority.evaluate(state);
  assert.equal(projection.platforms.telegram.status, authority.STATUS.ONBOARDING);
  assert.equal(projection.summary.blockedPlatforms, 0);
});

test('Facebook readiness separates real-time messaging from optional Business Suite history permission', () => {
  const projection = authority.evaluate({
    accounts: [{
      id: 'fb-ready-new-messages', platform: 'facebook', state: 'limited', credentialReady: true,
      canSend: true, canReceive: true, permissionReady: true, subscriptionReady: true,
      relayState: 'connected', webhook: 'relay-connected', historySyncAvailable: false,
      historySyncReason: 'pages_read_engagement 尚未授权', reconciliationActive: false
    }]
  }).platforms.facebook;
  assert.equal(projection.status, authority.STATUS.DEGRADED);
  const checks = projection.accounts[0].checks;
  assert.equal(checks.find(row => row.id === 'send').status, 'pass');
  assert.equal(checks.find(row => row.id === 'receive').status, 'pass');
  assert.equal(checks.find(row => row.id === 'history').status, 'warning');
  assert.equal(checks.find(row => row.id === 'reconciliation').status, 'warning');
});

test('Facebook readiness blocks a configured Page when webhook receive chain is unavailable', () => {
  const projection = authority.evaluate({
    accounts: [{
      id: 'fb-blocked', platform: 'facebook', state: 'limited', credentialReady: true,
      canSend: true, canReceive: false, permissionReady: true, subscriptionReady: false,
      relayState: 'connecting', webhook: 'unsubscribed', historySyncAvailable: true
    }]
  }).platforms.facebook;
  assert.equal(projection.status, authority.STATUS.BLOCKED);
  assert.equal(projection.accounts[0].checks.find(row => row.id === 'receive').status, 'fail');
});

test('WhatsApp readiness reports identity reconciliation evidence separately from message connectivity', () => {
  const projection = authority.evaluate({
    accounts: [{
      id: 'wa-ready', platform: 'whatsapp', state: 'connected', credentialReady: true,
      canSend: true, canReceive: true,
      identityReconciliationLastAt: '2026-07-26T00:00:00.000Z',
      identityReconciliationLastResult: { scanned: 12, resolved: 12, failed: 0, conversationMerges: 2 }
    }]
  }).platforms.whatsapp;
  assert.equal(projection.status, authority.STATUS.READY_FOR_REAL_UAT);
  assert.equal(projection.accounts[0].checks.find(row => row.id === 'identity').status, 'pass');
  assert.equal(projection.accounts[0].counts.realUatRequired, 2);
});

test('Telegram readiness records history sync degradation without disabling basic message send and receive', () => {
  const projection = authority.evaluate({
    accounts: [{
      id: 'tg-connected', platform: 'telegram', state: 'connected', credentialReady: true,
      canSend: true, canReceive: true,
      historySyncLastResult: { conversations: 20, messagesInserted: 120, failedConversations: 1, failedMessages: 2 },
      historySyncLastAt: '2026-07-26T00:00:00.000Z'
    }]
  }).platforms.telegram;
  assert.equal(projection.status, authority.STATUS.DEGRADED);
  assert.equal(projection.accounts[0].checks.find(row => row.id === 'send').status, 'pass');
  assert.equal(projection.accounts[0].checks.find(row => row.id === 'receive').status, 'pass');
  assert.equal(projection.accounts[0].checks.find(row => row.id === 'history').status, 'warning');
});

test('WhatsApp production readiness is owned by the mautrix-whatsapp driver', () => {
  const driver = platformDrivers.getForAccount({ platform: 'whatsapp', accountKind: 'personal-multidevice' });
  assert.equal(driver.driverId, 'whatsapp-personal-mautrix-whatsapp');
  assert.equal(driver.protocolAuthority, 'mautrix-whatsapp');
});

test('Telegram production readiness is owned by the mautrix-telegram driver', () => {
  const driver = platformDrivers.getForAccount({ platform: 'telegram', accountKind: 'personal' });
  assert.equal(driver.driverId, 'telegram-personal-mautrix-telegram');
  assert.equal(driver.protocolAuthority, 'mautrix-telegram');
});
