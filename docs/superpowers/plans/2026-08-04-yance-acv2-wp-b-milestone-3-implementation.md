# Yance ACV2 WP-B Milestone 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close WP-B source authority, provenance, final review, and permanent validation without opening merge, WP-C, production use, formal release, or publish authority.

**Architecture:** Add a machine-verifiable M3 authorization before production changes, generalize the existing WP-A source-closure scanner through immutable work-package configuration, and drive all legacy removal from the exact WP-B operation inventory. Finish with deterministic provenance/SBOM evidence, an independent source review bound to one reviewed Head, a closure receipt, and permanent Ubuntu/Windows post-merge validation.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, Git/GitHub Actions, SQLite Schema 23, JSON governance receipts, SHA-256, npm lockfile, SPDX JSON or CycloneDX JSON.

## Global Constraints

- Authorization anchor Head is `9f82377119e16f8e02d3b83f0795b452e36f769e`.
- Approved M3 design Head is `237061c6ff20c5424d26ea8dc56618db4c521c0e`.
- Milestone 2 Seal Head is `5f08a5a75aeae4d3baeb5a1d34a470f21ac0180d`.
- Milestone 2 reviewed implementation Head is `3e5d71f68afccb64d0f61a776170d815fed77747`.
- PR #17 must remain Draft, open, and unmerged.
- `readyForPromotion`, `mergeAuthorized`, `productionUseAuthorized`, `wpCAuthorized`, `formalRelease`, and `publish` remain `false`.
- `temporaryBypassAllowed=false` and `warningOnlyClosureAllowed=false` are non-waivable.
- No global path wildcard, scanner exclusion, warning-only result, feature-flag disablement, callable fallback, duplicate writer, duplicate recovery authority, or timeout increase may be used to obtain GREEN.
- Every behavior change follows RED → GREEN on the exact same Head and is verified on Ubuntu and Windows when platform behavior is involved.
- Historical migrations 001–023 and sealed M1/M2 evidence remain immutable.

---

### Task 1: Establish Credible Milestone 3 Authorization RED

**Files:**
- Create: `backend/tests/architectureClosureV2/wpB/m3Authorization.test.js`
- Create: `.github/workflows/wp-b-m3-authorization.yml`

**Interfaces:**
- Consumes: M2 evidence Head, M2 Seal Head, approved M3 design Head, PR #17 facts.
- Produces: explicit non-infrastructure RED contract IDs `M3-AUTH-001` through `M3-AUTH-006`.

- [ ] **Step 1: Write the missing-artifact contracts without requiring missing modules**

```js
const expected = Object.freeze([
  ['M3-AUTH-001', 'governance/architecture-closure-v2/wp-b-m3-authorization.json'],
  ['M3-AUTH-002', 'tools/architecture-closure-v2/verify-wp-b-m3-authorization.js']
]);
for (const [id, relativePath] of expected) {
  test(`${id} requires ${relativePath}`, () => {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, id);
  });
}
```

Add separate tests that fail with stable assertion messages when the active authority resolver is absent, when M3 remains false, when wildcard scope is accepted, and when downstream governance can open.

- [ ] **Step 2: Add the permanent dual-platform authorization workflow**

The workflow checks out `${{ github.event.pull_request.head.sha || github.sha }}`, validates exact branch/Head, runs only the M3 authorization contract file, and confirms a clean worktree. Missing files must be test failures, not `MODULE_NOT_FOUND` infrastructure failures.

- [ ] **Step 3: Run syntax locally**

Run:

```bash
node --check backend/tests/architectureClosureV2/wpB/m3Authorization.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit RED**

```bash
git add backend/tests/architectureClosureV2/wpB/m3Authorization.test.js \
  .github/workflows/wp-b-m3-authorization.yml
git commit -m "test(acv2): establish WP-B milestone-three authorization red"
```

- [ ] **Step 5: Verify credible same-Head RED**

Expected on Ubuntu and Windows: identical six failure IDs, no checkout/setup/syntax failure, no secret leak, and no business-content leak.

---

### Task 2: Implement Machine-Readable Milestone 3 Authorization

**Files:**
- Create: `governance/architecture-closure-v2/wp-b-m3-authorization.json`
- Create: `tools/architecture-closure-v2/verify-wp-b-m3-authorization.js`
- Modify: `shared/release/acv2ActiveWorkPackageAuthority.js`
- Modify: `tests/wp0/acv2-work-package-scope-wiring.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`
- Modify: `backend/tests/architectureClosureV2/wpB/m3Authorization.test.js`
- Modify: `.github/workflows/wp-b-m3-authorization.yml`

**Interfaces:**
- Produces: `validateReceipt(document)`, `verifyLocalRepository(document, options)`, `isAuthorizedPath(document, path)`, `resolveImplementationAuthority(options)`, and `resolveWpBM3ImplementationAuthority(options)`.
- Authorization scope is the sorted unique union of exact M3 governance paths and exact production paths already present in `wp-b-operation-inventory.json`; no directory wildcard is accepted.

- [ ] **Step 1: Define the receipt schema**

The receipt must contain exact full SHAs, `status: "AUTHORIZED_FOR_SOURCE_CLOSURE_AND_FINAL_GATES"`, `approvedBy: "PROJECT_OWNER"`, authorization time `2026-08-04T14:56:00+07:00`, PR/branch facts, ordered execution stages, exact allowed paths, credible authorization RED evidence, and all downstream closed flags.

- [ ] **Step 2: Write mutation tests before the verifier**

Test wrong M2 evidence Head, wrong M2 Seal Head, wrong design Head, reordered execution stages, duplicate paths, adjacent paths, `*`/`**`, missing inventory path, extra unregistered production path, non-Draft policy, and every downstream flag changed to `true`.

- [ ] **Step 3: Implement fail-closed receipt validation**

```js
function isAuthorizedPath(document, repositoryPath) {
  try { validateReceipt(document); }
  catch (_) { return false; }
  const normalized = normalizeRepositoryPath(repositoryPath);
  return Boolean(normalized && document.allowedPaths.includes(normalized));
}
```

`verifyLocalRepository` must prove ancestry from the M2 evidence Head and approved design Head, validate the sealed M2 receipt through `verify-wp-b-m2-review.js`, and require a clean worktree.

- [ ] **Step 4: Wire the active authority resolver**

`resolveWpBImplementationAuthority()` must prefer valid M3 authority over M2 authority. The returned object is recursively frozen, declares `milestone: 3`, and exposes only exact allowed production paths.

- [ ] **Step 5: Run focused GREEN**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/m3Authorization.test.js \
  tests/wp0/acv2-work-package-scope-wiring.test.js \
  tests/wp0/implementation-branch-policy.test.js
node tools/architecture-closure-v2/verify-wp-b-m3-authorization.js
```

Expected: all tests pass and the verifier reports `milestone3Authorized=true` while every downstream authority remains false.

- [ ] **Step 6: Commit authorization GREEN**

```bash
git add governance/architecture-closure-v2/wp-b-m3-authorization.json \
  tools/architecture-closure-v2/verify-wp-b-m3-authorization.js \
  shared/release/acv2ActiveWorkPackageAuthority.js \
  backend/tests/architectureClosureV2/wpB/m3Authorization.test.js \
  tests/wp0/acv2-work-package-scope-wiring.test.js \
  tests/wp0/implementation-branch-policy.test.js \
  .github/workflows/wp-b-m3-authorization.yml
git commit -m "governance(acv2): authorize WP-B milestone three"
```

---

### Task 3: Establish WP-B Source-Closure Credible RED

**Files:**
- Create: `governance/architecture-closure-v2/wp-b-source-closure-baseline.json`
- Create: `backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/sourceClosureDiagnostics.test.js`
- Modify: `.github/workflows/wp-b-validation.yml`

**Interfaces:**
- Produces expected report fields: `violationCount`, `legacyCallablePathCount`, `directExternalCallOutsideAdapterCount`, `blindRetryPathCount`, `legacyWriterPathCount`, `legacyRecoveryPathCount`, `timerOrReconnectAuthorityPathCount`, and `unregisteredSourcePathCount`.

- [ ] **Step 1: Freeze B-specific discovery configuration**

The baseline lists exact discovery roots `backend`, `electron`, `services`, and runtime-imported shared paths; exact non-production exclusions are allowed only for build artifacts and dependency directories, not source files.

- [ ] **Step 2: Write report-shape and zero-closure assertions**

```js
const report = scanRegisteredSources({ wp: 'B' });
assert.equal(report.workPackage, 'WP-B');
for (const field of REQUIRED_ZERO_FIELDS) assert.equal(report[field], 0, field);
```

Before scanner changes, these tests must fail through explicit missing-field or nonzero-count assertions.

- [ ] **Step 3: Write diagnostic stability contracts**

Require exact path, inventory ID, capability class, reason code, and callable/non-callable classification for every violation. Reject generic unclassified violations.

- [ ] **Step 4: Commit and verify credible RED**

```bash
git add governance/architecture-closure-v2/wp-b-source-closure-baseline.json \
  backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureDiagnostics.test.js \
  .github/workflows/wp-b-validation.yml
git commit -m "test(acv2): establish WP-B source-closure red"
```

Expected: Ubuntu and Windows produce the same classified violation set without infrastructure failure.

---

### Task 4: Generalize the Source-Closure Authority

**Files:**
- Modify: `tools/architecture-closure-v2/source-capability-authority.js`
- Modify: `tools/architecture-closure-v2/source-closure-scan.js`
- Modify: `backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js`
- Modify: `backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js`
- Modify: `backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js`
- Modify: `backend/tests/architectureClosureV2/wpB/sourceClosureDiagnostics.test.js`

**Interfaces:**
- Produces: `workPackageConfig(wp)`, `validateWpBInventory(inventory)`, `detectWpBCapabilities(source)`, and shared `scanRegisteredSources({ wp })`.

- [ ] **Step 1: Add immutable work-package selection**

```js
const WORK_PACKAGE_CONFIG = Object.freeze({
  A: Object.freeze({
    baselinePath: 'governance/architecture-closure-v2/wp-a-baseline.json',
    registryPath: 'governance/architecture-closure-v2/authority-registry.json',
    mode: 'AUTHORITY_SOURCE_CLOSURE'
  }),
  B: Object.freeze({
    baselinePath: 'governance/architecture-closure-v2/wp-b-source-closure-baseline.json',
    registryPath: 'governance/architecture-closure-v2/wp-b-operation-inventory.json',
    mode: 'DURABLE_OPERATION_SOURCE_CLOSURE'
  })
});
```

Unknown work packages throw `SOURCE_CLOSURE_WORK_PACKAGE_UNSUPPORTED`.

- [ ] **Step 2: Add WP-B capability classes**

Detect source facts for physical provider/platform calls, retry scheduling, recovery entrypoints, reconnect timers, process supervision, queue/checkpoint mutation, facade delegation, and non-production harness execution. Declared and detected capabilities must match exactly.

- [ ] **Step 3: Validate terminal inventory states**

Production rows accept only `DELETED`, `DELEGATES_TO_WP_B_AUTHORITY`, or `READ_ONLY_PROJECTION`. A missing source file is valid only for `DELETED`. Non-production rows accept only `REGISTERED_NON_PRODUCTION` and must be unreachable from runtime imports.

- [ ] **Step 4: Preserve WP-A semantics**

Run the existing WP-A tests before and after the refactor and compare normalized JSON output. Field names, violation classes, and zero/nonzero semantics for `--wp A` must remain unchanged.

- [ ] **Step 5: Run scanner tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js \
  backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureDiagnostics.test.js
node tools/architecture-closure-v2/source-closure-scan.js --wp A
node tools/architecture-closure-v2/source-closure-scan.js --wp B
```

Expected: WP-A remains GREEN; WP-B returns a credible classified RED until remediation tasks finish.

- [ ] **Step 6: Commit scanner authority**

```bash
git add tools/architecture-closure-v2/source-capability-authority.js \
  tools/architecture-closure-v2/source-closure-scan.js \
  backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js \
  backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureDiagnostics.test.js
git commit -m "refactor(acv2): generalize source closure for WP-B"
```

---

### Task 5: Remove Duplicate Recovery, Retry, Timer, and Scheduler Authority

**Files:**
- Modify or delete according to terminal state:
  - `backend/services/accountManagerCore.js`
  - `backend/services/asyncOperationLifecycleAuthorityCore.js`
  - `backend/services/backgroundJobAuthorityCore.js`
  - `backend/services/jobQueueCore.js`
  - `backend/services/ownerRecovery.js`
  - `backend/services/executionDeadline.js`
  - `backend/services/runtimeRecoveryService.js`
  - `backend/services/sendQueueService.js`
  - `backend/services/whatsappHistoryMediaRecovery.js`
  - `electron/backendStartupSupervisor.js`
  - `electron/desktopHost/BackendProcessHost.js`
  - `electron/main.js`
- Modify: `governance/architecture-closure-v2/wp-b-operation-inventory.json`
- Test: `backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js`
- Test: existing recovery, session, fault, and supervisor regressions.

**Interfaces:**
- Remaining compatibility facades may call only `recoverNonterminalExecutions`, durable command submission, or read-only snapshots.
- Process supervisors may restart processes but may not schedule or decide business retry.

- [ ] **Step 1: Add one behavior RED per callable duplicate authority**

Each test invokes the public legacy entrypoint and asserts that it either delegates exactly once to the durable authority or is absent. Timers, reconnect loops, direct business SQL, and SDK calls are instrumented to fail if touched.

- [ ] **Step 2: Remove or delegate root causes**

Delete internal retry/recovery state machines where no compatibility surface is required. Where a public facade remains, reduce it to input validation plus one immutable delegation; do not keep the old Core reachable.

- [ ] **Step 3: Update exact inventory terminal states**

Every changed row records one terminal state, final public entrypoint, target authority, and source markers proving the old behavior is gone.

- [ ] **Step 4: Run focused and cross-process regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/runtimeRecoveryComposition.test.js \
  backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js \
  backend/tests/architectureClosureV2/wpB/sessionRestoreDurableMigration.test.js
node tools/architecture-closure-v2/wp-b-process-fault-matrix.js
```

- [ ] **Step 5: Commit by authority class**

Use separate commits for recovery services, scheduler/timer services, and process supervisors. Each commit must leave the focused scanner count lower and never increase another violation class.

---

### Task 6: Remove Direct Writers and Physical-Call Bypasses

**Files:**
- Modify or delete according to terminal state:
  - `backend/repositories/sendQueueRepository.js`
  - `backend/repositories/syncCheckpointRepository.js`
  - `backend/services/modelExecutionHost.js`
  - `backend/services/modelExecutionWorker.js`
  - `backend/services/ollamaClient.js`
  - `backend/services/openAiCompatibleClient.js`
  - `backend/services/aiGateway.js`
  - `backend/services/communicationAuthority.js`
  - `backend/services/channelAdapterRuntime.js`
  - `backend/services/facebookAdapter.js`
  - `backend/services/facebookOAuthService.js`
  - `backend/services/facebookPersonalMessengerExperimentalAdapter.js`
  - `backend/services/facebookRelayClient.js`
  - `backend/services/mediaPipeline.js`
  - `backend/services/platformAdapterPorts.js`
  - `backend/services/platformDriverRegistry.js`
  - `backend/services/telegramAdapter.js`
  - `backend/services/transcriptionServiceCore.js`
  - `backend/services/whatsappAdapter.js`
  - `services/facebook-gateway/gateway.js`
  - `services/facebook-gateway/server.js`
- Modify: `governance/architecture-closure-v2/wp-b-operation-inventory.json`

**Interfaces:**
- Physical calls remain reachable only through the exact-six `DurableOperationRegistry` adapters and `ExternalActionDispatcher` with persisted attempt/fencing context.
- Queue/checkpoint repositories are read-only compatibility projections or delegates to versioned commands; they own no recovery mutation.

- [ ] **Step 1: Add runtime bypass probes**

For every platform/provider family, invoke the old public route without a persisted attempt and require a stable fail-closed error before network, child process, credential resolution, or database mutation.

- [ ] **Step 2: Remove direct physical reachability**

Move no SDK call into a new helper outside the registered Adapter. Delete exports or replace them with strict Adapter-only capabilities that require frozen attempt identity.

- [ ] **Step 3: Remove direct queue/checkpoint mutations**

Replace mutation methods with durable command delegation. Read APIs may remain only when they return projections and cannot schedule work.

- [ ] **Step 4: Run mandatory operation and platform regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js \
  backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/outboundMessageDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/deliveryReceiptDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/mediaTransferDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/historySynchronizationDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/sessionRestoreDurableMigration.test.js
npm run test:round12-platform-core
npm run test:source-uat-delivery
```

- [ ] **Step 5: Reach zero source violations**

```bash
node tools/architecture-closure-v2/source-closure-scan.js --wp B
```

Expected all required counters equal zero and every production inventory row has a valid terminal state.

---

### Task 7: Build the Final Isolated and Cross-Platform Verification Matrix

**Files:**
- Modify: `tools/architecture-closure-v2/run-wp-b-contracts.js`
- Create: `tools/architecture-closure-v2/run-wp-b-isolated-regressions.js`
- Create: `backend/tests/architectureClosureV2/wpB/finalMatrixContract.test.js`
- Modify: `package.json`
- Modify: `.github/workflows/wp-b-validation.yml`

**Interfaces:**
- `run-wp-b-contracts.js --milestone all` runs authorization, M1/M2 seals, 89 M2 contracts, source closure, and final contracts.
- The isolated runner launches each affected test file in a fresh Node process and emits deterministic JSON counts.

- [ ] **Step 1: Write matrix completeness RED**

The test asserts exact required command groups, isolated file list, Ubuntu/Windows parity fields, Schema 1–23 coverage, fault-matrix execution, and zero leak counters.

- [ ] **Step 2: Implement deterministic isolated execution**

Use `spawnSync(process.execPath, ['--test', '--test-concurrency=1', file])` for each exact file. Record exit code and normalized output hash; fail immediately on any nonzero result.

- [ ] **Step 3: Add package scripts**

```json
{
  "test:acv2:wp-b": "node tools/architecture-closure-v2/run-wp-b-contracts.js --milestone all",
  "verify:acv2:wp-b:source-closure": "node tools/architecture-closure-v2/source-closure-scan.js --wp B",
  "verify:acv2:wp-b": "npm run test:acv2:wp-b && npm run verify:acv2:wp-b:source-closure"
}
```

- [ ] **Step 4: Run the complete local matrix**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:acv2:wp-b
npm run verify:acv2:wp-a
node tools/architecture-closure-v2/run-wp-b-isolated-regressions.js
node tools/architecture-closure-v2/wp-b-process-fault-matrix.js
npm run test:round12-platform-core
npm run test:source-uat-delivery
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
```

- [ ] **Step 5: Commit final runner and matrix**

```bash
git add tools/architecture-closure-v2/run-wp-b-contracts.js \
  tools/architecture-closure-v2/run-wp-b-isolated-regressions.js \
  backend/tests/architectureClosureV2/wpB/finalMatrixContract.test.js \
  package.json .github/workflows/wp-b-validation.yml
git commit -m "test(acv2): enforce final WP-B verification matrix"
```

---

### Task 8: Close XState and Temporal Provenance, NOTICE, License, and SBOM

**Files:**
- Create: `THIRD_PARTY_NOTICES_WP_B.md`
- Create: `governance/architecture-closure-v2/wp-b-sbom.spdx.json`
- Create: `governance/architecture-closure-v2/wp-b-provenance.json`
- Create: `tools/architecture-closure-v2/generate-wp-b-sbom.js`
- Create: `tools/architecture-closure-v2/verify-wp-b-provenance.js`
- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json`
- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json`
- Test: `backend/tests/architectureClosureV2/wpB/openSourceProvenanceClosure.test.js`

**Interfaces:**
- `generateWpBSbom(root) -> deterministic SPDX JSON`.
- `verifyWpBProvenance(root) -> { ok, sbomSha256, packageLockSha256, violations }`.

- [ ] **Step 1: Write provenance RED**

Require XState `5.32.5`, exact npm integrity, MIT license hash, upstream tag/commit, zero restricted imports, vulnerability total zero, deterministic SBOM hash, NOTICE entry, and independent-review pending state. Require Temporal reference-only exact repository/commit/license review with zero packages and zero imported source files.

- [ ] **Step 2: Generate deterministic SBOM**

Sort packages, relationships, checksums, and file references. Exclude timestamps or derive them from a fixed authority value stored in provenance so reruns on Ubuntu and Windows produce identical bytes.

- [ ] **Step 3: Complete registry gate steps**

Set `COPYRIGHT_NOTICE_SBOM_PROVENANCE` to `COMPLETE` only after verifier GREEN. Keep `productionUseAuthorized=false` and defer `INDEPENDENT_REVIEW` until Task 10.

- [ ] **Step 4: Run supply-chain verification**

```bash
node tools/architecture-closure-v2/generate-wp-b-sbom.js --check
node tools/architecture-closure-v2/verify-wp-b-provenance.js
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/openSourceProvenanceClosure.test.js
npm audit --omit=dev --audit-level=high
```

- [ ] **Step 5: Commit provenance closure**

```bash
git add THIRD_PARTY_NOTICES_WP_B.md \
  governance/architecture-closure-v2/wp-b-sbom.spdx.json \
  governance/architecture-closure-v2/wp-b-provenance.json \
  governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json \
  governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json \
  tools/architecture-closure-v2/generate-wp-b-sbom.js \
  tools/architecture-closure-v2/verify-wp-b-provenance.js \
  backend/tests/architectureClosureV2/wpB/openSourceProvenanceClosure.test.js
git commit -m "governance(acv2): close WP-B supply-chain provenance"
```

---

### Task 9: Add Permanent WP-B Main Post-Merge Validation

**Files:**
- Create: `.github/workflows/wp-b-post-merge-validation.yml`
- Create: `tools/architecture-closure-v2/run-wp-b-post-merge-contracts.js`
- Create: `tools/architecture-closure-v2/verify-wp-b-post-merge.js`
- Create: `backend/tests/architectureClosureV2/wpB/postMergeWorkflowContract.test.js`

**Interfaces:**
- Permanent workflow runs on PRs to main and pushes to main for exact WP-B-relevant paths.
- Aggregate summary always emits `readyForPromotion=false`, `wpCAuthorized=false`, `formalRelease=false`, and `publish=false`.

- [ ] **Step 1: Write workflow-policy RED**

Assert pinned checkout/setup-node SHAs, exact checkout of `github.sha`, Ubuntu/Windows matrix, source-closure and provenance jobs, Schema checks, process matrix, inherited WP-A regressions, clean-worktree enforcement, aggregate gate, and absence of `continue-on-error`.

- [ ] **Step 2: Implement portable post-merge runner**

The runner composes final WP-B contracts, isolated regressions, source closure A+B, provenance, security, protocol, Schema, and platform-core checks without modifying the worktree.

- [ ] **Step 3: Implement main identity verifier**

On push, require `HEAD == origin/main`. On PR, verify the exact candidate Head and closure receipt ancestry without claiming post-merge success.

- [ ] **Step 4: Run workflow contracts and syntax**

```bash
node --check tools/architecture-closure-v2/run-wp-b-post-merge-contracts.js
node --check tools/architecture-closure-v2/verify-wp-b-post-merge.js
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/postMergeWorkflowContract.test.js
```

- [ ] **Step 5: Commit permanent validation**

```bash
git add .github/workflows/wp-b-post-merge-validation.yml \
  tools/architecture-closure-v2/run-wp-b-post-merge-contracts.js \
  tools/architecture-closure-v2/verify-wp-b-post-merge.js \
  backend/tests/architectureClosureV2/wpB/postMergeWorkflowContract.test.js
git commit -m "ci(acv2): add permanent WP-B post-merge validation"
```

---

### Task 10: Independent Review Gate 3, Closure Receipt, and Final Seal

**Files:**
- Create: `docs/architecture/YANCE_ACV2_WP_B_SOURCE_REVIEW_ZH.md`
- Create: `governance/architecture-closure-v2/wp-b-closure.json`
- Create: `tools/architecture-closure-v2/verify-wp-b-closure.js`
- Create: `backend/tests/architectureClosureV2/wpB/finalClosureIntegrity.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/finalClosureSeal.test.js`
- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json`
- Modify: `.github/workflows/wp-b-post-merge-validation.yml`

**Interfaces:**
- `verifyWpBClosure(repositoryRoot, options) -> { ok, reviewedHead, changedFileCount, changedFileSetSha256, violations }`.
- Final status is `CLOSED_PENDING_MAIN_POST_MERGE_VALIDATION`.

- [ ] **Step 1: Freeze the reviewed implementation Head**

Compute the exact changed-file list relative to baseline `e53bf933a8f4e3273e515587d917433df24d6feb`, sorted unique SHA-256, and critical source blob SHAs. Run all formal workflows on this exact Head before writing approval.

- [ ] **Step 2: Perform source review and record findings**

Review authorization precedence, M1/M2 seal ancestry, every inventory terminal state, direct-call reachability, retry/recovery ownership, six-operation registry, Schema 23, leak scans, SBOM/NOTICE/provenance, Ubuntu/Windows evidence, and permanent workflow policy. Any Blocker/High finding returns to RED/GREEN remediation before approval.

- [ ] **Step 3: Write the PENDING review receipt and strict verifier**

The receipt binds reviewed Head, file count/digest, exact workflow run/job/artifact IDs, critical blobs, independent findings, and all closed downstream flags. The verifier authenticates remote workflow evidence when `--remote` is supplied.

- [ ] **Step 4: Add mutation and exact-delta seal contracts**

Reject changes to reviewed Head, baseline, file digest, inventory counts, workflow evidence, source-review result, SBOM hash, post-merge requirement, or downstream flags. From reviewed Head to Seal Head, allow only the exact final review workflow/test/verifier/receipt paths.

- [ ] **Step 5: Run staging seal workflows**

Require all final workflow groups GREEN on one staging Head: M3 authorization, WP-B validation, M2 integrity/contracts, WP0, M1 integrity, M2 authorization, WP-A architecture/main, and WP-B post-merge candidate validation.

- [ ] **Step 6: Publish SEALED closure receipt**

Set:

```json
{
  "status": "CLOSED_PENDING_MAIN_POST_MERGE_VALIDATION",
  "wpBFocusedGreen": true,
  "wpARegressionGreen": true,
  "ubuntuMatrixGreen": true,
  "windowsMatrixGreen": true,
  "sourceClosureViolationCount": 0,
  "legacyWpBCallablePathCount": 0,
  "uncertainOutcomeBlindRetryCount": 0,
  "secretLeakCount": 0,
  "businessContentLeakCount": 0,
  "openSourceAdoptionGate": "APPROVED",
  "independentSourceReview": "APPROVED",
  "postMergeValidationRequired": true,
  "readyForPromotion": false,
  "wpCAuthorized": false,
  "mergeAuthorized": false,
  "productionUseAuthorized": false,
  "formalRelease": false,
  "publish": false
}
```

- [ ] **Step 7: Verify final evidence Head**

```bash
node tools/architecture-closure-v2/verify-wp-b-closure.js --require-head "$(git rev-parse HEAD)" --remote
node tools/architecture-closure-v2/source-closure-scan.js --wp A
node tools/architecture-closure-v2/source-closure-scan.js --wp B
git diff --check main...HEAD
git status --porcelain=v1 --untracked-files=all
```

Expected: all verifiers GREEN, clean worktree, PR remains Draft/open/unmerged, and no downstream authority is opened.
