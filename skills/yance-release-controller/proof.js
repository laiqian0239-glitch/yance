#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  AdmissionError,
  DEFAULT_MAX_AGE_HOURS,
  STATUS_GREEN,
  inspectLiveGit,
  loadAndValidateInputs,
  readJsonFile,
  sha256,
  stableStringify,
} = require("./admission.js");

const HELP = `Yance Fresh State Recovery proof

Usage:
  node proof.js --evidence <controller-state.json> --comment-body <comment.md> \\
    --comments-snapshot <issue-comments.json> --admission <admission.json> [--format text|json]
  node proof.js --help

The command verifies the immutable admission digest, original body/snapshot/evidence
bytes, and current local Git identity, then prints the recovered Controller state.
It proves the last Controller State only within the supplied complete snapshot; it
does not prove the remote Issue has not changed since export.
`;

function parseArgs(argv) {
  const result = { format: "text", maxAgeHours: DEFAULT_MAX_AGE_HOURS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!["--evidence", "--comment-body", "--comments-snapshot", "--admission", "--format", "--max-age-hours"].includes(arg)) throw new AdmissionError("ARGUMENT_RED", `Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new AdmissionError("ARGUMENT_RED", `Missing value for ${arg}`);
    index += 1;
    if (arg === "--evidence") result.evidencePath = value;
    if (arg === "--comment-body") result.commentBodyPath = value;
    if (arg === "--comments-snapshot") result.commentsSnapshotPath = value;
    if (arg === "--admission") result.admissionPath = value;
    if (arg === "--format") result.format = value;
    if (arg === "--max-age-hours") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > DEFAULT_MAX_AGE_HOURS) throw new AdmissionError("ARGUMENT_RED", "--max-age-hours must be greater than 0 and no more than 24");
      result.maxAgeHours = parsed;
    }
  }
  if (!result.evidencePath) throw new AdmissionError("ARGUMENT_RED", "--evidence is required");
  if (!result.commentBodyPath) throw new AdmissionError("ARGUMENT_RED", "--comment-body is required");
  if (!result.commentsSnapshotPath) throw new AdmissionError("ARGUMENT_RED", "--comments-snapshot is required");
  if (!result.admissionPath) throw new AdmissionError("ARGUMENT_RED", "--admission is required");
  if (!["text", "json"].includes(result.format)) throw new AdmissionError("ARGUMENT_RED", "--format must be text or json");
  return result;
}

function verifyAdmission(admission, evidenceBytes, evidence, snapshotSelection) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission)) throw new AdmissionError("PROOF_RED", "Admission must be a JSON object");
  if (admission.status !== STATUS_GREEN) throw new AdmissionError("PROOF_RED", "Admission status is not RECOVERY_ADMITTED");
  if (admission.recovery?.executedOnce !== true) throw new AdmissionError("PROOF_RED", "Admission does not prove one-shot recovery");
  if (admission.schemaVersion !== 2) throw new AdmissionError("PROOF_RED", "Admission schemaVersion is not 2");
  if (admission.limits?.networkMutation !== false || admission.limits?.gitMutation !== false || admission.limits?.promotionAuthorized !== false
    || admission.limits?.remoteRealtimeVerified !== false || admission.limits?.latestControllerScope !== "LAST_CONTROLLER_STATE_WITHIN_SUPPLIED_COMPLETE_SNAPSHOT"
    || admission.limits?.authority !== "EVIDENCE_PROJECTION_ONLY") {
    throw new AdmissionError("PROOF_RED", "Admission limits were weakened or claim promotion authority");
  }
  const suppliedDigest = admission.payloadSha256;
  if (!/^[0-9a-f]{64}$/.test(suppliedDigest || "")) throw new AdmissionError("PROOF_RED", "Admission payload digest is absent or invalid");
  const unsigned = { ...admission };
  delete unsigned.payloadSha256;
  const actualDigest = sha256(stableStringify(unsigned));
  if (actualDigest !== suppliedDigest) throw new AdmissionError("PROOF_RED", "Admission payload digest mismatch");
  const evidenceDigest = sha256(evidenceBytes);
  if (admission.recovery.evidenceSha256 !== evidenceDigest) throw new AdmissionError("PROOF_RED", "Original evidence bytes do not match the admitted evidence digest");
  if (admission.recovery.commentBodySha256 !== snapshotSelection.commentBodySha256) throw new AdmissionError("PROOF_RED", "Original Controller comment body does not match the admitted body digest");
  if (admission.recovery.commentsSnapshotSha256 !== snapshotSelection.commentsSnapshotSha256) throw new AdmissionError("PROOF_RED", "Issue comments snapshot does not match the admitted snapshot digest");
  if (admission.recovery.snapshotExportedAt !== snapshotSelection.snapshotExportedAt
    || admission.recovery.snapshotCommentCount !== snapshotSelection.snapshotCommentCount
    || admission.recovery.selectedCommentId !== snapshotSelection.selectedCommentId
    || admission.recovery.selectedCommentUrl !== snapshotSelection.selectedCommentUrl
    || admission.recovery.selectedControllerStateVersion !== snapshotSelection.selectedControllerStateVersion) {
    throw new AdmissionError("PROOF_RED", "Snapshot selection no longer matches the admitted last Controller State");
  }
  if (admission.recovery.continuityBreakId !== evidence.recovery.continuityBreakId) throw new AdmissionError("PROOF_RED", "Continuity break identity differs from admitted evidence");
  const liveGit = inspectLiveGit(evidence.git);
  if (stableStringify(liveGit) !== stableStringify(admission.liveGit)) throw new AdmissionError("PROOF_RED", "Current Git identity differs from the admitted Git identity");
  return liveGit;
}

function reportFrom(admission) {
  const state = admission.current;
  return {
    status: "FRESH_STATE_RECOVERY_PROVED",
    recoveryKey: admission.recovery.recoveryKey,
    currentMain: state.main,
    currentExactHead: state.exactHead,
    currentBranch: state.branch,
    currentPr: state.pr,
    currentControllerState: state.controllerState,
    frozenHeads: state.frozenHeads,
    consumedRuns: state.consumedRuns,
    knownReds: state.knownReds,
    knownGreens: state.knownGreens,
    currentRootCause: state.rootCause,
    currentCausalBatch: state.causalBatch,
    prerequisites: state.prerequisites,
    allowedPaths: state.allowedPaths,
    forbiddenPaths: state.forbiddenPaths,
    riskSurface: state.riskSurface,
    localAcceptance: state.localAcceptance,
    unknownBlockers: state.unknownBlockers,
    nextAllowedAction: state.nextAllowedAction,
    controllerFreshnessBoundary: "LAST CONTROLLER STATE WITHIN SUPPLIED COMPLETE SNAPSHOT; REMOTE REAL-TIME STATE NOT PROVED",
    promotion: "NOT AUTHORIZED BY THIS SKILL",
  };
}

function compact(value) {
  if (Array.isArray(value) && value.length === 0) return "[]";
  return JSON.stringify(value);
}

function formatText(report) {
  return [
    `FRESH STATE RECOVERY: PROVED ONCE (${report.recoveryKey})`,
    `CURRENT MAIN: ${report.currentMain}`,
    `CURRENT EXACT HEAD: ${report.currentExactHead}`,
    `CURRENT BRANCH: ${report.currentBranch}`,
    `CURRENT PR: ${compact(report.currentPr)}`,
    `CURRENT CONTROLLER STATE: ${compact(report.currentControllerState)}`,
    `FROZEN HEADS: ${compact(report.frozenHeads)}`,
    `CONSUMED RUNS: ${compact(report.consumedRuns)}`,
    `KNOWN REDS: ${compact(report.knownReds)}`,
    `KNOWN GREENS: ${compact(report.knownGreens)}`,
    `CURRENT ROOT CAUSE: ${compact(report.currentRootCause)}`,
    `CURRENT CAUSAL BATCH: ${compact(report.currentCausalBatch)}`,
    `PREREQUISITES: ${compact(report.prerequisites)}`,
    `ALLOWED PATHS: ${compact(report.allowedPaths)}`,
    `FORBIDDEN PATHS: ${compact(report.forbiddenPaths)}`,
    `RISK SURFACE: ${compact(report.riskSurface)}`,
    `LOCAL ACCEPTANCE: ${compact(report.localAcceptance)}`,
    `UNKNOWN BLOCKERS: ${report.unknownBlockers}`,
    `NEXT ALLOWED ACTION: ${compact(report.nextAllowedAction)}`,
    `CONTROLLER FRESHNESS BOUNDARY: ${report.controllerFreshnessBoundary}`,
    `PROMOTION: ${report.promotion}`,
  ].join("\n") + "\n";
}

function execute(options) {
  const { evidenceRead, input: evidence, snapshotSelection } = loadAndValidateInputs(options);
  const admissionRead = readJsonFile(path.resolve(options.admissionPath), "Admission file");
  verifyAdmission(admissionRead.value, evidenceRead.bytes, evidence, snapshotSelection);
  return reportFrom(admissionRead.value);
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) { process.stdout.write(HELP); return 0; }
    const report = execute(options);
    process.stdout.write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return 0;
  } catch (error) {
    const normalized = error instanceof AdmissionError ? error : new AdmissionError("PROOF_RED", error.message || String(error));
    process.stderr.write(`${JSON.stringify({ status: "PROOF_RED", code: normalized.code, message: normalized.message, details: normalized.details || [] }, null, 2)}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { HELP, execute, formatText, main, parseArgs, reportFrom, verifyAdmission };
