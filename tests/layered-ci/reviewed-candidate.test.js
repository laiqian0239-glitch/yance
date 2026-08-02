'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  changedFileSetSha256,
  evaluateReviewedCandidate,
  validateManifest
} = require('../../tools/layered-ci/reviewed-candidate');

const SHA = Object.freeze({
  base: '1'.repeat(40),
  reviewed: '2'.repeat(40),
  tip: '3'.repeat(40),
  evidence: '4'.repeat(40)
});
const reviewedFiles = Object.freeze([
  'backend/runtime/AppRuntime.js',
  'backend/services/authorityWriteHost.js',
  'tests/layered-ci/reviewed-candidate.test.js'
]);
const postReviewPaths = Object.freeze([
  'governance/architecture-closure-v2/wp-a-a6-review-red-evidence.json'
]);

function localDigest(values) {
  const normalized = [...new Set(values)].sort();
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_REVIEWED_CANDIDATE',
    repository: 'laiqian0239-glitch/yance',
    pullRequest: 5,
    authorizedBranch: 'acv2/wp-a-identity-ledger-write-host',
    governanceBase: SHA.base,
    reviewedHead: SHA.reviewed,
    branchTip: SHA.tip,
    reviewedChangedFileCount: reviewedFiles.length,
    reviewedChangedFileSetSha256: localDigest(reviewedFiles),
    allowedPostReviewCommits: [
      { sha: SHA.evidence, classification: 'EVIDENCE_ONLY' }
    ],
    allowedPostReviewPaths: [...postReviewPaths],
    governance: {
      wildcardAuthorizationAllowed: false,
      pr5MustRemainDraft: true,
      automaticClosure: false,
      readyForPromotion: false
    },
    readyForPromotion: false,
    ...overrides
  };
}

function gitAdapter(overrides = {}) {
  const values = {
    remoteTip: SHA.tip,
    reviewedFiles: [...reviewedFiles],
    postReviewCommits: [SHA.evidence],
    postReviewPaths: [...postReviewPaths],
    failBaseAncestor: false,
    failReviewedAncestor: false,
    missingObjects: new Set(),
    ...overrides
  };
  return (args) => {
    const command = args.join(' ');
    if (args[0] === 'cat-file' && args[1] === '-e') {
      const sha = String(args[2]).replace(/\^\{commit\}$/u, '');
      if (values.missingObjects.has(sha)) throw new Error(`missing ${sha}`);
      return '';
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (args[2] === SHA.base && values.failBaseAncestor) throw new Error('not ancestor');
      if (args[2] === SHA.reviewed && values.failReviewedAncestor) throw new Error('not ancestor');
      return '';
    }
    if (args[0] === 'rev-parse') return values.remoteTip;
    if (args[0] === 'rev-list') return values.postReviewCommits.join('\n');
    if (args[0] === 'diff' && args[1] === '--name-only') {
      if (args[2] === SHA.base && args[3] === SHA.reviewed) return values.reviewedFiles.join('\n');
      if (args[2] === SHA.reviewed && args[3] === SHA.tip) return values.postReviewPaths.join('\n');
    }
    throw new Error(`unexpected git command: ${command}`);
  };
}

test('changed file digest is stable across ordering and duplicates', () => {
  assert.equal(changedFileSetSha256([...reviewedFiles].reverse()), localDigest(reviewedFiles));
  assert.equal(changedFileSetSha256([...reviewedFiles, reviewedFiles[0]]), localDigest(reviewedFiles));
});

test('manifest accepts exact evidence authorization and rejects wildcards', () => {
  assert.equal(validateManifest(manifest()).pass, true);
  const wildcard = validateManifest(manifest({ allowedPostReviewPaths: ['governance/**'] }));
  assert.equal(wildcard.pass, false);
  assert.equal(wildcard.reasonCode, 'CANDIDATE_POST_REVIEW_PATH_INVALID');
});

test('manifest rejects unknown post-review classifications and promotion claims', () => {
  const classification = validateManifest(manifest({
    allowedPostReviewCommits: [{ sha: SHA.evidence, classification: 'PRODUCTION_CODE' }]
  }));
  assert.equal(classification.pass, false);
  assert.equal(classification.reasonCode, 'CANDIDATE_POST_REVIEW_CLASSIFICATION_INVALID');

  const promotion = validateManifest(manifest({ readyForPromotion: true }));
  assert.equal(promotion.pass, false);
  assert.equal(promotion.reasonCode, 'CANDIDATE_PROMOTION_MUST_REMAIN_FALSE');
});

test('candidate passes when graph, scope, commits and paths are exact', () => {
  const result = evaluateReviewedCandidate({ manifest: manifest(), git: gitAdapter() });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null);
  assert.equal(result.reviewedHeadVerified, true);
  assert.equal(result.branchTipVerified, true);
  assert.equal(result.reviewedScopeVerified, true);
  assert.equal(result.postReviewCommitsVerified, true);
  assert.equal(result.postReviewPathsVerified, true);
  assert.equal(result.readyForPromotion, false);
});

test('candidate fails closed when authorized branch tip drifts', () => {
  const result = evaluateReviewedCandidate({
    manifest: manifest(),
    git: gitAdapter({ remoteTip: '5'.repeat(40) })
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'BRANCH_TIP_MISMATCH');
});

test('candidate fails closed when reviewed scope digest changes', () => {
  const result = evaluateReviewedCandidate({
    manifest: manifest(),
    git: gitAdapter({ reviewedFiles: [...reviewedFiles, 'backend/runtime/Unreviewed.js'] })
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'REVIEWED_SCOPE_MISMATCH');
});

test('candidate fails closed when post-review commit list expands', () => {
  const result = evaluateReviewedCandidate({
    manifest: manifest(),
    git: gitAdapter({ postReviewCommits: [SHA.evidence, '6'.repeat(40)] })
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'POST_REVIEW_COMMIT_MISMATCH');
});

test('candidate fails closed when post-review path list expands', () => {
  const result = evaluateReviewedCandidate({
    manifest: manifest(),
    git: gitAdapter({ postReviewPaths: [...postReviewPaths, 'backend/runtime/AppRuntime.js'] })
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'POST_REVIEW_PATH_MISMATCH');
});

test('repository A6 manifest preserves the frozen PR #5 identity', () => {
  const manifestPath = path.resolve(__dirname, '..', '..', 'governance', 'layered-ci', 'reviewed-candidate-a6.json');
  const document = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(document.pullRequest, 5);
  assert.equal(document.reviewedHead, '3684dbd840faec8d6e732b0b68eae25f1ad9b2b3');
  assert.equal(document.branchTip, 'e877aec9e16663296e632c224a1da3b7892f1f2b');
  assert.equal(document.reviewedChangedFileCount, 83);
  assert.equal(document.reviewedChangedFileSetSha256, 'd2cac11bd6864b02e09fa68015dbdba5c41bb2777bf79e821f00a846b651702a');
  assert.deepEqual(document.allowedPostReviewPaths, postReviewPaths);
  assert.equal(validateManifest(document).pass, true);
});
