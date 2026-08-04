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
const {
  evaluateAuthorizedOpenSourceWorkPackageScope,
  filterOpenSourceImplementationChangedFiles,
  isAuthorizedOpenSourceImplementationBranch,
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  loadOpenSourceWorkPackageRegistry,
  resolveOpenSourceAuthorizationForBranch,
  selectOpenSourceWorkPackageRegistryEntry,
  validateOpenSourceWorkPackageRegistry
} = require('../../shared/release/openSourceWorkPackagePolicy');

function scopeResult(values) {
  return Object.freeze({
    applicable: true,
    parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
    effectiveBranch: '',
    changedFileCount: 0,
    unauthorizedPaths: [],
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: false,
    openSourceWorkPackageScopeApplied: false,
    activeTask: null,
    defectId: null,
    workPackage: null,
    readyForPromotion: false,
    ...values
  });
}

function fail(reasonCode, details = {}) {
  return scopeResult({ pass: false, reasonCode, ...details, readyForPromotion: false });
}

function readChangedFiles(git, baseHead, effectiveBranch, failurePrefix = 'ACV2') {
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
    return fail(`${failurePrefix}_WORK_PACKAGE_SCOPE_DIFF_FAILED`, {
      effectiveBranch,
      parentGovernanceHead: baseHead,
      error: cause?.message || String(cause)
    });
  }
}

function readHead(git, effectiveBranch, details = {}, failurePrefix = 'ACV2') {
  try {
    return { pass: true, head: git(['rev-parse', 'HEAD']) };
  } catch (cause) {
    return {
      pass: false,
      result: fail(`${failurePrefix}_WORK_PACKAGE_SCOPE_EVIDENCE_HEAD_UNAVAILABLE`, {
        effectiveBranch,
        ...details,
        error: cause?.message || String(cause)
      })
    };
  }
}

function readRemoteBranchTip(git, branch) {
  if (typeof git !== 'function' || typeof branch !== 'string' || !branch) return null;
  try {
    return git(['rev-parse', `refs/remotes/origin/${branch}`]);
  } catch (_) {
    return null;
  }
}

function detachedEvidenceBelongsToBranch(git, branch, evidenceSourceCommit) {
  return /^[0-9a-f]{40}$/u.test(String(evidenceSourceCommit || ''))
    && readRemoteBranchTip(git, branch) === evidenceSourceCommit;
}

function requireCleanWorktree(git, effectiveBranch, details = {}, failurePrefix = 'ACV2') {
  try {
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    if (!status) return null;
    return fail(`${failurePrefix}_WORK_PACKAGE_SCOPE_WORKTREE_DIRTY`, {
      effectiveBranch,
      ...details,
      dirtyEntries: status.split(/\r?\n/u).filter(Boolean)
    });
  } catch (cause) {
    return fail(`${failurePrefix}_WORK_PACKAGE_SCOPE_WORKTREE_STATUS_FAILED`, {
      effectiveBranch,
      ...details,
      error: cause?.message || String(cause)
    });
  }
}

function requireAncestor(git, baseHead, effectiveBranch, details = {}, failurePrefix = 'ACV2') {
  try {
    git(['cat-file', '-e', `${baseHead}^{commit}`]);
    git(['merge-base', '--is-ancestor', baseHead, 'HEAD']);
    return null;
  } catch (cause) {
    return fail(`${failurePrefix}_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE`, {
      effectiveBranch,
      parentGovernanceHead: baseHead,
      ...details,
      error: cause?.message || String(cause)
    });
  }
}

function requireEvidenceHead(git, effectiveBranch, evidenceSourceCommit, details = {}, failurePrefix = 'ACV2') {
  const resolved = readHead(git, effectiveBranch, details, failurePrefix);
  if (!resolved.pass) return resolved.result;
  if (resolved.head === evidenceSourceCommit) return null;
  return fail(`${failurePrefix}_WORK_PACKAGE_SCOPE_EVIDENCE_COMMIT_MISMATCH`, {
    effectiveBranch,
    ...details,
    expectedEvidenceSourceCommit: evidenceSourceCommit,
    actualHead: resolved.head
  });
}

function evaluatePostMergeDefectScope(options) {
  const { defect, detachedEvidence, evidenceSourceCommit, git } = options;
  const effectiveBranch = String(defect.scope.targetBranch || '');
  const defectDetails = { defectId: defect.defectId, postMergeDefectScopeApplied: true };

  if (typeof git !== 'function') {
    return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED', { effectiveBranch, ...defectDetails });
  }
  if (detachedEvidence) {
    const mismatch = requireEvidenceHead(git, effectiveBranch, evidenceSourceCommit, defectDetails, 'ACV2');
    if (mismatch) return mismatch;
  }

  const dirty = requireCleanWorktree(git, effectiveBranch, defectDetails, 'ACV2');
  if (dirty) return dirty;
  const baseHead = String(defect.scope.baseHead || '');
  const unavailable = requireAncestor(git, baseHead, effectiveBranch, defectDetails, 'ACV2');
  if (unavailable) return unavailable;

  const changedFiles = readChangedFiles(git, baseHead, effectiveBranch, 'ACV2');
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
    openSourceWorkPackageScopeApplied: false,
    activeTask: null,
    defectId: defect.defectId
  });
}

function verifyOpenSourceAuthorizationAnchor(git, authorization, receipt) {
  try {
    git(['cat-file', '-e', `${receipt.authorizationCommit}^{commit}`]);
    git(['merge-base', '--is-ancestor', receipt.authorizationCommit, 'HEAD']);
    const blob = git(['rev-parse', `${receipt.authorizationCommit}:${receipt.authorizationPath}`]);
    if (blob !== receipt.authorizationBlobSha) {
      return fail('OSS_WORK_PACKAGE_AUTHORIZATION_BLOB_MISMATCH', {
        effectiveBranch: authorization.authorizedBranch,
        expectedAuthorizationBlob: receipt.authorizationBlobSha,
        actualAuthorizationBlob: blob,
        openSourceWorkPackageScopeApplied: true,
        workPackage: authorization.workPackage
      });
    }
    return null;
  } catch (cause) {
    return fail('OSS_WORK_PACKAGE_AUTHORIZATION_ANCHOR_INVALID', {
      effectiveBranch: authorization.authorizedBranch,
      openSourceWorkPackageScopeApplied: true,
      workPackage: authorization.workPackage,
      error: cause?.message || String(cause)
    });
  }
}

function openSourceImplementationBase(authorization, receipt) {
  const explicit = String(receipt?.implementationBaseCommit || '');
  if (/^[0-9a-f]{40}$/u.test(explicit)) return explicit;
  if (authorization?.workPackage === 'OSS-0'
    && /^[0-9a-f]{40}$/u.test(String(receipt?.authorizationCommit || ''))) {
    return receipt.authorizationCommit;
  }
  return '';
}

function implementationFilesSinceBase(git, baseHead, effectiveBranch, registry) {
  const changed = readChangedFiles(git, baseHead, effectiveBranch, 'OSS');
  return Array.isArray(changed)
    ? filterOpenSourceImplementationChangedFiles(changed, { registry })
    : changed;
}

function evaluateOpenSourceWorkPackageScope(options) {
  const {
    authorization,
    receipt,
    entry,
    registry,
    authorizationFileSha256,
    detachedEvidence,
    evidenceSourceCommit,
    git
  } = options;
  const effectiveBranch = String(authorization?.authorizedBranch || '');
  const details = {
    openSourceWorkPackageScopeApplied: true,
    workPackage: authorization?.workPackage || null
  };

  if (typeof git !== 'function') {
    return fail('OSS_WORK_PACKAGE_SCOPE_GIT_REQUIRED', { effectiveBranch, ...details });
  }
  if (!isAuthorizedOpenSourceImplementationBranch(effectiveBranch, {
    authorization,
    receipt,
    entry,
    registry,
    authorizationFileSha256
  })) {
    return fail('OSS_WORK_PACKAGE_AUTHORIZATION_INVALID', { effectiveBranch, ...details });
  }
  if (detachedEvidence) {
    const mismatch = requireEvidenceHead(git, effectiveBranch, evidenceSourceCommit, details, 'OSS');
    if (mismatch) return mismatch;
  }
  const dirty = requireCleanWorktree(git, effectiveBranch, details, 'OSS');
  if (dirty) return dirty;
  const anchorFailure = verifyOpenSourceAuthorizationAnchor(git, authorization, receipt);
  if (anchorFailure) return anchorFailure;

  const baseHead = openSourceImplementationBase(authorization, receipt);
  if (!baseHead) return fail('OSS_WORK_PACKAGE_AUTHORIZATION_INVALID', { effectiveBranch, ...details });
  const unavailable = requireAncestor(git, baseHead, effectiveBranch, details, 'OSS');
  if (unavailable) return unavailable;

  const changedFiles = implementationFilesSinceBase(git, baseHead, effectiveBranch, registry);
  if (!Array.isArray(changedFiles)) return changedFiles;

  const evaluation = evaluateAuthorizedOpenSourceWorkPackageScope({
    branch: effectiveBranch,
    changedFiles,
    authorization,
    receipt,
    entry,
    registry,
    authorizationFileSha256
  });
  return scopeResult({
    ...evaluation,
    parentGovernanceHead: baseHead,
    effectiveBranch,
    changedFileCount: changedFiles.length,
    taskScopeChainApplied: false,
    postMergeDefectScopeApplied: false,
    openSourceWorkPackageScopeApplied: true,
    activeTask: null,
    defectId: null,
    workPackage: authorization.workPackage,
    readyForPromotion: false
  });
}

function openSourceRecordForBranch(branch, options, registry) {
  const explicitAuthorization = Object.prototype.hasOwnProperty.call(options, 'openSourceAuthorization');
  const explicitReceipt = Object.prototype.hasOwnProperty.call(options, 'openSourceReceipt');
  const entry = options.openSourceRegistryEntry
    || selectOpenSourceWorkPackageRegistryEntry(registry, branch)
    || (explicitAuthorization
      ? selectOpenSourceWorkPackageRegistryEntry(registry, options.openSourceAuthorization?.authorizedBranch)
      : null);

  if (explicitAuthorization || explicitReceipt) {
    return {
      registry,
      entry,
      authorization: options.openSourceAuthorization,
      receipt: options.openSourceReceipt
    };
  }
  return resolveOpenSourceAuthorizationForBranch(branch, {
    registry,
    authorizationByPath: options.openSourceAuthorizationByPath,
    receiptByPath: options.openSourceReceiptByPath
  });
}

function detachedOpenSourceRecord(git, evidenceSourceCommit, options, registry) {
  if (!validateOpenSourceWorkPackageRegistry(registry)) return null;
  const matches = registry.entries.filter(entry => detachedEvidenceBelongsToBranch(
    git,
    entry.authorizedBranch,
    evidenceSourceCommit
  ));
  if (matches.length !== 1) return matches.length > 1 ? { ambiguous: true } : null;
  return openSourceRecordForBranch(matches[0].authorizedBranch, {
    ...options,
    openSourceRegistryEntry: matches[0]
  }, registry);
}

function authorizationFileShaForEntry(options, entry) {
  if (!entry) return undefined;
  if (options.openSourceAuthorizationFileSha256ByPath) {
    return options.openSourceAuthorizationFileSha256ByPath[entry.authorizationPath];
  }
  return options.openSourceAuthorizationFileSha256;
}

function evaluateWorkPackageScopeForGate(options = {}) {
  const branch = String(options.branch || '');
  const git = options.git;
  const authorizationWasProvided = Object.prototype.hasOwnProperty.call(options, 'authorization');
  const defectWasProvided = Object.prototype.hasOwnProperty.call(options, 'postMergeDefect');
  const openSourceAuthorizationWasProvided = Object.prototype.hasOwnProperty.call(options, 'openSourceAuthorization');
  const openSourceReceiptWasProvided = Object.prototype.hasOwnProperty.call(options, 'openSourceReceipt');
  const authorization = authorizationWasProvided
    ? options.authorization
    : loadWorkPackageAuthorization();
  const defect = defectWasProvided
    ? options.postMergeDefect
    : loadWorkPackagePostMergeDefect();
  const openSourceRegistry = Object.prototype.hasOwnProperty.call(options, 'openSourceRegistry')
    ? options.openSourceRegistry
    : loadOpenSourceWorkPackageRegistry();
  const detachedEvidence = !branch
    && options.evidenceMode === true
    && typeof options.evidenceSourceCommit === 'string'
    && /^[0-9a-f]{40}$/u.test(options.evidenceSourceCommit);

  let openSourceRecord = branch
    ? openSourceRecordForBranch(branch, options, openSourceRegistry)
    : null;
  if (detachedEvidence) {
    if (openSourceAuthorizationWasProvided || openSourceReceiptWasProvided) {
      const explicitBranch = String(options.openSourceAuthorization?.authorizedBranch || '');
      openSourceRecord = openSourceRecordForBranch(explicitBranch, options, openSourceRegistry);
    } else {
      openSourceRecord = detachedOpenSourceRecord(git, options.evidenceSourceCommit, options, openSourceRegistry);
    }
  }
  if (openSourceRecord?.ambiguous) {
    return fail('OSS_WORK_PACKAGE_AUTHORIZATION_AMBIGUOUS', {
      effectiveBranch: branch,
      openSourceWorkPackageScopeApplied: true
    });
  }

  const openSourceAuthorization = openSourceRecord?.authorization
    || (openSourceAuthorizationWasProvided ? options.openSourceAuthorization : null);
  const openSourceReceipt = openSourceRecord?.receipt
    || (openSourceReceiptWasProvided ? options.openSourceReceipt : null);
  const openSourceEntry = openSourceRecord?.entry || null;
  const openSourceBranch = String(openSourceAuthorization?.authorizedBranch || '');
  const openSourceAuthorizationFileSha256 = authorizationFileShaForEntry(options, openSourceEntry);
  const openSourceApplies = Boolean(openSourceEntry)
    && isAuthorizedOpenSourceImplementationBranch(openSourceBranch, {
      authorization: openSourceAuthorization,
      receipt: openSourceReceipt,
      entry: openSourceEntry,
      registry: openSourceRegistry,
      authorizationFileSha256: openSourceAuthorizationFileSha256
    })
    && (
      branch === openSourceBranch
      || (detachedEvidence && detachedEvidenceBelongsToBranch(git, openSourceBranch, options.evidenceSourceCommit))
      || (detachedEvidence && openSourceAuthorizationWasProvided && openSourceReceiptWasProvided)
    );
  if (openSourceApplies) {
    return evaluateOpenSourceWorkPackageScope({
      authorization: openSourceAuthorization,
      receipt: openSourceReceipt,
      entry: openSourceEntry,
      registry: openSourceRegistry,
      authorizationFileSha256: openSourceAuthorizationFileSha256,
      detachedEvidence,
      evidenceSourceCommit: options.evidenceSourceCommit,
      git
    });
  }

  const defectValid = isValidWorkPackagePostMergeDefect(defect);
  const defectTargetBranch = defectValid ? String(defect.scope.targetBranch || '') : '';
  const defectApplies = defectValid && (
    branch === defectTargetBranch
    || (detachedEvidence && detachedEvidenceBelongsToBranch(git, defectTargetBranch, options.evidenceSourceCommit))
    || (detachedEvidence && defectWasProvided)
  );

  if (defectApplies) {
    return evaluatePostMergeDefectScope({
      defect,
      detachedEvidence,
      evidenceSourceCommit: options.evidenceSourceCommit,
      git
    });
  }
  if (defect && !defectValid && (branch === 'stage/6.4.5.9-architecture-closure'
    || (detachedEvidence && detachedEvidenceBelongsToBranch(git, 'stage/6.4.5.9-architecture-closure', options.evidenceSourceCommit)))) {
    return fail('ACV2_POST_MERGE_DEFECT_SCOPE_INVALID', {
      effectiveBranch: branch,
      postMergeDefectScopeApplied: true
    });
  }

  let effectiveBranch = branch;
  const explicitHistoricalAcv2Evidence = detachedEvidence
    && authorizationWasProvided
    && (!defectWasProvided || defect === null);
  if (detachedEvidence && authorization?.authorizedBranch
    && (explicitHistoricalAcv2Evidence
      || detachedEvidenceBelongsToBranch(git, authorization.authorizedBranch, options.evidenceSourceCommit))) {
    const mismatch = requireEvidenceHead(git, authorization.authorizedBranch, options.evidenceSourceCommit, {}, 'ACV2');
    if (mismatch) return mismatch;
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
      openSourceWorkPackageScopeApplied: false,
      activeTask: null,
      defectId: null,
      workPackage: null,
      readyForPromotion: false
    });
  }
  if (typeof git !== 'function') return fail('ACV2_WORK_PACKAGE_SCOPE_GIT_REQUIRED', { effectiveBranch });
  if (!authorization || effectiveBranch !== authorization.authorizedBranch) {
    return fail('ACV2_WORK_PACKAGE_SCOPE_AUTHORIZATION_INVALID', { effectiveBranch });
  }

  const dirty = requireCleanWorktree(git, effectiveBranch, {}, 'ACV2');
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

  const unavailable = requireAncestor(git, ACV2_WP_A_PARENT_GOVERNANCE_HEAD, effectiveBranch, {}, 'ACV2');
  if (unavailable) return unavailable;
  const changedFiles = readChangedFiles(git, ACV2_WP_A_PARENT_GOVERNANCE_HEAD, effectiveBranch, 'ACV2');
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
      openSourceWorkPackageScopeApplied: false,
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
    openSourceWorkPackageScopeApplied: false,
    activeTask: null
  });
}

module.exports = {
  detachedEvidenceBelongsToBranch,
  evaluateWorkPackageScopeForGate
};
