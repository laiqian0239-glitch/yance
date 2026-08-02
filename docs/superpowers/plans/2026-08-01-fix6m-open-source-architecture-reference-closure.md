# FIX6M Open-Source Architecture Reference Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Yance-owned evidence, durable execution, communication, relationship, and AI-learning authorities using proven open-source architectural patterns without importing their runtimes.

**Architecture:** Persist a single redacted trace hierarchy and append-only workflow history in SQLite, wrap existing platform and AI entry points with these authorities, then introduce canonical communication and contact-context contracts. Migration is dual-write plus shadow verification; existing tables remain production sources until evidence proves cutover-safe.

**Tech Stack:** Node.js 22, CommonJS, built-in `node:sqlite`, Express, Electron renderer JavaScript, `node:test`.

## Global Constraints

- No temporary bypasses, relaxed production checks, or UI-only fixes.
- No copied source from referenced projects; patterns are reimplemented in Yance-owned code.
- No new server dependency for the local-first desktop baseline.
- Every production change requires a failing test first.
- Real Windows and real platform credentials are not simulated as promotion evidence.
- Existing FIX6L candidate/production separation remains fail-closed.

---

### Task 1: Reference matrix and evidence protocol

**Files:**
- Create: `docs/architecture/FIX6M_OPEN_SOURCE_REFERENCE_MATRIX_ZH.md`
- Create: `backend/services/evidenceAuthority.js`
- Create: `backend/tests/fix6mEvidenceAuthority.test.js`

**Interfaces:**
- Produces: `EvidenceAuthority.startTrace(input)`, `appendObservation(input)`, `completeTrace(input)`, `failTrace(input)`, `getTrace(traceId)`, `recentTraces(limit)`.
- Compatibility: `routeTestId` is accepted and projected as an alias of `traceId`.

- [x] Write tests proving append-only ordering, redaction, idempotent observation keys, routeTestId compatibility, and restart persistence.
- [x] Run the test and confirm RED because `evidenceAuthority.js` does not exist.
- [x] Add SQLite migration and the minimal EvidenceAuthority implementation.
- [x] Run the test and confirm GREEN.
- [x] Adapt `aiExecutionTraceAuthority` to delegate to EvidenceAuthority without changing callers.
- [x] Run FIX6L execution/diagnostic tests and confirm GREEN.
- [x] Commit the task.

### Task 2: Durable execution history

**Files:**
- Create: `backend/services/durableExecutionAuthority.js`
- Create: `backend/tests/fix6mDurableExecutionAuthority.test.js`
- Modify: `backend/lib/r32SqliteStore.js`

**Interfaces:**
- Produces: `createExecution`, `schedule`, `claim`, `heartbeat`, `waitRemote`, `succeed`, `fail`, `requestCancel`, `acknowledgeCancel`, `retry`, `deadLetter`, `history`.
- Consumes: `traceId` from EvidenceAuthority and optimistic `generation` values.

- [x] Write failing tests for legal transitions, stale generation rejection, idempotent create, heartbeats, durable cancellation, retry policy, and restart recovery.
- [x] Implement append-only execution/event schema and state transition authority.
- [x] Verify RED/GREEN and concurrency invariants.
- [x] Commit the task.

### Task 3: Candidate AI dual-write migration

**Files:**
- Modify: `backend/services/candidateExecutionService.js`
- Modify: `backend/services/aiGateway.js`
- Modify: `backend/services/diagnosticsService.js`
- Test: `backend/tests/fix6mCandidateDurableTraceIntegration.test.js`

**Interfaces:**
- Candidate service creates one durable execution under the existing trace.
- Physical model attempts append attempt observations and provider request IDs.

- [x] Write a failing integration test proving current memory-only route traces disappear after module reload.
- [x] Dual-write candidate execution transitions and provider attempts.
- [x] Preserve candidate-only non-delivery, non-learning, non-formal invariants.
- [x] Verify FIX6L and FIX6M tests.
- [x] Commit the task.

### Task 4: Communication canonical contracts

**Files:**
- Create: `backend/services/communicationAuthority.js`
- Create: `backend/services/channelAdapterContract.js`
- Create: `backend/tests/fix6mCommunicationAuthority.test.js`
- Modify: `backend/migrations/round12PlatformCoreUnification.js` or add a dedicated FIX6M migration.

**Interfaces:**
- Produces canonical account, identity, conversation, message, media, delivery, and checkpoint commands.
- Adapters consume/produce frozen plain-data contracts only.

- [x] Write tests for account-scoped idempotency, raw/normalized/render separation, unsupported content, media lifecycle, delivery receipt truth, and checkpoint gap closure.
- [x] Implement schema and authority with no platform-specific branches.
- [x] Add contract validation rejecting Express/DOM/SQLite objects, accessors, binary payloads and prototype-pollution keys.
- [x] Commit the task.

### Task 5: WhatsApp, Telegram and Facebook adapter migration

**Files:**
- Modify: existing three platform adapter/ingress/egress services identified by code search.
- Test: `backend/tests/fix6mThreePlatformAdapterContract.test.js`

**Interfaces:**
- Each platform exposes `authenticate`, `restoreSession`, `readAccountIdentity`, `backfillContacts`, `backfillConversations`, `backfillMessages`, `subscribeEvents`, `normalizeEvent`, `fetchAvatar`, `fetchMedia`, `sendMessage`, `queryDelivery`, and `disconnect` capability descriptors.

- [x] Add contract tests for all three adapters before changing implementations.
- [x] Wrap existing implementations without duplicating core business decisions.
- [x] Dual-write canonical messages/media/delivery attempts and preserve old paths for shadow comparison.
- [x] Verify platform-specific regression suites.
- [x] Commit the task.

### Task 6: Durable history, media and delivery operations

**Files:**
- Modify: Telegram history sync, WhatsApp reconciliation/history, Facebook reconciliation, avatar/media fetch, and platform delivery services.
- Test: `backend/tests/fix6mDurableChannelOperations.test.js`

**Interfaces:**
- Uses DurableExecutionAuthority operation kinds `channel-history-sync`, `media-fetch`, `message-delivery`, and `delivery-reconcile`.

- [x] Add restart, retry, cancellation, stale worker, duplicate event and out-of-order convergence tests.
- [x] Persist checkpoints only after committed gaps close.
- [x] Make media failure states visible and retryable.
- [x] Require platform acceptance evidence before final delivery success.
- [x] Commit the task.

### Task 7: Contact and relationship evidence projections

**Files:**
- Create: `backend/services/contactRelationshipAuthority.js`
- Modify: existing customer profile and relationship projection services.
- Test: `backend/tests/fix6mContactRelationshipAuthority.test.js`

**Interfaces:**
- Produces versioned contact context snapshots and reversible relationship assertions with canonical source IDs.

- [x] Add failing tests preventing display-name merges and evidence-free relationship facts.
- [x] Project existing identities/messages into stable contact aggregates.
- [x] Record source IDs, projection version, confidence and review state.
- [x] Keep current UI projections through compatibility adapters.
- [x] Commit the task.

### Task 8: AI reply and learning receipt closure

**Files:**
- Create: `backend/services/aiReplyLearningAuthority.js`
- Modify: reply feedback/learning and outbox delivery integration services.
- Test: `backend/tests/fix6mAIReplyLearningClosure.test.js`

**Interfaces:**
- Consumes `ContactContextSnapshot`, candidate trace, approval receipt and delivery receipt.
- Produces versioned learning receipts and retrieval receipts.

- [x] Prove inbound/generated/failed/emergency messages cannot activate learning.
- [x] Create pending learning only after reviewed successful delivery.
- [x] Implement approval, shadow, activation, retrieval, revoke and rollback transitions.
- [x] Link all receipts to one trace without storing message bodies in evidence logs.
- [x] Commit the task.

### Task 9: Unified diagnostics and shadow cutover gates

**Files:**
- Modify: `backend/services/diagnosticsService.js`
- Modify: system center presentation.
- Create: `backend/tests/fix6mUnifiedDiagnostics.test.js`
- Create: `tools/uat/fix6mShadowClosureGate.js`

**Interfaces:**
- Diagnostics read EvidenceAuthority, DurableExecutionAuthority, CommunicationAuthority and shadow comparison results.

- [x] Add tests proving local UI checks cannot override authority warning/failure.
- [x] Expose stalled executions, media failures, sync gaps, delivery uncertainty, projection mismatches and incomplete AI/learning receipts.
- [x] Block read-path cutover until shadow mismatch is zero for the acceptance window.
- [x] Commit the task.

### Task 10: Full verification and delivery

**Files:**
- Create: `YANCE_BATCH41_FIX6M_ARCHITECTURE_REFERENCE_CLOSURE_REPORT_ZH.md`
- Create: `YANCE_BATCH41_FIX6M_REAL_WINDOWS_UAT_CHECKLIST_ZH.md`
- Update: release/source identity and delivery tooling.

- [x] Run focused RED/GREEN suites and existing FIX6L regression suites.
- [x] Run all backend and UI/UAT tests available without missing external registry artifacts.
- [x] Run source identity, ZIP CRC, duplicate and path-safety checks.
- [x] Package full source and one-click Windows launcher.
- [x] Mark real WhatsApp/Telegram/Facebook, real media, and real Windows UAT as pending unless evidence is actually supplied.
