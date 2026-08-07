'use strict';

const crypto = require('node:crypto');
const canonicalize = require('./vendor/canonicalize-2.1.0');

function schemaError(message) {
  const error = new Error(message || 'EVIDENCE_SCHEMA_INVALID');
  error.code = 'EVIDENCE_SCHEMA_INVALID';
  return error;
}

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw schemaError();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw schemaError();
    }
  }
}

function assertIJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    assertUnicodeScalarString(value);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw schemaError();
    return;
  }
  if (typeof value !== 'object' || value === undefined) throw schemaError();
  if (ancestors.has(value)) throw schemaError();
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertIJsonValue(item, ancestors);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw schemaError();
    for (const [key, item] of Object.entries(value)) {
      assertUnicodeScalarString(key);
      assertIJsonValue(item, ancestors);
    }
  }
  ancestors.delete(value);
}

function canonicalizeBytes(value) {
  assertIJsonValue(value);
  return Buffer.from(canonicalize(value), 'utf8');
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalSha256(value) {
  return sha256Hex(canonicalizeBytes(value));
}

module.exports = {
  assertIJsonValue,
  canonicalizeBytes,
  canonicalSha256,
  sha256Hex
};
