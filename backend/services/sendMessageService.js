'use strict';

/**
 * P0-A AC-018 — SendMessageService (stable unified send contract).
 *
 * The real per-platform dispatch already lives in platformMessagingService.js
 * (text/media/reaction/revoke/presence/read). This module is the canonical,
 * NAMED contract for internal send callers and adds a single `send({ type })` dispatcher.
 *
 * Compatibility: existing callers (accountManager -> sendQueue -> platformMessaging,
 * accountContext -> platformMessaging.*) keep working unchanged. New code should call
 * sendMessageService.send(...) / sendMessageService.sendText(...) so the contract is explicit.
 *
 * The registry is injectable (setRegistry) so the contract is testable without loading
 * the heavy platform adapters.
 */

function clean(value, fallback = '') {
  return value == null ? fallback : String(value).trim();
}

let registry = null;

function loadRegistry() {
  if (!registry) {
    const pm = require('./platformMessagingService');
    registry = {
      text: pm.sendText,
      media: pm.sendMedia,
      reaction: pm.sendReaction,
      revoke: pm.revokeMessage,
      native_expression: pm.sendNativeExpression,
      presence: pm.sendPresence,
      read: pm.markRead,
      _pm: pm,
    };
  }
  return registry;
}

// Test/compat seam: replace the dispatch table.
// When setRegistry wraps a custom registry, preserve _pm so delegate() works.
function setRegistry(custom) {
  registry = custom
    ? { ...custom, _pm: custom }
    : null;
  return registry;
}

// Test seam: reset registry to null (forces loadRegistry on next call).
// Each test file is responsible for cleaning up after itself.
function resetRegistry() {
  registry = null;
}

// Test seam: snapshot / restore the registry so async callbacks can re-apply their mock.
function getRegistry() { return registry; }
function updateRegistry(fn) { registry = fn(registry); }

async function send(input = {}) {
  const reg = registry || loadRegistry();
  const type = clean(input.type || input.operation).toLowerCase();
  const fn = reg[type];
  if (typeof fn !== 'function') {
    const e = new Error('unsupported send type: ' + (type || 'undefined'));
    e.code = 'SEND_TYPE_UNSUPPORTED';
    e.status = 400;
    throw e;
  }
  return fn(input);
}

function delegate(name) {
  return (...args) => (registry || loadRegistry())._pm[name](...args);
}

module.exports = {
  send,
  setRegistry,
  resetRegistry,
  getRegistry,
  updateRegistry,
  // stable re-exported surface (the SendMessageService API)
  resolveAccount: delegate('resolveAccount'),
  externalTarget: delegate('externalTarget'),
  sendText: delegate('sendText'),
  sendMedia: delegate('sendMedia'),
  sendReaction: delegate('sendReaction'),
  revokeMessage: delegate('revokeMessage'),
  sendNativeExpression: delegate('sendNativeExpression'),
  sendPresence: delegate('sendPresence'),
  markRead: delegate('markRead'),
};
