# Yance ACV2 WP-B Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the six mandatory WP-B operation kinds onto the Schema 23 durable execution/outbox substrate, close restart and process-fault behavior, and seal Milestone 2 without authorizing Milestone 3, merge, production use, WP-C, release, or publish.

**Architecture:** Continue on Draft PR #17 from Milestone 1 Seal Head `1e3d600f0647af35e737ff92a200c67e69224c82`. A machine-readable Milestone 2 authorization first binds the exact branch, parent seal, operation order, and permitted paths. Every physical external call then flows through `DurableExecutionAuthority` → immutable intent → `ExternalActionDispatcher` CAS claim → persisted attempt → operation Adapter → receipt or reconciliation. Startup recovery reads persisted facts and issues commands; it never repairs business state directly.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, SQLite through the existing R32 store and AuthorityWriteHost, XState `5.32.5` behind the existing Yance lifecycle Adapter, GitHub Actions on Ubuntu and Windows.

## Global Constraints

- Repository: `laiqian0239-glitch/yance`.
- Pull request: `#17`; it must remain Draft, open, and unmerged throughout Milestone 2.
- Branch: `acv2/wp-b-durable-execution-outbox`.
- Parent Milestone 1 Seal Head: `1e3d600f0647af35e737ff92a200c67e69224c82`.
- Schema remains version `23`; migrations `001` through `023` are immutable.
- Mandatory operation order is exactly: `AI_PROVIDER_EXECUTION`, `OUTBOUND_MESSAGE_SEND`, `DELIVERY_RECEIPT_RECONCILIATION`, `MEDIA_TRANSFER`, `HISTORY_SYNCHRONIZATION`, `SESSION_RESTORE`.
- Production implementation requires credible same-Head Ubuntu and Windows RED first.
- Every physical call requires a persisted attempt bound to intent, claim, generation, host generation, fencing token, and an unexpired lease.
- Unknown remote outcome is never ordinary failure and cannot be automatically retried.
- Credentials, tokens, cookies, session material, message bodies, prompt bodies, and binary payloads must never enter WP-B records, logs, evidence, or workflow artifacts.
- Exact paths or narrowly bounded operation directories only; global production wildcards are forbidden.
- `temporaryBypassAllowed=false` and `warningOnlyClosureAllowed=false`.
- `milestone3Authorized=false`, `mergeAuthorized=false`, `productionUseAuthorized=false`, `wpCAuthorized=false`, `formalRelease=false`, and `publish=false`.
- No temporary flags, dual writers, callable fallbacks, warning-only scans, test exclusions, retry inflation, or timeout inflation.

---

### Task 1: Establish the machine-verifiable Milestone 2 authorization

**Files:**
- Create: `governance/architecture-closure-v2/wp-b-m2-authorization.json`
- Create: `tools/architecture-closure-v2/verify-wp-b-m2-authorization.js`
- Create: `backend/tests/architectureClosureV2/wpB/m2Authorization.test.js`
- Modify: `shared/release/acv2ActiveWorkPackageAuthority.js`
- Modify: `shared/release/acv2ActiveWorkPackageAuthorityEngine.js`
- Modify: `tests/wp0/acv2-work-package-scope-wiring.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`
- Modify: `.github/workflows/wp-b-validation.yml`

**Interfaces:**
- Produces: `verifyWpBM2Authorization(repositoryRoot, options) -> { ok, violations, authorization }`.
- Produces: `resolveWpBM2ImplementationAuthority(options) -> frozen authority | null`.
- Consumes: immutable Milestone 1 receipt at `governance/architecture-closure-v2/wp-b-m1-review.json`.

- [ ] **Step 1: Write authorization tests before the receipt or verifier exists**

Create `m2Authorization.test.js` with assertions that:

```js
assert.equal(receipt.parentMilestone1SealHead, '1e3d600f0647af35e737ff92a200c67e69224c82');
assert.deepEqual(receipt.operationKinds, [
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);
assert.equal(receipt.governance.temporaryBypassAllowed, false);
assert.equal(receipt.governance.mergeAuthorized, false);
assert.equal(receipt.governance.milestone3Authorized, false);
```

The test must also mutate the parent Head, reorder the operations, append a seventh operation, add `.github/workflows/**`, set any downstream flag to `true`, and assert the verifier rejects every mutation.

- [ ] **Step 2: Run the focused test and record intended RED**

Run:

```bash
node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpB/m2Authorization.test.js
```

Expected: FAIL because the authorization receipt/verifier and Milestone 2 authority resolver do not exist. A syntax error, missing dependency installation, or unrelated test failure is not an acceptable RED.

- [ ] **Step 3: Create the exact authorization receipt**

The receipt must contain:

```json
{
  "schemaVersion": 1,
  "documentType": "YANCE_ACV2_WP_B_M2_AUTHORIZATION",
  "status": "AUTHORIZED_FOR_RED_AND_IMPLEMENTATION",
  "repository": "laiqian0239-glitch/yance",
  "pullRequest": 17,
  "branch": "acv2/wp-b-durable-execution-outbox",
  "parentMilestone1SealHead": "1e3d600f0647af35e737ff92a200c67e69224c82",
  "operationKinds": [
    "AI_PROVIDER_EXECUTION",
    "OUTBOUND_MESSAGE_SEND",
    "DELIVERY_RECEIPT_RECONCILIATION",
    "MEDIA_TRANSFER",
    "HISTORY_SYNCHRONIZATION",
    "SESSION_RESTORE"
  ]
}
```

Add exact permitted paths for governance, tests, workflows, the six Adapter files, registry, dispatcher/outbox/reconciliation, listed model/channel/runtime entrypoints, process-matrix tooling, and inventory. Do not add `.github/workflows/**`, `backend/**`, `electron/**`, or repository-wide patterns.

- [ ] **Step 4: Implement the verifier and authority resolver**

The verifier must validate the immutable parent M1 receipt, Git ancestry, exact operation order, exact path normalization, absence of global wildcards, and all closed governance flags. `resolveWpBM2ImplementationAuthority` must return `null` on any violation and must not weaken the existing M1 seal verifier.

- [ ] **Step 5: Update WP0 and WP-B wiring tests**

Add exact-scope tests proving every authorized M2 path is accepted while adjacent names such as `wp-b-m2-authorization.json.bak`, `.yaml` workflow variants, sibling operation filenames, and global workflow/production wildcards are rejected.

- [ ] **Step 6: Run authorization and inherited governance tests**

Run:

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/m2Authorization.test.js \
  backend/tests/architectureClosureV2/wpB/m1ReviewSeal.test.js \
  backend/tests/architectureClosureV2/wpB/m1ReviewWorkflowScope.test.js \
  tests/wp0/acv2-work-package-scope-wiring.test.js \
  tests/wp0/implementation-branch-policy.test.js
node tools/architecture-closure-v2/verify-wp-b-m2-authorization.js
```

Expected: all tests pass; M1 remains sealed and downstream flags remain false.

- [ ] **Step 7: Commit authorization separately**

```bash
git add governance/architecture-closure-v2/wp-b-m2-authorization.json \
  tools/architecture-closure-v2/verify-wp-b-m2-authorization.js \
  backend/tests/architectureClosureV2/wpB/m2Authorization.test.js \
  shared/release/acv2ActiveWorkPackageAuthority.js \
  shared/release/acv2ActiveWorkPackageAuthorityEngine.js \
  tests/wp0/acv2-work-package-scope-wiring.test.js \
  tests/wp0/implementation-branch-policy.test.js \
  .github/workflows/wp-b-validation.yml
git commit -m "governance(acv2): authorize WP-B milestone two scope"
```

### Task 2: Create the complete Milestone 2 RED contract and cross-platform evidence

**Files:**
- Create: `backend/tests/architectureClosureV2/wpB/m2MandatoryOperationsRed.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/m2RecoveryRed.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/m2ProcessFaultRed.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/m2LeakBoundaryRed.test.js`
- Create: `tools/architecture-closure-v2/run-wp-b-m2-contracts.js`
- Create: `tools/architecture-closure-v2/capture-wp-b-m2-red-evidence.js`
- Create: `governance/architecture-closure-v2/wp-b-m2-red-evidence.json`
- Create: `.github/workflows/wp-b-m2-red.yml`
- Modify: `.github/workflows/wp-b-validation.yml`

**Interfaces:**
- Produces: `runWpBM2Contracts({ mode: 'red' | 'green' })`.
- Produces: machine-readable RED receipt bound to one exact Head and Ubuntu/Windows job IDs.

- [ ] **Step 1: Encode all required missing behaviors as failing tests**

Tests must cover exact six-kind registry, immutable Adapter contracts, persisted-attempt requirement, six entrypoint delegations, restart decision table, attempt-aware reconciliation requirement, duplicate dispatcher, lease takeover, stale owner/generation/host/fencing rejection, deadline/cancellation races, no blind retry, receipt-before-terminal restart, and leak exclusion.

- [ ] **Step 2: Verify local intended RED**

Run:

```bash
node tools/architecture-closure-v2/run-wp-b-m2-contracts.js --mode red
```

Expected: the runner completes the test process and reports every planned contract as an intended assertion failure caused by absent M2 production behavior. It must reject module-load crashes and unrelated failures.

- [ ] **Step 3: Add the dedicated Ubuntu/Windows RED workflow**

Use pinned checkout/setup-node SHAs already approved in WP-B workflows. Both jobs must checkout the exact same `VALIDATION_SHA`, run the same command, emit normalized TAP summaries, and upload no business data.

- [ ] **Step 4: Capture credible RED evidence**

After both jobs fail for intended assertions, populate `wp-b-m2-red-evidence.json` with RED Head, workflow/run/job IDs, expected conclusion, exact failing contract IDs, and normalized output SHA-256 values. The capture verifier must authenticate these facts through the GitHub Actions API.

- [ ] **Step 5: Freeze RED precedence**

Add validation that production-path changes after the authorization commit are forbidden until the RED receipt is valid. Governance/test/workflow changes required to capture RED remain allowed.

- [ ] **Step 6: Commit RED contracts and evidence**

```bash
git add backend/tests/architectureClosureV2/wpB/m2*Red.test.js \
  tools/architecture-closure-v2/run-wp-b-m2-contracts.js \
  tools/architecture-closure-v2/capture-wp-b-m2-red-evidence.js \
  governance/architecture-closure-v2/wp-b-m2-red-evidence.json \
  .github/workflows/wp-b-m2-red.yml \
  .github/workflows/wp-b-validation.yml
git commit -m "test(acv2): record WP-B milestone two RED contracts"
```

### Task 3: Build the durable operation registry and migrate AI provider execution

**Files:**
- Create: `backend/services/durableOperationRegistry.js`
- Create: `backend/services/durableOperations/aiProviderExecutionOperation.js`
- Modify: `backend/services/modelExecutionHost.js`
- Modify: `backend/services/modelExecutionWorker.js`
- Modify: `backend/services/aiGateway.js`
- Modify: `backend/services/ollamaClient.js`
- Modify: `backend/services/openAiCompatibleClient.js`
- Modify: `backend/routes/models.js`
- Test: `backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js`
- Test: `backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js`
- Test: `backend/tests/fix6jExecutionEnvelope.test.js`
- Test: `backend/tests/fix6jWorkerEnvelopeVerification.test.js`
- Test: `backend/tests/fix6jMissingCredentialForkGuard.test.js`

**Interfaces:**
- Produces: `OPERATION_KINDS` frozen object with six exact values.
- Produces: `createDurableOperationRegistry()` with `register(operationKind, adapter)`, `require(operationKind)`, and `list()`.
- Produces Adapter methods: `perform(attemptEnvelope)` and `reconcile(reconciliationEnvelope)`.

- [ ] **Step 1: Run the AI and registry subset of RED tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js \
  backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js
```

Expected: registry and persisted-attempt ownership assertions fail.

- [ ] **Step 2: Implement the pure registry**

Use a null-prototype internal map. Reject duplicate registrations with `WP_B_OPERATION_ADAPTER_DUPLICATE`, unknown kinds with `WP_B_OPERATION_ADAPTER_NOT_REGISTERED`, non-frozen adapters with `WP_B_OPERATION_ADAPTER_INVALID`, and mutation after runtime sealing with `WP_B_OPERATION_REGISTRY_SEALED`.

- [ ] **Step 3: Implement the AI operation Adapter**

The Adapter validates a recursively frozen attempt envelope, resolves credential references immediately before the physical call, delegates to the existing provider client, returns redacted observation fields and provider request ID, and implements provider-idempotency/request lookup for reconciliation. It performs no database writes.

- [ ] **Step 4: Refactor model execution ownership**

`modelExecutionHost` creates the durable execution and intent before worker fork. The worker receives only the persisted-attempt envelope plus an ephemeral credential capability. Worker exit after physical-call start without a trusted observation produces `UNCERTAIN_REMOTE_OUTCOME`. HTTP caller timeout may stop waiting but cannot rewrite execution truth.

- [ ] **Step 5: Remove independent provider-call reachability**

`aiGateway`, `ollamaClient`, and `openAiCompatibleClient` may be called physically only from `aiProviderExecutionOperation.js`. Other callers submit durable commands or perform read-only routing. Static and runtime probes must reject direct invocation without attempt identity.

- [ ] **Step 6: Run focused and FIX6J regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js \
  backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js \
  backend/tests/fix6jExecutionEnvelope.test.js \
  backend/tests/fix6jWorkerEnvelopeVerification.test.js \
  backend/tests/fix6jMissingCredentialForkGuard.test.js
```

Expected: all pass; secret values never appear in the attempt envelope or evidence.

- [ ] **Step 7: Commit the AI migration**

```bash
git add backend/services/durableOperationRegistry.js \
  backend/services/durableOperations/aiProviderExecutionOperation.js \
  backend/services/modelExecutionHost.js backend/services/modelExecutionWorker.js \
  backend/services/aiGateway.js backend/services/ollamaClient.js \
  backend/services/openAiCompatibleClient.js backend/routes/models.js \
  backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js \
  backend/tests/architectureClosureV2/wpB/aiProviderDurableMigration.test.js
git commit -m "feat(acv2): migrate AI execution to durable outbox"
```

### Task 4: Migrate outbound message send

**Files:**
- Create: `backend/services/durableOperations/outboundMessageSendOperation.js`
- Modify: `backend/services/communicationAuthority.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Modify: `backend/services/platformAdapterPorts.js`
- Modify: `backend/services/platformDriverRegistry.js`
- Modify: `backend/services/sendQueueService.js`
- Modify: `backend/repositories/sendQueueRepository.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/services/telegramAdapter.js`
- Modify: `backend/services/facebookAdapter.js`
- Modify: `backend/services/facebookPersonalMessengerExperimentalAdapter.js`
- Modify: `backend/services/facebookRelayClient.js`
- Modify: `services/facebook-gateway/server.js`
- Modify: `services/facebook-gateway/gateway.js`
- Test: `backend/tests/architectureClosureV2/wpB/outboundMessageDurableMigration.test.js`
- Test: `backend/tests/fix6mCommunicationAuthority.test.js`
- Test: `backend/tests/fix6mDurableChannelOperations.test.js`

**Interfaces:**
- Consumes: sealed registry and dispatcher from Task 3/M1.
- Produces: outbound intent creation and `OUTBOUND_MESSAGE_SEND` Adapter.

- [ ] **Step 1: Run outbound-message RED assertions**

Assert current direct send and `migrationMode: 'dual-write-shadow'` behavior are rejected. The test must prove no platform send occurs before attempt persistence.

- [ ] **Step 2: Convert communication authority to command/intention ownership**

It may persist canonical message state, create the execution and immutable intent, and observe receipts. It may not call a platform Adapter or maintain a second send retry schedule.

- [ ] **Step 3: Replace dual-write shadow with one durable path**

`ChannelAdapterRuntime.describe().migrationMode` must become `durable-outbox-only`. Runtime physical-send methods require an attempt envelope validated against the dispatcher claim. Remove callable direct-send fallback rather than hiding it behind a flag.

- [ ] **Step 4: Refactor queue compatibility**

`sendQueueService` becomes a facade over durable intents/receipts or is deleted where callers can use the authority directly. `sendQueueRepository` cannot mutate retry/recovery business state independently.

- [ ] **Step 5: Bind platform and gateway calls to attempt identity**

Every adapter/gateway request carries intent ID, attempt ID, claim ID, generation, host generation, fencing token, and request-content hash. Platform-local retries that can duplicate the side effect are disabled; retry authority remains in WP-B.

- [ ] **Step 6: Run focused communication regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/outboundMessageDurableMigration.test.js \
  backend/tests/fix6mCommunicationAuthority.test.js \
  backend/tests/fix6mDurableChannelOperations.test.js
```

- [ ] **Step 7: Commit outbound migration**

```bash
git add backend/services/durableOperations/outboundMessageSendOperation.js \
  backend/services/communicationAuthority.js backend/services/channelAdapterRuntime.js \
  backend/services/platformAdapterPorts.js backend/services/platformDriverRegistry.js \
  backend/services/sendQueueService.js backend/repositories/sendQueueRepository.js \
  backend/services/whatsappAdapter.js backend/services/telegramAdapter.js \
  backend/services/facebookAdapter.js \
  backend/services/facebookPersonalMessengerExperimentalAdapter.js \
  backend/services/facebookRelayClient.js services/facebook-gateway/server.js \
  services/facebook-gateway/gateway.js \
  backend/tests/architectureClosureV2/wpB/outboundMessageDurableMigration.test.js
git commit -m "feat(acv2): migrate outbound sends to durable outbox"
```

### Task 5: Migrate delivery receipt reconciliation

**Files:**
- Create: `backend/services/durableOperations/deliveryReceiptReconciliationOperation.js`
- Modify: `backend/services/communicationAuthority.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/services/telegramAdapter.js`
- Modify: `backend/services/facebookAdapter.js`
- Modify: `backend/services/facebookRelayClient.js`
- Test: `backend/tests/architectureClosureV2/wpB/deliveryReceiptDurableMigration.test.js`
- Test: `backend/tests/facebookBusinessSuiteReconciliationRegression.test.js`

**Interfaces:**
- Produces: reconciliation observations `REMOTE_SUCCESS_PROVEN`, `REMOTE_ABSENCE_PROVEN`, or `REMOTE_RESULT_UNKNOWN`.

- [ ] **Step 1: Write and run receipt-reconciliation RED**

The test must fail while delivery status can be updated without an exact persisted reconciliation observation bound to the attempt and intent.

- [ ] **Step 2: Implement receipt lookup/query Adapter**

Provider/platform receipt query runs outside the transaction. Persist the reconciliation observation before returning a decision. Remote success creates one receipt; duplicate callbacks return the original receipt.

- [ ] **Step 3: Separate absence from unknown**

Only proven absence may authorize a new attempt. Unknown remains nonterminal and may require manual resolution. Missing provider support is `REMOTE_RESULT_UNKNOWN`, not absence.

- [ ] **Step 4: Run reconciliation regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/deliveryReceiptDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js \
  backend/tests/facebookBusinessSuiteReconciliationRegression.test.js
```

- [ ] **Step 5: Commit receipt migration**

```bash
git add backend/services/durableOperations/deliveryReceiptReconciliationOperation.js \
  backend/services/communicationAuthority.js backend/services/channelAdapterRuntime.js \
  backend/services/whatsappAdapter.js backend/services/telegramAdapter.js \
  backend/services/facebookAdapter.js backend/services/facebookRelayClient.js \
  backend/tests/architectureClosureV2/wpB/deliveryReceiptDurableMigration.test.js
git commit -m "feat(acv2): persist durable delivery reconciliation"
```

### Task 6: Migrate media fetch/upload and transcription execution

**Files:**
- Create: `backend/services/durableOperations/mediaTransferOperation.js`
- Modify: `backend/services/mediaPipeline.js`
- Modify: `backend/services/transcriptionService.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/services/telegramAdapter.js`
- Modify: `backend/services/facebookAdapter.js`
- Modify: `backend/services/facebookRelayClient.js`
- Test: `backend/tests/architectureClosureV2/wpB/mediaTransferDurableMigration.test.js`

**Interfaces:**
- Produces: content-free media transfer references, transfer observations, and reconciliation lookup.

- [ ] **Step 1: Run media RED**

Assert direct transfer, child-process transcription, or transfer retry without a persisted attempt is rejected.

- [ ] **Step 2: Create reference-only transfer intent**

Persist media reference ID, source/destination scope, versioned metadata hash, deadline, and custody reference. Never persist bytes, URLs containing secrets, authorization headers, or message captions.

- [ ] **Step 3: Move physical transfer into the Adapter**

The Adapter resolves ephemeral access, performs one transfer, records remote transfer/request IDs, and returns an observation. Timeout after transfer start becomes uncertain unless absence is proven.

- [ ] **Step 4: Put transcription under the same attempt boundary**

Child-process invocation is a physical operation and requires a persisted attempt. Process timeout/exit is an observation; it is not authority to overwrite remote/local durable truth.

- [ ] **Step 5: Run media and leak tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/mediaTransferDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpB/m2LeakBoundaryRed.test.js
```

- [ ] **Step 6: Commit media migration**

```bash
git add backend/services/durableOperations/mediaTransferOperation.js \
  backend/services/mediaPipeline.js backend/services/transcriptionService.js \
  backend/services/channelAdapterRuntime.js backend/services/whatsappAdapter.js \
  backend/services/telegramAdapter.js backend/services/facebookAdapter.js \
  backend/services/facebookRelayClient.js \
  backend/tests/architectureClosureV2/wpB/mediaTransferDurableMigration.test.js
git commit -m "feat(acv2): migrate media transfer to durable attempts"
```

### Task 7: Migrate history synchronization and durable checkpoints

**Files:**
- Create: `backend/services/durableOperations/historySynchronizationOperation.js`
- Modify: `backend/services/communicationAuthority.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Modify: `backend/services/syncCheckpointService.js`
- Modify: `backend/repositories/syncCheckpointRepository.js`
- Modify: `backend/services/whatsappHistoryMediaRecovery.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/services/telegramAdapter.js`
- Modify: `backend/services/facebookAdapter.js`
- Modify: `backend/services/facebookRelayClient.js`
- Test: `backend/tests/architectureClosureV2/wpB/historySynchronizationDurableMigration.test.js`
- Test: `backend/tests/telegramHistorySyncRegression.test.js`

**Interfaces:**
- Produces: versioned checkpoint append/advance commands and reconciliation comparison.

- [ ] **Step 1: Run history-sync RED**

Assert checkpoint recovery and history calls cannot directly mutate progress or schedule retries outside WP-B.

- [ ] **Step 2: Implement checkpoint commands**

Checkpoint advance conditions on execution ID, checkpoint version, state version, generation, claim, host generation, fencing token, and lease. Affected row count must equal one.

- [ ] **Step 3: Implement paged history Adapter**

Each page/poll is one persisted attempt or one explicitly versioned checkpoint segment. Long-running history rolls segments without deleting authoritative history. Remote cursor comparison is persisted before recovery decisions.

- [ ] **Step 4: Remove direct history/media recovery writes**

`whatsappHistoryMediaRecovery` issues durable recovery commands or is reduced to a read-only compatibility facade. It cannot directly advance checkpoints or retry platform I/O.

- [ ] **Step 5: Run history regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/historySynchronizationDurableMigration.test.js \
  backend/tests/telegramHistorySyncRegression.test.js
```

- [ ] **Step 6: Commit history migration**

```bash
git add backend/services/durableOperations/historySynchronizationOperation.js \
  backend/services/communicationAuthority.js backend/services/channelAdapterRuntime.js \
  backend/services/syncCheckpointService.js backend/repositories/syncCheckpointRepository.js \
  backend/services/whatsappHistoryMediaRecovery.js backend/services/whatsappAdapter.js \
  backend/services/telegramAdapter.js backend/services/facebookAdapter.js \
  backend/services/facebookRelayClient.js \
  backend/tests/architectureClosureV2/wpB/historySynchronizationDurableMigration.test.js
git commit -m "feat(acv2): migrate history sync to durable checkpoints"
```

### Task 8: Migrate login and session restoration

**Files:**
- Create: `backend/services/durableOperations/sessionRestoreOperation.js`
- Modify: `backend/services/accountManager.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Modify: `backend/services/platformAdapterPorts.js`
- Modify: `backend/services/platformDriverRegistry.js`
- Modify: `backend/services/facebookOAuthService.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/services/telegramAdapter.js`
- Modify: `backend/services/facebookAdapter.js`
- Modify: `backend/services/facebookPersonalMessengerExperimentalAdapter.js`
- Modify: `backend/runtime/AppRuntimeComposition.js`
- Test: `backend/tests/architectureClosureV2/wpB/sessionRestoreDurableMigration.test.js`

**Interfaces:**
- Produces: account-scoped stable idempotency key and session probe reconciliation.

- [ ] **Step 1: Run session-restore RED**

Assert startup/account reconnect may request restoration but cannot call platform auth/restore directly or schedule its own retry timer.

- [ ] **Step 2: Create durable restore request**

Use account ID, platform, requested session generation, command hash, explicit deadline, and secret reference only. Same account/session-generation/hash returns the original execution; different content conflicts.

- [ ] **Step 3: Implement restoration Adapter and reconciliation**

Resolve credentials/session material at the custody boundary. Persist only probe outcome, provider/session generation, and redacted evidence reference. Unknown remains nonterminal.

- [ ] **Step 4: Remove direct startup restoration**

`AppRuntimeComposition` startup handlers submit the durable restore command. `accountManager` and channel runtime delegate; they do not call SDK restoration or retain reconnect business timers.

- [ ] **Step 5: Run session and startup tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/sessionRestoreDurableMigration.test.js \
  backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js
```

- [ ] **Step 6: Commit session migration**

```bash
git add backend/services/durableOperations/sessionRestoreOperation.js \
  backend/services/accountManager.js backend/services/channelAdapterRuntime.js \
  backend/services/platformAdapterPorts.js backend/services/platformDriverRegistry.js \
  backend/services/facebookOAuthService.js backend/services/whatsappAdapter.js \
  backend/services/telegramAdapter.js backend/services/facebookAdapter.js \
  backend/services/facebookPersonalMessengerExperimentalAdapter.js \
  backend/runtime/AppRuntimeComposition.js \
  backend/tests/architectureClosureV2/wpB/sessionRestoreDurableMigration.test.js
git commit -m "feat(acv2): migrate session restoration to durable execution"
```

### Task 9: Implement one restart recovery authority and remove competing recovery writers

**Files:**
- Create: `backend/services/durableExecutionRecoveryAuthority.js`
- Modify: `backend/services/ownerRecovery.js`
- Modify: `backend/services/runtimeRecoveryService.js`
- Modify: `backend/services/jobQueue.js`
- Modify: `backend/services/backgroundJobAuthority.js`
- Modify: `backend/services/asyncOperationLifecycleAuthority.js`
- Modify: `backend/services/executionDeadline.js`
- Modify: `backend/runtime/AppRuntimeComposition.js`
- Modify: `backend/runtime/AppRuntimeFactory.js`
- Modify: `backend/server.js`
- Modify: `electron/backendStartupSupervisor.js`
- Modify: `electron/desktopHost/BackendProcessHost.js`
- Modify: `electron/main.js`
- Test: `backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js`
- Test: `backend/tests/architectureClosureV2/wpB/runtimeRecoveryComposition.test.js`

**Interfaces:**
- Produces: `recoverNonterminalExecutions({ authorityTimestamp, hostToken }) -> frozen RecoveryReport`.
- Produces: `recoverExecution(snapshot, context) -> frozen RecoveryDecision`.
- Decisions: `REQUEUE_SAFE`, `RECONCILE_REQUIRED`, `CANCEL_CONFIRMATION_REQUIRED`, `DEADLINE_EXPIRED`, `NO_ACTION`.

- [ ] **Step 1: Run recovery RED tests**

The state table must assert:

```js
[
  ['SCHEDULED', 'REQUEUE_SAFE'],
  ['CLAIMED', 'REQUEUE_SAFE'],
  ['RUNNING', 'REQUEUE_SAFE'],
  ['WAITING_REMOTE', 'RECONCILE_REQUIRED'],
  ['UNCERTAIN_REMOTE_OUTCOME', 'RECONCILE_REQUIRED'],
  ['CANCEL_REQUESTED', 'CANCEL_CONFIRMATION_REQUIRED']
]
```

A persisted attempt changes `RUNNING` to `RECONCILE_REQUIRED`.

- [ ] **Step 2: Implement pure recovery decision logic**

Decision logic takes immutable snapshots and explicit authority time. It performs no I/O and never interprets process death as remote failure.

- [ ] **Step 3: Implement command-based recovery**

After AuthorityWriteHost acquisition and Schema 23 opening, enumerate nonterminal executions, derive decisions, and issue normal authority commands. No direct table mutation is allowed.

- [ ] **Step 4: Refactor legacy recovery authorities**

Each listed legacy component must be deleted, converted to read-only projection, or delegate to `DurableExecutionRecoveryAuthority`. Flags or disabled-but-callable methods are invalid.

- [ ] **Step 5: Separate process supervision from business recovery**

Electron may spawn/restart/health-check the backend process. It cannot retry operations, select execution transitions, or mutate SQLite business truth.

- [ ] **Step 6: Verify startup order**

Tests must prove:

```text
acquire AuthorityWriteHost
-> open the broker-owned Schema 23 store
-> construct transaction coordinator and WP-B authorities
-> seal operation registry
-> recover nonterminal executions through commands
-> mark runtime ready
```

- [ ] **Step 7: Run recovery and runtime regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js \
  backend/tests/architectureClosureV2/wpB/runtimeRecoveryComposition.test.js \
  backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js
```

- [ ] **Step 8: Commit recovery authority**

```bash
git add backend/services/durableExecutionRecoveryAuthority.js \
  backend/services/ownerRecovery.js backend/services/runtimeRecoveryService.js \
  backend/services/jobQueue.js backend/services/backgroundJobAuthority.js \
  backend/services/asyncOperationLifecycleAuthority.js backend/services/executionDeadline.js \
  backend/runtime/AppRuntimeComposition.js backend/runtime/AppRuntimeFactory.js \
  backend/server.js electron/backendStartupSupervisor.js \
  electron/desktopHost/BackendProcessHost.js electron/main.js \
  backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js \
  backend/tests/architectureClosureV2/wpB/runtimeRecoveryComposition.test.js
git commit -m "refactor(acv2): centralize WP-B restart recovery"
```

### Task 10: Build the real two-process fault-injection matrix

**Files:**
- Create: `tools/architecture-closure-v2/wp-b-process-fault-matrix.js`
- Create: `tools/architecture-closure-v2/fixtures/wp-b-fake-remote.js`
- Create: `tools/architecture-closure-v2/fixtures/wp-b-dispatcher-process.js`
- Create: `backend/tests/architectureClosureV2/wpB/processFaultMatrixContract.test.js`
- Modify: `governance/architecture-closure-v2/wp-b-operation-inventory.json`
- Modify: `.github/workflows/wp-b-validation.yml`

**Interfaces:**
- Produces: `runFaultMatrix(options) -> { ok, rows, duplicateExternalSideEffectCount, leakCount }`.

- [ ] **Step 1: Write the matrix contract before the harness**

Require eighteen named scenarios from the approved design and exact evidence fields: process IDs, execution/intent/attempt/claim IDs, generations, fencing token, counts, and final state.

- [ ] **Step 2: Implement persistent fake remote semantics**

The fake remote stores request IDs and idempotency keys in its own temporary persistence. It supports perform, lookup-by-idempotency, lookup-by-request-ID, forced delay, forced connection loss after commit, and proven absence.

- [ ] **Step 3: Implement two independent dispatcher processes**

Each process opens the same temporary SQLite database through the real broker/AuthorityWriteHost path, receives explicit kill points, and reports only redacted identifiers.

- [ ] **Step 4: Implement all fault rows**

Cover kill before call; after attempt before call; during call; success before receipt; receipt before terminal; duplicate dispatchers; lease takeover; stale owner/generation/host/fencing; heartbeat loss; clock jumps; deadline positions; cancellation positions; retryable/permanent failures; success/absence/unknown reconciliation; checkpoint rolling; restart from all nonterminal states.

- [ ] **Step 5: Assert duplicate-side-effect count is zero**

For each operation kind, prove one physical side effect at most. Unknown outcome must block a second call until absence is proven.

- [ ] **Step 6: Run the matrix locally**

```bash
node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpB/processFaultMatrixContract.test.js
node tools/architecture-closure-v2/wp-b-process-fault-matrix.js
```

- [ ] **Step 7: Add Ubuntu and Windows execution**

The permanent WP-B workflow runs the same matrix on both operating systems against the exact Head. Platform-specific process termination is isolated in the harness; expected semantic results are identical.

- [ ] **Step 8: Commit the matrix**

```bash
git add tools/architecture-closure-v2/wp-b-process-fault-matrix.js \
  tools/architecture-closure-v2/fixtures/wp-b-fake-remote.js \
  tools/architecture-closure-v2/fixtures/wp-b-dispatcher-process.js \
  backend/tests/architectureClosureV2/wpB/processFaultMatrixContract.test.js \
  governance/architecture-closure-v2/wp-b-operation-inventory.json \
  .github/workflows/wp-b-validation.yml
git commit -m "test(acv2): prove WP-B process fault recovery"
```

### Task 11: Run complete validation and independent Review Gate 2

**Files:**
- Create: `governance/architecture-closure-v2/wp-b-m2-review.json`
- Create: `tools/architecture-closure-v2/verify-wp-b-m2-review.js`
- Create: `backend/tests/architectureClosureV2/wpB/m2IndependentReviewIntegrity.test.js`
- Create: `.github/workflows/wp-b-m2-independent-review-integrity.yml`
- Modify: `tools/architecture-closure-v2/run-wp-b-contracts.js`
- Modify: `.github/workflows/wp-b-validation.yml`

**Interfaces:**
- Produces: exact-head review receipt and local/remote verifier.

- [ ] **Step 1: Run complete local contracts**

```bash
node tools/architecture-closure-v2/run-wp-b-contracts.js --milestone 2
node tools/architecture-closure-v2/wp-b-process-fault-matrix.js
npm run test:acv2:wp-a
npm run test:security-scan
npm run test:round12-platform-core
npm run test:source-uat-delivery
```

- [ ] **Step 2: Run exact-head Ubuntu and Windows formal workflows**

Require successful WP-B validation, WP0 architecture gates, WP-A architecture gates, WP-A post-merge validation, and M2 independent-review integrity on the same candidate Head.

- [ ] **Step 3: Perform separate source review**

Review exact changed files and verify six operation migrations, attempt-before-call, no blind retry, restart decisions, stale-token rejection, deadline/cancellation separation, migrated-operation old-call blocking, exact scope, and leak absence.

- [ ] **Step 4: Record findings before remediation**

Every blocker/high finding receives an ID, severity, affected invariant, reproducible test, and required structural resolution. Review state remains `CHANGES_REQUIRED` until resolved.

- [ ] **Step 5: Remediate through root refactoring**

Add failing regression tests, reproduce RED, change the schema/authority/ownership/call boundary, and rerun all affected matrices. Do not weaken the review test or widen scope without an authorization amendment.

- [ ] **Step 6: Create the reviewed-head receipt**

Record reviewed candidate Head, parent M1 seal, changed-file count and ordered set SHA-256, key blob SHAs, RED evidence, all GREEN run/job IDs, review identity/mode, findings/resolutions, and all closed downstream flags.

- [ ] **Step 7: Commit Review Gate 2 evidence**

```bash
git add governance/architecture-closure-v2/wp-b-m2-review.json \
  tools/architecture-closure-v2/verify-wp-b-m2-review.js \
  backend/tests/architectureClosureV2/wpB/m2IndependentReviewIntegrity.test.js \
  .github/workflows/wp-b-m2-independent-review-integrity.yml \
  tools/architecture-closure-v2/run-wp-b-contracts.js \
  .github/workflows/wp-b-validation.yml
git commit -m "governance(acv2): record WP-B milestone two review"
```

### Task 12: Seal Milestone 2 without opening Milestone 3

**Files:**
- Create: `backend/tests/architectureClosureV2/wpB/m2ReviewSeal.test.js`
- Modify: `governance/architecture-closure-v2/wp-b-m2-review.json`
- Modify: `tools/architecture-closure-v2/verify-wp-b-m2-review.js`
- Modify: `.github/workflows/wp-b-m2-independent-review-integrity.yml`
- Modify: Pull request #17 body only after the seal verifier passes.

**Interfaces:**
- Produces: immutable `milestone2=SEALED` receipt and exact seal-only delta verification.

- [ ] **Step 1: Write seal mutation tests**

Reject changes to reviewed Head, parent M1 seal, file-set digest, operation order, finding resolutions, workflow evidence, or any downstream flag. Reject production-source files in the seal-only delta.

- [ ] **Step 2: Define the exact seal-only path set**

Only these paths may change after the reviewed implementation Head:

```text
.github/workflows/wp-b-m2-independent-review-integrity.yml
backend/tests/architectureClosureV2/wpB/m2ReviewSeal.test.js
governance/architecture-closure-v2/wp-b-m2-review.json
tools/architecture-closure-v2/verify-wp-b-m2-review.js
```

- [ ] **Step 3: Run local and authenticated remote seal verification**

```bash
node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpB/m2ReviewSeal.test.js
node tools/architecture-closure-v2/verify-wp-b-m2-review.js --remote
```

- [ ] **Step 4: Verify all formal workflows on the exact Seal Head**

All required workflows must complete successfully against the seal commit itself. Evidence from the reviewed implementation Head remains separately recorded.

- [ ] **Step 5: Update the Draft PR body**

State that M1 and M2 are sealed, M3 is not started/not authorized, and merge, production use, WP-C, release, and publish remain closed. Do not mark Ready or merge.

- [ ] **Step 6: Final commit**

```bash
git add .github/workflows/wp-b-m2-independent-review-integrity.yml \
  backend/tests/architectureClosureV2/wpB/m2ReviewSeal.test.js \
  governance/architecture-closure-v2/wp-b-m2-review.json \
  tools/architecture-closure-v2/verify-wp-b-m2-review.js
git commit -m "governance(acv2): seal WP-B milestone two"
```

## Plan Self-Review

- Spec coverage: authorization, credible RED, six fixed operation migrations, restart authority, two-process fault matrix, same-Head cross-platform gates, independent review, remediation, and seal are each mapped to one or more tasks.
- Scope boundary: Milestone 2 closes callable old paths for the six migrated operations only. Repository-wide final source closure remains Milestone 3.
- Placeholder scan: no `TBD`, `TODO`, “similar to,” deferred error handling, or unspecified test step is permitted.
- Type consistency: all operation Adapters use `perform(attemptEnvelope)` and `reconcile(reconciliationEnvelope)`; recovery uses the five approved decisions; review/seal verifiers bind the same M1 parent Head and six-operation order.
- Governance consistency: every task preserves Draft/unmerged status and keeps Milestone 3, merge, production use, WP-C, release, and publish unauthorized.
