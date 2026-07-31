'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeSeal } = require('../../tools/release/create-platform-auth-seal');
const { readSealedFile } = require('../services/releasePlatformAuth');

function fixture() {
  return {
    telegram: { apiId: 12345678, apiHash: 'a'.repeat(32) },
    facebook: {
      oauthBrokerUrl: 'https://auth.example.test',
      relayUrl: 'wss://relay.example.test/facebook',
      graphVersion: 'v25.0'
    }
  };
}

test('release seal tool writes a detached-hash-bound consumer platform configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-auth-seal-'));
  const inputPath = path.join(root, 'private.json');
  const outputDir = path.join(root, 'resources');
  fs.writeFileSync(inputPath, JSON.stringify(fixture()), 'utf8');
  const result = writeSeal(inputPath, outputDir);
  assert.equal(result.status, 'PASS');
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  const loaded = readSealedFile(result.configPath, { hashPath: result.hashPath });
  assert.equal(loaded.sealed, true);
  assert.equal(loaded.telegram.apiId, 12345678);
  assert.equal(Object.hasOwn(loaded.facebook, 'appId'), false);
});

test('release seal tool accepts Telegram-only provisioning and leaves Facebook disabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-auth-seal-telegram-only-'));
  const inputPath = path.join(root, 'private.json');
  fs.writeFileSync(inputPath, JSON.stringify({ telegram: fixture().telegram }), 'utf8');
  const result = writeSeal(inputPath, path.join(root, 'out'));
  assert.equal(result.telegramConfigured, true);
  assert.equal(result.facebookConfigured, false);
  const loaded = readSealedFile(result.configPath, { hashPath: result.hashPath });
  assert.equal(loaded.telegram.apiId, 12345678);
  assert.deepEqual(loaded.facebook, {});
});

test('release seal tool rejects an empty release configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-auth-seal-invalid-'));
  const inputPath = path.join(root, 'private.json');
  fs.writeFileSync(inputPath, JSON.stringify({ telegram: {}, facebook: {} }), 'utf8');
  assert.throws(() => writeSeal(inputPath, path.join(root, 'out')), error => (
    error.code === 'PLATFORM_AUTH_NO_PLATFORM_CONFIGURED'
  ));
});

test('sealed release file fails closed after mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-auth-seal-tamper-'));
  const inputPath = path.join(root, 'private.json');
  const outputDir = path.join(root, 'resources');
  fs.writeFileSync(inputPath, JSON.stringify(fixture()), 'utf8');
  const result = writeSeal(inputPath, outputDir);
  fs.appendFileSync(result.configPath, '\n');
  assert.throws(() => readSealedFile(result.configPath, { hashPath: result.hashPath }), error => error.code === 'PLATFORM_AUTH_HASH_MISMATCH');
});


test('hash-correct but incomplete sealed release file is rejected before packaging or runtime use', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-auth-seal-semantic-'));
  const configPath = path.join(root, 'platform-auth.json');
  const hashPath = path.join(root, 'platform-auth.sha256');
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, releaseManaged: true, telegram: {}, facebook: {} }, null, 2)}
`, 'utf8');
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(configPath, bytes);
  fs.writeFileSync(hashPath, `${digest}  platform-auth.json
`);
  assert.throws(() => readSealedFile(configPath, { hashPath }), error => (
    error.code === 'PLATFORM_AUTH_NO_PLATFORM_CONFIGURED'
  ));
});
