'use strict';

let sequence = 0;
const DEFAULT_DRAIN_TIMEOUT_MS = 5000;

function normalizeDrainTimeout(value, fallback = DEFAULT_DRAIN_TIMEOUT_MS) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.max(1, Math.floor(timeoutMs)) : fallback;
}

function createSessionGenerationFence(isAuthoritative = () => true, options = {}) {
  const token = `${String(options.prefix || 'session')}:${Date.now()}:${++sequence}`;
  const defaultDrainTimeoutMs = normalizeDrainTimeout(options.drainTimeoutMs);
  const drainWaiters = new Set();
  let active = true;
  let invalidReason = '';
  let inFlight = 0;

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

  function settleDrains() {
    if (inFlight !== 0 || drainWaiters.size === 0) return;
    for (const waiter of drainWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    drainWaiters.clear();
  }

  function enter() {
    if (!isCurrent()) return null;
    inFlight += 1;
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      inFlight = Math.max(0, inFlight - 1);
      settleDrains();
      return true;
    };
  }

  function drain(input = {}) {
    if (inFlight === 0) return Promise.resolve();
    const timeoutMs = normalizeDrainTimeout(
      typeof input === 'number' ? input : input?.timeoutMs,
      defaultDrainTimeoutMs
    );
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        drainWaiters.delete(waiter);
        reject(Object.assign(
          new Error('Session generation in-flight drain timed out'),
          {
            code: 'SESSION_GENERATION_DRAIN_TIMEOUT',
            sessionGeneration: token,
            invalidReason,
            inFlight,
            timeoutMs
          }
        ));
      }, timeoutMs);
      drainWaiters.add(waiter);
      settleDrains();
    });
  }

  function invalidate(reason = 'SESSION_REPLACED') {
    if (!active) return false;
    active = false;
    invalidReason = String(reason || 'SESSION_REPLACED');
    return true;
  }

  return Object.freeze({ token, isCurrent, assertCurrent, invalidate, enter, drain });
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
      const release = typeof fence?.enter === 'function' ? fence.enter() : () => {};
      if (!release) return undefined;
      let result;
      try {
        result = handler(...args);
      } catch (error) {
        release();
        throw error;
      }
      if (!result || typeof result.then !== 'function') {
        release();
        return result;
      }
      return Promise.resolve(result)
        .catch(error => {
          if (error?.code === 'SOCKET_GENERATION_STALE' || !isCurrent()) return undefined;
          throw error;
        })
        .finally(release);
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
