#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = 'governance/architecture-closure-v2/wp-a-baseline.json';
const REGISTRY_PATH = 'governance/architecture-closure-v2/authority-registry.json';
const REGISTRY_EXTENSION_PATHS = Object.freeze([
  'governance/architecture-closure-v2/wp-b-authority-registry-extension.json'
]);
const REQUIRED_ENTRY_FIELDS = Object.freeze([
  'id', 'path', 'classification', 'authorityOwner', 'commandEntrypoint',
  'eventTypes', 'aggregate', 'versionStrategy', 'idempotencyKey',
  'receiptIssuer', 'projection', 'legacyPaths', 'removalCondition',
  'blockingWorkPackage', 'closureState', 'requiredSourceMarkers',
  'forbiddenSourceMarkers'
]);
const ACQUISITION_PATTERNS = Object.freeze([
  { capability: 'PRIMARY_DB_CONSTRUCTOR', expression: /new\s+DatabaseSync\s*\(/u },
  { capability: 'PRIMARY_STORE_CONSTRUCTOR', expression: /new\s+R32SqliteStore\s*\(/u },
  { capability: 'PRIMARY_BROKER_ACQUISITION', expression: /createSqliteConnectionBroker\s*\(/u },
  { capability: 'PRIMARY_STORE_ACQUISITION', expression: /getR32Store\s*\(/u }
]);
const BUSINESS_MUTATION_PATTERN = /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_][A-Za-z0-9_]*|DELETE\s+FROM)\b/iu;
const RECOVERY_PATTERN = /\b(?:recoverInterrupted|migrateAtStartup|runBootPhase0Restore|canonicalizeWhatsAppAccounts|repairRoutes|initializeDataPipelines)\s*\(/u;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

function normalizePath(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//u, '');
}

function sourceClosureConfig(baseline) {
  const config = baseline?.sourceClosure;
  if (!config || typeof config !== 'object') {
    const error = new Error('WP-A baseline must define sourceClosure configuration');
    error.code = 'SOURCE_CLOSURE_CONFIG_REQUIRED';
    throw error;
  }
  if (!Array.isArray(config.discoveryRoots) || config.discoveryRoots.length === 0) {
    const error = new Error('sourceClosure.discoveryRoots must be non-empty');
    error.code = 'SOURCE_CLOSURE_DISCOVERY_ROOTS_REQUIRED';
    throw error;
  }
  if (!Array.isArray(config.discoveryExcludes)) {
    const error = new Error('sourceClosure.discoveryExcludes must be an array');
    error.code = 'SOURCE_CLOSURE_DISCOVERY_EXCLUDES_REQUIRED';
    throw error;
  }
  if (!Array.isArray(config.initialViolationClasses) || config.initialViolationClasses.length === 0) {
    const error = new Error('sourceClosure.initialViolationClasses must be non-empty');
    error.code = 'SOURCE_CLOSURE_INITIAL_VIOLATIONS_REQUIRED';
    throw error;
  }
  if (typeof config.a0EvidenceDocument !== 'string' || !config.a0EvidenceDocument) {
    const error = new Error('sourceClosure.a0EvidenceDocument is required');
    error.code = 'SOURCE_CLOSURE_A0_EVIDENCE_REQUIRED';
    throw error;
  }
  return config;
}

function walkJavaScript(relativeRoot, excludes = []) {
  const absoluteRoot = path.join(REPO_ROOT, relativeRoot);
  const normalizedExcludes = excludes.map(normalizePath);
  const output = [];
  const pending = [absoluteRoot];
  while (pending.length) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = normalizePath(path.relative(REPO_ROOT, absolute));
      if (normalizedExcludes.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) output.push(relative);
    }
  }
  return output.sort();
}

function detectSourceCapabilities(source) {
  const text = String(source || '');
  const capabilities = [];
  for (const pattern of ACQUISITION_PATTERNS) {
    if (pattern.expression.test(text)) capabilities.push(pattern.capability);
  }
  if (BUSINESS_MUTATION_PATTERN.test(text)) capabilities.push('BUSINESS_SQL_MUTATION');
  if (RECOVERY_PATTERN.test(text)) capabilities.push('RECOVERY_OR_FALLBACK_ENTRYPOINT');
  return [...new Set(capabilities)];
}

function validateRegistry(registry, baseline) {
  const errors = [];
  if (registry?.schemaVersion !== 1) errors.push({ code: 'REGISTRY_SCHEMA_UNSUPPORTED' });
  if (!Array.isArray(registry?.entries) || registry.entries.length === 0) errors.push({ code: 'REGISTRY_ENTRIES_REQUIRED' });
  const allowed = new Set(registry?.allowedClassifications || []);
  const ids = new Set();
  const paths = new Set();
  for (const [index, entry] of (registry?.entries || []).entries()) {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (!(field in entry)) errors.push({ code: 'REGISTRY_FIELD_MISSING', index, id: entry?.id || '', field });
    }
    if (!allowed.has(entry.classification)) errors.push({ code: 'REGISTRY_CLASSIFICATION_INVALID', id: entry.id, classification: entry.classification });
    if (ids.has(entry.id)) errors.push({ code: 'REGISTRY_ID_DUPLICATE', id: entry.id });
    ids.add(entry.id);
    const relativePath = normalizePath(entry.path);
    if (paths.has(relativePath)) errors.push({ code: 'REGISTRY_PATH_MULTI_CLASSIFIED', path: relativePath });
    paths.add(relativePath);
    if (!fs.existsSync(path.join(REPO_ROOT, relativePath))) errors.push({ code: 'REGISTRY_PATH_MISSING', path: relativePath });
    if (!Array.isArray(entry.eventTypes) || !Array.isArray(entry.requiredSourceMarkers) || !Array.isArray(entry.forbiddenSourceMarkers)) {
      errors.push({ code: 'REGISTRY_ARRAY_FIELD_INVALID', id: entry.id });
    }
    for (const name of ['writer', 'recovery', 'fallback']) {
      if (!Array.isArray(entry?.legacyPaths?.[name])) errors.push({ code: 'REGISTRY_LEGACY_PATH_INVALID', id: entry.id, name });
    }
  }
  if (baseline?.authorizedBranch !== 'acv2/wp-a-identity-ledger-write-host') errors.push({ code: 'BASELINE_BRANCH_MISMATCH' });
  if (baseline?.parentGovernanceHead !== 'd81599d8a3f3de891da369b6f1ddbd01e264c78d') errors.push({ code: 'BASELINE_PARENT_HEAD_MISMATCH' });
  try { sourceClosureConfig(baseline); }
  catch (error) { errors.push({ code: error.code || 'SOURCE_CLOSURE_CONFIG_INVALID' }); }
  return errors;
}

function validateRegistryExtension(extension, extensionPath) {
  const errors = [];
  if (extension?.schemaVersion !== 1) errors.push({ code: 'REGISTRY_EXTENSION_SCHEMA_UNSUPPORTED', path: extensionPath });
  if (extension?.documentType !== 'YANCE_ACV2_AUTHORITY_REGISTRY_EXTENSION') {
    errors.push({ code: 'REGISTRY_EXTENSION_DOCUMENT_TYPE_INVALID', path: extensionPath });
  }
  if (extension?.program !== 'Architecture Closure V2'
      || extension?.repository !== 'laiqian0239-glitch/yance'
      || extension?.workPackage !== 'WP-B'
      || extension?.status !== 'ACTIVE_IMPLEMENTATION'
      || extension?.baseRegistryPath !== REGISTRY_PATH) {
    errors.push({ code: 'REGISTRY_EXTENSION_METADATA_INVALID', path: extensionPath });
  }
  const governance = extension?.governance || {};
  if (governance.exactPathsOnly !== true
      || governance.wildcardPathsAllowed !== false
      || governance.temporaryBypassAllowed !== false
      || governance.warningOnlyAllowed !== false
      || governance.formalRelease !== false
      || governance.publish !== false) {
    errors.push({ code: 'REGISTRY_EXTENSION_GOVERNANCE_INVALID', path: extensionPath });
  }
  const ids = new Set();
  const paths = new Set();
  if (!Array.isArray(extension?.entries) || extension.entries.length === 0) {
    errors.push({ code: 'REGISTRY_EXTENSION_ENTRIES_REQUIRED', path: extensionPath });
  }
  for (const [index, entry] of (extension?.entries || []).entries()) {
    const sourcePath = normalizePath(entry?.sourcePath);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !String(entry.registryId || '').trim()
        || !sourcePath
        || sourcePath !== entry.sourcePath
        || !String(entry.authoritativeOwner || '').trim()
        || entry.classification !== 'REGISTERED_INTERNAL_AUTHORITY_SOURCE'
        || !Array.isArray(entry.allowedCapabilities)
        || entry.allowedCapabilities.length === 0
        || !String(entry.publicEntryPoint || '').trim()
        || entry.temporaryBypassAllowed !== false) {
      errors.push({ code: 'REGISTRY_EXTENSION_ENTRY_INVALID', path: extensionPath, index });
      continue;
    }
    if (/[?*[]/u.test(sourcePath) || /[?*[]/u.test(entry.publicEntryPoint)) {
      errors.push({ code: 'REGISTRY_EXTENSION_PATH_NOT_EXACT', path: extensionPath, sourcePath });
    }
    if (ids.has(entry.registryId)) errors.push({ code: 'REGISTRY_EXTENSION_ID_DUPLICATE', id: entry.registryId });
    if (paths.has(sourcePath)) errors.push({ code: 'REGISTRY_EXTENSION_PATH_DUPLICATE', sourcePath });
    ids.add(entry.registryId);
    paths.add(sourcePath);
    if (!fs.existsSync(path.join(REPO_ROOT, sourcePath))) {
      errors.push({ code: 'REGISTRY_EXTENSION_SOURCE_MISSING', sourcePath });
    }
    if (!fs.existsSync(path.join(REPO_ROOT, normalizePath(entry.publicEntryPoint)))) {
      errors.push({ code: 'REGISTRY_EXTENSION_PUBLIC_ENTRY_MISSING', publicEntryPoint: entry.publicEntryPoint });
    }
  }
  return errors;
}

function loadRegistryExtensions(paths = REGISTRY_EXTENSION_PATHS) {
  return paths.filter(relativePath => fs.existsSync(path.join(REPO_ROOT, relativePath)))
    .map(relativePath => ({ path: relativePath, document: readJson(relativePath) }));
}

function combinedRegisteredSourcePaths(registry, registryExtensions = []) {
  const paths = new Set((registry.entries || []).map(entry => normalizePath(entry.path)));
  for (const extension of registryExtensions) {
    for (const entry of extension.document?.entries || []) paths.add(normalizePath(entry.sourcePath));
  }
  return paths;
}

function violationClassFor(entry) {
  const id = String(entry?.id || '');
  if (id === 'A0-LOCAL-STORE-FALLBACK') return 'PRIMARY_DB_FALLBACK_PRESENT';
  if (['A0-WRITE-HOST-BOOT', 'A0-SQLITE-BROKER', 'A0-R32-PRIMARY-STORE'].includes(id)) return 'AUTHORITY_WRITE_HOST_CAPABILITY_MISSING';
  if (['A0-STORE-PROVIDER', 'A0-PROCESS-ROLE-GUARD', 'A0-LEGACY-JSON-MIGRATOR', 'A0-LEGACY-SQLITE-MIGRATOR'].includes(id)) return 'PRIMARY_DB_ROLE_BOUNDARY_INCOMPLETE';
  if (['A0-DOMAIN-EVENT-LOG', 'A0-PLATFORM-CORE-REPOSITORY', 'A0-DOMAIN-EVENT-PROJECTOR'].includes(id)) return 'CANONICAL_LEDGER_COORDINATOR_MISSING';
  return 'REGISTERED_OPEN_PATH';
}

function findUnregisteredSourceCapabilities(sourceRows, registry, registryExtensions = []) {
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

function scanRegisteredSources({
  baseline = readJson(BASELINE_PATH),
  registry = readJson(REGISTRY_PATH),
  registryExtensions = loadRegistryExtensions(),
  wp = 'A'
} = {}) {
  const registryErrors = validateRegistry(registry, baseline);
  for (const extension of registryExtensions) {
    registryErrors.push(...validateRegistryExtension(extension.document, extension.path));
  }
  const combinedIds = new Set((registry.entries || []).map(entry => String(entry.id || '')));
  const combinedPaths = new Set((registry.entries || []).map(entry => normalizePath(entry.path)));
  for (const extension of registryExtensions) {
    for (const entry of extension.document?.entries || []) {
      if (combinedIds.has(entry.registryId)) {
        registryErrors.push({ code: 'REGISTRY_COMBINED_ID_DUPLICATE', id: entry.registryId });
      }
      if (combinedPaths.has(normalizePath(entry.sourcePath))) {
        registryErrors.push({ code: 'REGISTRY_COMBINED_PATH_DUPLICATE', path: normalizePath(entry.sourcePath) });
      }
      combinedIds.add(entry.registryId);
      combinedPaths.add(normalizePath(entry.sourcePath));
    }
  }

  const violations = registryErrors.map(error => ({ violationClass: 'REGISTRY_INVALID', ...error }));
  const targetWorkPackage = `WP-${String(wp || 'A').toUpperCase()}`;
  const config = sourceClosureConfig(baseline);

  for (const entry of registry.entries || []) {
    const sourcePath = path.join(REPO_ROOT, normalizePath(entry.path));
    if (!fs.existsSync(sourcePath)) continue;
    const source = fs.readFileSync(sourcePath, 'utf8');
    if (entry.blockingWorkPackage !== targetWorkPackage) continue;
    const violationClass = violationClassFor(entry);
    for (const marker of entry.requiredSourceMarkers || []) {
      if (!source.includes(marker)) {
        violations.push({
          violationClass,
          code: 'REQUIRED_MARKER_MISSING',
          id: entry.id,
          path: normalizePath(entry.path),
          marker
        });
      }
    }
    for (const marker of entry.forbiddenSourceMarkers || []) {
      if (source.includes(marker)) {
        violations.push({
          violationClass,
          code: 'FORBIDDEN_MARKER_PRESENT',
          id: entry.id,
          path: normalizePath(entry.path),
          marker
        });
      }
    }
  }

  const sourceRows = [];
  for (const root of config.discoveryRoots) {
    for (const relativePath of walkJavaScript(root, config.discoveryExcludes)) {
      sourceRows.push({ path: relativePath, source: fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8') });
    }
  }
  violations.push(...findUnregisteredSourceCapabilities(sourceRows, registry, registryExtensions));

  const counts = {};
  for (const violation of violations) counts[violation.violationClass] = (counts[violation.violationClass] || 0) + 1;
  const extensionEntryCount = registryExtensions.reduce(
    (total, extension) => total + (extension.document?.entries?.length || 0),
    0
  );
  return {
    schemaVersion: 3,
    documentType: 'YANCE_ACV2_SOURCE_CLOSURE_SCAN',
    workPackage: targetWorkPackage,
    branch: baseline.authorizedBranch,
    parentGovernanceHead: baseline.parentGovernanceHead,
    a0EvidenceDocument: config.a0EvidenceDocument,
    initialViolationClasses: config.initialViolationClasses,
    ok: violations.length === 0,
    registryEntries: registry.entries?.length || 0,
    registryExtensionEntries: extensionEntryCount,
    totalRegisteredSourcePaths: combinedRegisteredSourcePaths(registry, registryExtensions).size,
    scannedSourceFiles: sourceRows.length,
    violationCount: violations.length,
    counts,
    violations
  };
}

function parseArguments(argv) {
  const args = { wp: 'A' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--wp') args.wp = String(argv[index + 1] || 'A').toUpperCase();
  }
  return args;
}

if (require.main === module) {
  try {
    const report = scanRegisteredSources(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_SOURCE_CLOSURE_SCAN_FAILURE',
      ok: false,
      code: error.code || 'ACV2_SOURCE_CLOSURE_SCAN_FAILED',
      message: error.message
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BASELINE_PATH,
  REGISTRY_PATH,
  REGISTRY_EXTENSION_PATHS,
  REQUIRED_ENTRY_FIELDS,
  combinedRegisteredSourcePaths,
  detectSourceCapabilities,
  findUnregisteredSourceCapabilities,
  loadRegistryExtensions,
  normalizePath,
  readJson,
  scanRegisteredSources,
  sourceClosureConfig,
  validateRegistry,
  validateRegistryExtension,
  walkJavaScript
};
