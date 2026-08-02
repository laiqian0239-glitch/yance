'use strict';

const { canonicalSerialize } = require('./canonicalSerialization');

const CLASSIFICATIONS = Object.freeze({
  PUBLIC_METADATA: 'PUBLIC_METADATA',
  BUSINESS_CONTENT: 'BUSINESS_CONTENT',
  SECRET_REFERENCE: 'SECRET_REFERENCE',
  BINARY_REFERENCE: 'BINARY_REFERENCE'
});

const CLASSIFICATION_VALUES = new Set(Object.values(CLASSIFICATIONS));
const FIELD_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array']);
const SECRET_REFERENCE_KEYS = new Set(['credentialRef', 'generation', 'receiptId', 'scope']);
const BINARY_REFERENCE_KEYS = new Set(['binaryRef', 'sha256', 'size', 'mime', 'lifecycleState']);
const INLINE_BINARY_KEY = /^(?:bytes?|data|base64|buffer|blob|binary|content)$/i;
const SECRET_MATERIAL_KEY = /(?:api[_-]?key|token|secret|password|passwd|cookie|authorization|qr(?:code)?|private[_-]?key|refresh[_-]?token|access[_-]?token|session)/i;
const SECRET_MATERIAL_VALUE = /^(?:sk-[A-Za-z0-9_-]{6,}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i;

function classificationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, code, message, fieldPath) {
  if (!isPlainObject(value)) throw classificationError(code, message, { fieldPath });
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      throw classificationError(code, message, { fieldPath: `${fieldPath}.${key}` });
    }
  }
  return value;
}

function clonePlain(value, fieldPath = '$', seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object') {
    throw classificationError('DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified values must be plain data', { fieldPath });
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw classificationError('DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified values cannot contain inline binary data', { fieldPath });
  }
  if (seen.has(value)) {
    throw classificationError('DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified values cannot contain cycles', { fieldPath });
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => clonePlain(item, `${fieldPath}[${index}]`, seen));
    assertPlainObject(value, 'DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified values must use plain objects', fieldPath);
    const result = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        throw classificationError('DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified values cannot contain accessors', { fieldPath: `${fieldPath}.${key}` });
      }
      result[key] = clonePlain(descriptor.value, `${fieldPath}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function assertType(value, expectedType, fieldPath) {
  let actualType;
  if (Array.isArray(value)) actualType = 'array';
  else if (isPlainObject(value)) actualType = 'object';
  else actualType = typeof value;
  if (actualType !== expectedType) {
    throw classificationError('DATA_CLASSIFICATION_TYPE_MISMATCH', `Classified field ${fieldPath} must be ${expectedType}`, {
      fieldPath,
      expectedType,
      actualType
    });
  }
}

function containsInlineBinary(value, seen = new WeakSet()) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.some(item => containsInlineBinary(item, seen));
    return Object.entries(value).some(([key, item]) => INLINE_BINARY_KEY.test(key) || containsInlineBinary(item, seen));
  } finally {
    seen.delete(value);
  }
}

function validateSecretReference(value, fieldPath) {
  assertPlainObject(value, 'SECRET_REFERENCE_INCOMPLETE', 'Secret references must be plain objects', fieldPath);
  const keys = Object.keys(value);
  const forbiddenKey = keys.find(key => !SECRET_REFERENCE_KEYS.has(key) || SECRET_MATERIAL_KEY.test(key));
  if (forbiddenKey) {
    throw classificationError('SECRET_REFERENCE_MATERIAL_FORBIDDEN', 'Secret material is forbidden; only custody references may be stored', {
      fieldPath: `${fieldPath}.${forbiddenKey}`
    });
  }
  if (keys.some(key => typeof value[key] === 'string' && SECRET_MATERIAL_VALUE.test(value[key]))) {
    throw classificationError('SECRET_REFERENCE_MATERIAL_FORBIDDEN', 'Raw secret-like values are forbidden in secret references', { fieldPath });
  }
  if (
    typeof value.credentialRef !== 'string' || !REFERENCE_PATTERN.test(value.credentialRef) ||
    !Number.isInteger(value.generation) || value.generation < 1 ||
    typeof value.receiptId !== 'string' || value.receiptId.trim() === '' ||
    (value.scope !== undefined && (typeof value.scope !== 'string' || value.scope.trim() === ''))
  ) {
    throw classificationError('SECRET_REFERENCE_INCOMPLETE', 'Secret reference requires credentialRef, positive generation and receiptId', { fieldPath });
  }
  return clonePlain(value, fieldPath);
}

function validateBinaryReference(value, fieldPath) {
  if (containsInlineBinary(value)) {
    throw classificationError('BINARY_REFERENCE_INLINE_DATA_FORBIDDEN', 'Binary references cannot contain inline bytes, buffers or base64 data', { fieldPath });
  }
  assertPlainObject(value, 'BINARY_REFERENCE_INCOMPLETE', 'Binary references must be plain objects', fieldPath);
  const keys = Object.keys(value);
  const inlineKey = keys.find(key => INLINE_BINARY_KEY.test(key));
  if (inlineKey) {
    throw classificationError('BINARY_REFERENCE_INLINE_DATA_FORBIDDEN', 'Binary references cannot contain inline bytes, buffers or base64 data', {
      fieldPath: `${fieldPath}.${inlineKey}`
    });
  }
  const unknownKey = keys.find(key => !BINARY_REFERENCE_KEYS.has(key));
  if (unknownKey) {
    throw classificationError('BINARY_REFERENCE_FIELD_FORBIDDEN', 'Binary reference contains an unregistered field', {
      fieldPath: `${fieldPath}.${unknownKey}`
    });
  }
  if (
    typeof value.binaryRef !== 'string' || !REFERENCE_PATTERN.test(value.binaryRef) ||
    typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256) ||
    !Number.isSafeInteger(value.size) || value.size < 0 ||
    typeof value.mime !== 'string' || value.mime.trim() === '' ||
    typeof value.lifecycleState !== 'string' || value.lifecycleState.trim() === ''
  ) {
    throw classificationError('BINARY_REFERENCE_INCOMPLETE', 'Binary reference requires reference, hash, size, mime and lifecycle state', { fieldPath });
  }
  return clonePlain(value, fieldPath);
}

function normalizeFieldSchema(fields) {
  assertPlainObject(fields, 'DATA_CLASSIFICATION_SCHEMA_INVALID', 'Classification fields must be a plain object', '$.fields');
  const normalized = {};
  for (const key of Object.keys(fields).sort((left, right) => left.localeCompare(right))) {
    const definition = fields[key];
    assertPlainObject(definition, 'DATA_CLASSIFICATION_SCHEMA_INVALID', 'Classification field definition must be a plain object', `$.fields.${key}`);
    if (!CLASSIFICATION_VALUES.has(definition.classification)) {
      throw classificationError('DATA_CLASSIFICATION_REQUIRED', `Field ${key} requires one recognized classification`, { field: key });
    }
    if (!FIELD_TYPES.has(definition.type)) {
      throw classificationError('DATA_CLASSIFICATION_TYPE_INVALID', `Field ${key} has an invalid type`, { field: key, type: definition.type });
    }
    normalized[key] = Object.freeze({ classification: definition.classification, type: definition.type });
  }
  if (Object.keys(normalized).length === 0) {
    throw classificationError('DATA_CLASSIFICATION_SCHEMA_INVALID', 'Classification schema must contain at least one field');
  }
  return Object.freeze(normalized);
}

class DataClassificationRegistry {
  constructor() {
    this.events = new Map();
  }

  registerEvent(input = {}) {
    const eventType = String(input.eventType || '').trim();
    if (!eventType) throw classificationError('DATA_CLASSIFICATION_EVENT_TYPE_REQUIRED', 'eventType is required');
    const fields = normalizeFieldSchema(input.fields);
    const fingerprint = canonicalSerialize(fields);
    const existing = this.events.get(eventType);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw classificationError('DATA_CLASSIFICATION_SCHEMA_CONFLICT', `Conflicting classification schema for ${eventType}`, { eventType });
      }
      return existing.publicSchema;
    }
    const publicSchema = Object.freeze({ eventType, fields });
    this.events.set(eventType, Object.freeze({ fingerprint, publicSchema }));
    return publicSchema;
  }

  validateEventPayload(eventTypeInput, payload) {
    const eventType = String(eventTypeInput || '').trim();
    const registered = this.events.get(eventType);
    if (!registered) {
      throw classificationError('DATA_CLASSIFICATION_EVENT_UNREGISTERED', `No classification schema is registered for ${eventType}`, { eventType });
    }
    assertPlainObject(payload, 'DATA_CLASSIFICATION_PAYLOAD_INVALID', 'Event payload must be a plain object', '$');
    const knownFields = registered.publicSchema.fields;
    for (const key of Object.keys(payload)) {
      if (!Object.prototype.hasOwnProperty.call(knownFields, key)) {
        throw classificationError('DATA_CLASSIFICATION_FIELD_UNREGISTERED', `Payload field ${key} is not classified`, { fieldPath: `$.${key}` });
      }
    }

    const classifications = {};
    const metadata = {};
    for (const [key, definition] of Object.entries(knownFields)) {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) {
        throw classificationError('DATA_CLASSIFICATION_FIELD_MISSING', `Required classified field ${key} is missing`, { fieldPath: `$.${key}` });
      }
      const fieldPath = `$.${key}`;
      const value = payload[key];
      assertType(value, definition.type, fieldPath);
      classifications[key] = definition.classification;
      if (definition.classification === CLASSIFICATIONS.SECRET_REFERENCE) validateSecretReference(value, fieldPath);
      else if (definition.classification === CLASSIFICATIONS.BINARY_REFERENCE) validateBinaryReference(value, fieldPath);
      else clonePlain(value, fieldPath);
      if (definition.classification === CLASSIFICATIONS.PUBLIC_METADATA) metadata[key] = clonePlain(value, fieldPath);
    }

    return Object.freeze({
      ok: true,
      eventType,
      classifications: Object.freeze(classifications),
      metadata: Object.freeze(metadata)
    });
  }
}

module.exports = {
  CLASSIFICATIONS,
  DataClassificationRegistry,
  classificationError
};
