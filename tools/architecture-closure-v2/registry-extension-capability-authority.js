#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  KNOWN_CAPABILITIES,
  compareDeclaredCapabilities,
  exactCapabilityList,
  normalizePath
} = require('./source-capability-authority');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function capabilityError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
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
    return compareDeclaredCapabilities({
      source: fs.readFileSync(absolutePath, 'utf8'),
      declared: entry.allowedCapabilities,
      registryId,
      sourcePath
    });
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
