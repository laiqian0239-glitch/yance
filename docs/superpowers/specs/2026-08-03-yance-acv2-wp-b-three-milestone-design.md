# Yance Architecture Closure V2 — WP-B Three-Milestone Design

- Document status: `PROPOSED_FOR_USER_REVIEW`
- Work package: `WP-B — Durable Execution and External Action Outbox`
- Repository: `laiqian0239-glitch/yance`
- Baseline branch: `main`
- Baseline Head: `e53bf933a8f4e3273e515587d917433df24d6feb`
- Implementation branch: `acv2/wp-b-durable-execution-outbox`
- Target schema version: `23`
- Formal release: `false`
- Publish: `false`
- WP-C authorization: `false`

## 1. Decision

WP-B remains one bounded work package but is executed through three core Milestones instead of B0–B8 independent handoffs.

The three Milestones are:

1. **Contract and Core Foundation** — freeze the complete state model, Schema 23 migration, public interfaces, open-source adoption boundary, and all architectural RED contracts; then implement the shared core to integrated GREEN.
2. **Business Flow and Recovery Closure** — migrate the mandatory operation kinds, complete dispatch/reconciliation/recovery, and prove crash, cancellation, deadline, lease takeover, stale-owner, duplicate-dispatcher, and uncertain-remote-outcome scenarios.
3. **Source Closure and Gates** — remove or block old writers/recovery/fallbacks, run the final Linux/Windows and regression matrices, produce provenance/SBOM and machine-readable closure evidence, complete independent review, and activate permanent post-merge validation.

This reduces formal review handoffs from eight to three. It does not reduce TDD, commit isolation, CI execution, fault injection, source review depth, or database enforcement.

## 2. Problem Statement

The current `DurableExecutionAuthority` is useful but not sufficient for WP-B closure:

- transition eligibility is checked in JavaScript before an unconditional `UPDATE ... WHERE execution_id=?`;
- generation and owner checks are not part of the SQL mutation condition;
- there is no database-authoritative fencing token or lease expiry;
- idempotency keys are not bound to canonical command-content hashes;
- timestamps are generated independently inside methods instead of being explicit command authority values;
- returned executions, histories, intents, attempts, and receipts are not recursively frozen;
- external action intent, attempt, receipt, and reconciliation do not yet form one durable protocol;
- crash after remote success but before local receipt can still become a duplicate external side effect unless the outcome is reconciled first;
- legacy recovery, direct provider/platform calls, timers, and fallback paths are not yet closed under one inventory.

WP-B must replace these weaknesses at the shared authority layer. Retry loops, longer timeouts, caller bypasses, warning-only guards, dual writes, and test exclusions are prohibited.

## 3. Schema Sequence Correction

The original frozen plan assigned Schema 22 to WP-B. Schema 22 is now permanently occupied by `022_architecture_closure_v2_wp_a_integrity`.

The monotonic sequence is therefore:

```text
WP-A base                 Schema 21
WP-A integrity closure    Schema 22
WP-B                      Schema 23
WP-C                      Schema 24
WP-D                      Schema 25
WP-E                      Schema 26
WP-F                      Schema 27
WP-G                      Schema 28
WP-H                      no business schema by default
```

Historical migration IDs and checksums are immutable. WP-B creates a new forward-only, checksum-pinned migration and never edits migrations 001–022.

## 4. Open-Source Adoption Strategy

### 4.1 XState

Adoption mode: `DIRECT_DEPENDENCY_BEHIND_YANCE_AUTHORITY_BOUNDARY`.

Allowed responsibilities:

- define the pure WP-B lifecycle graph;
- reject illegal state transitions before command submission;
- generate model-based transition paths for RED and regression tests;
- provide deterministic state-machine inspection without storage or side effects.

Forbidden responsibilities:

- database persistence;
- idempotency ownership;
- leases, generation, owner, or fencing authority;
- retry scheduling authority;
- external I/O;
- receipt issuance;
- business timestamps.

The exact package version must be pinned in the lockfile and in the open-source adoption registry before production use. License, transitive dependency, vulnerability, and Windows compatibility checks are mandatory.

### 4.2 Temporal

Adoption mode: `ARCHITECTURE_AND_TEST_SEMANTICS_ONLY`.

WP-B adopts the mature concepts of workflow history, activity attempts, heartbeat, cancellation, deadline, retry policy, stale worker rejection, deterministic recovery, continue-as-new/history rolling, and uncertain remote outcomes.

Temporal Server is not embedded. WP-B remains a local Electron/Node/SQLite architecture and does not introduce PostgreSQL, Redis, Docker, or a second runtime service.

### 4.3 Provenance Registry

Milestone 1 creates or extends a machine-readable registry recording:

- upstream repository;
- exact version or commit;
- license and excluded enterprise paths;
- adoption mode;
- imported source paths when applicable;
- target files;
- allowed and forbidden responsibilities;
- upstream tests executed;
- Yance RED contracts;
- vulnerability review result;
- NOTICE and SBOM disposition.

No third-party source or package may enter production code before its registry record is valid.

## 5. Target Architecture

```text
Versioned command with explicit authority timestamp
  → AuthorityWriteHost capability and fencing token
  → AuthorityTransactionCoordinator
  → DurableExecutionAuthority CAS transition
  → CanonicalEventLedger event + command receipt
  → ExternalActionIntent committed with no external I/O
  → Dispatcher CAS claim
  → ExternalActionAttempt persisted before physical call
  → Provider/platform call outside transaction
  → ExternalActionReceipt or UNCERTAIN_REMOTE_OUTCOME
  → Reconciliation protocol
  → terminal durable execution receipt
```

Only `AuthorityWriteHost` may commit primary database state. A dispatcher or worker may perform an external action only after it owns a current persisted claim. Its result cannot commit unless execution ID, allowed state, state version, generation, owner, fencing token, and claim identity all still match.

## 6. Core Components

### 6.1 Pure Lifecycle Contract

A pure module defines the canonical states and allowed transitions. The minimum lifecycle is:

```text
CREATED
→ SCHEDULED
→ CLAIMED
→ RUNNING
→ WAITING_REMOTE
→ SUCCEEDED | FAILED | RETRY_SCHEDULED | CANCEL_REQUESTED
→ CANCELLED | DEAD_LETTERED
```

`UNCERTAIN_REMOTE_OUTCOME` is an explicit nonterminal reconciliation state and is never represented as ordinary failure.

The lifecycle module performs no database, clock, network, filesystem, logger, event-bus, or global-state access.

### 6.2 DurableExecutionAuthority V2

The authority is upgraded in place rather than creating a second durable execution truth.

Each execution stores at least:

- execution ID, operation kind, trace ID;
- idempotency key and canonical command-content SHA-256;
- current state and state version;
- generation, owner ID, host fencing token;
- claim ID, lease start, lease expiry, heartbeat sequence;
- explicit created, scheduled, claimed, deadline, cancellation, updated, and terminal authority timestamps;
- retry-policy version, attempt counters, next attempt time;
- remote request ID when known;
- cancellation receipt ID, terminal receipt ID, late-result receipt ID;
- checkpoint/history segment version;
- redacted metadata hash and classification version.

Every transition is one SQL mutation whose `WHERE` clause includes all required concurrency facts. Affected row count must equal exactly one. Application-level prechecks may improve error reporting but never establish authority.

### 6.3 ExternalActionOutboxAuthority

The outbox owns four append-oriented facts:

1. `ExternalActionIntent` — immutable description of the requested external side effect.
2. `ExternalActionAttempt` — persisted physical-call attempt and claim identity.
3. `ExternalActionReceipt` — provider/platform result or locally proven absence.
4. `ExternalOutcomeReconciliation` — lookup/query/manual resolution of uncertain outcomes.

Intent and execution are linked by stable IDs and content hashes. Every physical provider/platform call has exactly one persisted attempt before the call begins.

### 6.4 Dispatcher

The dispatcher:

- reads committed intents;
- claims through database CAS;
- persists the attempt before I/O;
- performs I/O outside all write transactions;
- records the provider/platform request ID as soon as available;
- persists a receipt when the result is certain;
- persists `UNCERTAIN_REMOTE_OUTCOME` when local certainty is lost;
- never retries an uncertain action until reconciliation proves remote absence.

### 6.5 Reconciliation Protocol

The common protocol supports:

- provider idempotency lookup;
- provider request lookup;
- channel message/receipt query;
- media transfer query;
- history-sync checkpoint comparison;
- session restoration probe;
- explicit human resolution when remote absence or success cannot be proven.

Manual resolution is a versioned receipt with actor, reason code, evidence reference, and authority timestamp. It is not an in-place database edit.

## 7. Hard Acceptance Criteria

These criteria apply from the first RED commit and cannot be deferred to independent review.

### 7.1 Database-Enforced CAS and Fencing

- Every state transition conditions on execution ID, allowed prior state, state version, generation, owner, host fencing token, and claim/lease facts required by that transition.
- A stale worker, stale dispatcher, old host generation, expired lease, or duplicate terminal result changes zero rows and fails closed.
- No read/check followed by unconditional update is accepted as authority.
- Terminal receipts, attempts, history events, and reconciliations are append-only at the database layer.

### 7.2 Canonical Hash Binding

- Every idempotency key is bound to a lowercase 64-character SHA-256 of a versioned canonical command payload.
- Same key plus same hash returns the original receipt.
- Same key plus different hash fails with an explicit conflict code.
- Intent, attempt, receipt, and reconciliation records are linked by stable IDs and verified hashes.
- Hash shape and supported hash version are enforced by CHECK constraints and/or triggers, not only JavaScript.

### 7.3 Explicit Authority Time

- Business timestamps are explicit command inputs issued by the authority clock.
- No WP-B table uses `CURRENT_TIMESTAMP` or an implicit database default for business truth.
- One command uses one authority timestamp unless the protocol explicitly records a later physical observation.
- Tests cover clock rollback, forward jump, equal timestamps, lease expiry boundaries, and restart under a changed wall clock.

### 7.4 Recursive Immutability

- Public command, execution snapshot, retry policy, intent, attempt, receipt, reconciliation, cancellation receipt, and recovery decision objects are recursively frozen.
- Nested mutation attempts cannot alter authority results or later persistence.
- Freezing is verified in strict-mode tests at multiple depths and arrays.

### 7.5 Uncertain Outcome Safety

- Crash or process loss after the physical call begins but before a trusted local receipt never becomes ordinary retryable failure.
- Automatic retry is forbidden until reconciliation proves remote absence.
- Remote success found during reconciliation produces one receipt and one terminal transition.
- A late result from a stale attempt is stored only as a late-result receipt and cannot overwrite current truth.

### 7.6 No External I/O in Transactions

- Network, provider SDK, platform SDK, filesystem transfer, sleeps, timers awaiting remote work, and user waits are unavailable in coordinator callbacks.
- The command transaction may validate, append ledger/payload, update authoritative projections, create intent, checkpoint, and issue command receipts only.
- Tests instrument forbidden capabilities and fail the transaction when they are touched.

### 7.7 Legacy Closure

- Every old task runner, startup recovery, scheduler, retry helper, timer, provider/platform direct call, fallback, and direct table writer is inventoried before migration.
- A new path is not enabled while the corresponding old writer remains callable.
- Compatibility facades delegate to one authority and cannot issue a second business write.
- Removal/blocking conditions are explicit and are verified by static scan plus runtime bypass probes.

### 7.8 Data and Secret Safety

- API keys, OAuth tokens, cookies, session material, chat bodies, prompt bodies, and binary payloads are excluded from execution history, outbox metadata, receipts, evidence, logs, and artifacts.
- Secret references may contain only reference ID, scope, generation, and verification receipt.
- Leak scans run across source, logs, generated evidence, and workflow artifacts.

## 8. Milestone 1 — Contract and Core Foundation

### Scope

- freeze the operation and external-action call-site inventory;
- create the open-source adoption registry entry for XState and Temporal semantics;
- define the pure lifecycle contract and error/reason-code registry;
- create Schema 23 migration and migration integrity contract;
- upgrade execution tables and add outbox/attempt/receipt/reconciliation/checkpoint objects;
- add database triggers, indexes, hash constraints, append-only guards, and CAS statements;
- write the complete WP-B architectural RED suite before production implementation;
- implement the pure state machine, authority timestamp protocol, deep-freeze utility boundary, DurableExecutionAuthority V2 core, and ExternalActionOutboxAuthority core;
- reach one integrated Milestone 1 GREEN.

### RED suite must cover

- lifecycle graph and illegal transitions;
- database CAS, stale owner/generation/fencing/claim rejection;
- lease and clock-jump matrix;
- idempotency hash same/different content;
- explicit timestamp persistence;
- recursive freeze;
- append-only history, attempts, receipts, and reconciliation;
- transaction I/O prohibition;
- intent-before-attempt and attempt-before-call;
- uncertain outcome creation and blind-retry rejection;
- migration checksum, reopen, old-schema upgrade, future-schema fail-fast;
- source inventory completeness and third-party provenance validity.

### Review Gate 1

Independent design/contract review verifies the full WP-B model, Schema 23, RED evidence, source scope, open-source boundary, and Acceptance Criteria. Milestone 2 is blocked on unresolved architecture findings.

## 9. Milestone 2 — Business Flow and Recovery Closure

### Mandatory operation kinds

Migrate in this fixed order:

1. AI provider execution;
2. outbound message send;
3. delivery receipt reconciliation;
4. media fetch/upload;
5. history synchronization;
6. login/session restoration.

Candidate and production model execution remain semantically separate but share the same durable/outbox substrate.

### Required scenario closure

- normal create/schedule/claim/execute/receipt/terminal flow;
- process kill before call;
- process kill during call;
- remote success followed by kill before receipt;
- local receipt followed by kill before terminal transition;
- duplicate dispatcher processes;
- lease expiry and takeover;
- stale owner and stale host fencing token;
- heartbeat loss;
- deadline before claim, during execution, and while waiting remote;
- cancellation before call, during call, and after remote acceptance;
- provider/platform retryable and permanent failures;
- reconciliation proves success, absence, or requires human resolution;
- checkpoint/history rolling for long-running sync and polling;
- restart from every nonterminal state;
- no duplicate charge, provider call, message send, media transfer, or receipt.

### Review Gate 2

Independent source checkpoint review verifies shared-authority implementation, mandatory operation migrations, failure injection evidence, Windows process behavior, old-path blocking, and absence of scope drift. Milestone 3 is blocked on blocker/high findings.

## 10. Milestone 3 — Source Closure and Gates

### Required closure work

- complete writer/recovery/fallback/direct-call inventory with zero unregistered WP-B paths;
- remove or permanently block superseded runners, timers, direct call sites, and recovery paths;
- run all WP-B focused tests and every affected existing regression;
- rerun WP-A source closure, replay, migration integrity, ownership, fencing, and post-merge suites;
- run each backend test file in isolation where WP-B changes shared runtime behavior;
- run Ubuntu and Windows matrices, including two-process claim/dispatch and forced-kill recovery;
- run Schema 1–23 upgrade/reopen checks and future-schema fail-fast;
- run source-tree cleanliness, secret/business-content leak scans, dependency vulnerability scan, license scan, NOTICE, and SBOM generation;
- pin exact changed-file count, ordered file-set SHA-256, final reviewed Head, test commands, run IDs, job IDs, and artifact hashes;
- produce an independent source review and machine-readable WP-B closure receipt;
- add permanent push-to-main post-merge validation for relevant WP-B surfaces.

### Review Gate 3

WP-B closes only when:

```text
wpBFocusedGreen=true
wpARegressionGreen=true
ubuntuMatrixGreen=true
windowsMatrixGreen=true
sourceClosureViolationCount=0
legacyWpBCallablePathCount=0
uncertainOutcomeBlindRetryCount=0
secretLeakCount=0
businessContentLeakCount=0
independentSourceReview=APPROVED
postMergeValidationRequired=true
wpCAuthorized=false
formalRelease=false
publish=false
```

WP-B closure may request a separate WP-C authorization. It does not authorize WP-C automatically.

## 11. Commit and Review Topology

The branch remains a Draft work branch until final authorization.

Expected commit classes:

1. design and governance freeze;
2. complete Milestone 1 RED contracts;
3. Schema 23 and shared core GREEN;
4. mandatory operation migration and scenario closure;
5. legacy removal/source closure;
6. independent-review remediation when required;
7. final governance receipt.

Tests and implementation may be split into reviewable commits inside a Milestone. Formal independent reviews occur only at the three Milestone gates. No commit may mix WP-C production scope.

## 12. Verification Philosophy

Upstream open-source tests prove only the upstream component. WP-B closes only when Yance-specific tests prove:

- local Electron/Node/SQLite compatibility;
- single AuthorityWriteHost ownership;
- database-authoritative CAS and fencing;
- deterministic restart recovery;
- no duplicate external side effects;
- explicit receipt truth;
- no hidden legacy writer;
- no secret or business-content leakage;
- real Windows process behavior.

A green UI, mock-only run, provider HTTP success, test count, or upstream project maturity is not sufficient closure evidence.

## 13. Non-Goals

WP-B does not:

- redesign the WP-C communication domain model;
- redesign the WP-D model registry and qualification lifecycle;
- consolidate the WP-E evidence graph;
- activate memory or learning;
- perform production read cutover or legacy schema deletion assigned to WP-G;
- claim real WhatsApp, Telegram, Facebook, provider, or Windows acceptance assigned to WP-H;
- generate a release candidate or formal release.

## 14. Approval Boundary

User approval of this written design authorizes creation of the detailed implementation plan only. Production implementation begins after the plan is written, self-reviewed, and accepted under the project workflow.
