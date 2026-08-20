'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function activeSelection(state = {}, requestedConversationId = '') {
  const conversationId = clean(requestedConversationId);
  if (!conversationId) {
    return { found: false, conversationId: '', contactId: '', reason: 'no-active-conversation' };
  }
  const conversation = state.conversations?.byId?.[conversationId] || null;
  if (!conversation) {
    return { found: false, conversationId: '', contactId: '', reason: 'exact-conversation-not-found' };
  }
  if (conversation.archived === true || clean(conversation.archivedAt)) {
    return { found: false, conversationId: '', contactId: '', reason: 'active-conversation-archived' };
  }
  const contactId = clean(conversation.contactId || conversation.customerId);
  if (!contactId) {
    return { found: false, conversationId: '', contactId: '', reason: 'active-conversation-contact-missing' };
  }
  const customer = state.customers?.byId?.[contactId] || null;
  if (!customer) {
    return { found: false, conversationId: '', contactId: '', reason: 'active-customer-not-found' };
  }
  const activeIds = new Set(Array.isArray(state.customers?.activeIds) ? state.customers.activeIds.map(clean) : []);
  if (customer.archived === true || clean(customer.archivedAt) || !activeIds.has(contactId)) {
    return { found: false, conversationId: '', contactId: '', reason: 'active-customer-ineligible' };
  }
  return { found: true, conversationId, contactId, reason: 'exact-conversation' };
}

function registerActiveSelectionCommands(storeManager) {
  if (!storeManager?.registerCommand) throw new TypeError('storeManager is required');
  storeManager.registerCommand('SET_ACTIVE_CONVERSATION', ({ command, state, cloneState }) => {
    const selection = activeSelection(state, command.payload?.conversationId || command.payload?.sessionKey);
    const previousConversationId = clean(state.conversations?.currentId);
    const previousContactId = clean(state.customers?.currentId);
    const nextConversationId = selection.found ? selection.conversationId : '';
    const nextContactId = selection.found ? selection.contactId : '';
    if (previousConversationId === nextConversationId && previousContactId === nextContactId) {
      return { noop: true, result: { ...selection, mirrored: false } };
    }
    const nextState = cloneState();
    nextState.conversations.currentId = nextConversationId;
    nextState.customers.currentId = nextContactId;
    return {
      nextState,
      ephemeral: true,
      changedDomains: ['customers', 'conversations'],
      result: { ...selection, mirrored: true },
      events: {
        type: 'workspace.activeSelection.mirrored',
        domain: 'customers',
        entityId: nextContactId,
        changedPaths: ['conversations.currentId', 'customers.currentId'],
        payload: {
          found: selection.found,
          conversationId: nextConversationId,
          contactId: nextContactId,
          reason: selection.reason
        }
      }
    };
  });
  return storeManager;
}

module.exports = { registerActiveSelectionCommands, activeSelection };
