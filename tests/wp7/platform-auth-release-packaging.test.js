'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeSeal } = require('../../tools/release/create-platform-auth-seal');
const { installReleasePlatformAuth, sha256File } = require('../../tools/wp7/lib');

function makeSeal(root) {
  const inputPath = path.join(root, 'private.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    telegram: { apiId: 12345678, apiHash: 'b'.repeat(32) },
    facebook: {
      oauthBrokerUrl: 'https://auth.example.test',
      relayUrl: 'wss://relay.example.test/facebook',
      graphVersion: 'v25.0'
    }
  }), 'utf8');
  return writeSeal(inputPath, path.join(root, 'sealed'));
}

test('Windows payload packaging installs sealed release-managed platform auth as payload-bound resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-platform-auth-'));
  const seal = makeSeal(root);
  const resources = path.join(root, 'payload', 'resources');
  const result = installReleasePlatformAuth(resources, {
    platformAuthConfigPath: seal.configPath,
    platformAuthHashPath: seal.hashPath,
    requirePlatformAuth: true
  });
  assert.equal(result.configured, true);
  assert.equal(result.sealed, true);
  assert.equal(result.telegramConfigured, true);
  assert.equal(result.facebookConfigured, true);
  assert.equal(result.sha256, sha256File(result.configPath));
  assert.equal(fs.readFileSync(result.hashPath, 'utf8'), `${result.sha256}  platform-auth.json\n`);
});


test('Windows payload packaging accepts a Telegram-only sealed release without falsely enabling Facebook', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-platform-auth-telegram-only-'));
  const inputPath = path.join(root, 'private.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    telegram: { apiId: 87654321, apiHash: 'c'.repeat(32) }
  }), 'utf8');
  const seal = writeSeal(inputPath, path.join(root, 'sealed'));
  const result = installReleasePlatformAuth(path.join(root, 'payload', 'resources'), {
    platformAuthConfigPath: seal.configPath,
    platformAuthHashPath: seal.hashPath,
    requirePlatformAuth: true
  });
  assert.equal(result.configured, true);
  assert.equal(result.telegramConfigured, true);
  assert.equal(result.facebookConfigured, false);
});

test('formal platform-enabled packaging fails closed when release provisioning is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-platform-auth-missing-'));
  assert.throws(() => installReleasePlatformAuth(path.join(root, 'resources'), { requirePlatformAuth: true }), error => error.reasonCode === 'WP7_PLATFORM_AUTH_RELEASE_CONFIG_REQUIRED');
});

test('packaging rejects one-sided platform auth inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-platform-auth-partial-'));
  const seal = makeSeal(root);
  assert.throws(() => installReleasePlatformAuth(path.join(root, 'resources'), { platformAuthConfigPath: seal.configPath }), error => error.reasonCode === 'WP7_PLATFORM_AUTH_RELEASE_CONFIG_INCOMPLETE');
});


test('packaging rejects a hash-correct but semantically incomplete release configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-platform-auth-semantic-'));
  const configPath = path.join(root, 'platform-auth.json');
  const hashPath = path.join(root, 'platform-auth.sha256');
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, releaseManaged: true, telegram: {}, facebook: {} }, null, 2)}
`, 'utf8');
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(configPath, bytes);
  fs.writeFileSync(hashPath, `${digest}  platform-auth.json
`);
  assert.throws(() => installReleasePlatformAuth(path.join(root, 'resources'), {
    platformAuthConfigPath: configPath,
    platformAuthHashPath: hashPath,
    requirePlatformAuth: true
  }), error => error.reasonCode === 'WP7_PLATFORM_AUTH_RELEASE_CONFIG_INVALID');
});
