# Batch39 Eight-Blocker Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the eight independently reviewed Batch39 closures on the
verified Batch38 commit while preserving the external Windows evidence block.

**Architecture:** Add the smallest durable or generation authority at each
existing production seam. Keep channel lifecycles independent, use one isolated
AI execution handle, and make all release decisions evidence-bound and
fail-closed.

**Tech Stack:** Node.js CommonJS, `node:test`, Node `DatabaseSync`, child
process IPC, existing Telegram/WhatsApp/Facebook adapters.

## Global Constraints

- Baseline is commit `5a137300b5599d75f30e05c1a849378ed8ecc7b4`.
- Use RED/GREEN TDD for every product behavior change.
- Do not add runtime dependencies.
- Do not commit ZIPs, logs, evidence output, backups, `node_modules`, or
  temporary directories.
- Do not claim the historical commit `1ff57e9b` or its tree was recreated.
- Keep `WINDOWS_UAT_BLOCKED=true`, `readyForPromotion=false`, and
  `formalRelease=false` until real Windows evidence is collected.

---

### Task 1: Atomic account-lane claim exclusion

**Files:**
- Modify: `backend/lib/r32SqliteStore.js`
- Create: `backend/tests/batch39AccountLaneClaim.test.js`

**Interfaces:**
- Consumes persisted `unknown_scope`, `unknown_lane`, `account_id`, and
  `payload_json.platform`.
- Produces an atomic `claimNextSend()` candidate query that skips only a
  matching unresolved account lane.

- [ ] **Step 1: Write the failing test**

Create a real `R32SqliteStore` fixture with:

- account A `send_outcome_unknown` scoped to `telegram:account-a`;
- pending rows for account A and account B with valid route versions;
- a legacy account-scoped unknown whose `unknown_lane` is empty but whose
  persisted payload and account identify the lane.

Assert the first claim returns account B, account A remains pending, command
scope blocks only its command, and global scope still blocks all claims.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39AccountLaneClaim.test.js
```

Expected: account A is claimed because the current candidate `SELECT` has no
unknown-lane exclusion.

- [ ] **Step 3: Implement the minimal SQL exclusion**

Add `NOT EXISTS` predicates inside the `claimNextSend()` candidate `SELECT`.
Normalize the candidate and blocker lane as lower-case
`platform || ':' || account_id`; use `unknown_lane` when present and derive the
legacy lane from `payload_json` plus `account_id` otherwise. Preserve the
existing global and command semantics and keep selection plus CAS update in the
same transaction.

- [ ] **Step 4: Run GREEN and inherited send-queue tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39AccountLaneClaim.test.js \
  backend/tests/batch27DeveloperHandoffV2Closure.test.js \
  backend/tests/batch28IndependentReviewRootClosure.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/lib/r32SqliteStore.js backend/tests/batch39AccountLaneClaim.test.js
git commit -m "fix: exclude unresolved account lanes atomically"
```

### Task 2: Verifiable AI physical execution

**Files:**
- Create: `backend/services/modelExecutionHost.js`
- Create: `backend/services/modelExecutionWorker.js`
- Modify: `backend/services/modelExecutor.js`
- Modify: `backend/services/aiGateway.js`
- Modify: `backend/services/jobQueue.js`
- Create: `backend/tests/batch39AiPhysicalExecution.test.js`

**Interfaces:**
- Produces `startModelExecution({ model, messages, options, signal })`.
- Returns `{ executionId, result, updateProvider(providerKey),
  requestTermination(reason), exit }`.
- `exit` resolves only from child exit and includes matching `executionId`,
  integer `exitCode` or a nonempty `signal`, and `terminated`.

- [ ] **Step 1: Write failing production-path tests**

Use fixture workers that ignore cooperative abort, change from primary to
fallback provider, and exit after a controlled delay. Assert logical timeout
does not release physical capacity before the matching exit receipt; a
mismatched or truthy-only termination result does not release it; the slot
reopens after verified exit; and zombie/circuit ownership follows the provider
active at timeout.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39AiPhysicalExecution.test.js
```

Expected: current `hardTerminate` accepts any value except `false` and can
release the slot without process-exit proof.

- [ ] **Step 3: Implement the execution host**

Fork `modelExecutionWorker.js` with one immutable UUID. Exchange structured
`provider`, `result`, and serialized `error` messages. `requestTermination()`
first aborts cooperatively, then sends the bounded hard termination request.
Resolve `exit` only from the child's `exit` event. Update `job.providerKey`
before each candidate attempt. In `JobQueue`, validate receipt execution ID and
exit code/signal before `releasePhysical()`.

- [ ] **Step 4: Run GREEN and inherited AI tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39AiPhysicalExecution.test.js \
  backend/tests/batch28IndependentReviewRootClosure.test.js \
  backend/tests/aiGatewayQualityEnforcement.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/services/modelExecutionHost.js \
  backend/services/modelExecutionWorker.js backend/services/modelExecutor.js \
  backend/services/aiGateway.js backend/services/jobQueue.js \
  backend/tests/batch39AiPhysicalExecution.test.js
git commit -m "fix: verify AI physical execution exit"
```

### Task 3: AI translation cancellation and final-commit fence

**Files:**
- Modify: `backend/repositories/workspaceRepository.js`
- Modify: `backend/services/socialChineseUnderstandingService.js`
- Modify: `backend/services/aiGateway.js`
- Create: `backend/tests/batch39AiTranslationFence.test.js`

**Interfaces:**
- Consumes one `{ signal, generation, assertCurrent }` execution context.
- Produces no profile, insight, or completed-run write after abort or generation
  supersession.

- [ ] **Step 1: Write failing deferred-result tests**

Defer translation and schema-repair model calls. Abort or supersede after each
call begins and before the final transaction. Assert no later model call, no
profile/insight write, and no completed analysis receipt. Also assert the
existing persona version/hash CAS still rejects stale input.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39AiTranslationFence.test.js
```

- [ ] **Step 3: Thread the execution context**

Pass the same signal from workspace analysis into the understanding service and
gateway. Call `assertCurrent()` before each model call, after every await,
before the transaction, and inside it immediately before writes. Map abort and
generation errors to a non-success terminal state without recording a completed
analysis.

- [ ] **Step 4: Run GREEN and inherited analysis tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39AiTranslationFence.test.js \
  backend/tests/batch28IndependentReviewRootClosure.test.js \
  backend/tests/socialChineseUnderstandingService.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/repositories/workspaceRepository.js \
  backend/services/socialChineseUnderstandingService.js \
  backend/services/aiGateway.js backend/tests/batch39AiTranslationFence.test.js
git commit -m "fix: fence cancelled AI analysis commits"
```

### Task 4: Scoped and due-aware AI startup recovery

**Files:**
- Modify: `backend/repositories/workspaceRepository.js`
- Create: `backend/tests/batch39AiRecoveryScope.test.js`

**Interfaces:**
- Consumes background-job snapshots for
  `jobType='ai-conversation-analysis'`.
- Produces bounded pages ordered by immutable `created_at + job_id`.

- [ ] **Step 1: Write failing recovery tests**

Persist due and future `RETRY_WAIT` analysis jobs, stale `RUNNING`, `PENDING`,
and unrelated job types. Assert only due analysis work is acquired, unrelated
rows remain byte-identical, cursor progression is stable while earlier rows
become terminal, and page/time limits expose remaining/oldest metrics.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39AiRecoveryScope.test.js
```

- [ ] **Step 3: Implement scoped recovery**

Remove unscoped recovery and `force:true`. Snapshot only the analysis job type
and eligible states, honor `next_attempt_at`, page by `created_at + job_id`,
and stop at explicit page/time budgets. Publish scanned, recovered, remaining,
oldest, pages, and budget-exhausted metrics.

- [ ] **Step 4: Run GREEN and inherited recovery tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39AiRecoveryScope.test.js \
  backend/tests/batch28IndependentReviewRootClosure.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/repositories/workspaceRepository.js \
  backend/tests/batch39AiRecoveryScope.test.js
git commit -m "fix: scope AI analysis startup recovery"
```

### Task 5: Telegram session-generation fence

**Files:**
- Create: `backend/services/sessionGenerationFence.js`
- Modify: `backend/services/telegramAdapter.js`
- Create: `backend/tests/batch39TelegramSessionFence.test.js`

**Interfaces:**
- Produces `{ token, isCurrent(), assertCurrent() }`.
- Stores the removable Telegram main message handler on the session row.

- [ ] **Step 1: Write failing stale-handler tests**

Capture the old handler, disconnect/reconnect, then invoke the old handler with
deferred persistence and enrichment boundaries. Assert no checkpoint, message,
notification, enrichment job, or error-side mutation belongs to the new
session. Assert disconnect removes the exact handler.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39TelegramSessionFence.test.js
```

- [ ] **Step 3: Implement the shared fence and Telegram checks**

Issue a token per `makeRow()`, store the main handler, and check it at callback
entry, after awaited persistence, before checkpoint commit, notification,
enrichment scheduling, and error cleanup. Invalidate the token and remove the
stored handler before disconnect awaits.

- [ ] **Step 4: Run GREEN and inherited Telegram tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39TelegramSessionFence.test.js \
  backend/tests/telegramHistorySyncRegression.test.js \
  backend/tests/batch27SystemRegressionClosure.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/services/sessionGenerationFence.js \
  backend/services/telegramAdapter.js \
  backend/tests/batch39TelegramSessionFence.test.js
git commit -m "fix: quarantine stale Telegram handlers"
```

### Task 6: WhatsApp socket-generation fence

**Files:**
- Modify: `backend/services/whatsappAdapter.js`
- Create: `backend/tests/batch39WhatsappSessionFence.test.js`

**Interfaces:**
- Consumes the shared session-generation fence and authoritative socket
  identity.
- Produces zero effects from callbacks whose generation or socket is stale.

- [ ] **Step 1: Write failing stale-socket tests**

Capture callbacks for credentials, connection updates, history, messages,
media, presence, receipts, chats, and contacts. Replace the socket while
deferred awaits are outstanding, then assert the old callbacks cannot persist,
notify, enqueue, reconnect, or mutate public session status.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39WhatsappSessionFence.test.js
```

- [ ] **Step 3: Apply generation plus socket checks**

Check both `fence.isCurrent()` and `row.socket === socket` at callback entry,
after each await, and immediately before every durable or visible effect.
Invalidate the fence before replacing or closing the socket.

- [ ] **Step 4: Run GREEN and inherited WhatsApp tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39WhatsappSessionFence.test.js \
  backend/tests/whatsappCanonicalGuardRegression.test.js \
  backend/tests/whatsappReceiptRecoveryRegression.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/services/whatsappAdapter.js \
  backend/tests/batch39WhatsappSessionFence.test.js
git commit -m "fix: quarantine stale WhatsApp socket callbacks"
```

### Task 7: Facebook relay generation and ACK fence

**Files:**
- Modify: `backend/services/facebookRelayClient.js`
- Create: `backend/tests/batch39FacebookRelayFence.test.js`

**Interfaces:**
- Consumes one session fence and poll abort controller per relay connection.
- Produces ACKs only for events durably processed by the same live generation.

- [ ] **Step 1: Write failing stale-poll tests**

Defer `/events`, local webhook persistence, and `/ack`; disconnect/reconnect at
each boundary. Assert the old poll does not persist, add an ACK candidate, call
`/ack`, update health, or schedule another poll. Assert a local processing
failure never enters the ACK set.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 backend/tests/batch39FacebookRelayFence.test.js
```

- [ ] **Step 3: Fence the poll lifecycle**

Invalidate and abort before disconnect awaits. Revalidate after `/events`,
around every event persistence call, before adding each ACK candidate, before
`/ack`, after `/ack`, and before state/statistics/timer updates.

- [ ] **Step 4: Run GREEN and inherited Facebook tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39FacebookRelayFence.test.js \
  backend/tests/facebookProductionReadinessRegression.test.js \
  backend/tests/facebookFormalWorkerIntegrationRegression.test.js
```

- [ ] **Step 5: Commit and checkpoint**

```bash
git add backend/services/facebookRelayClient.js \
  backend/tests/batch39FacebookRelayFence.test.js
git commit -m "fix: fence stale Facebook relay polls"
```

### Task 8: Shared strict WP3 summary authority

**Files:**
- Create: `tools/wp3/test-summary.js`
- Modify: `tools/wp3/generate-evidence.js`
- Modify: `tools/wp3/windows-named-mutex-evidence.js`
- Create: `tests/wp3/test-summary-contract.test.js`
- Modify: `tests/wp3/evidence-generator-isolation.test.js`

**Interfaces:**
- Produces `parseFinalTestSummary(output)` and
  `assertStrictTestRun({ output, exitCode, minimumTests })`.

- [ ] **Step 1: Write failing parser tests**

Cover TAP and spec reporters, multiple complete blocks, trailing partial
blocks, missing counters, nonzero fail/skipped/cancelled/todo, nonzero exit,
and tests below the required minimum. Assert only the final complete block can
authorize evidence.

- [ ] **Step 2: Run RED**

```bash
node --test --test-concurrency=1 tests/wp3/test-summary-contract.test.js
```

- [ ] **Step 3: Implement and use one parser**

Parse complete blocks containing tests/pass/fail/skipped/cancelled/todo. Reject
missing counters. `assertStrictTestRun()` requires integer counters, exit zero,
tests at least the minimum, pass equal tests, and every non-pass counter zero.
Replace both local parser/regex implementations with this shared authority.

- [ ] **Step 4: Run GREEN, WP3, and Batch39 focused gates**

```bash
node --test --test-concurrency=1 \
  tests/wp3/test-summary-contract.test.js \
  tests/wp3/evidence-generator-isolation.test.js
node --test --test-concurrency=1 tests/wp3/*.test.js
node --test --test-concurrency=1 backend/tests/batch39*.test.js
```

The real Windows Named Mutex test remains an explicit non-Windows skip and is
not counted as external evidence.

- [ ] **Step 5: Commit and checkpoint**

```bash
git add tools/wp3/test-summary.js tools/wp3/generate-evidence.js \
  tools/wp3/windows-named-mutex-evidence.js \
  tests/wp3/test-summary-contract.test.js \
  tests/wp3/evidence-generator-isolation.test.js
git commit -m "fix: unify strict WP3 test summaries"
```

### Task 9: Batch39 verification, audit, and reconstructed acceptance package

**Files:**
- Create: `docs/release/batch39-reconstruction-report-zh.md`
- Create: `scripts/create-batch39-windows-acceptance.js`
- Modify: `package.json`

**Interfaces:**
- Consumes all eight repair commits and fresh test evidence.
- Produces a Windows acceptance package bound to the new commit/tree and a
  report that preserves the external-evidence block.

- [ ] **Step 1: Run syntax and focused gates**

```bash
node --check backend/lib/r32SqliteStore.js
node --check backend/services/modelExecutionHost.js
node --check backend/services/modelExecutionWorker.js
node --check backend/services/telegramAdapter.js
node --check backend/services/whatsappAdapter.js
node --check backend/services/facebookRelayClient.js
node --test --test-concurrency=1 backend/tests/batch39*.test.js
```

- [ ] **Step 2: Run inherited and WP3 gates**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch27DeveloperHandoffV2Closure.test.js \
  backend/tests/batch28IndependentReviewRootClosure.test.js
node --test --test-concurrency=1 tests/wp3/*.test.js
```

- [ ] **Step 3: Independently trace all eight production paths**

Confirm each test reaches the production entry and each generation/exit check
precedes the actual side effect. Search the changed paths for swallowed
governance errors, truthy termination contracts, unscoped recovery, and ACKs
added before local success.

- [ ] **Step 4: Write the report and package generator**

The generator writes a manifest, Windows command file, and Chinese instructions
using the current `git rev-parse HEAD` and `HEAD^{tree}`. It must never include
PASS evidence. The report records exact new commits, counters, environment
limits, and:

```text
WINDOWS_UAT_BLOCKED=true
readyForPromotion=false
formalRelease=false
```

- [ ] **Step 5: Verify, commit, and checkpoint**

```bash
npm run create:batch39:windows-acceptance
git diff --check
git add docs/release/batch39-reconstruction-report-zh.md \
  scripts/create-batch39-windows-acceptance.js package.json
git commit -m "docs: bind reconstructed Batch39 acceptance"
```
