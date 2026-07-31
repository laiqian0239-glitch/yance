'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { redact, sanitizeObject } = require('../services/privacy');
const { accountReadiness, aiRoutingReadiness } = require('../services/diagnosticReadiness');
const platformAuthConfig = require('../services/platformAuthConfig');
const { RecoveryManager } = require('../core/recoveryManager');
const { SecurityGuard } = require('../core/securityGuard');
const logger = require('../services/logger');

const UUID = '550e8400-e29b-41d4-a716-446655440000';

test('privacy redaction preserves UUIDs while redacting phones, secrets and absolute host paths', () => {
  const input = `id=${UUID} phone=+49 151 23456789 win=C:\\Users\\Anthony\\Yance29\\logs\\x.log unix=/home/anthony/Yance29/store.sqlite Bearer top-secret`;
  const safe = redact(input, 5000, { redactPaths: true });
  assert.match(safe, new RegExp(UUID));
  assert.doesNotMatch(safe, /151 23456789/);
  assert.doesNotMatch(safe, /C:\\Users\\Anthony/);
  assert.doesNotMatch(safe, /\/home\/anthony/);
  assert.match(safe, /REDACTED_PHONE/);
  assert.match(safe, /REDACTED_PATH/);
  assert.match(safe, /Bearer \[REDACTED\]/);

  const object = sanitizeObject({ qrDataUrl: 'data:image/png;base64,SECRET', token: 'abc', file: '/mnt/data/private/report.json', uuid: UUID });
  assert.equal(object.qrDataUrl, '[REDACTED]');
  assert.equal(object.token, '[REDACTED]');
  assert.doesNotMatch(object.file, /\/mnt\/data/);
  assert.equal(object.uuid, UUID);
});

test('health readiness cannot be green when account operations fail or AI has no routable model', () => {
  const account = accountReadiness({ accounts: [
    { id: 'wa-1', platform: 'whatsapp', state: 'waiting-verification', credentialReady: false },
    { id: 'wa-2', platform: 'whatsapp', state: 'connected', credentialReady: true }
  ] }, [
    { type: 'operation-failed', command: 'account.connect', code: 'ERR_SQLITE_ERROR' },
    { type: 'operation-failed', command: 'account.logout', code: 'ACCOUNT_LOGOUT_FAILED' }
  ]);
  assert.equal(account.unreadyAccounts.length, 0);
  assert.equal(account.onboardingAccounts.length, 1);
  assert.equal(account.operationFailures.length, 2);

  const ai = aiRoutingReadiness({ models: [{}, {}, {}, {}], summary: { verified: 0, routingEligible: 0 } });
  assert.equal(ai.count, 4);
  assert.equal(ai.verified, 0);
  assert.equal(ai.routingEligible, 0);
  assert.equal(ai.pass, false);
  assert.equal(ai.replyBrain.state, 'REPLY_BRAIN_INCOMPLETE');
  assert.ok(ai.replyBrain.missing.includes('快速回复主模型'));
});

test('unconfigured platforms are not creatable/connectable while WhatsApp remains available', () => {
  const original = {
    tgId: process.env.YANCE_TELEGRAM_API_ID,
    tgHash: process.env.YANCE_TELEGRAM_API_HASH,
    fbBroker: process.env.YANCE_FACEBOOK_OAUTH_BROKER_URL,
    fbRelay: process.env.YANCE_FACEBOOK_RELAY_URL
  };
  delete process.env.YANCE_TELEGRAM_API_ID;
  delete process.env.YANCE_TELEGRAM_API_HASH;
  delete process.env.YANCE_FACEBOOK_OAUTH_BROKER_URL;
  delete process.env.YANCE_FACEBOOK_RELAY_URL;
  try {
    assert.equal(platformAuthConfig.assertAvailable('whatsapp', 'connect').available, true);
    const state = platformAuthConfig.publicState();
    if (!state.telegram.available) assert.throws(() => platformAuthConfig.assertAvailable('telegram', 'create'), error => error.code === 'PLATFORM_RELEASE_SERVICE_UNAVAILABLE');
    if (!state.facebook.available) assert.throws(() => platformAuthConfig.assertAvailable('facebook', 'connect'), error => error.code === 'PLATFORM_RELEASE_SERVICE_UNAVAILABLE');
    assert.throws(() => platformAuthConfig.assertAvailable('unknown', 'create'), error => error.code === 'UNSUPPORTED_PLATFORM');
  } finally {
    for (const [key, value] of Object.entries({ YANCE_TELEGRAM_API_ID: original.tgId, YANCE_TELEGRAM_API_HASH: original.tgHash, YANCE_FACEBOOK_OAUTH_BROKER_URL: original.fbBroker, YANCE_FACEBOOK_RELAY_URL: original.fbRelay })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('recovery diagnostics export removes host paths and authentication challenges', async () => {
  const manager = new RecoveryManager({
    safeModeService: { snapshot: () => ({ enabled: false, file: 'C:\\Users\\Anthony\\safe.json' }) },
    backupService: { pendingRestore: () => null, restoreHistory: () => [{ root: '/home/anthony/backup' }] },
    diagnosticsService: { snapshot: () => ({ tests: [], path: '/mnt/data/yance/private.db', uuid: UUID }) },
    productionDiagnostics: { snapshot: () => ({ traceFile: 'C:\\Users\\Anthony\\logs\\trace.jsonl', recent: [{ qrDataUrl: 'SECRET_QR', phone: '+49 151 23456789' }] }) },
    systemPolicy: { read: () => ({ privacyMode: true }) },
    lifecycleManager: {}, securityGuard: {}, eventBus: {}, logger: {}
  });
  const exported = await manager.execute('recovery.exportDiagnostics', { limit: 20 });
  const text = JSON.stringify(exported);
  assert.equal(exported.privacyMode, true);
  assert.match(text, new RegExp(UUID));
  assert.doesNotMatch(text, /SECRET_QR/);
  assert.doesNotMatch(text, /C:\\\\Users/);
  assert.doesNotMatch(text, /\/home\/anthony|\/mnt\/data\/yance/);
  assert.match(text, /REDACTED_PATH/);
});

test('high-frequency credential reads are sampled instead of flooding diagnostics', () => {
  let diagnosticEvents = 0;
  let busEvents = 0;
  const guard = new SecurityGuard({
    secureBridge: { available: true, get: () => ({ ok: true }), has: () => true, listRefs: () => [], persist: async () => true, remove: async () => true, on() {}, off() {} },
    systemPolicy: { assertWriteAllowed() {} },
    eventBus: { publish: () => { busEvents += 1; } },
    logger: { warn() {} }
  }).setPolicyProviders({ lifecycleStateProvider: () => 'running', safeModeProvider: () => false, productionDiagnostics: { recordEvent: () => { diagnosticEvents += 1; } } });
  for (let index = 0; index < 25; index += 1) guard.readCredential('platform:test', { actor: 'platform-adapter' });
  assert.equal(guard.snapshot().decisions.allowed, 25);
  assert.equal(diagnosticEvents, 1);
  assert.equal(busEvents, 1);
});

test('rate-limited logger, QR polling and consumer-only platform login gates are present', () => {
  logger._resetRateLimitsForTests();
  assert.equal(logger.rateLimited('test', 'info', 'repeat', { path: '/home/user/private' }, { key: 'same', intervalMs: 60000 }), true);
  assert.equal(logger.rateLimited('test', 'info', 'repeat', {}, { key: 'same', intervalMs: 60000 }), false);
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'r32-account-center.js'), 'utf8');
  const coreClient = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'core-client.js'), 'utf8');
  assert.match(source, /button\.disabled = !available/);
  assert.match(source, /扫描二维码登录/);
  assert.match(source, /使用手机号登录/);
  assert.match(source, /使用主页管理员个人账号授权/);
  assert.match(source, /选择此主页/);
  assert.match(source, /elapsed < 5000 \? 900 : elapsed < 15000 \? 1400 : 2200/);
  assert.doesNotMatch(source, /ac32PlatformConfig|platform-auth|API ID|API Hash|OAuth Broker|Relay URL/);
  assert.doesNotMatch(coreClient, /account\.platformAuth\.(?:configure|clear)/);
  assert.match(coreClient, /'auth-challenge':'account\.getAuthChallenge'/);
});
