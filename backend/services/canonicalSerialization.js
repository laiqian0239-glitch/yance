'use strict';

const crypto = require('node:crypto');

const CANONICALIZATION_VERSION = 1;

function canonicalError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizePaths(values) {
  if (values == null) return new Set();
  if (!Array.isArray(values) && !(values instanceof Set)) {
    throw canonicalError('CANONICAL_PATHS_INVALID', 'Canonical path options must be an array or Set');
  }
  return new Set([...values].map(value => String(value || '').trim()).filter(Boolean));
}

function canonicalNumber(value, path) {
  if (!Number.isFinite(value)) {
    throw canonicalError('CANONICAL_NUMBER_NON_FINITE', 'Canonical numbers must be finite', { fieldPath: path });
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw canonicalError('CANONICAL_INTEGER_UNSAFE', 'Canonical integers must be within the safe integer range', { fieldPath: path });
  }
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

function canonicalTimestamp(value, path) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) {
    throw canonicalError('CANONICAL_TIMESTAMP_INVALID', 'Canonical timestamp is invalid', { fieldPath: path });
  }
  return new Date(milliseconds).toISOString();
}

function childPath(parent, key) {
  return parent === '$' ? `$.${key}` : `${parent}.${key}`;
}

function arrayPath(parent, index) {
  return `${parent}[${index}]`;
}

function encode(value, path, context) {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'string') {
    const normalized = context.timestampPaths.has(path) ? canonicalTimestamp(value, path) : value;
    return JSON.stringify(normalized);
  }
  if (type === 'number') return canonicalNumber(value, path);
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    throw canonicalError('CANONICAL_TYPE_FORBIDDEN', `Canonical value type ${type} is forbidden`, { fieldPath: path, valueType: type });
  }

  if (value instanceof Date) return JSON.stringify(canonicalTimestamp(value, path));
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw canonicalError('CANONICAL_BINARY_FORBIDDEN', 'Inline binary values are forbidden in canonical serialization', { fieldPath: path });
  }
  if (context.seen.has(value)) {
    throw canonicalError('CANONICAL_CYCLE_FORBIDDEN', 'Canonical values cannot contain cycles', { fieldPath: path });
  }

  context.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const encoded = value.map((item, index) => encode(item, arrayPath(path, index), context));
      if (!context.setLikePaths.has(path)) return `[${encoded.join(',')}]`;
      const unique = [...new Set(encoded)].sort((left, right) => left.localeCompare(right));
      return `[${unique.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw canonicalError('CANONICAL_NON_PLAIN_OBJECT_FORBIDDEN', 'Canonical values must use plain objects', { fieldPath: path });
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort((left, right) => left.localeCompare(right));
    const entries = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      const fieldPath = childPath(path, key);
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        throw canonicalError('CANONICAL_ACCESSOR_FORBIDDEN', 'Canonical values cannot contain accessors', { fieldPath });
      }
      entries.push(`${JSON.stringify(key)}:${encode(descriptor.value, fieldPath, context)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    context.seen.delete(value);
  }
}

function canonicalSerialize(value, options = {}) {
  const version = options.version == null ? CANONICALIZATION_VERSION : Number(options.version);
  if (!Number.isInteger(version) || version < 1) {
    throw canonicalError('CANONICALIZATION_VERSION_INVALID', 'Canonicalization version must be a positive integer', { version: options.version });
  }
  return encode(value, '$', {
    version,
    timestampPaths: normalizePaths(options.timestampPaths),
    setLikePaths: normalizePaths(options.setLikePaths),
    seen: new WeakSet()
  });
}

function canonicalHash(value, options = {}) {
  const version = options.version == null ? CANONICALIZATION_VERSION : Number(options.version);
  const serialized = canonicalSerialize(value, { ...options, version });
  return crypto.createHash('sha256').update(`yance-canonical-v${version}\n${serialized}`, 'utf8').digest('hex');
}

module.exports = {
  CANONICALIZATION_VERSION,
  canonicalSerialize,
  canonicalHash,
  canonicalError
};
