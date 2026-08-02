# WP-A A8 Source Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every registered and unregistered WP-A primary SQLite writer/fallback path so the unchanged fail-closed source scanner reports exactly zero violations.

**Architecture:** Production primary SQLite is acquired once by `AuthorityWriteHost`, attached once to `SqliteConnectionBroker`, and consumed through capability-bound runtime/repository interfaces. Read-only inspection of legacy databases and immutable backup snapshots uses explicit read-only adapters that can never open or mutate the live primary database. Legacy facades either delegate to the canonical transaction/ledger/identity authority or are removed from the production graph.

**Tech Stack:** Node.js 22, `node:test`, `node:sqlite`, CommonJS, GitHub Actions Ubuntu/Windows matrices.

## Global Constraints

- No scanner exclusion, marker weakening, ignored path, permissive default, skipped test, timeout increase, or allowlist-only closure is permitted.
- Every production primary write must require a real current `AuthorityWriteHost` capability and be fenced by generation/token checks.
- Offline legacy source inspection must be read-only and path-separated from the live primary database.
- PR #5 remains Draft; `readyForPromotion=false`, `formalRelease=false`, `publish=false`.
- A8 does not authorize WP-B through WP-H implementation.

---

### Task 1: Freeze A8 RED and exact task scope

**Files:**
- Create: `governance/architecture-closure-v2/wp-a-a8-task-contract.json`
- Create: `backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js`
- Modify: `.github/workflows/acv2-wp-a.yml`
- Modify: `governance/architecture-closure-v2/wp-a-task-scope-chain.json`
- Create after CI RED: `governance/architecture-closure-v2/wp-a-a8-red-evidence.json`

**Interfaces:**
- Consumes: `scanRegisteredSources({ wp: 'A' })`.
- Produces: a deterministic contract requiring `violationCount === 0`, `violations === []`, and `ok === true`.

- [ ] **Step 1: Write the failing zero-violation contract**

```js
const report = scanner.scanRegisteredSources({ wp: 'A' });
assert.equal(report.counts.REGISTRY_INVALID || 0, 0);
assert.deepEqual(report.violations, []);
assert.equal(report.violationCount, 0);
assert.equal(report.ok, true);
```

- [ ] **Step 2: Run RED on Ubuntu and Windows**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js`

Expected: FAIL with the real non-empty violation array; no module-load or syntax failure.

- [ ] **Step 3: Record immutable RED evidence**

Capture the exact Head, workflow run/job IDs, scanner counts, all violating paths, and `readyForPromotion=false` in `wp-a-a8-red-evidence.json`.

- [ ] **Step 4: Commit exact scope chain**

The A8 entry is `RED_LOCKED`, parent task A7 is `CLOSED`, paths are exact, and changed-file count/SHA-256 match `parentGovernanceHead..HEAD`.

### Task 2: Make desktop boot the sole live primary acquisition path

**Files:**
- Modify: `backend/desktopHostedEntry.js`
- Modify: `backend/services/authorityWriteHost.js`
- Modify: `backend/lib/sqliteConnectionBroker.js`
- Test: `backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js`
- Test: `backend/tests/architectureClosureV2/wpA/authorityWriteHostProcessMatrix.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/sourceClosureBootAuthority.test.js`

**Interfaces:**
- Consumes: `acquireAuthorityWriteHost({ dbPath, startupNonce })`.
- Produces: broker construction requiring `authorityWriteHostCapability`; desktop boot closes host/broker together on every failure path.

- [ ] **Step 1: Add a failing boot-order test**

Assert that broker construction cannot occur until `acquireAuthorityWriteHost` returns a genuine capability and that failed acquisition leaves no broker/global runtime state.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/sourceClosureBootAuthority.test.js`

Expected: FAIL because `desktopHostedEntry.js` still constructs the broker directly.

- [ ] **Step 3: Refactor boot ownership**

Acquire the host first, pass its capability into `createSqliteConnectionBroker`, attach the broker store, and close both resources in reverse order on runtime/server failure.

- [ ] **Step 4: Verify GREEN and process competition**

Run the new test plus `authorityWriteHost.test.js` and `authorityWriteHostProcessMatrix.test.js`; all must pass without timeout changes.

### Task 3: Remove process-local raw-store fallback and raw-store provider

**Files:**
- Modify: `backend/lib/r32StoreSingleton.js`
- Modify: `backend/repositories/storeProvider.js`
- Modify: `backend/lib/sqliteDocumentStore.js`
- Modify: `backend/store/adapters/SqliteStorePersistenceAdapter.js`
- Create: `backend/tests/architectureClosureV2/wpA/primaryStoreCapabilityBoundary.test.js`

**Interfaces:**
- Consumes: installed `SqliteConnectionBroker` and capability-bound store/read snapshot interfaces.
- Produces: `getR32Store()` fails with `SQLITE_BROKER_NOT_READY` when no broker exists; no module constructs a fallback store.

- [ ] **Step 1: Add failing fallback and injection tests**

Prove that missing broker fails closed, `storeProvider` exposes no raw-store getter, and document/persistence adapters require an injected capability-bound repository.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/primaryStoreCapabilityBoundary.test.js`

Expected: FAIL on the current fallback constructor and implicit `getR32Store()` dependencies.

- [ ] **Step 3: Remove fallback and inject repositories**

Delete process-local store construction, replace `getStore` with bounded snapshot/command interfaces, and require constructor injection for document and persistence adapters.

- [ ] **Step 4: Verify GREEN**

Run the new contract and existing store/SQLite ownership regressions.

### Task 4: Move legacy imports behind explicit offline-source/live-target authority

**Files:**
- Modify: `backend/services/legacyJsonMigrator.js`
- Modify: `backend/migrations/legacySqliteMigrator.js`
- Modify: `backend/runtime/RuntimeAuthorityMigrationCoordinator.js`
- Create: `backend/services/offlineSqliteSourceReader.js`
- Create: `backend/tests/architectureClosureV2/wpA/migrationAuthorityBoundary.test.js`

**Interfaces:**
- Consumes: injected live target command gateway or capability-bound store; `OfflineSqliteSourceReader.openReadOnly(path)` for non-primary source files.
- Produces: migration functions that never construct the live target store and reject source paths equal to the live primary path.

- [ ] **Step 1: Add failing path-separation tests**

Prove that migrators reject an uninjected target, reject source/target identity, and cannot open the live primary path through the offline reader.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/migrationAuthorityBoundary.test.js`

Expected: FAIL because both legacy migrators construct target stores directly.

- [ ] **Step 3: Introduce offline reader and injected target authority**

Centralize read-only `DatabaseSync` construction in the offline reader, require a target authority dependency, and keep fingerprinting/import idempotency unchanged.

- [ ] **Step 4: Verify GREEN**

Run migration boundary tests and existing migration/bootstrap contracts.

### Task 5: Remove legacy domain-event append ownership

**Files:**
- Modify: `backend/services/domainEventLogService.js`
- Modify: `backend/repositories/platformCoreRepository.js`
- Modify: `backend/services/domainEventProjectionAuthority.js`
- Modify: `backend/services/canonicalEventLedgerAuthority.js`
- Test: `backend/tests/architectureClosureV2/wpA/domainEventCompatibilityFacade.test.js`
- Test: `backend/tests/architectureClosureV2/wpA/canonicalEventLedgerAuthority.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/sourceClosureLedgerBoundary.test.js`

**Interfaces:**
- Consumes: `CanonicalEventLedgerAuthority` and `AuthorityTransactionCoordinator`.
- Produces: compatibility facade with no independent coordinator/repository ownership; projector consumes committed `ledgerSequence` and scoped projector capability.

- [ ] **Step 1: Add failing source/runtime tests**

Assert that `PlatformCoreRepository` has no public domain-event insert method, the compatibility facade binds the canonical coordinator, and projection receipts require a committed ledger sequence.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/sourceClosureLedgerBoundary.test.js`

Expected: FAIL on `insertDomainEvent`, missing coordinator binding, and legacy projection writes.

- [ ] **Step 3: Refactor repository and projector**

Remove the public append method, route all event creation through the canonical coordinator, and require ledger-sequence/projector-version fencing for projection mutation.

- [ ] **Step 4: Verify GREEN**

Run A3, A4, compatibility, append-only, and new ledger-boundary tests.

### Task 6: Remove route-level and repository-level raw database acquisition

**Files:**
- Modify: `backend/routes/workspace.js`
- Modify: `backend/store/contactIdentityConfirmationRepository.js`
- Modify: `backend/store/contactMergeRepository.js`
- Modify: `backend/store/relationshipKeyNodeRepository.js`
- Modify: `backend/runtime/AppRuntimeComposition.js`
- Create: `backend/tests/architectureClosureV2/wpA/workspaceIdentityCommandBoundary.test.js`

**Interfaces:**
- Consumes: runtime identity/relationship command gateway injected into the router.
- Produces: routes that submit commands and never obtain `DatabaseSync`/raw store; repositories receive transaction-scoped capabilities only.

- [ ] **Step 1: Add failing router boundary test**

Load the router with a fake command gateway and assert no call to `getR32Store`, no schema mutation at request time, and version conflict behavior is preserved.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/workspaceIdentityCommandBoundary.test.js`

Expected: FAIL because the router currently calls `getR32Store().db`.

- [ ] **Step 3: Inject command handlers from runtime composition**

Move repository construction/schema preparation to boot-time composition and make route handlers call bounded commands.

- [ ] **Step 4: Verify GREEN**

Run the new contract plus identity/merge/key-node service regressions.

### Task 7: Isolate ownership probes and backup snapshots from live authority

**Files:**
- Modify: `backend/lib/sqliteOwnership.js`
- Modify: `backend/services/backupService.js`
- Create: `backend/services/readOnlySqliteSnapshotAuthority.js`
- Create: `backend/tests/architectureClosureV2/wpA/readOnlySqliteBoundary.test.js`

**Interfaces:**
- Consumes: immutable source path receipt and explicit destination path for snapshot operations.
- Produces: read-only inspection/snapshot authority that rejects live-primary writes and never returns a writable database handle.

- [ ] **Step 1: Add failing read-only boundary tests**

Prove source handles are query-only, destination verification is read-only, live primary identity is checked, and no general `DatabaseSync` constructor remains in backup or ownership policy modules.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/readOnlySqliteBoundary.test.js`

Expected: FAIL on direct constructors in `backupService.js` and ownership inspection code.

- [ ] **Step 3: Centralize read-only SQLite opening**

Use the snapshot authority for backup and legacy inspection; keep sidecar ownership logic pure and pass all SQLite probing through an injected reader.

- [ ] **Step 4: Verify GREEN**

Run backup integrity, ownership/fencing, and new boundary tests.

### Task 8: Final zero-writer closure and governance receipt

**Files:**
- Modify: `governance/architecture-closure-v2/authority-registry.json`
- Modify: `governance/architecture-closure-v2/wp-a-baseline.json`
- Modify: `backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js`
- Modify: `governance/architecture-closure-v2/wp-a-a8-task-contract.json`
- Modify: `governance/architecture-closure-v2/wp-a-task-scope-chain.json`
- Create: `docs/architecture/YANCE_ACV2_WP_A_A8_SOURCE_REVIEW_ZH.md`
- Create: `governance/architecture-closure-v2/wp-a-a8-closure.json`

**Interfaces:**
- Consumes: unchanged source scanner and all Task 2–7 contracts.
- Produces: `A8=CLOSED`, zero WP-A violations, and an immutable final verification receipt.

- [ ] **Step 1: Update registry states only after executable boundaries pass**

Every WP-A entry becomes `CLOSED` with markers reflecting actual authority ownership; legitimate offline/read-only components are registered with explicit non-primary path and read-only contracts.

- [ ] **Step 2: Run the unchanged scanner**

Run: `node tools/architecture-closure-v2/source-closure-scan.js --wp A`

Expected: exit 0, `violationCount: 0`, `counts: {}`, `violations: []`, `ok: true`.

- [ ] **Step 3: Run all A1–A8 and legacy regressions**

Run the full ACV2 Ubuntu/Windows matrix, WP0 product gate, and sealed-export jobs. All jobs except no job must be skipped or tolerated; source closure itself must succeed.

- [ ] **Step 4: Independent source review**

Record open P0/P1, exact reviewed code Head, workflow/job IDs, and confirm the scanner was not weakened.

- [ ] **Step 5: Close A8 without promotion**

Write the closure receipt, set the task chain to `A8_CLOSED`, keep PR Draft, and leave next-work-package authorization false.
