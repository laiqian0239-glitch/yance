#!/usr/bin/env node
'use strict';

const KNOWN_CAPABILITIES = Object.freeze([
  'PRIMARY_DB_CONSTRUCTOR',
  'PRIMARY_STORE_CONSTRUCTOR',
  'PRIMARY_BROKER_ACQUISITION',
  'PRIMARY_STORE_ACQUISITION',
  'BUSINESS_SQL_MUTATION',
  'RECOVERY_OR_FALLBACK_ENTRYPOINT'
]);
const KNOWN_CAPABILITY_SET = new Set(KNOWN_CAPABILITIES);
const ACQUISITION_PATTERNS = Object.freeze([
  { capability: 'PRIMARY_DB_CONSTRUCTOR', expression: /new\s+DatabaseSync\s*\(/u },
  { capability: 'PRIMARY_STORE_CONSTRUCTOR', expression: /new\s+R32SqliteStore\s*\(/u },
  { capability: 'PRIMARY_BROKER_ACQUISITION', expression: /createSqliteConnectionBroker\s*\(/u },
  { capability: 'PRIMARY_STORE_ACQUISITION', expression: /getR32Store\s*\(/u }
]);
const BUSINESS_MUTATION_PATTERN = /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_][A-Za-z0-9_]*|DELETE\s+FROM)\b/iu;
const RECOVERY_PATTERN = /\b(?:recoverInterrupted|migrateAtStartup|runBootPhase0Restore|canonicalizeWhatsAppAccounts|repairRoutes|initializeDataPipelines)\s*\(/u;

function capabilityError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizePath(value) {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\/+/, '');
}

function detectSourceCapabilities(source) {
  const text = String(source || '');
  const capabilities = [];
  for (const pattern of ACQUISITION_PATTERNS) {
    if (pattern.expression.test(text)) capabilities.push(pattern.capability);
  }
  if (BUSINESS_MUTATION_PATTERN.test(text)) capabilities.push('BUSINESS_SQL_MUTATION');
  if (RECOVERY_PATTERN.test(text)) capabilities.push('RECOVERY_OR_FALLBACK_ENTRYPOINT');
  return Object.freeze([...new Set(capabilities)]);
}

function exactCapabilityList(values, registryId = '') {
  if (!Array.isArray(values) || values.length === 0) {
    throw capabilityError(
      'REGISTRY_EXTENSION_CAPABILITIES_REQUIRED',
      'Registry extension capabilities must be a non-empty array',
      { registryId }
    );
  }
  const normalized = values.map(value => String(value || '').trim());
  if (normalized.some(value => !KNOWN_CAPABILITY_SET.has(value))) {
    throw capabilityError(
      'REGISTRY_EXTENSION_CAPABILITY_UNKNOWN',
      'Registry extension declares an unknown capability',
      { registryId, declared: normalized }
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw capabilityError(
      'REGISTRY_EXTENSION_CAPABILITY_DUPLICATE',
      'Registry extension capabilities must be unique',
      { registryId, declared: normalized }
    );
  }
  return Object.freeze([...normalized].sort());
}

function compareDeclaredCapabilities({ source, declared, registryId = '', sourcePath = '' } = {}) {
  const exactDeclared = exactCapabilityList(declared, registryId);
  const detected = Object.freeze([...detectSourceCapabilities(source)].sort());
  const undeclared = Object.freeze(detected.filter(capability => !exactDeclared.includes(capability)));
  const unused = Object.freeze(exactDeclared.filter(capability => !detected.includes(capability)));
  if (undeclared.length > 0 || unused.length > 0) {
    throw capabilityError(
      'REGISTRY_EXTENSION_CAPABILITY_MISMATCH',
      'Registry extension capabilities must exactly match detected source facts',
      {
        registryId,
        sourcePath: normalizePath(sourcePath),
        declared: exactDeclared,
        detected,
        undeclared,
        unused
      }
    );
  }
  return Object.freeze({
    registryId,
    sourcePath: normalizePath(sourcePath),
    declared: exactDeclared,
    detected
  });
}

module.exports = Object.freeze({
  KNOWN_CAPABILITIES,
  compareDeclaredCapabilities,
  detectSourceCapabilities,
  exactCapabilityList,
  normalizePath
});
