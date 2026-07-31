'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contactContextAuthority = require('../services/contactContextAuthority');
const customerSocialSelectors = require('../store/selectors/customerSocialSelectors');

function runtimeState(contactId = 'contact-real') {
  return {
    meta: { stateVersion: 7, domainVersions: { routing: 1 } },
    customers: {
      ready: true,
      byId: { [contactId]: { id: contactId, contactId, displayName: 'Peter Jotterand', accountId: 'te-1', platform: 'telegram', version: 1 } }
    },
    relationships: { ready: true, byContactId: { [contactId]: { version: 1, timeline: [], signals: [] } } },
    memories: { ready: true, byContactId: { [contactId]: { version: 1, preferences: {} } } },
    interactionPolicies: { ready: true, byContactId: { [contactId]: { version: 1, policy: 'reply_normally', allowReplies: true } } },
    conversations: { byContactId: { [contactId]: [] }, byId: {}, recentMessagesById: {} },
    auth: { accountsById: { 'te-1': { canSend: true } } }
  };
}

test('production social selector factory is evaluated instead of returned as a function', () => {
  contactContextAuthority.setSelector(customerSocialSelectors);
  const state = runtimeState();
  const storeManager = { select: selector => selector(state) };
  const context = contactContextAuthority.getSocialContext('contact-real', { storeManager });
  assert.equal(typeof context, 'object');
  assert.equal(context.found, true);
  assert.equal(context.ready, true);
  assert.equal(context.customer.displayName, 'Peter Jotterand');
});
