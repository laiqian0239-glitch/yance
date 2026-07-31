'use strict';

const {
  PERSONA_BRAIN_SCHEMA_VERSION,
  AUTHORITATIVE_SECTIONS,
  createEmptyPersonaDocument
} = require('./schema');
const { isPlainObject, assertSafeKey, clone } = require('./canonicalJson');

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const LEARNED_SECTIONS = Object.freeze(['observations', 'preferences', 'interactionPatterns', 'confidenceByPath', 'sourceBindings']);

function personaError(code, message, details = {}) {
  return Object.assign(new Error(message || code), { code, details });
}

function assertJsonValue(value, path = '$') {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw personaError('PERSONA_INVALID_JSON_VALUE', `Unsupported JSON value at ${path}`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) throw personaError('PERSONA_NON_PLAIN_OBJECT', `Non-plain object at ${path}`);
  for (const [key, entry] of Object.entries(value)) {
    assertSafeKey(key);
    assertJsonValue(entry, `${path}.${key}`);
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function normalizeObject(value) {
  return isPlainObject(value) ? clone(value) : {};
}

function normalizePersonaDocument(input = {}, profileId = 'owner', timestamps = {}) {
  assertJsonValue(input);
  const empty = createEmptyPersonaDocument(profileId);
  const authoritativeInput = isPlainObject(input.authoritative) ? input.authoritative : {};
  const authoritative = {};
  for (const section of AUTHORITATIVE_SECTIONS) {
    const fallback = empty.authoritative[section];
    authoritative[section] = Array.isArray(fallback)
      ? normalizeArray(authoritativeInput[section])
      : normalizeObject(authoritativeInput[section]);
  }
  const learnedInput = isPlainObject(input.learned) ? input.learned : {};
  const learned = {
    observations: normalizeArray(learnedInput.observations),
    preferences: normalizeObject(learnedInput.preferences),
    interactionPatterns: normalizeObject(learnedInput.interactionPatterns),
    confidenceByPath: normalizeObject(learnedInput.confidenceByPath),
    sourceBindings: normalizeArray(learnedInput.sourceBindings),
    updatedAt: String(learnedInput.updatedAt || '')
  };
  const metadataInput = isPlainObject(input.metadata) ? input.metadata : {};
  const document = {
    schemaVersion: PERSONA_BRAIN_SCHEMA_VERSION,
    profileId: String(input.profileId || profileId || 'owner'),
    authoritative,
    learned,
    metadata: {
      title: String(metadataInput.title || ''),
      locale: String(metadataInput.locale || ''),
      createdAt: String(metadataInput.createdAt || timestamps.createdAt || ''),
      updatedAt: String(metadataInput.updatedAt || timestamps.updatedAt || '')
    }
  };
  const bytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
  if (bytes > MAX_DOCUMENT_BYTES) {
    throw personaError('PERSONA_DOCUMENT_TOO_LARGE', 'Persona document exceeds the 2 MiB limit', { bytes, maxBytes: MAX_DOCUMENT_BYTES });
  }
  return document;
}

function mergeValue(current, patch, path, changedPaths) {
  if (patch === undefined) return clone(current);
  if (patch === null || Array.isArray(patch) || !isPlainObject(patch)) {
    if (JSON.stringify(current) !== JSON.stringify(patch)) changedPaths.add(path);
    return clone(patch);
  }
  const output = isPlainObject(current) ? clone(current) : {};
  for (const [key, value] of Object.entries(patch)) {
    assertSafeKey(key);
    const childPath = path ? `${path}.${key}` : key;
    if (value === undefined) continue;
    output[key] = mergeValue(output[key], value, childPath, changedPaths);
  }
  return output;
}

function applyAuthoritativePatch(currentDocument, patch = {}, timestamps = {}) {
  if (!isPlainObject(patch)) throw personaError('PERSONA_PATCH_INVALID', 'Persona patch must be an object');
  const allowed = new Set(AUTHORITATIVE_SECTIONS);
  for (const key of Object.keys(patch)) {
    assertSafeKey(key);
    if (!allowed.has(key)) throw personaError('PERSONA_PATCH_SECTION_NOT_ALLOWED', `Unsupported authoritative section: ${key}`, { section: key });
  }
  const changedPaths = new Set();
  const next = clone(currentDocument);
  for (const [section, value] of Object.entries(patch)) {
    const currentValue = next.authoritative[section];
    if (value !== null && Array.isArray(currentValue) !== Array.isArray(value)) {
      throw personaError('PERSONA_PATCH_SECTION_TYPE_INVALID', `Invalid value type for authoritative section: ${section}`, { section });
    }
    if (value !== null && !Array.isArray(currentValue) && !isPlainObject(value)) {
      throw personaError('PERSONA_PATCH_SECTION_TYPE_INVALID', `Invalid value type for authoritative section: ${section}`, { section });
    }
    next.authoritative[section] = value === null
      ? (Array.isArray(currentValue) ? [] : {})
      : mergeValue(currentValue, value, `authoritative.${section}`, changedPaths);
    if (value === null) changedPaths.add(`authoritative.${section}`);
  }
  next.metadata.updatedAt = String(timestamps.updatedAt || new Date().toISOString());
  return {
    document: normalizePersonaDocument(next, currentDocument.profileId, {
      createdAt: currentDocument.metadata.createdAt,
      updatedAt: next.metadata.updatedAt
    }),
    changedPaths: [...changedPaths].sort()
  };
}

function applyLearnedPatch(currentDocument, patch = {}, timestamps = {}) {
  if (!isPlainObject(patch)) throw personaError('PERSONA_LEARNED_PATCH_INVALID', 'Learned persona patch must be an object');
  const allowed = new Set(LEARNED_SECTIONS);
  for (const key of Object.keys(patch)) {
    assertSafeKey(key);
    if (!allowed.has(key)) throw personaError('PERSONA_LEARNED_SECTION_NOT_ALLOWED', `Unsupported learned section: ${key}`, { section: key });
  }
  const changedPaths = new Set();
  const next = clone(currentDocument);
  for (const [section, value] of Object.entries(patch)) {
    const currentValue = next.learned[section];
    // Allow object→array conversion (e.g. observations: {x} → observations: [x])
    let normalizedValue = value;
    if (value !== null && Array.isArray(currentValue) && !Array.isArray(value) && isPlainObject(value)) {
      normalizedValue = normalizeArray(value);  // auto-convert {}-observations to []
    }
    if (value !== null && Array.isArray(currentValue) !== Array.isArray(normalizedValue)) {
      throw personaError('PERSONA_LEARNED_SECTION_TYPE_INVALID', `Invalid value type for learned section: ${section}`, { section });
    }
    if (normalizedValue !== null && !Array.isArray(normalizedValue) && !isPlainObject(normalizedValue)) {
      throw personaError('PERSONA_LEARNED_SECTION_TYPE_INVALID', `Invalid value type for learned section: ${section}`, { section });
    }
    next.learned[section] = value === null
      ? (Array.isArray(currentValue) ? [] : {})
      : mergeValue(currentValue, normalizedValue, `learned.${section}`, changedPaths);
    if (value === null) changedPaths.add(`learned.${section}`);
  }
  next.learned.updatedAt = String(timestamps.updatedAt || new Date().toISOString());
  next.metadata.updatedAt = next.learned.updatedAt;
  return {
    document: normalizePersonaDocument(next, currentDocument.profileId, {
      createdAt: currentDocument.metadata.createdAt,
      updatedAt: next.metadata.updatedAt
    }),
    changedPaths: [...changedPaths].sort()
  };
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  LEARNED_SECTIONS,
  personaError,
  assertJsonValue,
  normalizePersonaDocument,
  applyAuthoritativePatch,
  applyLearnedPatch
};
