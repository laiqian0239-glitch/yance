#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  classifyWpBInventoryEntry,
  compareDeclaredCapabilities,
  detectSourceCapabilities,
  normalizePath
} = require('./source-capability-authority');
const {
  discoverCallSites
} = require('./discover-wp-b-operation-call-sites');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = 'governance/architecture-closure-v2/wp-a-baseline.json';
const REGISTRY_PATH = 'governance/architecture-closure-v2/authority-registry.json';
const WP_B_BASELINE_PATH = 'governance/architecture-closure-v2/wp-b-source-closure-baseline.json';
const WP_B_INVENTORY_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory.json';
const WORK_PACKAGE_CONFIG = Object.freeze({
  A: Object.freeze({
    baselinePath: BASELINE_PATH,
    registryPath: REGISTRY_PATH,
    mode: 'AUTHORITY_SOURCE_CLOSURE'
  }),
  B: Object.freeze({
    baselinePath: WP_B_BASELINE_PATH,
    registryPath: WP_B_INVENTORY_PATH,
    mode: 'DURABLE_OPERATION_SOURCE_CLOSURE'
  })
});
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
const WP_B_REQUIRED_ENTRY_FIELDS = Object.freeze([
  'id',
  'path',
  'classification',
  'operationKinds',
  'currentResponsibilities',
  'targetAuthority',
  'closureState',
  'removalCondition'
]);
const WP_B_DIAGNOSTIC_RECORD_TYPE = 'YANCE_ACV2_WP_B_SOURCE_CLOSURE_VIOLATION';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

function workPackageConfig(wp = 'A') {
  const key = String(wp || 'A').toUpperCase();
  const config = WORK_PACKAGE_CONFIG[key];
  if (!config) {
    const error = new Error(`Unsupported source-closure work package ${key}`);
    error.code = 'SOURCE_CLOSURE_WORK_PACKAGE_UNSUPPORTED';
    error.workPackage = key;
    throw error;
  }
  return config;
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

function scanWpA({ baseline, registry, registryExtensions }) {
  const registryErrors = validateRegistry(registry, baseline);
  for (const extension of registryExtensions) {
    if (extension.loadError) registryErrors.push(extension.loadError);
    else registryErrors.push(...validateRegistryExtension(extension.document, extension.path));
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
  const config = sourceClosureConfig(baseline);

  for (const entry of registry.entries || []) {
    const sourcePath = path.join(REPO_ROOT, normalizePath(entry.path));
    if (!fs.existsSync(sourcePath)) continue;
    const source = fs.readFileSync(sourcePath, 'utf8');
    if (entry.blockingWorkPackage !== 'WP-A') continue;
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
    workPackage: 'WP-A',
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

function validateWpBBaseline(baseline) {
  const errors = [];
  if (baseline?.schemaVersion !== 1) errors.push({ code: 'WP_B_BASELINE_SCHEMA_INVALID' });
  if (baseline?.documentType !== 'YANCE_ACV2_WP_B_SOURCE_CLOSURE_BASELINE'
      || baseline?.repository !== 'laiqian0239-glitch/yance'
      || baseline?.workPackage !== 'WP-B') {
    errors.push({ code: 'WP_B_BASELINE_IDENTITY_INVALID' });
  }
  if (baseline?.status !== 'FROZEN_FOR_CREDIBLE_RED') errors.push({ code: 'WP_B_BASELINE_STATUS_INVALID' });
  if (!Array.isArray(baseline?.discovery?.roots) || baseline.discovery.roots.length === 0) {
    errors.push({ code: 'WP_B_BASELINE_DISCOVERY_ROOTS_REQUIRED' });
  }
  if (!Array.isArray(baseline?.discovery?.excludes)) errors.push({ code: 'WP_B_BASELINE_DISCOVERY_EXCLUDES_REQUIRED' });
  for (const listName of [
    'requiredReportFields',
    'requiredDiagnosticFields',
    'productionTerminalStates',
    'nonProductionTerminalStates',
    'forbiddenTerminalStates'
  ]) {
    if (!Array.isArray(baseline?.[listName]) || baseline[listName].length === 0) {
      errors.push({ code: 'WP_B_BASELINE_LIST_REQUIRED', listName });
    }
  }
  const governance = baseline?.governance || {};
  if (governance.exactPathsOnly !== true
      || governance.wildcardPathsAllowed !== false
      || governance.scannerExclusionForSourceAllowed !== false
      || governance.temporaryBypassAllowed !== false
      || governance.warningOnlyClosureAllowed !== false
      || governance.readyForPromotion !== false
      || governance.mergeAuthorized !== false
      || governance.productionUseAuthorized !== false
      || governance.wpCAuthorized !== false
      || governance.formalRelease !== false
      || governance.publish !== false) {
    errors.push({ code: 'WP_B_BASELINE_GOVERNANCE_INVALID' });
  }
  return errors;
}

function validateWpBInventory(inventory, baseline) {
  const errors = [];
  if (inventory?.schemaVersion !== 2) errors.push({ code: 'WP_B_INVENTORY_SCHEMA_INVALID' });
  if (inventory?.documentType !== 'YANCE_ACV2_WP_B_OPERATION_INVENTORY'
      || inventory?.workPackage !== 'WP-B') {
    errors.push({ code: 'WP_B_INVENTORY_IDENTITY_INVALID' });
  }
  if (!Array.isArray(inventory?.entries) || inventory.entries.length === 0) {
    errors.push({ code: 'WP_B_INVENTORY_ENTRIES_REQUIRED' });
    return errors;
  }
  const allowedClassifications = new Set(inventory.allowedClassifications || []);
  const ids = new Set();
  const paths = new Set();
  const deleted = new Set(baseline?.productionTerminalStates || []);
  for (const [index, entry] of inventory.entries.entries()) {
    for (const field of WP_B_REQUIRED_ENTRY_FIELDS) {
      if (!(field in entry)) errors.push({ code: 'WP_B_INVENTORY_FIELD_MISSING', index, inventoryId: entry?.id || '', field });
    }
    const inventoryId = String(entry?.id || '');
    const sourcePath = normalizePath(entry?.path);
    if (!/^WPB-[A-Z0-9-]+$/u.test(inventoryId)) errors.push({ code: 'WP_B_INVENTORY_ID_INVALID', inventoryId, index });
    if (!sourcePath || sourcePath !== entry.path || sourcePath.includes('*')) {
      errors.push({ code: 'WP_B_INVENTORY_PATH_INVALID', inventoryId, path: entry?.path || '' });
    }
    if (ids.has(inventoryId)) errors.push({ code: 'WP_B_INVENTORY_ID_DUPLICATE', inventoryId });
    if (paths.has(sourcePath)) errors.push({ code: 'WP_B_INVENTORY_PATH_DUPLICATE', inventoryId, path: sourcePath });
    ids.add(inventoryId);
    paths.add(sourcePath);
    if (!allowedClassifications.has(entry.classification)) {
      errors.push({ code: 'WP_B_INVENTORY_CLASSIFICATION_INVALID', inventoryId, classification: entry.classification });
    }
    if (!Array.isArray(entry.operationKinds) || !Array.isArray(entry.currentResponsibilities)) {
      errors.push({ code: 'WP_B_INVENTORY_ARRAY_FIELD_INVALID', inventoryId });
    }
    if (!String(entry.targetAuthority || '').trim() || !String(entry.removalCondition || '').trim()) {
      errors.push({ code: 'WP_B_INVENTORY_AUTHORITY_CONTRACT_INVALID', inventoryId });
    }
    if (!fs.existsSync(path.join(REPO_ROOT, sourcePath)) && !(entry.closureState === 'DELETED' && deleted.has('DELETED'))) {
      errors.push({ code: 'WP_B_INVENTORY_SOURCE_MISSING', inventoryId, path: sourcePath });
    }
  }
  return errors;
}

function wpBInventoryViolation(entry) {
  const facts = classifyWpBInventoryEntry(entry);
  return Object.freeze({
    violationClass: facts.capabilityClass,
    code: 'WP_B_SOURCE_CLOSURE_NONTERMINAL_PATH',
    inventoryId: entry.id,
    path: entry.path,
    capabilityClass: facts.capabilityClass,
    reasonCode: 'WP_B_SOURCE_CLOSURE_NONTERMINAL_PATH',
    callable: facts.callable,
    closureState: entry.closureState,
    classification: entry.classification,
    currentResponsibilities: Object.freeze([...facts.responsibilities])
  });
}

function wpBGovernanceViolation(error, index) {
  return Object.freeze({
    violationClass: 'WP_B_INVENTORY_GOVERNANCE',
    code: error.code || 'WP_B_SOURCE_CLOSURE_INVENTORY_INVALID',
    inventoryId: 'WPB-INVENTORY-GOVERNANCE',
    path: error.path || WP_B_INVENTORY_PATH,
    capabilityClass: 'WP_B_INVENTORY_GOVERNANCE',
    reasonCode: 'WP_B_SOURCE_CLOSURE_INVENTORY_INVALID',
    callable: false,
    diagnosticIndex: index,
    details: Object.freeze({ ...error })
  });
}

function wpBUnregisteredViolation(row) {
  return Object.freeze({
    violationClass: 'UNREGISTERED_WP_B_SOURCE',
    code: 'WP_B_SOURCE_CLOSURE_UNREGISTERED_SOURCE_PATH',
    inventoryId: 'WPB-UNREGISTERED-SOURCE',
    path: normalizePath(row.path),
    capabilityClass: 'UNREGISTERED_WP_B_SOURCE',
    reasonCode: 'WP_B_SOURCE_CLOSURE_UNREGISTERED_SOURCE_PATH',
    callable: true,
    detectedCapabilities: Object.freeze([...(row.capabilities || [])])
  });
}

function countBy(violations, field) {
  return violations.reduce((total, violation) => total + (violation[field] === true ? 1 : 0), 0);
}

function scanWpB({ baseline, inventory }) {
  const validationErrors = [
    ...validateWpBBaseline(baseline),
    ...validateWpBInventory(inventory, baseline)
  ];
  const productionTerminal = new Set(baseline.productionTerminalStates || []);
  const nonProductionTerminal = new Set(baseline.nonProductionTerminalStates || []);
  const nonterminalEntries = (inventory.entries || []).filter(entry => {
    if (entry.classification === 'NON_PRODUCTION_HARNESS') {
      return !nonProductionTerminal.has(entry.closureState);
    }
    return !productionTerminal.has(entry.closureState);
  });
  const facts = nonterminalEntries.map(entry => ({ entry, facts: classifyWpBInventoryEntry(entry) }));
  const discovery = discoverCallSites(REPO_ROOT);
  const violations = [
    ...validationErrors.map(wpBGovernanceViolation),
    ...nonterminalEntries.map(wpBInventoryViolation),
    ...discovery.unregistered.map(wpBUnregisteredViolation)
  ].sort((left, right) => (
    left.path.localeCompare(right.path)
      || left.inventoryId.localeCompare(right.inventoryId)
      || left.reasonCode.localeCompare(right.reasonCode)
  ));
  const counts = {};
  for (const violation of violations) {
    counts[violation.capabilityClass] = (counts[violation.capabilityClass] || 0) + 1;
  }
  const productionNonterminal = facts.filter(({ entry }) => entry.classification !== 'NON_PRODUCTION_HARNESS');
  const legacyCallablePathCount = productionNonterminal.filter(({ facts: value }) => value.callable).length
    + discovery.unregistered.length;
  const directExternalCallOutsideAdapterCount = productionNonterminal.filter(({ facts: value }) => value.directExternal).length;
  const blindRetryPathCount = productionNonterminal.filter(({ facts: value }) => value.blindRetry).length;
  const legacyWriterPathCount = productionNonterminal.filter(({ facts: value }) => value.writer).length;
  const legacyRecoveryPathCount = productionNonterminal.filter(({ facts: value }) => value.recovery).length;
  const timerOrReconnectAuthorityPathCount = productionNonterminal.filter(({ facts: value }) => value.timerOrReconnect).length;
  const unregisteredSourcePathCount = discovery.unregistered.length;
  const discoveryComplete = inventory?.closure?.discoveryComplete === true
    && discovery.unregistered.length === 0
    && discovery.missingInventoryPathCount === 0
    && nonterminalEntries.length === 0
    && validationErrors.length === 0;
  return {
    schemaVersion: 4,
    documentType: 'YANCE_ACV2_SOURCE_CLOSURE_SCAN',
    diagnosticsSchemaVersion: 1,
    diagnosticRecordType: WP_B_DIAGNOSTIC_RECORD_TYPE,
    workPackage: 'WP-B',
    mode: WORK_PACKAGE_CONFIG.B.mode,
    baselinePath: WP_B_BASELINE_PATH,
    registryPath: WP_B_INVENTORY_PATH,
    branch: baseline.authorizationHead,
    parentGovernanceHead: baseline.parentMilestone2EvidenceHead,
    ok: violations.length === 0 && discoveryComplete,
    registryEntries: inventory.entries?.length || 0,
    registryExtensionEntries: 0,
    totalRegisteredSourcePaths: new Set((inventory.entries || []).map(entry => normalizePath(entry.path))).size,
    scannedSourceFiles: discovery.scannedFileCount,
    violationCount: violations.length,
    classifiedViolationCount: violations.length,
    legacyCallablePathCount,
    directExternalCallOutsideAdapterCount,
    blindRetryPathCount,
    legacyWriterPathCount,
    legacyRecoveryPathCount,
    timerOrReconnectAuthorityPathCount,
    unregisteredSourcePathCount,
    discoveryComplete,
    counts,
    violations
  };
}

function scanRegisteredSources(options = {}) {
  const selected = workPackageConfig(options.wp || 'A');
  if (selected.mode === 'AUTHORITY_SOURCE_CLOSURE') {
    return scanWpA({
      baseline: options.baseline || readJson(selected.baselinePath),
      registry: options.registry || readJson(selected.registryPath),
      registryExtensions: options.registryExtensions || loadRegistryExtensions()
    });
  }
  return scanWpB({
    baseline: options.baseline || readJson(selected.baselinePath),
    inventory: options.inventory || options.registry || readJson(selected.registryPath)
  });
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
  WORK_PACKAGE_CONFIG,
  WP_B_BASELINE_PATH,
  WP_B_DIAGNOSTIC_RECORD_TYPE,
  WP_B_INVENTORY_PATH,
  WP_B_REQUIRED_ENTRY_FIELDS,
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
  validateWpBBaseline,
  validateWpBInventory,
  walkJavaScript,
  workPackageConfig
};
