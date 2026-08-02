'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REBUILD_BRANCH_PATTERN_SOURCE = '^rebuild/windows-release-closure-([0-9]{4})([0-9]{2})([0-9]{2})(?:-[a-z0-9][a-z0-9._-]*)?$';
const REBUILD_BRANCH_PATTERN = new RegExp(REBUILD_BRANCH_PATTERN_SOURCE);
const ACV2_BRANCH_PATTERN = /^acv2\/wp-([a-h])-[a-z0-9][a-z0-9-]*$/;
const ACV2_AUTHORIZATION_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const ACV2_SCOPE_AMENDMENT_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'wp-a-a6-scope-amendment.json');
const ACV2_TASK_SCOPE_CHAIN_PATH = path.resolve(__dirname, '..', '..', 'governance', 'architecture-closure-v2', 'wp-a-task-scope-chain.json');
const ACV2_AUTHORIZATION_REPOSITORY_PATH = 'governance/architecture-closure-v2/implementation-plan-authorization.json';
const ACV2_AUTHORIZATION_BLOB_SHA = '203697b36c06e0dc72c92113ef58f1a8f2394312';
const ACV2_WP_A_PARENT_GOVERNANCE_HEAD = 'd81599d8a3f3de891da369b6f1ddbd01e264c78d';
const ACV2_WP_A_PULL_REQUEST = 5;
const ACV2_SCOPE_AMENDMENT_TASK = 'A6_INDEPENDENT_ROOT_REPAIR_AND_GOVERNANCE_SCOPE_CLOSURE';
const ACV2_TASK_PATTERN = /^A([0-8])$/u;
const ACV2_TASK_STATES = new Set(['RED_LOCKED', 'IMPLEMENTING', 'GREEN_PROVISIONAL', 'INDEPENDENT_REVIEW', 'CLOSED']);

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

function isAuthorizedImplementationBranch(branch, stageVersion, options = {}) {
  if (typeof branch !== 'string' || branch.length === 0) return false;
  if (branch === canonicalStageBranch(stageVersion) || isReleaseClosureRebuildBranch(branch)) return true;
  return isAuthorizedAcv2WorkPackageBranch(branch, resolveAuthorization(options));
}

function authorizedImplementationBranchDescription(stageVersion, options = {}) {
  const base = `${canonicalStageBranch(stageVersion)} or rebuild/windows-release-closure-YYYYMMDD[-suffix]`;
  const authorization = resolveAuthorization(options);
  return isValidWorkPackageAuthorization(authorization)
    ? `${base} or exact machine-authorized branch ${authorization.authorizedBranch}`
    : base;
}

function normalizeRepositoryPath(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
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

module.exports = {
  REBUILD_BRANCH_PATTERN_SOURCE,
  ACV2_AUTHORIZATION_PATH,
  ACV2_SCOPE_AMENDMENT_PATH,
  ACV2_TASK_SCOPE_CHAIN_PATH,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_AUTHORIZATION_BLOB_SHA,
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  ACV2_WP_A_PULL_REQUEST,
  ACV2_SCOPE_AMENDMENT_TASK,
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  loadWorkPackageAuthorization,
  loadWorkPackageScopeAmendment,
  loadWorkPackageTaskScopeChain,
  isValidWorkPackageAuthorization,
  isValidWorkPackageScopeAmendment,
  validateWorkPackageTaskScopeChain,
  isAuthorizedAcv2WorkPackageBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription,
  normalizeRepositoryPath,
  matchesAuthorizedProductionPath,
  workPackageChangedFilesSha256,
  effectiveAllowedProductionPaths,
  effectiveTaskScopePaths,
  evaluateAuthorizedWorkPackageScope,
  evaluateAuthorizedWorkPackageTaskScope
};
