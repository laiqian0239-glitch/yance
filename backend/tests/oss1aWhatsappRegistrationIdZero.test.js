'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const baileys = require('@whiskeysockets/baileys');

const { readCredentialState } = require('../services/whatsappAuthResolver');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, baileys.BufferJSON.replacer), 'utf8');
}

function credentialStateForRegistrationId(registrationId) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-registration-id-'));
  try {
    const creds = baileys.initAuthCreds();
    creds.registrationId = registrationId;
    creds.registered = true;
    creds.me = { id: '15551234567:7@s.whatsapp.net', name: 'Legacy Yance' };
    writeJson(path.join(directory, 'creds.json'), creds);
    return readCredentialState(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('Baileys 14-bit registration ID endpoints remain importable complete Signal state', () => {
  for (const registrationId of [0, 16383]) {
    const state = credentialStateForRegistrationId(registrationId);
    assert.equal(state.exists, true);
    assert.equal(state.hasIdentity, true);
    assert.equal(state.registered, true);
    assert.equal(
      state.importable,
      true,
      `registrationId=${registrationId} is inside the Baileys 14-bit domain; reason=${state.reasonCode}`
    );
    assert.equal(state.usable, true);
    assert.equal(state.reasonCode, '');
  }
});

test('registration IDs outside the Baileys 14-bit domain remain non-importable', () => {
  const state = credentialStateForRegistrationId(16384);
  assert.equal(state.exists, true);
  assert.equal(state.hasIdentity, true);
  assert.equal(state.registered, true);
  assert.equal(state.importable, false);
  assert.equal(state.usable, false);
  assert.equal(state.reasonCode, 'WHATSAPP_LEGACY_SIGNAL_STATE_INCOMPLETE');
});
