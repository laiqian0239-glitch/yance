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

test('Baileys registrationId zero remains importable complete Signal state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-registration-id-zero-'));
  try {
    const creds = baileys.initAuthCreds();
    creds.registrationId = 0;
    creds.registered = true;
    creds.me = { id: '15551234567:7@s.whatsapp.net', name: 'Legacy Yance' };
    writeJson(path.join(directory, 'creds.json'), creds);

    const state = readCredentialState(directory);
    assert.equal(state.exists, true);
    assert.equal(state.hasIdentity, true);
    assert.equal(state.registered, true);
    assert.equal(
      state.importable,
      true,
      `Baileys emits registrationId=0 inside its 14-bit domain; reason=${state.reasonCode}`
    );
    assert.equal(state.usable, true);
    assert.equal(state.reasonCode, '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
