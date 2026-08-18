'use strict';

const legacy = require('./work-package-scope-gate-legacy');
const { decodeChangedFileBuffer } = legacy;
const {
  evaluateAuthorizedWpBScope,
  resolveWpBImplementationAuthority
} = require('../../shared/release/implementationBranchPolicy');

function result(values = {}) {
  return Object.freeze({
    applicable: true,
    pass: false,
    reasonCode: 'ACV2_WP_B_SCOPE_INVALID',
    workPackage: 'WP-B',
    parentGovernanceHead: '',
    effectiveBranch: '',
    changedFileCount: 0,
    unauthorizedPaths: [],
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: false,
    openSourceWorkPackageScopeApplied: false,
    activeTask: null,
    defectId: null,
    readyForPromotion: false,
    ...values
  });
}

function gitFailure(reasonCode, cause, details = {}) {
  return result({
    pass: false,
    reasonCode,
    error: cause?.message || String(cause),
    ...details
  });
}

function hasExplicitLegacyContext(options = {}) {
  return [
    'authorization',
    'postMergeDefect',
    'taskScopeChain',
    'amendment'
  ].some(key => Object.prototype.hasOwnProperty.call(options, key));
}

function evaluateWpBScopeForGate(options, authority) {
  const branch = String(options.branch || '');
  const git = options.git;
  const detachedEvidence = !branch
    && options.evidenceMode === true
    && typeof options.evidenceSourceCommit === 'string'
    && /^[a-f0-9]{40}$/u.test(options.evidenceSourceCommit);
  const effectiveBranch = detachedEvidence ? authority.authorizedBranch : branch;
  if (effectiveBranch !== authority.authorizedBranch) {
    return result({
      pass: false,
      reasonCode: 'ACV2_WP_B_AUTHORIZATION_INVALID',
      effectiveBranch,
      parentGovernanceHead: authority.baseHead
    });
  }
  if (typeof git !== 'function') {
    return result({
      pass: false,
      reasonCode: 'ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED',
      effectiveBranch,
      parentGovernanceHead: authority.baseHead
    });
  }

  if (detachedEvidence) {
    try {
      const head = git(['rev-parse', 'HEAD']);
      if (head !== options.evidenceSourceCommit) {
        return result({
          pass: false,
          reasonCode: 'ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_COMMIT_MISMATCH',
          effectiveBranch,
          parentGovernanceHead: authority.baseHead,
          expectedEvidenceSourceCommit: options.evidenceSourceCommit,
          actualHead: head
        });
      }
    } catch (cause) {
      return gitFailure('ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_HEAD_UNAVAILABLE', cause, {
        effectiveBranch,
        parentGovernanceHead: authority.baseHead
      });
    }
  }

  try {
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    if (status) {
      return result({
        pass: false,
        reasonCode: 'ACV2_WORK_PACKAGE_SCOPE_WORKTREE_DIRTY',
        effectiveBranch,
        parentGovernanceHead: authority.baseHead,
        dirtyEntries: status.split(/\r?\n/u).filter(Boolean)
      });
    }
  } catch (cause) {
    return gitFailure('ACV2_WORK_PACKAGE_SCOPE_WORKTREE_STATUS_FAILED', cause, {
      effectiveBranch,
      parentGovernanceHead: authority.baseHead
    });
  }

  try {
    git(['cat-file', '-e', `${authority.baseHead}^{commit}`]);
    git(['merge-base', '--is-ancestor', authority.baseHead, 'HEAD']);
  } catch (cause) {
    return gitFailure('ACV2_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE', cause, {
      effectiveBranch,
      parentGovernanceHead: authority.baseHead
    });
  }

  let changedFiles;
  try {
    const raw = git([
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-only',
      '-z',
      authority.baseHead,
      'HEAD',
      '--'
    ], { encoding: null, trim: false });
    changedFiles = decodeChangedFileBuffer(raw);
  } catch (cause) {
    return gitFailure('ACV2_WORK_PACKAGE_SCOPE_DIFF_FAILED', cause, {
      effectiveBranch,
      parentGovernanceHead: authority.baseHead
    });
  }

  const evaluation = evaluateAuthorizedWpBScope({
    authority,
    branch: effectiveBranch,
    changedFiles
  });
  return result({
    ...evaluation,
    applicable: true,
    workPackage: 'WP-B',
    parentGovernanceHead: authority.baseHead,
    effectiveBranch,
    changedFileCount: changedFiles.length,
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: false,
    openSourceWorkPackageScopeApplied: false,
    activeTask: null,
    defectId: null,
    readyForPromotion: false
  });
}

function evaluateWorkPackageScopeForGate(options = {}) {
  if (hasExplicitLegacyContext(options)
      && !Object.prototype.hasOwnProperty.call(options, 'wpBAuthority')) {
    return legacy.evaluateWorkPackageScopeForGate(options);
  }
  const authority = Object.prototype.hasOwnProperty.call(options, 'wpBAuthority')
    ? options.wpBAuthority
    : resolveWpBImplementationAuthority(options);
  const branch = String(options.branch || '');
  const detachedEvidence = !branch
    && options.evidenceMode === true
    && typeof options.evidenceSourceCommit === 'string'
    && /^[a-f0-9]{40}$/u.test(options.evidenceSourceCommit);
  if (authority && (branch === authority.authorizedBranch || detachedEvidence)) {
    return evaluateWpBScopeForGate(options, authority);
  }
  return legacy.evaluateWorkPackageScopeForGate(options);
}

module.exports = Object.freeze({ decodeChangedFileBuffer, evaluateWorkPackageScopeForGate });