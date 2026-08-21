'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActiveContactStore, CANONICAL_EVENT, LEGACY_EVENT } = require('../../frontend/js/r32-active-contact-store');

class CustomEventShim {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}

function harness() {
  const events = [];
  const eventTarget = { CustomEvent: CustomEventShim, dispatchEvent: event => { events.push(event); return true; } };
  let tick = 0;
  const store = createActiveContactStore({ eventTarget, now: () => `t${++tick}` });
  store.setAvailableContacts([
    { id: 'c1', name: 'Ada', archived: false },
    { id: 'c2', name: 'Bea', archived: false },
    { id: 'c3', name: 'Archived', archived: true }
  ]);
  return { store, events };
}

test('canonical selection emits one standard event and no legacy event by default', () => {
  const h = harness();
  const result = h.store.setActiveContact('c1', { source: 'conversation', view: 'conversation' });
  assert.equal(result.changed, true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, CANONICAL_EVENT);
  assert.equal(h.events[0].detail.current.contactId, 'c1');
  assert.equal(h.store.getSnapshot().revision, 1);
});

test('unchanged selection is deduplicated', () => {
  const h = harness();
  h.store.setActiveContact('c1', { source: 'conversation' });
  const second = h.store.setActiveContact('c1', { source: 'profile' });
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'unchanged');
  assert.equal(h.events.length, 1);
});

test('legacy compatibility event is explicit and bound to canonical revision', () => {
  const h = harness();
  h.store.setActiveContact('c2', { source: 'contacts', emitLegacy: true, readSynced: true });
  assert.deepEqual(h.events.map(event => event.type), [CANONICAL_EVENT, LEGACY_EVENT]);
  assert.equal(h.events[1].detail.contactId, 'c2');
  assert.equal(h.events[1].detail.readSynced, true);
  assert.equal(h.events[1].detail.canonicalRevision, 1);
});

test('archived and unknown contacts fail closed unless explicitly allowed', () => {
  const h = harness();
  assert.equal(h.store.setActiveContact('c3', { source: 'conversation' }).reason, 'archived-contact');
  assert.equal(h.store.setActiveContact('missing', { source: 'conversation' }).reason, 'unknown-contact');
  assert.equal(h.store.setActiveContact('c3', { source: 'archive', allowArchived: true }).changed, true);
});

test('contact removal falls back to the first active contact', () => {
  const h = harness();
  h.store.setActiveContact('c2', { source: 'conversation' });
  h.store.setAvailableContacts([{ id: 'c1', archived: false }]);
  assert.equal(h.store.getSnapshot().contactId, 'c1');
  assert.equal(h.store.getSnapshot().reason, 'active-contact-removed');
});

test('subscribers observe immutable snapshots', () => {
  const h = harness();
  const snapshots = [];
  const unsubscribe = h.store.subscribe(state => snapshots.push(state));
  h.store.setActiveContact('c1', { source: 'conversation' });
  unsubscribe();
  h.store.setActiveContact('c2', { source: 'conversation' });
  assert.equal(snapshots.length, 1);
  assert.equal(Object.isFrozen(snapshots[0]), true);
  assert.equal(snapshots[0].contactId, 'c1');
});

test('active conversation resolution is exact even when multiple conversations share one contact', () => {
  const h = harness();
  h.store.setActiveContact('c1', { source: 'conversation' });
  const selection = h.store.resolveConversation({
    conversations: {
      byId: {
        c1: { id: 'c1', contactId: 'person-1' },
        c2: { id: 'c2', contactId: 'person-1' }
      }
    }
  });
  assert.deepEqual(selection, {
    found: true,
    requestedConversationId: 'c1',
    conversationId: 'c1',
    contactId: 'person-1',
    reason: 'exact-conversation'
  });
  assert.equal(Object.isFrozen(selection), true);
});

test('active conversation resolution never falls back to another conversation for the same contact', () => {
  const h = harness();
  h.store.setActiveContact('c1', { source: 'conversation' });
  const missingExact = h.store.resolveConversation({
    conversations: {
      byId: {
        c2: { id: 'c2', contactId: 'person-1' }
      }
    }
  });
  assert.deepEqual(missingExact, {
    found: false,
    requestedConversationId: 'c1',
    conversationId: '',
    contactId: '',
    reason: 'exact-conversation-not-found'
  });
});
