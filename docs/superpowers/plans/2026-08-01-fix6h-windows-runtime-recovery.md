# FIX6H Windows Runtime Recovery Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI model service page load global model state without contacts and recover deterministically from Electron network utility crashes without false page-level isolation.

**Architecture:** Add a shared process-health authority in Electron, extend renderer runtime-error classification, and introduce contact-independent model-runtime hydration with bounded retry. Runtime failures are classified and persisted as structured evidence; recoverable network-service restarts trigger model-state rehydration instead of a fatal banner.

**Tech Stack:** Node.js 22+, Electron 39, CommonJS, browser JavaScript, Node test runner.

## Global Constraints

- No temporary bypasses, disabled checks, or silent error swallowing.
- Preserve `windowsUiUat=false`, `readyForPromotion=false`, `formalRelease=false`, and `candidatePackageGenerated=false`.
- OpenRouter and model registry state are global; contact state must not gate model hydration.
- Recoverable utility-process crashes must remain observable and must not be misclassified as renderer corruption.
- Every production behavior change requires a failing test first.

---

### Task 1: Reproduce the Windows evidence chain

**Files:**
- Create: `tests/uat/fix6hWindowsRuntimeRecovery.test.js`

**Interfaces:**
- Consumes: `frontend/js/r32-ai-workbench-runtime.js`, `frontend/js/r32-ui-runtime.js`, `electron/main.js`, `electron/preload.js`.
- Produces: regression tests for contact-independent model hydration, recoverable network process classification, and diagnostics evidence.

- [ ] Write failing tests for unconditional model status hydration.
- [ ] Write failing tests that recoverable network utility crashes are not fatal renderer errors.
- [ ] Write failing tests that renderer runtime evidence is included in exported diagnostics.
- [ ] Run the test and verify RED failures match the missing behavior.

### Task 2: Add runtime process health authority

**Files:**
- Create: `electron/runtimeProcessHealthAuthority.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Test: `tests/desktop-fixes/runtime-process-health-authority.test.js`

**Interfaces:**
- Produces: `classifyChildProcessGone(details)` and `desktop:runtime-health` renderer events.

- [ ] Write authority unit tests.
- [ ] Verify RED.
- [ ] Implement classification for network utility, GPU, renderer, and unknown processes.
- [ ] Wire `app.on('child-process-gone')` and preload subscription.
- [ ] Verify GREEN.

### Task 3: Classify renderer runtime failures and export evidence

**Files:**
- Modify: `frontend/js/r32-runtime-errors.js`
- Modify: `frontend/js/r32-ui-runtime.js`
- Test: `tests/uat/fix6hWindowsRuntimeRecovery.test.js`

**Interfaces:**
- Produces: `classifyRuntimeFailure`, structured runtime evidence, and `runtimeErrors` in diagnostic snapshots.

- [ ] Add failing unit assertions for AbortError, transient network failures, and fatal JavaScript errors.
- [ ] Verify RED.
- [ ] Implement shared classification and evidence normalization.
- [ ] Replace unconditional fatal banner behavior with classified recovery/fatal behavior.
- [ ] Include renderer errors and process-health events in diagnostics.
- [ ] Verify GREEN.

### Task 4: Decouple global model hydration from contacts

**Files:**
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Test: `tests/uat/fix6hWindowsRuntimeRecovery.test.js`

**Interfaces:**
- Produces: contact-independent `refreshAiRuntimeStatus`, bounded retry, and explicit loading/recovery/error empty states.

- [ ] Add failing assertions that `openAIWorkbench` always refreshes model status.
- [ ] Verify RED.
- [ ] Add model-runtime state and bounded retry.
- [ ] Trigger rehydration on `desktop:runtime-health` network recovery events.
- [ ] Render explicit model loading/recovery/error states rather than an empty panel.
- [ ] Verify GREEN.

### Task 5: Regression and delivery

**Files:**
- Modify: derived identity and delivery evidence files.
- Create: FIX6H report, verification JSON, source ZIP, evidence ZIP.

**Interfaces:**
- Produces: complete FIX6H source and evidence deliverables.

- [ ] Run syntax checks.
- [ ] Run FIX6H focused tests.
- [ ] Run Round13, WP5, source UAT, and all backend files in isolated processes.
- [ ] Restore SQLite test pollution.
- [ ] Generate identity-bound packages and validate ZIP safety, path length, CRC, and extracted bytes.
- [ ] Re-run focused and source-UAT tests from the final ZIP.
