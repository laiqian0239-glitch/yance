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
const GENERIC_DELEGATED_GOVERNANCE_DOCUMENT_TYPE = 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION';
const GENERIC_DELEGATED_GOVERNANCE_STATUS = 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE';
const GENERIC_DELEGATED_GOVERNANCE_PATH = /^governance\/layered-ci\/[a-z0-9][a-z0-9-]*-authorization\.json$/u;
const AUTHORIZATION_PROPOSAL_TRANSPORT_MODE = 'AUTHORIZATION_PROPOSAL_TRANSPORT';
const TRUSTED_MAIN_DELEGATED_GOVERNANCE_MODE = 'TRUSTED_MAIN_DELEGATED_GOVERNANCE';
const DELEGATED_ROUTE_POLICY_PATH = 'governance/layered-ci/wp0-routing-policy.json';
const DELEGATED_ROUTE_POLICY_MUTATION_DENIED = 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED';
const DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED = 'WP0_DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED';
const DEPENDENCY_IDENTITY_SECTIONS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies'
]);
const EXACT_DEPENDENCY_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DEPENDENCY_CONTROL_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb'
]);

const TRUSTED_POLICY_ROOT = path.resolve(__dirname, '..', '..');
const TRUSTED_GIT_ENVIRONMENT_KEYS = Object.freeze([
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR'
]);
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

function buildTrustedGitEnvironment(sourceEnv = process.env) {
  const environment = {};
  for (const key of TRUSTED_GIT_ENVIRONMENT_KEYS) {
    if (typeof sourceEnv?.[key] === 'string' && sourceEnv[key].length > 0) {
      environment[key] = sourceEnv[key];
    }
  }
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GCM_INTERACTIVE = 'Never';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_NO_LAZY_FETCH = '1';
  environment.LANG = 'C';
  environment.LC_ALL = 'C';
  return environment;
}

function trustedGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: path.resolve(options.trustedPolicyRoot || TRUSTED_POLICY_ROOT),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildTrustedGitEnvironment(options.environment || process.env),
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
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

function defaultCommitPathMode(commit, repositoryPath, options = {}) {
  try {
    const output = trustedGit(['ls-tree', commit, '--', repositoryPath], options);
    if (!output) return null;
    const tabIndex = output.indexOf('\t');
    if (tabIndex < 0 || output.slice(tabIndex + 1) !== repositoryPath) return null;
    const metadata = output.slice(0, tabIndex).split(/\s+/u);
    if (metadata.length !== 3 || metadata[1] !== 'blob' || !SHA40.test(metadata[2])) return null;
    return metadata[0];
  } catch (_) {
    return null;
  }
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

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  const stable = {};
  for (const key of Object.keys(value).sort()) stable[key] = stableJsonValue(value[key]);
  return stable;
}

function sameJsonSemantics(left, right) {
  return sameJson(stableJsonValue(left), stableJsonValue(right));
}

function trustedGitBuffer(args, options = {}) {
  return execFileSync('git', args, {
    cwd: path.resolve(options.trustedPolicyRoot || TRUSTED_POLICY_ROOT),
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildTrustedGitEnvironment(options.environment || process.env),
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
}

function parseNulPathList(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) return null;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return decoded.split('\0').slice(0, -1);
  } catch (_) {
    return null;
  }
}

function defaultTrustedMainHead(options = {}) {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    try {
      const head = trustedGit(['rev-parse', `${ref}^{commit}`], options);
      if (SHA40.test(head)) return head;
    } catch (_) {}
  }
  return null;
}

function defaultCommitParentList(commit, options = {}) {
  try {
    const row = trustedGit(['rev-list', '--parents', '-n', '1', commit], options).split(/\s+/u);
    return row[0] === commit ? row.slice(1) : [];
  } catch (_) {
    return [];
  }
}

function defaultChangedFilesBetween(base, head, options = {}) {
  try {
    return parseNulPathList(trustedGitBuffer([
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      base,
      head,
      '--'
    ], options));
  } catch (_) {
    return null;
  }
}

function defaultMergeBases(left, right, options = {}) {
  try {
    const output = trustedGit(['merge-base', '--all', left, right], options);
    if (!output) return [];
    const mergeBases = output.split(/\r?\n/u).filter(Boolean);
    return mergeBases.every(SHA40.test.bind(SHA40)) ? mergeBases : [];
  } catch (_) {
    return [];
  }
}

function defaultListGenericAuthorizationPaths(trustedMainHead, options = {}) {
  try {
    const values = parseNulPathList(trustedGitBuffer([
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      trustedMainHead,
      '--',
      'governance/layered-ci'
    ], options));
    return Array.isArray(values) ? values.filter(isGenericDelegatedGovernanceAuthorizationPath) : [];
  } catch (_) {
    return [];
  }
}

function defaultAuthorizationAtCommit(commit, repositoryPath, options = {}) {
  try {
    const document = JSON.parse(trustedGit(['show', `${commit}:${repositoryPath}`], options));
    return document && typeof document === 'object' && !Array.isArray(document) ? document : null;
  } catch (_) {
    return null;
  }
}

function defaultFindAuthorizationIntroductionMerges(trustedMainHead, repositoryPath, options = {}) {
  let commits;
  try {
    const output = trustedGit(['log', '--first-parent', '--format=%H', trustedMainHead, '--', repositoryPath], options);
    commits = output ? output.split(/\r?\n/u).filter(SHA40.test.bind(SHA40)) : [];
  } catch (_) {
    return [];
  }
  const introductions = [];
  for (const commit of commits) {
    const parents = defaultCommitParentList(commit, options);
    if (parents.length === 0) continue;
    const currentBlob = defaultCommitBlobSha(commit, repositoryPath, options);
    const firstParentBlob = defaultCommitBlobSha(parents[0], repositoryPath, options);
    if (SHA40.test(String(currentBlob || '')) && firstParentBlob === null) introductions.push(commit);
  }
  return introductions;
}

function isGenericDelegatedGovernanceAuthorizationPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return Boolean(normalized && normalized === value && GENERIC_DELEGATED_GOVERNANCE_PATH.test(normalized));
}

function isValidExactWorkflowModificationPolicy(implementation, implementationPaths) {
  const policy = implementation?.workflowModificationPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  const expectedKeys = ['allowedWorkflowPaths', 'approvedWorkflowPathCount', 'approvedWorkflowPathSetSha256'];
  if (!sameJson(Object.keys(policy).sort(), expectedKeys)) return false;
  if (!Array.isArray(policy.allowedWorkflowPaths) || policy.allowedWorkflowPaths.length === 0) return false;
  const workflowPaths = normalizeChangedFiles(policy.allowedWorkflowPaths);
  if (workflowPaths.length !== policy.allowedWorkflowPaths.length
    || !sameJson(workflowPaths, policy.allowedWorkflowPaths)
    || !workflowPaths.every(isExactAdditionalPath)
    || !workflowPaths.every(isWorkflowControlPath)
    || policy.approvedWorkflowPathCount !== workflowPaths.length
    || policy.approvedWorkflowPathSetSha256 !== workPackageChangedFilesSha256(workflowPaths)) return false;
  const implementationWorkflowPaths = implementationPaths.filter(isWorkflowControlPath);
  return sameJson(workflowPaths, implementationWorkflowPaths);
}

function isValidExactDependencyModificationPolicy(implementation, implementationPaths) {
  const policy = implementation?.dependencyModificationPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  const expectedKeys = ['allowedDependencyPaths', 'approvedDependencyPathCount', 'approvedDependencyPathSetSha256'];
  if (!sameJson(Object.keys(policy).sort(), expectedKeys)) return false;
  if (!Array.isArray(policy.allowedDependencyPaths) || policy.allowedDependencyPaths.length === 0) return false;
  const dependencyPaths = normalizeChangedFiles(policy.allowedDependencyPaths);
  if (dependencyPaths.length !== policy.allowedDependencyPaths.length
    || !sameJson(dependencyPaths, policy.allowedDependencyPaths)
    || !dependencyPaths.every(isExactAdditionalPath)
    || !dependencyPaths.every(isDependencyControlPath)
    || policy.approvedDependencyPathCount !== dependencyPaths.length
    || policy.approvedDependencyPathSetSha256 !== workPackageChangedFilesSha256(dependencyPaths)) return false;
  const implementationDependencyPaths = implementationPaths.filter(isDependencyControlPath);
  return sameJson(dependencyPaths, implementationDependencyPaths);
}

function isPlainJsonObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isValidDependencyIdentityName(value) {
  return typeof value === 'string'
    && value === value.trim()
    && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value);
}

function isExactDependencyIdentityVersion(value) {
  return typeof value === 'string'
    && value === value.trim()
    && EXACT_DEPENDENCY_VERSION.test(value);
}

function resolveDependencyIdentityPolicy(implementation, implementationPaths) {
  if (!Object.prototype.hasOwnProperty.call(implementation || {}, 'dependencyIdentityPolicy')) return null;
  const policy = implementation.dependencyIdentityPolicy;
  if (!isPlainJsonObject(policy) || !sameJson(Object.keys(policy).sort(), ['entries'])) return false;
  if (!Array.isArray(policy.entries) || policy.entries.length === 0) return false;
  const dependencyPaths = new Set(implementation?.dependencyModificationPolicy?.allowedDependencyPaths || []);
  const implementationPathSet = new Set(implementationPaths || []);
  const seenIdentities = new Set();
  const normalizedEntries = [];
  for (const entry of policy.entries) {
    if (!isPlainJsonObject(entry)
      || !sameJson(Object.keys(entry).sort(), ['name', 'path', 'section', 'version'])
      || !isExactAdditionalPath(entry.path)
      || path.posix.basename(entry.path) !== 'package.json'
      || !dependencyPaths.has(entry.path)
      || !implementationPathSet.has(entry.path)
      || !DEPENDENCY_IDENTITY_SECTIONS.has(entry.section)
      || !isValidDependencyIdentityName(entry.name)
      || !isExactDependencyIdentityVersion(entry.version)) return false;
    const identity = `${entry.path}\0${entry.name}`;
    if (seenIdentities.has(identity)) return false;
    seenIdentities.add(identity);
    normalizedEntries.push(Object.freeze({
      path: entry.path,
      section: entry.section,
      name: entry.name,
      version: entry.version
    }));
  }
  return Object.freeze({ entries: Object.freeze(normalizedEntries) });
}

function isValidGenericDelegatedGovernanceAuthorization(document, authorizationPath) {
  if (!isGenericDelegatedGovernanceAuthorizationPath(authorizationPath)
    || !document
    || typeof document !== 'object'
    || Array.isArray(document)
    || document.schemaVersion !== 1
    || document.documentType !== GENERIC_DELEGATED_GOVERNANCE_DOCUMENT_TYPE
    || document.repository !== 'laiqian0239-glitch/yance'
    || typeof document.workPackage !== 'string'
    || !/^[A-Z0-9][A-Z0-9-]{1,63}$/u.test(document.workPackage)
    || document.status !== GENERIC_DELEGATED_GOVERNANCE_STATUS
    || document.base?.branch !== 'main'
    || !SHA40.test(String(document.base?.commit || ''))
    || document.effectiveness?.effectiveBeforeMerge !== false
    || document.effectiveness?.requiresOrdinaryTwoParentMainMerge !== true
    || document.effectiveness?.implementationMayStartOnlyFromAuthorizationMergeCommit !== true
    || document.effectiveness?.authorizationProposalTransportIsNotImplementationAuthority !== true
    || !isExactBranch(document.authorizationBranch?.name)
    || !String(document.authorizationBranch.name).startsWith('governance/')
    || document.authorizationBranch?.mustRemainSingleFile !== true
    || !Array.isArray(document.authorizationBranch?.allowedChangedPaths)
    || document.authorizationBranch.allowedChangedPaths.length !== 1
    || document.authorizationBranch.allowedChangedPaths[0] !== authorizationPath
    || !isExactBranch(document.implementation?.branch)
    || document.implementation.branch === 'main'
    || document.implementation.branch === document.authorizationBranch.name
    || !Array.isArray(document.implementation?.allowedChangedPaths)
    || document.implementation.allowedChangedPaths.length === 0
    || document.implementation.approvedChangedFileCount !== document.implementation.allowedChangedPaths.length
    || document.implementation.approvedChangedFileSetSha256
      !== workPackageChangedFilesSha256(document.implementation.allowedChangedPaths)
    || ![true, false].includes(document.implementation.newDependencyAllowed)
    || ![true, false].includes(document.implementation.workflowModificationAllowed)
    || document.governance?.authorizationPredatesImplementation !== true
    || document.governance?.exactPathScopeOnly !== true
    || document.governance?.independentBranchAndPullRequestRequired !== true
    || document.governance?.productionUseAuthorized !== false
    || document.governance?.formalReleaseAuthorized !== false
    || document.governance?.publishAuthorized !== false
    || document.governance?.readyForPromotionAuthorized !== false
    || document.governance?.automaticNextWorkPackageAuthorizationAuthorized !== false) return false;

  const authorizationPaths = normalizeChangedFiles(document.authorizationBranch.allowedChangedPaths);
  const implementationPaths = normalizeChangedFiles(document.implementation.allowedChangedPaths);
  if (authorizationPaths.length !== 1
    || authorizationPaths[0] !== authorizationPath
    || implementationPaths.length !== document.implementation.allowedChangedPaths.length
    || !sameJson(implementationPaths, document.implementation.allowedChangedPaths)
    || !implementationPaths.every(isExactAdditionalPath)) return false;

  const dependencyPaths = implementationPaths.filter(isDependencyControlPath);
  if (document.implementation.newDependencyAllowed === false) {
    if (dependencyPaths.length !== 0
      || Object.prototype.hasOwnProperty.call(document.implementation, 'dependencyModificationPolicy')
      || Object.prototype.hasOwnProperty.call(document.implementation, 'dependencyIdentityPolicy')) return false;
  } else if (!isValidExactDependencyModificationPolicy(document.implementation, implementationPaths)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(document.implementation, 'dependencyIdentityPolicy')
    && resolveDependencyIdentityPolicy(document.implementation, implementationPaths) === false) return false;

  const workflowPaths = implementationPaths.filter(isWorkflowControlPath);
  if (document.implementation.workflowModificationAllowed === false) {
    return workflowPaths.length === 0
      && !Object.prototype.hasOwnProperty.call(document.implementation, 'workflowModificationPolicy');
  }
  return isValidExactWorkflowModificationPolicy(document.implementation, implementationPaths);
}

function resolveGenericCandidateAuthorization(authorizationPath, evaluatedHead, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'authorization')) return options.authorization;
  if (typeof options.loadAuthorizationAtEvaluatedHead === 'function') {
    return options.loadAuthorizationAtEvaluatedHead(authorizationPath);
  }
  if (SHA40.test(String(evaluatedHead || ''))) {
    return defaultAuthorizationAtCommit(evaluatedHead, authorizationPath, options);
  }
  try {
    const candidateRoot = path.resolve(options.evaluatedRepositoryRoot
      || process.env.YANCE_EVALUATED_REPOSITORY_ROOT
      || TRUSTED_POLICY_ROOT);
    const fullPath = path.resolve(candidateRoot, ...authorizationPath.split('/'));
    if (!fullPath.startsWith(`${candidateRoot}${path.sep}`)) return null;
    return loadJsonObject(fullPath);
  } catch (_) {
    return null;
  }
}

function evaluateDelegatedGovernanceAuthorizationProposal(options = {}) {
  const branch = String(options.branch || '');
  const trustedMainHead = Object.prototype.hasOwnProperty.call(options, 'trustedMainHead')
    ? options.trustedMainHead
    : defaultTrustedMainHead(options);
  const evaluatedHead = Object.prototype.hasOwnProperty.call(options, 'evaluatedHead')
    ? options.evaluatedHead
    : defaultTrustedHead(options);
  let changedFiles = Object.prototype.hasOwnProperty.call(options, 'changedFiles')
    ? options.changedFiles
    : null;
  if (!Array.isArray(changedFiles)
    && SHA40.test(String(trustedMainHead || ''))
    && SHA40.test(String(evaluatedHead || ''))) {
    const resolver = options.resolveChangedFilesBetween
      || ((base, head) => defaultChangedFilesBetween(base, head, options));
    changedFiles = resolver(trustedMainHead, evaluatedHead);
  }
  if (!isExactBranch(branch)
    || !SHA40.test(String(trustedMainHead || ''))
    || !Array.isArray(changedFiles)
    || changedFiles.length !== 1) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_AUTHORIZATION_PROPOSAL_TRANSPORT_INVALID',
      mode: null,
      implementationAuthorityGranted: false
    });
  }
  const normalized = normalizeChangedFiles(changedFiles);
  if (normalized.length !== 1 || normalized[0] !== changedFiles[0]) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_AUTHORIZATION_PROPOSAL_TRANSPORT_INVALID',
      mode: null,
      implementationAuthorityGranted: false
    });
  }
  const authorizationPath = options.authorizationPath || normalized[0];
  const authorization = resolveGenericCandidateAuthorization(authorizationPath, evaluatedHead, options);
  const ancestor = options.isTrustedAncestor
    || ((base, head) => defaultTrustedAncestor(base, head, options));
  const resolveBlob = options.resolveCommitBlobSha
    || ((commit, repositoryPath) => defaultCommitBlobSha(commit, repositoryPath, options));
  const resolvePathMode = options.resolveCommitPathMode
    || ((commit, repositoryPath) => defaultCommitPathMode(commit, repositoryPath, options));
  const pass = SHA40.test(String(evaluatedHead || ''))
    && ancestor(trustedMainHead, evaluatedHead) === true
    && resolveBlob(trustedMainHead, authorizationPath) === null
    && resolvePathMode(evaluatedHead, authorizationPath) === '100644'
    && isValidGenericDelegatedGovernanceAuthorization(authorization, authorizationPath)
    && authorization.base.commit === trustedMainHead
    && authorization.authorizationBranch.name === branch
    && authorization.authorizationBranch.allowedChangedPaths[0] === normalized[0];
  return Object.freeze({
    pass,
    reasonCode: pass ? null : 'WP0_AUTHORIZATION_PROPOSAL_TRANSPORT_INVALID',
    mode: pass ? AUTHORIZATION_PROPOSAL_TRANSPORT_MODE : null,
    implementationAuthorityGranted: false,
    authorizationPath: pass ? authorizationPath : null,
    trustedMainHead: SHA40.test(String(trustedMainHead || '')) ? trustedMainHead : null
  });
}

function resolveDelegatedRouteBootstrapDeclaration(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return null;
  const schemas = [
    {
      paths: 'futureProductBootstrapPaths',
      count: 'futureProductBootstrapPathCount',
      digest: 'futureProductBootstrapPathSetSha256'
    },
    {
      paths: 'bootstrapPaths',
      count: 'bootstrapPathCount',
      digest: 'bootstrapPathSetSha256'
    }
  ];
  const present = schemas.filter(schema => Object.prototype.hasOwnProperty.call(authorization, schema.paths));
  if (present.length !== 1) return null;
  const schema = present[0];
  const rawPaths = authorization[schema.paths];
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) return null;
  if (rawPaths.some(repositoryPath => !isExactAdditionalPath(repositoryPath))) return null;
  const normalized = normalizeChangedFiles(rawPaths);
  if (normalized.length !== rawPaths.length) return null;
  if (authorization[schema.count] !== rawPaths.length) return null;
  if (authorization[schema.digest] !== workPackageChangedFilesSha256(rawPaths)) return null;
  return Object.freeze({
    paths: Object.freeze(normalized),
    pathField: schema.paths,
    countField: schema.count,
    digestField: schema.digest
  });
}

function validateDelegatedRoutePolicyMutation(options = {}) {
  const authorization = options.authorization;
  const basePolicy = options.basePolicy;
  const candidatePolicy = options.candidatePolicy;
  const denied = details => Object.freeze({
    pass: false,
    reasonCode: DELEGATED_ROUTE_POLICY_MUTATION_DENIED,
    ...(details || {})
  });

  if (!basePolicy || typeof basePolicy !== 'object' || Array.isArray(basePolicy)
    || !candidatePolicy || typeof candidatePolicy !== 'object' || Array.isArray(candidatePolicy)) {
    return denied();
  }
  const declaration = resolveDelegatedRouteBootstrapDeclaration(authorization);
  if (!declaration) return denied();
  if (!Array.isArray(basePolicy.productExactPaths) || !Array.isArray(candidatePolicy.productExactPaths)) {
    return denied();
  }
  if (basePolicy.productExactPaths.some(repositoryPath => !isExactAdditionalPath(repositoryPath))
    || candidatePolicy.productExactPaths.some(repositoryPath => !isExactAdditionalPath(repositoryPath))) {
    return denied();
  }
  const baseExact = normalizeChangedFiles(basePolicy.productExactPaths);
  const candidateExact = normalizeChangedFiles(candidatePolicy.productExactPaths);
  if (baseExact.length !== basePolicy.productExactPaths.length
    || candidateExact.length !== candidatePolicy.productExactPaths.length) return denied();

  const expectedExact = normalizeChangedFiles([...baseExact, ...declaration.paths]);
  if (!sameJson(candidateExact, expectedExact)) {
    return denied({ declaredPaths: declaration.paths });
  }

  const baseRest = { ...basePolicy };
  const candidateRest = { ...candidatePolicy };
  delete baseRest.productExactPaths;
  delete candidateRest.productExactPaths;
  if (!sameJson(baseRest, candidateRest)) {
    return denied({ declaredPaths: declaration.paths });
  }

  return Object.freeze({
    pass: true,
    reasonCode: null,
    declaredPaths: declaration.paths,
    declarationPathField: declaration.pathField
  });
}

function validateDelegatedDependencyIdentityMutation(options = {}) {
  const authorization = options.authorization;
  const repositoryPath = normalizeRepositoryPath(options.repositoryPath);
  const baseManifest = options.baseManifest;
  const candidateManifest = options.candidateManifest;
  const denied = () => Object.freeze({
    pass: false,
    reasonCode: DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED
  });
  if (!repositoryPath || !isPlainJsonObject(baseManifest) || !isPlainJsonObject(candidateManifest)) return denied();
  const implementation = authorization?.implementation;
  const implementationPaths = normalizeChangedFiles(implementation?.allowedChangedPaths);
  const policy = resolveDependencyIdentityPolicy(implementation, implementationPaths);
  if (!policy) return denied();
  const entries = policy.entries.filter(entry => entry.path === repositoryPath);
  if (entries.length === 0) return denied();

  const expected = JSON.parse(JSON.stringify(baseManifest));
  for (const entry of entries) {
    for (const section of DEPENDENCY_IDENTITY_SECTIONS) {
      const sectionValue = baseManifest[section];
      if (sectionValue !== undefined && !isPlainJsonObject(sectionValue)) return denied();
      if (isPlainJsonObject(sectionValue)
        && Object.prototype.hasOwnProperty.call(sectionValue, entry.name)) return denied();
    }
    if (expected[entry.section] === undefined) expected[entry.section] = {};
    if (!isPlainJsonObject(expected[entry.section])) return denied();
    expected[entry.section][entry.name] = entry.version;
  }
  if (!sameJsonSemantics(expected, candidateManifest)) return denied();
  return Object.freeze({
    pass: true,
    reasonCode: null,
    repositoryPath,
    entries: Object.freeze(entries)
  });
}

function dependencyManifestPathForControlPath(repositoryPath) {
  const normalized = normalizeRepositoryPath(repositoryPath);
  if (!normalized || !isDependencyControlPath(normalized)) return '';
  if (path.posix.basename(normalized) === 'package.json') return normalized;
  const directory = path.posix.dirname(normalized);
  return directory === '.' ? 'package.json' : `${directory}/package.json`;
}

function isNpmDependencyLockPath(repositoryPath) {
  const filename = path.posix.basename(repositoryPath);
  return filename === 'package-lock.json' || filename === 'npm-shrinkwrap.json';
}

function dependencySectionProjection(document) {
  if (!isPlainJsonObject(document)) return null;
  const projection = {};
  for (const section of DEPENDENCY_IDENTITY_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(document, section)) continue;
    if (!isPlainJsonObject(document[section])) return null;
    projection[section] = document[section];
  }
  return projection;
}

function validateDelegatedNpmLockfileClosure(candidateManifest, candidateLockfile, identityEntries = []) {
  if (!isPlainJsonObject(candidateManifest)
    || !isPlainJsonObject(candidateLockfile)
    || !Array.isArray(identityEntries)
    || ![2, 3].includes(candidateLockfile.lockfileVersion)
    || !isPlainJsonObject(candidateLockfile.packages)
    || !isPlainJsonObject(candidateLockfile.packages[''])) return false;
  const manifestProjection = dependencySectionProjection(candidateManifest);
  const lockfileProjection = dependencySectionProjection(candidateLockfile.packages['']);
  if (!manifestProjection
    || !lockfileProjection
    || !sameJsonSemantics(manifestProjection, lockfileProjection)) return false;
  for (const entry of identityEntries) {
    if (entry.section === 'peerDependencies') continue;
    const lockDescriptor = candidateLockfile.packages[`node_modules/${entry.name}`];
    if (!isPlainJsonObject(lockDescriptor) || lockDescriptor.version !== entry.version) return false;
  }
  return true;
}

function evaluateTrustedDelegatedGovernanceBranch(options = {}) {
  const branch = String(options.branch || '');
  const trustedMainHead = Object.prototype.hasOwnProperty.call(options, 'trustedMainHead')
    ? options.trustedMainHead
    : defaultTrustedMainHead(options);
  const evaluatedHead = Object.prototype.hasOwnProperty.call(options, 'evaluatedHead')
    ? options.evaluatedHead
    : defaultTrustedHead(options);
  if (!isExactBranch(branch)
    || !SHA40.test(String(trustedMainHead || ''))
    || !SHA40.test(String(evaluatedHead || ''))) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }

  const listAuthorizationPaths = options.listAuthorizationPaths
    || (() => defaultListGenericAuthorizationPaths(trustedMainHead, options));
  const rawPaths = listAuthorizationPaths();
  const authorizationPaths = Array.isArray(rawPaths)
    ? [...new Set(rawPaths.filter(isGenericDelegatedGovernanceAuthorizationPath))].sort()
    : [];
  const authorizations = new Map();
  const declarations = new Map();
  const graphInvalidPaths = new Set();

  function parseSupersessionDeclaration(authorizationPath, authorization) {
    if (!Object.prototype.hasOwnProperty.call(authorization, 'supersedes')) return null;
    const declaration = authorization.supersedes;
    const expectedKeys = ['authorizationPath', 'implementationBranch', 'reason'];
    if (!declaration
      || typeof declaration !== 'object'
      || Array.isArray(declaration)
      || !sameJson(Object.keys(declaration).sort(), expectedKeys)
      || !isGenericDelegatedGovernanceAuthorizationPath(declaration.authorizationPath)
      || !isExactBranch(declaration.implementationBranch)
      || declaration.authorizationPath === authorizationPath
      || declaration.implementationBranch === authorization.implementation.branch
      || typeof declaration.reason !== 'string'
      || declaration.reason.length === 0
      || declaration.reason !== declaration.reason.trim()) return false;
    return Object.freeze({
      authorizationPath: declaration.authorizationPath,
      implementationBranch: declaration.implementationBranch
    });
  }

  for (const authorizationPath of authorizationPaths) {
    const authorization = options.loadAuthorizationAtTrustedHead
      ? options.loadAuthorizationAtTrustedHead(authorizationPath)
      : defaultAuthorizationAtCommit(trustedMainHead, authorizationPath, options);
    if (!isValidGenericDelegatedGovernanceAuthorization(authorization, authorizationPath)) continue;
    authorizations.set(authorizationPath, authorization);
    const declaration = parseSupersessionDeclaration(authorizationPath, authorization);
    if (declaration === false) graphInvalidPaths.add(authorizationPath);
    else if (declaration) declarations.set(authorizationPath, declaration);
  }

  const candidatePaths = [...authorizations.entries()]
    .filter(([, authorization]) => authorization.implementation.branch === branch)
    .map(([authorizationPath]) => authorizationPath);
  const topologyPaths = new Set(candidatePaths);
  for (const [sourcePath, declaration] of declarations) {
    topologyPaths.add(sourcePath);
    if (authorizations.has(declaration.authorizationPath)) topologyPaths.add(declaration.authorizationPath);
  }

  const findIntroductions = options.findAuthorizationIntroductionMerges
    || (repositoryPath => defaultFindAuthorizationIntroductionMerges(trustedMainHead, repositoryPath, options));
  const resolveParents = options.resolveCommitParents
    || (commit => defaultCommitParentList(commit, options));
  const ancestor = options.isTrustedAncestor
    || ((base, head) => defaultTrustedAncestor(base, head, options));
  const resolveBlob = options.resolveCommitBlobSha
    || ((commit, repositoryPath) => defaultCommitBlobSha(commit, repositoryPath, options));
  const resolvePathMode = options.resolveCommitPathMode
    || ((commit, repositoryPath) => defaultCommitPathMode(commit, repositoryPath, options));
  const resolveChangedFiles = options.resolveChangedFilesBetween
    || ((base, head) => defaultChangedFilesBetween(base, head, options));
  const effectiveRecords = new Map();

  for (const authorizationPath of [...topologyPaths].sort()) {
    const authorization = authorizations.get(authorizationPath);
    if (!authorization) continue;
    const introductionMerges = findIntroductions(authorizationPath);
    if (!Array.isArray(introductionMerges)
      || introductionMerges.length !== 1
      || !SHA40.test(String(introductionMerges[0] || ''))) continue;
    const mergeCommit = introductionMerges[0];
    const parents = resolveParents(mergeCommit);
    if (!Array.isArray(parents)
      || parents.length !== 2
      || parents[0] !== authorization.base.commit
      || !SHA40.test(String(parents[1] || ''))
      || parents[0] === parents[1]) continue;
    const reviewedHead = parents[1];
    if (ancestor(authorization.base.commit, reviewedHead) !== true) continue;

    const mergeBlob = resolveBlob(mergeCommit, authorizationPath);
    const reviewedBlob = resolveBlob(reviewedHead, authorizationPath);
    const trustedBlob = resolveBlob(trustedMainHead, authorizationPath);
    const baseBlob = resolveBlob(authorization.base.commit, authorizationPath);
    const mergeMode = resolvePathMode(mergeCommit, authorizationPath);
    const reviewedMode = resolvePathMode(reviewedHead, authorizationPath);
    const trustedMode = resolvePathMode(trustedMainHead, authorizationPath);
    if (![mergeBlob, reviewedBlob, trustedBlob].every(value => SHA40.test(String(value || '')))
      || mergeBlob !== reviewedBlob
      || mergeBlob !== trustedBlob
      || baseBlob !== null
      || mergeMode !== '100644'
      || reviewedMode !== '100644'
      || trustedMode !== '100644') continue;

    const reviewedChangedFiles = resolveChangedFiles(authorization.base.commit, reviewedHead);
    const reviewedNormalized = normalizeChangedFiles(reviewedChangedFiles);
    if (!Array.isArray(reviewedChangedFiles)
      || reviewedChangedFiles.length !== 1
      || reviewedNormalized.length !== 1
      || reviewedNormalized[0] !== authorizationPath
      || reviewedChangedFiles[0] !== authorizationPath) continue;

    const mergeChangedFiles = resolveChangedFiles(authorization.base.commit, mergeCommit);
    const mergeNormalized = normalizeChangedFiles(mergeChangedFiles);
    if (!Array.isArray(mergeChangedFiles)
      || mergeChangedFiles.length !== 1
      || mergeNormalized.length !== 1
      || mergeNormalized[0] !== authorizationPath
      || mergeChangedFiles[0] !== authorizationPath) continue;
    if (ancestor(mergeCommit, trustedMainHead) !== true) continue;

    effectiveRecords.set(authorizationPath, Object.freeze({
      authorizationPath,
      authorization,
      mergeCommit,
      reviewedHead
    }));
  }

  const edges = new Map();
  const incoming = new Map();
  for (const [sourcePath, declaration] of declarations) {
    const sourceRecord = effectiveRecords.get(sourcePath);
    if (!sourceRecord) continue;
    const targetAuthorization = authorizations.get(declaration.authorizationPath);
    const targetRecord = effectiveRecords.get(declaration.authorizationPath);
    if (!targetAuthorization
      || !targetRecord
      || targetAuthorization.implementation.branch !== declaration.implementationBranch
      || ancestor(targetRecord.mergeCommit, sourceRecord.authorization.base.commit) !== true) {
      graphInvalidPaths.add(sourcePath);
      continue;
    }
    edges.set(sourcePath, declaration.authorizationPath);
    const sources = incoming.get(declaration.authorizationPath) || [];
    sources.push(sourcePath);
    incoming.set(declaration.authorizationPath, sources);
  }

  for (const [targetPath, sources] of incoming) {
    if (sources.length <= 1) continue;
    graphInvalidPaths.add(targetPath);
    for (const sourcePath of sources) graphInvalidPaths.add(sourcePath);
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visitSupersessionNode(node) {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const cycleStart = stack.lastIndexOf(node);
      for (const cycleNode of stack.slice(cycleStart)) graphInvalidPaths.add(cycleNode);
      return;
    }
    visiting.add(node);
    stack.push(node);
    const target = edges.get(node);
    if (target) visitSupersessionNode(target);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const sourcePath of edges.keys()) visitSupersessionNode(sourcePath);

  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const [sourcePath, targetPath] of edges) {
      if (!graphInvalidPaths.has(sourcePath) && graphInvalidPaths.has(targetPath)) {
        graphInvalidPaths.add(sourcePath);
        propagated = true;
      }
    }
  }

  const supersededBy = new Map();
  for (const [sourcePath, targetPath] of edges) {
    if (graphInvalidPaths.has(sourcePath) || graphInvalidPaths.has(targetPath)) continue;
    supersededBy.set(targetPath, sourcePath);
  }

  const matches = candidatePaths
    .map(authorizationPath => effectiveRecords.get(authorizationPath))
    .filter(Boolean);
  if (matches.length !== 1) {
    return Object.freeze({
      pass: false,
      reasonCode: matches.length > 1
        ? 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_AMBIGUOUS'
        : 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }

  const match = matches[0];
  if (graphInvalidPaths.has(match.authorizationPath)) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_SUPERSESSION_INVALID',
      authorityMode: null,
      authorizationPath: match.authorizationPath,
      unauthorizedPaths: []
    });
  }
  if (supersededBy.has(match.authorizationPath)) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_SUPERSEDED',
      authorityMode: null,
      authorizationPath: match.authorizationPath,
      supersededByAuthorizationPath: supersededBy.get(match.authorizationPath),
      unauthorizedPaths: []
    });
  }
  if (ancestor(match.mergeCommit, evaluatedHead) !== true) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }

  const resolveMergeBases = options.resolveMergeBases
    || ((left, right) => defaultMergeBases(left, right, options));
  const mergeBases = resolveMergeBases(trustedMainHead, evaluatedHead);
  if (!Array.isArray(mergeBases)
    || mergeBases.length !== 1
    || !SHA40.test(String(mergeBases[0] || ''))) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }
  const implementationBase = mergeBases[0];
  if (ancestor(match.mergeCommit, implementationBase) !== true
    || ancestor(implementationBase, trustedMainHead) !== true
    || ancestor(implementationBase, evaluatedHead) !== true) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }

  const implementationChangedFiles = resolveChangedFiles(implementationBase, evaluatedHead);
  if (!Array.isArray(implementationChangedFiles)) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }
  const implementationNormalized = normalizeChangedFiles(implementationChangedFiles);
  if (implementationNormalized.length !== implementationChangedFiles.length
    || !sameJson(implementationNormalized, implementationChangedFiles)) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    });
  }
  const allowed = new Set(match.authorization.implementation.allowedChangedPaths);
  const unauthorizedPaths = implementationNormalized.filter(repositoryPath => !allowed.has(repositoryPath));
  if (unauthorizedPaths.length !== 0) {
    return Object.freeze({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_SCOPE_DENIED',
      authorityMode: null,
      authorizationPath: match.authorizationPath,
      authorizationMergeCommit: match.mergeCommit,
      reviewedAuthorizationHead: match.reviewedHead,
      unauthorizedPaths: Object.freeze([...unauthorizedPaths])
    });
  }

  if (match.authorization.implementation.genericRouteMutationGuardRequired === true
    && implementationNormalized.includes(DELEGATED_ROUTE_POLICY_PATH)) {
    const loadRoutingPolicy = options.loadRoutingPolicyAtCommit
      || (commit => defaultAuthorizationAtCommit(commit, DELEGATED_ROUTE_POLICY_PATH, options));
    const routePolicyValidation = validateDelegatedRoutePolicyMutation({
      authorization: match.authorization,
      basePolicy: loadRoutingPolicy(implementationBase),
      candidatePolicy: loadRoutingPolicy(evaluatedHead)
    });
    if (!routePolicyValidation.pass) {
      return Object.freeze({
        pass: false,
        reasonCode: DELEGATED_ROUTE_POLICY_MUTATION_DENIED,
        authorityMode: null,
        authorizationPath: match.authorizationPath,
        authorizationMergeCommit: match.mergeCommit,
        reviewedAuthorizationHead: match.reviewedHead,
        unauthorizedPaths: Object.freeze([])
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(match.authorization.implementation, 'dependencyIdentityPolicy')) {
    const identityPolicy = resolveDependencyIdentityPolicy(
      match.authorization.implementation,
      match.authorization.implementation.allowedChangedPaths
    );
    if (!identityPolicy) {
      return Object.freeze({
        pass: false,
        reasonCode: DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED,
        authorityMode: null,
        authorizationPath: match.authorizationPath,
        authorizationMergeCommit: match.mergeCommit,
        reviewedAuthorizationHead: match.reviewedHead,
        unauthorizedPaths: Object.freeze([])
      });
    }
    const denyDependencyIdentityMutation = () => Object.freeze({
      pass: false,
      reasonCode: DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED,
      authorityMode: null,
      authorizationPath: match.authorizationPath,
      authorizationMergeCommit: match.mergeCommit,
      reviewedAuthorizationHead: match.reviewedHead,
      unauthorizedPaths: Object.freeze([])
    });
    const declaredManifestPaths = new Set(identityPolicy.entries.map(entry => entry.path));
    const changedDependencyPaths = implementationNormalized.filter(isDependencyControlPath);
    const changedDependencyPathSet = new Set(changedDependencyPaths);
    const authorizedDependencyPaths = match.authorization.implementation.dependencyModificationPolicy.allowedDependencyPaths;
    const authorizedDependencyPathSet = new Set(authorizedDependencyPaths);
    const loadDependencyControl = options.loadDependencyControlAtCommit
      || options.loadDependencyManifestAtCommit
      || ((commit, repositoryPath) => defaultAuthorizationAtCommit(commit, repositoryPath, options));

    for (const repositoryPath of changedDependencyPaths) {
      const manifestPath = dependencyManifestPathForControlPath(repositoryPath);
      if (!manifestPath || !declaredManifestPaths.has(manifestPath)) return denyDependencyIdentityMutation();

      if (repositoryPath === manifestPath) {
        const identityValidation = validateDelegatedDependencyIdentityMutation({
          authorization: match.authorization,
          repositoryPath,
          baseManifest: loadDependencyControl(implementationBase, repositoryPath),
          candidateManifest: loadDependencyControl(evaluatedHead, repositoryPath)
        });
        if (!identityValidation.pass) return denyDependencyIdentityMutation();
        continue;
      }

      if (!changedDependencyPathSet.has(manifestPath) || !isNpmDependencyLockPath(repositoryPath)) {
        return denyDependencyIdentityMutation();
      }
      if (!validateDelegatedNpmLockfileClosure(
        loadDependencyControl(evaluatedHead, manifestPath),
        loadDependencyControl(evaluatedHead, repositoryPath),
        identityPolicy.entries.filter(entry => entry.path === manifestPath)
      )) return denyDependencyIdentityMutation();
    }

    for (const manifestPath of declaredManifestPaths) {
      if (!changedDependencyPathSet.has(manifestPath)) continue;
      const manifestDirectory = path.posix.dirname(manifestPath);
      const manifestPrefix = manifestDirectory === '.' ? '' : `${manifestDirectory}/`;
      const existingNpmLockPaths = [
        `${manifestPrefix}package-lock.json`,
        `${manifestPrefix}npm-shrinkwrap.json`
      ].filter(repositoryPath => [implementationBase, trustedMainHead].some(commit => (
        SHA40.test(String(resolveBlob(commit, repositoryPath) || ''))
      )));
      const companionPaths = [...new Set([
        ...authorizedDependencyPaths.filter(repositoryPath => (
          repositoryPath !== manifestPath
          && dependencyManifestPathForControlPath(repositoryPath) === manifestPath
        )),
        ...existingNpmLockPaths
      ])];
      for (const companionPath of companionPaths) {
        if (!authorizedDependencyPathSet.has(companionPath)
          || !changedDependencyPathSet.has(companionPath)
          || !isNpmDependencyLockPath(companionPath)) {
          return denyDependencyIdentityMutation();
        }
        if (!validateDelegatedNpmLockfileClosure(
          loadDependencyControl(evaluatedHead, manifestPath),
          loadDependencyControl(evaluatedHead, companionPath),
          identityPolicy.entries.filter(entry => entry.path === manifestPath)
        )) return denyDependencyIdentityMutation();
      }
    }
  }

  return Object.freeze({
    pass: true,
    reasonCode: null,
    authorityMode: TRUSTED_MAIN_DELEGATED_GOVERNANCE_MODE,
    authorizationPath: match.authorizationPath,
    authorizationMergeCommit: match.mergeCommit,
    reviewedAuthorizationHead: match.reviewedHead,
    unauthorizedPaths: Object.freeze([])
  });
}

function isAuthorizedGenericDelegatedGovernanceBranch(branch, options = {}) {
  return evaluateTrustedDelegatedGovernanceBranch({ branch, ...options }).pass;
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

function isAuthorizedStaticDelegatedGovernanceBranch(branch, options = {}) {
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

function isAuthorizedDelegatedGovernanceBranch(branch, options = {}) {
  if (isAuthorizedStaticDelegatedGovernanceBranch(branch, options)) return true;
  return isAuthorizedGenericDelegatedGovernanceBranch(branch, options.generic || {});
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

function isWorkflowControlPath(repositoryPath) {
  return repositoryPath.startsWith('.github/workflows/')
    || repositoryPath.startsWith('.github/actions/');
}

function isDependencyControlPath(repositoryPath) {
  const segments = repositoryPath.split('/');
  return DEPENDENCY_CONTROL_FILENAMES.has(segments[segments.length - 1]);
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
  GENERIC_DELEGATED_GOVERNANCE_DOCUMENT_TYPE,
  GENERIC_DELEGATED_GOVERNANCE_STATUS,
  AUTHORIZATION_PROPOSAL_TRANSPORT_MODE,
  TRUSTED_MAIN_DELEGATED_GOVERNANCE_MODE,
  DELEGATED_ROUTE_POLICY_PATH,
  DELEGATED_ROUTE_POLICY_MUTATION_DENIED,
  DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED,
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  buildTrustedGitEnvironment,
  loadWorkPackageAuthorization,
  loadWorkPackageScopeAmendment,
  loadWorkPackageTaskScopeChain,
  loadWorkPackagePostMergeDefect,
  isValidWorkPackageAuthorization,
  isValidWorkPackageScopeAmendment,
  validateWorkPackageTaskScopeChain,
  isValidWorkPackagePostMergeDefect,
  isAuthorizedAcv2WorkPackageBranch,
  isGenericDelegatedGovernanceAuthorizationPath,
  isValidGenericDelegatedGovernanceAuthorization,
  evaluateDelegatedGovernanceAuthorizationProposal,
  validateDelegatedRoutePolicyMutation,
  validateDelegatedDependencyIdentityMutation,
  evaluateTrustedDelegatedGovernanceBranch,
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