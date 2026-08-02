'use strict';

const { canonicalSerialize, canonicalHash } = require('./canonicalSerialization');

const COMMAND_PROTOCOL_VERSION = 1;
const INPUT_FIELDS = Object.freeze([
  'commandId',
  'authorityScope',
  'commandType',
  'idempotencyKey',
  'aggregateType',
  'aggregateId',
  'expectedVersion',
  'actor',
  'traceId',
  'correlationId',
  'causationId',
  'payload'
]);
const ENVELOPE_FIELDS = Object.freeze(['protocolVersion', ...INPUT_FIELDS, 'contentSha256']);
const INPUT_FIELD_SET = new Set(INPUT_FIELDS);
const ENVELOPE_FIELD_SET = new Set(ENVELOPE_FIELDS);
const REQUIRED_STRING_FIELDS = Object.freeze([
  'commandId',
  'authorityScope',
  'commandType',
  'idempotencyKey',
  'aggregateType',
  'aggregateId',
  'traceId'
]);
const STRING_LIMITS = Object.freeze({
  commandId: 512,
  authorityScope: 128,
  commandType: 256,
  idempotencyKey: 2048,
  aggregateType: 128,
  aggregateId: 1024,
  traceId: 512,
  correlationId: 512,
  causationId: 512
});

function commandError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObjectShape(input, allowedFields, mode) {
  if (!isPlainObject(input)) {
    throw commandError('AUTHORITY_COMMAND_INVALID', `Authority command ${mode} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(input).length) {
    throw commandError('AUTHORITY_COMMAND_SYMBOL_KEY_FORBIDDEN', 'Authority command cannot contain symbol-keyed state');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const field of Object.getOwnPropertyNames(input)) {
    const descriptor = descriptors[field];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
      throw commandError('AUTHORITY_COMMAND_ACCESSOR_FORBIDDEN', 'Authority command cannot contain accessors', { field });
    }
    if (!allowedFields.has(field)) {
      throw commandError('AUTHORITY_COMMAND_FIELD_UNREGISTERED', `Authority command field ${field} is not registered`, { field });
    }
  }
  return descriptors;
}

function normalizedString(value, field, required = false) {
  const result = String(value == null ? '' : value).trim();
  if (required && !result) {
    throw commandError('AUTHORITY_COMMAND_FIELD_REQUIRED', `Authority command field ${field} is required`, { field });
  }
  const maximum = STRING_LIMITS[field] || 512;
  if (result.length > maximum) {
    throw commandError('AUTHORITY_COMMAND_FIELD_TOO_LONG', `Authority command field ${field} exceeds its maximum length`, {
      field,
      length: result.length,
      maximum
    });
  }
  if (/[\u0000-\u001f\u007f]/u.test(result)) {
    throw commandError('AUTHORITY_COMMAND_FIELD_INVALID', `Authority command field ${field} contains control characters`, { field });
  }
  return result;
}

function cloneCanonicalPlain(value, field) {
  try {
    return JSON.parse(canonicalSerialize(value));
  } catch (error) {
    throw commandError('AUTHORITY_COMMAND_PAYLOAD_INVALID', `Authority command ${field} is not canonical plain data`, {
      field,
      causeCode: error?.code || '',
      causeMessage: error?.message || String(error)
    });
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function normalizeActor(value) {
  const actor = cloneCanonicalPlain(value, 'actor');
  if (!isPlainObject(actor)) {
    throw commandError('AUTHORITY_COMMAND_ACTOR_INVALID', 'Authority command actor must be a plain object');
  }
  const actorType = normalizedString(actor.actorType, 'actor.actorType', true);
  const actorId = normalizedString(actor.actorId, 'actor.actorId', true);
  return deepFreeze({ ...actor, actorType, actorId });
}

function normalizePayload(value) {
  const payload = cloneCanonicalPlain(value, 'payload');
  if (!isPlainObject(payload)) {
    throw commandError('AUTHORITY_COMMAND_PAYLOAD_INVALID', 'Authority command payload must be a plain object');
  }
  return deepFreeze(payload);
}

function normalizeCommandInput(input) {
  const descriptors = assertObjectShape(input, INPUT_FIELD_SET, 'input');
  for (const field of INPUT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, field)) {
      throw commandError('AUTHORITY_COMMAND_FIELD_REQUIRED', `Authority command field ${field} is required`, { field });
    }
  }
  const normalized = {};
  for (const field of REQUIRED_STRING_FIELDS) {
    normalized[field] = normalizedString(descriptors[field].value, field, true);
  }
  normalized.correlationId = normalizedString(descriptors.correlationId.value, 'correlationId');
  normalized.causationId = normalizedString(descriptors.causationId.value, 'causationId');
  const expectedVersion = Number(descriptors.expectedVersion.value);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw commandError('AUTHORITY_COMMAND_EXPECTED_VERSION_INVALID', 'Authority command expectedVersion must be a non-negative safe integer', {
      expectedVersion: descriptors.expectedVersion.value
    });
  }
  normalized.expectedVersion = expectedVersion;
  normalized.actor = normalizeActor(descriptors.actor.value);
  normalized.payload = normalizePayload(descriptors.payload.value);
  return normalized;
}

function orderedContent(normalized) {
  return {
    commandId: normalized.commandId,
    authorityScope: normalized.authorityScope,
    commandType: normalized.commandType,
    idempotencyKey: normalized.idempotencyKey,
    aggregateType: normalized.aggregateType,
    aggregateId: normalized.aggregateId,
    expectedVersion: normalized.expectedVersion,
    actor: normalized.actor,
    traceId: normalized.traceId,
    correlationId: normalized.correlationId,
    causationId: normalized.causationId,
    payload: normalized.payload
  };
}

function commandFingerprint(input) {
  return canonicalHash(orderedContent(normalizeCommandInput(input)));
}

function createAuthorityCommandEnvelope(input) {
  const normalized = normalizeCommandInput(input);
  const content = orderedContent(normalized);
  return deepFreeze({
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    ...content,
    contentSha256: canonicalHash(content)
  });
}

function assertAuthorityCommandEnvelope(input) {
  const descriptors = assertObjectShape(input, ENVELOPE_FIELD_SET, 'envelope');
  for (const field of ENVELOPE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, field)) {
      throw commandError('AUTHORITY_COMMAND_FIELD_REQUIRED', `Authority command envelope field ${field} is required`, { field });
    }
  }
  if (Number(descriptors.protocolVersion.value) !== COMMAND_PROTOCOL_VERSION) {
    throw commandError('AUTHORITY_COMMAND_PROTOCOL_VERSION_UNSUPPORTED', 'Authority command protocol version is unsupported', {
      protocolVersion: descriptors.protocolVersion.value,
      supportedVersion: COMMAND_PROTOCOL_VERSION
    });
  }
  const raw = {};
  for (const field of INPUT_FIELDS) raw[field] = descriptors[field].value;
  const expected = createAuthorityCommandEnvelope(raw);
  const receivedHash = String(descriptors.contentSha256.value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(receivedHash) || receivedHash !== expected.contentSha256) {
    throw commandError('AUTHORITY_COMMAND_CONTENT_HASH_MISMATCH', 'Authority command content hash does not match canonical content', {
      expectedContentSha256: expected.contentSha256,
      receivedContentSha256: receivedHash
    });
  }
  return input;
}

module.exports = {
  COMMAND_PROTOCOL_VERSION,
  INPUT_FIELDS,
  ENVELOPE_FIELDS,
  createAuthorityCommandEnvelope,
  assertAuthorityCommandEnvelope,
  commandFingerprint,
  commandError
};
