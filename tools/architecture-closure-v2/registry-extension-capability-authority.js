#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { detectSourceCapabilities, normalizePath } = require('./source-closure-scan');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const KNOWN_CAPABILITIES = Object.freeze([
  'PRIMARY_DB_CONSTRUCTOR',
  'PRIMARY_STORE_CONSTRUCTOR',
  'PRIMARY_BROKER_ACQUISITION',
  'PRIMARY_STORE_ACQUISITION',
  'BUSINESS_SQL_MUTATION',
  'RECOVERY_OR_FALLBACK_ENTRYPOINT'
]);
const KNOWN_CAPABILITY_SET = new Set(KNOWN_CAPABILITIES);

function capabilityError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function exactCapabilityList(values, registryId) {
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

function verifyRegistryExtensionCapabilities(extension, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  if (!extension || typeof extension !== 'object' || Array.isArray(extension)) {
    throw capabilityError(
      'REGISTRY_EXTENSION_DOCUMENT_INVALID',
      'Registry extension document must be an object'
    );
  }
  const entries = Array.isArray(extension.entries) ? extension.entries : [];
  if (entries.length === 0) {
    throw capabilityError(
      'REGISTRY_EXTENSION_ENTRIES_REQUIRED',
      'Registry extension must contain at least one entry'
    );
  }

  const reports = entries.map(entry => {
    const registryId = String(entry?.registryId || '').trim();
    const sourcePath = normalizePath(entry?.sourcePath);
    if (!registryId || !sourcePath || sourcePath !== entry.sourcePath || /[?*[]/u.test(sourcePath)) {
      throw capabilityError(
        'REGISTRY_EXTENSION_SOURCE_PATH_INVALID',
        'Registry extension source path must be exact',
        { registryId, sourcePath }
      );
    }
    const absolutePath = path.join(repositoryRoot, sourcePath);
    if (!fs.existsSync(absolutePath)) {
      throw capabilityError(
        'REGISTRY_EXTENSION_SOURCE_MISSING',
        'Registry extension source does not exist',
        { registryId, sourcePath }
      );
    }
    const declared = exactCapabilityList(entry.allowedCapabilities, registryId);
    const detected = Object.freeze([
      ...detectSourceCapabilities(fs.readFileSync(absolutePath, 'utf8'))
    ].sort());
    const undeclared = detected.filter(capability => !declared.includes(capability));
    const unused = declared.filter(capability => !detected.includes(capability));
    if (undeclared.length > 0 || unused.length > 0) {
      throw capabilityError(
        'REGISTRY_EXTENSION_CAPABILITY_MISMATCH',
        'Registry extension capabilities must exactly match detected source facts',
        { registryId, sourcePath, declared, detected, undeclared, unused }
      );
    }
    return Object.freeze({ registryId, sourcePath, declared, detected });
  });

  return Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_REGISTRY_EXTENSION_CAPABILITY_REPORT',
    ok: true,
    entryCount: reports.length,
    entries: Object.freeze(reports)
  });
}

module.exports = Object.freeze({
  KNOWN_CAPABILITIES,
  exactCapabilityList,
  verifyRegistryExtensionCapabilities
});
