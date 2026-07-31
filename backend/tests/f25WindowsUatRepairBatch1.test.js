'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAccountSummary } = require('../services/accountSummaryProjection');
const accountLifecycle = require('../services/accountLifecycle');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('F25-D05 WhatsApp runtime state mapping is exported and AccountManager never calls an undefined local symbol', () => {
  const registry = read('backend/services/platformDriverRegistry.js');
  const manager = read('backend/services/accountManager.js');
  assert.match(registry, /module\.exports\s*=\s*\{[^}]*mapWhatsAppState/u);
  assert.match(manager, /platformDrivers\.mapWhatsAppState\(payload\.state\)/u);
  assert.doesNotMatch(manager, /state:\s*mapWhatsAppState\(payload\.state\)/u);
});

test('F25-D04 pending authorization accounts are excluded from formal account totals', () => {
  const summary = buildAccountSummary([
    { id: 'wa-active', platform: 'whatsapp', state: 'connected', credentialReady: true, unread: 3 },
    { id: 'wa-pending', platform: 'whatsapp', state: 'connecting', lifecycleState: 'pending-auth', authorizationPending: true, unread: 9 },
    { id: 'fb-active', platform: 'facebook', state: 'limited', credentialReady: true, unread: 2 }
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.pendingAuthorization, 1);
  assert.equal(summary.unread, 5);
  assert.equal(summary.platforms.find(row => row.platform === 'whatsapp').total, 1);
  assert.equal(summary.platforms.find(row => row.platform === 'whatsapp').pendingAuthorization, 1);
});

test('F25-D04 pending authorization accounts are blocked from automatic recovery but remain manually operable for the auth flow', () => {
  const account = { id: 'wa-pending', lifecycleState: 'pending-auth', autoReconnect: true, paused: false };
  assert.equal(accountLifecycle.eligibility(account, { manual: false }).eligible, false);
  assert.ok(accountLifecycle.eligibility(account, { manual: false }).reasons.includes('authorization-pending'));
  assert.equal(accountLifecycle.eligibility(account, { manual: true }).eligible, true);
});

test('F25-D04 account creation uses a pending authorization lifecycle and cannot become default before success', () => {
  const manager = read('backend/services/accountManager.js');
  const repository = read('backend/repositories/accountRepository.js');
  const frontend = read('frontend/r32-account-center.js');
  assert.match(frontend, /authorizationPending:true/u);
  assert.match(manager, /lifecycleState:\s*'pending-auth'/u);
  assert.match(manager, /autoReconnect:\s*false/u);
  assert.match(repository, /created\.lifecycleState\s*!==\s*'pending-auth'/u);
});

test('F25-D04 failed and cancelled authorization has an idempotent cleanup command wired end-to-end', () => {
  const manager = read('backend/services/accountManager.js');
  const context = read('backend/core/accountContext.js');
  const routes = read('backend/routes/accounts.js');
  const frontend = read('frontend/r32-account-center.js');
  const coreClient = read('frontend/js/core-client.js');
  assert.match(manager, /async discardPendingAuthorization/u);
  assert.match(context, /account\.authorization\.discardPending/u);
  assert.match(routes, /authorization\/discard-pending/u);
  assert.match(frontend, /discardPendingAuthorization\(account\.id/u);
  assert.match(frontend, /whatsapp-qr-timeout/u);
  assert.match(frontend, /telegram-qr-timeout/u);
  assert.match(frontend, /facebook-oauth-timeout/u);
  assert.match(coreClient, /authorization\/discard-pending':'account\.authorization\.discardPending/u);
});

test('F25-D06 account connection has a bounded 60 second core budget and reports a stable timeout code', () => {
  const frontend = read('frontend/r32-account-center.js');
  const coreClient = read('frontend/js/core-client.js');
  assert.match(frontend, /\/connect`,\s*\{\s*method:'POST',\s*body:\{\},\s*timeoutMs:60000\s*\}/u);
  assert.match(coreClient, /CORE_COMMAND_TIMEOUT/u);
  assert.match(coreClient, /核心命令等待超时/u);
  assert.match(coreClient, /timeout\.command\s*=\s*commandName/u);
});

test('F25-D04 successful authorization promotes the account and only then enables automatic recovery', () => {
  const manager = read('backend/services/accountManager.js');
  const repository = read('backend/repositories/accountRepository.js');
  assert.match(manager, /async promotePendingAuthorization/u);
  assert.match(manager, /lifecycleState:\s*'active'/u);
  assert.match(manager, /autoReconnect:\s*true/u);
  assert.match(manager, /accountStore\.promoteAuthorizationTx/u);
  assert.match(repository, /account-authorization-promoted/u);
  assert.match(manager, /await this\.promotePendingAuthorization\(account\.id, result\)/u);
});
