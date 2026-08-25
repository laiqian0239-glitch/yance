'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyAuthorizedDeletionFallback,
  classifyWp0Route,
  isExactBranch,
  sameExactPathSet
} = require('./wp0-routing');
const {
  appendGithubOutputs,
  argValue,
  diffChangedFiles,
  parseNulFileList,
  runJsonCli
} = require('./cli-support');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT, 'governance', 'layered-ci', 'wp0-routing-policy.json');
const SHA40 = /^[0-9a-f]{40}$/u;
const DELEGATED_AUTHORIZATION_PATH = /^governance\/layered-ci\/[a-z0-9][a-z0-9-]*-authorization\.json$/u;
const DELEGATED_AUTHORIZATION_DOCUMENT_TYPE = 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION';
const DELEGATED_AUTHORIZATION_STATUS = 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE';

function gitText(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

function gitBuffer(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
}

function exactRange() {
  const base = argValue(process.argv, '--base');
  const head = argValue(process.argv, '--head');
  if (!SHA40.test(String(base || '')) || !SHA40.test(String(head || ''))) {
    throw Object.assign(new Error('--base and --head must be exact lowercase commit IDs'), {
      reasonCode: 'WP0_ROUTE_DIFF_RANGE_INVALID'
    });
  }
  const changedFiles = diffChangedFiles({
    repoRoot: ROOT,
    base,
    head,
    reasonCode: 'WP0_ROUTE_DIFF_RANGE_INVALID'
  });
  return { base, head, changedFiles };
}

function deletedFilesBetween(base, head) {
  const output = gitBuffer([
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=D',
    '--no-renames',
    base,
    head,
    '--'
  ]);
  if (output.length === 0) return [];
  return parseNulFileList(output, 'WP0_ROUTE_DIFF_RANGE_INVALID');
}

function authorizationPathsForBranch(base, branch) {
  if (!isExactBranch(branch)) return [];
  const output = gitText([
    'grep',
    '-l',
    '-F',
    '-e',
    branch,
    base,
    '--',
    'governance/layered-ci'
  ], { allowFailure: true });
  if (!output) return [];
  const prefix = `${base}:`;
  return [...new Set(output.split(/\r?\n/u)
    .map(line => line.startsWith(prefix) ? line.slice(prefix.length) : line)
    .filter(repositoryPath => DELEGATED_AUTHORIZATION_PATH.test(repositoryPath)))]
    .sort();
}

function readJsonAt(commit, repositoryPath) {
  try {
    const document = JSON.parse(gitText(['show', `${commit}:${repositoryPath}`]));
    return document && typeof document === 'object' && !Array.isArray(document) ? document : null;
  } catch (_) {
    return null;
  }
}

function blobAt(commit, repositoryPath) {
  const value = gitText(['rev-parse', `${commit}:${repositoryPath}`], { allowFailure: true });
  return /^[0-9a-f]{40}$/u.test(value) ? value : null;
}

function ordinaryMergeImportedPath(base, repositoryPath) {
  const mergeCommit = gitText([
    'log',
    '--first-parent',
    '-n',
    '1',
    '--format=%H',
    base,
    '--',
    repositoryPath
  ], { allowFailure: true });
  if (!SHA40.test(mergeCommit)) return null;

  const row = gitText(['rev-list', '--parents', '-n', '1', mergeCommit], { allowFailure: true })
    .split(/\s+/u)
    .filter(Boolean);
  if (row.length !== 3 || row[0] !== mergeCommit) return null;

  const mergeBlob = blobAt(mergeCommit, repositoryPath);
  const firstParentBlob = blobAt(row[1], repositoryPath);
  const secondParentBlob = blobAt(row[2], repositoryPath);
  if (!mergeBlob || mergeBlob !== secondParentBlob || firstParentBlob === mergeBlob) return null;

  return { mergeCommit, firstParent: row[1], secondParent: row[2], blobSha: mergeBlob };
}

function trustedMergedAuthorizations(base, branch, changedFiles) {
  const matches = [];
  for (const authorizationPath of authorizationPathsForBranch(base, branch)) {
    const authorization = readJsonAt(base, authorizationPath);
    if (!authorization
      || authorization.schemaVersion !== 1
      || authorization.documentType !== DELEGATED_AUTHORIZATION_DOCUMENT_TYPE
      || authorization.status !== DELEGATED_AUTHORIZATION_STATUS
      || authorization.implementation?.branch !== branch
      || !sameExactPathSet(authorization.implementation?.allowedChangedPaths, changedFiles)) continue;

    const provenance = ordinaryMergeImportedPath(base, authorizationPath);
    if (!provenance) continue;
    matches.push({
      ...authorization,
      trustedMergedBaseAuthorization: true,
      authorizationPath,
      authorizationMergeCommit: provenance.mergeCommit,
      authorizationBlobSha: provenance.blobSha
    });
  }
  return matches;
}

function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const { base, head, changedFiles } = exactRange();
  const normalResult = classifyWp0Route(policy, changedFiles);
  let result = normalResult;

  if (!normalResult.pass && normalResult.reasonCode === 'WP0_ROUTE_UNKNOWN_PATH') {
    const branch = String(process.env.IMPLEMENTATION_BRANCH || '');
    result = classifyAuthorizedDeletionFallback(normalResult, {
      changedFiles,
      deletedFiles: deletedFilesBetween(base, head),
      branch,
      authorizations: trustedMergedAuthorizations(base, branch, changedFiles)
    });
  }

  appendGithubOutputs({ route: result.route || 'FAIL' });
  return result;
}

runJsonCli(main, 'WP0_ROUTE_SELECTION_FAILED');
