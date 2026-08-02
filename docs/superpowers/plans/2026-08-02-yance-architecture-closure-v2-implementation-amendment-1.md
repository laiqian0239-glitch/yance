# Yance Architecture Closure V2 Implementation Plan — Independent Review Amendment 1

- Document type: `NORMATIVE_IMPLEMENTATION_PLAN_AMENDMENT`
- Amendment ID: `ACV2-IPA-001`
- Base plan: `docs/superpowers/plans/2026-08-02-yance-architecture-closure-v2-implementation.md`
- Reviewed plan commit: `8345527df1567d692ebf26ab1344cbac53475cc8`
- Status: `APPROVED_NORMATIVE_AMENDMENT`
- Production code changed: `false`

## 1. Precedence

This amendment is part of the implementation plan. It takes precedence where it adds or tightens a rule. It does not authorize WP-A by itself; authorization requires the independent implementation-plan review report and governance update.

## 2. Review Findings Closed by This Amendment

| ID | Level | Plan gap | Required closure |
|---|---|---|---|
| IPR-P0-01 | P0 | The plan created a persistent host lease in Schema 21 but did not freeze the bootstrap order needed to create/acquire that lease before normal migrations and business recovery | Define a two-layer bootstrap protocol: sidecar exclusion, restricted DB bootstrap, host CAS, then normal migrations and business access |
| IPR-P0-02 | P0 | The plan prohibited non-host writable brokers but did not fully prohibit direct read-only access to the live primary WAL database by workers/utilities | Non-host processes cannot open the live primary DB at all; they use command/query API or verified snapshots |
| IPR-P1-01 | P1 | “No external I/O in transaction” was an invariant without a concrete enforcement mechanism | Add transaction context, guarded external boundaries, static scan, runtime negative tests, and duration telemetry |
| IPR-P1-02 | P1 | Per-WP branch authorization and predecessor Head pinning were described in prose only | Add a machine-readable authorization manifest and exact branch/ref conditions |
| IPR-P1-03 | P1 | Compatibility projector catch-up, lag, duplicate delivery, and backpressure behavior were not fully specified | Add versioned projector lease/checkpoint/CAS and cutover lag requirements |
| IPR-P1-04 | P1 | Schema 21 migration verification did not explicitly require clean install, upgrade from Schema 20, interrupted migration recovery, and downgrade refusal | Add mandatory migration matrix |

## 3. Normative WP-A Bootstrap Protocol

Task A1 is amended with the following required order:

```text
1. Validate process role and database path.
2. Acquire existing sidecar ownership/claim mutex fail-closed.
3. Open the primary DB through a restricted BOOTSTRAP capability.
4. Begin an immediate short transaction.
5. Create/verify only the checksum-pinned AuthorityWriteHost lease objects needed for host acquisition.
6. Atomically acquire/increment hostGeneration and fencingToken by CAS.
7. Commit host acquisition.
8. Bind the broker and every later transaction to that exact host capability.
9. Apply normal forward migrations, including the rest of Schema 21.
10. Start recovery, projectors, routes, workers, schedulers, and readiness only after the host capability and migrations are valid.
```

### 3.1 Bootstrap capability restrictions

The bootstrap capability may only:

- open the configured primary DB path;
- read SQLite metadata and current schema version;
- create/verify the host lease bootstrap objects;
- acquire the host row by CAS;
- apply registered forward migrations after acquisition;
- checkpoint/close on failure.

It may not execute business commands, recovery, projections, external I/O, background jobs, account canonicalization, or arbitrary SQL from a caller.

### 3.2 Failure handling

Any failure before step 7 closes the DB and releases/quarantines the startup claim without declaring readiness. Any failure after step 7 but before normal startup records a host-owned startup failure receipt, closes the broker, and releases the sidecar lease. A second process never treats a partially initialized host as permission to bypass fencing.

### 3.3 Required tests

Add to Task A1:

- fresh DB with no lease table;
- Schema 20 DB upgraded to Schema 21;
- crash after sidecar claim but before DB open;
- crash after DB open but before host CAS commit;
- crash after host CAS but before remaining migrations;
- corrupt/bootstrap-object checksum mismatch;
- two processes racing to create/acquire the initial lease;
- old host attempting a normal migration or command after takeover.

## 4. Primary SQLite Access Boundary

Task A1 and Task A6 are amended:

- Only `AuthorityWriteHost` may open the live primary SQLite database, whether read-write or read-only.
- Renderer, model worker, channel worker, media worker, UAT probe, diagnostic utility, export utility, and secondary backend process cannot call `DatabaseSync` on the primary path and cannot obtain a store/broker handle.
- Non-host reads use a versioned query API served by the host.
- Offline analysis/export may use a verified immutable snapshot created by `AuthorityWriteHost`; the snapshot path, source ledger sequence, hash, and expiry are recorded.
- Any exceptional direct read-only consumer must be explicitly registered in the authority registry, use a snapshot rather than the live WAL files, and pass an independent review. There is no default exception.

Required negative tests include direct `DatabaseSync` construction, copied store modules, dynamic `require`, worker environment spoofing, alternate relative/canonical paths to the same DB, and access to `-wal`/`-shm` files.

## 5. Enforceable No-External-I/O Transaction Context

Task A3 is amended to create:

- `backend/services/authorityTransactionContext.js`
- `backend/services/externalIoBoundaryGuard.js`
- `backend/tests/architectureClosureV2/wpA/noExternalIoInTransaction.test.js`

### 5.1 Runtime mechanism

- Use `AsyncLocalStorage` to mark an active authority write transaction with command ID, authority, start time, host generation, and fencing token.
- All Yance-owned external boundaries must call `assertExternalIoAllowed(kind)` before network, platform SDK, provider SDK, child-process execution, filesystem transfer, or user-wait operations.
- The guard throws `AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN` when called in an active write transaction.
- Database commit/rollback clears the context before post-commit notification or outbox dispatch.

### 5.2 Static and adversarial enforcement

The source-closure scan must identify known external boundary imports inside coordinator command handlers and require them to be wrapped. Tests inject guarded HTTP, provider, channel, filesystem, child process, and timer-wait calls. A direct unguarded Node primitive found during review is a blocker and must be routed through the public boundary; it cannot be allowlisted merely because the current caller is trusted.

### 5.3 Telemetry gate

Record transaction duration and classify transactions above the reviewed threshold as architecture warnings. A threshold is diagnostic only; exceeding it never converts a failed transaction into success.

## 6. Machine-Readable Work-Package Authorization

The planning stage must create:

`governance/architecture-closure-v2/implementation-plan-authorization.json`

It contains:

```text
planCommit
planAmendmentCommit
planReviewCommit
approvedParentHead
currentAuthorizedWorkPackage
allowedBranch
requiredBaseRef
allowedProductionPaths
requiredRedEvidence
requiredWorkflowJobs
nextWorkPackageLocked
pr4MustRemainDraft
```

Rules:

- After plan approval, `currentAuthorizedWorkPackage=WP-A` only.
- The WP-A branch must be created from `approvedParentHead` exactly and target the governance anchor branch.
- A moved parent Head invalidates the authorization until independently re-pinned.
- WP-B through WP-H remain locked even if their plan text exists.
- Each work-package closure replaces the authorization with the next single WP; it does not unlock all remaining packages.

## 7. Compatibility Projector Protocol

Tasks A3, C3, and G1 are amended:

- Every compatibility projector has `projectorId`, `projectorVersion`, `ledgerSequence`, `leaseOwner`, `generation`, `fencingToken`, `outputHash`, `lag`, and `updatedAt`.
- Projection is idempotent by event ID and uses database CAS for checkpoint advancement.
- A projector may retry a committed event, but cannot skip a failed sequence and advance the checkpoint.
- Duplicate delivery, restart, stale projector owner, partial batch rollback, and output-hash mismatch are mandatory tests.
- Read cutover requires lag within the reviewed threshold for the entire continuous acceptance window and a replay hash matching the authoritative projection.
- Backpressure pauses ingestion or reports scoped degradation according to policy; it cannot silently discard events or switch back to a legacy writer.

## 8. Mandatory Migration Verification Matrix

Every Architecture Closure V2 schema work package must include:

1. clean install to the target schema;
2. upgrade from the immediately previous schema;
3. repeated migration idempotency;
4. checksum mismatch fail-closed;
5. crash before migration transaction;
6. crash during migration transaction;
7. crash after migration commit but before completion receipt;
8. backup and restore verification;
9. opening a newer schema with an older binary fails fast;
10. full ledger replay and projection hash after migration.

For WP-A, the source fixture is Schema 20. Historical migration files 1–20 remain immutable.

## 9. Official Reference Constraints Used in Review

- SQLite transactions and WAL behavior justify short transactions and one coordinated writer; busy handling is not a substitute for authority ownership.
- Temporal Event History, replay/versioning, Activity idempotency, heartbeat, and asynchronous completion are used only as architectural invariants for durable execution; Yance does not introduce a Temporal server/runtime.
- Project-specific Chatwoot, Activepieces, Dify, Langfuse, Open WebUI, AnythingLLM, and Mem0 behavior is not assumed where official evidence is absent. Yance's frozen design and executable tests remain the authority for those boundaries.

Official references:

- https://sqlite.org/lang_transaction.html
- https://sqlite.org/wal.html
- https://sqlite.org/backup.html
- https://docs.temporal.io/encyclopedia/event-history
- https://docs.temporal.io/activity-definition
- https://docs.temporal.io/develop/safe-deployments

## 10. Amended Review Gate

The implementation plan can be approved only when all are true:

```text
bootstrapProtocolDeterministic=true
livePrimaryDbAccessHostOnly=true
externalIoTransactionGuardSpecified=true
workPackageAuthorizationMachineReadable=true
compatibilityProjectorProtocolComplete=true
migrationVerificationMatrixComplete=true
```

Approval authorizes only creation of the WP-A child branch and WP-A RED tests. It does not authorize WP-B, Gate 1, candidate packaging, merge, promotion, or release.
