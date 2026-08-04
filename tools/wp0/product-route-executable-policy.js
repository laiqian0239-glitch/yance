'use strict';

const path = require('node:path');
const {
  isAuthorizedImplementationBranch
} = require('../../shared/release/implementationBranchPolicy');
const {
  isAuthorizedOpenSourceImplementationBranch,
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  loadOpenSourceWorkPackageRegistry,
  selectOpenSourceWorkPackageRegistryEntry,
  validateOpenSourceWorkPackageRegistry
} = require('../../shared/release/openSourceWorkPackagePolicy');
const { evaluateWorkPackageScopeForGate } = require('./work-package-scope-gate');
const { CURRENT_STAGE, REPO_ROOT, git, verifyWp0Gate } = require('./lib');

function result(values) {
  return Object.freeze({
    pass: false,
    reasonCode: null,
    role: null,
    workPackage: null,
    branch: null,
    readyForPromotion: false,
    ...values,
    readyForPromotion: false
  });
}

function fail(reasonCode, details = {}) {
  return result({ pass: false, reasonCode, ...details });
}

function repositoryFile(repositoryPath) {
  return path.join(REPO_ROOT, ...String(repositoryPath || '').split('/'));
}

function recordForEntry(entry, options = {}) {
  const authorization = options.authorizationByPath?.[entry.authorizationPath]
    ?? loadOpenSourceWorkPackageAuthorization(repositoryFile(entry.authorizationPath));
  const receipt = options.receiptByPath?.[entry.receiptPath]
    ?? loadOpenSourceWorkPackageAuthorizationReceipt(repositoryFile(entry.receiptPath));
  return { entry, authorization, receipt };
}

function classifyProductRouteBranchRole(branch, options = {}) {
  const normalizedBranch = String(branch || '');
  const registry = options.registry ?? loadOpenSourceWorkPackageRegistry();
  if (!validateOpenSourceWorkPackageRegistry(registry)) {
    return fail('WP0_PRODUCT_ROUTE_REGISTRY_INVALID', { branch: normalizedBranch });
  }

  const isLegacyImplementationBranch = options.isLegacyImplementationBranch
    ?? (candidate => isAuthorizedImplementationBranch(candidate, CURRENT_STAGE));
  const isOpenSourceImplementationBranch = options.isOpenSourceImplementationBranch
    ?? (candidate => isAuthorizedOpenSourceImplementationBranch(candidate));

  const registryEntry = selectOpenSourceWorkPackageRegistryEntry(registry, normalizedBranch);
  if (isLegacyImplementationBranch(normalizedBranch) || isOpenSourceImplementationBranch(normalizedBranch)) {
    return result({
      pass: true,
      role: 'IMPLEMENTATION_EXECUTABLE',
      workPackage: registryEntry?.workPackage || null,
      branch: normalizedBranch
    });
  }

  const matches = registry.entries
    .map(entry => recordForEntry(entry, options))
    .filter(record => record.authorization?.requiredBaseRef === normalizedBranch);
  if (matches.length > 1) {
    return fail('WP0_PRODUCT_ROUTE_GOVERNANCE_ROLE_AMBIGUOUS', {
      branch: normalizedBranch,
      matchingWorkPackages: matches.map(record => record.entry.workPackage).sort()
    });
  }
  if (matches.length === 0) {
    return fail('WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN', { branch: normalizedBranch });
  }

  const [{ entry, authorization, receipt }] = matches;
  const validateAuthorization = options.validateAuthorization
    ?? isValidOpenSourceWorkPackageAuthorizationForEntry;
  const validateReceipt = options.validateReceipt
    ?? isValidOpenSourceWorkPackageAuthorizationReceiptForEntry;
  if (authorization?.authorizedBranch === normalizedBranch
    || !validateAuthorization(authorization, entry)
    || !validateReceipt(receipt, authorization, entry)) {
    return fail('WP0_PRODUCT_ROUTE_GOVERNANCE_AUTHORITY_INVALID', {
      branch: normalizedBranch,
      workPackage: entry.workPackage
    });
  }

  return result({
    pass: true,
    role: 'GOVERNANCE_NEGATIVE_PROOF',
    workPackage: entry.workPackage,
    branch: normalizedBranch
  });
}

function exactNegativeGateProof(gate) {
  if (gate?.status !== 'FAIL' || gate?.reasonCode !== 'WP0_REJECTED_STAGE_TARGET_DENIED') return false;
  if (Array.isArray(gate.failedReasonCodes)) {
    return gate.failedReasonCodes.length === 1
      && gate.failedReasonCodes[0] === 'WP0_REJECTED_STAGE_TARGET_DENIED';
  }
  return true;
}

function evaluateProductRouteExecutablePolicy(options = {}) {
  const branch = String(options.branch || '');
  const role = classifyProductRouteBranchRole(branch, options);
  if (!role.pass) return role;

  const verifyGate = options.verifyGate
    ?? (() => verifyWp0Gate({ targetStage: CURRENT_STAGE, branch }));
  const evaluateScope = options.evaluateScope
    ?? (() => evaluateWorkPackageScopeForGate({ branch, git }));
  const gate = verifyGate();
  const scope = evaluateScope();

  if (role.role === 'IMPLEMENTATION_EXECUTABLE') {
    if (gate?.status !== 'PASS' || scope?.pass !== true) {
      return fail('WP0_PRODUCT_ROUTE_IMPLEMENTATION_GATE_FAILED', {
        ...role,
        gate,
        scope
      });
    }
    return result({
      ...role,
      pass: true,
      mode: 'IMPLEMENTATION_EXECUTABLE',
      gate,
      scope
    });
  }

  if (!exactNegativeGateProof(gate)) {
    return fail(
      gate?.status === 'PASS'
        ? 'WP0_GOVERNANCE_BRANCH_UNEXPECTEDLY_EXECUTABLE'
        : 'WP0_GOVERNANCE_BRANCH_NEGATIVE_PROOF_INVALID',
      { ...role, gate, scope }
    );
  }
  if (scope?.pass !== true
    || scope?.applicable !== false
    || scope?.openSourceWorkPackageScopeApplied === true
    || scope?.postMergeDefectScopeApplied === true
    || scope?.taskScopeChainApplied === true) {
    return fail('WP0_GOVERNANCE_BRANCH_SCOPE_LEAK', { ...role, gate, scope });
  }
  return result({
    ...role,
    pass: true,
    mode: 'GOVERNANCE_NEGATIVE_PROOF',
    gate,
    scope
  });
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function main(argv = process.argv.slice(2)) {
  const branch = argumentValue(argv, '--branch');
  const evaluation = evaluateProductRouteExecutablePolicy({ branch });
  process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
  process.exitCode = evaluation.pass ? 0 : 1;
}

if (require.main === module) main();

module.exports = {
  classifyProductRouteBranchRole,
  evaluateProductRouteExecutablePolicy,
  exactNegativeGateProof
};
