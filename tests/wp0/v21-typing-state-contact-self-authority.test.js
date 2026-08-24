'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerRuntimeStateCommands
} = require('../../backend/store/commands/registerRuntimeStateCommands');

const NOW = '2026-08-24T04:30:00.000Z';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness() {
  const commands = new Map();
  registerRuntimeStateCommands({
    registerCommand(name, handler) {
      commands.set(name, handler);
    }
  });

  function execute(name, state, payload) {
    const handler = commands.get(name);
    assert.equal(typeof handler, 'function', `${name} must be registered`);
    const result = handler({
      command: { payload },
      cloneState: () => clone(state),
      now: () => NOW,
      fail(code, message) {
        const error = new Error(message);
        error.code = code;
        throw error;
      }
    });
    assert.ok(result?.nextState, `${name} must return nextState`);
    return result.nextState;
  }

  return { execute };
}

function emptyState() {
  return {
    typingState: {
      byContactId: {},
      policy: { inboundTtlMs: 3000 }
    }
  };
}

test('self typing updates cannot overwrite contact-owned top-level identity aliases', () => {
  const { execute } = createHarness();
  const contactId = 'contact-1';

  const afterContact = execute('UPDATE_CONTACT_TYPING_STATE', emptyState(), {
    contactId,
    conversationId: 'conversation-contact',
    accountId: 'account-contact',
    platform: 'whatsapp',
    isTyping: true,
    lastUpdated: NOW
  });

  const afterSelf = execute('UPDATE_SELF_TYPING_STATE', afterContact, {
    contactId,
    conversationId: 'conversation-self',
    accountId: 'account-self',
    platform: 'desktop-self',
    isTyping: true,
    phase: 'composing',
    lastUpdated: NOW
  });

  const row = afterSelf.typingState.byContactId[contactId];
  assert.equal(row.contact.conversationId, 'conversation-contact');
  assert.equal(row.self.conversationId, 'conversation-self');
  assert.equal(row.conversationId, 'conversation-contact');
  assert.equal(row.accountId, 'account-contact');
  assert.equal(row.platform, 'whatsapp');
});

test('self-only typing updates do not manufacture contact-owned top-level identity aliases', () => {
  const { execute } = createHarness();
  const contactId = 'contact-self-only';

  const nextState = execute('UPDATE_SELF_TYPING_STATE', emptyState(), {
    contactId,
    conversationId: 'conversation-self',
    accountId: 'account-self',
    platform: 'desktop-self',
    isTyping: true,
    phase: 'composing',
    lastUpdated: NOW
  });

  const row = nextState.typingState.byContactId[contactId];
  assert.equal(row.self.conversationId, 'conversation-self');
  assert.equal(row.self.accountId, 'account-self');
  assert.equal(row.self.platform, 'desktop-self');
  assert.equal(row.conversationId, '');
  assert.equal(row.accountId, '');
  assert.equal(row.platform, '');
});
