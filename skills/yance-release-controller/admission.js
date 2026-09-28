#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const STATUS_GREEN = "RECOVERY_ADMITTED";
const STATUS_RED = "RECOVERY_RED";
const ALREADY_CONSUMED = "FRESH_STATE_RECOVERY_ALREADY_CONSUMED";
const DEFAULT_MAX_AGE_HOURS = 24;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SNAPSHOT_SOURCE = "GITHUB_ISSUE_COMMENTS_READ_ONLY_EXPORT";

const HELP = `Yance one-shot Fresh State Recovery admission

Usage:
  node admission.js --evidence <controller-state.json> --comment-body <comment.md> \\
    --comments-snapshot <issue-comments.json> --output <admission.json> [--max-age-hours <hours>]
  node admission.js --help

The command hashes the original Controller comment body, verifies it is the last
Controller State in a complete read-only Issue #1051 comments snapshot, performs
read-only local Git inspection, and creates one admission artifact exclusively.
"Last" is proven only within the supplied export; remote real-time freshness is not.
It never fetches, checks out, commits, pushes, comments, dispatches, merges, packages,
installs, or grants promotion authority.
`;

class AdmissionError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "AdmissionError";
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const result = { maxAgeHours: DEFAULT_MAX_AGE_HOURS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!["--evidence", "--comment-body", "--comments-snapshot", "--output", "--max-age-hours"].includes(arg)) {
      throw new AdmissionError("ARGUMENT_RED", `Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new AdmissionError("ARGUMENT_RED", `Missing value for ${arg}`);
    index += 1;
    if (arg === "--evidence") result.evidencePath = value;
    if (arg === "--comment-body") result.commentBodyPath = value;
    if (arg === "--comments-snapshot") result.commentsSnapshotPath = value;
    if (arg === "--output") result.outputPath = value;
    if (arg === "--max-age-hours") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > DEFAULT_MAX_AGE_HOURS) {
        throw new AdmissionError("ARGUMENT_RED", "--max-age-hours must be greater than 0 and no more than 24");
      }
      result.maxAgeHours = parsed;
    }
  }
  if (!result.evidencePath) throw new AdmissionError("ARGUMENT_RED", "--evidence is required");
  if (!result.commentBodyPath) throw new AdmissionError("ARGUMENT_RED", "--comment-body is required; bodySha256 cannot be self-attested");
  if (!result.commentsSnapshotPath) throw new AdmissionError("ARGUMENT_RED", "--comments-snapshot is required to prove the selected comment is latest within the export");
  if (!result.outputPath) throw new AdmissionError("ARGUMENT_RED", "--output is required to enforce one-shot recovery");
  return result;
}

function readJsonFile(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw new AdmissionError("INPUT_RED", `${label} cannot be read: ${error.message}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new AdmissionError("INPUT_RED", `${label} is not valid JSON: ${error.message}`);
  }
}

function readFileBytes(filePath, label) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw new AdmissionError("INPUT_RED", `${label} cannot be read: ${error.message}`);
  }
}

function decodeExactUtf8(bytes, label) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new AdmissionError("INPUT_RED", `${label} must be UTF-8 without a byte-order mark`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AdmissionError("INPUT_RED", `${label} is not valid UTF-8: ${error.message}`);
  }
}

function controllerStateVersions(body) {
  if (typeof body !== "string") return [];
  const patterns = [
    /^(?:\s*#{1,6}\s*)?(?:\s*\*{0,2}\s*)?(?:CURRENT\s+)?CONTROLLER\s+STATE(?:\s*\*{0,2})?\s*(?:(?:VERSION|版本)\s*)?[:#=—–-]?\s*\*{0,2}\s*(V\d+(?:\.\d+)+)\b/gim,
    /^\s*CURRENT_CONTROLLER_STATE\s*[:=]\s*(V\d+(?:\.\d+)+)\b/gim,
  ];
  const versions = [];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) if (!versions.includes(match[1])) versions.push(match[1]);
  }
  return versions;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEvidence(input, options = {}) {
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const add = (condition, message) => { if (!condition) errors.push(message); };
  const exactKeys = (value, expected, label) => {
    if (!isPlainObject(value)) { errors.push(`${label} must be an object`); return; }
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    add(JSON.stringify(actual) === JSON.stringify(wanted), `${label} must contain exactly: ${wanted.join(", ")}`);
  };
  const validId = (value, label) => add(typeof value === "string" && ID_RE.test(value), `${label} must be a stable identifier`);
  const nonEmpty = (value, label) => add(typeof value === "string" && value.trim().length > 0, `${label} must be non-empty`);
  const validSha = (value, label) => add(typeof value === "string" && SHA_RE.test(value), `${label} must be a lowercase full Git object ID`);
  const validSha256 = (value, label) => add(typeof value === "string" && SHA256_RE.test(value), `${label} must be a lowercase SHA-256`);
  const validDate = (value, label) => {
    const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
    add(Number.isFinite(time), `${label} must be an ISO date-time`);
    return time;
  };
  const validRepoPath = (value, label) => {
    const good = typeof value === "string" && value.length > 0 && !path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)
      && !value.split(/[\\/]/).includes("..") && !value.includes("\0");
    add(good, `${label} must be a repository-relative path or pattern without '..'`);
  };
  const validateRefs = (refs, label, allowEmpty = false) => {
    add(Array.isArray(refs), `${label} must be an array`);
    if (!Array.isArray(refs)) return;
    add(allowEmpty || refs.length > 0, `${label} must not be empty`);
    refs.forEach((ref, index) => validId(ref, `${label}[${index}]`));
  };

  exactKeys(input, ["schemaVersion", "recovery", "git", "frozenHeads", "consumedRuns", "knownReds", "knownGreens", "currentRootCause", "currentCausalBatch", "prerequisites", "allowedPaths", "forbiddenPaths", "riskSurface", "localAcceptance", "unknownBlockers", "nextAllowedAction", "evidence"], "root");
  if (!isPlainObject(input)) throw new AdmissionError("EVIDENCE_SCHEMA_RED", "Evidence must be a JSON object", errors);
  add(input.schemaVersion === 2, "schemaVersion must equal 2");

  exactKeys(input.recovery, ["continuityBreakId", "capturedAt", "source"], "recovery");
  if (isPlainObject(input.recovery)) {
    validId(input.recovery.continuityBreakId, "recovery.continuityBreakId");
    const captured = validDate(input.recovery.capturedAt, "recovery.capturedAt");
    if (Number.isFinite(captured)) {
      const ageMs = now.getTime() - captured;
      add(ageMs >= -5 * 60 * 1000, "recovery.capturedAt is more than five minutes in the future");
      add(ageMs <= maxAgeHours * 60 * 60 * 1000, `Controller State capture is older than ${maxAgeHours} hours`);
    }
    exactKeys(input.recovery.source, ["issueNumber", "controllerStateVersion", "commentId", "commentUrl", "bodySha256", "evidenceId", "snapshotEvidenceId"], "recovery.source");
    if (isPlainObject(input.recovery.source)) {
      add(input.recovery.source.issueNumber === 1051, "Controller source must be GitHub Issue #1051");
      add(typeof input.recovery.source.controllerStateVersion === "string" && /^V\d+(?:\.\d+)+$/.test(input.recovery.source.controllerStateVersion), "controllerStateVersion must look like V5.576");
      nonEmpty(input.recovery.source.commentId, "recovery.source.commentId");
      add(typeof input.recovery.source.commentUrl === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/1051#issuecomment-\d+$/.test(input.recovery.source.commentUrl), "commentUrl must identify an immutable comment on GitHub Issue #1051");
      validSha256(input.recovery.source.bodySha256, "recovery.source.bodySha256");
      validId(input.recovery.source.evidenceId, "recovery.source.evidenceId");
      validId(input.recovery.source.snapshotEvidenceId, "recovery.source.snapshotEvidenceId");
    }
  }

  exactKeys(input.git, ["repositoryRoot", "currentMainRef", "currentMain", "exactHead", "branch", "worktreeDirty", "pr"], "git");
  if (isPlainObject(input.git)) {
    nonEmpty(input.git.repositoryRoot, "git.repositoryRoot");
    add(typeof input.git.currentMainRef === "string" && /^refs\/(?:heads|remotes)\/[A-Za-z0-9._\/-]+$/.test(input.git.currentMainRef) && !input.git.currentMainRef.includes(".."), "git.currentMainRef must be a full local heads/remotes ref");
    validSha(input.git.currentMain, "git.currentMain");
    validSha(input.git.exactHead, "git.exactHead");
    add(typeof input.git.branch === "string" && (input.git.branch === "DETACHED" || /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(input.git.branch)), "git.branch must be a valid branch name or DETACHED");
    add(typeof input.git.worktreeDirty === "boolean", "git.worktreeDirty must be boolean");
    exactKeys(input.git.pr, ["state", "number", "url", "head", "base"], "git.pr");
    if (isPlainObject(input.git.pr)) {
      add(["NONE", "OPEN", "CLOSED", "MERGED"].includes(input.git.pr.state), "git.pr.state is invalid");
      if (input.git.pr.state === "NONE") {
        add(input.git.pr.number === null && input.git.pr.url === null && input.git.pr.head === null && input.git.pr.base === null, "A NONE PR must use null number/url/head/base");
      } else {
        add(Number.isInteger(input.git.pr.number) && input.git.pr.number > 0, "git.pr.number must be positive");
        add(typeof input.git.pr.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(input.git.pr.url), "git.pr.url must be a GitHub pull URL");
        validSha(input.git.pr.head, "git.pr.head");
        validSha(input.git.pr.base, "git.pr.base");
        if (input.git.pr.state === "OPEN") add(input.git.pr.head === input.git.exactHead, "An OPEN PR head must equal git.exactHead");
      }
    }
  }

  const evidenceIds = new Set();
  const evidenceById = new Map();
  add(Array.isArray(input.evidence) && input.evidence.length > 0, "evidence must be a non-empty array");
  if (Array.isArray(input.evidence)) input.evidence.forEach((item, index) => {
    const label = `evidence[${index}]`;
    exactKeys(item, ["id", "kind", "subjectId", "locator", "sha256", "capturedAt"], label);
    if (!isPlainObject(item)) return;
    validId(item.id, `${label}.id`);
    add(!evidenceIds.has(item.id), `${label}.id must be unique`);
    evidenceIds.add(item.id);
    evidenceById.set(item.id, item);
    add(["ISSUE_COMMENT", "ISSUE_COMMENTS_SNAPSHOT", "GIT", "RUN", "LOG", "TEST", "SCREENSHOT", "SOURCE", "OTHER"].includes(item.kind), `${label}.kind is invalid`);
    nonEmpty(item.subjectId, `${label}.subjectId`);
    nonEmpty(item.locator, `${label}.locator`);
    validSha256(item.sha256, `${label}.sha256`);
    validDate(item.capturedAt, `${label}.capturedAt`);
  });
  if (isPlainObject(input.recovery) && isPlainObject(input.recovery.source)) {
    const receipt = evidenceById.get(input.recovery.source.evidenceId);
    add(Boolean(receipt), "recovery.source.evidenceId must resolve to one unique evidence receipt");
    if (receipt) {
      add(receipt.kind === "ISSUE_COMMENT", "Controller source receipt must have kind ISSUE_COMMENT");
      add(receipt.subjectId === input.recovery.source.commentId, "Controller source receipt subjectId must equal recovery.source.commentId");
      add(receipt.locator === input.recovery.source.commentUrl, "Controller source receipt locator must equal recovery.source.commentUrl");
      add(receipt.sha256 === input.recovery.source.bodySha256, "Controller source receipt SHA-256 must equal recovery.source.bodySha256");
      const receiptTime = Date.parse(receipt.capturedAt);
      const recoveryTime = Date.parse(input.recovery.capturedAt);
      if (Number.isFinite(receiptTime)) {
        const receiptAgeMs = now.getTime() - receiptTime;
        add(receiptAgeMs >= -5 * 60 * 1000, "Controller ISSUE_COMMENT receipt is more than five minutes in the future");
        add(receiptAgeMs <= maxAgeHours * 60 * 60 * 1000, `Controller ISSUE_COMMENT receipt is older than ${maxAgeHours} hours`);
      }
      if (Number.isFinite(receiptTime) && Number.isFinite(recoveryTime)) {
        add(Math.abs(receiptTime - recoveryTime) <= 5 * 60 * 1000, "Controller ISSUE_COMMENT receipt and recovery capture times differ by more than five minutes");
      }
    }
    const snapshotReceipt = evidenceById.get(input.recovery.source.snapshotEvidenceId);
    add(Boolean(snapshotReceipt), "recovery.source.snapshotEvidenceId must resolve to one unique evidence receipt");
    if (snapshotReceipt) {
      const issueUrl = typeof input.recovery.source.commentUrl === "string" ? input.recovery.source.commentUrl.split("#")[0] : "";
      add(snapshotReceipt.kind === "ISSUE_COMMENTS_SNAPSHOT", "Controller snapshot receipt must have kind ISSUE_COMMENTS_SNAPSHOT");
      add(snapshotReceipt.subjectId === "issue:1051:comments", "Controller snapshot receipt subjectId must equal issue:1051:comments");
      add(snapshotReceipt.locator === issueUrl, "Controller snapshot receipt locator must equal the Issue #1051 URL");
      const snapshotReceiptTime = Date.parse(snapshotReceipt.capturedAt);
      const recoveryTime = Date.parse(input.recovery.capturedAt);
      if (Number.isFinite(snapshotReceiptTime)) {
        const receiptAgeMs = now.getTime() - snapshotReceiptTime;
        add(receiptAgeMs >= -5 * 60 * 1000, "Controller comments snapshot receipt is more than five minutes in the future");
        add(receiptAgeMs <= maxAgeHours * 60 * 60 * 1000, `Controller comments snapshot receipt is older than ${maxAgeHours} hours`);
      }
      if (Number.isFinite(snapshotReceiptTime) && Number.isFinite(recoveryTime)) {
        add(Math.abs(snapshotReceiptTime - recoveryTime) <= 5 * 60 * 1000, "Controller comments snapshot receipt and recovery capture times differ by more than five minutes");
      }
    }
  }
  const resolveRefs = (refs, label, allowEmpty = false) => {
    validateRefs(refs, label, allowEmpty);
    if (Array.isArray(refs)) refs.forEach((ref) => add(evidenceIds.has(ref), `${label} contains unresolved evidence id: ${ref}`));
  };
  const uniqueIds = new Set();
  const claimId = (id, label) => {
    validId(id, label);
    add(!uniqueIds.has(id), `${label} must be unique across claims/checks/runs/heads`);
    uniqueIds.add(id);
  };

  add(Array.isArray(input.frozenHeads), "frozenHeads must be an array");
  if (Array.isArray(input.frozenHeads)) input.frozenHeads.forEach((item, index) => {
    const label = `frozenHeads[${index}]`;
    exactKeys(item, ["id", "sha", "reason", "evidenceRefs"], label);
    if (!isPlainObject(item)) return;
    claimId(item.id, `${label}.id`); validSha(item.sha, `${label}.sha`); nonEmpty(item.reason, `${label}.reason`); resolveRefs(item.evidenceRefs, `${label}.evidenceRefs`);
  });
  add(Array.isArray(input.consumedRuns), "consumedRuns must be an array");
  if (Array.isArray(input.consumedRuns)) input.consumedRuns.forEach((item, index) => {
    const label = `consumedRuns[${index}]`;
    exactKeys(item, ["id", "provider", "runId", "head", "conclusion", "purpose", "evidenceRefs"], label);
    if (!isPlainObject(item)) return;
    claimId(item.id, `${label}.id`); add(["GITHUB_ACTIONS", "LOCAL", "WINDOWS_UAT", "FINAL_BUILDER", "OTHER"].includes(item.provider), `${label}.provider is invalid`);
    nonEmpty(item.runId, `${label}.runId`); validSha(item.head, `${label}.head`); add(["GREEN", "RED", "CANCELLED", "SKIPPED", "IN_PROGRESS"].includes(item.conclusion), `${label}.conclusion is invalid`);
    nonEmpty(item.purpose, `${label}.purpose`); resolveRefs(item.evidenceRefs, `${label}.evidenceRefs`);
  });
  for (const key of ["knownReds", "knownGreens"]) {
    add(Array.isArray(input[key]), `${key} must be an array`);
    if (Array.isArray(input[key])) input[key].forEach((item, index) => {
      const label = `${key}[${index}]`;
      exactKeys(item, ["id", "summary", "evidenceRefs"], label);
      if (!isPlainObject(item)) return;
      claimId(item.id, `${label}.id`); nonEmpty(item.summary, `${label}.summary`); resolveRefs(item.evidenceRefs, `${label}.evidenceRefs`);
    });
  }
  const validateCausalClaim = (item, label, withPaths = false) => {
    exactKeys(item, withPaths ? ["id", "statement", "evidenceRefs", "paths"] : ["id", "statement", "evidenceRefs"], label);
    if (!isPlainObject(item)) return;
    claimId(item.id, `${label}.id`); nonEmpty(item.statement, `${label}.statement`); resolveRefs(item.evidenceRefs, `${label}.evidenceRefs`);
    if (withPaths) {
      add(Array.isArray(item.paths) && item.paths.length > 0, `${label}.paths must be non-empty`);
      if (Array.isArray(item.paths)) item.paths.forEach((itemPath, index) => validRepoPath(itemPath, `${label}.paths[${index}]`));
    }
  };
  validateCausalClaim(input.currentRootCause, "currentRootCause");
  validateCausalClaim(input.currentCausalBatch, "currentCausalBatch", true);
  const checkIds = new Set();
  const validateChecks = (items, label) => {
    add(Array.isArray(items) && items.length > 0, `${label} must be a non-empty array`);
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      const itemLabel = `${label}[${index}]`;
      exactKeys(item, ["id", "statement", "status", "evidenceRefs"], itemLabel);
      if (!isPlainObject(item)) return;
      claimId(item.id, `${itemLabel}.id`); checkIds.add(item.id); nonEmpty(item.statement, `${itemLabel}.statement`);
      add(["GREEN", "RED", "PENDING", "BLOCKED"].includes(item.status), `${itemLabel}.status is invalid`);
      resolveRefs(item.evidenceRefs, `${itemLabel}.evidenceRefs`, item.status === "PENDING" || item.status === "BLOCKED");
    });
  };
  validateChecks(input.prerequisites, "prerequisites");
  validateChecks(input.localAcceptance, "localAcceptance");
  for (const key of ["allowedPaths", "forbiddenPaths"]) {
    add(Array.isArray(input[key]) && input[key].length > 0, `${key} must be a non-empty array`);
    if (Array.isArray(input[key])) input[key].forEach((value, index) => validRepoPath(value, `${key}[${index}]`));
  }
  add(Array.isArray(input.riskSurface) && input.riskSurface.length > 0, "riskSurface must be a non-empty array");
  if (Array.isArray(input.riskSurface)) input.riskSurface.forEach((item, index) => {
    const label = `riskSurface[${index}]`;
    exactKeys(item, ["id", "statement", "owner", "evidenceRefs"], label);
    if (!isPlainObject(item)) return;
    claimId(item.id, `${label}.id`); nonEmpty(item.statement, `${label}.statement`); nonEmpty(item.owner, `${label}.owner`); resolveRefs(item.evidenceRefs, `${label}.evidenceRefs`);
  });
  add(Number.isInteger(input.unknownBlockers) && input.unknownBlockers >= 0, "unknownBlockers must be a non-negative integer");
  exactKeys(input.nextAllowedAction, ["id", "kind", "statement", "prerequisiteIds"], "nextAllowedAction");
  if (isPlainObject(input.nextAllowedAction)) {
    claimId(input.nextAllowedAction.id, "nextAllowedAction.id");
    add(["EVIDENCE_READ", "PRODUCTION_MUTATION", "LOCAL_CLOSURE", "EXTERNAL_BOUNDARY", "NONE"].includes(input.nextAllowedAction.kind), "nextAllowedAction.kind is invalid");
    nonEmpty(input.nextAllowedAction.statement, "nextAllowedAction.statement");
    add(Array.isArray(input.nextAllowedAction.prerequisiteIds), "nextAllowedAction.prerequisiteIds must be an array");
    if (Array.isArray(input.nextAllowedAction.prerequisiteIds)) input.nextAllowedAction.prerequisiteIds.forEach((id, index) => {
      validId(id, `nextAllowedAction.prerequisiteIds[${index}]`);
      add(checkIds.has(id), `nextAllowedAction prerequisite is unresolved: ${id}`);
    });
  }

  if (errors.length) throw new AdmissionError("EVIDENCE_SCHEMA_RED", "Structured Controller evidence failed validation", errors);
  return input;
}

function validateCommentsSnapshot(snapshot, snapshotBytes, commentBodyBytes, input, options = {}) {
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const add = (condition, message) => { if (!condition) errors.push(message); };
  const exactKeys = (value, expected, label) => {
    if (!isPlainObject(value)) { errors.push(`${label} must be an object`); return; }
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    add(JSON.stringify(actual) === JSON.stringify(wanted), `${label} must contain exactly: ${wanted.join(", ")}`);
  };
  const date = (value, label) => {
    const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
    add(Number.isFinite(time), `${label} must be an ISO date-time`);
    return time;
  };

  exactKeys(snapshot, ["schemaVersion", "issue", "export", "comments"], "commentsSnapshot");
  if (!isPlainObject(snapshot)) throw new AdmissionError("COMMENTS_SNAPSHOT_RED", "Issue comments snapshot must be a JSON object", errors);
  add(snapshot.schemaVersion === 1, "commentsSnapshot.schemaVersion must equal 1");
  exactKeys(snapshot.issue, ["number", "url"], "commentsSnapshot.issue");
  const expectedIssueUrl = input.recovery.source.commentUrl.split("#")[0];
  if (isPlainObject(snapshot.issue)) {
    add(snapshot.issue.number === 1051, "commentsSnapshot.issue.number must equal 1051");
    add(snapshot.issue.url === expectedIssueUrl, "commentsSnapshot.issue.url must equal the selected Controller comment Issue URL");
    add(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/1051$/.test(snapshot.issue.url || ""), "commentsSnapshot.issue.url must be a GitHub Issue #1051 URL");
  }
  exactKeys(snapshot.export, ["source", "exportedAt", "paginationComplete", "pageCount", "commentCount"], "commentsSnapshot.export");
  let exportedAt = Number.NaN;
  if (isPlainObject(snapshot.export)) {
    add(snapshot.export.source === SNAPSHOT_SOURCE, `commentsSnapshot.export.source must equal ${SNAPSHOT_SOURCE}`);
    exportedAt = date(snapshot.export.exportedAt, "commentsSnapshot.export.exportedAt");
    add(snapshot.export.paginationComplete === true, "commentsSnapshot export must assert complete pagination");
    add(Number.isInteger(snapshot.export.pageCount) && snapshot.export.pageCount > 0, "commentsSnapshot.export.pageCount must be a positive integer");
    add(Number.isInteger(snapshot.export.commentCount) && snapshot.export.commentCount > 0, "commentsSnapshot.export.commentCount must be a positive integer");
    if (Number.isFinite(exportedAt)) {
      const ageMs = now.getTime() - exportedAt;
      add(ageMs >= -5 * 60 * 1000, "commentsSnapshot.exportedAt is more than five minutes in the future");
      add(ageMs <= maxAgeHours * 60 * 60 * 1000, `Issue comments snapshot is older than ${maxAgeHours} hours`);
      const recoveryTime = Date.parse(input.recovery.capturedAt);
      if (Number.isFinite(recoveryTime)) add(Math.abs(exportedAt - recoveryTime) <= 5 * 60 * 1000, "Issue comments snapshot and recovery capture times differ by more than five minutes");
    }
  }

  add(Array.isArray(snapshot.comments) && snapshot.comments.length > 0, "commentsSnapshot.comments must be a non-empty array");
  if (Array.isArray(snapshot.comments) && isPlainObject(snapshot.export)) {
    add(snapshot.export.commentCount === snapshot.comments.length, "commentsSnapshot.export.commentCount must equal comments.length");
  }
  const seenIds = new Set();
  const seenUrls = new Set();
  const controllers = [];
  let previousCreated = Number.NEGATIVE_INFINITY;
  let previousCommentNumber = Number.NEGATIVE_INFINITY;
  if (Array.isArray(snapshot.comments)) snapshot.comments.forEach((comment, index) => {
    const label = `commentsSnapshot.comments[${index}]`;
    exactKeys(comment, ["id", "url", "createdAt", "updatedAt", "body"], label);
    if (!isPlainObject(comment)) return;
    add(typeof comment.id === "string" && comment.id.length > 0, `${label}.id must be non-empty`);
    add(!seenIds.has(comment.id), `${label}.id must be unique`);
    seenIds.add(comment.id);
    const urlMatch = typeof comment.url === "string" ? comment.url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/1051#issuecomment-(\d+)$/) : null;
    add(Boolean(urlMatch), `${label}.url must identify a GitHub Issue #1051 comment`);
    add(typeof comment.url === "string" && comment.url.split("#")[0] === expectedIssueUrl, `${label}.url must belong to the exported Issue #1051`);
    add(!seenUrls.has(comment.url), `${label}.url must be unique`);
    seenUrls.add(comment.url);
    const createdAt = date(comment.createdAt, `${label}.createdAt`);
    const updatedAt = date(comment.updatedAt, `${label}.updatedAt`);
    if (Number.isFinite(createdAt) && Number.isFinite(updatedAt)) add(updatedAt >= createdAt, `${label}.updatedAt cannot precede createdAt`);
    if (Number.isFinite(updatedAt) && Number.isFinite(exportedAt)) add(updatedAt <= exportedAt + 5 * 60 * 1000, `${label}.updatedAt cannot be later than the export time`);
    const commentNumber = urlMatch ? Number(urlMatch[1]) : Number.NaN;
    if (Number.isFinite(createdAt)) {
      add(createdAt >= previousCreated, "commentsSnapshot.comments must be ordered oldest to newest by createdAt");
      if (createdAt === previousCreated && Number.isFinite(commentNumber)) add(commentNumber > previousCommentNumber, "comments with equal createdAt must be ordered by increasing issuecomment number");
      previousCreated = createdAt;
      previousCommentNumber = commentNumber;
    }
    add(typeof comment.body === "string", `${label}.body must be a string`);
    const versions = controllerStateVersions(comment.body);
    add(versions.length <= 1, `${label}.body declares multiple different Controller State versions`);
    if (versions.length === 1) controllers.push({ comment, version: versions[0], index });
  });
  add(controllers.length > 0, "commentsSnapshot contains no parseable Controller State comment");
  const selected = controllers.at(-1);
  if (selected) {
    add(selected.comment.id === input.recovery.source.commentId, "Selected source comment is not the last Controller State comment in the supplied snapshot");
    add(selected.comment.url === input.recovery.source.commentUrl, "Selected source URL is not the last Controller State comment URL in the supplied snapshot");
    add(selected.version === input.recovery.source.controllerStateVersion, "Selected source version is not the last Controller State version in the supplied snapshot");
  }

  const commentBody = decodeExactUtf8(commentBodyBytes, "Controller comment body file");
  add(commentBody.length > 0, "Controller comment body file must not be empty");
  const bodyDigest = sha256(commentBodyBytes);
  add(bodyDigest === input.recovery.source.bodySha256, "Original Controller comment body SHA-256 differs from recovery.source.bodySha256");
  if (selected) add(commentBody === selected.comment.body, "Original Controller comment body bytes do not equal the selected snapshot comment body");

  const issueReceipt = input.evidence.find((item) => item.id === input.recovery.source.evidenceId);
  if (issueReceipt) {
    add(issueReceipt.sha256 === bodyDigest, "ISSUE_COMMENT receipt SHA-256 differs from the original Controller comment body file");
    if (isPlainObject(snapshot.export)) add(issueReceipt.capturedAt === snapshot.export.exportedAt, "ISSUE_COMMENT receipt capturedAt must equal snapshot exportedAt");
  }
  const snapshotDigest = sha256(snapshotBytes);
  const snapshotReceipt = input.evidence.find((item) => item.id === input.recovery.source.snapshotEvidenceId);
  if (snapshotReceipt) {
    add(snapshotReceipt.sha256 === snapshotDigest, "ISSUE_COMMENTS_SNAPSHOT receipt SHA-256 differs from the supplied snapshot file");
    if (isPlainObject(snapshot.export)) add(snapshotReceipt.capturedAt === snapshot.export.exportedAt, "ISSUE_COMMENTS_SNAPSHOT receipt capturedAt must equal snapshot exportedAt");
  }

  if (errors.length) throw new AdmissionError("COMMENTS_SNAPSHOT_RED", "Controller comment body/snapshot admission failed", errors);
  return {
    commentBodySha256: bodyDigest,
    commentsSnapshotSha256: snapshotDigest,
    snapshotExportedAt: snapshot.export.exportedAt,
    snapshotCommentCount: snapshot.comments.length,
    selectedCommentId: selected.comment.id,
    selectedCommentUrl: selected.comment.url,
    selectedControllerStateVersion: selected.version,
    latestWithinSuppliedSnapshot: true,
    remoteRealtimeVerified: false,
  };
}

function loadAndValidateInputs(options) {
  const evidencePath = path.resolve(options.evidencePath);
  const commentBodyPath = path.resolve(options.commentBodyPath);
  const commentsSnapshotPath = path.resolve(options.commentsSnapshotPath);
  const paths = [evidencePath, commentBodyPath, commentsSnapshotPath];
  if (new Set(paths.map((value) => value.toLowerCase())).size !== paths.length) {
    throw new AdmissionError("INPUT_RED", "Evidence, comment body, and comments snapshot paths must be distinct");
  }
  const evidenceRead = readJsonFile(evidencePath, "Evidence file");
  const input = validateEvidence(evidenceRead.value, { maxAgeHours: options.maxAgeHours });
  const commentBodyBytes = readFileBytes(commentBodyPath, "Controller comment body file");
  const snapshotRead = readJsonFile(commentsSnapshotPath, "Issue comments snapshot");
  const snapshotSelection = validateCommentsSnapshot(snapshotRead.value, snapshotRead.bytes, commentBodyBytes, input, { maxAgeHours: options.maxAgeHours });
  return { evidenceRead, input, commentBodyBytes, snapshotRead, snapshotSelection };
}

function git(root, args, options = {}) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw new AdmissionError("GIT_IDENTITY_RED", `Git inspection failed: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    throw new AdmissionError("GIT_IDENTITY_RED", `git ${args.join(" ")} failed`, [(result.stderr || result.stdout || "").trim()]);
  }
  return { status: result.status, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function inspectLiveGit(expected) {
  const root = path.resolve(expected.repositoryRoot);
  const top = git(root, ["rev-parse", "--show-toplevel"]).stdout;
  if (!samePath(top, root)) throw new AdmissionError("GIT_IDENTITY_RED", "git.repositoryRoot is not the worktree root", [`expected=${root}`, `actual=${top}`]);
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.toLowerCase();
  const branchResult = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  if (![0, 1].includes(branchResult.status)) throw new AdmissionError("GIT_IDENTITY_RED", "Unable to determine current branch", [branchResult.stderr]);
  const branch = branchResult.status === 0 ? branchResult.stdout : "DETACHED";
  const currentMain = git(root, ["rev-parse", "--verify", `${expected.currentMainRef}^{commit}`]).stdout.toLowerCase();
  const porcelain = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  const worktreeDirty = porcelain.length > 0;
  const mismatches = [];
  if (head !== expected.exactHead) mismatches.push(`exactHead expected=${expected.exactHead} actual=${head}`);
  if (branch !== expected.branch) mismatches.push(`branch expected=${expected.branch} actual=${branch}`);
  if (currentMain !== expected.currentMain) mismatches.push(`currentMain expected=${expected.currentMain} actual=${currentMain}`);
  if (worktreeDirty !== expected.worktreeDirty) mismatches.push(`worktreeDirty expected=${expected.worktreeDirty} actual=${worktreeDirty}`);
  if (expected.pr.state !== "NONE") {
    for (const key of ["head", "base"]) {
      const resolved = git(root, ["rev-parse", "--verify", `${expected.pr[key]}^{commit}`]).stdout.toLowerCase();
      if (resolved !== expected.pr[key]) mismatches.push(`pr.${key} is not the declared full commit`);
    }
  }
  if (mismatches.length) throw new AdmissionError("GIT_IDENTITY_RED", "Live Git identity differs from Controller evidence", mismatches);
  return { repositoryRoot: top, currentMainRef: expected.currentMainRef, currentMain, exactHead: head, branch, worktreeDirty };
}

function buildAdmission(input, evidenceBytes, liveGit, snapshotSelection, generatedAt = new Date()) {
  const evidenceSha256 = sha256(evidenceBytes);
  const recoveryKey = sha256(`${input.recovery.continuityBreakId}\n${evidenceSha256}\n${snapshotSelection.commentBodySha256}\n${snapshotSelection.commentsSnapshotSha256}\n${liveGit.exactHead}`);
  const record = {
    schemaVersion: 2,
    status: STATUS_GREEN,
    generatedAt: generatedAt.toISOString(),
    recovery: {
      continuityBreakId: input.recovery.continuityBreakId,
      recoveryKey,
      executedOnce: true,
      evidenceSha256,
      commentBodySha256: snapshotSelection.commentBodySha256,
      commentsSnapshotSha256: snapshotSelection.commentsSnapshotSha256,
      controllerCapturedAt: input.recovery.capturedAt,
      snapshotExportedAt: snapshotSelection.snapshotExportedAt,
      snapshotCommentCount: snapshotSelection.snapshotCommentCount,
      selectedCommentId: snapshotSelection.selectedCommentId,
      selectedCommentUrl: snapshotSelection.selectedCommentUrl,
      selectedControllerStateVersion: snapshotSelection.selectedControllerStateVersion,
    },
    limits: {
      networkMutation: false,
      gitMutation: false,
      promotionAuthorized: false,
      remoteRealtimeVerified: false,
      latestControllerScope: "LAST_CONTROLLER_STATE_WITHIN_SUPPLIED_COMPLETE_SNAPSHOT",
      authority: "EVIDENCE_PROJECTION_ONLY",
    },
    liveGit,
    current: {
      main: input.git.currentMain,
      exactHead: input.git.exactHead,
      branch: input.git.branch,
      pr: input.git.pr,
      controllerState: input.recovery.source,
      frozenHeads: input.frozenHeads,
      consumedRuns: input.consumedRuns,
      knownReds: input.knownReds,
      knownGreens: input.knownGreens,
      rootCause: input.currentRootCause,
      causalBatch: input.currentCausalBatch,
      prerequisites: input.prerequisites,
      allowedPaths: input.allowedPaths,
      forbiddenPaths: input.forbiddenPaths,
      riskSurface: input.riskSurface,
      localAcceptance: input.localAcceptance,
      unknownBlockers: input.unknownBlockers,
      nextAllowedAction: input.nextAllowedAction,
    },
  };
  record.payloadSha256 = sha256(stableStringify(record));
  return record;
}

function writeExclusive(outputPath, admission) {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved)) {
    let existing;
    try { existing = JSON.parse(fs.readFileSync(resolved, "utf8")); } catch { existing = null; }
    if (existing?.recovery?.recoveryKey === admission.recovery.recoveryKey) {
      throw new AdmissionError(ALREADY_CONSUMED, "This continuity break and evidence input already produced a Fresh State Recovery admission", [resolved]);
    }
    throw new AdmissionError("OUTPUT_OCCUPIED_RED", "Admission output already exists and will not be overwritten", [resolved]);
  }
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)) throw new AdmissionError("OUTPUT_PATH_RED", "Admission output parent directory does not exist", [parent]);
  fs.writeFileSync(resolved, `${JSON.stringify(admission, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return resolved;
}

function execute(options) {
  const evidencePath = path.resolve(options.evidencePath);
  const outputPath = path.resolve(options.outputPath);
  if (samePath(evidencePath, outputPath)) throw new AdmissionError("OUTPUT_PATH_RED", "Evidence and admission paths must differ");
  if (samePath(options.commentBodyPath, outputPath) || samePath(options.commentsSnapshotPath, outputPath)) {
    throw new AdmissionError("OUTPUT_PATH_RED", "Admission output must differ from all input files");
  }
  const { evidenceRead, input, snapshotSelection } = loadAndValidateInputs(options);
  const liveGit = inspectLiveGit(input.git);
  const admission = buildAdmission(input, evidenceRead.bytes, liveGit, snapshotSelection);
  const writtenPath = writeExclusive(outputPath, admission);
  return { ...admission, admissionPath: writtenPath };
}

function emitError(error) {
  const normalized = error instanceof AdmissionError ? error : new AdmissionError("INTERNAL_RED", error.message || String(error));
  process.stderr.write(`${JSON.stringify({ status: STATUS_RED, code: normalized.code, message: normalized.message, details: normalized.details }, null, 2)}\n`);
  return normalized.code === ALREADY_CONSUMED ? 3 : 2;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) { process.stdout.write(HELP); return 0; }
    const result = execute(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    return emitError(error);
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  ALREADY_CONSUMED,
  AdmissionError,
  DEFAULT_MAX_AGE_HOURS,
  HELP,
  STATUS_GREEN,
  STATUS_RED,
  buildAdmission,
  execute,
  inspectLiveGit,
  main,
  parseArgs,
  controllerStateVersions,
  decodeExactUtf8,
  loadAndValidateInputs,
  readJsonFile,
  readFileBytes,
  sha256,
  stableStringify,
  validateCommentsSnapshot,
  validateEvidence,
};
