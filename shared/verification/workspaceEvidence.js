'use strict';

const { spawnSync } = require('node:child_process');
const { sha256Hex, canonicalSha256 } = require('./jcs');
const { REASON_CODES } = require('./reasonCodes');

function codedError(code, details) { const error = new Error(code); error.code = code; error.details = details; return error; }
function git(root, args, { encoding = null } = {}) {
  const result = spawnSync('git', args, { cwd: root, shell: false, encoding, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 || result.signal || result.error) throw codedError(REASON_CODES.EVIDENCE_WORKSPACE_DIRTY, { args, status: result.status, stderr: result.stderr?.toString?.() });
  return result.stdout;
}
function underAllowedRoot(relativePath, roots) { return roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`)); }
function captureWorkspaceEvidence({ repoRoot, allowedGeneratedRoots = [] }) {
  const head = git(repoRoot, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const trackedDiff = git(repoRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
  const untrackedRaw = git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  const allUntrackedPaths = untrackedRaw.toString('utf8').split('\0').filter(Boolean).map((value) => value.replaceAll('\\', '/')).sort();
  const unexpectedPaths = allUntrackedPaths.filter((value) => !underAllowedRoot(value, allowedGeneratedRoots));
  return { head, trackedDiffSha256: sha256Hex(trackedDiff), trackedDiffBytes: trackedDiff.length, unexpectedUntrackedPathSetSha256: sha256Hex(Buffer.from(`${unexpectedPaths.join('\n')}\n`)), unexpectedPaths, allowedGeneratedRootSetSha256: canonicalSha256([...new Set(allowedGeneratedRoots)].sort()) };
}

module.exports = { captureWorkspaceEvidence, codedError };
