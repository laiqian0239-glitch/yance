# Batch40 Unified Audit Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every locally reproducible Batch40 source defect from the three independent audits while preserving fail-closed release governance for external evidence.

**Architecture:** Put lifecycle, persistence, capacity, migration, refresh, and evidence decisions in shared authorities instead of call-site exceptions. Every behavior change starts with a focused regression test, then receives the smallest public-layer fix and a full regression run.

**Tech Stack:** Node.js 22+, `node:test`, Electron renderer JavaScript, SQLite, Windows CMD/PowerShell acceptance tooling.

## Global Constraints

- Fix root causes in shared public layers; do not loosen validation or use prompt/configuration workarounds.
- Keep `readyForPromotion=false` and `formalRelease=false` until real Windows, platform-account, and Provider evidence exists.
- Require durable receipts for physical execution and generation-sensitive commits.
- Verify on the minimum supported Node runtime and never substitute historical PASS output.

---

### Task 1: AI success and streaming generation fence

**Files:**
- Modify: `backend/services/aiGateway.js`
- Modify: `backend/tests/batch40AiLateResultFence.test.js`

**Interfaces:**
- Consumes: execution signal, expected generation, current-generation resolver.
- Produces: one commit authority used before and after awaited success effects, plus generation-fenced token callbacks.

- [ ] Add tests that abort during `recordInvocation()` and after partial streaming output.
- [ ] Run the focused test and confirm the new cases fail for the audited reason.
- [ ] Add the minimal success-commit and streaming fence authority.
- [ ] Run the focused test and existing AI gateway tests.

### Task 2: Durable JobQueue and two-level capacity leases

**Files:**
- Modify: `backend/services/jobQueue.js`
- Modify: `backend/tests/batch40JobQueuePersistence.test.js`
- Modify: `backend/tests/batch40ProviderIsolation.test.js`

**Interfaces:**
- Consumes: physical persistence adapter and provider transition requests.
- Produces: typed persistence receipts, global plus provider admission, and atomic provider transfer.

- [ ] Add fail-open, global concurrency, and provider-transfer regression tests.
- [ ] Verify each new test fails before production edits.
- [ ] Make missing stores and zero-write receipts degrade the queue before execution.
- [ ] Enforce global admission and reserve target-provider capacity before transfer.
- [ ] Run JobQueue and provider isolation suites.

### Task 3: Runtime replacement and learning lifecycle

**Files:**
- Modify: `backend/services/aiTaskRuntimeRegistry.js`
- Modify: `backend/services/replyFeedbackLearningService.js`
- Modify: `backend/tests/batch40AiTaskReplacement.test.js`
- Modify: `backend/tests/batch40LearningDeadlineLedger.test.js`

**Interfaces:**
- Consumes: termination deadlines and learning execution contexts.
- Produces: self-owned referenced deadlines, context propagation to durable dispatch, and bounded stop receipts.

- [ ] Add minimum-runtime deadline, durable-dispatch, reconciliation, and stop-abort tests.
- [ ] Verify failures.
- [ ] Keep deadline timers referenced; propagate one execution context through processors and dispatch.
- [ ] Abort service generation on stop and retain unresolved work until bounded settlement.
- [ ] Run replacement and learning suites.

### Task 4: Crash-consistent migration snapshots

**Files:**
- Modify: `backend/migrations/migrationSnapshotManifest.js`
- Modify: `backend/migrations/stage6_3_4ArchitectureClosure.js`
- Modify: inherited migration entry points identified by the audits.
- Modify: `backend/tests/batch40MigrationSnapshotManifest.test.js`

**Interfaces:**
- Consumes: SQLite database identity and checkpoint result rows.
- Produces: strict file identity, complete WAL checkpoint validation, cleanup, file fsync, and directory fsync.

- [ ] Add busy/incomplete checkpoint, empty identity, cleanup, and durability tests.
- [ ] Verify failures.
- [ ] Normalize checkpoint rows fail-closed and reserve `non-file` only for explicit in-memory databases.
- [ ] Fsync snapshot/manifest/directory and remove orphan targets on publication failure.
- [ ] Apply the same strict helper to reachable inherited migrations.
- [ ] Run migration suites.

### Task 5: Renderer refresh, history, and theme lifecycle

**Files:**
- Modify: `frontend/js/r32-sync-stability.js`
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: theme runtime file resolved during implementation.
- Add or modify focused frontend contract tests.

**Interfaces:**
- Produces: single-flight refresh with maximum wait, abortable history generations, coordinated inactive-media refresh, and disposable theme listeners/timers.

- [ ] Add contract tests for max-wait, abort, shared refresh, and dispose.
- [ ] Verify failures.
- [ ] Implement the shared lifecycle authorities.
- [ ] Run frontend contract tests and static theme audits.

### Task 6: Strict Windows acceptance authority

**Files:**
- Modify: `scripts/create-batch40-windows-acceptance.js`
- Modify: `backend/tests/batch40WindowsAcceptancePackage.test.js`
- Rebuild: Windows acceptance package after all source changes.

**Interfaces:**
- Produces: machine-readable strict summary receipt binding commit/tree, exact runtimes, counts, completion marker, and log SHA-256.

- [ ] Add tests proving exit-code-only acceptance and runtime drift are rejected.
- [ ] Verify failures.
- [ ] Make CMD invoke one strict parser/receipt authority.
- [ ] Run package tests and inspect the rebuilt archive for absence of prebuilt PASS.

### Task 7: Quality review and complete-source delivery

**Files:**
- Modify: governance matrix/report only with freshly verified source evidence.
- Create: source archive and checksums.

**Interfaces:**
- Produces: reproducible source tree, test receipts, CodeRabbit results, SonarQube results or exact blocker, Mermaid closure map, and external-evidence boundary.

- [ ] Run focused tests, complete backend runner, frontend checks, and package verification.
- [ ] Run SonarQube analysis or record the integration blocker exactly.
- [ ] Run CodeRabbit on the final uncommitted/committed diff and address actionable issues.
- [ ] Generate the Mermaid control closure diagram.
- [ ] Build and hash the complete source delivery without declaring external UAT passed.
