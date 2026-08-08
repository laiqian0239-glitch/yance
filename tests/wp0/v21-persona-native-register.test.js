'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const ADAPTER = path.join(ROOT, 'backend/personaBrain/sillyTavernAdapter.js');
function loadAdapter() { assert.equal(fs.existsSync(ADAPTER), true, 'missing thin SillyTavern Persona adapter'); return require(ADAPTER); }
for (const locale of ['de-DE', 'de-AT']) {
  test(`V21 Persona P0: ${locale} native WhatsApp register rejects translationese and assistant-style prose`, () => {
    const adapter = loadAdapter();
    assert.equal(typeof adapter.buildNativeRegisterContract, 'function');
    const contract = adapter.buildNativeRegisterContract({ locale, channel: 'whatsapp' });
    assert.equal(contract.locale, locale); assert.equal(contract.channel, 'whatsapp'); assert.equal(contract.register, 'native_short_form'); assert.equal(contract.maxQuestions, 1);
    assert.ok(contract.prefer.some(rule => /kurz|natürlich|chat/i.test(rule)));
    const forbidden = contract.reject.join(' | ').toLowerCase();
    for (const marker of ['translationese', 'customer-service', 'email', 'over-explaining', 'repeated questions', 'emoji overuse', 'neediness', 'assistant clichés']) assert.ok(forbidden.includes(marker), `native register must reject ${marker}`);
  });
}
test('V21 Persona P0: nationality and age do not select a Persona template', () => {
  const adapter = loadAdapter();
  const young = adapter.buildNativeRegisterContract({ locale: 'de-DE', channel: 'whatsapp', age: 22, nationality: 'German' });
  const older = adapter.buildNativeRegisterContract({ locale: 'de-DE', channel: 'whatsapp', age: 58, nationality: 'Austrian' });
  assert.deepEqual(young, older);
});
