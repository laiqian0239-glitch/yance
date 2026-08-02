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
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INLINE_BINARY_KEY = /^(?:bytes?|data|base64|buffer|blob|binary|content)$/i;
const SECRET_MATERIAL_KEY = /(?:api[_-]?key|token|secret|password|passwd|cookie|authorization|qr(?:code)?|private[_-]?key|refresh[_-]?token|access[_-]?token|session)/i;
const SECRET_MATERIAL_VALUE = /^(?:sk-[A-Za-z0-9_-]{6,}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const SECRET_REFERENCE_PATTERN = /^(?:vault|credential|custody):\/\/[^\s]+$/i;
const BINARY_REFERENCE_PATTERN = /^managed:\/\/[^\s]+$/i;

function classificationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function codeUnitCompare(leftInput, rightInput) {
  const left = String(leftInput);
  const right = String(rightInput);
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSymbolKeys(value, code, message, fieldPath) {
  if (value && typeof value === 'object' && Object.getOwnPropertySymbols(value).length) {
    throw classificationError(code, message, { fieldPath });
  }
}

function assertNoForbiddenKeys(value, fieldPath) {
  if (!value || typeof value !== 'object') return;
  const forbidden = Object.getOwnPropertyNames(value).find(key => FORBIDDEN_OBJECT_KEYS.has(key));
  if (forbidden) {
    throw classificationError('DATA_CLASSIFICATION_FORBIDDEN_KEY', 'Classified data cannot contain prototype mutation keys', {
      fieldPath: fieldPath === '$' ? `$.${forbidden}` : `${fieldPath}.${forbidden}`,
      key: forbidden
    });
  }
}

function assertPlainObject(value, code, message, fieldPath) {
  if (!isPlainObject(value)) throw classificationError(code, message, { fieldPath });
  assertNoSymbolKeys(value, code, message, fieldPath);
  assertNoForbiddenKeys(value, fieldPath);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = descriptors[key];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
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
    if (Array.isArray(value)) {
      assertNoSymbolKeys(value, 'DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified arrays cannot contain symbol-keyed state', fieldPath);
      assertNoForbiddenKeys(value, fieldPath);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw classificationError('DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified arrays cannot be sparse', { fieldPath: `${fieldPath}[${index}]` });
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
          throw classificationError('DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified arrays cannot contain accessors', { fieldPath: `${fieldPath}[${index}]` });
        }
        result.push(clonePlain(descriptor?.value, `${fieldPath}[${index}]`, seen));
      }
      return result;
    }
    assertPlainObject(value, 'DATA_CLASSIFICATION_VALUE_UNSAFE', 'Classified values must use plain objects', fieldPath);
    const result = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.getOwnPropertyNames(value).sort(codeUnitCompare)) {
      result[key] = clonePlain(descriptors[key].value, `${fieldPath}.${key}`, seen);
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
  if (actualType === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw classificationError('DATA_CLASSIFICATION_NUMBER_INVALID', `Classified field ${fieldPath} must be a finite safe number`, { fieldPath });
  }
}

function containsInlineBinary(value, seen = new WeakSet()) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    assertNoSymbolKeys(value, 'BINARY_REFERENCE_INLINE_DATA_FORBIDDEN', 'Binary references cannot contain symbol-keyed data', '$.binary');
    assertNoForbiddenKeys(value, '$.binary');
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return true;
        if (containsInlineBinary(descriptor.value, seen)) return true;
      }
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = descriptors[key];
      if (INLINE_BINARY_KEY.test(key) || typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') return true;
      if (containsInlineBinary(descriptor.value, seen)) return true;
    }
    return false;
  } finally {
    seen.delete(value);
  }
}

function validateSecretReference(value, fieldPath) {
  assertPlainObject(value, 'SECRET_REFERENCE_INCOMPLETE', 'Secret references must be plain objects without accessors or symbols', fieldPath);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.getOwnPropertyNames(value);
  const forbiddenKey = keys.find(key => !SECRET_REFERENCE_KEYS.has(key) || SECRET_MATERIAL_KEY.test(key));
  if (forbiddenKey) {
    throw classificationError('SECRET_REFERENCE_MATERIAL_FORBIDDEN', 'Secret material is forbidden; only custody references may be stored', {
      fieldPath: `${fieldPath}.${forbiddenKey}`
    });
  }
  if (keys.some(key => typeof descriptors[key].value === 'string' && SECRET_MATERIAL_VALUE.test(descriptors[key].value))) {
    throw classificationError('SECRET_REFERENCE_MATERIAL_FORBIDDEN', 'Raw secret-like values are forbidden in secret references', { fieldPath });
  }
  const credentialRef = descriptors.credentialRef?.value;
  const generation = descriptors.generation?.value;
  const receiptId = descriptors.receiptId?.value;
  const scope = descriptors.scope?.value;
  if (
    typeof credentialRef !== 'string' || !SECRET_REFERENCE_PATTERN.test(credentialRef) ||
    !Number.isInteger(generation) || generation < 1 ||
    typeof receiptId !== 'string' || receiptId.trim() === '' ||
    (scope !== undefined && (typeof scope !== 'string' || scope.trim() === ''))
  ) {
    throw classificationError('SECRET_REFERENCE_INCOMPLETE', 'Secret reference requires a custody reference, positive generation and receiptId', { fieldPath });
  }
  return clonePlain(value, fieldPath);
}

function validateBinaryReference(value, fieldPath) {
  assertPlainObject(value, 'BINARY_REFERENCE_INLINE_DATA_FORBIDDEN', 'Binary references must be plain objects without accessors or symbols', fieldPath);
  if (containsInlineBinary(value)) {
    throw classificationError('BINARY_REFERENCE_INLINE_DATA_FORBIDDEN', 'Binary references cannot contain inline bytes, buffers, accessors or base64 data', { fieldPath });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.getOwnPropertyNames(value);
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
  const binaryRef = descriptors.binaryRef?.value;
  const sha256 = descriptors.sha256?.value;
  const size = descriptors.size?.value;
  const mime = descriptors.mime?.value;
  const lifecycleState = descriptors.lifecycleState?.value;
  if (
    typeof binaryRef !== 'string' || !BINARY_REFERENCE_PATTERN.test(binaryRef) ||
    typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256) ||
    !Number.isSafeInteger(size) || size < 0 ||
    typeof mime !== 'string' || mime.trim() === '' ||
    typeof lifecycleState !== 'string' || lifecycleState.trim() === ''
  ) {
    throw classificationError('BINARY_REFERENCE_INCOMPLETE', 'Binary reference requires a managed reference, hash, size, mime and lifecycle state', { fieldPath });
  }
  return clonePlain(value, fieldPath);
}

function normalizeFieldSchema(fields) {
  assertPlainObject(fields, 'DATA_CLASSIFICATION_SCHEMA_INVALID', 'Classification fields must be a plain object', '$.fields');
  const normalized = {};
  const descriptors = Object.getOwnPropertyDescriptors(fields);
  for (const key of Object.getOwnPropertyNames(fields).sort(codeUnitCompare)) {
    const definition = descriptors[key].value;
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
    assertPlainObject(input, 'DATA_CLASSIFICATION_SCHEMA_INVALID', 'Classification registration must be a plain object', '$');
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
    if (payload && typeof payload === 'object' && Object.getOwnPropertySymbols(payload).length) {
      throw classificationError('DATA_CLASSIFICATION_SYMBOL_KEY_FORBIDDEN', 'Event payload cannot contain symbol-keyed state', { fieldPath: '$' });
    }
    assertPlainObject(payload, 'DATA_CLASSIFICATION_PAYLOAD_INVALID', 'Event payload must be a plain object without accessors', '$');
    const knownFields = registered.publicSchema.fields;
    const payloadDescriptors = Object.getOwnPropertyDescriptors(payload);
    for (const key of Object.getOwnPropertyNames(payload)) {
      if (!Object.prototype.hasOwnProperty.call(knownFields, key)) {
        throw classificationError('DATA_CLASSIFICATION_FIELD_UNREGISTERED', `Payload field ${key} is not classified`, { fieldPath: `$.${key}` });
      }
    }

    const classifications = {};
    const metadata = {};
    for (const [key, definition] of Object.entries(knownFields)) {
      if (!Object.prototype.hasOwnProperty.call(payloadDescriptors, key)) {
        throw classificationError('DATA_CLASSIFICATION_FIELD_MISSING', `Required classified field ${key} is missing`, { fieldPath: `$.${key}` });
      }
      const fieldPath = `$.${key}`;
      const value = payloadDescriptors[key].value;
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
