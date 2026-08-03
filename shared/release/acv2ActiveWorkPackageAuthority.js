'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const WP_B_DESIGN_AUTHORIZATION_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-design-authorization.json'
);
const WP_B_BASELINE_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-baseline.json'
);
const WP_B_OPERATION_INVENTORY_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-operation-inventory.json'
);

const WP_B_CORE_SCOPE_PATTERNS = Object.freeze([
  '.github/workflows/wp-b-validation.yml',
  'backend/automation/execution/**',
  'backend/db/**',
  'backend/execution/**',
  'backend/lib/deepFreeze.js',
  'backend/lib/r32SqliteStore.js',
  'backend/migrations/architectureClosureV2WpB.js',
  'backend/services/authorityTimestamp.js',
  'backend/services/authorityTransactionCoordinator.js',
  'backend/services/authorityTransactionCoordinatorEngine.js',
  'backend/services/durableExecutionAuthority.js',
  'backend/services/durableExecutionAuthorityLegacy.js',
  'backend/services/durableExecutionLifecycle.js',
  'backend/services/externalActionDispatcher.js',
  'backend/services/externalActionOutboxAuthority.js',
  'backend/services/externalOutcomeReconciliation.js',
  'backend/services/xstateLifecycleAdapter.js',
  'backend/tests/architectureClosureV2/wpB/**',
  'governance/architecture-closure-v2/wp-b-*.json',
  'tools/architecture-closure-v2/**',
  'package.json',
  'package-lock.json',
  'shared/release/acv2ActiveWorkPackageAuthority.js',
  'shared/release/implementationBranchPolicy.js',
  'shared/release/implementationBranchPolicyLegacy.js',
  'tools/wp0/work-package-scope-gate.js',
  'tools/wp0/work-package-scope-gate-legacy.js',
  'tests/wp0/implementation-branch-policy.test.js',
  'tests/wp0/acv2-work-package-scope-wiring.test.js'
]);

function loadJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function loadWpBDesignAuthorization(filePath = WP_B_DESIGN_AUTHORIZATION_PATH) {
  return loadJsonObject(filePath);
}

function loadWpBBaseline(filePath = WP_B_BASELINE_PATH) {
  return loadJsonObject(filePath);
}

function loadWpBOperationInventory(filePath = WP_B_OPERATION_INVENTORY_PATH) {
  return loadJsonObject(filePath);
}

function normalizeRepositoryPath(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function normalizeChangedFiles(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeRepositoryPath)
    .filter(Boolean))].sort();
}

function changedFileSetSha256(values) {
  const normalized = normalizeChangedFiles(values);
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function globPatternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  const source = escaped.replace(/\*\*/gu, '\u0000').replace(/\*/gu, '[^/]*').replace(/\u0000/gu, '.*');
  return new RegExp(`^${source}$`, 'u');
}

function matchesScopePath(relativePath, pattern) {
  const pathValue = normalizeRepositoryPath(relativePath);
  const patternValue = normalizeRepositoryPath(pattern);
  if (!pathValue || !patternValue) return false;
  return /[?*[]/u.test(patternValue)
    ? globPatternToRegExp(patternValue).test(pathValue)
    : pathValue === patternValue;
}

function validDocumentPaths(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every(value => Boolean(normalizeRepositoryPath(value)));
}

function isValidWpBDesignAuthorization(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return false;
  if (design.schemaVersion !== 2) return false;
  if (design.documentType !== 'YANCE_ACV2_WP_B_IMPLEMENTATION_AUTHORIZATION') return false;
  if (design.program !== 'Architecture Closure V2') return false;
  if (design.repository !== 'laiqian0239-glitch/yance' || design.workPackage !== 'WP-B') return false;
  if (design.status !== 'APPROVED_FOR_CONTINUOUS_IMPLEMENTATION') return false;
  if (design.approvedBy !== 'PROJECT_OWNER') return false;
  if (!/^[a-f0-9]{40}$/u.test(String(design.approvedDesignHead || ''))) return false;
  if (!/^[a-f0-9]{40}$/u.test(String(design.approvedPlanHead || ''))) return false;
  if (design.implementationBranch !== 'acv2/wp-b-durable-execution-outbox') return false;
  if (!validDocumentPaths(design.designDocuments) || !validDocumentPaths(design.implementationPlanDocuments)) return false;
  const authorization = design.authorization || {};
  if (authorization.continuousExecutionAuthorized !== true) return false;
  if (authorization.productionCodeMayBeChanged !== true) return false;
  if (authorization.schema23MayBeAppliedAfterRecordedRed !== true) return false;
  if (authorization.ciAndFaultInjectionMayBeRun !== true) return false;
  const gates = design.nonWaivableGates || {};
  if (gates.testFirstRequired !== true || gates.recordedRedRequiredBeforeProductionImplementation !== true) return false;
  if (gates.databaseCasAndFencingRequired !== true || gates.ubuntuWindowsFaultMatrixRequired !== true) return false;
  if (gates.independentReviewRequired !== true) return false;
  if (gates.temporaryBypassAllowed !== false || gates.warningOnlyClosureAllowed !== false) return false;
  const scope = design.scopeBoundary || {};
  return scope.wpBImplementationAuthorized === true
    && scope.wpBMergeAuthorizedOnlyAfterAllClosureGates === true
    && scope.wpCAuthorized === false
    && scope.formalRelease === false
    && scope.publish === false;
}

function isValidWpBBaseline(baseline, design) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return false;
  if (!isValidWpBDesignAuthorization(design)) return false;
  if (baseline.schemaVersion !== 1 || baseline.documentType !== 'YANCE_ACV2_WP_B_BASELINE') return false;
  if (baseline.program !== design.program || baseline.repository !== design.repository) return false;
  if (baseline.workPackage !== 'WP-B') return false;
  if (baseline.authorizedBranch !== design.implementationBranch) return false;
  for (const field of ['parentMainHead', 'designHead', 'implementationAuthorizationHead']) {
    if (!/^[a-f0-9]{40}$/u.test(String(baseline[field] || ''))) return false;
  }
  if (baseline.designHead !== design.approvedDesignHead) return false;
  if (baseline.targetMigrationId !== '023_architecture_closure_v2_wp_b') return false;
  if (baseline.targetSchemaVersion !== 23) return false;
  if (!Array.isArray(baseline.milestones) || baseline.milestones.length !== 3) return false;
  if (!Array.isArray(baseline.requiredOperationKinds) || baseline.requiredOperationKinds.length < 1) return false;
  const governance = baseline.governance || {};
  return governance.wpBImplementationAuthorized === true
    && governance.wpCAuthorized === false
    && governance.formalRelease === false
    && governance.publish === false
    && governance.temporaryBypassAllowed === false;
}

function isValidWpBOperationInventory(inventory, baseline) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return false;
  if (inventory.schemaVersion !== 2) return false;
  if (inventory.documentType !== 'YANCE_ACV2_WP_B_OPERATION_INVENTORY') return false;
  if (inventory.workPackage !== baseline?.workPackage) return false;
  if (!Array.isArray(inventory.allowedClassifications) || inventory.allowedClassifications.length < 1) return false;
  if (!Array.isArray(inventory.entries) || inventory.entries.length < 1) return false;
  const paths = [];
  for (const entry of inventory.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const entryPath = normalizeRepositoryPath(entry.path);
    if (!entryPath || entryPath !== entry.path) return false;
    if (!inventory.allowedClassifications.includes(entry.classification)) return false;
    if (!Array.isArray(entry.operationKinds)) return false;
    paths.push(entryPath);
  }
  return new Set(paths).size === paths.length;
}

function resolveWpBImplementationAuthority(options = {}) {
  const design = Object.prototype.hasOwnProperty.call(options, 'design')
    ? options.design
    : loadWpBDesignAuthorization(options.designPath);
  const baseline = Object.prototype.hasOwnProperty.call(options, 'baseline')
    ? options.baseline
    : loadWpBBaseline(options.baselinePath);
  const inventory = Object.prototype.hasOwnProperty.call(options, 'inventory')
    ? options.inventory
    : loadWpBOperationInventory(options.inventoryPath);
  if (!isValidWpBDesignAuthorization(design)
      || !isValidWpBBaseline(baseline, design)
      || !isValidWpBOperationInventory(inventory, baseline)) return null;

  const allowedProductionPaths = Object.freeze([...new Set([
    ...WP_B_CORE_SCOPE_PATTERNS,
    ...design.designDocuments,
    ...design.implementationPlanDocuments,
    ...inventory.entries.map(entry => entry.path)
  ])]);
  return Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_ACTIVE_WORK_PACKAGE_AUTHORITY',
    program: design.program,
    repository: design.repository,
    workPackage: 'WP-B',
    status: design.status,
    authorizedBranch: baseline.authorizedBranch,
    baseHead: baseline.parentMainHead,
    targetMigrationId: baseline.targetMigrationId,
    targetSchemaVersion: baseline.targetSchemaVersion,
    allowedProductionPaths,
    design,
    baseline,
    inventory,
    governance: Object.freeze({
      readyForPromotion: false,
      formalRelease: false,
      publish: false,
      nextWorkPackageAuthorized: false,
      temporaryBypassAllowed: false
    })
  });
}

function isAuthorizedWpBImplementationBranch(branch, authority = resolveWpBImplementationAuthority()) {
  return Boolean(authority && typeof branch === 'string' && branch === authority.authorizedBranch);
}

function evaluateAuthorizedWpBScope(options = {}) {
  const authority = options.authority || resolveWpBImplementationAuthority(options);
  const branch = String(options.branch || '');
  const changedFiles = normalizeChangedFiles(options.changedFiles);
  const digest = changedFileSetSha256(changedFiles);
  if (!authority || branch !== authority.authorizedBranch) {
    return Object.freeze({
      pass: false,
      reasonCode: 'ACV2_WP_B_AUTHORIZATION_INVALID',
      workPackage: 'WP-B',
      changedFileSetSha256: digest,
      unauthorizedPaths: changedFiles,
      readyForPromotion: false
    });
  }
  const unauthorizedPaths = changedFiles.filter(file =>
    !authority.allowedProductionPaths.some(pattern => matchesScopePath(file, pattern))
  );
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'ACV2_WP_B_SCOPE_VIOLATION' : null,
    workPackage: 'WP-B',
    changedFileSetSha256: digest,
    changedFileCount: changedFiles.length,
    unauthorizedPaths,
    allowedPathCount: authority.allowedProductionPaths.length,
    readyForPromotion: false
  });
}

module.exports = Object.freeze({
  WP_B_DESIGN_AUTHORIZATION_PATH,
  WP_B_BASELINE_PATH,
  WP_B_OPERATION_INVENTORY_PATH,
  WP_B_CORE_SCOPE_PATTERNS,
  loadWpBDesignAuthorization,
  loadWpBBaseline,
  loadWpBOperationInventory,
  isValidWpBDesignAuthorization,
  isValidWpBBaseline,
  isValidWpBOperationInventory,
  resolveWpBImplementationAuthority,
  isAuthorizedWpBImplementationBranch,
  evaluateAuthorizedWpBScope,
  normalizeChangedFiles,
  changedFileSetSha256,
  matchesScopePath
});