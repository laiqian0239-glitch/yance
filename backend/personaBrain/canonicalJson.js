'use strict';

const crypto = require('crypto');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeKey(key) {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
    throw Object.assign(new Error(`Unsafe object key: ${key}`), { code: 'PERSONA_UNSAFE_KEY' });
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    assertSafeKey(key);
    output[key] = canonicalize(value[key]);
  }
  return output;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = { isPlainObject, assertSafeKey, canonicalize, canonicalStringify, sha256Json, clone };
