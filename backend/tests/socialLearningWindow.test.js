'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { selectCustomerSocialContext } = require('../store/selectors/customerSocialSelectors');
const { inferInteractionPreferences } = require('../store/social/preferenceLearningEngine');
const { RECENT_SOCIAL_MESSAGE_LIMIT } = require('../store/social/learningPolicy');

test('social learning uses one 60-message window before and after restart', () => {
  assert.equal(RECENT_SOCIAL_MESSAGE_LIMIT, 60);
  const adapter = new SqliteStorePersistenceAdapter({ store: { db: {} } });
  assert.equal(adapter.recentMessageLimit, 60);

  const messages = Array.from({ length: 80 }, (_, index) => ({
    id: `m-${index + 1}`,
    direction: 'inbound',
    fromMe: false,
    text: index < 20 ? 'This old message should be outside the learning window and is intentionally very long.' : 'ok',
    sentAt: `2026-07-16T00:${String(index).padStart(2, '0')}:00.000Z`
  }));
  const preferences = inferInteractionPreferences(messages, {});
  assert.equal(preferences.evidenceCount, 60);
  assert.equal(preferences.preferredLength, 'short');

  const state = {
    meta: { stateVersion: 1, domainVersions: { routing: 1 } },
    customers: { ready: true, byId: { c1: { id: 'c1', version: 1 } } },
    relationships: { ready: true, byContactId: { c1: { version: 1 } } },
    memories: { ready: true, byContactId: { c1: { version: 1, preferences: {} } } },
    interactionPolicies: { ready: true, byContactId: { c1: { version: 1 } } },
    conversations: {
      byContactId: { c1: ['conv-1'] },
      byId: { 'conv-1': { id: 'conv-1' } },
      recentMessagesById: { 'conv-1': messages }
    },
    auth: { accountsById: {} }
  };
  const selected = selectCustomerSocialContext('c1')(state);
  assert.equal(selected.recentMessages.length, 60);
  assert.equal(selected.recentMessages[0].id, 'm-21');
});


test('store route and frontend client default to the same 60-message window', () => {
  const root = path.resolve(__dirname, '../..');
  const route = fs.readFileSync(path.join(root, 'backend/routes/store.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'frontend/js/r32-store-client.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(route, /recentMessageLimit \|\| 60/);
  assert.match(client, /const cacheKey = `\$\{id\}:\$\{Number\(options\.timelineLimit \|\| 24\)\}:\$\{Number\(options\.recentMessageLimit \|\| 60\)\}`/);
  assert.match(client, /recentMessageLimit: String\(options\.recentMessageLimit \|\| 60\)/);
  assert.match(client, /storeSocialContext\(\{ contactId: id, timelineLimit: options\.timelineLimit \|\| 24, recentMessageLimit: options\.recentMessageLimit \|\| 60 \}\)/);
  assert.match(runtime, /recentMessageLimit:60/);
  assert.doesNotMatch(route, /recentMessageLimit \|\| 36/);
  assert.doesNotMatch(client, /recentMessageLimit \|\| 36/);
});
