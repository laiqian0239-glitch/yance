#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GATE_PATH = 'governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json';
const REGISTRY_PATH = 'governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json';
const BASELINE_PATH = 'governance/architecture-closure-v2/wp-b-baseline.json';
const AUTHORIZATION_PATH = 'governance/architecture-closure-v2/wp-b-design-authorization.json';
const SUPPLY_CHAIN_LOCK_PATH = 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json';
const SUPPLY_CHAIN_LOCK = require('../../governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json');
const EXPECTED_XSTATE = Object.freeze({
  version: SUPPLY_CHAIN_LOCK.artifact.version,
  resolved: SUPPLY_CHAIN_LOCK.artifact.resolved,
  integrity: SUPPLY_CHAIN_LOCK.artifact.integrity,
  license: SUPPLY_CHAIN_LOCK.artifact.license
});
const EXPECTED_STEP_IDS = Object.freeze([
  'CANDIDATE_IDENTIFICATION',
  'EXACT_VERSION_AND_LICENSE_REVIEW',
  'DEPENDENCY_AND_SECURITY_SCAN',
  'ADOPTION_MODE_DECISION',
  'YANCE_RED_CONTRACT_FIRST',
  'INTRODUCE_ORIGINAL_MODULE',
  'UPSTREAM_TESTS_PASS',
  'YANCE_ADAPTER_BOUNDARY',
  'CROSS_PLATFORM_AND_FAULT_VALIDATION',
  'COPYRIGHT_NOTICE_SBOM_PROVENANCE',
  'INDEPENDENT_REVIEW'
]);
const TERMINAL_STEP_STATES = new Set(['COMPLETE', 'NOT_APPLICABLE_REFERENCE_ONLY']);
const VALID_STEP_STATES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'NOT_APPLICABLE_REFERENCE_ONLY']);
const PRODUCTION_ROOTS = Object.freeze(['backend', 'electron', 'services']);
const PRODUCTION_EXCLUDES = Object.freeze([
  'backend/tests',
  'services/facebook-worker/tests',
  'node_modules',
  '.git'
]);

function normalizePath(value) {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readJsonOrNull(root, relativePath) {
  try {
    const value = readJson(root, relativePath);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function isExcluded(relativePath) {
  const normalized = normalizePath(relativePath);
  return PRODUCTION_EXCLUDES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function walkJavaScript(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const output = [];
  const pending = [absoluteRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = normalizePath(path.relative(root, absolute));
      if (isExcluded(relative)) continue;
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && /\.(?:c?js|mjs)$/u.test(entry.name)) output.push(relative);
    }
  }
  return output.sort();
}

function findXStateImports(root) {
  const paths = [];
  const pattern = /(?:require\(\s*['"]xstate['"]\s*\)|from\s+['"]xstate['"])/u;
  for (const productionRoot of PRODUCTION_ROOTS) {
    for (const relativePath of walkJavaScript(root, productionRoot)) {
      const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
      if (pattern.test(source)) paths.push(relativePath);
    }
  }
  return paths.sort();
}

function inspectXStatePackageBinding(repositoryRoot) {
  const packageJson = readJsonOrNull(repositoryRoot, 'package.json');
  const packageLock = readJsonOrNull(repositoryRoot, 'package-lock.json');
  const manifestVersion = String(packageJson?.dependencies?.xstate || '');
  const rootLockVersion = String(packageLock?.packages?.['']?.dependencies?.xstate || '');
  const moduleLock = packageLock?.packages?.['node_modules/xstate'];
  const runtimeDependencies = moduleLock?.dependencies;
  const runtimeDependencyCount = runtimeDependencies && typeof runtimeDependencies === 'object'
    ? Object.keys(runtimeDependencies).length
    : 0;
  const packageMentioned = Boolean(manifestVersion || rootLockVersion || moduleLock);
  const manifestExact = manifestVersion === EXPECTED_XSTATE.version;
  const lockExact = Boolean(
    Number(packageLock?.lockfileVersion) === 3
    && rootLockVersion === EXPECTED_XSTATE.version
    && moduleLock
    && moduleLock.version === EXPECTED_XSTATE.version
    && moduleLock.resolved === EXPECTED_XSTATE.resolved
    && moduleLock.integrity === EXPECTED_XSTATE.integrity
    && moduleLock.license === EXPECTED_XSTATE.license
    && runtimeDependencyCount === Number(SUPPLY_CHAIN_LOCK.artifact.runtimeDependencyCount)
  );
  return Object.freeze({
    packageMentioned,
    manifestVersion,
    rootLockVersion,
    manifestExact,
    lockExact,
    runtimeDependencyCount,
    exact: manifestExact && lockExact
  });
}

function candidateMap(registry) {
  return Object.fromEntries((registry.candidates || []).map(candidate => [String(candidate.project || '').toLowerCase(), candidate]));
}

function firstIncompleteStep(candidate, stepIds) {
  for (const stepId of stepIds) {
    const state = String(candidate?.gateSteps?.[stepId] || 'MISSING');
    if (!TERMINAL_STEP_STATES.has(state)) return stepId;
  }
  return '';
}

function verifyStepOrdering(candidate, orderedStepIds, violations) {
  let incompleteSeen = false;
  for (const stepId of orderedStepIds) {
    const state = String(candidate?.gateSteps?.[stepId] || 'MISSING');
    if (!VALID_STEP_STATES.has(state)) {
      violations.push({ code: 'WP_B_OPEN_SOURCE_STEP_STATE_INVALID', candidateId: candidate.candidateId, stepId, state });
    }
    if (incompleteSeen && state === 'COMPLETE') {
      violations.push({ code: 'WP_B_OPEN_SOURCE_STEP_COMPLETED_OUT_OF_ORDER', candidateId: candidate.candidateId, stepId });
    }
    if (!TERMINAL_STEP_STATES.has(state)) incompleteSeen = true;
  }
}

function verifyRegistry({ gate, registry, baseline, authorization, repositoryRoot }) {
  const violations = [];
  const orderedStepIds = (gate.requiredSequence || []).map(step => String(step.id || ''));
  if (JSON.stringify(orderedStepIds) !== JSON.stringify(EXPECTED_STEP_IDS)) {
    violations.push({ code: 'WP_B_OPEN_SOURCE_STEP_ORDER_INVALID', orderedStepIds });
  }
  if (gate?.enforcement?.ordered !== true || gate?.enforcement?.failClosed !== true) {
    violations.push({ code: 'WP_B_OPEN_SOURCE_GATE_NOT_FAIL_CLOSED' });
  }
  if (gate?.enforcement?.temporaryBypassAllowed !== false || gate?.enforcement?.warningOnlyAllowed !== false) {
    violations.push({ code: 'WP_B_OPEN_SOURCE_BYPASS_POLICY_INVALID' });
  }
  if (baseline?.authorizedBranch !== 'acv2/wp-b-durable-execution-outbox') {
    violations.push({ code: 'WP_B_BASELINE_BRANCH_INVALID', actual: baseline?.authorizedBranch || '' });
  }
  if (Number(baseline?.targetSchemaVersion) !== 23 || baseline?.targetMigrationId !== '023_architecture_closure_v2_wp_b') {
    violations.push({ code: 'WP_B_SCHEMA_BASELINE_INVALID' });
  }
  if (authorization?.status !== 'APPROVED_FOR_CONTINUOUS_IMPLEMENTATION'
      || authorization?.scopeBoundary?.wpBImplementationAuthorized !== true) {
    violations.push({ code: 'WP_B_IMPLEMENTATION_NOT_AUTHORIZED' });
  }

  const candidates = candidateMap(registry);
  const xstate = candidates.xstate;
  const temporal = candidates.temporal;
  if (!xstate) violations.push({ code: 'WP_B_XSTATE_CANDIDATE_MISSING' });
  if (!temporal) violations.push({ code: 'WP_B_TEMPORAL_CANDIDATE_MISSING' });

  if (xstate) {
    if (xstate.exactVersion !== EXPECTED_XSTATE.version) violations.push({ code: 'WP_B_XSTATE_VERSION_NOT_PINNED' });
    if (xstate.license !== EXPECTED_XSTATE.license) violations.push({ code: 'WP_B_XSTATE_LICENSE_INVALID' });
    if (Number(xstate.runtimeDependencyCount) !== Number(SUPPLY_CHAIN_LOCK.artifact.runtimeDependencyCount)) {
      violations.push({ code: 'WP_B_XSTATE_RUNTIME_DEPENDENCY_COUNT_INVALID' });
    }
    if (xstate.adoptionMode !== 'DIRECT_DEPENDENCY') violations.push({ code: 'WP_B_XSTATE_ADOPTION_MODE_INVALID' });
    const forbidden = new Set(xstate.forbiddenResponsibilities || []);
    for (const responsibility of [
      'DATABASE_PERSISTENCE', 'FENCING_AUTHORITY', 'RETRY_SCHEDULING_AUTHORITY',
      'RECEIPT_ISSUANCE', 'BUSINESS_TIMESTAMP_AUTHORITY', 'EXTERNAL_IO'
    ]) {
      if (!forbidden.has(responsibility)) violations.push({ code: 'WP_B_XSTATE_FORBIDDEN_RESPONSIBILITY_MISSING', responsibility });
    }
  }
  if (temporal) {
    if (temporal.adoptionMode !== 'REFERENCE_ONLY') violations.push({ code: 'WP_B_TEMPORAL_ADOPTION_MODE_INVALID' });
    if (Number(temporal.importedPackageCount || 0) !== 0 || Number(temporal.importedSourceFileCount || 0) !== 0) {
      violations.push({ code: 'WP_B_TEMPORAL_REFERENCE_ONLY_BOUNDARY_BROKEN' });
    }
  }

  for (const candidate of registry.candidates || []) verifyStepOrdering(candidate, orderedStepIds, violations);

  const packageBinding = inspectXStatePackageBinding(repositoryRoot);
  const xstateProductionImportPaths = findXStateImports(repositoryRoot);
  const originalModuleStepComplete = xstate?.gateSteps?.INTRODUCE_ORIGINAL_MODULE === 'COMPLETE';
  const adapterBoundaryStepComplete = xstate?.gateSteps?.YANCE_ADAPTER_BOUNDARY === 'COMPLETE';

  if (!originalModuleStepComplete) {
    if (packageBinding.packageMentioned) violations.push({ code: 'WP_B_XSTATE_PACKAGE_INTRODUCED_BEFORE_GATE_STEP_6' });
    if (xstateProductionImportPaths.length !== 0) {
      violations.push({ code: 'WP_B_XSTATE_IMPORTED_BEFORE_GATE_STEP_6', paths: xstateProductionImportPaths });
    }
  } else {
    if (!packageBinding.manifestExact) {
      violations.push({ code: 'WP_B_XSTATE_PACKAGE_MANIFEST_INVALID', actual: packageBinding.manifestVersion });
    }
    if (!packageBinding.lockExact) {
      violations.push({
        code: 'WP_B_XSTATE_LOCK_BINDING_INVALID',
        rootLockVersion: packageBinding.rootLockVersion,
        runtimeDependencyCount: packageBinding.runtimeDependencyCount
      });
    }
  }

  if (originalModuleStepComplete && !adapterBoundaryStepComplete && xstateProductionImportPaths.length !== 0) {
    violations.push({ code: 'WP_B_XSTATE_IMPORTED_BEFORE_ADAPTER_GATE', paths: xstateProductionImportPaths });
  }
  if (adapterBoundaryStepComplete) {
    if (!packageBinding.exact) violations.push({ code: 'WP_B_XSTATE_ADAPTER_WITHOUT_EXACT_PACKAGE' });
    if (xstateProductionImportPaths.length !== 1
        || xstateProductionImportPaths[0] !== 'backend/services/xstateLifecycleAdapter.js') {
      violations.push({ code: 'WP_B_XSTATE_IMPORT_BOUNDARY_INVALID', paths: xstateProductionImportPaths });
    }
  }

  const allCandidatesComplete = (registry.candidates || []).every(candidate => !firstIncompleteStep(candidate, orderedStepIds));
  const productionUseAuthorized = allCandidatesComplete
    && registry?.closure?.independentReviewApproved === true
    && violations.length === 0;

  return Object.freeze({
    schemaVersion: 3,
    documentType: 'YANCE_ACV2_WP_B_OPEN_SOURCE_ADOPTION_VERIFICATION',
    ok: violations.length === 0,
    orderedStepIds,
    candidates,
    xstateOriginalModuleIntroduced: originalModuleStepComplete && packageBinding.exact,
    xstatePackageBinding: packageBinding,
    xstateProductionImportCount: xstateProductionImportPaths.length,
    xstateProductionImportPaths,
    productionUseAuthorized,
    violations
  });
}

function verifyFiles(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  return verifyRegistry({
    gate: readJson(repositoryRoot, GATE_PATH),
    registry: readJson(repositoryRoot, REGISTRY_PATH),
    baseline: readJson(repositoryRoot, BASELINE_PATH),
    authorization: readJson(repositoryRoot, AUTHORIZATION_PATH),
    repositoryRoot
  });
}

module.exports = {
  AUTHORIZATION_PATH,
  BASELINE_PATH,
  EXPECTED_STEP_IDS,
  EXPECTED_XSTATE,
  GATE_PATH,
  REGISTRY_PATH,
  SUPPLY_CHAIN_LOCK,
  SUPPLY_CHAIN_LOCK_PATH,
  findXStateImports,
  inspectXStatePackageBinding,
  verifyFiles,
  verifyRegistry
};
