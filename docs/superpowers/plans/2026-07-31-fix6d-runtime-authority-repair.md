# FIX6D Runtime Authority Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Windows OpenRouter onboarding, AI role qualification, and safe-mode escalation defects without weakening existing fail-safe guarantees.

**Architecture:** Preserve the existing credential coordinator, model registry, routing integrity service, and runtime operating-mode gateway as authorities. Add explicit result receipts and capability contracts at their boundaries, make OpenRouter onboarding search for two independently successful interactive models, persist role-specific qualification receipts, and route AI-only blockers into an AI-domain isolation state instead of global safe mode. Extend the runtime_state authority so operating mode and its reason metadata are committed atomically.

**Tech Stack:** Node.js 22, Electron IPC, SQLite RuntimeStateStore, node:test, vanilla frontend JavaScript.

## Global Constraints

- No temporary bypasses, relaxed gates, fixed sleeps, or page-specific exceptions.
- Existing credential stop/commit/restart/FD5/READY lifecycle remains fail-safe.
- OpenRouter catalog success never substitutes for real chat-completion success.
- Batch-only models never enter interactive chat, reply, director, or translation routes.
- Conditional qualification never becomes formal qualification without a persisted role receipt.
- AI route defects may block AI automation but must not block unrelated account, manual-send, or update domains.
- System-level data, credential-integrity, unknown-send, and ledger failures may still enter global safe mode.
- Windows 100%/125%/150% evidence remains required before promotion.

---

### Task 1: Credential Mutation Receipt Contract

**Files:**
- Create: `frontend/js/r32-credential-mutation-receipt.js`
- Modify: `frontend/index.html`
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Modify: `electron/main.js`
- Test: `tests/uat/fix6dRuntimeAuthorityRepair.test.js`

**Interfaces:**
- Produces `window.YanceCredentialMutationReceipt.assertSaved(result)`.
- Electron IPC returns `{ok, mutationCommitted, runtimeConfirmed, requestId, reasonCode, message}` for both success and failure-after-commit.

- [ ] Write failing tests for committed-but-runtime-unconfirmed and pre-commit failures.
- [ ] Run the focused test and verify RED.
- [ ] Implement the shared renderer receipt parser and structured Electron response.
- [ ] Run the focused test and verify GREEN.
- [ ] Commit.

### Task 2: Model Capability Authority

**Files:**
- Create: `backend/services/modelCapabilityAuthority.js`
- Modify: `backend/services/openRouterOnboardingSmokeService.js`
- Modify: `backend/services/modelRoutingIntegrityService.js`
- Test: `tests/uat/fix6dRuntimeAuthorityRepair.test.js`

**Interfaces:**
- Produces `classify(model)`, `supportsInteractiveChat(model)`, and `supportsTask(model, task)`.
- Batch-only slugs and catalog metadata are excluded from interactive task selection.

- [ ] Write failing tests proving `:batch` models cannot enter chat routes.
- [ ] Run and verify RED.
- [ ] Implement capability classification and route integration.
- [ ] Run and verify GREEN.
- [ ] Commit.

### Task 3: Adaptive Independent OpenRouter Smoke

**Files:**
- Modify: `backend/services/openRouterOnboardingSmokeService.js`
- Modify: `backend/routes/models.js`
- Test: `tests/uat/fix6dRuntimeAuthorityRepair.test.js`

**Interfaces:**
- `run()` tries eligible candidates in ranked order until two distinct models pass or candidates are exhausted.
- Output records attempted, passed, failed, primary, and fallback receipts.

- [ ] Write failing test where candidate 2 fails and candidate 3 succeeds.
- [ ] Run and verify RED.
- [ ] Implement adaptive search with bounded candidate count and preserved failure evidence.
- [ ] Run and verify GREEN.
- [ ] Commit.

### Task 4: Role Qualification Receipts

**Files:**
- Create: `backend/services/aiRoleQualificationReceiptAuthority.js`
- Modify: `backend/services/modelRegistry.js`
- Modify: `backend/services/aiTaskRoleReadinessAuthority.js`
- Test: `tests/uat/fix6dRuntimeAuthorityRepair.test.js`

**Interfaces:**
- Produces durable role receipts for `quick_reply`, `deep_reply`, `director`, and `translation`.
- Formal readiness consumes role receipts; generic smoke remains conditional only.

- [ ] Write failing tests for missing, expired, model-mismatched, and valid role receipts.
- [ ] Run and verify RED.
- [ ] Implement receipt persistence and readiness consumption.
- [ ] Run and verify GREEN.
- [ ] Commit.

### Task 5: AI-Domain Isolation

**Files:**
- Create: `backend/services/runtimeDomainIsolationAuthority.js`
- Modify: `backend/services/runtimeSafetySupervisor.js`
- Modify: `backend/services/systemCenterService.js`
- Modify: `backend/services/diagnosticsService.js`
- Test: `backend/tests/f25WindowsUatRepairBatch4.test.js`
- Test: `tests/uat/fix6dRuntimeAuthorityRepair.test.js`

**Interfaces:**
- AI qualification blockers set `aiAutomationBlocked=true` with reasons.
- Only system-critical blockers invoke `runtime.enterSafeMode()`.

- [ ] Write failing tests proving model-route blockers isolate AI without global safe mode.
- [ ] Run and verify RED.
- [ ] Implement domain isolation and system-center projection.
- [ ] Run and verify GREEN.
- [ ] Commit.

### Task 6: Atomic Safe-Mode Reason Authority

**Files:**
- Modify: `backend/runtime/RuntimeStateStore.js`
- Modify: `backend/runtime/OperatingModeTransitionGateway.js`
- Modify: `backend/services/safeModeService.js`
- Test: `tests/wp5/operating-mode-gateway.test.js`
- Test: `tests/uat/fix6dRuntimeAuthorityRepair.test.js`

**Interfaces:**
- `runtime_state` stores reason code, reasons, trigger, entered timestamp, actor, and evidence digest in the same transaction as `operating_mode`.
- `getOperatingModeAuthority()` and `safeModeService.snapshot()` return the same atomic metadata.

- [ ] Write failing migration and transition tests for atomic metadata.
- [ ] Run and verify RED.
- [ ] Add schema migration and atomic persistence/read projection.
- [ ] Run and verify GREEN.
- [ ] Commit.

### Final Verification and Delivery

- [ ] Run focused RED/GREEN suites.
- [ ] Run WP4 credential lifecycle, WP5 operating mode, existing OpenRouter UAT, safety supervisor, source-delivery, and typography regression suites.
- [ ] Generate a machine-readable verification report and source handoff ZIP.
- [ ] Keep `windowsUiUat=false`, `readyForPromotion=false`, and `formalRelease=false` until a new Windows evidence package passes.
