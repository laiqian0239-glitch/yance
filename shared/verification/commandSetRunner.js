'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalSha256, sha256Hex } = require('./jcs');
const { commandSetDigest, validateCommandSet } = require('./commandSetRegistry');
const { computeCanonicalPayloadSha256, validateUnsignedCandidate, validRelativePath } = require('./canonicalEvidenceReceipt');
const { captureWorkspaceEvidence, codedError } = require('./workspaceEvidence');
const { REASON_CODES } = require('./reasonCodes');

const SECRET_NAME_RE = /(token|secret|password|credential|private[_-]?key|api[_-]?key)/iu;
function sanitizedEnvironment(environment) { return Object.fromEntries(Object.entries(environment).filter(([name]) => !SECRET_NAME_RE.test(name))); }
function ensureClean(evidence, headCommit) {
  if (evidence.head !== headCommit) throw codedError(REASON_CODES.EVIDENCE_WORKSPACE_HEAD_MISMATCH, { actual: evidence.head, expected: headCommit });
  if (evidence.trackedDiffBytes !== 0) throw codedError(REASON_CODES.EVIDENCE_WORKSPACE_DIRTY);
  if (evidence.unexpectedPaths.length !== 0) throw codedError(REASON_CODES.EVIDENCE_UNEXPECTED_UNTRACKED_PATHS, { paths: evidence.unexpectedPaths });
}
function outputAllowed(outputPath, roots) { return validRelativePath(outputPath) && roots.some((root) => outputPath === root || outputPath.startsWith(`${root}/`)); }
function mediaType(relativePath) { return relativePath.endsWith('.json') ? 'application/json' : 'application/octet-stream'; }

function runRegisteredCommandSet({ repoRoot, repository, workPackage, gateId, baseCommit, headCommit, commandSet, producer, outputPath }) {
  const validation = validateCommandSet(commandSet);
  if (!validation.pass) throw codedError(validation.reasonCode);
  if (!/^[0-9a-f]{40}$/u.test(baseCommit || '') || !/^[0-9a-f]{40}$/u.test(headCommit || '')) throw codedError(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (!producer || producer.platform !== commandSet.platform) throw codedError(REASON_CODES.EVIDENCE_PLATFORM_MISMATCH);
  const generatedRoots = [...new Set(commandSet.commands.flatMap((command) => command.generatedRoots))].sort();
  if (!outputAllowed(outputPath, generatedRoots)) throw codedError(REASON_CODES.EVIDENCE_PATH_INVALID);

  const pre = captureWorkspaceEvidence({ repoRoot, allowedGeneratedRoots: generatedRoots });
  ensureClean(pre, headCommit);
  const executionStartedAt = new Date().toISOString();
  const executionCommands = [];
  const results = [];
  const artifacts = [];

  for (const command of commandSet.commands) {
    const startedAt = new Date().toISOString();
    const child = spawnSync(command.executable, command.argv, { cwd: repoRoot, shell: false, encoding: null, maxBuffer: 32 * 1024 * 1024, env: sanitizedEnvironment(process.env) });
    const completedAt = new Date().toISOString();
    const stdout = child.stdout || Buffer.alloc(0);
    const stderr = child.stderr || Buffer.alloc(0);
    const exitCode = Number.isSafeInteger(child.status) ? child.status : -1;
    executionCommands.push({ commandId: command.commandId, argvDigest: canonicalSha256({ executable: command.executable, argv: command.argv }), exitCode, startedAt, completedAt, stdoutSha256: sha256Hex(stdout), stderrSha256: sha256Hex(stderr) });
    results.push({ commandId: command.commandId, passed: exitCode === command.expectedExitCode && !child.signal && !child.error });
    for (let index = 0; index < command.artifacts.length; index += 1) {
      const relativePath = command.artifacts[index];
      const absolute = path.join(repoRoot, relativePath);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw codedError(REASON_CODES.EVIDENCE_ARTIFACT_DIGEST_MISMATCH, { relativePath });
      const bytes = fs.readFileSync(absolute);
      artifacts.push({ artifactId: `${command.commandId}:${index + 1}`, relativePath, sha256: sha256Hex(bytes), sizeBytes: bytes.length, mediaType: mediaType(relativePath), producerCommandId: command.commandId });
    }
  }

  const post = captureWorkspaceEvidence({ repoRoot, allowedGeneratedRoots: generatedRoots });
  ensureClean(post, headCommit);
  const candidate = {
    schemaVersion: 1,
    recordType: 'YANCE_PORTABLE_VERIFICATION_EVIDENCE_RECEIPT',
    repository,
    workPackage,
    gateId,
    baseCommit,
    headCommit,
    adapterType: 'signed-executor-v1',
    producer,
    commandSet: { commandSetId: commandSet.commandSetId, commandSetDigest: commandSetDigest(commandSet), platform: commandSet.platform },
    execution: { startedAt: executionStartedAt, completedAt: new Date().toISOString(), commands: executionCommands },
    workspace: { preHead: pre.head, postHead: post.head, preTrackedDiffSha256: pre.trackedDiffSha256, postTrackedDiffSha256: post.trackedDiffSha256, preUnexpectedUntrackedPathSetSha256: pre.unexpectedUntrackedPathSetSha256, postUnexpectedUntrackedPathSetSha256: post.unexpectedUntrackedPathSetSha256, allowedGeneratedRootSetSha256: pre.allowedGeneratedRootSetSha256 },
    results,
    artifacts,
    canonicalPayloadSha256: null,
    authenticity: null,
    receiptSha256: null
  };
  candidate.canonicalPayloadSha256 = computeCanonicalPayloadSha256(candidate);
  const candidateValidation = validateUnsignedCandidate(candidate);
  if (!candidateValidation.pass) throw codedError(candidateValidation.reasonCode, candidateValidation.details);
  const absoluteOutput = path.join(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  return candidate;
}

module.exports = { runRegisteredCommandSet, sanitizedEnvironment };
