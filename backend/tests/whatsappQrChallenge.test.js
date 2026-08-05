'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const challenges = require('../services/authChallengeService');
const accountManagerModule = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const whatsapp = require('../services/whatsappAdapter');
const telegram = require('../services/telegramAdapter');
const messageStore = require('../services/messageStore');
const accountLifecycleSaga = require('../services/accountLifecycleSagaService').singleton;

const SECRET_QR = 'data:image/png;base64,TOP_SECRET_QR_BYTES';

test.beforeEach(() => challenges.resetForTests());

test('WhatsApp QR challenge is short-lived, refreshable and explicitly cleared', () => {
  const first = challenges.issue({ accountId: 'wa-db', aliases: ['wa-adapter'], dataUrl: SECRET_QR, ttlMs: 5000 });
  assert.equal(first.version, 1);
  assert.equal(first.dataUrl, undefined);
  assert.equal(challenges.read('wa-adapter', { includeSecret: true }).dataUrl, SECRET_QR);
  const second = challenges.issue({ accountId: 'wa-db', aliases: ['wa-adapter'], dataUrl: `${SECRET_QR}-2`, ttlMs: 5000 });
  assert.equal(second.version, 2);
  assert.equal(challenges.read('wa-db', { includeSecret: true }).dataUrl, `${SECRET_QR}-2`);
  challenges.purgeExpired(Date.now() + 6000);
  assert.equal(challenges.read('wa-db', { includeSecret: true }), null);
  challenges.issue({ accountId: 'wa-db', aliases: ['wa-adapter'], dataUrl: SECRET_QR });
  assert.equal(challenges.clear('wa-adapter'), true);
  assert.equal(challenges.read('wa-db', { includeSecret: true }), null);
});

test('generic account list exposes only QR readiness metadata, never QR bytes', async t => {
  const { AccountManager } = accountManagerModule;
  const account = { id: 'wa-db', platform: 'whatsapp', adapterAccountId: 'wa-adapter', displayName: 'WA', identityLabel: 'WA', metadata: {}, paused: false, notificationsEnabled: true };
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });
  patch(accountStore, 'get', () => account);
  patch(accountStore, 'list', () => [account]);
  patch(accountStore, 'read', () => ({ schemaVersion: 4, accounts: [account], defaults: {}, bindings: {}, audit: [] }));
  patch(whatsapp, 'resolveAccountKey', () => 'wa-adapter');
  patch(whatsapp, 'status', () => [{ accountId: 'wa-adapter', state: 'qr', qrReady: true, qrExpiresAt: '2099-01-01T00:00:00.000Z', qrVersion: 1 }]);
  patch(whatsapp, 'credentialState', () => ({ usable: false, accountKey: 'wa-adapter', registered: false }));
  patch(messageStore, 'listConversations', () => []);
  patch(accountLifecycleSaga, 'latest', () => null);
  challenges.issue({ accountId: 'wa-db', aliases: ['wa-adapter'], dataUrl: SECRET_QR });
  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  const listed = manager.list();
  assert.equal(listed.accounts[0].qrReady, true);
  assert.equal(listed.accounts[0].qrDataUrl, '');
  assert.equal(JSON.stringify(listed).includes('TOP_SECRET_QR_BYTES'), false);
  const dedicated = manager.getAuthChallenge('wa-db');
  assert.equal(dedicated.challenge.dataUrl, SECRET_QR);
});


test('Telegram QR bytes stay out of account listings and are readable only through the dedicated challenge endpoint', t => {
  const { AccountManager } = accountManagerModule;
  const account = { id: 'tg-db', platform: 'telegram', credentialRef: 'credential:tg-db', displayName: 'TG', identityLabel: 'TG', metadata: {}, paused: false, notificationsEnabled: true };
  const restore = [];
  function patch(object, key, value) { restore.push([object, key, object[key]]); object[key] = value; }
  t.after(() => { for (const [object, key, value] of restore.reverse()) object[key] = value; });
  patch(accountStore, 'get', () => account);
  patch(accountStore, 'list', () => [account]);
  patch(accountStore, 'read', () => ({ schemaVersion: 4, accounts: [account], defaults: {}, bindings: {}, audit: [] }));
  patch(telegram, 'status', () => ({ state: 'waiting-verification', step: 'qr', qrReady: true, qrExpiresAt: '2099-01-01T00:00:00.000Z', qrVersion: 1 }));
  patch(messageStore, 'listConversations', () => []);
  patch(accountLifecycleSaga, 'latest', () => null);
  challenges.issue({ accountId: 'tg-db', type: 'telegram-qr', dataUrl: SECRET_QR });
  const manager = new AccountManager();
  manager.hydration = { phase: 'ready', ready: true, startedAt: '', completedAt: new Date().toISOString(), errorCode: '' };
  const listed = manager.list();
  assert.equal(listed.accounts[0].qrReady, true);
  assert.equal(listed.accounts[0].qrDataUrl, '');
  assert.equal(JSON.stringify(listed).includes('TOP_SECRET_QR_BYTES'), false);
  const dedicated = manager.getAuthChallenge('tg-db');
  assert.equal(dedicated.challenge.type, 'telegram-qr');
  assert.equal(dedicated.challenge.dataUrl, SECRET_QR);
});

test('Telegram QR production path issues and clears a short-lived challenge instead of publishing QR bytes in account state', () => {
  const root = path.resolve(__dirname, '..', '..');
  const frontend = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'backend/services/telegramAdapter.js'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'backend/services/accountManager.js'), 'utf8');
  const coreClient = fs.readFileSync(path.join(root, 'frontend/js/core-client.js'), 'utf8');
  assert.match(adapter, /type: 'telegram-qr'/);
  assert.match(adapter, /authChallenges\.issue/);
  assert.match(adapter, /completeLogin[\s\S]*authChallenges\.clear\(account\.id\)/);
  assert.match(adapter, /cancelLogin[\s\S]*authChallenges\.clear\(accountId\)/);
  assert.doesNotMatch(adapter, /qrDataUrl:\s*row\.qrDataUrl/);
  assert.match(manager, /\['whatsapp', 'telegram'\]\.includes\(account\.platform\)/);
  assert.match(frontend, /pollAuthChallenge\(account\.id, 'telegram'\)/);
  assert.doesNotMatch(coreClient, /account\.platformAuth\.(?:configure|clear)/);
  assert.doesNotMatch(frontend, /account\.qrDataUrl/);
});

test('QR delivery has independent polling and WebSocket channels and clears on successful scan', () => {
  const root = path.resolve(__dirname, '..', '..');
  const routes = fs.readFileSync(path.join(root, 'backend/routes/accounts.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  const coreClient = fs.readFileSync(path.join(root, 'frontend/js/core-client.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'backend/services/whatsappAdapter.js'), 'utf8');
  const pollPolicy = fs.readFileSync(path.join(root, 'frontend/js/r32-account-auth-poll-policy.js'), 'utf8');
  assert.match(routes, /\/:id\/auth-challenge/);
  assert.match(frontend, /auth-challenge/);
  assert.match(coreClient, /'auth-challenge':'account\.getAuthChallenge'/);
  assert.match(frontend, /row\.type === 'whatsapp:qr'/);
  assert.match(frontend, /正在生成二维码…/);
  assert.match(frontend, /pollAuthChallenge\(account\.id, 'whatsapp', 45000\)/);
  assert.match(frontend, /YanceAccountAuthPollPolicy/);
  assert.match(frontend, /qrPollTokens\[accountId\]/);
  assert.doesNotMatch(frontend, /account\?\.state === 'error'\) return false/);
  assert.match(pollPolicy, /ACCOUNT_TRANSIENT_ERROR_WAITING_FOR_QR_RETRY/);
  assert.match(pollPolicy, /ACCOUNT_AUTH_REQUEST_INACTIVE/);
  assert.match(adapter, /authChallenges\.issue/);
  assert.match(adapter, /connection === 'open'[\s\S]*authChallenges\.clear/);
  assert.match(adapter, /qrDataUrl[\s\S]*eventBus\.publish\('whatsapp:qr'/);
});


test('WhatsApp version discovery is fail-open and bounded so QR startup cannot hang on GitHub', async () => {
  const result = await whatsapp.discoverBaileysVersion({
    fetchLatestBaileysVersion: () => new Promise(() => {})
  }, 25);
  assert.equal(result.timedOut, true);
  assert.equal(result.version, null);
});

test('WhatsApp version discovery preserves a valid resolved protocol version', async () => {
  const result = await whatsapp.discoverBaileysVersion({
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1027934701], isLatest: true })
  }, 25);
  assert.deepEqual(result.version, [2, 3000, 1027934701]);
  assert.equal(result.isLatest, true);
  assert.equal(result.timedOut, false);
});

test('WhatsApp QR startup has a hard timeout, stale-socket replacement and a user-visible retry path', () => {
  const root = path.resolve(__dirname, '..', '..');
  const frontend = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'backend/services/whatsappAdapter.js'), 'utf8');
  assert.match(adapter, /WHATSAPP_QR_STARTUP_TIMEOUT_MS = 30000/);
  assert.match(adapter, /version-discovery-timeout/);
  assert.match(adapter, /stale-startup-replaced/);
  assert.match(adapter, /WHATSAPP_QR_START_TIMEOUT/);
  assert.match(adapter, /startupTimedOut: row\.startupTimedOut/);
  assert.match(adapter, /if \(!policy\.autoReconnect\) return;/);
  assert.match(adapter, /shouldExecuteReconnect/);
  assert.match(frontend, /state\.awaitingQrAccountId = ''[\s\S]*renderWorkbench\(\)[\s\S]*return false/);
  assert.match(frontend, /WhatsApp 未生成二维码。连接已停止，请检查网络后点击重试。/);
});
