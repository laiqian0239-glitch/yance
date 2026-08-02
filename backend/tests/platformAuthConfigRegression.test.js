'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const platformAuthConfig = require('../services/platformAuthConfig');
const releasePlatformAuth = require('../services/releasePlatformAuth');
const facebookOAuth = require('../services/facebookOAuthService');

function writeSealedConfig(document) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-release-platform-auth-'));
  const configPath = path.join(root, 'platform-auth.json');
  const hashPath = path.join(root, 'platform-auth.sha256');
  const text = `${JSON.stringify(document, null, 2)}\n`;
  fs.writeFileSync(configPath, text);
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(hashPath, `${digest} *platform-auth.json\n`);
  return { root, configPath, hashPath };
}

function withEnvironment(t, values = {}) {
  const names = [
    'YANCE_PLATFORM_AUTH_CONFIG_PATH',
    'YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH',
    'YANCE_TELEGRAM_API_ID',
    'YANCE_TELEGRAM_API_HASH',
    'YANCE_FACEBOOK_OAUTH_BROKER_URL',
    'YANCE_FACEBOOK_RELAY_URL',
    'YANCE_FACEBOOK_GRAPH_VERSION'
  ];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  for (const [name, value] of Object.entries(values)) process.env[name] = String(value);
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function validDocument() {
  return {
    schemaVersion: 1,
    releaseManaged: true,
    telegram: { apiId: 123456, apiHash: 'a'.repeat(32) },
    facebook: {
      oauthBrokerUrl: 'https://auth.example.com/facebook',
      relayUrl: 'wss://relay.example.com/facebook',
      graphVersion: 'v25.0'
    }
  };
}

test('sealed release platform configuration enables consumer Telegram and Facebook login without exposing values publicly', t => {
  const sealed = writeSealedConfig(validDocument());
  t.after(() => fs.rmSync(sealed.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  withEnvironment(t, {
    YANCE_PLATFORM_AUTH_CONFIG_PATH: sealed.configPath,
    YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH: sealed.hashPath
  });

  const raw = releasePlatformAuth.loadReleasePlatformAuth();
  assert.equal(raw.source, 'sealed-release-file');
  assert.equal(raw.sealed, true);
  assert.equal(raw.telegram.apiId, 123456);

  const state = platformAuthConfig.publicState();
  assert.deepEqual(state.telegram, {
    configured: true,
    available: true,
    releaseManaged: true,
    status: 'available',
    reason: '',
    userAction: 'login'
  });
  assert.deepEqual(state.facebook, {
    configured: true,
    available: true,
    releaseManaged: true,
    status: 'available',
    reason: '',
    userAction: 'login'
  });
  assert.equal(Object.hasOwn(state.telegram, 'apiHash'), false);
  assert.equal(Object.hasOwn(state.facebook, 'brokerUrl'), false);
});


test('Telegram-only sealed release enables Telegram while Facebook remains unavailable', t => {
  const document = {
    schemaVersion: 1,
    releaseManaged: true,
    telegram: { apiId: 654321, apiHash: 'b'.repeat(32) },
    facebook: {}
  };
  const sealed = writeSealedConfig(document);
  t.after(() => fs.rmSync(sealed.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  withEnvironment(t, {
    YANCE_PLATFORM_AUTH_CONFIG_PATH: sealed.configPath,
    YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH: sealed.hashPath
  });

  const raw = releasePlatformAuth.loadReleasePlatformAuth();
  assert.equal(raw.telegram.apiId, 654321);
  assert.deepEqual(raw.facebook, {});
  const state = platformAuthConfig.publicState();
  assert.equal(state.telegram.available, true);
  assert.equal(state.facebook.available, false);
  assert.equal(state.facebook.userAction, 'install-enabled-release');
});

test('tampered release platform configuration fails closed', t => {
  const sealed = writeSealedConfig(validDocument());
  t.after(() => fs.rmSync(sealed.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  fs.appendFileSync(sealed.configPath, ' ');
  withEnvironment(t, {
    YANCE_PLATFORM_AUTH_CONFIG_PATH: sealed.configPath,
    YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH: sealed.hashPath
  });
  const loaded = releasePlatformAuth.loadReleasePlatformAuth();
  assert.equal(loaded.source, 'invalid-release-config');
  assert.equal(loaded.error.code, 'PLATFORM_AUTH_HASH_MISMATCH');
  assert.equal(platformAuthConfig.publicState().telegram.available, false);
  assert.throws(() => platformAuthConfig.assertAvailable('telegram', 'create'), error => (
    error.code === 'PLATFORM_RELEASE_SERVICE_UNAVAILABLE' && !error.message.includes('API')
  ));
});

test('missing release services never ask a normal user for developer configuration', t => {
  withEnvironment(t, { YANCE_PLATFORM_AUTH_CONFIG_PATH: path.join(os.tmpdir(), 'missing-yance-platform-auth.json') });
  const state = platformAuthConfig.publicState();
  assert.equal(state.telegram.status, 'release-service-unavailable');
  assert.equal(state.facebook.status, 'release-service-unavailable');
  assert.throws(() => platformAuthConfig.assertAvailable('facebook', 'connect'), error => (
    error.code === 'PLATFORM_RELEASE_SERVICE_UNAVAILABLE' && /正式升级包/.test(error.message)
  ));
});

test('platform application settings cannot be changed or deleted by the normal application runtime', async () => {
  await assert.rejects(platformAuthConfig.configure('telegram'), error => error.code === 'PLATFORM_AUTH_RELEASE_MANAGED');
  await assert.rejects(platformAuthConfig.clear('facebook'), error => error.code === 'PLATFORM_AUTH_RELEASE_MANAGED');
});

test('release configuration validation rejects malformed values and never weakens transport security in test mode', t => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  assert.throws(() => platformAuthConfig.normalizeTelegram({ apiId: 0, apiHash: 'bad' }), error => error.code === 'TELEGRAM_API_ID_INVALID');
  assert.throws(() => platformAuthConfig.normalizeTelegram({ apiId: 123, apiHash: 'bad' }), error => error.code === 'TELEGRAM_API_HASH_INVALID');
  assert.throws(() => platformAuthConfig.normalizeFacebook({
    oauthBrokerUrl: 'http://auth.example.com',
    relayUrl: 'wss://relay.example.com/facebook',
    graphVersion: 'v25.0'
  }), error => error.code === 'PLATFORM_AUTH_HTTPS_REQUIRED');
  assert.throws(
    () => releasePlatformAuth.secureReleaseUrl('http://auth.example.com', ['https:']),
    error => error.code === 'PLATFORM_AUTH_HTTPS_REQUIRED'
  );
});

test('Facebook Page authorization still requires messaging and metadata permissions', () => {
  assert.deepEqual(facebookOAuth.missingPagePermissions({ permissions: ['pages_messaging'] }), ['pages_show_list', 'pages_manage_metadata']);
  assert.deepEqual(facebookOAuth.missingPagePermissions({ permissions: ['pages_manage_metadata'] }), ['pages_show_list', 'pages_messaging']);
  assert.deepEqual(facebookOAuth.missingPagePermissions({ permissions: ['pages_manage_metadata', 'pages_messaging', 'pages_show_list'] }), []);
  assert.deepEqual(facebookOAuth.missingOptionalPagePermissions({ permissions: ['pages_manage_metadata', 'pages_messaging', 'pages_show_list'] }), ['pages_read_engagement']);
  assert.deepEqual(facebookOAuth.missingOptionalPagePermissions({ permissions: ['pages_manage_metadata', 'pages_messaging', 'pages_show_list', 'pages_read_engagement'] }), []);
});
