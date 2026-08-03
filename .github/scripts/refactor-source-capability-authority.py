#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return source.replace(before, after, 1)


def create_shared_authority() -> None:
    content = r'''#!/usr/bin/env node
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
'''
    write("tools/architecture-closure-v2/source-capability-authority.js", content)


def refactor_source_closure_scan() -> None:
    relative = "tools/architecture-closure-v2/source-closure-scan.js"
    source = read(relative)
    source = replace_once(
        source,
        "const path = require('node:path');\n\nconst REPO_ROOT",
        "const path = require('node:path');\nconst {\n  compareDeclaredCapabilities,\n  detectSourceCapabilities,\n  normalizePath\n} = require('./source-capability-authority');\n\nconst REPO_ROOT",
        "source scan shared authority import",
    )
    source = replace_once(
        source,
        """const ACQUISITION_PATTERNS = Object.freeze([
  { capability: 'PRIMARY_DB_CONSTRUCTOR', expression: /new\\s+DatabaseSync\\s*\\(/u },
  { capability: 'PRIMARY_STORE_CONSTRUCTOR', expression: /new\\s+R32SqliteStore\\s*\\(/u },
  { capability: 'PRIMARY_BROKER_ACQUISITION', expression: /createSqliteConnectionBroker\\s*\\(/u },
  { capability: 'PRIMARY_STORE_ACQUISITION', expression: /getR32Store\\s*\\(/u }
]);
const BUSINESS_MUTATION_PATTERN = /\\b(?:INSERT\\s+INTO|UPDATE\\s+[A-Za-z_][A-Za-z0-9_]*|DELETE\\s+FROM)\\b/iu;
const RECOVERY_PATTERN = /\\b(?:recoverInterrupted|migrateAtStartup|runBootPhase0Restore|canonicalizeWhatsAppAccounts|repairRoutes|initializeDataPipelines)\\s*\\(/u;

""",
        "",
        "remove duplicated source capability patterns",
    )
    source = replace_once(
        source,
        """function normalizePath(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\\.\\//u, '');
}

""",
        "",
        "remove duplicated path normalizer",
    )
    source = replace_once(
        source,
        """function detectSourceCapabilities(source) {
  const text = String(source || '');
  const capabilities = [];
  for (const pattern of ACQUISITION_PATTERNS) {
    if (pattern.expression.test(text)) capabilities.push(pattern.capability);
  }
  if (BUSINESS_MUTATION_PATTERN.test(text)) capabilities.push('BUSINESS_SQL_MUTATION');
  if (RECOVERY_PATTERN.test(text)) capabilities.push('RECOVERY_OR_FALLBACK_ENTRYPOINT');
  return [...new Set(capabilities)];
}

""",
        "",
        "remove duplicated detector",
    )
    source = replace_once(
        source,
        """function loadRegistryExtensions(paths = REGISTRY_EXTENSION_PATHS) {
  return paths.filter(relativePath => fs.existsSync(path.join(REPO_ROOT, relativePath)))
    .map(relativePath => ({ path: relativePath, document: readJson(relativePath) }));
}
""",
        """function loadRegistryExtensions(paths = REGISTRY_EXTENSION_PATHS) {
  return paths.map(relativePath => {
    const normalizedPath = normalizePath(relativePath);
    const absolutePath = path.join(REPO_ROOT, normalizedPath);
    if (!fs.existsSync(absolutePath)) {
      return Object.freeze({
        path: normalizedPath,
        document: null,
        loadError: Object.freeze({
          code: 'REGISTRY_EXTENSION_DOCUMENT_MISSING',
          path: normalizedPath
        })
      });
    }
    try {
      return Object.freeze({ path: normalizedPath, document: readJson(normalizedPath), loadError: null });
    } catch (error) {
      return Object.freeze({
        path: normalizedPath,
        document: null,
        loadError: Object.freeze({
          code: 'REGISTRY_EXTENSION_DOCUMENT_UNREADABLE',
          path: normalizedPath,
          causeCode: String(error?.code || error?.name || 'UNKNOWN')
        })
      });
    }
  });
}
""",
        "fail-closed registry extension loader",
    )
    source = replace_once(
        source,
        """function findUnregisteredSourceCapabilities(sourceRows, registry, registryExtensions = []) {
  const registered = combinedRegisteredSourcePaths(registry, registryExtensions);
  const violations = [];
  for (const row of sourceRows) {
    const capabilities = detectSourceCapabilities(row.source).filter(capability => capability !== 'BUSINESS_SQL_MUTATION' && capability !== 'RECOVERY_OR_FALLBACK_ENTRYPOINT');
    if (capabilities.length && !registered.has(normalizePath(row.path))) {
      violations.push({
        violationClass: 'UNREGISTERED_PRIMARY_DB_ACCESS',
        code: 'UNREGISTERED_PRIMARY_DB_ACCESS',
        path: normalizePath(row.path),
        capabilities
      });
    }
  }
  return violations;
}
""",
        """function findUnregisteredSourceCapabilities(sourceRows, registry, registryExtensions = []) {
  const registered = combinedRegisteredSourcePaths(registry, registryExtensions);
  const extensionEntries = new Map();
  for (const extension of registryExtensions) {
    for (const entry of extension.document?.entries || []) {
      extensionEntries.set(normalizePath(entry.sourcePath), entry);
    }
  }
  const violations = [];
  for (const row of sourceRows) {
    const rowPath = normalizePath(row.path);
    const detectedCapabilities = [...detectSourceCapabilities(row.source)];
    const extensionEntry = extensionEntries.get(rowPath);
    if (extensionEntry) {
      try {
        compareDeclaredCapabilities({
          source: row.source,
          declared: extensionEntry.allowedCapabilities,
          registryId: String(extensionEntry.registryId || ''),
          sourcePath: rowPath
        });
      } catch (error) {
        violations.push({
          violationClass: 'REGISTRY_INVALID',
          code: error?.code || 'REGISTRY_EXTENSION_CAPABILITY_MISMATCH',
          path: rowPath,
          registryId: String(extensionEntry.registryId || ''),
          declared: error?.declared || extensionEntry.allowedCapabilities || [],
          detected: error?.detected || detectedCapabilities,
          undeclared: error?.undeclared || [],
          unused: error?.unused || []
        });
      }
      continue;
    }
    const capabilities = detectedCapabilities.filter(
      capability => capability !== 'BUSINESS_SQL_MUTATION'
        && capability !== 'RECOVERY_OR_FALLBACK_ENTRYPOINT'
    );
    if (capabilities.length && !registered.has(rowPath)) {
      violations.push({
        violationClass: 'UNREGISTERED_PRIMARY_DB_ACCESS',
        code: 'UNREGISTERED_PRIMARY_DB_ACCESS',
        path: rowPath,
        capabilities
      });
    }
  }
  return violations;
}
""",
        "enforce extension capabilities in production source scan",
    )
    source = replace_once(
        source,
        """  for (const extension of registryExtensions) {
    registryErrors.push(...validateRegistryExtension(extension.document, extension.path));
  }
""",
        """  for (const extension of registryExtensions) {
    if (extension.loadError) registryErrors.push(extension.loadError);
    else registryErrors.push(...validateRegistryExtension(extension.document, extension.path));
  }
""",
        "propagate registry extension load violations",
    )
    write(relative, source)


def refactor_registry_capability_authority() -> None:
    relative = "tools/architecture-closure-v2/registry-extension-capability-authority.js"
    source = read(relative)
    source = replace_once(
        source,
        """const { detectSourceCapabilities, normalizePath } = require('./source-closure-scan');

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
""",
        """const {
  KNOWN_CAPABILITIES,
  compareDeclaredCapabilities,
  exactCapabilityList,
  normalizePath
} = require('./source-capability-authority');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
""",
        "registry capability shared authority import",
    )
    source = re.sub(
        r"function exactCapabilityList\(values, registryId\) \{[\s\S]*?^\}\n\n",
        "",
        source,
        count=1,
        flags=re.MULTILINE,
    )
    old = """    const declared = exactCapabilityList(entry.allowedCapabilities, registryId);
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
"""
    new = """    return compareDeclaredCapabilities({
      source: fs.readFileSync(absolutePath, 'utf8'),
      declared: entry.allowedCapabilities,
      registryId,
      sourcePath
    });
"""
    source = replace_once(source, old, new, "registry capability comparison delegation")
    write(relative, source)


def extend_tests() -> None:
    relative = "backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js"
    source = read(relative)
    marker = "test('source closure scan itself rejects capability drift and missing extension documents'"
    if marker in source:
        raise RuntimeError("source closure fail-closed regression already exists")
    addition = r'''

test('source closure scan itself rejects capability drift and missing extension documents', () => {
  const registry = readJson(scanner.REGISTRY_PATH);
  const loaded = scanner.loadRegistryExtensions();
  const extension = structuredClone(loaded[0].document);
  extension.entries[0].allowedCapabilities = ['PRIMARY_DB_CONSTRUCTOR'];
  const sourcePath = extension.entries[0].sourcePath;
  const violations = scanner.findUnregisteredSourceCapabilities([
    {
      path: sourcePath,
      source: fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8')
    }
  ], registry, [{ path: loaded[0].path, document: extension, loadError: null }]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].violationClass, 'REGISTRY_INVALID');
  assert.equal(violations[0].code, 'REGISTRY_EXTENSION_CAPABILITY_MISMATCH');
  assert.deepEqual(violations[0].undeclared, ['PRIMARY_STORE_CONSTRUCTOR']);

  const missingPath = 'governance/architecture-closure-v2/definitely-missing-registry-extension.json';
  const missing = scanner.loadRegistryExtensions([missingPath]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].document, null);
  assert.deepEqual(missing[0].loadError, {
    code: 'REGISTRY_EXTENSION_DOCUMENT_MISSING',
    path: missingPath
  });
  const report = scanner.scanRegisteredSources({ wp: 'A', registryExtensions: missing });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some(violation =>
    violation.code === 'REGISTRY_EXTENSION_DOCUMENT_MISSING'
      && violation.path === missingPath
  ));
});
'''
    write(relative, source + addition)


def main() -> None:
    create_shared_authority()
    refactor_source_closure_scan()
    refactor_registry_capability_authority()
    extend_tests()
    print("SOURCE_CAPABILITY_AUTHORITY_REFACTOR_APPLIED")


if __name__ == "__main__":
    main()
