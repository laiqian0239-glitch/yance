'use strict';

function safeCall(target, method) {
  if (!target || typeof target[method] !== 'function') return false;
  try {
    target[method]();
    return true;
  } catch (_) {
    return false;
  }
}

function disposeEventSocket(socket, states = {}) {
  if (!socket) return { disposed: false, action: 'none', initialReadyState: null };
  const initialReadyState = socket.readyState;
  const connecting = states.CONNECTING;
  try { socket.removeAllListeners?.(); } catch (_) {}

  // ws may emit an asynchronous error after terminate()/close(), especially
  // when a CONNECTING socket is aborted. Keep one inert consumer after stale
  // application listeners are removed so controlled restart cannot surface an
  // uncaught process-level error or schedule a stale reconnect.
  try { if (typeof socket.on === 'function') socket.on('error', () => {}); } catch (_) {}

  let action = 'none';
  if (initialReadyState === connecting) {
    if (typeof socket.terminate === 'function') {
      try {
        socket.terminate();
        action = 'terminate-connecting';
      } catch (_) {
        action = safeCall(socket, 'destroy') ? 'destroy-connecting' : 'detach-connecting';
      }
    } else {
      action = safeCall(socket, 'destroy') ? 'destroy-connecting' : 'detach-connecting';
    }
  } else if (initialReadyState === states.OPEN) {
    action = safeCall(socket, 'close') ? 'close-open' : (safeCall(socket, 'terminate') ? 'terminate-open' : 'detach-open');
  } else if (initialReadyState === states.CLOSING) {
    action = safeCall(socket, 'terminate') ? 'terminate-closing' : (safeCall(socket, 'destroy') ? 'destroy-closing' : 'detach-closing');
  } else if (initialReadyState === states.CLOSED) {
    action = 'already-closed';
  } else if (safeCall(socket, 'destroy')) {
    action = 'destroy-unknown';
  } else if (safeCall(socket, 'close')) {
    action = 'close-unknown';
  } else if (safeCall(socket, 'end')) {
    action = 'end-unknown';
  } else {
    action = 'detach-unknown';
  }

  return { disposed: true, action, initialReadyState };
}

module.exports = { disposeEventSocket };
