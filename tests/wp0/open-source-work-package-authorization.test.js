'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT, 'shared', 'release', 'openSourceWorkPackagePolicy.js');
const REGISTRY_PATH = path.join(
  ROOT,
  'governance',
  'open-source-acceleration',
  'open-source-work-package-registry.json'
);
const AUTHORIZATION_PATH = path.join(
  ROOT,
  'governance',
  'open-source-acceleration',
  'oss-a-supply-chain-authorization.json'
);
const RECEIPT_PATH = path.join(
  ROOT,
  'governance',
  'open-source-acceleration',
  'oss-a-supply-chain-authorization-receipt.json'
);
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'stage-6459-wp0-gates.yml');
const IMPLEMENTATION_POLICY_PATH = path.join(
  ROOT,
  'shared',
  'release',
  'implementationBranchPolicy.js'
);
const LIB_PATH = path.join(ROOT, 'tools', 'wp0', 'lib.js');
const SCOPE_GATE_PATH = path.join(ROOT, 'tools', 'wp0', 'work-package-scope-gate.js');

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

function loadPolicy() {
  assert.equal(fs.existsSync(POLICY_PATH), true, 'generic open-source policy must exist');
  delete require.cache[require.resolve(POLICY_PATH)];
  return require(POLICY_PATH);
}

function loadScopeGate() {
  delete require.cache[require.resolve(SCOPE_GATE_PATH)];
  return require(SCOPE_GATE_PATH);
}

function fixture() {
  const entry = Object.freeze({
    workPackage: 'OSS-A',
    authorizedBranch: 'oss/a-supply-chain-foundation',
    authorizationPath: 'governance/open-source-acceleration/oss-a-supply-chain-authorization.json',
    receiptPath: 'governance/open-source-acceleration/oss-a-supply-chain-authorization-receipt.json'
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
    authorizationCommit: 'a'.repeat(40),
    authorizationBlobSha: 'b'.repeat(40),
    authorizationFileSha256: 'c'.repeat(64),
    implementationBaseCommit: 'd'.repeat(40),
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
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(policy.changedFileSetSha256(IMPLEMENTATION_PATHS), EXPECTED_SCOPE_SHA);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    {
      authorizationFileSha256: receipt.authorizationFileSha256,
      resolveCommitBlobSha: () => receipt.authorizationBlobSha,
      isAncestor: (base, head) => base === receipt.authorizationCommit
        && head === receipt.implementationBaseCommit
    }
  ), true);

  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    entry,
    {
      authorizationFileSha256: receipt.authorizationFileSha256,
      resolveCommitBlobSha: () => 'f'.repeat(40),
      isAncestor: () => true
    }
  ), false, 'authorization blob drift must fail closed');
});

test('repository authority files register OSS-A but do not self-create an implementation receipt', () => {
  const policy = loadPolicy();
  assert.equal(fs.existsSync(REGISTRY_PATH), true, 'registry must exist');
  assert.equal(fs.existsSync(AUTHORIZATION_PATH), true, 'authorization must exist');
  assert.equal(fs.existsSync(RECEIPT_PATH), false, 'governance PR must not fabricate implementation receipt');

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const authorization = JSON.parse(fs.readFileSync(AUTHORIZATION_PATH, 'utf8'));
  const entry = policy.selectOpenSourceWorkPackageRegistryEntry(
    registry,
    'oss/a-supply-chain-foundation'
  );
  assert.ok(entry);
  assert.equal(policy.validateOpenSourceWorkPackageRegistry(registry), true);
  assert.equal(policy.isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry), true);
  assert.equal(authorization.approvedChangedFileCount, 23);
  assert.equal(authorization.approvedChangedFileSetSha256, EXPECTED_SCOPE_SHA);
  assert.deepEqual(authorization.exactPaths, [...IMPLEMENTATION_PATHS]);
  assert.equal(policy.isAuthorizedOpenSourceImplementationBranch(
    authorization.authorizedBranch,
    { registry, authorization, receipt: null, entry }
  ), false, 'authorization without an implementation receipt must remain non-executable');
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
  assert.match(workflow, /git worktree add --detach "\$\{TRUSTED_POLICY_ROOT\}" "\$\{TRUSTED_POLICY_SHA\}"/u);
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
  assert.throws(
    () => decodeChangedFileBuffer('third_party/sbom.cdx.json\0'),
    /must return a Buffer/u
  );
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