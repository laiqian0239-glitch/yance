'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function emptyTypingState(contactId = '') {
  return {
    contactId: clean(contactId),
    isTyping: false,
    lastUpdated: '',
    expiresAt: '',
    activity: 'paused',
    conversationId: '',
    platform: '',
    accountId: '',
    contact: {
      isTyping: false,
      lastUpdated: '',
      expiresAt: '',
      activity: 'paused'
    },
    self: {
      isTyping: false,
      lastUpdated: '',
      expiresAt: '',
      activity: 'paused',
      phase: ''
    }
  };
}

function selectContactTypingState(contactId) {
  const id = clean(contactId);
  return state => state.typingState?.byContactId?.[id] || emptyTypingState(id);
}

function selectConversationTypingState(contactId, conversationId = '') {
  const id = clean(contactId);
  const expectedConversationId = clean(conversationId);
  return state => {
    const row = state.typingState?.byContactId?.[id] || emptyTypingState(id);
    if (expectedConversationId && row.conversationId && row.conversationId !== expectedConversationId) {
      return emptyTypingState(id);
    }
    return row;
  };
}

module.exports = {
  emptyTypingState,
  selectContactTypingState,
  selectConversationTypingState
};
