'use strict';

const MAX_DEPTH = 18;
const MAX_ARRAY = 512;
const MAX_STRING = 200000;

function clean(value, max = MAX_STRING) { return String(value == null ? '' : value).slice(0, max); }

function encodeValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'bigint') return { __yanceType: 'bigint', value: value.toString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __yanceType: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    try { return { __yanceType: 'long', value: String(value.toString?.() || value.toNumber()) }; }
    catch (_) { return { __yanceType: 'long', value: String(value.toNumber()) }; }
  }
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map(item => encodeValue(item, depth + 1, seen));
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return null;
  seen.add(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || item === undefined) continue;
    const encoded = encodeValue(item, depth + 1, seen);
    if (encoded !== undefined) output[key] = encoded;
  }
  seen.delete(value);
  return output;
}

function decodeValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value.__yanceType === 'bytes') return Buffer.from(String(value.base64 || ''), 'base64');
  if (value.__yanceType === 'bigint') {
    try { return BigInt(String(value.value || '0')); } catch (_) { return 0n; }
  }
  if (value.__yanceType === 'long') {
    const numeric = Number(value.value || 0);
    return Number.isSafeInteger(numeric) ? numeric : String(value.value || '0');
  }
  if (Array.isArray(value)) return value.map(decodeValue);
  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = decodeValue(item);
  return output;
}

function serializeBaileysMessageInfo(info = {}) {
  if (!info || typeof info !== 'object' || !info.message) return null;
  return {
    schemaVersion: 1,
    key: encodeValue(info.key || {}),
    message: encodeValue(info.message || {}),
    messageTimestamp: encodeValue(info.messageTimestamp || 0),
    pushName: clean(info.pushName, 300),
    verifiedBizName: clean(info.verifiedBizName, 300),
    name: clean(info.name, 300),
    participant: clean(info.participant || info.key?.participant, 300),
    storedAt: new Date().toISOString()
  };
}

function reconstructBaileysMessageInfo(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || !envelope.message) return null;
  return {
    key: decodeValue(envelope.key || {}),
    message: decodeValue(envelope.message || {}),
    messageTimestamp: decodeValue(envelope.messageTimestamp || 0),
    pushName: clean(envelope.pushName, 300),
    verifiedBizName: clean(envelope.verifiedBizName, 300),
    name: clean(envelope.name, 300),
    participant: clean(envelope.participant, 300)
  };
}

function hasMediaEnvelope(attachment = {}) {
  return Boolean(attachment?.mediaEnvelope?.message);
}

module.exports = {
  encodeValue,
  decodeValue,
  serializeBaileysMessageInfo,
  reconstructBaileysMessageInfo,
  hasMediaEnvelope
};
