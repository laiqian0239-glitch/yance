# Yance Champion Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce task-specific champion models for formal replies while routing translation understanding and relationship-analysis workloads to qualified local or free models under a fail-closed budget authority.

**Architecture:** Add three focused authorities—champion ranking, workload placement, and budget admission—and integrate them into route repair, quality planning, gateway execution, and model diagnostics. Existing qualification receipts remain the source of truth; new authorities only consume verified evidence and never mint qualifications.

**Tech Stack:** Node.js CommonJS, node:test, SQLite document registry, Express.

## Global Constraints

- Formal reply tasks never silently downgrade below the task champion/eligible runner-up policy.
- StubEngine mocks are contract-only and never count as real OpenRouter evidence.
- All fixes are authority-layer refactors; no caller-specific bypasses.
- Existing release gates remain false until real Windows and provider UAT closes.

---

### Task 1: Champion authority

**Files:**
- Create: `backend/services/replyChampionAuthority.js`
- Test: `backend/tests/replyChampionAuthority.test.js`

**Interfaces:**
- Produces: `rank(models, task, options)`, `decide(models, task, options)`, `isFormalReplyTask(task)`.

- [ ] Write failing tests for deterministic champion ranking, expired/unqualified exclusion, manual weak-model rejection, and fallback score-gap enforcement.
- [ ] Run the test and confirm RED.
- [ ] Implement evidence-only ranking and decision output.
- [ ] Run the test and confirm GREEN.

### Task 2: Workload and budget authorities

**Files:**
- Create: `backend/services/aiWorkloadPlacementAuthority.js`
- Create: `backend/services/aiBudgetAuthority.js`
- Test: `backend/tests/aiWorkloadPlacementAuthority.test.js`
- Test: `backend/tests/aiBudgetAuthority.test.js`

**Interfaces:**
- Produces: `executionPolicy(task, options)`, `rankCandidates(models, task, options)`, `budgetDecision(document, context)`.

- [ ] Write RED tests for local-first relationship analysis, local/free translation understanding, outbound translation quality lane, and paid-background budget protection.
- [ ] Implement classification and fail-closed budget decisions.
- [ ] Verify GREEN.

### Task 3: Routing integration

**Files:**
- Modify: `backend/services/modelRoutingIntegrityService.js`
- Modify: `backend/services/aiQualityRouteAuthority.js`
- Modify: `backend/services/aiGateway.js`
- Test: `backend/tests/championBrainRoutingIntegration.test.js`

**Interfaces:**
- Consumes: champion, placement, and budget decisions.
- Produces: route plans containing `championDecision`, `placementDecision`, and `budgetDecision`.

- [ ] Write RED tests showing weak manual formal reply is blocked, auto routes select champion, relationship tasks prefer local, and budget does not downgrade formal replies.
- [ ] Replace reply heuristics with champion authority and utility ordering with placement authority.
- [ ] Extend gateway resolution and route receipt.
- [ ] Verify focused integration tests.

### Task 4: Registry and diagnostics API

**Files:**
- Modify: `backend/services/modelRegistry.js`
- Modify: `backend/routes/models.js`
- Test: `backend/tests/championBrainApi.test.js`

**Interfaces:**
- Produces: registry defaults `aiBudgetPolicy`/`aiBudgetUsage`, `setAiBudgetPolicy`, GET `/models/brain-routing`, PATCH `/models/budget-policy`.

- [ ] Write RED API/registry tests.
- [ ] Add policy persistence with validation that cannot weaken formal reply gates.
- [ ] Add read-only routing diagnostic projection.
- [ ] Verify GREEN.

### Task 5: Verification and packaging

**Files:**
- Create: `YANCE_BATCH40_FIX6E_CHAMPION_BRAIN_REPORT_ZH.md`
- Create: machine-readable verification JSON and derived source ZIP.

- [ ] Run new tests, related regression suites, backend per-file tests, WP5, and source delivery tests.
- [ ] Run SonarQube analysis when integration is available; otherwise preserve exact unavailable evidence.
- [ ] Confirm StubEngine did not create or use a mock as provider evidence.
- [ ] Generate hashes and verify final ZIP content from a fresh extraction.
