'use strict';

const {
  ACV2_AUTHORIZATION_BLOB_SHA,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  evaluateAuthorizedWorkPackageScope,
  loadWorkPackageAuthorization,
  loadWorkPackageScopeAmendment
} = require('../../shared/release/implementationBranchPolicy');

function scopeResult(values) {
  return Object.freeze({
    applicable: true,
    parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
    effectiveBranch: '',
    changedFileCount: 0,
    unauthorizedPaths: [],
    ...values
  });
}

function fail(reasonCode, details = {}) {
  return scopeResult({ pass: false, reasonCode, ...details });
}

function evaluateWorkPackageScopeForGate(options = {}) {
  const branch = String(options.branch || '');
  const git = options.git;
  const authorization = Object.prototype.hasOwnProperty.call(options, 'authorization')
    ? options.authorization
    : loadWorkPackageAuthorization();
  const detachedEvidence = !branch
    && options.evidenceMode === true
    && typeof options.evidenceSourceCommit === 'string'
    && /^[0-9a-f]{40}$/u.test(options.evidenceSourceCommit);
  let effectiveBranch = branch;

  if (detachedEvidence && authorization?.authorizedBranch) {
    if (typeof git !== 'function') {
      return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED');
    }
    let actualHead;
    try {
      actualHead = git(['rev-parse', 'HEAD']);
    } catch (cause) {
      return fail('ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_HEAD_UNAVAILABLE', {
        error: cause?.message || String(cause)
      });
    }
    if (actualHead !== options.evidenceSourceCommit) {
      return fail('ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_COMMIT_MISMATCH', {
        expectedEvidenceSourceCommit: options.evidenceSourceCommit,
        actualHead
      });
    }
    effectiveBranch = String(authorization.authorizedBranch || '');
  }

  if (!/^acv2\//u.test(effectiveBranch)) {
    return Object.freeze({
      applicable: false,
      pass: true,
      reasonCode: null,
      parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
      effectiveBranch,
      changedFileCount: 0,
      unauthorizedPaths: []
    });
  }
  if (typeof git !== 'function') {
    return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED', { effectiveBranch });
  }
  if (!authorization || effectiveBranch !== authorization.authorizedBranch) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_AUTHORIZATION_INVALID', { effectiveBranch });
  }

  let worktreeStatus;
  try {
    worktreeStatus = git(['status', '--porcelain=v1', '--untracked-files=all']);
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_WORKTREE_STATUS_FAILED', {
      effectiveBranch,
      error: cause?.message || String(cause)
    });
  }
  if (worktreeStatus) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_WORKTREE_DIRTY', {
      effectiveBranch,
      dirtyEntries: worktreeStatus.split(/\r?\n/u).filter(Boolean)
    });
  }

  let authorizationBlob;
  try {
    authorizationBlob = git(['rev-parse', `HEAD:${ACV2_AUTHORIZATION_REPOSITORY_PATH}`]);
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_AUTHORIZATION_BLOB_MISSING', {
      effectiveBranch,
      error: cause?.message || String(cause)
    });
  }
  if (authorizationBlob !== ACV2_AUTHORIZATION_BLOB_SHA) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_AUTHORIZATION_BLOB_MISMATCH', {
      effectiveBranch,
      expectedAuthorizationBlob: ACV2_AUTHORIZATION_BLOB_SHA,
      actualAuthorizationBlob: authorizationBlob
    });
  }

  try {
    git(['cat-file', '-e', `${ACV2_WP_A_PARENT_GOVERNANCE_HEAD}^{commit}`]);
    git(['merge-base', '--is-ancestor', ACV2_WP_A_PARENT_GOVERNANCE_HEAD, 'HEAD']);
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE', {
      effectiveBranch,
      error: cause?.message || String(cause)
    });
  }

  let changedFiles;
  try {
    const raw = git(['diff', '--name-only', ACV2_WP_A_PARENT_GOVERNANCE_HEAD, 'HEAD']);
    changedFiles = raw
      ? [...new Set(raw.split(/\r?\n/u).map(value => value.trim()).filter(Boolean))].sort()
      : [];
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_DIFF_FAILED', {
      effectiveBranch,
      error: cause?.message || String(cause)
    });
  }

  const amendment = Object.prototype.hasOwnProperty.call(options, 'amendment')
    ? options.amendment
    : loadWorkPackageScopeAmendment();
  const evaluation = evaluateAuthorizedWorkPackageScope({
    branch: effectiveBranch,
    changedFiles,
    authorization,
    amendment
  });
  return scopeResult({
    ...evaluation,
    effectiveBranch,
    changedFileCount: changedFiles.length
  });
}

module.exports = { evaluateWorkPackageScopeForGate };
