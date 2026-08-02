# Yance Independent Review Gate No-API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed GitHub merge gate that combines deterministic checks with a ChatGPT GitHub-connected structured review, without calling OpenAI API.

**Architecture:** Trusted validator and workflow logic live on the protected base branch. Candidate code runs in an isolated checkout without credentials. A strict review contract binds the ChatGPT review to the exact PR HEAD; a single aggregator emits the Chinese merge decision and never equates source merge with production promotion.

**Tech Stack:** Node.js 22, built-in `node:test`, GitHub Actions, GitHub REST API through `GITHUB_TOKEN`, JSON governance contracts.

## Global Constraints

- OpenAI API must not be called or configured.
- CodeRabbit is optional and non-blocking.
- Any unknown, skipped, missing, timed-out, cancelled, or malformed result fails closed.
- Temporary bypasses, test weakening, wildcard authorization, and parallel authority entrypoints are prohibited.
- `sourceMergeAllowed`, `readyForPromotion`, and `formalRelease` remain separate states.
- Candidate PR code must not control the trusted validator or obtain a write-capable token.

---

### Task 1: Strict ChatGPT Review Contract

**Files:**
- Create: `governance/independent-review/chatgpt-review-contract-v1.json`
- Create: `tests/independent-review/chatgpt-review-contract.test.js`
- Create: `tools/independent-review/review-contract.js`

**Interfaces:**
- Produces: `extractReviewPayload(body)`, `validateReviewPayload(payload, context)`, `evaluateReview(payload, context)`.

- [ ] Write tests that reject missing marker, malformed JSON, unknown fields, non-40-character SHA, mismatched `reviewedHead`, mismatched GitHub `commit_id`, P0/P1, bypass, missing evidence, blockers, and non-ALLOW decisions.
- [ ] Run `node --test --test-concurrency=1 tests/independent-review/chatgpt-review-contract.test.js` and verify RED because implementation is absent.
- [ ] Implement descriptor-safe, strict, length-bounded parsing and validation with no external dependencies.
- [ ] Re-run the test and verify GREEN.

### Task 2: Deterministic Gate Manifest and Runner

**Files:**
- Create: `governance/independent-review/deterministic-gates-v1.json`
- Create: `tests/independent-review/deterministic-runner.test.js`
- Create: `tools/independent-review/run-deterministic-gates.js`

**Interfaces:**
- Produces: `runGateManifest({ workspace, reviewedHead, outputPath, spawn })` and a JSON result with one record per required gate.

- [ ] Test that every manifest entry is required, duplicate IDs fail, skipped/unknown outcomes fail, output binds the reviewed HEAD, and child processes receive a sanitized environment without GitHub write channels.
- [ ] Verify RED.
- [ ] Implement sequential execution, timeout handling, bounded logs, SHA binding, and fail-closed status aggregation.
- [ ] Verify GREEN.

### Task 3: Review Discovery From GitHub

**Files:**
- Create: `tests/independent-review/github-review-discovery.test.js`
- Create: `tools/independent-review/github-review-discovery.js`

**Interfaces:**
- Produces: `selectCurrentHeadReview(reviews, currentHead)` and `fetchPullRequestReviews({ apiUrl, repository, pullNumber, token })`.

- [ ] Test pagination, stale reviews, later invalid reviews, missing commit binding, marker collisions, and selection of the latest valid review for the exact current HEAD.
- [ ] Verify RED.
- [ ] Implement REST pagination using Node `https`, response size limits, and strict selection.
- [ ] Verify GREEN.

### Task 4: Single Merge Decision Aggregator

**Files:**
- Create: `tests/independent-review/merge-decision.test.js`
- Create: `tools/independent-review/merge-decision.js`

**Interfaces:**
- Produces: `buildMergeDecision({ currentHead, deterministicResult, reviewResult, branchProtectionApplied })` and `renderChineseReport(decision)`.

- [ ] Test that any failed/missing/unknown deterministic gate, stale review, P0/P1, bypass, missing evidence, unresolved blocker, or missing branch protection forces `mergeAllowed=false`.
- [ ] Test that source merge never sets promotion or formal release true.
- [ ] Verify RED.
- [ ] Implement the single authority decision and Chinese report.
- [ ] Verify GREEN.

### Task 5: Trusted GitHub Workflow

**Files:**
- Create: `.github/workflows/yance-automated-independent-review-gate.yml`
- Create: `governance/independent-review/main-branch-protection-v1.json`
- Create: `tests/independent-review/workflow-contract.test.js`

**Interfaces:**
- Required check name: `Yance Automated Independent Review Gate / merge-decision`.

- [ ] Test workflow source for `pull_request_target`, exact job name, base/candidate isolated checkouts, `persist-credentials: false`, job-scoped permissions, no OpenAI secret references, and no candidate-controlled validator path.
- [ ] Verify RED.
- [ ] Implement the workflow: deterministic job, review-validation job, and final merge-decision job.
- [ ] The final job posts/upserts one Chinese decision comment and fails when `mergeAllowed=false`.
- [ ] Verify GREEN.

### Task 6: Review Template and Operator Protocol

**Files:**
- Create: `.github/YANCE_CHATGPT_REVIEW_TEMPLATE.md`
- Create: `docs/governance/YANCE_INDEPENDENT_REVIEW_GATE_OPERATIONS_ZH.md`
- Create: `governance/independent-review/gate-installation-state.json`

**Interfaces:**
- Documents the exact JSON body ChatGPT must submit through GitHub Review.

- [ ] Document review scope, prompt-injection resistance, exact HEAD binding, fail-closed behavior, re-review after synchronize, and release-stage separation.
- [ ] Record `branchProtectionApplied=false` until GitHub settings are actually changed.
- [ ] Confirm no API key or secret instructions exist.

### Task 7: End-to-End Verification and PR

**Files:**
- Test: `tests/independent-review/*.test.js`

- [ ] Run all independent-review tests.
- [ ] Run WP0 and the deterministic manifest against the branch HEAD.
- [ ] Open a Draft PR to `main`.
- [ ] Submit a ChatGPT structured review bound to the exact PR HEAD.
- [ ] Confirm a new commit invalidates the old review.
- [ ] Keep the PR blocked while GitHub Actions runner infrastructure or branch protection is not credibly active.
