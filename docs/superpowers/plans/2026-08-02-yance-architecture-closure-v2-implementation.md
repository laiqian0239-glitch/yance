# Yance Architecture Closure V2 Implementation Plan

> **For implementation agents:** REQUIRED METHOD: execute this plan task-by-task with test-driven development. Every production change starts from an independently recorded failing test. Do not use caller bypasses, temporary feature flags, dual business writes, warning-only guards, test skips, or parameter tuning as defect closure.

- Document status: `FROZEN_FOR_INDEPENDENT_IMPLEMENTATION_PLAN_REVIEW`
- Plan baseline PR: `#4`
- Plan baseline branch: `rebuild/windows-release-closure-20260802-gate0-wp0-fix`
- Plan baseline Head: `cc086cdc4b6a52fc960eb2cd5fa9f741918d2a09`
- Architecture design review: `APPROVED_AFTER_NORMATIVE_AMENDMENT`
- Pre-implementation blockers: `CLOSED`
- Production code authorized by this document: `false`
- WP-A implementation authorized before independent plan review: `false`
- Gate 1 authorized: `false`

## Goal

Replace Yance's parallel writers, memory-only lifecycle fragments, direct platform/provider side effects, mutable evidence truth, and long-lived fallback paths with one auditable architecture:

```text
versioned command
→ one physical AuthorityWriteHost
→ one AuthorityTransactionCoordinator transaction
→ one CanonicalEventLedger event + managed payload
→ authoritative projection / durable outbox
→ external attempt
→ domain receipt / reconciliation
→ deterministic projection and evidence reference
```

The program closes in the fixed order WP-A through WP-H. A later work package cannot begin merely because tests are green; it requires the previous work package's independent source review and machine-readable closure receipt.

## Architecture

- The existing `DomainEventLogAuthority` is upgraded in place into the sole `CanonicalEventLedgerAuthority`; no second event store is introduced.
- Only `AuthorityWriteHost` may own a writable primary SQLite connection. Renderer, model worker, protocol worker, media worker, UAT probe, utility process, and a second backend process use versioned command protocols and cannot open the primary database for writing.
- A command transaction may append ledger data, managed payload, synchronous authoritative projections, checkpoints, and domain receipts. It may not perform network, provider, platform SDK, file transfer, user wait, or other external I/O.
- External actions use `intent → claim → attempt → receipt/reconciliation`. An uncertain remote outcome is a persistent state and is never converted into a blind retry.
- Compatibility tables are projections from the single ledger. A legacy table receiving a projector update is not a second writer only when its direct business mutation entrypoints are already disabled and the projector consumes the committed ledger sequence.
- Evidence stores receipt references, hashes, reason codes, counts, and redacted summaries. Evidence cannot issue or override domain truth.
- Read cutover and legacy deletion are separate phases with separate receipts. Rollback may switch read projections before legacy deletion, but may never restore dual writes.

## Tech Stack

Node.js 22, CommonJS, built-in `node:sqlite`, Electron desktop-hosted backend, Express local API, worker processes, `node:test`, GitHub Actions on Ubuntu and Windows.

## Normative Inputs

This plan is subordinate to, and must not weaken:

1. `docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-independent-review-amendment.md`
2. `docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-design.md`
3. `docs/architecture/YANCE_ARCHITECTURE_CLOSURE_V2_ROOT_CAUSE_MIGRATION_MATRIX_AMENDMENT_1_ZH.md`
4. `docs/architecture/YANCE_ARCHITECTURE_CLOSURE_V2_ROOT_CAUSE_MIGRATION_MATRIX_ZH.md`
5. `governance/yance-architecture-closure-v2-freeze.json`

## Current Source Facts Driving the Plan

- `backend/runtime/AppRuntimeComposition.js` still composes legacy account, message, send queue, platform messaging, projection, and recovery services.
- `backend/server.js` performs legacy interrupted-sync/background-job recovery and canonicalization before the new architecture is the production entrypoint.
- `backend/lib/sqliteConnectionBroker.js` rejects a second broker only within one process.
- `backend/lib/sqliteOwnership.js` provides a sidecar ownership foundation, but it is not yet the authoritative host-generation/fencing contract for every committed command.
- `backend/services/domainEventLogService.js` writes through `platformCoreRepository`, supports only schema version 1, stores a redacted payload directly, and is not the coordinator for authoritative projections and command receipts.
- `backend/services/durableExecutionAuthority.js` validates generation/owner in application code and then updates by `execution_id`; it lacks database-level state/generation/owner/fencing CAS, lease expiry, deadline, remote request, cancellation receipt, and durable external-action intent.
- `backend/services/communicationAuthority.js` writes its tables directly and is not yet reached by all three platform production paths.
- `backend/services/architectureShadowGate.js` gates primarily on sample count and zero hash mismatch, without mandatory scenario coverage, continuous duration, fault injection, restart/takeover, read-cutover receipt, or legacy-removal receipt.
- Schema 19 introduced useful FIX6M tables, and Schema 20 introduced scoped safety. Architecture Closure V2 migrations therefore start at Schema 21 and may not reuse or rewrite prior migration IDs.

## Execution Governance

### 1. Pull-request topology

- PR #4 remains the Draft architecture/governance anchor.
- The approved plan Head becomes the immutable parent for the WP-A branch.
- Each work package uses one stacked Draft PR:
  - `acv2/wp-a-identity-ledger-write-host`
  - `acv2/wp-b-durable-execution-outbox`
  - `acv2/wp-c-communication-core`
  - `acv2/wp-d-model-lifecycle`
  - `acv2/wp-e-evidence-graph`
  - `acv2/wp-f-memory-learning`
  - `acv2/wp-g-cutover-legacy-removal`
  - `acv2/wp-h-real-uat`
- Each child PR targets the immediately preceding approved branch, not `main`, so reviewers see only one bounded work package.
- A branch is never rebased across an unreviewed predecessor. The predecessor review Head is pinned in the child governance manifest.

### 2. Required evidence sequence for every implementation task

1. Add the smallest failing test that expresses the architectural invariant.
2. Run the exact focused command and capture RED output.
3. Commit the RED test without production implementation.
4. Implement the public-layer root fix.
5. Run focused GREEN, the work-package suite, relevant existing regressions, source-closure scan, and Windows matrix where applicable.
6. Commit implementation and test evidence.
7. Perform independent source review against the pinned Head.
8. Update governance only after the reviewed Head's workflow is green.

A test added after the implementation does not satisfy the RED requirement.

### 3. Commit and file-scope rules

- One task may change only the files listed in that task plus generated evidence and the task's governance manifest.
- Schema changes, runtime wiring, and legacy deletion are separate commits so each can be reviewed and reverted without restoring dual authority.
- No task may combine two work packages.
- Any newly discovered writer, reader, recovery path, fallback, timer, reflection entrypoint, or direct SQLite opener is added to the relevant inventory before implementation continues.
- A source-closure scan failing on an unregistered writer is a blocker, not an allowlist request.

### 4. Migration rules

- WP-A starts with migration `021_architecture_closure_v2_wp_a` and target schema version 21.
- Later work packages increment monotonically: WP-B=22, WP-C=23, WP-D=24, WP-E=25, WP-F=26, WP-G=27. WP-H adds no business schema unless a separately reviewed defect requires it.
- Migrations are forward-only, idempotent, checksum-pinned, and registered in `backend/lib/r32SqliteStore.js`.
- Existing schema 19/20 tables may be transformed or superseded, but historical migration files are never edited to manufacture a clean install.
- Destructive removal requires a verified ledger replay, a backup/restore drill, a cutover receipt, and an independent deletion review.

### 5. Verification entrypoints to add in WP-A

`package.json` will gain:

```text
test:acv2:wp-a ... test:acv2:wp-h
verify:acv2:wp-a ... verify:acv2:wp-h
verify:acv2:source-closure
verify:acv2:governance
```

The implementation must create `tools/architecture-closure-v2/run-work-package-tests.js` and `tools/architecture-closure-v2/source-closure-scan.js`. Commands fail closed when a required test, platform matrix, receipt, or inventory file is missing.

---

# WP-A — Identity, Event Ledger, Physical Write Host, Payload and Schema

**Entry gate:** independent implementation-plan review approved.  
**Exit gate:** `WP_A_INDEPENDENT_SOURCE_REVIEW_APPROVED` and all WP-A workflow jobs green.  
**Schema:** 21.

## Task A0: Freeze the writer/read/recovery inventory and WP-A child PR

**Files**
- Create: `governance/architecture-closure-v2/wp-a-baseline.json`
- Create: `governance/architecture-closure-v2/authority-registry.json`
- Create: `tools/architecture-closure-v2/source-closure-scan.js`
- Create: `backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js`
- Modify: `package.json`

**RED invariants**
- The scan fails while direct writable-store acquisition and unregistered `INSERT/UPDATE/DELETE` business entrypoints remain outside the registry.
- The registry requires authority owner, command entrypoint, event types, aggregate/version, idempotency key, receipt issuer, projection, legacy writer/recovery/fallback paths, and removal condition.
- A path cannot be marked both authority writer and compatibility projector.

**Implementation**
- Inventory every primary SQLite opener and every writer/recovery/fallback reachable from `backend/server.js`, `AppRuntimeComposition`, routes, workers, schedulers, adapters, and tests used as production probes.
- Classify entries as `AUTHORITY_WRITER`, `LEDGER_PROJECTOR`, `READ_MODEL`, `RECOVERY`, `FALLBACK`, or `FORBIDDEN`.
- Pin the exact parent Head and changed-file allowlist in `wp-a-baseline.json`.

**Commands**
```bash
node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js
node tools/architecture-closure-v2/source-closure-scan.js --wp A
```

## Task A1: Introduce Schema 21 and the persistent AuthorityWriteHost lease

**Files**
- Create: `backend/migrations/architectureClosureV2WpA.js`
- Create: `backend/services/authorityWriteHost.js`
- Create: `backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/authorityWriteHostProcessMatrix.test.js`
- Modify: `backend/lib/r32SqliteStore.js`
- Modify: `backend/lib/sqliteConnectionBroker.js`
- Modify: `backend/lib/sqliteOwnership.js`
- Modify: `backend/lib/runtimeRoleGuard.js`
- Modify: `backend/runtime/AppRuntimeFactory.js`

**Schema 21 objects**
- `authority_write_host_lease`
- `canonical_event_headers`
- `authority_payload_store`
- `event_type_registry`
- `authority_command_receipts`
- `projection_checkpoints_v2`
- `ledger_segments`
- `ledger_snapshots`

**RED invariants**
- Two backend processes cannot both acquire a current write token.
- After forced owner death, takeover atomically increments `host_generation` and `fencing_token`.
- A late commit from the old generation is rejected by the database transaction guard.
- Renderer, model worker, channel worker, media worker, UAT probe, and unknown utility roles cannot create a writable broker.
- Clock forward/backward jumps do not restore an old token's commit authority.

**Implementation**
- Keep the sidecar lock as startup exclusion and crash detection, but make the database lease/generation/fencing row the commit authority.
- Bind every coordinator transaction to the current host token.
- Make `SqliteConnectionBroker` construction require an `AuthorityWriteHost` capability in production.
- Keep test reset paths test-only and record their process role.

**Windows matrix**
- Run a real second Node backend process against the same DB.
- Kill the first process without graceful release.
- Verify takeover and old-process late write rejection.

## Task A2: Versioned canonical serialization and data classification

**Files**
- Create: `backend/services/canonicalSerialization.js`
- Create: `backend/services/dataClassificationRegistry.js`
- Create: `backend/services/eventTypeRegistry.js`
- Create: `backend/tests/architectureClosureV2/wpA/canonicalSerialization.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/dataClassificationRegistry.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/eventTypeRegistryReplay.test.js`

**RED invariants**
- Object-key order, null handling, timestamps, numbers, arrays, and set-like collections produce deterministic versioned hashes.
- Unknown event fields and unclassified payload fields fail closed.
- `SECRET_REFERENCE` can store only a reference/generation/receipt, never secret material.
- `BINARY_REFERENCE` can store only managed reference/hash/size/mime/lifecycle metadata.
- Upcasters are rejected when they use current time, random values, filesystem, network, mutable global state, or non-deterministic ordering.

**Implementation**
- Define canonicalization version 1 as a pure module.
- Register schema version, classification schema, upcaster chain, projector compatibility, and retention class for every event type introduced by WP-A.

## Task A3: Build the AuthorityTransactionCoordinator

**Files**
- Create: `backend/services/authorityTransactionCoordinator.js`
- Create: `backend/services/authorityCommandProtocol.js`
- Create: `backend/tests/architectureClosureV2/wpA/authorityTransactionCoordinator.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/authorityCommandProtocol.test.js`

**RED invariants**
- A command with the same idempotency key and same content returns the original receipt.
- The same idempotency key with different content fails closed.
- Aggregate version conflicts are rejected by SQL conditions, not read-then-unconditional-update.
- Event header, payload, authoritative projection, checkpoint, and command receipt commit atomically.
- A transaction rollback publishes no process event and leaves no partial payload or projection.
- Network, timers awaiting external work, provider calls, platform SDK calls, and file transfer capabilities are unavailable inside the coordinator callback.
- The host generation/fencing token is present in the SQL mutation condition.

**Implementation**
- Publish `eventBus` notifications only after commit.
- Record transaction duration, busy failures, rollback reason, host generation, ledger sequence, and receipt ID without business content.

## Task A4: Upgrade DomainEventLogAuthority in place to CanonicalEventLedgerAuthority

**Files**
- Create: `backend/services/canonicalEventLedgerAuthority.js`
- Modify: `backend/services/domainEventLogService.js`
- Modify: `backend/repositories/platformCoreRepository.js`
- Create: `backend/tests/architectureClosureV2/wpA/canonicalEventLedgerAuthority.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/domainEventCompatibilityFacade.test.js`

**RED invariants**
- There is exactly one ledger implementation and one append path.
- `domainEventLogService.js` contains no independent persistence logic after migration; it is a compatibility facade delegating to the canonical authority.
- Header/payload hash mismatch, duplicate aggregate version, mutation of committed event, and direct repository append all fail closed.
- Business payload remains replayable while Evidence receives no business body.

**Implementation**
- Preserve caller compatibility only through the same coordinator and ledger implementation.
- Block UPDATE/DELETE of committed headers and active payload segments with triggers and authority-only archive protocol.

## Task A5: Introduce IdentityAuthority and canonical scoped IDs

**Files**
- Create: `backend/services/identityAuthority.js`
- Create: `backend/tests/architectureClosureV2/wpA/identityAuthority.test.js`
- Modify: `backend/services/canonicalIdentityService.js`
- Modify: `backend/services/identityLinkAuthority.js`

**RED invariants**
- External identity scope includes platform + source account + external ID.
- Display name, avatar URL, username, or formatted phone alone cannot merge contacts.
- ID generation is deterministic under canonical input and collision-safe under different scope.
- Legacy identity callers receive IDs from the same authority and cannot write a separate identity fact.

## Task A6: Wire the single write host and ledger into runtime startup

**Files**
- Modify: `backend/runtime/AppRuntimeFactory.js`
- Modify: `backend/runtime/AppRuntimeComposition.js`
- Modify: `backend/server.js`
- Modify: `electron/desktopHost/ApiV2RuntimeClient.js`
- Create: `backend/tests/architectureClosureV2/wpA/runtimeComposition.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/startupOrdering.test.js`

**RED invariants**
- The write host is acquired before any production business recovery or mutation.
- Startup recovery cannot write directly; it submits versioned commands.
- A failed write-host claim prevents readiness.
- The renderer and utility processes can submit commands but cannot receive the write capability.
- Existing legacy services remain readable only where required; their WP-A writer paths are blocked or delegated before the new path is enabled.

## Task A7: Deterministic replay, snapshots, segments, and corruption handling

**Files**
- Create: `backend/services/ledgerReplayAuthority.js`
- Create: `backend/services/ledgerArchiveAuthority.js`
- Create: `backend/tests/architectureClosureV2/wpA/ledgerReplay.test.js`
- Create: `backend/tests/architectureClosureV2/wpA/ledgerArchiveFaultMatrix.test.js`
- Create: `tools/architecture-closure-v2/wp-a-replay-evidence.js`

**RED invariants**
- A new empty database rebuilds WP-A projections to the same canonical hash.
- Old schema fixtures replay through deterministic upcasters.
- Snapshot or segment corruption fails closed and reports the exact broken hash-chain link.
- A crash during segment/snapshot creation leaves the previous verified replay source intact.
- Events needed by the active snapshot are not deleted or downgraded.

## Task A8: WP-A verification and independent source review

**Files**
- Create: `docs/architecture/YANCE_ACV2_WP_A_SOURCE_REVIEW_ZH.md`
- Create: `governance/architecture-closure-v2/wp-a-closure.json`
- Modify: `.github/workflows/stage-6459-wp0-gates.yml` or create a dedicated ACV2 workflow without weakening WP0

**Required suites**
```bash
npm run test:acv2:wp-a
npm run verify:acv2:wp-a
npm run verify:acv2:source-closure
npm run test:round12-platform-core
npm run test:source-uat-delivery
npm run test:security-scan
```

**Closure receipt requires**
- pinned RED commit and failed run;
- final reviewed Head;
- Ubuntu and Windows process matrix;
- replay and corruption matrix;
- writer inventory with zero unregistered WP-A writers;
- no direct production code outside the allowed file inventory;
- independent review approval.

---

# WP-B — Durable Execution and External Action Outbox

**Entry:** WP-A closure receipt valid.  
**Schema:** 22.

## Task B0: Freeze operation and external-action call-site inventory

Inventory all AI provider calls, channel sends, receipt queries, session restore, history sync, media transfer, OAuth/token exchange, background jobs, and cancellation paths. Each call site must identify operation kind, stable idempotency key, remote receipt capability, compensation/reconciliation policy, deadline, and owning domain authority.

## Task B1: Migrate DurableExecutionAuthority to database CAS

**Files**
- Modify: `backend/services/durableExecutionAuthority.js`
- Modify: Schema 22 migration
- Create: `backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/durableExecutionClockMatrix.test.js`

Add explicit `CLAIMED`, lease expiry, fencing token, deadline, remote request ID, cancellation receipt ID, and late-result receipt. Every transition uses one SQL statement conditioned on execution ID, generation, owner, fencing token, and allowed state; affected-row count must be exactly one.

## Task B2: Implement ExternalActionOutboxAuthority

**Files**
- Create: `backend/services/externalActionOutboxAuthority.js`
- Create: `backend/services/externalActionDispatcher.js`
- Create: `backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js`

Persist `ExternalActionIntent`, `ExternalActionAttempt`, `ExternalActionReceipt`, and `ExternalOutcomeReconciliation`. Dispatcher work starts only after committed intent and uses CAS claim. There is no external I/O in the command transaction.

## Task B3: Implement uncertain-outcome reconciliation

Create a common reconciliation protocol supporting provider idempotency lookup, channel receipt query, remote request query, and human resolution when absence cannot be proven. Crash after remote success but before local receipt must not cause automatic duplicate send or charge.

## Task B4: Integrate first mandatory operation kinds

Migrate in this order:

1. AI provider execution;
2. outbound message send;
3. delivery receipt reconciliation;
4. media fetch/upload;
5. history synchronization;
6. login/session restoration.

Candidate and production execution remain semantically separated, but both use the same durable/outbox substrate.

## Task B5: Cancellation, deadlines, dead letter, and history rolling

Cancellation request, remote cancellation attempt, local acknowledgement, timeout, and terminal receipt are separate facts. Add versioned execution checkpoints/continue-as-new equivalent for long-running sync and polling.

## Task B6: WP-B independent review

Require process kill at pre-call, in-call, post-call/pre-receipt, post-receipt/pre-terminal, duplicate dispatcher, stale owner, clock jump, and restart. Exit only when every physical external call has one persisted attempt and every uncertain outcome converges through a receipt or explicit manual reconciliation.

---

# WP-C — Communication Core and Three-Platform Adapters

**Entry:** WP-B closure receipt valid.  
**Schema:** 23.

## Task C0: Freeze communication writer and adapter inventory

Map WhatsApp, Telegram, and Facebook account identity, contacts, conversations, messages, media, sends, receipt callbacks, history sync, avatar fetch, checkpoint advancement, and legacy UI tables. Identify every direct business writer before enabling a canonical command path.

## Task C1: Upgrade ChannelAdapterContract to versioned envelopes

**Files**
- Modify: `backend/services/channelAdapterContract.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Create: `backend/tests/architectureClosureV2/wpC/channelAdapterEnvelopeV2.test.js`

Rename/alias methods to the approved V2 contract, require adapter version, capabilities, source account identity, external event ID, occurred time, payload hash, and redaction metadata. Reject SDK objects, database objects, functions, accessors, cycles, binary bodies, and prototype-pollution keys.

## Task C2: Upgrade CommunicationAuthority through the coordinator

**Files**
- Modify: `backend/services/communicationAuthority.js`
- Modify: Schema 23 migration
- Create: `backend/tests/architectureClosureV2/wpC/communicationAuthorityV2.test.js`

Own external account identity, external contact identity, canonical contact/conversation/message, media, delivery attempts/receipts, and sync checkpoints. All mutations are commands/ledger events; direct table methods become internal projector operations.

## Task C3: Migrate inbound ingestion without dual writes

For each platform, disable the direct legacy mutation entrypoint before routing normalized envelopes to the canonical command. Old UI tables are updated only by a committed-ledger compatibility projector with durable checkpoints.

## Task C4: Migrate outbound send and receipt truth

Every send references a frozen content hash, durable operation, external intent, attempt, and CommunicationAuthority receipt. `HTTP 200`, SDK return, accepted, delivered, and read remain distinct. `UNKNOWN` schedules reconciliation and cannot be treated as success by UI or learning.

## Task C5: Media and sync gap closure

Media lifecycle is explicit and retryable. A sync checkpoint advances only after every event in the gap is committed. Restart, duplicate pages, reordered callbacks, missing media, and stale workers are covered.

## Task C6: Three-platform contract and real-adapter regression

Run common contract tests plus platform-specific suites for WhatsApp, Telegram, and Facebook. Mocks prove code invariants only; they do not satisfy WP-H real-platform evidence.

## Task C7: WP-C independent review

Exit requires zero direct communication writers outside CommunicationAuthority/projectors, deterministic message identity across history/realtime/receipt, monotonic receipts, and a complete compatibility-projection inventory.

---

# WP-D — Provider and Model Lifecycle with Credential Binding

**Entry:** WP-C closure receipt valid.  
**Schema:** 24.

## Task D0: Freeze model truth and credential call-site inventory

Inventory registry, discovery, capability, smoke, benchmark, role qualification, champion, production route, runtime health, cooldown, provider failure domains, auto-configuration, onboarding, route resolution, and all secret reads/writes.

## Task D1: Enforce CredentialCustodyAuthority as the only secret writer

Model lifecycle stores only `ProviderCredentialBinding`: credential reference, provider/account scope, vault generation, capability metadata, verification receipt, and active/revoked state. API keys, OAuth refresh tokens, cookies, sessions, and QR material never enter model tables, ledger payloads, logs, or Evidence.

## Task D2: Build the unified ModelLifecycleAuthority

Create one versioned lifecycle aggregate and migrate the existing model services as command adapters/read projectors. Preserve distinctions between connection, discovery, capability, smoke, benchmark, role qualification, champion, production binding, runtime health, cooldown, and revocation.

## Task D3: Make route resolution consume one immutable lifecycle snapshot

`ModelRoutingIntegrityService → AiQualityRouteAuthority → AiGateway → ModelExecutor` must consume one snapshot version and emit one route receipt. No service may re-query a different registry mid-execution or infer production qualification from UI state.

## Task D4: Integrate provider actions with WP-B outbox

Connection verification, discovery, smoke, benchmark, and production calls use durable operations and external intents. Old credential generations and stale route snapshots fail closed.

## Task D5: WP-D independent review

Require secret-leak scans, credential rotation/revocation, provider outage composition, cooldown persistence, stale snapshot, late provider result, candidate/production separation, and real route receipt correlation.

---

# WP-E — Evidence Graph and Domain Receipt Index

**Entry:** WP-D closure receipt valid.  
**Schema:** 25.

## Task E0: Freeze all evidence/trace/diagnostic stores and issuers

Inventory `EvidenceAuthority`, `AIExecutionTraceAuthority`, `modelExecutionEvidenceStore`, diagnostics, route tests, platform evidence, runtime probes, and any code that currently derives business success from observations.

## Task E1: Establish the domain receipt issuer registry

Create a machine-readable registry mapping each receipt type to exactly one domain authority. Evidence APIs accept only a valid receipt reference/hash and cannot update domain terminal state.

## Task E2: Consolidate trace observations without copying business content

Trace hierarchy links user action, route snapshot, provider operation, candidate, reply approval, delivery attempt, platform receipt, memory approval, and learning activation. Store IDs, versions, state, reason, hashes, counts, and approved redacted summaries only.

## Task E3: Migrate existing evidence producers and remove parallel truth reads

Existing trace/evidence services become adapters/projectors into one EvidenceAuthority. Any direct caller that reads evidence to decide business success is replaced with a domain receipt lookup.

## Task E4: Unified diagnostics and query tests

A trace ID retrieves an ordered cross-domain chain while preserving data classification. Forged evidence, reordered observations, duplicate IDs, missing receipts, and redaction failures are rejected.

## Task E5: WP-E independent review

Exit requires one evidence graph, one receipt issuer per domain fact, no secrets/chat bodies/binary content in evidence, and no business state mutation through evidence APIs.

---

# WP-F — Contact Context, Reply Approval, Memory and Learning

**Entry:** WP-E closure receipt valid.  
**Schema:** 26.

## Task F0: Freeze contact, relationship, reply feedback, memory, and learning writers

Inventory contact merges, relationship assertions, customer profiles, pending facts, reply approvals, feedback, learning candidates, active memories, retrieval, revocation, rollback, and scheduled synthesis.

## Task F1: Migrate contact/relationship facts to receipt-backed authority commands

External identity scope remains account-specific. Contact merges and relationship assertions require explicit evidence and reversible receipts. Existing customer-profile tables become projections.

## Task F2: Separate ReplyApprovalReceipt from MemoryApprovalReceipt

A frozen reply can be approved for sending without authorizing long-term memory. A successful platform delivery receipt is required before creating pending memory. Only a separate memory review can move pending memory into shadow.

## Task F3: Implement memory lifecycle and retrieval provenance

Lifecycle: `PENDING → APPROVED → SHADOW → ACTIVE → REVOKED/ROLLED_BACK`. Retrieval records memory ID, version, scope, query hash, ranking metadata, and the generation that used it. Revoked memory cannot be returned to new generations.

## Task F4: Prevent learning from non-truth paths

Inbound text, generated candidates, failed sends, emergency fallbacks, unknown receipts, and evidence observations cannot activate learning. Activation requires both memory approval and a valid delivery/domain receipt chain.

## Task F5: WP-F independent review

Require dual-approval negative tests, failed/unknown delivery tests, cross-account isolation, merge reversal, retrieval provenance, revoke/rollback, restart recovery, and no business content leakage into Evidence.

---

# WP-G — Shadow Verification, Two-Phase Cutover, and Legacy Removal

**Entry:** WP-F closure receipt valid.  
**Schema:** 27.

## Task G0: Freeze complete legacy writer/reader/recovery/fallback inventory

Re-run static and runtime discovery for every bounded context. The inventory includes timers, startup recovery, hidden route aliases, reflective requires, feature flags, emergency fallbacks, CLI tools, UAT probes, migration helpers, and old worker entrypoints.

## Task G1: Upgrade shadow comparison to a versioned semantic protocol

**Files**
- Modify: `backend/services/architectureShadowGate.js`
- Create: `backend/services/cutoverAuthority.js`
- Create: `backend/tests/architectureClosureV2/wpG/shadowSemanticProtocol.test.js`

Require canonicalization version, scenario, ledger range, projector version, semantic exclusions, sample count, continuous duration, lag, restart/takeover, failure injection, and replay hash. Exclusion fields are registered and reviewed; they cannot be added ad hoc to hide mismatch.

## Task G2: Sign ReadCutoverAuthorizationReceipt per bounded context

Switch reads only when the context-specific receipt is valid. Direct legacy writes must already be disabled. Rollback during the stable window switches read projection only and never restores legacy writes.

## Task G3: Observe the stable window and prove no bypass

Use runtime probes, database writer telemetry, process-role checks, and static scans. Any legacy mutation or fallback invocation invalidates the receipt and returns the context to review.

## Task G4: Delete old writer, recovery, fallback, and dead schema access

Deletion is explicit source removal, not an unused flag. Remove startup recovery, schedulers, routes, repositories, direct table methods, and worker paths that can recreate old truth. Keep only documented read projections required for data presentation.

## Task G5: Sign LegacyRemovalClosureReceipt

Require deletion commits, inventory=0, full replay, post-deletion restart/takeover/fault tests, and independent review. Only then may the bounded context be marked `CLOSED`.

## Task G6: WP-G independent review

Exit requires no path to resurrect a legacy writer, no dual-write rollback, all context closure receipts valid, and PR diffs proving old code deletion rather than deactivation.

---

# WP-H — Real Windows and Real External-System Acceptance

**Entry:** all WP-G context closure receipts valid.  
**Schema:** none by default.

## Task H0: Freeze reviewed source and create sealed UAT package

Generate the package only from the reviewed source Head through the canonical sealed-export authority. Pin source SHA, tree, package SHA-256, Electron LFS identity, dependency manifest, test protocol, and evidence output schema.

## Task H1: Real Windows authority and recovery matrix

On real Windows test:

- clean install and existing-data upgrade;
- two backend processes;
- forced kill and takeover;
- sleep/resume and clock jump;
- WAL contention and disk-full/read-only/corrupt-snapshot scenarios;
- 100%, 125%, and 150% display scale where UI evidence is relevant;
- restart replay and no legacy writer resurrection.

## Task H2: Real WhatsApp, Telegram, and Facebook matrix

For each platform test authentication/session restoration, account identity, contacts, conversations, history/realtime deduplication, text/media/unsupported messages, outbound send, accepted/delivered/read/failure/unknown receipts, forced crash after remote success, receipt reconciliation, cancellation, and account isolation.

## Task H3: Real provider/model matrix

Use real configured providers to test credential binding, rotation/revocation, discovery, capability, smoke, benchmark, role qualification, champion and production binding, outage/cooldown, stale route rejection, cancellation, uncertain outcome, and full AI decision-to-delivery-to-learning trace.

## Task H4: Evidence package validation and independent final review

Evidence must be machine-readable, source-bound, per-scenario, and separated from secrets/business content. A test count, UI green state, mock run, or single smoke cannot satisfy a real-environment row.

## Task H5: Governance conclusion

WP-H success does not automatically authorize candidate packaging, promotion, merge, or formal release. It updates Architecture Closure V2 to `REAL_ENVIRONMENT_ACCEPTANCE_COMPLETE` and requests a separate release-governance decision.

---

# Work-Package Gate Matrix

| WP | Required predecessor | Core closure evidence | Next authorization |
|---|---|---|---|
| A | independent plan review | single write host, canonical ledger, replay, writer inventory | WP-B only |
| B | WP-A source review | CAS lifecycle, outbox, uncertain reconciliation | WP-C only |
| C | WP-B source review | three adapters, canonical communication, receipt truth | WP-D only |
| D | WP-C source review | one model lifecycle, custody binding, route snapshot | WP-E only |
| E | WP-D source review | one evidence graph, unique receipt issuers | WP-F only |
| F | WP-E source review | contact receipts, dual approval, retrieval provenance | WP-G only |
| G | WP-F source review | read cutover receipts, deletion receipts, inventory=0 | WP-H only |
| H | WP-G source review | real Windows, three platforms, real providers | separate release review |

# Plan-Level Prohibitions

The following invalidate the work package even when tests pass:

- adding a new authority while retaining an old business writer;
- writing both old and new facts from the caller;
- using `busy_timeout` or retry loops as write serialization;
- external I/O inside the SQLite write transaction;
- application-level read/check followed by unconditional state update where CAS is required;
- treating evidence, UI state, HTTP success, or provider acceptance as a stronger domain receipt;
- retrying an uncertain external action before proving remote absence;
- storing secret material, chat bodies, prompt bodies, or binary payloads in Evidence;
- approving reply send and memory activation with the same receipt;
- cutting reads without a valid receipt;
- declaring closure while writer/recovery/fallback code remains callable;
- restoring a deleted legacy writer as rollback;
- using mocks as real Windows/platform/provider evidence;
- merging PR #4, marking it ready, beginning Gate 1, generating a candidate package, or announcing release readiness without separate authorization.

# Independent Implementation-Plan Review Checklist

The reviewer must verify:

1. every design/matrix invariant is assigned to one work package and one executable task;
2. file paths and existing source owners are concrete enough to begin TDD without architectural improvisation;
3. schema versions and migration ownership cannot collide;
4. PR stacking and baseline pinning prevent cross-WP diff contamination;
5. compatibility projection is not disguised dual-write;
6. RED evidence precedes production code;
7. external actions have intent/attempt/receipt/reconciliation and no network-in-transaction path;
8. every work package has a static writer inventory and a runtime bypass probe;
9. each cutover has separate read and deletion receipts;
10. real environment acceptance remains outside source-only closure;
11. no plan step weakens WP0, sealed-export, credential custody, candidate/production separation, or existing security gates;
12. plan approval authorizes only WP-A, not WP-B-H or Gate 1.

# Current Governance Result

Until the independent implementation-plan review is approved:

```text
implementationPlanStatus=FROZEN_FOR_INDEPENDENT_REVIEW
productionCodeChangesAllowed=false
wpAImplementationAllowed=false
gate1MayStart=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
pr4MustRemainDraft=true
```
