'use strict';

const {
  ACV2_AUTHORIZATION_BLOB_SHA,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  evaluateAuthorizedPostMergeDefectScope,
  evaluateAuthorizedWorkPackageScope,
  evaluateAuthorizedWorkPackageTaskScope,
  isValidWorkPackagePostMergeDefect,
  loadWorkPackageAuthorization,
  loadWorkPackagePostMergeDefect,
  loadWorkPackageScopeAmendment,
  loadWorkPackageTaskScopeChain,
  validateWorkPackageTaskScopeChain
} = require('../../shared/release/implementationBranchPolicy');

function scopeResult(values) {
  return Object.freeze({
    applicable: true,
    parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
    effectiveBranch: '',
    changedFileCount: 0,
    unauthorizedPaths: [],
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: false,
    activeTask: null,
    defectId: null,
    readyForPromotion: false,
    ...values
  });
}

function fail(reasonCode, details = {}) {
  return scopeResult({ pass: false, reasonCode, ...details, readyForPromotion: false });
}

function readChangedFiles(git, baseHead, effectiveBranch) {
  try {
    const raw = git([
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-only',
      baseHead,
      'HEAD',
      '--'
    ]);
    return raw
      ? [...new Set(raw.split(/\r?\n/u).map(value => value.trim()).filter(Boolean))].sort()
      : [];
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_DIFF_FAILED', {
      effectiveBranch,
      parentGovernanceHead: baseHead,
      error: cause?.message || String(cause)
    });
  }
}

function readHead(git) {
  try {
    return { pass: true, head: git(['rev-parse', 'HEAD']) };
  } catch (cause) {
    return {
      pass: false,
      result: fail('ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_HEAD_UNAVAILABLE', {
        error: cause?.message || String(cause)
      })
    };
  }
}

function requireCleanWorktree(git, effectiveBranch, details = {}) {
  try {
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    if (!status) return null;
    return fail('ACV2_WORK_PACKAGE_SCOPE_WORKTREE_DIRTY', {
      effectiveBranch,
      ...details,
      dirtyEntries: status.split(/\r?\n/u).filter(Boolean)
    });
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_WORKTREE_STATUS_FAILED', {
      effectiveBranch,
      ...details,
      error: cause?.message || String(cause)
    });
  }
}

function requireAncestor(git, baseHead, effectiveBranch, details = {}) {
  try {
    git(['cat-file', '-e', `${baseHead}^{commit}`]);
    git(['merge-base', '--is-ancestor', baseHead, 'HEAD']);
    return null;
  } catch (cause) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE', {
      effectiveBranch,
      parentGovernanceHead: baseHead,
      ...details,
      error: cause?.message || String(cause)
    });
  }
}

function evaluatePostMergeDefectScope(options) {
  const { defect, detachedEvidence, evidenceSourceCommit, git } = options;
  const effectiveBranch = String(defect.scope.targetBranch || '');
  const defectDetails = { defectId: defect.defectId, postMergeDefectScopeApplied: true };

  if (typeof git !== 'function') {
    return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED', { effectiveBranch, ...defectDetails });
  }
  if (detachedEvidence) {
    const resolved = readHead(git);
    if (!resolved.pass) return resolved.result;
    if (resolved.head !== evidenceSourceCommit) {
      return fail('ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_COMMIT_MISMATCH', {
        effectiveBranch,
        ...defectDetails,
        expectedEvidenceSourceCommit: evidenceSourceCommit,
        actualHead: resolved.head
      });
    }
  }

  const dirty = requireCleanWorktree(git, effectiveBranch, defectDetails);
  if (dirty) return dirty;
  const baseHead = String(defect.scope.baseHead || '');
  const unavailable = requireAncestor(git, baseHead, effectiveBranch, defectDetails);
  if (unavailable) return unavailable;

  const changedFiles = readChangedFiles(git, baseHead, effectiveBranch);
  if (!Array.isArray(changedFiles)) return changedFiles;
  const evaluation = evaluateAuthorizedPostMergeDefectScope({
    branch: effectiveBranch,
    changedFiles,
    defect
  });
  return scopeResult({
    ...evaluation,
    parentGovernanceHead: baseHead,
    effectiveBranch,
    changedFileCount: changedFiles.length,
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: true,
    activeTask: null,
    defectId: defect.defectId
  });
}

function evaluateWorkPackageScopeForGate(options = {}) {
  const branch = String(options.branch || '');
  const git = options.git;
  const authorization = Object.prototype.hasOwnProperty.call(options, 'authorization')
    ? options.authorization
    : loadWorkPackageAuthorization();
  const defect = Object.prototype.hasOwnProperty.call(options, 'postMergeDefect')
    ? options.postMergeDefect
    : loadWorkPackagePostMergeDefect();
  const detachedEvidence = !branch
    && options.evidenceMode === true
    && typeof options.evidenceSourceCommit === 'string'
    && /^[0-9a-f]{40}$/u.test(options.evidenceSourceCommit);
  const defectValid = isValidWorkPackagePostMergeDefect(defect);
  const defectTargetBranch = defectValid ? String(defect.scope.targetBranch || '') : '';
  const defectApplies = defectValid && (branch === defectTargetBranch || detachedEvidence);

  if (defectApplies) {
    return evaluatePostMergeDefectScope({
      defect,
      detachedEvidence,
      evidenceSourceCommit: options.evidenceSourceCommit,
      git
    });
  }
  if (defect && !defectValid && (detachedEvidence || branch === 'stage/6.4.5.9-architecture-closure')) {
    return fail('ACV2_POST_MERGE_DEFECT_SCOPE_INVALID', {
      effectiveBranch: branch,
      postMergeDefectScopeApplied: true
    });
  }

  let effectiveBranch = branch;
  if (detachedEvidence && authorization?.authorizedBranch) {
    if (typeof git !== 'function') return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED');
    const resolved = readHead(git);
    if (!resolved.pass) return resolved.result;
    if (resolved.head !== options.evidenceSourceCommit) {
      return fail('ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_COMMIT_MISMATCH', {
        expectedEvidenceSourceCommit: options.evidenceSourceCommit,
        actualHead: resolved.head
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
      unauthorizedPaths: [],
      taskScopeChainApplied: false,
      postMergeDefectScopeApplied: false,
      activeTask: null,
      defectId: null,
      readyForPromotion: false
    });
  }
  if (typeof git !== 'function') return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED', { effectiveBranch });
  if (!authorization || effectiveBranch !== authorization.authorizedBranch) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_AUTHORIZATION_INVALID', { effectiveBranch });
  }

  const dirty = requireCleanWorktree(git, effectiveBranch);
  if (dirty) return dirty;

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

  const unavailable = requireAncestor(git, ACV2_WP_A_PARENT_GOVERNANCE_HEAD, effectiveBranch);
  if (unavailable) return unavailable;
  const changedFiles = readChangedFiles(git, ACV2_WP_A_PARENT_GOVERNANCE_HEAD, effectiveBranch);
  if (!Array.isArray(changedFiles)) return changedFiles;

  const taskScopeChain = Object.prototype.hasOwnProperty.call(options, 'taskScopeChain')
    ? options.taskScopeChain
    : loadWorkPackageTaskScopeChain();
  if (taskScopeChain) {
    if (!validateWorkPackageTaskScopeChain(taskScopeChain, authorization)) {
      return fail('ACV2_TASK_SCOPE_CHAIN_INVALID', {
        effectiveBranch,
        changedFileCount: changedFiles.length
      });
    }
    const evaluation = evaluateAuthorizedWorkPackageTaskScope({
      branch: effectiveBranch,
      changedFiles,
      authorization,
      taskScopeChain
    });
    return scopeResult({
      ...evaluation,
      effectiveBranch,
      changedFileCount: changedFiles.length,
      taskScopeChainApplied: true,
      postMergeDefectScopeApplied: false,
      activeTask: taskScopeChain.activeTask
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
    changedFileCount: changedFiles.length,
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: false,
    activeTask: null
  });
}

module.exports = { evaluateWorkPackageScopeForGate };
