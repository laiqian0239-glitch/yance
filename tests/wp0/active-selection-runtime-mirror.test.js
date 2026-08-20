'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { configureStoreManager } = require('../../backend/store/storeManagerSingleton');
const { registerActiveSelectionCommands, activeSelection } = require('../../backend/store/commands/registerActiveSelectionCommands');
const { StoreProjectionCoordinator } = require('../../backend/core/projections/storeProjectionCoordinator');

const ROOT = path.resolve(__dirname, '../..');

function seedState(overrides = {}) {
  return {
    customers: {
      ready: true,
      byId: {
        'contact-a': { id: 'contact-a', archived: false },
        'contact-b': { id: 'contact-b', archived: false },
        'contact-archived': { id: 'contact-archived', archived: true, archivedAt: '2026-08-20T00:00:00.000Z' }
      },
      activeIds: ['contact-a', 'contact-b'],
      archivedIds: ['contact-archived'],
      currentId: 'contact-a'
    },
    conversations: {
      ready: true,
      byId: {
        'session-a1': { id: 'session-a1', sessionKey: 'session-a1', contactId: 'contact-a', archived: false },
        'session-a2': { id: 'session-a2', sessionKey: 'session-a2', contactId: 'contact-a', archived: false },
        'session-b': { id: 'session-b', sessionKey: 'session-b', contactId: 'contact-b', archived: false },
        'session-archived': { id: 'session-archived', sessionKey: 'session-archived', contactId: 'contact-a', archived: true, archivedAt: '2026-08-20T00:00:00.000Z' },
        'session-customer-archived': { id: 'session-customer-archived', sessionKey: 'session-customer-archived', contactId: 'contact-archived', archived: false }
      },
      byContactId: {
        'contact-a': ['session-a1', 'session-a2', 'session-archived'],
        'contact-b': ['session-b'],
        'contact-archived': ['session-customer-archived']
      },
      recentMessagesById: {},
      currentId: 'session-a1'
    },
    ...overrides
  };
}

async function createManager(seed = seedState()) {
  let transactionCalls = 0;
  const persistence = {
    async loadSnapshot() { return seed; },
    async transaction() { transactionCalls += 1; throw new Error('ephemeral active selection must not persist'); }
  };
  const manager = configureStoreManager({ persistence, replace: true });
  registerActiveSelectionCommands(manager);
  await manager.hydrate();
  return { manager, transactionCalls: () => transactionCalls };
}

function createBus() {
  const bus = new EventEmitter();
  bus.publish = function publish(type, payload = {}) {
    const event = { type, payload };
    this.emit(type, event);
    return event;
  };
  return bus;
}

test('active selection resolves only the exact session key and never scans sibling conversations', () => {
  const state = seedState();
  assert.deepEqual(activeSelection(state, 'session-a2'), {
    found: true,
    conversationId: 'session-a2',
    contactId: 'contact-a',
    reason: 'exact-conversation'
  });
  assert.deepEqual(activeSelection(state, 'missing-session'), {
    found: false,
    conversationId: '',
    contactId: '',
    reason: 'exact-conversation-not-found'
  });
});

test('SET_ACTIVE_CONVERSATION mirrors exact conversation and customer ephemerally', async () => {
  const { manager, transactionCalls } = await createManager();
  const result = await manager.dispatch({
    type: 'SET_ACTIVE_CONVERSATION',
    source: 'test-canonical-selection',
    payload: { conversationId: 'session-b' }
  });
  assert.equal(result.ephemeral, true);
  assert.equal(result.result.found, true);
  assert.equal(manager.select(state => state.conversations.currentId), 'session-b');
  assert.equal(manager.select(state => state.customers.currentId), 'contact-b');
  assert.equal(transactionCalls(), 0);
});

test('unknown, archived, or ineligible exact sessions fail closed by clearing both mirrors', async () => {
  for (const [conversationId, reason] of [
    ['missing-session', 'exact-conversation-not-found'],
    ['session-archived', 'active-conversation-archived'],
    ['session-customer-archived', 'active-customer-ineligible']
  ]) {
    const { manager } = await createManager();
    const result = await manager.dispatch({
      type: 'SET_ACTIVE_CONVERSATION',
      source: 'test-fail-closed',
      payload: { conversationId }
    });
    assert.equal(result.result.found, false);
    assert.equal(result.result.reason, reason);
    assert.equal(manager.select(state => state.conversations.currentId || ''), '');
    assert.equal(manager.select(state => state.customers.currentId || ''), '');
  }
});

test('notification active-session event projects through the exact Store runtime authority', async () => {
  const { manager } = await createManager();
  const eventBus = createBus();
  const coordinator = new StoreProjectionCoordinator({
    eventBus,
    logger: { info() {}, warn() {} },
    workspaceData: { resolveContactForConversation() { return {}; }, getContactContext() { return {}; } },
    modelRegistry: { read() { return { models: [], routes: {} }; } },
    aiTaskRuntimeRegistry: { cancelForContact() {}, cancelAll() {} }
  });
  coordinator.start();
  try {
    eventBus.publish('system:notifications-updated', { activeConversationId: 'session-a2', focused: true });
    await manager.waitForIdle();
    assert.equal(manager.select(state => state.conversations.currentId), 'session-a2');
    assert.equal(manager.select(state => state.customers.currentId), 'contact-a');

    eventBus.publish('system:notifications-updated', { activeConversationId: 'missing-session', focused: true });
    await manager.waitForIdle();
    assert.equal(manager.select(state => state.conversations.currentId || ''), '');
    assert.equal(manager.select(state => state.customers.currentId || ''), '');
  } finally {
    coordinator.stop();
  }
});

test('startup clears persistence ordering guesses before Store ready publication', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend/services/storeManagerService.js'), 'utf8');
  const registerAt = source.indexOf('registerActiveSelectionCommands(storeManager)');
  const hydrateAt = source.indexOf('await storeManager.hydrate()');
  const clearAt = source.indexOf("type: 'SET_ACTIVE_CONVERSATION'");
  const readyAt = source.indexOf("eventBus.publish('store:ready'");
  assert.ok(registerAt > 0 && registerAt < hydrateAt);
  assert.ok(hydrateAt < clearAt && clearAt < readyAt);
});
