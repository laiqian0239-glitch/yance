'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accountLifecycle = require('../services/accountLifecycle');
const { mapWhatsAppState } = require('../services/platformDriverRegistry');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('F25-D07 manual pending-auth connection reaches the WhatsApp adapter while automatic recovery remains blocked', () => {
  const pending = { id: 'wa-pending', platform: 'whatsapp', lifecycleState: 'pending-auth', autoReconnect: false, paused: false };
  assert.equal(accountLifecycle.eligibility(pending, { manual: true }).eligible, true);
  assert.equal(accountLifecycle.eligibility(pending, { manual: false }).eligible, false);

  const registry = read('backend/services/platformDriverRegistry.js');
  const adapter = read('backend/services/whatsappAdapter.js');
  const manager = read('backend/services/accountManager.js');
  assert.match(manager, /driver\.connect\(account, \{[\s\S]*manual: true,[\s\S]*attemptId,[\s\S]*signal: options\.signal/u);
  assert.match(registry, /whatsapp\.start\(account, \{ manual: options\.manual === true, attemptId:/u);
  assert.match(adapter, /async start\(accountId = 'account-a', options = \{\}\)/u);
  assert.match(adapter, /assertEligible\(reference, \{ manual: options\.manual === true \}\)/u);
  assert.match(adapter, /this\.start\(latest\)/u, 'automatic reconnect must not opt into the manual authorization bypass');
});

test('F25-D07 every connection attempt has an auditable attempt id and lifecycle timestamps', () => {
  const manager = read('backend/services/accountManager.js');
  assert.match(manager, /const attemptId = String\(options\.attemptId \|\| ''\)\.trim\(\) \|\| crypto\.randomUUID\(\)/u);
  assert.match(manager, /connectionStartedAt = new Date\(\)\.toISOString\(\)/u);
  assert.match(manager, /connectionAttemptId: attemptId/u);
  assert.match(manager, /account-connect[\s\S]*attemptId[\s\S]*connectionStartedAt/u);
  assert.match(manager, /account-connect-failed[\s\S]*attemptId[\s\S]*connectionStartedAt/u);
  assert.match(manager, /connectionFinishedAt/u);
});

test('F25-D07 WhatsApp terminal events preserve the real error and stable reason code', () => {
  const manager = read('backend/services/accountManager.js');
  const adapter = read('backend/services/whatsappAdapter.js');
  assert.match(manager, /lastError: payload\.lastError \|\| payload\.error/u);
  assert.match(manager, /reasonCode: payload\.reasonCode \|\| payload\.code/u);
  assert.match(manager, /runtime\.reasonCode \|\| runtime\.lastError \|\| 'whatsapp-authorization-failed'/u);
  assert.match(adapter, /reasonCode: 'WHATSAPP_QR_START_TIMEOUT'/u);
  assert.match(adapter, /reasonCode: 'WHATSAPP_QR_RENDER_FAILED'/u);
  assert.match(adapter, /WHATSAPP_CONNECTION_CLOSED/u);
  assert.match(adapter, /WHATSAPP_LOGGED_OUT/u);
});

test('F25-D09 WhatsApp adapter states map to one canonical account runtime vocabulary', () => {
  assert.equal(mapWhatsAppState('online'), 'connected');
  assert.equal(mapWhatsAppState('qr'), 'waiting-verification');
  assert.equal(mapWhatsAppState('connecting'), 'connecting');
  assert.equal(mapWhatsAppState('offline'), 'error');
  assert.equal(mapWhatsAppState('logged-out'), 'logged-out');
  assert.equal(mapWhatsAppState('stopped'), 'logged-out');
});

test('F25-D07 runtime event merging preserves request ownership instead of replacing the whole state object', () => {
  const manager = read('backend/services/accountManager.js');
  assert.match(manager, /const previous = this\.runtime\.get\(account\.id\) \|\| \{\}/u);
  assert.match(manager, /\.\.\.previous,[\s\S]*\.\.\.payload/u);
  assert.match(manager, /connectionAttemptId: payload\.attemptId \|\| previous\.connectionAttemptId/u);
  assert.match(manager, /const normalized = \{ \.\.\.previous, \.\.\.payload/u);
});

test('F25-D07 stale adapter events cannot overwrite a newer connection attempt', () => {
  const manager = read('backend/services/accountManager.js');
  assert.match(manager, /eventAttemptId && activeAttemptId && eventAttemptId !== activeAttemptId/u);
  assert.match(manager, /stale-whatsapp-state-ignored/u);
  assert.match(manager, /stale-adapter-state-ignored/u);
});


test('F25-D46 product-area subnavigation no longer overlays titles or consumes the content grid row', () => {
  const navigation = read('frontend/js/r32-product-area-navigation.js');
  assert.doesNotMatch(navigation, /\.product-area-subnav\{[^}]*position:sticky/u);
  assert.match(navigation, /\.product-area-subnav\{[^}]*position:relative;top:auto;z-index:3/u);
  assert.match(navigation, /settings-recovery-workspace,.app\.theme-workspace-open \.theme-workspace\{grid-template-rows:auto auto minmax\(0,1fr\)\}/u);
  assert.match(navigation, /system-center-workspace\{grid-template-rows:auto auto auto minmax\(0,1fr\)\}/u);
});
