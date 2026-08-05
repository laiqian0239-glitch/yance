'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const KEY_REFERENCE = 'whatsapp-auth-data-key:v1';
const KEY_PURPOSE = 'WHATSAPP_AUTH_AND_RETRY_PROJECTION';

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

function validVaultValue(seed = 0x31, overrides = {}) {
  return Object.freeze({
    algorithm: 'AES-256-GCM',
    keyVersion: 1,
    keyBase64: Buffer.alloc(32, seed).toString('base64'),
    createdAt: '2026-08-04T00:00:00.000Z',
    purpose: KEY_PURPOSE,
    ...overrides
  });
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

function createCredentialFixture(options = {}) {
  const values = new Map();
  if (options.initialValue != null) values.set(KEY_REFERENCE, copy(options.initialValue));
  const calls = {
    get: 0,
    persist: 0
  };
  const credentials = Object.freeze({
    get(ref, context = {}) {
      calls.get += 1;
      assert.equal(ref, KEY_REFERENCE);
      assert.equal(context.actor, 'backend-core');
      if (typeof options.getOverride === 'function') {
        const overridden = options.getOverride({ ref, context, calls, values });
        if (overridden !== undefined) return copy(overridden);
      }
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
      if (typeof options.persistOverride === 'function') {
        const overridden = await options.persistOverride({ ref, value, context, calls, values });
        if (overridden !== undefined) return overridden;
      }
      await Promise.resolve();
      values.set(ref, copy(value));
      return true;
    },
    async remove(ref) {
      return values.delete(ref);
    }
  });
  const securityGuard = Object.freeze({
    available: options.available !== false,
    credentials,
    snapshot() {
      return Object.freeze({
        module: 'SecurityGuard',
        ready: true,
        secureStorageAvailable: options.available !== false
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

test('CredentialVault key authority reuses an existing valid key without persisting', async () => {
  const authorityModule = loadAuthorityModule();
  const existing = validVaultValue(0x41);
  const fixture = createCredentialFixture({ initialValue: existing });
  const authority = createAuthority(authorityModule, fixture.securityGuard);

  await authority.prepare();
  const started = await authority.start();

  assert.equal(fixture.calls.persist, 0);
  assert.equal(started.keyVersion, 1);
  assert.equal(started.createdAt, existing.createdAt);
  assert.equal(authority.getCipher().snapshot().keyVersion, 1);
});

test('CredentialVault key authority rejects a conflicting authoritative reread', async () => {
  const authorityModule = loadAuthorityModule();
  let candidate = null;
  const conflictingKey = validVaultValue(0x52).keyBase64;
  const fixture = createCredentialFixture({
    getOverride({ calls }) {
      if (calls.get === 1) return null;
      if (calls.get === 2 && candidate) return { ...candidate, keyBase64: conflictingKey };
      return undefined;
    },
    async persistOverride({ value, values }) {
      candidate = copy(value);
      values.set(KEY_REFERENCE, copy(value));
      return true;
    }
  });
  const authority = createAuthority(authorityModule, fixture.securityGuard);

  await authority.prepare();
  await assert.rejects(
    authority.start(),
    expectCode('WHATSAPP_AUTH_KEY_AUTHORITY_CONFLICT')
  );
  assert.equal(fixture.calls.persist, 1);
  assert.throws(
    () => authority.getCipher(),
    expectCode('WHATSAPP_AUTH_KEY_AUTHORITY_NOT_STARTED')
  );
});

test('CredentialVault key authority stop permanently revokes the old owner capability', async () => {
  const authorityModule = loadAuthorityModule();
  const fixture = createCredentialFixture();
  const authority = createAuthority(authorityModule, fixture.securityGuard);

  await authority.prepare();
  await authority.start();
  const oldCipher = authority.getCipher();
  await authority.stop();

  assert.throws(
    () => oldCipher.hmacIndex('REMOTE_JID', '15551234567@s.whatsapp.net'),
    expectCode('WHATSAPP_AUTH_CIPHER_CLOSED')
  );
  assert.throws(
    () => authority.getCipher(),
    expectCode('WHATSAPP_AUTH_KEY_AUTHORITY_NOT_STARTED')
  );
  await assert.rejects(
    authority.start(),
    expectCode('WHATSAPP_AUTH_KEY_AUTHORITY_STOPPED')
  );
  assert.equal(fixture.calls.persist, 1, 'stopped authority must not create another key');
});

require('./oss1aWhatsappAuthCipher.test');
