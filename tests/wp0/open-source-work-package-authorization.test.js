'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_REPOSITORY_PATH = 'governance/open-source-acceleration/open-source-work-package-registry.json';
const AUTHORIZATION_REPOSITORY_PATH = 'governance/open-source-acceleration/oss-a-supply-chain-authorization.json';
const RECEIPT_REPOSITORY_PATH = 'governance/open-source-acceleration/oss-a-supply-chain-authorization-receipt.json';
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'stage-6459-wp0-gates.yml');
const IMPLEMENTATION_POLICY_PATH = path.join(ROOT, 'shared', 'release', 'implementationBranchPolicy.js');
const LIB_PATH = path.join(ROOT, 'tools', 'wp0', 'lib.js');
const SCOPE_GATE_PATH = path.join(ROOT, 'tools', 'wp0', 'work-package-scope-gate.js');
const SHA40 = /^[0-9a-f]{40}$/u;

const IMPLEMENTATION_PATHS = Object.freeze([
  '.github/workflows/oss-provenance.yml',
  '.github/workflows/windows-production-release.yml',
  '.github/workflows/wp3-windows-named-mutex.yml',
  'THIRD_PARTY_NOTICES.md',
  'governance/layered-ci/wp0-routing-policy.json',
  'package.json',
  'tests/layered-ci/wp0-routing.test.js',
  'tests/supply-chain/github-actions-pinning.test.js',
  'tests/third-party/provenance.test.js',
  'tests/third-party/sbom.test.js',
  'third_party/github-actions-lock.json',
  'third_party/licenses/actions-checkout-MIT.txt',
  'third_party/licenses/actions-setup-node-MIT.txt',
  'third_party/licenses/actions-upload-artifact-MIT.txt',
  'third_party/licenses/baileys-MIT.txt',
  'third_party/provenance.json',
  'third_party/sbom.cdx.json',
  'tools/supply-chain/github-actions-lock.js',
  'tools/supply-chain/verify-github-actions-lock.js',
  'tools/third-party/provenance.js',
  'tools/third-party/sbom.js',
  'tools/third-party/verify-provenance.js',
  'tools/third-party/verify-sbom.js'
]);
const EXPECTED_SCOPE_SHA = 'fb99d7c9b090a0c8b92b5655c401b80f0e0674c6e6f5725bad8264c9ec19a175';
const TRUSTED_POLICY_HEAD = 'f'.repeat(40);
const CANDIDATE_HEAD = 'e'.repeat(40);

function repositoryPath(root, relative) {
  return path.join(root, ...relative.split('/'));
}

function loadPolicy(root = ROOT) {
  const policyPath = repositoryPath(root, 'shared/release/openSourceWorkPackagePolicy.js');
  assert.equal(fs.existsSync(policyPath), true, `generic open-source policy must exist at ${policyPath}`);
  delete require.cache[require.resolve(policyPath)];
  return require(policyPath);
}

function loadScopeGate() {
  delete require.cache[require.resolve(SCOPE_GATE_PATH)];
  return require(SCOPE_GATE_PATH);
}

function fixture() {
  const entry = Object.freeze({
    workPackage: 'OSS-A',
    authorizedBranch: 'oss/a-supply-chain-foundation',
    authorizationPath: AUTHORIZATION_REPOSITORY_PATH,
    receiptPath: RECEIPT_REPOSITORY_PATH
  });
  const registry = Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
    program: 'Open Source Acceleration',
    repository: 'laiqian0239-glitch/yance',
    entries: [entry],
    governance: {
      explicitEntriesOnly: true,
      directoryAutoDiscoveryAllowed: false,
      exactBranchSelectionOnly: true,
      multipleMatchesFailClosed: true,
      automaticNextWorkPackageAuthorization: false,
      readyForPromotion: false
    }
  });
  const authorizationCommit = 'a'.repeat(40);
  const authorizationBlobSha = 'b'.repeat(40);
  const reviewedHead = 'c'.repeat(40);
  const authorization = Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION',
    program: 'Open Source Acceleration',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'OSS-A',
    status: 'IMPLEMENTATION_AUTHORIZED',
    authorizedBranch: entry.authorizedBranch,
    requiredBaseRef: 'main',
    approvedParentHead: 'e7f7b530893689d2ed5fcc20a7583c8619ed7c91',
    approvedPlanPath: 'docs/superpowers/plans/2026-08-06-yance-oss-a-supply-chain-foundation.md',
    approvedPlanHead: '098aa4d0bdb7a8e059c06b6114bc35595feba6d4',
    approvedChangedFileCount: IMPLEMENTATION_PATHS.length,
    approvedChangedFileSetSha256: EXPECTED_SCOPE_SHA,
    exactPaths: [...IMPLEMENTATION_PATHS],
    seal: {
      status: 'SEALED_AFTER_TRUSTED_MERGE',
      pullRequest: 62,
      authorizationCommit,
      mergeFirstParent: 'd'.repeat(40),
      mergeSecondParent: reviewedHead,
      reviewedHead,
      authorizationBlobSha,
      independentReviewId: 4869624356,
      independentReviewDecision: 'ALLOW_MERGE',
      p0Count: 0,
      p1Count: 0
    },
    governance: {
      exactPathScopeOnly: true,
      wildcardExpansionAllowed: false,
      prMustRemainDraft: true,
      mergeIntoMainAuthorized: false,
      productionUseAuthorized: false,
      formalRelease: false,
      publish: false,
      automaticNextWorkPackageAuthorization: false,
      temporaryBypassAllowed: false,
      warningOnlyClosureAllowed: false,
      readyForPromotion: false
    }
  });
  const receipt = Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION_RECEIPT',
    program: authorization.program,
    repository: authorization.repository,
    workPackage: authorization.workPackage,
    status: 'SEALED_FOR_IMPLEMENTATION',
    requiredBaseRef: authorization.requiredBaseRef,
    approvedParentHead: authorization.approvedParentHead,
    authorizedBranch: authorization.authorizedBranch,
    authorizationPath: entry.authorizationPath,
    approvedPlanPath: authorization.approvedPlanPath,
    approvedPlanHead: authorization.approvedPlanHead,
    authorizationCommit,
    authorizationBlobSha,
    authorizationFileSha256: '1'.repeat(64),
    implementationBaseCommit: TRUSTED_POLICY_HEAD,
    approvedChangedFileCount: authorization.approvedChangedFileCount,
    approvedChangedFileSetSha256: authorization.approvedChangedFileSetSha256,
    governance: {
      authorizationPredatesImplementation: true,
      exactPathScopeOnly: true,
      wildcardExpansionAllowed: false,
      prMustRemainDraft: true,
      mergeIntoMainAuthorized: false,
      productionUseAuthorized: false,
      formalRelease: false,
      publish: false,
      automaticNextWorkPackageAuthorization: false,
      temporaryBypassAllowed: false,
      warningOnlyClosureAllowed: false,
      readyForPromotion: false
    }
  });
  return { entry, registry, authorization, receipt };
}

function validReceiptOptions(receipt, authorization) {
  return {
    authorizationFileSha256: receipt.authorizationFileSha256,
    trustedPolicyHead: TRUSTED_POLICY_HEAD,
    candidateHead: CANDIDATE_HEAD,
    resolveCommitBlobSha: () => authorization.seal.authorizationBlobSha,
    resolveCommitParents: () => [authorization.seal.mergeFirstParent, authorization.seal.mergeSecondParent],
    isTrustedAncestor: (base, head) => (
      base === authorization.approvedParentHead && head === authorization.seal.authorizationCommit
    ) || (
      base === authorization.seal.authorizationCommit && head === TRUSTED_POLICY_HEAD
    ),
    isAncestor: (base, head) => base === receipt.implementationBaseCommit && head === CANDIDATE_HEAD
  };
}

test('generic OSS-A registry, authorization and receipt are exact and zero-normalizing', () => {
  const policy = loadPolicy();
  const { entry, registry, authorization, receipt } = fixture();

  assert.equal(policy.normalizeRepositoryPath('third_party/sbom.cdx.json'), 'third_party/sbom.cdx.json');
  for (const invalid of [
    ' third_party/sbom.cdx.json',
    'third_party/sbom.cdx.json ',
    './third_party/sbom.cdx.json',
    'third_party\\sbom.cdx.json',
    'third_party/sbom.cdx.json/',
    '../third_party/sbom.cdx.json'
  ]) assert.equal(policy.normalizeRepositoryPath(invalid), '', invalid);

  assert.equal(policy.validateOpenSourceWorkPackageRegistry(registry), true);
  assert.equal(policy.validAuthorizationSeal(authorization.seal), true);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(policy.changedFileSetSha256(IMPLEMENTATION_PATHS), EXPECTED_SCOPE_SHA);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    validReceiptOptions(receipt, authorization)
  ), true);

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { ...validReceiptOptions(receipt, authorization), resolveCommitBlobSha: () => '2'.repeat(40) }
  ), false, 'authorization blob drift must fail closed');
});

test('unsealed or non-exact-base receipts fail even when callers inject Git adapters', () => {
  const policy = loadPolicy();
  const { entry, authorization, receipt } = fixture();
  const options = validReceiptOptions(receipt, authorization);
  const { seal, ...unsealedAuthorization } = authorization;

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry(unsealedAuthorization, entry), true);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    unsealedAuthorization,
    entry,
    options
  ), false);

  for (const mutation of [
    { implementationBaseCommit: authorization.seal.authorizationCommit },
    { implementationBaseCommit: '3'.repeat(40) },
    { authorizationCommit: '4'.repeat(40) },
    { authorizationBlobSha: '5'.repeat(40) }
  ]) {
    assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
      { ...receipt, ...mutation }, authorization, entry, options
    ), false, JSON.stringify(mutation));
  }

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt, authorization, entry, { ...options, trustedPolicyHead: '6'.repeat(40) }
  ), false);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt, authorization, entry, { ...options, isTrustedAncestor: () => false }
  ), false);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    { ...options, resolveCommitParents: () => ['7'.repeat(40), authorization.seal.mergeSecondParent] }
  ), false);
});

test('scope exception removes only the current work-package receipt', () => {
  const policy = loadPolicy();
  const { entry, registry } = fixture();
  const otherEntry = Object.freeze({
    workPackage: 'OSS-B',
    authorizedBranch: 'oss/b-example',
    authorizationPath: 'governance/open-source-acceleration/oss-b-authorization.json',
    receiptPath: 'governance/open-source-acceleration/oss-b-authorization-receipt.json'
  });
  const expandedRegistry = Object.freeze({ ...registry, entries: [entry, otherEntry] });
  const changedFiles = [
    REGISTRY_REPOSITORY_PATH,
    entry.authorizationPath,
    entry.receiptPath,
    otherEntry.authorizationPath,
    otherEntry.receiptPath,
    'third_party/sbom.cdx.json'
  ];
  assert.deepEqual(policy.filterOpenSourceImplementationChangedFiles(changedFiles, {
    registry: expandedRegistry,
    entry
  }), [
    REGISTRY_REPOSITORY_PATH,
    entry.authorizationPath,
    otherEntry.authorizationPath,
    otherEntry.receiptPath,
    'third_party/sbom.cdx.json'
  ]);
});

test('repository authority and optional implementation receipt remain exact and fail closed', () => {
  const candidatePolicy = loadPolicy(ROOT);
  const candidateRegistry = JSON.parse(fs.readFileSync(repositoryPath(ROOT, REGISTRY_REPOSITORY_PATH), 'utf8'));
  const candidateAuthorization = JSON.parse(fs.readFileSync(repositoryPath(ROOT, AUTHORIZATION_REPOSITORY_PATH), 'utf8'));
  const candidateEntry = candidatePolicy.selectOpenSourceWorkPackageRegistryEntry(
    candidateRegistry,
    'oss/a-supply-chain-foundation'
  );
  assert.ok(candidateEntry);
  assert.equal(candidatePolicy.validateOpenSourceWorkPackageRegistry(candidateRegistry), true);
  assert.equal(candidatePolicy.validAuthorizationSeal(candidateAuthorization.seal), true);
  assert.equal(candidatePolicy.isValidOpenSourceWorkPackageAuthorizationForEntry(
    candidateAuthorization,
    candidateEntry
  ), true);
  assert.equal(candidateAuthorization.approvedChangedFileCount, 23);
  assert.equal(candidateAuthorization.approvedChangedFileSetSha256, EXPECTED_SCOPE_SHA);
  assert.deepEqual(candidateAuthorization.exactPaths, [...IMPLEMENTATION_PATHS]);

  const receiptPath = repositoryPath(ROOT, RECEIPT_REPOSITORY_PATH);
  if (!fs.existsSync(receiptPath)) {
    assert.equal(candidatePolicy.isAuthorizedOpenSourceImplementationBranch(
      candidateAuthorization.authorizedBranch,
      {
        registry: candidateRegistry,
        authorization: candidateAuthorization,
        receipt: null,
        entry: candidateEntry
      }
    ), false, 'sealed authorization without a receipt remains non-executable');
    return;
  }

  const trustedPolicyRoot = path.resolve(String(process.env.TRUSTED_POLICY_ROOT || ''));
  const trustedPolicyHead = String(process.env.TRUSTED_POLICY_SHA || '');
  assert.notEqual(trustedPolicyRoot, ROOT, 'implementation receipt must be validated by a distinct base-owned policy tree');
  assert.equal(fs.existsSync(trustedPolicyRoot), true, 'base-owned policy worktree must exist');
  assert.match(trustedPolicyHead, SHA40);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: trustedPolicyRoot,
    encoding: 'utf8'
  }).trim(), trustedPolicyHead);

  const trustedPolicy = loadPolicy(trustedPolicyRoot);
  const trustedRegistry = JSON.parse(fs.readFileSync(repositoryPath(trustedPolicyRoot, REGISTRY_REPOSITORY_PATH), 'utf8'));
  const trustedAuthorization = JSON.parse(fs.readFileSync(repositoryPath(trustedPolicyRoot, AUTHORIZATION_REPOSITORY_PATH), 'utf8'));
  const trustedEntry = trustedPolicy.selectOpenSourceWorkPackageRegistryEntry(
    trustedRegistry,
    'oss/a-supply-chain-foundation'
  );
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  }).trim();

  assert.ok(trustedEntry);
  assert.equal(receipt.implementationBaseCommit, trustedPolicyHead);
  assert.equal(receipt.governance.readyForPromotion, false);
  assert.equal(receipt.governance.mergeIntoMainAuthorized, false);
  assert.equal(receipt.governance.productionUseAuthorized, false);
  assert.equal(receipt.governance.formalRelease, false);
  assert.equal(receipt.governance.publish, false);
  const validationOptions = {
    trustedPolicyRoot,
    trustedPolicyHead,
    repositoryRoot: ROOT,
    candidateHead
  };
  assert.equal(trustedPolicy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    trustedAuthorization,
    trustedEntry,
    validationOptions
  ), true, 'implementation receipt must validate against exact base-owned policy and candidate ancestry');
  assert.equal(trustedPolicy.isAuthorizedOpenSourceImplementationBranch(
    trustedAuthorization.authorizedBranch,
    {
      registry: trustedRegistry,
      authorization: trustedAuthorization,
      receipt,
      entry: trustedEntry,
      ...validationOptions
    }
  ), true);
});

test('legacy implementation policy delegates OSS branches without path normalization', () => {
  const source = fs.readFileSync(IMPLEMENTATION_POLICY_PATH, 'utf8');
  assert.match(source, /openSourceWorkPackagePolicy/u);
  assert.match(source, /isAuthorizedOpenSourceImplementationBranch/u);
  assert.match(source, /evaluateAuthorizedOpenSourceWorkPackageScope/u);
  assert.doesNotMatch(source, /String\(value \|\| ''\)\.trim\(\)\.replace\(\/\\\\\/gu/u);
});

test('permanent WP0 routes and executes product authority from exact base-owned policy', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(workflow, /TRUSTED_ROUTE_POLICY_ROOT:\s*\$\{\{ runner\.temp \}\}\/yance-wp0-trusted-route/u);
  assert.match(workflow, /node "\$\{TRUSTED_ROUTE_POLICY_ROOT\}\/tools\/layered-ci\/select-wp0-route\.js"/u);
  assert.doesNotMatch(workflow, /uses:\s*\.\/\.github\/actions\/resolve-diff-range/u);
  assert.match(workflow, /TRUSTED_POLICY_SHA:\s*\$\{\{ needs\.wp0-route\.outputs\.base \}\}/u);
  assert.match(workflow, /TRUSTED_POLICY_ROOT:\s*\$\{\{ runner\.temp \}\}\/yance-wp0-trusted-policy/u);
  assert.match(workflow, /YANCE_EVALUATED_REPOSITORY_ROOT:\s*\$\{\{ github\.workspace \}\}/u);
  assert.match(workflow, /persist-credentials:\s*false/u);
  assert.match(workflow, /git cat-file -e "\$\{TRUSTED_POLICY_SHA\}\^\{commit\}"/u);
  assert.ok(workflow.includes('git worktree add --detach --no-checkout "${TRUSTED_POLICY_ROOT}" "${TRUSTED_POLICY_SHA}"'));
  assert.ok(workflow.includes('git -C "${TRUSTED_POLICY_ROOT}" sparse-checkout init --cone'));
  assert.ok(workflow.includes('git -C "${TRUSTED_POLICY_ROOT}" sparse-checkout set tools/wp0 shared/release governance'));
  assert.ok(workflow.includes('git -C "${TRUSTED_POLICY_ROOT}" reset --hard "${TRUSTED_POLICY_SHA}"'));
  assert.ok(workflow.includes('test -f "${TRUSTED_POLICY_ROOT}/tools/wp0/verify-gate.js"'));
  assert.ok(workflow.includes('test -f "${TRUSTED_POLICY_ROOT}/shared/release/implementationBranchPolicy.js"'));
  assert.ok(workflow.includes('test ! -e "${TRUSTED_POLICY_ROOT}/vendor/electron/electron-v39.8.5-win32-x64.zip"'));
  assert.ok(!workflow.includes('git worktree add --detach "${TRUSTED_POLICY_ROOT}" "${TRUSTED_POLICY_SHA}"'));
  assert.match(workflow, /node "\$\{TRUSTED_POLICY_ROOT\}\/tools\/wp0\/verify-gate\.js"/u);
  assert.match(workflow, /--branch "\$\{IMPLEMENTATION_BRANCH\}"/u);
  assert.doesNotMatch(workflow, /npm run verify:wp0:gate -- --branch/u);
  assert.match(workflow, /tests\/wp0\/open-source-work-package-authorization\.test\.js/u);
});

test('trusted WP0 Git transport preserves exact NUL-framed paths and fails closed', () => {
  const lib = fs.readFileSync(LIB_PATH, 'utf8');
  assert.match(lib, /Object\.prototype\.hasOwnProperty\.call\(options, 'encoding'\)/u);
  assert.match(lib, /Buffer\.isBuffer\(output\)/u);

  const { decodeChangedFileBuffer } = loadScopeGate();
  assert.deepEqual(
    decodeChangedFileBuffer(Buffer.from(
      'third_party/sbom.cdx.json\0THIRD_PARTY_NOTICES.md\0',
      'utf8'
    )),
    ['THIRD_PARTY_NOTICES.md', 'third_party/sbom.cdx.json']
  );
  assert.deepEqual(decodeChangedFileBuffer(Buffer.alloc(0)), []);
  assert.throws(() => decodeChangedFileBuffer('third_party/sbom.cdx.json\0'), /must return a Buffer/u);
  assert.throws(
    () => decodeChangedFileBuffer(Buffer.from('third_party/sbom.cdx.json', 'utf8')),
    /must end with NUL/u
  );
  assert.throws(() => decodeChangedFileBuffer(Buffer.from([0xff, 0x00])), TypeError);
  for (const invalid of [
    ' third_party/sbom.cdx.json\0',
    './third_party/sbom.cdx.json\0',
    'third_party\\sbom.cdx.json\0',
    'third_party/sbom.cdx.json/\0'
  ]) {
    assert.throws(
      () => decodeChangedFileBuffer(Buffer.from(invalid, 'utf8')),
      /path identity is invalid/u,
      invalid
    );
  }
  assert.throws(
    () => decodeChangedFileBuffer(Buffer.from(
      'third_party/sbom.cdx.json\0third_party/sbom.cdx.json\0',
      'utf8'
    )),
    /contains duplicates/u
  );
});

test('fixture authorization document has a deterministic exact scope digest', () => {
  const digest = crypto
    .createHash('sha256')
    .update(`${IMPLEMENTATION_PATHS.join('\n')}\n`, 'utf8')
    .digest('hex');
  assert.equal(digest, EXPECTED_SCOPE_SHA);
});
