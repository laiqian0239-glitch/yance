'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../services/contactLanguageAuthority');

function fakeStore() {
  const contacts = new Map([[
    'c1',
    {
      id: 'c1', platform: 'whatsapp', account_id: 'wa-a', external_id: 'wa-contact',
      canonical_contact_id: 'customer-1', payload_json: '{}'
    }
  ]]);
  const conversations = new Map([
    ['conv1', { session_key: 'conv1', contact_id: 'c1', platform: 'whatsapp', account_id: 'wa-a', payload_json: JSON.stringify({ chatJid: '491111@s.whatsapp.net' }) }],
    ['conv2', { session_key: 'conv2', contact_id: 'c1', platform: 'telegram', account_id: 'tg-a', payload_json: JSON.stringify({ externalId: 'telegram:9988' }) }]
  ]);
  return {
    contacts,
    conversations,
    db: {
      prepare(sql) {
        if (/FROM r32_conversations WHERE session_key=\?/.test(sql)) return { get: id => conversations.get(id) || null };
        if (/FROM contacts WHERE id=\?/.test(sql)) return { get: id => contacts.get(id) || null };
        if (/UPDATE contacts SET payload_json=\?, updated_at=\? WHERE id=\?/.test(sql)) return {
          run(payloadJson, updatedAt, id) {
            const row = contacts.get(id);
            if (row) contacts.set(id, { ...row, payload_json: payloadJson, updated_at: updatedAt });
          }
        };
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }
  };
}

test('incoming German messages establish a conversation-scoped language authority', () => {
  const store = fakeStore();
  const result = authority.observeMessage({
    id: 'm1', conversationId: 'conv1', direction: 'inbound', text: 'Danke, wir treffen uns morgen.'
  }, { store });
  assert.equal(result.contactId, 'c1');
  assert.equal(result.currentLanguage, 'de');
  assert.equal(result.primaryLanguage, 'de');
  assert.equal(result.platform, 'whatsapp');
  assert.equal(result.sourceAccountId, 'wa-a');
  assert.equal(result.platformContactIdentity, '491111@s.whatsapp.net');
  assert.equal(result.canonicalContactId, 'customer-1');
  assert.equal(result.observed, true);
  assert.equal(authority.targetLanguage({ contactId: 'c1', conversationId: 'conv1' }, { store }), 'de');
});

test('manual language override remains isolated to the selected platform account conversation', () => {
  const store = fakeStore();
  authority.observeMessage({ id: 'm1', conversationId: 'conv1', direction: 'inbound', text: 'Hello, see you tomorrow.' }, { store });
  const manual = authority.setUserOverride({ contactId: 'c1', conversationId: 'conv1' }, 'de', { store });
  authority.observeMessage({ id: 'm2', conversationId: 'conv2', direction: 'inbound', text: 'Thank you.' }, { store });

  const whatsapp = authority.read({ contactId: 'c1', conversationId: 'conv1' }, { store });
  const telegram = authority.read({ contactId: 'c1', conversationId: 'conv2' }, { store });

  assert.equal(manual.userOverride, 'de');
  assert.equal(whatsapp.primaryLanguage, 'de');
  assert.equal(whatsapp.currentLanguage, 'de');
  assert.equal(telegram.primaryLanguage, 'en');
  assert.equal(telegram.currentLanguage, 'en');
  assert.equal(telegram.userOverride, '');
  assert.notEqual(whatsapp.scopeKey, telegram.scopeKey);
  assert.equal(authority.targetLanguage({ contactId: 'c1', conversationId: 'conv1' }, { store }), 'de');
  assert.equal(authority.targetLanguage({ contactId: 'c1', conversationId: 'conv2' }, { store }), 'en');
});

test('re-observing the same message does not inflate language confidence', () => {
  const store = fakeStore();
  const input = { id: 'same-message', conversationId: 'conv1', direction: 'inbound', text: 'Danke, bis morgen.' };
  const first = authority.observeMessage(input, { store });
  const second = authority.observeMessage(input, { store });
  assert.equal(first.counts.de, 1);
  assert.equal(second.counts.de, 1);
  assert.equal(second.duplicateObservation, true);
  assert.equal(second.history.length, 1);
});
