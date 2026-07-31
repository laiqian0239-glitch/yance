'use strict';

let sequence = 0;

function createSessionGenerationFence(isAuthoritative = () => true, options = {}) {
  const token = `${String(options.prefix || 'session')}:${Date.now()}:${++sequence}`;
  let active = true;
  let invalidReason = '';

  function isCurrent() {
    return active && isAuthoritative() === true;
  }

  function assertCurrent(code = 'SESSION_GENERATION_STALE', details = {}) {
    if (isCurrent()) return token;
    throw Object.assign(
      new Error('Session generation is no longer authoritative'),
      {
        code,
        sessionGeneration: token,
        invalidReason,
        ...details
      }
    );
  }

  function invalidate(reason = 'SESSION_REPLACED') {
    if (!active) return false;
    active = false;
    invalidReason = String(reason || 'SESSION_REPLACED');
    return true;
  }

  return Object.freeze({ token, isCurrent, assertCurrent, invalidate });
}

function createSocketGenerationGuard(fence, isSocketAuthoritative) {
  function isCurrent() {
    return fence?.isCurrent?.() === true && isSocketAuthoritative() === true;
  }

  function assertCurrent(details = {}) {
    if (isCurrent()) return fence.token;
    throw Object.assign(
      new Error('Socket generation is no longer authoritative'),
      {
        code: 'SOCKET_GENERATION_STALE',
        sessionGeneration: fence?.token || '',
        ...details
      }
    );
  }

  function wrap(handler) {
    return (...args) => {
      if (!isCurrent()) return undefined;
      const result = handler(...args);
      if (!result || typeof result.then !== 'function') return result;
      return result.catch(error => {
        if (error?.code === 'SOCKET_GENERATION_STALE' || !isCurrent()) return undefined;
        throw error;
      });
    };
  }

  function bind(emitter, eventName, handler) {
    const wrapped = wrap(handler);
    emitter.on(eventName, wrapped);
    return wrapped;
  }

  return Object.freeze({ isCurrent, assertCurrent, wrap, bind });
}

module.exports = { createSessionGenerationFence, createSocketGenerationGuard };
