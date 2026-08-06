'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const openSourceWorkPackagePolicy = require('./openSourceWorkPackagePolicy');

const REBUILD_BRANCH_PATTERN_SOURCE = '^rebuild/windows-release-closure-([0-9]{4})([0-9]{2})([0-9]{2})(?:-[a-z0-9][a-z0-9._-]*)?$';
const REBUILD_BRANCH_PATTERN = new RegExp(REBUILD_BRANCH_PATTERN_SOURCE);
const ACV2_BRANCH_PATTERN = /^acv2\/wp-([a-h])-[a-z0-9][a-z0-9-]*$/;
const ACV2_AUTHORIZATION_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const ACV2_SCOPE_AMENDMENT_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'wp-a-a6-scope-amendment.json');
const ACV2_TASK_SCOPE_CHAIN_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'wp-a-task-scope-chain.json');
const ACV2_POST_MERGE_DEFECT_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'wp-a-post-merge-defect-001.json');
const ACV2_AUTHORIZATION_REPOSITORY_PATH = 'governance/architecture-closure-v2/implementation-plan-authorization.json';
const ACV2_AUTHORIZATION_BLOB_SHA = '203697b36c06e0dc72c92113ef58f1a8f2394312';
const ACV2_WP_A_PARENT_GOVERNANCE_HEAD = 'd81599d8a3f3de891da369b6f1ddbd01e264c78d';
const ACV2_WP_A_PULL_REQUEST = 5;
const ACV2_SCOPE_AMENDMENT_TASK = 'A6_INDEPENDENT_ROOT_REPAIR_AND_GOVERNANCE_SCOPE_CLOSURE';
const ACV2_TASK_PATTERN = /^A([0-8])$/u;
const ACV2_TASK_STATES = new Set(['RED_LOCKED', 'IMPLEMENTING', 'GREEN_PROVISIONAL', 'INDEPENDENT_REVIEW', 'CLOSED']);
const PATH_CONTROL = /[\u0000-\u001f\u007f]/u;
const SHA40 = /^[a-f0-9]{40}$/u;
const TRUSTED_POLICY_ROOT = path.resolve(__dirname, '..', '..');
const DELEGATED_GOVERNANCE_AUTHORITIES = Object.freeze([
  Object.freeze({
    authorizationPath: 'governance/layered-ci/oss-a-source-merge-authorization.json',
    mergeCommit: 'fac7d298f182043f4ecc6e41a780248ce3a03132',
    mergeFirstParent: 'ad195d8497ec61fbe3387c606692110f5645fba0',
    reviewedHead: 'f50590181e19cdc134c35d91ae9421af5b532ce8',
    blobSha: '99ee3e5243d07fed5cea6661cb6ad82123771bc8',
    documentType: 'YANCE_OSS_A_SOURCE_MERGE_POLICY_AUTHORIZATION',
    status: 'POLICY_AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE_AND_SEAL',
    sourceMergeClosureField: 'sourceMergeDirectlyAuthorized'
  }),
  Object.freeze({
    authorizationPath: 'governance/layered-ci/oss-a-source-merge-policy-branch-authority-authorization.json',
    mergeCommit: '8311cd15572bdc89316c47485459017613b2e2c8',
    mergeFirstParent: 'fac7d298f182043f4ecc6e41a780248ce3a03132',
    reviewedHead: '97e6ebc2d83d7e775879603e2383dd1f321fa868',
    blobSha: '5c675b30e71de55e524bf8ce5c0ac6d60718d11b',
    documentType: 'YANCE_OSS_A_SOURCE_MERGE_POLICY_BRANCH_AUTHORITY_REPAIR_AUTHORIZATION',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    sourceMergeClosureField: 'sourceMergeAuthorized'
  })
]);

function canonicalStageBranch(stageVersion) {
  if (typeof stageVersion !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(stageVersion)) {
    throw new TypeError('stageVersion must use the numeric x.x.x.x form');
  }
  return `stage/${stageVersion}-architecture-closure`;
}

function isValidUtcCalendarDate(year, month, day) {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return value.getUTCFullYear() === Number(year)
    && value.getUTCMonth() === Number(month) - 1
    && value.getUTCDate() === Number(day);
}

function isReleaseClosureRebuildBranch(branch) {
  if (typeof branch !== 'string') return false;
  const match = branch.match(REBUILD_BRANCH_PATTERN);
  return Boolean(match && isValidUtcCalendarDate(match[1], match[2], match[3]));
}

function loadJsonObject(filePath) {
  try {
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return document && typeof document === 'object' && !Array.isArray(document) ? document : null;
  } catch (_) {
    return null;
  }
}

function loadWorkPackageAuthorization(filePath = ACV2_AUTHORIZATION_PATH) {
  return loadJsonObject(filePath);
}

function loadWorkPackageScopeAmendment(filePath = ACV2_SCOPE_AMENDMENT_PATH) {
  return loadJsonObject(filePath);
}

function loadWorkPackageTaskScopeChain(filePath = ACV2_TASK_SCOPE_CHAIN_PATH) {
  return loadJsonObject(filePath);
}

function loadWorkPackagePostMergeDefect(filePath = ACV2_POST_MERGE_DEFECT_PATH) {
  return loadJsonObject(filePath);
}

function authorizationWorkPackageLetter(authorization) {
  const branchMatch = String(authorization?.authorizedBranch || '').match(ACV2_BRANCH_PATTERN);
  return branchMatch ? branchMatch[1].toUpperCase() : '';
}

function isValidWorkPackageAuthorization(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false;
  if (authorization.schemaVersion !== 1) return false;
  if (authorization.documentType !== 'YANCE_ACV2_WORK_PACKAGE_AUTHORIZATION') return false;
  if (authorization.program !== 'Architecture Closure V2') return false;
  if (authorization.repository !== 'laiqian0239-glitch/yance') return false;
  if (authorization.governance?.automaticNextWorkPackageAuthorization !== false) return false;
  if (authorization.governance?.pr4MustRemainDraft !== true) return false;
  if (typeof authorization.requiredBaseRef !== 'string' || !authorization.requiredBaseRef.trim()) return false;
  if (typeof authorization.approvedParentHead !== 'string' || !/^[a-f0-9]{40}$/u.test(authorization.approvedParentHead)) return false;
  if (!Array.isArray(authorization.allowedProductionPaths) || authorization.allowedProductionPaths.length === 0) return false;

  const letter = authorizationWorkPackageLetter(authorization);
  if (!letter) return false;
  if (authorization.currentAuthorizedWorkPackage !== `WP-${letter}`) return false;
  if (authorization.status !== `WP_${letter}_IMPLEMENTATION_AUTHORIZED`) return false;
  if (authorization.productionScope !== `WP_${letter}_ONLY`) return false;
  if (!Array.isArray(authorization.lockedWorkPackages)) return false;
  if (authorization.lockedWorkPackages.includes(`WP-${letter}`)) return false;
  return true;
}

function resolveAuthorization(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'authorization')) return options.authorization;
  return loadWorkPackageAuthorization(options.authorizationPath || ACV2_AUTHORIZATION_PATH);
}

function isAuthorizedAcv2WorkPackageBranch(branch, authorization) {
  return typeof branch === 'string'
    && isValidWorkPackageAuthorization(authorization)
    && branch === authorization.authorizedBranch;
}

function isExactBranch(value) {
  const branch = String(value || '');
  return Boolean(branch
    && branch === branch.trim()
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.includes('//')
    && !/[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(branch)
    && branch.split('/').every(part => part && part !== '.' && part !== '..' && !part.endsWith('.lock')));
}

function trustedGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: path.resolve(options.trustedPolicyRoot || TRUSTED_POLICY_ROOT),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function defaultTrustedHead(options) {
  try { return trustedGit(['rev-parse', 'HEAD'], options); } catch (_) { return null; }
}

function defaultCommitParents(commit, options) {
  try {
    const row = trustedGit(['rev-list', '--parents', '-n', '1', commit], options).split(/\s+/u);
    return row.length === 3 && row[0] === commit ? row.slice(1) : [];
  } catch (_) {
    return [];
  }
}

function defaultCommitBlobSha(commit, repositoryPath, options) {
  try { return trustedGit(['rev-parse', `${commit}:${repositoryPath}`], options); }
  catch (_) { return null; }
}

function defaultTrustedAncestor(base, head, options) {
  try {
    trustedGit(['merge-base', '--is-ancestor', base, head], options);
    return true;
  } catch (_) {
    return false;
  }
}

function defaultAuthorizationAtMerge(authority, options) {
  try {
    const document = JSON.parse(trustedGit(['show', `${authority.mergeCommit}:${authority.authorizationPath}`], options));
    return document && typeof document === 'object' && !Array.isArray(document) ? document : null;
  } catch (_) {
    return null;
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validDelegatedAuthorityDescriptor(authority) {
  return Boolean(authority
    && normalizeRepositoryPath(authority.authorizationPath) === authority.authorizationPath
    && authority.authorizationPath.startsWith('governance/layered-ci/')
    && authority.authorizationPath.endsWith('.json')
    && [authority.mergeCommit, authority.mergeFirstParent, authority.reviewedHead, authority.blobSha]
      .every(value => SHA40.test(String(value || '')))
    && authority.mergeFirstParent !== authority.reviewedHead
    && typeof authority.documentType === 'string'
    && authority.documentType.startsWith('YANCE_')
    && typeof authority.status === 'string'
    && authority.status.length > 0
    && ['sourceMergeDirectlyAuthorized', 'sourceMergeAuthorized'].includes(authority.sourceMergeClosureField));
}

function validDelegatedGovernanceAuthorization(document, authority) {
  if (!validDelegatedAuthorityDescriptor(authority)
    || !document
    || typeof document !== 'object'
    || Array.isArray(document)
    || document.schemaVersion !== 1
    || document.documentType !== authority.documentType
    || document.repository !== 'laiqian0239-glitch/yance'
    || document.workPackage !== 'OSS-A'
    || document.status !== authority.status
    || document.base?.branch !== 'main'
    || document.base?.commit !== authority.mergeFirstParent
    || !isExactBranch(document.authorizationBranch?.name)
    || document.authorizationBranch?.mustRemainSingleFile !== true
    || !Array.isArray(document.authorizationBranch?.allowedChangedPaths)
    || document.authorizationBranch.allowedChangedPaths.length !== 1
    || document.authorizationBranch.allowedChangedPaths[0] !== authority.authorizationPath
    || !isExactBranch(document.implementation?.branch)
    || !Array.isArray(document.implementation?.allowedChangedPaths)
    || document.implementation.allowedChangedPaths.length === 0
    || document.implementation.approvedChangedFileCount !== document.implementation.allowedChangedPaths.length
    || document.implementation.approvedChangedFileSetSha256
      !== workPackageChangedFilesSha256(document.implementation.allowedChangedPaths)
    || document.implementation.newDependencyAllowed !== false
    || document.implementation.workflowModificationAllowed !== false
    || document.governance?.authorizationPredatesImplementation !== true
    || document.governance?.exactPathScopeOnly !== true
    || document.governance?.independentBranchAndPullRequestRequired !== true
    || document.governance?.productionUseAuthorized !== false
    || document.governance?.formalRelease !== false
    || document.governance?.publish !== false
    || document.governance?.readyForPromotion !== false
    || document.governance?.automaticNextWorkPackageAuthorization !== false
    || document.governance?.[authority.sourceMergeClosureField] !== false) return false;
  const exactPaths = normalizeChangedFiles(document.implementation.allowedChangedPaths);
  return exactPaths.length === document.implementation.allowedChangedPaths.length
    && sameJson(exactPaths, document.implementation.allowedChangedPaths);
}

function isAuthorizedDelegatedGovernanceBranch(branch, options = {}) {
  if (!isExactBranch(branch)) return false;
  const authorities = Array.isArray(options.authorities)
    ? options.authorities
    : DELEGATED_GOVERNANCE_AUTHORITIES;
  const trustedHead = Object.prototype.hasOwnProperty.call(options, 'trustedPolicyHead')
    ? options.trustedPolicyHead
    : defaultTrustedHead(options);
  if (!SHA40.test(String(trustedHead || ''))) return false;
  const matches = [];

  for (const authority of authorities) {
    if (!validDelegatedAuthorityDescriptor(authority)) continue;
    const trustedDocument = options.loadAuthorization
      ? options.loadAuthorization(authority)
      : defaultAuthorizationAtMerge(authority, options);
    if (!validDelegatedGovernanceAuthorization(trustedDocument, authority)) continue;
    if (Object.prototype.hasOwnProperty.call(options.authorizationByPath || {}, authority.authorizationPath)
      && !sameJson(options.authorizationByPath[authority.authorizationPath], trustedDocument)) continue;
    const parents = (options.resolveCommitParents || (commit => defaultCommitParents(commit, options)))(authority.mergeCommit);
    if (!Array.isArray(parents)
      || parents.length !== 2
      || parents[0] !== authority.mergeFirstParent
      || parents[1] !== authority.reviewedHead) continue;
    const blob = (options.resolveCommitBlobSha
      || ((commit, repositoryPath) => defaultCommitBlobSha(commit, repositoryPath, options)))(
      authority.mergeCommit,
      authority.authorizationPath
    );
    if (blob !== authority.blobSha) continue;
    const ancestor = options.isTrustedAncestor
      || ((base, head) => defaultTrustedAncestor(base, head, options));
    if (ancestor(authority.mergeCommit, trustedHead) !== true) continue;
    if (branch === trustedDocument.implementation.branch) matches.push(authority.authorizationPath);
  }
  return matches.length === 1;
}

function isAuthorizedImplementationBranch(branch, stageVersion, options = {}) {
  if (typeof branch !== 'string' || branch.length === 0) return false;
  if (branch === canonicalStageBranch(stageVersion) || isReleaseClosureRebuildBranch(branch)) return true;
  if (isAuthorizedAcv2WorkPackageBranch(branch, resolveAuthorization(options))) return true;
  if (isAuthorizedDelegatedGovernanceBranch(branch, options.delegatedGovernance || {})) return true;
  return openSourceWorkPackagePolicy.isAuthorizedOpenSourceImplementationBranch(
    branch,
    options.openSource || {}
  );
}

function authorizedImplementationBranchDescription(stageVersion, options = {}) {
  const base = `${canonicalStageBranch(stageVersion)} or rebuild/windows-release-closure-YYYYMMDD[-suffix]`;
  const authorization = resolveAuthorization(options);
  const acv2 = isValidWorkPackageAuthorization(authorization)
    ? `${base} or exact machine-authorized branch ${authorization.authorizedBranch}`
    : base;
  return `${acv2} or an exact trusted-main delegated governance branch or an exact sealed open-source work-package branch`;
}

function normalizeRepositoryPath(value) {
  const candidate = String(value || '');
  if (!candidate
    || candidate !== candidate.trim()
    || candidate.startsWith('/')
    || candidate.startsWith('./')
    || candidate.endsWith('/')
    || candidate.includes('\\')
    || /^[A-Za-z]:\//u.test(candidate)
    || PATH_CONTROL.test(candidate)) return '';
  const segments = candidate.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return candidate;
}

function globPatternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  const source = escaped.replace(/\*\*/gu, '\u0000').replace(/\*/gu, '[^/]*').replace(/\u0000/gu, '.*');
  return new RegExp(`^${source}$`, 'u');
}

function matchesAuthorizedProductionPath(relativePath, pattern) {
  const pathValue = normalizeRepositoryPath(relativePath);
  const patternValue = normalizeRepositoryPath(pattern);
  if (!pathValue || !patternValue) return false;
  if (!/[?*[]/u.test(patternValue)) return pathValue === patternValue;
  return globPatternToRegExp(patternValue).test(pathValue);
}

function normalizeChangedFiles(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeRepositoryPath)
    .filter(Boolean))].sort();
}

function workPackageChangedFilesSha256(values = []) {
  const normalized = normalizeChangedFiles(values);
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function isExactAdditionalPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return Boolean(normalized && normalized === value && !/[?*[]/u.test(normalized));
}

function isValidWorkPackageScopeAmendment(amendment, authorization) {
  if (!isValidWorkPackageAuthorization(authorization)) return false;
  if (!amendment || typeof amendment !== 'object' || Array.isArray(amendment)) return false;
  if (amendment.schemaVersion !== 1 || amendment.documentType !== 'YANCE_ACV2_WORK_PACKAGE_SCOPE_AMENDMENT') return false;
  if (amendment.status !== 'APPROVED_INDEPENDENT_REVIEW_SCOPE_AMENDMENT') return false;
  if (amendment.repository !== authorization.repository) return false;
  if (amendment.workPackage !== authorization.currentAuthorizedWorkPackage) return false;
  if (amendment.task !== ACV2_SCOPE_AMENDMENT_TASK) return false;
  if (amendment.authorizedBranch !== authorization.authorizedBranch) return false;
  if (amendment.pullRequest !== ACV2_WP_A_PULL_REQUEST) return false;
  if (amendment.baseAuthorizationPath !== ACV2_AUTHORIZATION_REPOSITORY_PATH) return false;
  if (amendment.baseAuthorizationBlobSha !== ACV2_AUTHORIZATION_BLOB_SHA) return false;
  if (amendment.parentGovernanceHead !== ACV2_WP_A_PARENT_GOVERNANCE_HEAD) return false;
  if (!Number.isSafeInteger(amendment.approvedChangedFileCount) || amendment.approvedChangedFileCount < 1) return false;
  if (!/^[a-f0-9]{64}$/u.test(String(amendment.approvedChangedFileSetSha256 || ''))) return false;
  if (!Array.isArray(amendment.additionalAllowedPaths) || amendment.additionalAllowedPaths.length === 0) return false;
  if (!amendment.additionalAllowedPaths.every(isExactAdditionalPath)) return false;
  if (new Set(amendment.additionalAllowedPaths).size !== amendment.additionalAllowedPaths.length) return false;
  const governance = amendment.governance || {};
  return governance.exactPathExpansionOnly === true
    && governance.wildcardExpansionAllowed === false
    && governance.prMustRemainDraft === true
    && governance.automaticNextTaskAuthorization === false
    && governance.automaticNextWorkPackageAuthorization === false
    && governance.readyForPromotion === false;
}

function isValidTaskEntry(task, index, tasks) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return false;
  const match = String(task.task || '').match(ACV2_TASK_PATTERN);
  if (!match || !ACV2_TASK_STATES.has(task.state)) return false;
  if (!Array.isArray(task.additionalAllowedPaths) || !task.additionalAllowedPaths.every(isExactAdditionalPath)) return false;
  if (new Set(task.additionalAllowedPaths).size !== task.additionalAllowedPaths.length) return false;
  if (index === 0) {
    return task.task === 'A6'
      && task.state === 'CLOSED'
      && /^[a-f0-9]{40}$/u.test(String(task.reviewedCodeHead || ''))
      && /^[a-f0-9]{40}$/u.test(String(task.evidenceBranchTip || ''))
      && isExactAdditionalPath(task.closureReceiptPath);
  }
  const previous = tasks[index - 1];
  return previous.state === 'CLOSED'
    && task.parentTask === previous.task
    && task.parentEvidenceBranchTip === previous.evidenceBranchTip
    && Number(match[1]) === Number(String(previous.task).slice(1)) + 1;
}

function validateWorkPackageTaskScopeChain(chain, authorization) {
  if (!isValidWorkPackageAuthorization(authorization)) return false;
  if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return false;
  if (chain.schemaVersion !== 1 || chain.documentType !== 'YANCE_ACV2_TASK_SCOPE_CHAIN') return false;
  if (!/^A[0-8]_(?:RED_LOCKED|IMPLEMENTING|GREEN_PROVISIONAL|INDEPENDENT_REVIEW|CLOSED)$/u.test(String(chain.status || ''))) return false;
  if (chain.repository !== authorization.repository) return false;
  if (chain.workPackage !== authorization.currentAuthorizedWorkPackage) return false;
  if (chain.authorizedBranch !== authorization.authorizedBranch) return false;
  if (chain.pullRequest !== ACV2_WP_A_PULL_REQUEST) return false;
  if (chain.baseAuthorizationPath !== ACV2_AUTHORIZATION_REPOSITORY_PATH) return false;
  if (chain.baseAuthorizationBlobSha !== ACV2_AUTHORIZATION_BLOB_SHA) return false;
  if (chain.parentGovernanceHead !== ACV2_WP_A_PARENT_GOVERNANCE_HEAD) return false;
  if (!ACV2_TASK_PATTERN.test(String(chain.activeTask || ''))) return false;
  if (!Number.isSafeInteger(chain.approvedChangedFileCount) || chain.approvedChangedFileCount < 1) return false;
  if (!/^[a-f0-9]{64}$/u.test(String(chain.approvedChangedFileSetSha256 || ''))) return false;
  if (!Array.isArray(chain.tasks) || chain.tasks.length < 2) return false;
  if (new Set(chain.tasks.map(task => task?.task)).size !== chain.tasks.length) return false;
  if (!chain.tasks.every(isValidTaskEntry)) return false;
  const active = chain.tasks.at(-1);
  if (active.task !== chain.activeTask || chain.status !== `${active.task}_${active.state}`) return false;
  const governance = chain.governance || {};
  return governance.exactPathExpansionOnly === true
    && governance.wildcardExpansionAllowed === false
    && governance.previousTaskClosureRequired === true
    && governance.prMustRemainDraft === true
    && governance.automaticNextTaskAuthorization === false
    && governance.automaticNextWorkPackageAuthorization === false
    && governance.readyForPromotion === false;
}

function effectiveAllowedProductionPaths(authorization, amendment = null) {
  if (!isValidWorkPackageAuthorization(authorization)) return [];
  const base = [...authorization.allowedProductionPaths];
  if (!isValidWorkPackageScopeAmendment(amendment, authorization)) return Object.freeze(base);
  return Object.freeze([...new Set([...base, ...amendment.additionalAllowedPaths])]);
}

function effectiveTaskScopePaths(authorization, chain) {
  if (!validateWorkPackageTaskScopeChain(chain, authorization)) return [];
  return Object.freeze([...new Set([
    ...authorization.allowedProductionPaths,
    ...chain.tasks.flatMap(task => task.additionalAllowedPaths)
  ])]);
}

function evaluateAuthorizedWorkPackageScope(options = {}) {
  const authorization = options.authorization;
  const amendment = options.amendment || null;
  const branch = String(options.branch || '');
  const changedFiles = normalizeChangedFiles(options.changedFiles);
  const changedFileSetSha256 = workPackageChangedFilesSha256(changedFiles);

  if (!isValidWorkPackageAuthorization(authorization) || branch !== authorization.authorizedBranch) {
    return Object.freeze({ pass: false, reasonCode: 'ACV2_WORK_PACKAGE_AUTHORIZATION_INVALID', changedFileSetSha256, amendmentApplied: false, unauthorizedPaths: changedFiles });
  }
  if (amendment && !isValidWorkPackageScopeAmendment(amendment, authorization)) {
    return Object.freeze({ pass: false, reasonCode: 'ACV2_SCOPE_AMENDMENT_INVALID', changedFileSetSha256, amendmentApplied: false, unauthorizedPaths: changedFiles.filter(file => !authorization.allowedProductionPaths.some(pattern => matchesAuthorizedProductionPath(file, pattern))) });
  }
  if (amendment && (amendment.approvedChangedFileCount !== changedFiles.length || amendment.approvedChangedFileSetSha256 !== changedFileSetSha256)) {
    return Object.freeze({ pass: false, reasonCode: 'ACV2_CHANGED_FILE_SET_MISMATCH', changedFileSetSha256, amendmentApplied: true, unauthorizedPaths: [] });
  }

  const allowedPaths = effectiveAllowedProductionPaths(authorization, amendment);
  const unauthorizedPaths = changedFiles.filter(file => !allowedPaths.some(pattern => matchesAuthorizedProductionPath(file, pattern)));
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'ACV2_WORK_PACKAGE_SCOPE_VIOLATION' : null,
    changedFileSetSha256,
    amendmentApplied: Boolean(amendment),
    unauthorizedPaths,
    allowedPathCount: allowedPaths.length
  });
}

function evaluateAuthorizedWorkPackageTaskScope(options = {}) {
  const authorization = options.authorization;
  const taskScopeChain = options.taskScopeChain;
  const branch = String(options.branch || '');
  const rawChangedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const changedFiles = normalizeChangedFiles(rawChangedFiles);
  const changedFileSetSha256 = workPackageChangedFilesSha256(changedFiles);

  if (!isValidWorkPackageAuthorization(authorization) || branch !== authorization.authorizedBranch) {
    return Object.freeze({ pass: false, reasonCode: 'ACV2_WORK_PACKAGE_AUTHORIZATION_INVALID', changedFileSetSha256, taskScopeChainApplied: false, unauthorizedPaths: changedFiles, readyForPromotion: false });
  }
  if (!validateWorkPackageTaskScopeChain(taskScopeChain, authorization)) {
    return Object.freeze({ pass: false, reasonCode: 'ACV2_TASK_SCOPE_CHAIN_INVALID', changedFileSetSha256, taskScopeChainApplied: false, unauthorizedPaths: changedFiles, readyForPromotion: false });
  }
  if (taskScopeChain.approvedChangedFileCount !== changedFiles.length || taskScopeChain.approvedChangedFileSetSha256 !== changedFileSetSha256) {
    return Object.freeze({ pass: false, reasonCode: 'ACV2_TASK_CHANGED_FILE_SET_MISMATCH', changedFileSetSha256, taskScopeChainApplied: true, activeTask: taskScopeChain.activeTask, unauthorizedPaths: [], readyForPromotion: false });
  }

  const allowedPaths = effectiveTaskScopePaths(authorization, taskScopeChain);
  const unauthorizedPaths = changedFiles.filter(file => !allowedPaths.some(pattern => matchesAuthorizedProductionPath(file, pattern)));
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'ACV2_TASK_SCOPE_VIOLATION' : null,
    changedFileSetSha256,
    taskScopeChainApplied: true,
    activeTask: taskScopeChain.activeTask,
    unauthorizedPaths,
    allowedPathCount: allowedPaths.length,
    readyForPromotion: false
  });
}

function isValidWorkPackagePostMergeDefect(defect) {
  if (!defect || typeof defect !== 'object' || Array.isArray(defect)) return false;
  if (defect.schemaVersion !== 1 || defect.documentType !== 'YANCE_ACV2_POST_MERGE_DEFECT') return false;
  if (defect.program !== 'Architecture Closure V2') return false;
  if (defect.repository !== 'laiqian0239-glitch/yance' || defect.workPackage !== 'WP-A') return false;
  if (defect.defectId !== 'WP-A-POST-MERGE-DEFECT-001') return false;
  if (!new Set(['IMPLEMENTING', 'INDEPENDENT_REVIEW', 'CLOSED']).has(defect.status)) return false;
  const scope = defect.scope || {};
  if (scope.mode !== 'POST_CLOSE_DEFECT_EXACT_FILES') return false;
  if (scope.parentClosedTask !== 'A8') return false;
  if (scope.parentClosureReceiptPath !== 'governance/architecture-closure-v2/wp-a-a8-closure.json') return false;
  if (scope.targetBranch !== 'stage/6.4.5.9-architecture-closure') return false;
  if (!/^[a-f0-9]{40}$/u.test(String(scope.baseHead || ''))) return false;
  if (!Number.isSafeInteger(scope.approvedChangedFileCount) || scope.approvedChangedFileCount < 1) return false;
  if (!/^[a-f0-9]{64}$/u.test(String(scope.approvedChangedFileSetSha256 || ''))) return false;
  if (!Array.isArray(scope.exactPaths) || scope.exactPaths.length !== scope.approvedChangedFileCount) return false;
  if (!scope.exactPaths.every(isExactAdditionalPath)) return false;
  if (new Set(scope.exactPaths).size !== scope.exactPaths.length) return false;
  if (!scope.exactPaths.includes('governance/architecture-closure-v2/wp-a-post-merge-defect-001.json')) return false;
  const governance = defect.governance || {};
  return governance.readyForPromotion === true
    && governance.formalRelease === false
    && governance.publish === false
    && governance.wpBAuthorized === false
    && governance.temporaryBypassAllowed === false
    && governance.testRemovalAllowed === false
    && governance.matrixReductionAllowed === false
    && governance.scannerWeakeningAllowed === false;
}

function evaluateAuthorizedPostMergeDefectScope(options = {}) {
  const defect = options.defect;
  const branch = String(options.branch || '');
  const changedFiles = normalizeChangedFiles(options.changedFiles);
  const changedFileSetSha256 = workPackageChangedFilesSha256(changedFiles);
  if (!isValidWorkPackagePostMergeDefect(defect) || branch !== defect.scope.targetBranch) {
    return Object.freeze({
      pass: false,
      reasonCode: 'ACV2_POST_MERGE_DEFECT_SCOPE_INVALID',
      changedFileSetSha256,
      postMergeDefectScopeApplied: false,
      unauthorizedPaths: changedFiles,
      readyForPromotion: false
    });
  }
  if (defect.scope.approvedChangedFileCount !== changedFiles.length
    || defect.scope.approvedChangedFileSetSha256 !== changedFileSetSha256) {
    return Object.freeze({
      pass: false,
      reasonCode: 'ACV2_POST_MERGE_DEFECT_CHANGED_FILE_SET_MISMATCH',
      changedFileSetSha256,
      postMergeDefectScopeApplied: true,
      defectId: defect.defectId,
      unauthorizedPaths: [],
      readyForPromotion: false
    });
  }
  const allowed = new Set(defect.scope.exactPaths);
  const unauthorizedPaths = changedFiles.filter(file => !allowed.has(file));
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'ACV2_POST_MERGE_DEFECT_SCOPE_VIOLATION' : null,
    changedFileSetSha256,
    postMergeDefectScopeApplied: true,
    defectId: defect.defectId,
    unauthorizedPaths,
    allowedPathCount: allowed.size,
    readyForPromotion: unauthorizedPaths.length === 0 && defect.governance.readyForPromotion === true
  });
}

module.exports = {
  REBUILD_BRANCH_PATTERN_SOURCE,
  ACV2_AUTHORIZATION_PATH,
  ACV2_SCOPE_AMENDMENT_PATH,
  ACV2_TASK_SCOPE_CHAIN_PATH,
  ACV2_POST_MERGE_DEFECT_PATH,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_AUTHORIZATION_BLOB_SHA,
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  ACV2_WP_A_PULL_REQUEST,
  ACV2_SCOPE_AMENDMENT_TASK,
  DELEGATED_GOVERNANCE_AUTHORITIES,
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  loadWorkPackageAuthorization,
  loadWorkPackageScopeAmendment,
  loadWorkPackageTaskScopeChain,
  loadWorkPackagePostMergeDefect,
  isValidWorkPackageAuthorization,
  isValidWorkPackageScopeAmendment,
  validateWorkPackageTaskScopeChain,
  isValidWorkPackagePostMergeDefect,
  isAuthorizedAcv2WorkPackageBranch,
  isAuthorizedDelegatedGovernanceBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription,
  normalizeRepositoryPath,
  matchesAuthorizedProductionPath,
  workPackageChangedFilesSha256,
  effectiveAllowedProductionPaths,
  effectiveTaskScopePaths,
  evaluateAuthorizedWorkPackageScope,
  evaluateAuthorizedWorkPackageTaskScope,
  evaluateAuthorizedPostMergeDefectScope,
  isAuthorizedOpenSourceImplementationBranch:
    openSourceWorkPackagePolicy.isAuthorizedOpenSourceImplementationBranch,
  evaluateAuthorizedOpenSourceWorkPackageScope:
    openSourceWorkPackagePolicy.evaluateAuthorizedOpenSourceWorkPackageScope
};
