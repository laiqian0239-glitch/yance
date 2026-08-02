# FIX6L Candidate / Production Execution Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate conditional candidate generation from production execution and make route/diagnostic state traceable through one authority.

**Architecture:** Add execution-mode and trace authorities, route route-tests through a dedicated candidate service, retain production fail-closed behavior, and merge backend health into the global diagnostic dialog. Existing registry and quality authorities remain sources of model facts; they no longer infer execution intent from a boolean alone.

**Tech Stack:** Node.js 22, CommonJS, Express, Electron renderer JavaScript, node:test.

## Global Constraints

- No temporary bypasses or relaxed production checks.
- Candidate-only output must require human review and must never auto-send.
- Formal OpenRouter evaluation remains unexecuted and pending.
- Tests must be written and observed failing before production changes.

---

### Task 1: Execution mode and trace authorities

**Files:**
- Create: `backend/services/aiExecutionModeAuthority.js`
- Create: `backend/services/aiExecutionTraceAuthority.js`
- Test: `backend/tests/fix6lExecutionModeAuthority.test.js`

- [ ] Write failing tests for mode defaults, candidate invariants, production invariants, and trace lifecycle.
- [ ] Run the test and confirm RED.
- [ ] Implement the two authorities.
- [ ] Run the test and confirm GREEN.

### Task 2: Mode-aware quality planning

**Files:**
- Modify: `backend/services/aiQualityRouteAuthority.js`
- Test: `backend/tests/fix6lCandidateQualityPlan.test.js`

- [ ] Add a diagnostic-derived conditional model fixture.
- [ ] Prove candidate mode accepts it while production mode blocks it.
- [ ] Implement mode-aware route planning and receipt projection.
- [ ] Verify existing quality authority tests remain green.

### Task 3: Separate execution services

**Files:**
- Create: `backend/services/candidateExecutionService.js`
- Create: `backend/services/productionExecutionService.js`
- Modify: `backend/services/aiGateway.js`
- Modify: `backend/routes/models.js`
- Test: `backend/tests/fix6lCandidateExecutionIntegration.test.js`

- [ ] Add a failing route-test integration proving the old gateway rejects a selectable conditional route.
- [ ] Route candidate tests through `CandidateExecutionService` with one `routeTestId`.
- [ ] Route `/execute` through `ProductionExecutionService`.
- [ ] Verify candidate results are human-review-only, non-learning, and non-deliverable.

### Task 4: Diagnostic authority convergence

**Files:**
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: `frontend/index.html`
- Modify: `backend/services/diagnosticsService.js`
- Test: `tests/uat/fix6lDiagnosticAuthority.test.js`

- [ ] Add a failing test showing the workspace-only dialog can falsely claim all-green.
- [ ] Rename it to workspace diagnostics and merge backend summary.
- [ ] Include recent candidate route traces in backend diagnostics.
- [ ] Verify backend warning/failure prevents a system-health success message.

### Task 5: Regression and delivery

**Files:**
- Create: `YANCE_BATCH40_FIX6L_CANDIDATE_PRODUCTION_AUTHORITY_REPORT_ZH.md`
- Update: derived source identity and delivery validation files.

- [ ] Run focused RED/GREEN tests.
- [ ] Run all relevant AI/OpenRouter/backend/UAT tests.
- [ ] Run full backend and UAT gates.
- [ ] Package source plus Windows one-click launcher.
- [ ] Verify ZIP CRC, duplicates, path safety, and SHA-256.
