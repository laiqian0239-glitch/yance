'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadCipherModule() {
  try {
    return require('../security/whatsappAuthCipher');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND'
      && String(error.message || '').includes('whatsappAuthCipher')) {
      assert.fail('WhatsAppAuthCipher production module is missing');
    }
    throw error;
  }
}

function createCipher(cipherModule, key, keyVersion = 1) {
  const options = Object.freeze({
    key: Buffer.from(key),
    keyVersion,
    cipherVersion: 1
  });
  if (typeof cipherModule.createWhatsAppAuthCipher === 'function') {
    return cipherModule.createWhatsAppAuthCipher(options);
  }
  if (typeof cipherModule.WhatsAppAuthCipher === 'function') {
    return new cipherModule.WhatsAppAuthCipher(options);
  }
  if (typeof cipherModule === 'function') {
    return new cipherModule(options);
  }
  assert.fail('whatsappAuthCipher must export a factory or WhatsAppAuthCipher class');
}

function expectCode(code) {
  return error => {
    assert.equal(error?.code, code, error?.stack || String(error));
    return true;
  };
}

function tamper(buffer) {
  const value = Buffer.from(buffer);
  value[0] ^= 0x01;
  return value;
}

test('WhatsAppAuthCipher enforces AEAD, typed AAD, purpose-separated HMAC and close semantics', () => {
  const cipherModule = loadCipherModule();
  const rawKey = Buffer.alloc(32, 0x5a);
  const cipher = createCipher(cipherModule, rawKey, 1);

  for (const method of ['encrypt', 'decrypt', 'hmacIndex', 'close']) {
    assert.equal(typeof cipher?.[method], 'function', `cipher.${method}`);
  }

  const aad = Object.freeze({
    schemaVersion: 23,
    accountKey: 'account-key-hmac',
    accountId: 'account-1',
    currentEpoch: 7
  });
  const plaintext = Buffer.from('{"registered":true,"noiseKey":"secret"}', 'utf8');

  const first = cipher.encrypt('AUTH_CREDS', aad, plaintext);
  const second = cipher.encrypt('AUTH_CREDS', aad, plaintext);

  for (const envelope of [first, second]) {
    assert.equal(envelope.cipherVersion, 1);
    assert.equal(envelope.keyVersion, 1);
    assert.equal(Buffer.isBuffer(envelope.nonce), true);
    assert.equal(envelope.nonce.length, 12);
    assert.equal(Buffer.isBuffer(envelope.ciphertext), true);
    assert.equal(Buffer.isBuffer(envelope.authTag), true);
    assert.equal(envelope.authTag.length, 16);
    assert.match(envelope.ciphertextSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(cipher.decrypt('AUTH_CREDS', aad, envelope), plaintext);
  }

  assert.notDeepEqual(first.nonce, second.nonce, 'every encryption must use a fresh nonce');
  assert.notDeepEqual(first.ciphertext, second.ciphertext, 'fresh nonce must change ciphertext');

  const remoteJidIndex = cipher.hmacIndex('REMOTE_JID', '15551234567@s.whatsapp.net');
  const remoteJidIndexAgain = cipher.hmacIndex('REMOTE_JID', '15551234567@s.whatsapp.net');
  const messageIdIndex = cipher.hmacIndex('MESSAGE_ID', '15551234567@s.whatsapp.net');
  assert.match(remoteJidIndex, /^[a-f0-9]{64}$/u);
  assert.equal(remoteJidIndexAgain, remoteJidIndex);
  assert.notEqual(messageIdIndex, remoteJidIndex, 'index purposes must use separated keys');

  assert.throws(
    () => cipher.encrypt('ARBITRARY_RECORD', aad, plaintext),
    expectCode('WHATSAPP_AUTH_CIPHER_RECORD_TYPE_UNSUPPORTED')
  );
  assert.throws(
    () => cipher.decrypt('AUTH_CREDS', { ...aad, accountId: 'account-2' }, first),
    expectCode('WHATSAPP_AUTH_CIPHER_AUTHENTICATION_FAILED')
  );
  assert.throws(
    () => cipher.decrypt('AUTH_CREDS', { ...aad, currentEpoch: 8 }, first),
    expectCode('WHATSAPP_AUTH_CIPHER_AUTHENTICATION_FAILED')
  );
  assert.throws(
    () => cipher.decrypt('AUTH_CREDS', aad, { ...first, ciphertext: tamper(first.ciphertext) }),
    expectCode('WHATSAPP_AUTH_CIPHER_AUTHENTICATION_FAILED')
  );
  assert.throws(
    () => cipher.decrypt('AUTH_CREDS', aad, { ...first, authTag: tamper(first.authTag) }),
    expectCode('WHATSAPP_AUTH_CIPHER_AUTHENTICATION_FAILED')
  );
  assert.throws(
    () => cipher.decrypt('AUTH_CREDS', aad, { ...first, keyVersion: 2 }),
    expectCode('WHATSAPP_AUTH_CIPHER_KEY_VERSION_UNSUPPORTED')
  );

  const snapshot = typeof cipher.snapshot === 'function' ? cipher.snapshot() : {};
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(rawKey.toString('base64')), false);
  assert.equal(serialized.includes('noiseKey'), false);

  cipher.close();
  assert.throws(
    () => cipher.encrypt('AUTH_CREDS', aad, plaintext),
    expectCode('WHATSAPP_AUTH_CIPHER_CLOSED')
  );
  assert.throws(
    () => cipher.hmacIndex('REMOTE_JID', 'value'),
    expectCode('WHATSAPP_AUTH_CIPHER_CLOSED')
  );
});
