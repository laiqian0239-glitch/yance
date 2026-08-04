'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyProductRouteBranchRole,
  evaluateProductRouteExecutablePolicy
} = require('../../tools/wp0/product-route-executable-policy');

const OSS1A_BRANCH = 'oss/1a-baileys-lifecycle';
const OSS1A_GOVERNANCE_BRANCH = 'governance/oss-1a-implementation-authorization';
const OSS1A_DERIVED_GOVERNANCE_BRANCH = 'governance/oss1a-detached-evidence-binding';
const OSS1A_IMPLEMENTATION_TIP = '1'.repeat(40);
const DERIVED_GOVERNANCE_FILES = Object.freeze([
  'tests/wp0/helpers/reviewedImplementationFixture.js',
  'tests/wp0/product-route-executable-policy.test.js',
  'tools/wp0/product-route-executable-policy.js'
]);

function registry(entries) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
    program: 'Open Source Acceleration',
    repository: 'laiqian0239-glitch/yance',
    entries,
    governance: {
      explicitEntriesOnly: true,
      directoryAutoDiscoveryAllowed: false,
      exactBranchSelectionOnly: true,
      multipleMatchesFailClosed: true,
      automaticNextWorkPackageAuthorization: false,
      readyForPromotion: false
    }
  };
}

const entry = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: OSS1A_BRANCH,
  authorizationPath: 'governance/open-source-acceleration/oss-1a-implementation-authorization.json',
  receiptPath: 'governance/open-source-acceleration/oss-1a-authorization-receipt.json'
});

const authorization = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: OSS1A_BRANCH,
  requiredBaseRef: OSS1A_GOVERNANCE_BRANCH
});

function records(overrides = {}) {
  return {
    registry: registry([entry]),
    authorizationByPath: { [entry.authorizationPath]: authorization },
    receiptByPath: { [entry.receiptPath]: { workPackage: 'OSS-1A' } },
    validateAuthorization: () => true,
    validateReceipt: () => true,
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: branch => branch === OSS1A_BRANCH,
    ...overrides
  };
}

function derivedGovernanceRecords(overrides = {}) {
  return records({
    resolveRemoteTip: branch => branch === OSS1A_BRANCH ? OSS1A_IMPLEMENTATION_TIP : null,
    isAncestor: (base, head) => base === OSS1A_IMPLEMENTATION_TIP && head === 'HEAD',
    changedFilesFromBase: base => base === OSS1A_IMPLEMENTATION_TIP
      ? [...DERIVED_GOVERNANCE_FILES]
      : [],
    ...overrides
  });
}

test('exact registered implementation and governance branches receive distinct roles', () => {
  const implementation = classifyProductRouteBranchRole(OSS1A_BRANCH, records());
  assert.equal(implementation.pass, true);
  assert.equal(implementation.role, 'IMPLEMENTATION_EXECUTABLE');
  assert.equal(implementation.workPackage, 'OSS-1A');

  const governance = classifyProductRouteBranchRole(OSS1A_GOVERNANCE_BRANCH, records());
  assert.equal(governance.pass, true);
  assert.equal(governance.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(governance.workPackage, 'OSS-1A');

  const unknown = classifyProductRouteBranchRole('feature/unreviewed-product-change', records());
  assert.equal(unknown.pass, false);
  assert.equal(unknown.reasonCode, 'WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN');
});

test('derived governance verification branch requires one sealed work package and exact profile diff', () => {
  const derived = classifyProductRouteBranchRole(
    OSS1A_DERIVED_GOVERNANCE_BRANCH,
    derivedGovernanceRecords()
  );
  assert.equal(derived.pass, true, JSON.stringify(derived));
  assert.equal(derived.role, 'GOVERNANCE_NEGATIVE_PROOF');
  assert.equal(derived.workPackage, 'OSS-1A');
  assert.equal(derived.governanceBaseCommit, OSS1A_IMPLEMENTATION_TIP);
  assert.deepEqual(derived.changedFiles, [...DERIVED_GOVERNANCE_FILES]);

  const wrongToken = classifyProductRouteBranchRole(
    'governance/oss2-detached-evidence-binding',
    derivedGovernanceRecords()
  );
  assert.equal(wrongToken.pass, false);
  assert.equal(wrongToken.reasonCode, 'WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN');

  const runtimeLeak = classifyProductRouteBranchRole(
    OSS1A_DERIVED_GOVERNANCE_BRANCH,
    derivedGovernanceRecords({
      changedFilesFromBase: () => ['backend/lib/r32SqliteStore.js']
    })
  );
  assert.equal(runtimeLeak.pass, false);
  assert.equal(runtimeLeak.reasonCode, 'WP0_PRODUCT_ROUTE_GOVERNANCE_SCOPE_INVALID');

  const unrelated = classifyProductRouteBranchRole(
    OSS1A_DERIVED_GOVERNANCE_BRANCH,
    derivedGovernanceRecords({ isAncestor: () => false })
  );
  assert.equal(unrelated.pass, false);
  assert.equal(unrelated.reasonCode, 'WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN');
});

test('derived governance profile rejects missing, extra executable, and wrong-purpose changes', () => {
  const missing = classifyProductRouteBranchRole(
    OSS1A_DERIVED_GOVERNANCE_BRANCH,
    derivedGovernanceRecords({
      changedFilesFromBase: () => DERIVED_GOVERNANCE_FILES.slice(0, 2)
    })
  );
  assert.equal(missing.pass, false);
  assert.equal(missing.reasonCode, 'WP0_PRODUCT_ROUTE_GOVERNANCE_SCOPE_INVALID');

  const executableSurface = classifyProductRouteBranchRole(
    OSS1A_DERIVED_GOVERNANCE_BRANCH,
    derivedGovernanceRecords({
      changedFilesFromBase: () => [
        ...DERIVED_GOVERNANCE_FILES,
        'tools/wp0/run-protected-command.js'
      ]
    })
  );
  assert.equal(executableSurface.pass, false);
  assert.equal(executableSurface.reasonCode, 'WP0_PRODUCT_ROUTE_GOVERNANCE_SCOPE_INVALID');

  const wrongPurpose = classifyProductRouteBranchRole(
    'governance/oss1a-unrelated-policy-change',
    derivedGovernanceRecords()
  );
  assert.equal(wrongPurpose.pass, false);
  assert.equal(wrongPurpose.reasonCode, 'WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN');
});

test('invalid duplicate work-package registry fails before derived governance selection', () => {
  const secondEntry = {
    workPackage: 'OSS-1A',
    authorizedBranch: 'oss/1a-baileys-lifecycle-shadow',
    authorizationPath: 'governance/open-source-acceleration/oss-1a-shadow-authorization.json',
    receiptPath: 'governance/open-source-acceleration/oss-1a-shadow-receipt.json'
  };
  const invalidRegistry = classifyProductRouteBranchRole(
    OSS1A_DERIVED_GOVERNANCE_BRANCH,
    derivedGovernanceRecords({
      registry: registry([entry, secondEntry]),
      authorizationByPath: {
        [entry.authorizationPath]: authorization,
        [secondEntry.authorizationPath]: {
          workPackage: 'OSS-1A',
          authorizedBranch: secondEntry.authorizedBranch,
          requiredBaseRef: 'governance/oss-1a-shadow-authorization'
        }
      },
      receiptByPath: {
        [entry.receiptPath]: { workPackage: 'OSS-1A' },
        [secondEntry.receiptPath]: { workPackage: 'OSS-1A' }
      }
    })
  );
  assert.equal(invalidRegistry.pass, false);
  assert.equal(invalidRegistry.reasonCode, 'WP0_PRODUCT_ROUTE_REGISTRY_INVALID');
});

test('ambiguous governance ownership and invalid sealed records fail closed', () => {
  const secondEntry = {
    workPackage: 'OSS-2',
    authorizedBranch: 'oss/2-model-routing',
    authorizationPath: 'governance/open-source-acceleration/oss-2-implementation-authorization.json',
    receiptPath: 'governance/open-source-acceleration/oss-2-authorization-receipt.json'
  };
  const ambiguous = classifyProductRouteBranchRole(OSS1A_GOVERNANCE_BRANCH, records({
    registry: registry([entry, secondEntry]),
    authorizationByPath: {
      [entry.authorizationPath]: authorization,
      [secondEntry.authorizationPath]: {
        workPackage: 'OSS-2',
        authorizedBranch: secondEntry.authorizedBranch,
        requiredBaseRef: OSS1A_GOVERNANCE_BRANCH
      }
    },
    receiptByPath: {
      [entry.receiptPath]: { workPackage: 'OSS-1A' },
      [secondEntry.receiptPath]: { workPackage: 'OSS-2' }
    }
  }));
  assert.equal(ambiguous.pass, false);
  assert.equal(ambiguous.reasonCode, 'WP0_PRODUCT_ROUTE_GOVERNANCE_ROLE_AMBIGUOUS');

  const invalid = classifyProductRouteBranchRole(OSS1A_GOVERNANCE_BRANCH, records({
    validateReceipt: () => false
  }));
  assert.equal(invalid.pass, false);
  assert.equal(invalid.reasonCode, 'WP0_PRODUCT_ROUTE_GOVERNANCE_AUTHORITY_INVALID');
});

test('implementation role requires a positive gate and scope result', () => {
  const result = evaluateProductRouteExecutablePolicy({
    branch: OSS1A_BRANCH,
    ...records(),
    verifyGate: () => ({ status: 'PASS', reasonCode: null }),
    evaluateScope: () => ({ applicable: true, pass: true, workPackage: 'OSS-1A' })
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.mode, 'IMPLEMENTATION_EXECUTABLE');

  const denied = evaluateProductRouteExecutablePolicy({
    branch: OSS1A_BRANCH,
    ...records(),
    verifyGate: () => ({ status: 'FAIL', reasonCode: 'WP0_REJECTED_STAGE_TARGET_DENIED' }),
    evaluateScope: () => ({ applicable: true, pass: true })
  });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'WP0_PRODUCT_ROUTE_IMPLEMENTATION_GATE_FAILED');
});

test('governance role succeeds only with exact negative executable proof', () => {
  const result = evaluateProductRouteExecutablePolicy({
    branch: OSS1A_GOVERNANCE_BRANCH,
    ...records(),
    verifyGate: () => ({ status: 'FAIL', reasonCode: 'WP0_REJECTED_STAGE_TARGET_DENIED' }),
    evaluateScope: () => ({ applicable: false, pass: true, openSourceWorkPackageScopeApplied: false })
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.mode, 'GOVERNANCE_NEGATIVE_PROOF');

  const accidentallyExecutable = evaluateProductRouteExecutablePolicy({
    branch: OSS1A_GOVERNANCE_BRANCH,
    ...records(),
    verifyGate: () => ({ status: 'PASS', reasonCode: null }),
    evaluateScope: () => ({ applicable: false, pass: true })
  });
  assert.equal(accidentallyExecutable.pass, false);
  assert.equal(accidentallyExecutable.reasonCode, 'WP0_GOVERNANCE_BRANCH_UNEXPECTEDLY_EXECUTABLE');

  const scopeLeak = evaluateProductRouteExecutablePolicy({
    branch: OSS1A_GOVERNANCE_BRANCH,
    ...records(),
    verifyGate: () => ({ status: 'FAIL', reasonCode: 'WP0_REJECTED_STAGE_TARGET_DENIED' }),
    evaluateScope: () => ({ applicable: true, pass: true, openSourceWorkPackageScopeApplied: true })
  });
  assert.equal(scopeLeak.pass, false);
  assert.equal(scopeLeak.reasonCode, 'WP0_GOVERNANCE_BRANCH_SCOPE_LEAK');
});
