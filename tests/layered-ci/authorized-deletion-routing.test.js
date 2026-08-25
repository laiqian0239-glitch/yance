'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ROUTES,
  classifyAuthorizedDeletionFallback,
  classifyWp0Route
} = require('../../tools/layered-ci/wp0-routing');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'),
  'utf8'
));

const BRANCH = 'fix/v21-accidental-root-noop-cleanup-p0';
const PATHS = Object.freeze(['noop', 'noop2']);

function trustedAuthorization({
  branch = BRANCH,
  paths = PATHS,
  trusted = true,
  authorizationPath = 'governance/layered-ci/example-authorization.json'
} = {}) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    trustedMergedBaseAuthorization: trusted,
    authorizationPath,
    implementation: {
      branch,
      allowedChangedPaths: [...paths]
    }
  };
}

function unknownResult(paths = PATHS) {
  const result = classifyWp0Route(policy, paths);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'WP0_ROUTE_UNKNOWN_PATH');
  return result;
}

test('exact merged delegated authorization plus deletion-only diff escalates unknown paths to PRODUCT_WP0', () => {
  const result = classifyAuthorizedDeletionFallback(unknownResult(), {
    changedFiles: [...PATHS],
    deletedFiles: [...PATHS],
    branch: BRANCH,
    authorizations: [trustedAuthorization()]
  });

  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT);
  assert.equal(result.productChangesPresent, true);
  assert.equal(result.governanceChangesPresent, false);
  assert.equal(result.productDocumentationChangesPresent, false);
  assert.equal(result.authorizedDeletionFallback, true);
});

test('unauthorized branch remains fail-closed', () => {
  const normal = unknownResult();
  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles: [...PATHS],
    deletedFiles: [...PATHS],
    branch: `${BRANCH}-other`,
    authorizations: [trustedAuthorization()]
  });
  assert.equal(result, normal);
});

test('partial authorized path set remains fail-closed', () => {
  const normal = unknownResult(['noop']);
  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles: ['noop'],
    deletedFiles: ['noop'],
    branch: BRANCH,
    authorizations: [trustedAuthorization()]
  });
  assert.equal(result, normal);
});

test('superset changed path set remains fail-closed', () => {
  const changedFiles = ['noop', 'noop2', 'noop3'];
  const normal = unknownResult(changedFiles);
  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles,
    deletedFiles: changedFiles,
    branch: BRANCH,
    authorizations: [trustedAuthorization()]
  });
  assert.equal(result, normal);
});

test('addition or modification mixed with a deletion remains fail-closed', () => {
  const normal = unknownResult();
  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles: [...PATHS],
    deletedFiles: ['noop'],
    branch: BRANCH,
    authorizations: [trustedAuthorization()]
  });
  assert.equal(result, normal);
});

test('candidate-owned or otherwise untrusted authorization remains fail-closed', () => {
  const normal = unknownResult();
  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles: [...PATHS],
    deletedFiles: [...PATHS],
    branch: BRANCH,
    authorizations: [trustedAuthorization({ trusted: false })]
  });
  assert.equal(result, normal);
});

test('ambiguous matching merged authorizations remain fail-closed', () => {
  const normal = unknownResult();
  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles: [...PATHS],
    deletedFiles: [...PATHS],
    branch: BRANCH,
    authorizations: [
      trustedAuthorization({ authorizationPath: 'governance/layered-ci/first-authorization.json' }),
      trustedAuthorization({ authorizationPath: 'governance/layered-ci/second-authorization.json' })
    ]
  });
  assert.equal(result, normal);
});

test('ordinary known-path routing is never replaced by the deletion fallback', () => {
  const normal = classifyWp0Route(policy, ['backend/runtime/AppRuntime.js']);
  assert.equal(normal.pass, true);
  assert.equal(normal.route, ROUTES.PRODUCT);

  const result = classifyAuthorizedDeletionFallback(normal, {
    changedFiles: ['backend/runtime/AppRuntime.js'],
    deletedFiles: ['backend/runtime/AppRuntime.js'],
    branch: BRANCH,
    authorizations: [trustedAuthorization({ paths: ['backend/runtime/AppRuntime.js'] })]
  });
  assert.equal(result, normal);
});

test('static policy keeps unknown-path fail-closed and does not permanently classify cleanup root names', () => {
  assert.equal(policy.unknownPathFailsClosed, true);
  assert.equal(policy.readyForPromotion, false);
  assert.equal(policy.productExactPaths.includes('noop'), false);
  assert.equal(policy.productExactPaths.includes('noop2'), false);
  assert.equal(policy.governanceExactPaths.includes('noop'), false);
  assert.equal(policy.governanceExactPaths.includes('noop2'), false);
});

test('selector derives deletion fallback authority only from exact base history and ordinary two-parent merge provenance', () => {
  const selector = fs.readFileSync(path.join(ROOT, 'tools/layered-ci/select-wp0-route.js'), 'utf8');
  assert.match(selector, /gitText\(\[\s*'grep'/u);
  assert.match(selector, /branch,\s*base,\s*'--',\s*'governance\/layered-ci'/u);
  assert.match(selector, /'--first-parent'/u);
  assert.match(selector, /'rev-list', '--parents', '-n', '1', mergeCommit/u);
  assert.match(selector, /mergeBlob !== secondParentBlob/u);
  assert.match(selector, /firstParentBlob === mergeBlob/u);
  assert.match(selector, /'--diff-filter=D'/u);
  assert.match(selector, /'--no-renames'/u);
  assert.doesNotMatch(selector, /productExactPaths.*noop|governanceExactPaths.*noop/u);
});
