'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const KEY_REFERENCE = 'whatsapp-auth-data-key:v1';
const KEY_PURPOSE = 'WHATSAPP_AUTH_AND_RETRY_PROJECTION';

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function loadAuthorityModule() {
  try {
    return require('../services/whatsappAuthKeyAuthority');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('whatsappAuthKeyAuthority')) {
      assert.fail(
        'CredentialVault-backed WhatsAppAuthKeyAuthority production module is missing'
      );
    }
    throw error;
  }
}

function createAuthority(authorityModule, securityGuard) {
  const options = Object.freeze({
    securityGuard,
    credentials: securityGuard.credentials
  });
  if (typeof authorityModule.createWhatsAppAuthKeyAuthority === 'function') {
    return authorityModule.createWhatsAppAuthKeyAuthority(options);
  }
  if (typeof authorityModule.WhatsAppAuthKeyAuthority === 'function') {
    return new authorityModule.WhatsAppAuthKeyAuthority(options);
  }
  if (typeof authorityModule === 'function') {
    return new authorityModule(options);
  }
  assert.fail(
    'whatsappAuthKeyAuthority must export a factory or WhatsAppAuthKeyAuthority class'
  );
}

function createCredentialFixture() {
  const values = new Map();
  const calls = {
    get: 0,
    persist: 0
  };
  const credentials = Object.freeze({
    get(ref, context = {}) {
      calls.get += 1;
      assert.equal(ref, KEY_REFERENCE);
      assert.equal(context.actor, 'backend-core');
      return copy(values.get(ref) || null);
    },
    has(ref) {
      return values.has(ref);
    },
    listRefs() {
      return [...values.keys()];
    },
    async persist(ref, value, context = {}) {
      calls.persist += 1;
      assert.equal(ref, KEY_REFERENCE);
      assert.equal(context.actor, 'backend-core');
      await Promise.resolve();
      values.set(ref, copy(value));
      return true;
    },
    async remove(ref) {
      return values.delete(ref);
    }
  });
  const securityGuard = Object.freeze({
    available: true,
    credentials,
    snapshot() {
      return Object.freeze({
        module: 'SecurityGuard',
        ready: true,
        secureStorageAvailable: true
      });
    }
  });
  return {
    securityGuard,
    calls,
    read(ref = KEY_REFERENCE) {
      return copy(values.get(ref) || null);
    }
  };
}

function assertAuthorityInterface(authority) {
  for (const method of ['prepare', 'start', 'getCipher', 'rotate', 'stop', 'snapshot']) {
    assert.equal(typeof authority?.[method], 'function', method);
  }
}

test('CredentialVault key authority single-flights creation and never exposes the raw DEK', async () => {
  const authorityModule = loadAuthorityModule();
  const fixture = createCredentialFixture();
  const authority = createAuthority(authorityModule, fixture.securityGuard);
  assertAuthorityInterface(authority);

  await authority.prepare();
  const [firstStart, secondStart] = await Promise.all([
    authority.start(),
    authority.start()
  ]);

  assert.equal(fixture.calls.persist, 1, 'concurrent starts must share one vault persist');
  assert.ok(fixture.calls.get >= 2, 'authority must re-read the vault after persist');

  const stored = fixture.read();
  assert.equal(stored.algorithm, 'AES-256-GCM');
  assert.equal(stored.keyVersion, 1);
  assert.equal(stored.purpose, KEY_PURPOSE);
  assert.equal(Buffer.from(stored.keyBase64, 'base64').length, 32);
  assert.equal(Number.isFinite(Date.parse(stored.createdAt)), true);

  for (const result of [firstStart, secondStart]) {
    assert.equal(Buffer.isBuffer(result), false, 'start must not return a raw key Buffer');
    if (result && typeof result === 'object') {
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'keyBase64'), false);
    }
  }

  const cipher = authority.getCipher();
  assert.ok(cipher && typeof cipher === 'object');
  for (const method of ['encrypt', 'decrypt', 'hmacIndex', 'close']) {
    assert.equal(typeof cipher[method], 'function', `cipher.${method}`);
  }

  const snapshot = authority.snapshot();
  const serializedSnapshot = JSON.stringify(snapshot);
  assert.equal(serializedSnapshot.includes('keyBase64'), false);
  assert.equal(serializedSnapshot.includes(stored.keyBase64), false);
});

require('./oss1aWhatsappAuthCipher.test');
