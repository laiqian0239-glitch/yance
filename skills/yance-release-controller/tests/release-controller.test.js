"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

const skillRoot = path.resolve(__dirname, "..");
const admissionScript = path.join(skillRoot, "admission.js");
const proofScript = path.join(skillRoot, "proof.js");
const issueUrl = "https://github.com/example/yance/issues/1051";
const commentUrl = `${issueUrl}#issuecomment-123456`;
const commentId = "IC_test_1051";
const controllerVersion = "V5.576";
const controllerBody = `## Controller State ${controllerVersion}\n`;
const genericDigest = "a".repeat(64);
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yance-release-controller-"));
  execFileSync("git", ["init", "-b", "main", root], { windowsHide: true });
  git(root, ["config", "user.name", "Yance Skill Test"]);
  git(root, ["config", "user.email", "skill-test@yance.invalid"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "initial\n");
  git(root, ["add", "tracked.txt"]);
  execFileSync("git", ["-C", root, "-c", "commit.gpgsign=false", "commit", "-m", "initial"], { windowsHide: true });
  return root;
}

function fixtureFor(root) {
  const head = git(root, ["rev-parse", "HEAD"]);
  const now = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    issue: { number: 1051, url: issueUrl },
    export: {
      source: "GITHUB_ISSUE_COMMENTS_READ_ONLY_EXPORT",
      exportedAt: now,
      paginationComplete: true,
      pageCount: 1,
      commentCount: 1,
    },
    comments: [{ id: commentId, url: commentUrl, createdAt: now, updatedAt: now, body: controllerBody }],
  };
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const bodyDigest = sha256(Buffer.from(controllerBody, "utf8"));
  const snapshotDigest = sha256(Buffer.from(snapshotText, "utf8"));
  const evidence = {
    schemaVersion: 2,
    recovery: {
      continuityBreakId: `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      capturedAt: now,
      source: {
        issueNumber: 1051,
        controllerStateVersion: controllerVersion,
        commentId,
        commentUrl,
        bodySha256: bodyDigest,
        evidenceId: "ev.issue",
        snapshotEvidenceId: "ev.snapshot",
      },
    },
    git: {
      repositoryRoot: root,
      currentMainRef: "refs/heads/main",
      currentMain: head,
      exactHead: head,
      branch: "main",
      worktreeDirty: true,
      pr: { state: "NONE", number: null, url: null, head: null, base: null },
    },
    frozenHeads: [{ id: "frozen.runtime", sha: head, reason: "Preserve the admitted runtime", evidenceRefs: ["ev.git"] }],
    consumedRuns: [{ id: "run.local.1", provider: "LOCAL", runId: "local-1", head, conclusion: "GREEN", purpose: "Existing focused proof", evidenceRefs: ["ev.test"] }],
    knownReds: [{ id: "red.avatar", summary: "Avatar projection is not ready", evidenceRefs: ["ev.test"] }],
    knownGreens: [{ id: "green.session", summary: "Existing mature session is ready", evidenceRefs: ["ev.test"] }],
    currentRootCause: { id: "root.avatar", statement: "A shadow avatar projection bypasses the mature owner", evidenceRefs: ["ev.source"] },
    currentCausalBatch: { id: "batch.avatar", statement: "Remove shadow avatar ownership and prove the mature path", paths: ["integration/element-module/**"], evidenceRefs: ["ev.source"] },
    prerequisites: [{ id: "pre.scope", statement: "Exact scope is present", status: "GREEN", evidenceRefs: ["ev.issue"] }],
    allowedPaths: ["integration/element-module/**"],
    forbiddenPaths: ["services/matrix/data/**"],
    riskSurface: [{ id: "risk.element", statement: "Element must retain room/avatar lifecycle", owner: "Element", evidenceRefs: ["ev.source"] }],
    localAcceptance: [{ id: "accept.focused", statement: "Run focused authority proof", status: "PENDING", evidenceRefs: [] }],
    unknownBlockers: 1,
    nextAllowedAction: { id: "next.mutate", kind: "PRODUCTION_MUTATION", statement: "Apply the admitted avatar authority batch", prerequisiteIds: ["pre.scope"] },
    evidence: [
      { id: "ev.issue", kind: "ISSUE_COMMENT", subjectId: commentId, locator: commentUrl, sha256: bodyDigest, capturedAt: now },
      { id: "ev.snapshot", kind: "ISSUE_COMMENTS_SNAPSHOT", subjectId: "issue:1051:comments", locator: issueUrl, sha256: snapshotDigest, capturedAt: now },
      { id: "ev.git", kind: "GIT", subjectId: head, locator: `commit:${head}`, sha256: genericDigest, capturedAt: now },
      { id: "ev.test", kind: "TEST", subjectId: "local-1", locator: "local:test", sha256: genericDigest, capturedAt: now },
      { id: "ev.source", kind: "SOURCE", subjectId: "integration/element-module", locator: "integration/element-module", sha256: genericDigest, capturedAt: now },
    ],
  };
  return { evidence, snapshotText, commentBody: controllerBody };
}

function writeFixture(repo, fixture) {
  const evidencePath = path.join(repo, "controller-state.json");
  const commentBodyPath = path.join(repo, "controller-comment.md");
  const commentsSnapshotPath = path.join(repo, "issue-1051-comments.json");
  const admissionPath = path.join(repo, "admission.json");
  fs.writeFileSync(evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`);
  fs.writeFileSync(commentBodyPath, fixture.commentBody, "utf8");
  fs.writeFileSync(commentsSnapshotPath, fixture.snapshotText, "utf8");
  return { evidencePath, commentBodyPath, commentsSnapshotPath, admissionPath };
}

function admissionArgs(paths) {
  return ["--evidence", paths.evidencePath, "--comment-body", paths.commentBodyPath, "--comments-snapshot", paths.commentsSnapshotPath, "--output", paths.admissionPath];
}

function proofArgs(paths) {
  return ["--evidence", paths.evidencePath, "--comment-body", paths.commentBodyPath, "--comments-snapshot", paths.commentsSnapshotPath, "--admission", paths.admissionPath];
}

function run(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", windowsHide: true });
}

test("both executables expose Windows-safe help", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "evidence-schema.json"), "utf8"));
  assert.equal(schema.properties.currentCausalBatch.$ref, "#/$defs/causalBatch");
  assert.equal(schema.additionalProperties, false);
  for (const script of [admissionScript, proofScript]) {
    const result = run(script, ["--help"], skillRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
});

test("admits one exact recovery and proves every mandatory output field", (t) => {
  const repo = makeRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const paths = writeFixture(repo, fixtureFor(repo));

  const admitted = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(admitted.status, 0, admitted.stderr);
  const parsed = JSON.parse(fs.readFileSync(paths.admissionPath, "utf8"));
  assert.equal(parsed.status, "RECOVERY_ADMITTED");
  assert.equal(parsed.limits.networkMutation, false);
  assert.equal(parsed.limits.gitMutation, false);
  assert.equal(parsed.limits.promotionAuthorized, false);

  const proof = run(proofScript, proofArgs(paths), repo);
  assert.equal(proof.status, 0, proof.stderr);
  for (const label of [
    "CURRENT MAIN", "CURRENT EXACT HEAD", "CURRENT BRANCH", "CURRENT PR", "CURRENT CONTROLLER STATE",
    "FROZEN HEADS", "CONSUMED RUNS", "KNOWN REDS", "KNOWN GREENS", "CURRENT ROOT CAUSE",
    "CURRENT CAUSAL BATCH", "PREREQUISITES", "ALLOWED PATHS", "FORBIDDEN PATHS", "RISK SURFACE",
    "LOCAL ACCEPTANCE", "UNKNOWN BLOCKERS", "NEXT ALLOWED ACTION", "PROMOTION",
  ]) assert.match(proof.stdout, new RegExp(`${label}:`));
  assert.match(proof.stdout, /PROMOTION: NOT AUTHORIZED BY THIS SKILL/);

  const repeated = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(repeated.status, 3);
  assert.match(repeated.stderr, /FRESH_STATE_RECOVERY_ALREADY_CONSUMED/);
});

test("fails closed when live HEAD differs from structured Controller evidence", (t) => {
  const repo = makeRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const fixture = fixtureFor(repo);
  fixture.evidence.git.exactHead = "0".repeat(40);
  const paths = writeFixture(repo, fixture);
  const result = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /GIT_IDENTITY_RED/);
  assert.equal(fs.existsSync(paths.admissionPath), false);
});

test("fails closed on stale Issue state or unresolved causal evidence", (t) => {
  const repo = makeRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const fixture = fixtureFor(repo);
  fixture.evidence.recovery.capturedAt = "2020-01-01T00:00:00.000Z";
  fixture.evidence.currentRootCause.evidenceRefs = ["ev.missing"];
  const paths = writeFixture(repo, fixture);
  const result = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /EVIDENCE_SCHEMA_RED/);
  assert.match(result.stderr, /older than 24 hours/);
  assert.match(result.stderr, /unresolved evidence id/);
});

test("fails closed when the Issue #1051 receipt is tampered or rebound", (t) => {
  const repo = makeRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const fixture = fixtureFor(repo);
  const input = fixture.evidence;
  const receipt = input.evidence.find((item) => item.id === input.recovery.source.evidenceId);
  receipt.subjectId = "IC_different_comment";
  receipt.locator = "https://github.com/example/yance/issues/1051#issuecomment-999999";
  receipt.sha256 = "b".repeat(64);
  const paths = writeFixture(repo, fixture);
  const result = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /subjectId must equal/);
  assert.match(result.stderr, /locator must equal/);
  assert.match(result.stderr, /SHA-256 must equal/);
  assert.equal(fs.existsSync(paths.admissionPath), false);
});

test("fails closed when the bound Issue #1051 receipt is stale", (t) => {
  const repo = makeRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const fixture = fixtureFor(repo);
  const input = fixture.evidence;
  const receipt = input.evidence.find((item) => item.id === input.recovery.source.evidenceId);
  receipt.capturedAt = "2020-01-01T00:00:00.000Z";
  const paths = writeFixture(repo, fixture);
  const result = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ISSUE_COMMENT receipt is older than 24 hours/);
  assert.match(result.stderr, /receipt and recovery capture times differ/);
  assert.equal(fs.existsSync(paths.admissionPath), false);
});

test("proof rejects any post-admission claim of promotion authority", (t) => {
  const repo = makeRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const paths = writeFixture(repo, fixtureFor(repo));
  const admitted = run(admissionScript, admissionArgs(paths), repo);
  assert.equal(admitted.status, 0, admitted.stderr);
  const artifact = JSON.parse(fs.readFileSync(paths.admissionPath, "utf8"));
  artifact.limits.promotionAuthorized = true;
  fs.writeFileSync(paths.admissionPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const proof = run(proofScript, proofArgs(paths), repo);
  assert.equal(proof.status, 2);
  assert.match(proof.stderr, /claim promotion authority/);
});
