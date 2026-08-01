# FIX6G AI Brain Role Lifecycle Authority V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented model readiness and routing semantics with one auditable task-role lifecycle, atomic per-task routing, cross-provider fallback resolution, and complete isolated-execution evidence.

**Architecture:** Introduce a pure `aiBrainRoleLifecycleAuthority` that derives task-scoped lifecycle states from existing connectivity, benchmark, role-receipt, champion, shadow, and runtime evidence. Route records become V2 documents with separate `requested` intent and `resolved` authority output while retaining legacy projections for compatibility. Per-task updates use a single SQLite transaction and execution termination evidence is captured at the process boundary and persisted for diagnostics.

**Tech Stack:** Node.js 22+, CommonJS, `node:test`, SQLite document store, Express routes, vanilla browser JavaScript.

## Global Constraints

- No temporary bypasses, weakened validation, or silent fail-open behavior.
- Existing credential, receipt, budget, Batch-only, isolation, late-result fence, and safe-mode authorities remain enforced.
- Claude Opus 5 and GPT-5.6 Sol are preferred initial challengers, not hard-coded formal champions.
- Automatic fallback must be a different model and a different provider failure domain.
- Platform login is not a prerequisite for offline task benchmark qualification; platform UAT remains a separate release gate.
- `windowsUiUat=false`, `readyForPromotion=false`, `formalRelease=false`, and `candidatePackageGenerated=false` remain unchanged.

---

### Task 1: Task-role lifecycle authority

**Files:**
- Create: `backend/services/aiBrainRoleLifecycleAuthority.js`
- Test: `backend/tests/fix6gAiBrainRoleLifecycleAuthority.test.js`

**Interfaces:**
- Produces: `deriveModelTaskLifecycle(model, task, context) -> { state, stage, selectable, routable, formal, active, reasonCode, evidence }`
- Produces: `projectModelLifecycles(models, tasks, context) -> object`

- [ ] **Step 1: Write failing tests** for catalog-only, connectivity-verified, conditional challenger, benchmark-passed, role-qualified, champion, runner-up, active, degraded, revoked, and mutable `latest` alias rejection.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 backend/tests/fix6gAiBrainRoleLifecycleAuthority.test.js`; expect module-not-found failure.
- [ ] **Step 3: Implement minimal pure authority** with the ordered states `CATALOG_ONLY`, `CONNECTIVITY_VERIFIED`, `TASK_CHALLENGER`, `TASK_BENCHMARK_PASSED`, `ROLE_QUALIFIED`, `TASK_CHAMPION`, `TASK_RUNNER_UP`, `SHADOW_VALIDATED`, `ACTIVE`, `DEGRADED`, `REVOKED`.
- [ ] **Step 4: Re-run the test** and require zero failures.
- [ ] **Step 5: Commit** `feat(ai): add task-role lifecycle authority`.

### Task 2: Requested/resolved route V2 and independent fallback resolver

**Files:**
- Create: `backend/services/aiRouteResolutionAuthority.js`
- Modify: `backend/services/modelRoutingIntegrityService.js`
- Modify: `backend/services/replyChampionAuthority.js`
- Test: `backend/tests/fix6gRouteResolutionAuthority.test.js`

**Interfaces:**
- Consumes: `deriveModelTaskLifecycle` from Task 1.
- Produces: `normalizeRouteV2(route, task)`.
- Produces: `resolveRoute(models, task, requested, options) -> { requested, resolved, resolutionState, reasonCodes, legacy }`.

- [ ] **Step 1: Write failing tests** showing `fallback.mode=auto` remains recorded when no candidate exists, produces `NO_QUALIFIED_INDEPENDENT_FALLBACK`, and never selects the primary provider.
- [ ] **Step 2: Run** the focused test and confirm RED.
- [ ] **Step 3: Implement route V2** with exact shape:

```js
{
  schemaVersion: 2,
  requested: {
    enabled: true,
    primary: { mode: 'manual', modelId: '...' },
    fallback: { mode: 'auto', modelId: '' }
  },
  resolved: {
    primary: { modelId: '...', reasonCode: 'MANUAL_MODEL_SELECTED' },
    fallback: { modelId: '', reasonCode: 'NO_QUALIFIED_INDEPENDENT_FALLBACK' }
  },
  resolutionState: 'PRIMARY_ONLY_CONDITIONAL'
}
```

- [ ] **Step 4: Preserve legacy fields** `primary`, `fallback`, `primarySelection`, `fallbackSelection`, `requestedPrimary`, `requestedFallback` as projections only.
- [ ] **Step 5: Run focused and existing routing tests**; require zero failures.
- [ ] **Step 6: Commit** `refactor(ai): unify requested and resolved route state`.

### Task 3: Atomic single-task route update and isolated route test

**Files:**
- Modify: `backend/services/modelRegistry.js`
- Modify: `backend/routes/models.js`
- Test: `backend/tests/fix6gSingleRouteAtomicity.test.js`

**Interfaces:**
- Produces: `modelRegistry.setRoute(task, route, options)`.
- Produces HTTP: `PATCH /api/r32/models/routes/:task`.
- Extends HTTP: `POST /api/r32/models/routes/:task/test` accepts `{ routeDraft }` and tests the atomically validated task without persisting unrelated routes.

- [ ] **Step 1: Write failing tests** where another stale task exists but updating/testing `quick_reply` succeeds and leaves the stale task untouched.
- [ ] **Step 2: Verify RED** against missing `setRoute` and endpoint behavior.
- [ ] **Step 3: Implement one-task SQLite transaction** validating only the target route and preserving all other records.
- [ ] **Step 4: Implement draft test path** that resolves and invokes only the supplied task route.
- [ ] **Step 5: Re-run tests**, including `backend/tests/aiBrainManualRouteClosure.test.js`.
- [ ] **Step 6: Commit** `fix(ai): isolate route save and test by task`.

### Task 4: Isolated execution telemetry and diagnostics persistence

**Files:**
- Modify: `backend/services/modelExecutionHost.js`
- Modify: `backend/services/modelExecutionWorker.js`
- Create: `backend/services/modelExecutionEvidenceStore.js`
- Modify: diagnostics/status projection files discovered by tests.
- Test: `backend/tests/fix6gModelExecutionTelemetry.test.js`

**Interfaces:**
- `startModelExecution()` exit receipt includes `executionId`, `correlationId`, `workerStarted`, `lastWorkerMessageType`, `exitCode`, `signal`, `terminationClass`, `terminationReason`, `abortSource`, `stderrTail`, `providerRequestId`, and `terminated`.
- Success exits use `terminated:false`.

- [ ] **Step 1: Write failing child-process fixtures** for normal result, non-zero exit with stderr, caller abort, timeout-style termination, and result-envelope loss.
- [ ] **Step 2: Verify RED** showing missing evidence and incorrect `terminated:true` on success.
- [ ] **Step 3: Change stdio to captured pipes**, bound stderr to a safe tail, track worker messages, and classify termination at the process boundary.
- [ ] **Step 4: Persist privacy-safe recent execution receipts** for system diagnostics.
- [ ] **Step 5: Run physical-execution and new telemetry tests**.
- [ ] **Step 6: Commit** `fix(ai): preserve isolated execution termination evidence`.

### Task 5: Lifecycle-aware model pools and benchmark/platform separation

**Files:**
- Modify: `backend/services/openRouterFrontierCandidateAuthority.js`
- Modify: model status/presentation authority files.
- Modify: commercial/reply benchmark authority only where needed.
- Test: `backend/tests/fix6gModelPoolSegmentation.test.js`

**Interfaces:**
- Produces pools: `inventory`, `background`, `multimodal`, `challengers`, `qualified`, `champions`, `batchOnly`.
- Model task benchmark qualification does not require platform account state.

- [ ] **Step 1: Write failing tests** proving 29 registered models are not projected as 29 reply candidates, Batch-only remains isolated, mutable aliases cannot become formally qualified, and offline benchmark can qualify a challenger without platform login.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement lifecycle-based segmentation** and explicit benchmark/UAT gate separation.
- [ ] **Step 4: Re-run frontier, presentation, and role-receipt tests**.
- [ ] **Step 5: Commit** `refactor(ai): segment model pools by lifecycle`.

### Task 6: Frontend route intent/result projection

**Files:**
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Test: `backend/tests/fix6gWorkbenchRouteProjection.test.js`

**Interfaces:**
- UI reads `requested` for controls and `resolved` for actual model/status.
- Per-route test calls `POST /api/r32/models/routes/:task/test` with `routeDraft`; it does not save all routes first.

- [ ] **Step 1: Write static/behavior tests** for no global `/routes` POST before a task test, explicit unresolved-auto reason, provider-independent fallback text, and lifecycle sections.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Update registry projection and route rendering** without changing unrelated workbench behavior.
- [ ] **Step 4: Re-run workbench and UI governance tests**.
- [ ] **Step 5: Commit** `fix(ui): separate requested and resolved AI routing`.

### Task 7: Migration and Windows failure-composition regression

**Files:**
- Create: `backend/tests/fix6gWindowsFailureComposition.test.js`
- Modify: route migration/normalization files only as required.

**Interfaces:**
- Legacy FIX6F routes migrate deterministically to V2.
- Test composition: manual Claude primary, GPT fallback switched to auto, unrelated stale route, single-task test, worker termination evidence.

- [ ] **Step 1: Write end-to-end RED test** reproducing the exact Windows sequence.
- [ ] **Step 2: Implement only migration/integration corrections revealed by the test**.
- [ ] **Step 3: Run all FIX6G tests and the eight baseline files**.
- [ ] **Step 4: Commit** `test(ai): close Windows route and execution composition`.

### Task 8: Verification, review, identity, and delivery

**Files:**
- Create/update FIX6G source identity, descriptor, report, verification JSON, patch, and UAT checklist.

- [ ] **Step 1: Run syntax checks** for every modified JavaScript file.
- [ ] **Step 2: Run focused FIX6G suite**, Round13 AI quality, WP5, source-UAT delivery, and full backend per-file isolation.
- [ ] **Step 3: Run CodeRabbit CLI if available/authenticated; otherwise record exact prerequisite failure without substituting a manual result.**
- [ ] **Step 4: Verify database bytes were not polluted** and restore baseline test data if needed.
- [ ] **Step 5: Generate full-source and evidence ZIPs**, validate CRC, path safety, symlinks, file manifest, and SHA256.
- [ ] **Step 6: Re-extract final source ZIP and re-run critical FIX6G and delivery gates from the package itself.**
- [ ] **Step 7: Keep global release gates false and document remaining real Windows/OpenRouter/platform evidence boundaries.**
