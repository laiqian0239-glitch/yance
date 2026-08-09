'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const implementationBranchPolicy = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTING_POLICY_PATH = 'governance/layered-ci/wp0-routing-policy.json';
const PRESENCE_AUTHORIZATION_PATH = 'governance/layered-ci/v21-presence-avatar-p0-route-bootstrap-authorization.json';
const MEDIA_AUTHORIZATION_PATH = 'governance/layered-ci/v21-media-brain-p0-route-bootstrap-authorization.json';
const PRESENCE_AUTHORIZATION_MERGE = '0c51e0d69a0610de151e55f67c9d46112183eb4f';
const PRESENCE_REVIEWED_HEAD = 'f37aa4eb0cc95f66d02350a84703178428147e0f';
const PRESENCE_AUTHORIZATION_BLOB = '9ee2c41b82d8b48cf1719f65e4cb4a337046ccb4';
const SYNTHETIC_CANDIDATE_HEAD = '1111111111111111111111111111111111111111';
const DENIED = 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED';

const basePolicy = JSON.parse(execFileSync(
  'git',
  ['show', `${PRESENCE_AUTHORIZATION_MERGE}:${ROUTING_POLICY_PATH}`],
  {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: implementationBranchPolicy.buildTrustedGitEnvironment(process.env),
    windowsHide: true
  }
));
const presenceAuthorization = JSON.parse(fs.readFileSync(path.join(ROOT, PRESENCE_AUTHORIZATION_PATH), 'utf8'));
const mediaAuthorization = JSON.parse(fs.readFileSync(path.join(ROOT, MEDIA_AUTHORIZATION_PATH), 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalPathSetSha256(paths) {
  return crypto.createHash('sha256').update([...new Set(paths)].sort().join('\n') + '\n', 'utf8').digest('hex');
}

function declaredPaths(authorization) {
  if (Array.isArray(authorization.futureProductBootstrapPaths)) return authorization.futureProductBootstrapPaths;
  if (Array.isArray(authorization.bootstrapPaths)) return authorization.bootstrapPaths;
  return [];
}

function exactCandidate(authorization) {
  const candidate = clone(basePolicy);
  candidate.productExactPaths = [...new Set([
    ...(candidate.productExactPaths || []),
    ...declaredPaths(authorization)
  ])].sort();
  return candidate;
}

function assertGuardAvailable() {
  const validate = implementationBranchPolicy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function', 'generic delegated route-policy semantic guard must exist');
  return validate;
}

function presenceEvaluatorOptions(candidatePolicy) {
  const baseCommit = presenceAuthorization.base.commit;
  return {
    branch: presenceAuthorization.implementation.branch,
    trustedMainHead: PRESENCE_AUTHORIZATION_MERGE,
    evaluatedHead: SYNTHETIC_CANDIDATE_HEAD,
    listAuthorizationPaths: () => [PRESENCE_AUTHORIZATION_PATH],
    loadAuthorizationAtTrustedHead: () => presenceAuthorization,
    findAuthorizationIntroductionMerges: () => [PRESENCE_AUTHORIZATION_MERGE],
    resolveCommitParents: commit => commit === PRESENCE_AUTHORIZATION_MERGE
      ? [baseCommit, PRESENCE_REVIEWED_HEAD]
      : [],
    isTrustedAncestor: () => true,
    resolveCommitBlobSha: (commit, repositoryPath) => {
      if (repositoryPath !== PRESENCE_AUTHORIZATION_PATH || commit === baseCommit) return null;
      if ([PRESENCE_AUTHORIZATION_MERGE, PRESENCE_REVIEWED_HEAD].includes(commit)) return PRESENCE_AUTHORIZATION_BLOB;
      return null;
    },
    resolveCommitPathMode: (commit, repositoryPath) => {
      if (repositoryPath !== PRESENCE_AUTHORIZATION_PATH || commit === baseCommit) return null;
      if ([PRESENCE_AUTHORIZATION_MERGE, PRESENCE_REVIEWED_HEAD].includes(commit)) return '100644';
      return null;
    },
    resolveChangedFilesBetween: (base, head) => {
      if (base === baseCommit && [PRESENCE_REVIEWED_HEAD, PRESENCE_AUTHORIZATION_MERGE].includes(head)) {
        return [PRESENCE_AUTHORIZATION_PATH];
      }
      if (base === PRESENCE_AUTHORIZATION_MERGE && head === SYNTHETIC_CANDIDATE_HEAD) {
        return [ROUTING_POLICY_PATH];
      }
      return [];
    },
    resolveMergeBases: () => [PRESENCE_AUTHORIZATION_MERGE],
    loadRoutingPolicyAtCommit: commit => {
      if (commit === PRESENCE_AUTHORIZATION_MERGE) return basePolicy;
      if (commit === SYNTHETIC_CANDIDATE_HEAD) return candidatePolicy;
      return null;
    }
  };
}

test('generic delegated route guard accepts both current exact declaration schemas with count and digest closure', () => {
  const validate = assertGuardAvailable();

  assert.equal(presenceAuthorization.futureProductBootstrapPathCount, presenceAuthorization.futureProductBootstrapPaths.length);
  assert.equal(
    canonicalPathSetSha256(presenceAuthorization.futureProductBootstrapPaths),
    presenceAuthorization.futureProductBootstrapPathSetSha256
  );
  assert.equal(mediaAuthorization.bootstrapPathCount, mediaAuthorization.bootstrapPaths.length);
  assert.equal(canonicalPathSetSha256(mediaAuthorization.bootstrapPaths), mediaAuthorization.bootstrapPathSetSha256);

  for (const authorization of [presenceAuthorization, mediaAuthorization]) {
    const result = validate({ authorization, basePolicy, candidatePolicy: exactCandidate(authorization) });
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.reasonCode, null, JSON.stringify(result));
  }
});

test('generic delegated route guard rejects ambiguous, unsupported, non-exact, count-drifted and digest-drifted declarations', () => {
  const validate = assertGuardAvailable();
  const candidatePolicy = exactCandidate(presenceAuthorization);

  const ambiguous = clone(presenceAuthorization);
  ambiguous.bootstrapPaths = [...presenceAuthorization.futureProductBootstrapPaths];
  ambiguous.bootstrapPathCount = ambiguous.bootstrapPaths.length;
  ambiguous.bootstrapPathSetSha256 = canonicalPathSetSha256(ambiguous.bootstrapPaths);
  assert.equal(validate({ authorization: ambiguous, basePolicy, candidatePolicy }).reasonCode, DENIED);

  const unsupported = clone(presenceAuthorization);
  delete unsupported.futureProductBootstrapPaths;
  delete unsupported.futureProductBootstrapPathCount;
  delete unsupported.futureProductBootstrapPathSetSha256;
  unsupported.routePaths = [...presenceAuthorization.futureProductBootstrapPaths];
  assert.equal(validate({ authorization: unsupported, basePolicy, candidatePolicy }).reasonCode, DENIED);

  const nonExact = clone(presenceAuthorization);
  nonExact.futureProductBootstrapPaths = ['runtime/presence-avatar/*'];
  nonExact.futureProductBootstrapPathCount = 1;
  nonExact.futureProductBootstrapPathSetSha256 = canonicalPathSetSha256(nonExact.futureProductBootstrapPaths);
  const nonExactCandidate = clone(basePolicy);
  nonExactCandidate.productExactPaths = [...basePolicy.productExactPaths, ...nonExact.futureProductBootstrapPaths].sort();
  assert.equal(validate({ authorization: nonExact, basePolicy, candidatePolicy: nonExactCandidate }).reasonCode, DENIED);

  const wrongCount = clone(presenceAuthorization);
  wrongCount.futureProductBootstrapPathCount += 1;
  assert.equal(validate({ authorization: wrongCount, basePolicy, candidatePolicy }).reasonCode, DENIED);

  const wrongDigest = clone(presenceAuthorization);
  wrongDigest.futureProductBootstrapPathSetSha256 = '0'.repeat(64);
  assert.equal(validate({ authorization: wrongDigest, basePolicy, candidatePolicy }).reasonCode, DENIED);
});

test('generic delegated route guard rejects every routing-policy semantic mutation except frozen exact additions', () => {
  const validate = assertGuardAvailable();
  const authorization = presenceAuthorization;

  const mutations = [];
  const broadPrefix = exactCandidate(authorization);
  broadPrefix.productPrefixes = [...broadPrefix.productPrefixes, 'runtime/'];
  mutations.push(broadPrefix);

  const unrelatedExact = exactCandidate(authorization);
  unrelatedExact.productExactPaths.push('runtime/presence-avatar/unapproved/runtime.json');
  mutations.push(unrelatedExact);

  const removedExisting = exactCandidate(authorization);
  const originalExact = basePolicy.productExactPaths[0];
  removedExisting.productExactPaths = removedExisting.productExactPaths.filter(file => file !== originalExact);
  mutations.push(removedExisting);

  const weakenedFailClosed = exactCandidate(authorization);
  weakenedFailClosed.unknownPathFailsClosed = false;
  mutations.push(weakenedFailClosed);

  const governanceDrift = exactCandidate(authorization);
  governanceDrift.governancePrefixes = [...governanceDrift.governancePrefixes, 'runtime/'];
  mutations.push(governanceDrift);

  const documentationDrift = exactCandidate(authorization);
  documentationDrift.productDocumentationExtensions = [...documentationDrift.productDocumentationExtensions, '.txt'];
  mutations.push(documentationDrift);

  for (const candidatePolicy of mutations) {
    const result = validate({ authorization, basePolicy, candidatePolicy });
    assert.equal(result.pass, false, JSON.stringify(result));
    assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
  }
});

test('trusted delegated branch evaluator must invoke the semantic guard for an authorized routing-policy filename', () => {
  const exact = implementationBranchPolicy.evaluateTrustedDelegatedGovernanceBranch(
    presenceEvaluatorOptions(exactCandidate(presenceAuthorization))
  );
  assert.equal(exact.pass, true, JSON.stringify(exact));

  const malicious = exactCandidate(presenceAuthorization);
  malicious.productPrefixes = [...malicious.productPrefixes, 'runtime/'];
  const rejected = implementationBranchPolicy.evaluateTrustedDelegatedGovernanceBranch(
    presenceEvaluatorOptions(malicious)
  );
  assert.equal(rejected.pass, false, JSON.stringify(rejected));
  assert.equal(rejected.reasonCode, DENIED, JSON.stringify(rejected));
});
