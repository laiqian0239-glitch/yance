'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
function projectMessage(input = {}) {
  const message = input.message && typeof input.message === 'object' ? input.message : input;
  const fromMe = bool(message.fromMe) || clean(message.direction).toLowerCase() === 'outbound';
  return {
    id: clean(message.id || message.dedupeKey),
    platform: clean(message.platform).toLowerCase(),
    sourceAccountId: clean(message.sourceAccountId || message.accountId),
    accountId: clean(message.accountId || message.sourceAccountId),
    conversationId: clean(message.conversationId || message.sessionKey),
    externalMessageId: clean(message.externalMessageId || message.messageId || message.id),
    direction: fromMe ? 'outbound' : 'inbound',
    fromMe,
    type: clean(message.type || message.messageType) || 'text',
    text: clean(message.text),
    timestamp: clean(message.timestamp || message.sentAt || message.createdAt)
  };
}
function projectDomainEvent(event = {}) {
  const projection = event.payload?.projection;
  return projection && typeof projection === 'object' && !Array.isArray(projection)
    ? projectMessage(projection)
    : projectMessage(event.payload?.message || event.payload || {});
}
function applyProjectionToMessage(message = {}, projection = {}) {
  const p = projectMessage(projection);
  return {
    ...message,
    id: p.id || message.id,
    dedupeKey: p.id || message.dedupeKey,
    platform: p.platform || message.platform,
    sourceAccountId: p.sourceAccountId || message.sourceAccountId || message.accountId,
    accountId: p.accountId || message.accountId || message.sourceAccountId,
    conversationId: p.conversationId || message.conversationId || message.sessionKey,
    sessionKey: p.conversationId || message.sessionKey || message.conversationId,
    externalMessageId: p.externalMessageId || message.externalMessageId || message.messageId,
    direction: p.direction,
    fromMe: p.fromMe,
    messageType: p.type,
    type: p.type,
    text: p.text,
    timestamp: p.timestamp || message.timestamp || message.sentAt,
    sentAt: p.timestamp || message.sentAt || message.timestamp
  };
}

module.exports = { projectMessage, projectDomainEvent, applyProjectionToMessage };
