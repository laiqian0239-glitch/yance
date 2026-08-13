'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ROUTES,
  classifyWp0Route,
  validateWp0RoutingPolicy
} = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));
const OSS_A_CURRENT_MAIN_BOOTSTRAP_PATHS = Object.freeze([
  'THIRD_PARTY_NOTICES.md',
  'third_party/github-actions-lock.json',
  'third_party/licenses/actions-checkout-MIT.txt',
  'third_party/licenses/actions-setup-node-MIT.txt',
  'third_party/licenses/actions-upload-artifact-MIT.txt',
  'third_party/licenses/baileys-MIT.txt',
  'third_party/provenance.json',
  'third_party/sbom.cdx.json'
]);

test('routing policy is exact, fail closed and contains no wildcard authorization', () => {
  const result = validateWp0RoutingPolicy(policy);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(policy.unknownPathFailsClosed, true);
  assert.equal(policy.readyForPromotion, false);
  assert.equal(JSON.stringify(policy).includes('*'), false);
  assert.deepEqual(policy.productDocumentationPrefixes, [
    'docs/superpowers/plans/',
    'docs/superpowers/specs/'
  ]);
  assert.deepEqual(policy.productDocumentationExtensions, ['.md']);
});

test('layered governance-only changes select GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    'governance/layered-ci/risk-policy.json',
    'tools/layered-ci/governance-policy.js',
    'tests/layered-ci/governance-policy.test.js',
    '.github/actions/resolve-diff-range/action.yml',
    '.github/workflows/reviewed-candidate-a6.yml',
    'tools/independent-review/review-contract.js',
    'docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate-design.md'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
});

test('WP-A Promotion Authorization exact scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    '.github/workflows/wp-a-promotion-authorization.yml',
    'governance/architecture-closure-v2/wp-a-promotion-authorization.json',
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/wp0-routing.test.js',
    'tests/wp0/wp-a-promotion-authorization.test.js',
    'tools/architecture-closure-v2/verify-wp-a-promotion-authorization.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('WP-A permanent post-merge validation exact scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    '.github/workflows/wp-a-post-merge-validation.yml',
    'governance/architecture-closure-v2/wp-a-post-merge-validation-policy.json',
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/wp0-routing.test.js',
    'tests/wp0/wp-a-post-merge-validation.test.js',
    'tools/architecture-closure-v2/run-wp-a-post-merge-contracts.js',
    'tools/architecture-closure-v2/verify-wp-a-post-merge.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('exact OSS-A WP0 contract repair scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    'tests/wp0/acv2-work-package-scope-wiring.test.js',
    'tests/wp0/implementation-branch-policy.test.js',
    'tests/wp0/open-source-work-package-authorization.test.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('exact OSS-A WP0 isolation repair scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    'tests/wp0/acv2-work-package-scope-wiring.test.js',
    'tests/wp0/evidence-source-binding.test.js',
    'tests/wp0/forbidden-hotfix-entrypoints.test.js',
    'tests/wp0/freeze-rejected-baseline.test.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
  assert.equal(result.governanceChangesPresent, true);
  assert.equal(result.productChangesPresent, false);
});

test('pure Superpowers product plan/spec Markdown selects non-executable PRODUCT_DOCUMENTATION_WP0', () => {
  for (const file of [
    'docs/superpowers/plans/2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md',
    'docs/superpowers/specs/2026-08-04-yance-open-source-acceleration-design.md'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.PRODUCT_DOCUMENTATION, file);
    assert.equal(result.productDocumentationChangesPresent, true, file);
    assert.equal(result.productChangesPresent, false, file);
    assert.equal(result.governanceChangesPresent, false, file);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.buildAuthorized, false);
    assert.equal(result.releaseAuthorized, false);
  }
});

test('product source, release surfaces, general architecture docs and non-Markdown plan files select PRODUCT_WP0', () => {
  for (const file of [
    'backend/runtime/AppRuntime.js',
    'frontend/index.html',
    'package.json',
    'tools/wp0/verify-gate.js',
    'release/release-source.json',
    'docs/architecture/YANCE_ACV2_WP_A_A5_SOURCE_REVIEW_ZH.md',
    'docs/superpowers/plans/executable.js',
    'docs/superpowers/specs/data.json'
  ]) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.route, ROUTES.PRODUCT, file);
  }
});

test('current-main OSS-A supply-chain bootstrap uses exact PRODUCT_WP0 paths without a third_party prefix', () => {
  assert.equal(policy.productPrefixes.includes('third_party/'), false);
  for (const file of OSS_A_CURRENT_MAIN_BOOTSTRAP_PATHS) {
    const result = classifyWp0Route(policy, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.route, ROUTES.PRODUCT, file);
    assert.equal(result.productChangesPresent, true, file);
    assert.equal(policy.productExactPaths.includes(file), true, file);
  }
});

test('specific layered governance documents retain governance priority over product documentation prefixes', () => {
  const result = classifyWp0Route(policy, [
    'docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate-design.md'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE);
});

test('mixed governance/documentation or source/documentation changes escalate to PRODUCT_WP0', () => {
  for (const changedFiles of [
    [
      'governance/layered-ci/risk-policy.json',
      'docs/superpowers/plans/2026-08-04-plan.md'
    ],
    [
      'backend/runtime/AppRuntime.js',
      'docs/superpowers/plans/2026-08-04-plan.md'
    ]
  ]) {
    const result = classifyWp0Route(policy, changedFiles);
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.route, ROUTES.PRODUCT);
  }
});

test('unknown or invalid paths fail closed rather than selecting a cheaper route', () => {
  const unknown = classifyWp0Route(policy, ['unclassified/new-surface.bin']);
  assert.equal(unknown.pass, false);
  assert.equal(unknown.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH');

  for (const invalidPath of [
    '../escape.js',
    ' docs/superpowers/plans/leading-space.md',
    'docs/superpowers/plans/trailing-space.md ',
    './docs/superpowers/plans/dot-prefix.md',
    'docs\\superpowers\\plans\\backslash.md',
    'docs/superpowers/plans/tab\tname.md',
    'docs/superpowers/plans/bell\u0007name.md',
    'docs/superpowers/plans/del\u007fname.md',
    'docs/superpowers/plans/line\nbreak.md'
  ]) {
    const invalid = classifyWp0Route(policy, [invalidPath]);
    assert.equal(invalid.pass, false, JSON.stringify(invalidPath));
    assert.equal(invalid.reasonCode, 'WP0_ROUTE_PATH_INVALID', JSON.stringify(invalidPath));
  }
});

test('Stage WP0 workflow has base-owned routing and separate routes behind one aggregate gate', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows/stage-6459-wp0-gates.yml'), 'utf8');
  assert.match(text, /wp0-route:/u);
  assert.match(text, /Resolve exact event diff range/u);
  assert.match(text, /TRUSTED_ROUTE_POLICY_ROOT:\s*\$\{\{ runner\.temp \}\}\/yance-wp0-trusted-route/u);
  assert.match(text, /git worktree add --detach "\$\{TRUSTED_ROUTE_POLICY_ROOT\}" "\$\{BASE_SHA\}"/u);
  assert.match(text, /node "\$\{TRUSTED_ROUTE_POLICY_ROOT\}\/tools\/layered-ci\/select-wp0-route\.js"/u);
  assert.doesNotMatch(text, /uses:\s*\.\/\.github\/actions\/resolve-diff-range/u);
  assert.match(text, /TRUSTED_POLICY_SHA:\s*\$\{\{ needs\.wp0-route\.outputs\.base \}\}/u);
  assert.match(text, /node "\$\{TRUSTED_POLICY_ROOT\}\/tools\/wp0\/verify-gate\.js"/u);
  assert.match(text, /wp0-product:/u);
  assert.match(text, /wp0-product-documentation:/u);
  assert.match(text, /verify-product-documentation\.js/u);
  assert.match(text, /wp0-governance:/u);
  assert.match(text, /wp0-gates:\n\s+name: wp0-gates/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'PRODUCT_WP0'/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'PRODUCT_DOCUMENTATION_WP0'/u);
  assert.match(text, /needs\.wp0-route\.outputs\.route == 'GOVERNANCE_WP0'/u);
  assert.match(text, /PRODUCT_DOCUMENTATION_WP0\)/u);
  assert.doesNotMatch(text, /governance\/layered-ci-reviewed-candidate\s*$/mu);
  assert.doesNotMatch(text, /continue-on-error:\s*true/u);
});

test('GOVERNANCE_WP0 executes the implementation branch policy contract exactly once and fail fast', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows/stage-6459-wp0-gates.yml'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex(line => line === '  wp0-governance:');
  assert.notEqual(start, -1, 'wp0-governance job must exist');
  const nextJobOffset = lines.slice(start + 1).findIndex(line => /^  [a-z0-9][a-z0-9_-]*:$/u.test(line));
  assert.notEqual(nextJobOffset, -1, 'wp0-governance job must have a following top-level job boundary');
  const job = lines.slice(start, start + 1 + nextJobOffset).join('\n');
  const command = 'node --test --test-concurrency=1 tests/wp0/implementation-branch-policy.test.js';
  assert.equal(job.split(command).length - 1, 1, 'branch-policy contract must run exactly once');
  assert.match(
    job,
    /- name: Run implementation branch policy contract\n\s+run: node --test --test-concurrency=1 tests\/wp0\/implementation-branch-policy\.test\.js/u
  );
  assert.doesNotMatch(job, /tests\/wp0\/\*\.test\.js/u);
  assert.doesNotMatch(job, /continue-on-error:\s*true/u);
  assert.doesNotMatch(job, /implementation-branch-policy\.test\.js\s*(?:\|\||;).*true/u);
});

test('base-owned evaluated repository root repair scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    'tools/wp0/lib.js',
    'tests/wp0/base-owned-evaluated-repository-root.test.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true, JSON.stringify(result));
  assert.equal(result.productChangesPresent, false, JSON.stringify(result));
});

test('GOVERNANCE_WP0 executes the base-owned evaluated repository root contract exactly once and fail fast', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows/stage-6459-wp0-gates.yml'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex(line => line === '  wp0-governance:');
  assert.notEqual(start, -1, 'wp0-governance job must exist');
  const nextJobOffset = lines.slice(start + 1).findIndex(line => /^  [a-z0-9][a-z0-9_-]*:$/u.test(line));
  assert.notEqual(nextJobOffset, -1, 'wp0-governance job must have a following top-level job boundary');
  const job = lines.slice(start, start + 1 + nextJobOffset).join('\n');
  const command = 'node --test --test-concurrency=1 tests/wp0/base-owned-evaluated-repository-root.test.js';
  assert.equal(job.split(command).length - 1, 1, 'split-root contract must run exactly once');
  assert.match(
    job,
    /- name: Run base-owned evaluated repository root contract\n\s+run: node --test --test-concurrency=1 tests\/wp0\/base-owned-evaluated-repository-root\.test\.js/u
  );
  assert.doesNotMatch(job, /tests\/wp0\/\*\.test\.js/u);
  assert.doesNotMatch(job, /continue-on-error:\s*true/u);
  assert.doesNotMatch(job, /base-owned-evaluated-repository-root\.test\.js\s*(?:\|\||;).*true/u);
});

test('base-owned evaluated repository root repair scope selects GOVERNANCE_WP0', () => {
  const result = classifyWp0Route(policy, [
    'tools/wp0/lib.js',
    'tests/wp0/base-owned-evaluated-repository-root.test.js'
  ]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true, JSON.stringify(result));
  assert.equal(result.productChangesPresent, false, JSON.stringify(result));
});

test('GOVERNANCE_WP0 executes the base-owned evaluated repository root contract exactly once and fail fast', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows/stage-6459-wp0-gates.yml'), 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex(line => line === '  wp0-governance:');
  assert.notEqual(start, -1, 'wp0-governance job must exist');
  const nextJobOffset = lines.slice(start + 1).findIndex(line => /^  [a-z0-9][a-z0-9_-]*:$/u.test(line));
  assert.notEqual(nextJobOffset, -1, 'wp0-governance job must have a following top-level job boundary');

  const job = lines.slice(start, start + 1 + nextJobOffset).join('\n');
  const command = 'node --test --test-concurrency=1 tests/wp0/base-owned-evaluated-repository-root.test.js';

  assert.equal(job.split(command).length - 1, 1, 'split-root contract must run exactly once');
  assert.match(
    job,
    /- name: Run base-owned evaluated repository root contract\n\s+run: node --test --test-concurrency=1 tests\/wp0\/base-owned-evaluated-repository-root\.test\.js/u
  );
  assert.doesNotMatch(job, /tests\/wp0\/\*\.test\.js/u);
  assert.doesNotMatch(job, /continue-on-error:\s*true/u);
  assert.doesNotMatch(job, /base-owned-evaluated-repository-root\.test\.js\s*(?:\|\||;).*true/u);
});
