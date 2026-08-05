'use strict';

let sequence = 0;
const FENCE_STATE = new WeakMap();
const SAFE_DETAIL_FIELDS = Object.freeze([
  'accountId',
  'eventName',
  'operation',
  'phase',
  'reasonCode'
]);
const STALE_CODES = new Set([
  'SESSION_GENERATION_STALE',
  'SOCKET_GENERATION_STALE',
  'WHATSAPP_SESSION_GENERATION_STALE',
  'WHATSAPP_SOCKET_GENERATION_STALE'
]);

function immutableAuthorityDetails(options = {}) {
  return Object.freeze({
    prefix: String(options.prefix || 'session'),
    generation: Number.isInteger(options.generation) ? options.generation : 0,
    epoch: Number.isInteger(options.epoch) ? options.epoch : 0,
    socketToken: typeof options.socketToken === 'string' ? options.socketToken : ''
  });
}

function safeDetails(input = {}) {
  const output = {};
  for (const field of SAFE_DETAIL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, field)) continue;
    const value = input[field];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[field] = value;
    }
  }
  return Object.freeze(output);
}

function isStaleError(error) {
  return STALE_CODES.has(String(error?.code || ''));
}

function createSessionGenerationFence(isAuthoritative = () => true, options = {}) {
  if (typeof isAuthoritative !== 'function') {
    throw new TypeError('Session generation authority predicate must be a function');
  }
  const details = immutableAuthorityDetails(options);
  const token = `${details.prefix}:${Date.now()}:${++sequence}`;
  const state = {
    active: true,
    invalidReason: '',
    writeAttempts: 0,
    successfulWrites: 0,
    quarantinedWrites: 0
  };

  function isCurrent() {
    return state.active && isAuthoritative() === true;
  }

  function assertCurrent(codeOrDetails = 'WHATSAPP_SESSION_GENERATION_STALE', maybeDetails = {}) {
    if (isCurrent()) return token;
    const code = typeof codeOrDetails === 'string'
      ? codeOrDetails
      : 'WHATSAPP_SESSION_GENERATION_STALE';
    const operationDetails = typeof codeOrDetails === 'string'
      ? safeDetails(maybeDetails)
      : safeDetails(codeOrDetails);
    throw Object.assign(
      new Error('Session generation is no longer authoritative'),
      {
        code,
        reasonCode: code,
        sessionGeneration: token,
        invalidReason: state.invalidReason,
        authority: details,
        details: operationDetails
      }
    );
  }

  function invalidate(reason = 'SESSION_REPLACED') {
    if (!state.active) return false;
    state.active = false;
    state.invalidReason = String(reason || 'SESSION_REPLACED');
    return true;
  }

  function snapshot() {
    return Object.freeze({
      token,
      details,
      active: state.active,
      current: isCurrent(),
      invalidReason: state.invalidReason,
      writeAttempts: state.writeAttempts,
      successfulWrites: state.successfulWrites,
      quarantinedWrites: state.quarantinedWrites
    });
  }

  const fence = Object.freeze({
    token,
    details,
    isCurrent,
    assertCurrent,
    invalidate,
    snapshot
  });
  FENCE_STATE.set(fence, state);
  return fence;
}

function createSocketGenerationGuard(fence, isSocketAuthoritative) {
  if (!fence || typeof fence.isCurrent !== 'function' || typeof fence.assertCurrent !== 'function') {
    throw new TypeError('Session generation fence is required');
  }
  if (typeof isSocketAuthoritative !== 'function') {
    throw new TypeError('Socket generation authority predicate must be a function');
  }
  const fenceState = FENCE_STATE.get(fence);
  if (!fenceState) throw new TypeError('Unknown session generation fence');

  function isCurrent() {
    return fence.isCurrent() === true && isSocketAuthoritative() === true;
  }

  function assertCurrent(details = {}) {
    fence.assertCurrent('WHATSAPP_SESSION_GENERATION_STALE', details);
    if (isSocketAuthoritative() === true) return fence.token;
    throw Object.assign(
      new Error('Socket generation is no longer authoritative'),
      {
        code: 'WHATSAPP_SOCKET_GENERATION_STALE',
        reasonCode: 'WHATSAPP_SOCKET_GENERATION_STALE',
        sessionGeneration: fence.token,
        authority: fence.details,
        details: safeDetails(details)
      }
    );
  }

  function quarantineResult(error, details = {}) {
    fenceState.quarantinedWrites += 1;
    return Object.freeze({
      ok: false,
      committed: false,
      quarantined: true,
      reasonCode: String(error?.code || 'WHATSAPP_SESSION_GENERATION_STALE'),
      authority: fence.details,
      details: safeDetails(details)
    });
  }

  async function runWrite(details, writer) {
    if (typeof writer !== 'function') {
      throw new TypeError('Socket generation writer must be a function');
    }
    const operationDetails = safeDetails(details);
    fenceState.writeAttempts += 1;
    try {
      assertCurrent(operationDetails);
    } catch (error) {
      if (isStaleError(error)) return quarantineResult(error, operationDetails);
      throw error;
    }

    let value;
    try {
      value = await writer();
    } catch (error) {
      if (isStaleError(error)) return quarantineResult(error, operationDetails);
      throw error;
    }

    try {
      assertCurrent(operationDetails);
    } catch (error) {
      if (isStaleError(error)) return quarantineResult(error, operationDetails);
      throw error;
    }

    fenceState.successfulWrites += 1;
    return Object.freeze({
      ok: true,
      committed: true,
      quarantined: false,
      reasonCode: '',
      authority: fence.details,
      details: operationDetails,
      value
    });
  }

  function wrap(handler) {
    if (typeof handler !== 'function') throw new TypeError('Socket handler must be a function');
    return (...args) => {
      if (!isCurrent()) return undefined;
      let result;
      try {
        result = handler(...args);
      } catch (error) {
        if (isStaleError(error) || !isCurrent()) return undefined;
        throw error;
      }
      if (!result || typeof result.then !== 'function') return result;
      return Promise.resolve(result).then(value => {
        assertCurrent();
        return value;
      }).catch(error => {
        if (isStaleError(error) || !isCurrent()) return undefined;
        throw error;
      });
    };
  }

  function bind(emitter, eventName, handler) {
    const wrapped = wrap(handler);
    emitter.on(eventName, wrapped);
    return wrapped;
  }

  function snapshot() {
    return Object.freeze({
      ...fence.snapshot(),
      socketCurrent: isSocketAuthoritative() === true
    });
  }

  return Object.freeze({
    details: fence.details,
    isCurrent,
    assertCurrent,
    runWrite,
    wrap,
    bind,
    snapshot
  });
}

module.exports = Object.freeze({
  createSessionGenerationFence,
  createSocketGenerationGuard
});
