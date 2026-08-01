'use strict';

const REQUIRED_METHODS = Object.freeze([
  'authenticate',
  'restoreSession',
  'readAccountIdentity',
  'backfillContacts',
  'backfillConversations',
  'backfillMessages',
  'subscribeEvents',
  'normalizeEvent',
  'fetchAvatar',
  'fetchMedia',
  'sendMessage',
  'queryDelivery',
  'disconnect'
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function unsafe(message, details = {}) {
  return Object.assign(new Error(message), { code: 'CHANNEL_ADAPTER_BOUNDARY_UNSAFE', status: 400, ...details });
}

function assertPlainData(value, path = '$', seen = new Set(), depth = 0) {
  if (depth > 20) throw unsafe('Channel adapter boundary exceeds maximum depth', { path });
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'function' || typeof value === 'symbol') throw unsafe('Channel adapter boundary contains executable value', { path });
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw unsafe('Channel adapter boundary contains binary value', { path });
  }
  if (value instanceof Date || value instanceof Error || value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) {
    throw unsafe('Channel adapter boundary contains non-plain runtime object', { path });
  }
  if (typeof value !== 'object') throw unsafe('Channel adapter boundary contains unsupported value', { path });
  if (seen.has(value)) throw unsafe('Channel adapter boundary contains a cycle', { path });
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertPlainData(item, `${path}[${index}]`, seen, depth + 1));
      return value;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw unsafe('Channel adapter boundary contains non-plain object', { path });
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (FORBIDDEN_KEYS.has(key)) throw unsafe('Channel adapter boundary contains forbidden key', { path: `${path}.${key}` });
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') throw unsafe('Channel adapter boundary contains accessor', { path: `${path}.${key}` });
      assertPlainData(descriptor.value, `${path}.${key}`, seen, depth + 1);
    }
    return value;
  } finally {
    seen.delete(value);
  }
}

function assertAdapter(platform, adapter) {
  const missing = REQUIRED_METHODS.filter(name => typeof adapter?.[name] !== 'function');
  if (missing.length) {
    throw Object.assign(new Error(`Channel adapter ${String(platform || '')} is incomplete: ${missing.join(', ')}`), {
      code: 'CHANNEL_ADAPTER_CONTRACT_INCOMPLETE', status: 500, platform: String(platform || ''), missing
    });
  }
  return adapter;
}

module.exports = { REQUIRED_METHODS, assertPlainData, assertAdapter };
