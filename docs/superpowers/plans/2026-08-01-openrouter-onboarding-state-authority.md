# OpenRouter Onboarding State Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make OpenRouter onboarding state atomic and make automatic conditional routes testable without running or bypassing the formal benchmark.

**Architecture:** Add pure renderer-side projection authorities for route drafts and OpenRouter presentation. Reuse the existing model runtime snapshot authority for onboarding commits, and remove implicit AI automation activation.

**Tech Stack:** Node.js CommonJS/UMD modules, browser JavaScript, `node:test`, Express backend contracts.

## Global Constraints

- No temporary bypasses; fix shared authorities and data flow.
- Do not run or mark the OpenRouter formal benchmark as completed.
- Conditional routes remain human-review-only.
- No hidden global automation enablement during credential onboarding.

---

### Task 1: Route draft authority

**Files:**
- Create: `frontend/js/r32-route-draft-authority.js`
- Modify: `frontend/index.html`
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Test: `backend/tests/fix6kOpenRouterUiStateAuthority.test.js`

**Interfaces:**
- Produces: `YanceRouteDraftAuthority.project(route, services, { purpose })`, `normalizeTimeoutMs(task, value)`, and `timeoutPolicyForTask(task)`

- [x] Write failing tests for persist and test projections.
- [x] Run the focused test and verify failure because the authority is absent.
- [x] Implement the authority.
- [x] Integrate it into save and route-test payload generation.
- [x] Move task timeout floors/defaults/ceilings into the shared authority and preserve the existing UI contract.
- [x] Run focused tests.

### Task 2: Atomic onboarding snapshot

**Files:**
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Test: `backend/tests/fix6kOpenRouterUiStateAuthority.test.js`

**Interfaces:**
- Consumes: existing `projectModelRuntimeSnapshot` and `commitModelRuntimeSnapshot`.

- [x] Write a failing source contract test requiring atomic projection/commit and model-pool coverage.
- [x] Verify failure against the current manual assignment sequence.
- [x] Replace manual state updates with one projected snapshot commit.
- [x] Re-render the active panel and counts from the committed snapshot.
- [x] Run focused tests.

### Task 3: Presentation truth and automation separation

**Files:**
- Create: `frontend/js/r32-openrouter-presentation-authority.js`
- Modify: `frontend/index.html`
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Modify: `backend/routes/models.js`
- Test: `backend/tests/fix6kOpenRouterUiStateAuthority.test.js`

**Interfaces:**
- Produces: `formatMoney(value)`, `project(snapshot)`, and human-readable stage labels.

- [x] Write failing tests for null versus numeric zero and stage labels.
- [x] Verify failure.
- [x] Implement and integrate the presentation authority.
- [x] Remove onboarding's implicit `/api/r32/workspace/ai-automation` mutation.
- [x] Update success messaging to require explicit automation activation.
- [x] Run focused tests.

### Task 4: Regression and package verification

**Files:**
- Modify: `tools/runtime-delivery/source-uat-delivery.js`
- Create: `RUN_WHATSAPP_REAL_UAT_SAFE.ps1`
- Create: `RUN_WHATSAPP_REAL_UAT_SAFE.cmd`
- Modify: verification/report artifacts only as generated.

- [x] Run focused FIX6K tests.
- [x] Run related snapshot, routing, OpenRouter, UAT, and frontend contract tests.
- [x] Run the full backend test suite.
- [x] Run all source UAT diagnostics without executing real Windows UAT.
- [x] Restore the declared safe WhatsApp root entry and preserve its blocking exit code.
- [x] Regenerate a derived FIX6K source identity with the prior and new repair authorities.
- [x] Generate source ZIP, SHA256, validation JSON, and repair report.
