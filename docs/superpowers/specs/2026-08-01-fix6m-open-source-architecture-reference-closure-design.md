# FIX6M / Batch41 Open-Source Architecture Reference Closure Design

## Baseline

FIX6L separates candidate-only AI execution from production execution, but the product still contains multiple partially overlapping authorities for platform accounts, external identities, messages, media, background jobs, AI traces, relationship projections, and learning receipts. Real Windows evidence has repeatedly exposed gaps between these authorities: account login can be locally visible without production readiness, avatar/media failures collapse into empty UI, history synchronization and realtime delivery use different progress semantics, route traces are memory-only, and relationship/learning projections cannot always be traced back to one durable platform event.

## Goal

Absorb proven architectural patterns from Chatwoot, Temporal TypeScript, Dify, Langfuse, Activepieces, Open WebUI, AnythingLLM, and Mem0 without forking their runtimes or copying license-restricted code. Build four Yance-owned public authorities that make platform ingress/egress, durable work, model execution evidence, contact/relationship projection, AI reply, and learning operate on one traceable chain.

## Reference boundaries

| Reference | Pattern absorbed | Explicitly not absorbed |
|---|---|---|
| Chatwoot | Account/inbox-scoped external identity, conversation, canonical message, attachment and delivery boundaries | Rails runtime, database schema, UI code |
| Temporal TypeScript | Durable execution history, activity attempts, heartbeat, cancellation and retry classification | Temporal Server dependency in the desktop baseline |
| Dify | Provider plugin contract, model capability declaration, provider error normalization and lifecycle separation | Dify frontend, multi-tenant implementation, license-restricted code |
| Langfuse | Trace/span/generation hierarchy and stable correlation identifiers | Hosted telemetry requirement and prompt/content exfiltration |
| Activepieces | Typed connector lifecycle and credential isolation | Generic automation runtime |
| Open WebUI / AnythingLLM | Local/cloud provider information architecture and desktop local-first health | Their application runtime and branding code |
| Mem0 | Versioned memory provenance and retrieval receipt | Automatic promotion of raw chat into trusted long-term memory |

## Target authorities

### 1. EvidenceAuthority

`EvidenceAuthority` is the only public trace/receipt writer. It persists redacted trace records and append-only observations in SQLite.

Identifiers:

- `traceId`: one user or platform intent from ingress to final outcome.
- `executionId`: one durable workflow execution within that trace.
- `attemptId`: one physical provider/channel attempt.
- `providerRequestId`: external provider correlation when supplied.
- `routeReceiptId`, `qualificationReceiptId`, `deliveryReceiptId`, and `learningReceiptId`: immutable domain receipts.

Evidence never stores API keys, raw credential material, QR data, binary payloads, or unredacted message bodies. Existing `routeTestId` remains a compatibility alias for `traceId` during migration.

### 2. DurableExecutionAuthority

All long-running work is represented by a persisted execution plus append-only events:

`CREATED -> SCHEDULED -> RUNNING -> WAITING_REMOTE -> RETRY_SCHEDULED -> RUNNING -> SUCCEEDED|FAILED|CANCELLED|DEAD_LETTERED`

Every transition requires an expected generation, idempotency key, actor, reason code, and trace identity. Heartbeats renew ownership by monotonic lease sequence, not wall-clock-only assumptions. Cancellation is a durable request and acknowledgement, not deletion of an in-memory Promise.

Initial migrated operation kinds:

- AI candidate generation;
- channel history synchronization;
- avatar/media fetch;
- outbound message delivery and receipt reconciliation.

### 3. CommunicationAuthority

The communication domain owns:

- `ChannelAccount`;
- `ExternalIdentity`;
- `ContactBinding`;
- `ConversationBinding`;
- `CanonicalMessage`;
- `MediaAsset`;
- `DeliveryAttempt` and `DeliveryReceipt`;
- `SyncCheckpoint`.

Adapters normalize platform protocol objects into immutable commands/events. They cannot merge contacts, determine final conversation ownership, retry without policy, authorize AI sending, or mutate relationship/learning state.

`CanonicalMessage` retains a redacted raw-event reference, normalized content, and render projection separately. Unsupported content is explicit, never silently rendered as an empty bubble.

### 4. ContactRelationshipAuthority and AIReplyLearningAuthority

Contact and relationship screens are projections over canonical platform evidence. A relationship fact must list source message/event identifiers, projection version, confidence, and review state.

AI reply execution consumes a versioned `ContactContextSnapshot`; human approval freezes the exact outbound text and target. Platform delivery returns to the same trace. Learning can only be created from successfully delivered, non-emergency, reviewed evidence and follows:

`PENDING -> APPROVED -> SHADOW -> ACTIVE -> REVOKED`

Every retrieval produces a receipt identifying the memory versions actually used.

## Data flow

1. Adapter receives a platform event and creates/continues a trace.
2. CommunicationAuthority validates account scope and external event identity.
3. DurableExecutionAuthority persists normalization/media/sync work and attempts.
4. Canonical message is committed idempotently.
5. ContactRelationshipAuthority updates evidence projections.
6. AIReplyLearningAuthority creates a candidate-only execution from a versioned context snapshot.
7. Human approval creates a frozen Outbox command.
8. Durable channel delivery records attempts and final platform receipt.
9. Eligible delivered outcomes may create pending learning evidence.
10. System diagnostics read the same authorities and cannot infer health independently.

## Migration strategy

- Add schema without replacing existing production tables.
- Dual-write new evidence/execution records around existing ingress, AI candidate, history sync, media and delivery entry points.
- Project legacy rows into the new authorities with stable idempotency keys.
- Run shadow comparisons before any read-path cutover.
- Keep compatibility aliases at module boundaries, not duplicate business decisions.
- Fail closed when trace, account scope, or canonical message identity is incomplete.

## Safety invariants

- Platform/account scope is part of every external identity, event, conversation and message idempotency key.
- Display name, phone formatting, username, or avatar URL alone can never merge contacts.
- Candidate-only AI output cannot reach channel delivery.
- Raw platform events and rendered UI content cannot overwrite each other.
- A claimed send success without a platform message ID or explicit accepted receipt is not final success.
- History checkpoints advance only after the entire committed gap is persisted.
- Media failure produces a durable visible state and retry policy; it never becomes an unexplained blank.
- Learning never activates directly from an inbound or generated message.
- Diagnostics count warning/failure/skipped states from authoritative records, not page-local checks.

## Acceptance

- One trace spans platform event, canonical message, AI candidate, approval, delivery and learning receipt where applicable.
- Execution history survives process restart and rejects stale-worker transitions.
- WhatsApp, Telegram and Facebook adapters conform to one typed port contract.
- Duplicate and out-of-order external events converge idempotently by account scope.
- Avatar, image, GIF and sticker states are explicit and restart-safe.
- History synchronization resumes from durable checkpoints without skipping or duplicating committed messages.
- Contact/relationship projections cite canonical evidence and are reversible.
- AI context and learning retrieval cite exact snapshot/memory versions.
- Candidate output remains non-deliverable until human approval creates a separate production command.
- Existing FIX6L AI and platform gates remain green.
- Real Windows three-platform UAT remains required before promotion.
