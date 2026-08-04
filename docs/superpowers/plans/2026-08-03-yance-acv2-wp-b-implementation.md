# Yance ACV2 WP-B Durable Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace application-level durable-task checks and direct external side effects with one Schema 23 database-CAS execution authority, a committed external-action outbox, deterministic recovery, and fail-closed open-source adoption governance.

**Architecture:** WP-B upgrades the existing `DurableExecutionAuthority` in place and keeps WP-A's `AuthorityWriteHost`, `AuthorityTransactionCoordinator`, and canonical ledger as the only write path. XState 5.32.5 is used only behind a Yance-owned pure lifecycle Adapter; Temporal contributes architecture and failure-test semantics only. All external calls follow `execution → intent → claim → persisted attempt → physical call outside transaction → receipt or uncertain outcome → reconciliation`.

**Tech Stack:** Node.js 22, CommonJS, built-in `node:sqlite`, Electron, `node:test`, XState 5.32.5, npm 10.9.2, GitHub Actions on Ubuntu and Windows.

## Global Constraints

- Work branch: `acv2/wp-b-durable-execution-outbox`.
- Baseline: `main@e53bf933a8f4e3273e515587d917433df24d6feb`.
- Migration ID: `023_architecture_closure_v2_wp_b`.
- Target schema: `23`; migrations 001–022 are immutable.
- Formal Milestones: exactly three; formal independent reviews occur only at Milestone 1, Milestone 2, and final closure.
- RED evidence must be committed before Schema 23, XState, or WP-B production implementation is added.
- No caller bypass, warning-only guard, test skip, timeout inflation, dual business write, or feature-flag substitute is permitted.
- Every state mutation must use database-enforced CAS; application prechecks may improve diagnostics but never establish authority.
- Every public command, snapshot, intent, attempt, receipt, reconciliation, and recovery decision must be recursively frozen.
- Business timestamps are explicit authority inputs; WP-B tables may not use `CURRENT_TIMESTAMP` or implicit business-time defaults.
- A physical external action may run only after a committed intent and persisted attempt, and never inside a SQLite transaction.
- `UNCERTAIN_REMOTE_OUTCOME` is a first-class nonterminal state; automatic retry is forbidden until reconciliation proves remote absence.
- API keys, OAuth material, cookies, sessions, chat bodies, prompt bodies, and binary payloads are forbidden in execution history, outbox metadata, evidence, logs, and artifacts.
- The open-source sequence is ordered and fail-closed: candidate → exact version/license → dependency/security scan → adoption mode → Yance RED → original module → upstream tests → Yance Adapter → Ubuntu/Windows/fault injection → copyright/NOTICE/SBOM/provenance → independent review.
- `formalRelease=false`, `publish=false`, and `wpCAuthorized=false` throughout WP-B implementation.

---

## File Map

### Governance and provenance

- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json` — ordered eleven-step gate and current candidate states.
- Create: `governance/architecture-closure-v2/wp-b-baseline.json` — baseline Head, branch, Schema 23, Milestone gates, exact source roots.
- Create: `governance/architecture-closure-v2/wp-b-operation-inventory.json` — every operation, external call, recovery, timer, fallback, and removal condition.
- Create: `governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json` — XState 5.32.5 and Temporal reference records with evidence fields.
- Create: `governance/architecture-closure-v2/wp-b-m1-red-evidence.json` — pinned failing tests before production implementation.
- Create: `governance/architecture-closure-v2/wp-b-m1-review.json` — independent Milestone 1 result.
- Create: `governance/architecture-closure-v2/wp-b-m2-review.json` — independent Milestone 2 result.
- Create: `governance/architecture-closure-v2/wp-b-closure.json` — final machine-readable closure receipt.

### Shared foundation

- Create: `backend/lib/deepFreeze.js` — cycle-safe recursive freeze used by WP-A and WP-B public objects.
- Create: `backend/services/authorityTimestamp.js` — strict authority-issued ISO timestamp values and monotonic command-time validation.
- Create: `backend/services/xstateLifecycleAdapter.js` — the only production import boundary for `xstate`.
- Create: `backend/services/durableExecutionLifecycle.js` — Yance-owned states, events, terminal rules, and transition API.
- Modify: `backend/services/authorityTransactionCoordinator.js` — use shared deep freeze and expose a transaction-I/O capability guard without changing WP-A receipt semantics.

### Schema and authorities

- Create: `backend/migrations/architectureClosureV2WpB.js` — forward-only Schema 23 migration, constraints, triggers, indexes, checksum, reopen validation.
- Modify: `backend/lib/r32SqliteStore.js` — register and apply Schema 23 after Schema 22.
- Modify: `backend/services/durableExecutionAuthority.js` — upgrade in place to V2 CAS, hash binding, lease, fencing, explicit time, checkpoint and receipt references.
- Create: `backend/services/externalActionOutboxAuthority.js` — intent, claim, attempt, receipt and late-result persistence.
- Create: `backend/services/externalActionDispatcher.js` — two-phase dispatcher with no I/O in authority transactions.
- Create: `backend/services/externalOutcomeReconciliation.js` — success/absence/unknown/manual reconciliation protocol.
- Create: `backend/services/durableExecutionRecoveryAuthority.js` — startup and lease-expiry recovery through commands, not direct writes.

### Business operation boundary

- Create: `backend/services/durableOperationRegistry.js` — six mandatory operation-kind definitions and Adapter validation.
- Create: `backend/services/durableOperations/aiProviderExecutionOperation.js`.
- Create: `backend/services/durableOperations/outboundMessageSendOperation.js`.
- Create: `backend/services/durableOperations/deliveryReceiptReconciliationOperation.js`.
- Create: `backend/services/durableOperations/mediaTransferOperation.js`.
- Create: `backend/services/durableOperations/historySynchronizationOperation.js`.
- Create: `backend/services/durableOperations/sessionRestoreOperation.js`.
- Modify: `backend/services/modelExecutionHost.js` — submit AI provider execution through WP-B and report worker result as receipt/uncertain outcome.
- Modify: `backend/services/communicationAuthority.js` — create message-send, receipt-query, media and sync operations instead of owning physical calls.
- Modify: `backend/services/channelAdapterRuntime.js` — implement physical Adapter calls only from a persisted WP-B attempt.
- Modify: `backend/runtime/AppRuntimeComposition.js` — compose one dispatcher, recovery authority, operation registry and Adapter map.
- Modify: `backend/runtime/AppRuntimeFactory.js` — inject the current AuthorityWriteHost-backed coordinator and explicit authority clock.
- Modify: `backend/server.js` — run WP-B recovery after write-host acquisition and before readiness.

### Verification

- Create: `backend/tests/architectureClosureV2/wpB/openSourceAdoptionGate.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/lifecycleContract.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/deepFreezeAndTimestamp.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/schema23Migration.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/transactionIoBoundary.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js`.
- Create: `backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js`.
- Create: `tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js`.
- Create: `tools/architecture-closure-v2/capture-wp-b-red-evidence.js`.
- Create: `tools/architecture-closure-v2/run-wp-b-contracts.js`.
- Create: `tools/architecture-closure-v2/wp-b-process-fault-matrix.js`.
- Modify: `tools/architecture-closure-v2/source-closure-scan.js` — select WP-specific baseline and registry while preserving exact WP-A behavior.
- Modify: `package.json` and `package-lock.json` — pin XState and add WP-B scripts.
- Create: `.github/workflows/wp-b-validation.yml`.
- Create: `.github/workflows/wp-b-post-merge-validation.yml` during Milestone 3 only.

---

# Milestone 1 — Contract and Core Foundation

## Task 1: Freeze WP-B baseline, operation inventory and open-source admission

**Files:**
- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json`
- Create: `governance/architecture-closure-v2/wp-b-baseline.json`
- Create: `governance/architecture-closure-v2/wp-b-operation-inventory.json`
- Create: `governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json`
- Create: `tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js`
- Create: `backend/tests/architectureClosureV2/wpB/openSourceAdoptionGate.test.js`

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-08-03-yance-acv2-wp-b-three-milestone-design.md` and ordered gate at `docs/superpowers/specs/2026-08-03-yance-acv2-open-source-adoption-gate.md`.
- Produces: `verifyRegistry({ gate, registry, baseline, repositoryRoot }) -> { ok, violations, candidateResults }`.

- [ ] **Step 1: Write the failing governance test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { verifyFiles } = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

test('WP-B open-source admission is ordered, exact-versioned and fail-closed', () => {
  const report = verifyFiles(path.resolve(__dirname, '../../../..'));
  assert.equal(report.ok, true);
  assert.deepEqual(report.orderedStepIds, [
    'CANDIDATE_SELECTED', 'EXACT_VERSION_LICENSE_REVIEWED', 'DEPENDENCY_SECURITY_SCANNED',
    'ADOPTION_MODE_DECIDED', 'YANCE_RED_COMMITTED', 'ORIGINAL_MODULE_INTRODUCED',
    'UPSTREAM_TESTS_GREEN', 'YANCE_ADAPTER_GREEN', 'PLATFORM_FAULT_MATRIX_GREEN',
    'COPYRIGHT_NOTICE_SBOM_PROVENANCE_RECORDED', 'INDEPENDENT_REVIEW_APPROVED'
  ]);
  assert.equal(report.candidates.xstate.exactVersion, '5.32.5');
  assert.equal(report.candidates.xstate.license, 'MIT');
  assert.equal(report.candidates.temporal.adoptionMode, 'REFERENCE_ONLY');
  assert.equal(report.productionUseAuthorized, false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpB/openSourceAdoptionGate.test.js
```

Expected: FAIL with `MODULE_NOT_FOUND` for `verify-wp-b-open-source-adoption.js` or missing registry documents.

- [ ] **Step 3: Implement the machine-readable baseline and verifier**

The XState candidate record must be exact and initially non-authorized:

```json
{
  "candidateId": "XSTATE_CORE_5_32_5",
  "repository": "statelyai/xstate",
  "package": "xstate",
  "exactVersion": "5.32.5",
  "license": "MIT",
  "adoptionMode": "DIRECT_DEPENDENCY",
  "productionUseAuthorized": false,
  "allowedResponsibilities": ["PURE_LIFECYCLE_GRAPH", "TRANSITION_VALIDATION", "MODEL_PATH_GENERATION"],
  "forbiddenResponsibilities": ["PERSISTENCE", "FENCING", "RETRY_AUTHORITY", "RECEIPT_ISSUANCE", "BUSINESS_TIME", "EXTERNAL_IO"]
}
```

The Temporal record must use `REFERENCE_ONLY` and contain no package or source-import authorization.

- [ ] **Step 4: Verify governance GREEN**

Run:

```bash
node tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js
node --test --test-concurrency=1 backend/tests/architectureClosureV2/wpB/openSourceAdoptionGate.test.js
```

Expected: PASS while both candidates remain non-authorized for production use.

- [ ] **Step 5: Commit the governance freeze**

```bash
git add governance/architecture-closure-v2/wp-b-*.json \
  tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js \
  backend/tests/architectureClosureV2/wpB/openSourceAdoptionGate.test.js
git commit -m "governance(acv2): freeze WP-B intake and operation scope"
```

## Task 2: Commit the complete Milestone 1 RED contract before production code

**Files:**
- Create: `backend/tests/architectureClosureV2/wpB/lifecycleContract.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/deepFreezeAndTimestamp.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/schema23Migration.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/transactionIoBoundary.test.js`
- Create: `backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js`
- Create: `tools/architecture-closure-v2/capture-wp-b-red-evidence.js`
- Create: `governance/architecture-closure-v2/wp-b-m1-red-evidence.json`

**Interfaces:**
- Consumes: Task 1 baseline and registry.
- Produces: executable contracts for `nextLifecycleState`, `deepFreeze`, `issueAuthorityTimestamp`, `applyArchitectureClosureV2WpB`, `DurableExecutionAuthority`, `ExternalActionOutboxAuthority`, `ExternalActionDispatcher`, and `reconcileExternalOutcome`.

- [ ] **Step 1: Write the lifecycle and immutability RED tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextLifecycleState, STATES } = require('../../../services/durableExecutionLifecycle');
const { deepFreeze } = require('../../../lib/deepFreeze');

test('uncertain outcome is nonterminal and cannot retry blindly', () => {
  assert.equal(nextLifecycleState(STATES.WAITING_REMOTE, 'REMOTE_RESULT_LOST'), STATES.UNCERTAIN_REMOTE_OUTCOME);
  assert.throws(
    () => nextLifecycleState(STATES.UNCERTAIN_REMOTE_OUTCOME, 'RETRY'),
    error => error.code === 'WP_B_RECONCILIATION_REQUIRED'
  );
});

test('public authority values are recursively frozen', () => {
  const value = deepFreeze({ nested: { items: [{ state: 'CREATED' }] } });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.nested), true);
  assert.equal(Object.isFrozen(value.nested.items), true);
  assert.equal(Object.isFrozen(value.nested.items[0]), true);
  assert.throws(() => { value.nested.items[0].state = 'FAILED'; }, TypeError);
});
```

- [ ] **Step 2: Write the database CAS RED test**

```js
test('stale generation, owner, fencing token and state version change zero rows', () => {
  const created = authority.createExecution(commandFixture());
  const claimed = authority.claim({
    executionId: created.executionId,
    expectedStateVersion: created.stateVersion,
    expectedGeneration: created.generation,
    ownerId: 'worker-1',
    claimId: 'claim-1',
    hostGeneration: 7,
    fencingToken: 19,
    authorityTimestamp: '2026-08-03T01:00:00.000Z',
    leaseExpiresAt: '2026-08-03T01:01:00.000Z'
  });
  assert.throws(() => authority.heartbeat({
    executionId: created.executionId,
    expectedStateVersion: claimed.stateVersion,
    generation: claimed.generation,
    ownerId: 'worker-2',
    claimId: 'claim-1',
    hostGeneration: 7,
    fencingToken: 19,
    authorityTimestamp: '2026-08-03T01:00:10.000Z',
    leaseExpiresAt: '2026-08-03T01:01:10.000Z'
  }), error => error.code === 'WP_B_EXECUTION_CAS_REJECTED');
});
```

- [ ] **Step 3: Write the outbox ordering and I/O-boundary RED tests**

```js
test('dispatcher persists an attempt before physical I/O', async () => {
  const observations = [];
  const dispatcher = fixtureDispatcher({
    onPersistAttempt: () => observations.push('attempt'),
    perform: async () => observations.push('io')
  });
  await dispatcher.dispatchOne();
  assert.deepEqual(observations, ['attempt', 'io']);
});

test('transaction callback cannot access external I/O capability', () => {
  assert.throws(
    () => coordinator.executeWpBCommand(fixtureCommand({ projectorCallsFetch: true })),
    error => error.code === 'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN'
  );
});
```

- [ ] **Step 4: Run the entire RED set and capture deterministic evidence**

Run:

```bash
node tools/architecture-closure-v2/capture-wp-b-red-evidence.js
```

The capture tool must execute every WP-B Milestone 1 test with `--test-concurrency=1`, require a nonzero exit, record the exact Git Head, command array, failing test names, exit code and SHA-256 of normalized output, and reject zero failures.

Expected: command exits `0` only when it successfully proves the test suite itself is RED and writes `wp-b-m1-red-evidence.json` with `productionImplementationPresent=false`.

- [ ] **Step 5: Commit RED evidence without production implementation**

```bash
git add backend/tests/architectureClosureV2/wpB \
  tools/architecture-closure-v2/capture-wp-b-red-evidence.js \
  governance/architecture-closure-v2/wp-b-m1-red-evidence.json
git commit -m "test(acv2): record complete WP-B milestone-one RED contracts"
```

## Task 3: Admit XState 5.32.5 and build the Yance pure lifecycle boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `backend/lib/deepFreeze.js`
- Create: `backend/services/authorityTimestamp.js`
- Create: `backend/services/xstateLifecycleAdapter.js`
- Create: `backend/services/durableExecutionLifecycle.js`
- Modify: `backend/services/authorityTransactionCoordinator.js`
- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json`
- Modify: `tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js`

**Interfaces:**
- Produces: `deepFreeze(value)`, `issueAuthorityTimestamp(clock)`, `assertAuthorityTimestamp(value)`, `nextLifecycleState(currentState, eventType)`, `isTerminalState(state)`, and immutable `STATES`/`EVENTS`.
- Restriction: only `backend/services/xstateLifecycleAdapter.js` may contain `require('xstate')`.

- [ ] **Step 1: Reverify exact upstream identity before installation**

Run:

```bash
npm view xstate@5.32.5 version license repository.url dist.integrity dependencies --json
git ls-remote --exit-code --tags https://github.com/statelyai/xstate.git "refs/tags/xstate@5.32.5"
```

Expected: version `5.32.5`, license `MIT`, repository `statelyai/xstate`, zero runtime dependencies, nonempty npm integrity, and an exact upstream tag. Any mismatch blocks installation and records a gate violation.

- [ ] **Step 2: Run dependency and security admission before changing production imports**

```bash
npm audit --package-lock-only --audit-level=high
npm install --package-lock-only --save-exact xstate@5.32.5
npm audit --package-lock-only --audit-level=high
```

Expected: no Critical or High finding introduced by the candidate. Commit is still forbidden at this point if the scan fails.

- [ ] **Step 3: Install the exact package and run upstream core tests at the exact tag**

```bash
npm install --save-exact xstate@5.32.5
rm -rf .tmp/wp-b-upstream-xstate
git clone --depth 1 --branch "xstate@5.32.5" https://github.com/statelyai/xstate.git .tmp/wp-b-upstream-xstate
corepack enable
cd .tmp/wp-b-upstream-xstate
pnpm install --frozen-lockfile
pnpm test:core
cd ../..
rm -rf .tmp/wp-b-upstream-xstate
```

Expected: upstream XState core tests pass. The evidence record stores the tag commit SHA, command, runtime versions and normalized output hash.

- [ ] **Step 4: Implement the Adapter and Yance-owned public lifecycle**

`xstateLifecycleAdapter.js` must expose only a pure transition function:

```js
'use strict';
const { createMachine, getNextSnapshot, getInitialSnapshot } = require('xstate');

function createLifecycleAdapter(config) {
  const machine = createMachine(config);
  return Object.freeze({
    initialState() { return String(getInitialSnapshot(machine).value); },
    transition(state, eventType) {
      const snapshot = getNextSnapshot(machine, { value: state, context: {} }, { type: eventType });
      return String(snapshot.value);
    }
  });
}

module.exports = { createLifecycleAdapter };
```

`durableExecutionLifecycle.js` owns all state names, events, guards and Yance error codes. It must explicitly reject `RETRY` from `UNCERTAIN_REMOTE_OUTCOME` with `WP_B_RECONCILIATION_REQUIRED`.

- [ ] **Step 5: Extract shared recursive freezing without weakening WP-A**

Move the cycle-safe logic from `authorityTransactionCoordinator.js` to `backend/lib/deepFreeze.js`, import it back into the coordinator, and keep all existing WP-A return values immutable.

- [ ] **Step 6: Run focused and WP-A regression tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/lifecycleContract.test.js \
  backend/tests/architectureClosureV2/wpB/deepFreezeAndTimestamp.test.js \
  backend/tests/architectureClosureV2/wpA/authorityTransactionCoordinator.test.js \
  backend/tests/architectureClosureV2/wpA/authorityTransactionCoordinatorHardening.test.js
node tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js
```

Expected: lifecycle/freeze tests GREEN; open-source gate reports Steps 1–8 complete for XState but Steps 9–11 still incomplete.

- [ ] **Step 7: Commit the admitted dependency and Adapter**

```bash
git add package.json package-lock.json backend/lib/deepFreeze.js \
  backend/services/authorityTimestamp.js backend/services/xstateLifecycleAdapter.js \
  backend/services/durableExecutionLifecycle.js backend/services/authorityTransactionCoordinator.js \
  governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json \
  tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js
git commit -m "feat(acv2): add admitted WP-B lifecycle foundation"
```

## Task 4: Add Schema 23 and upgrade DurableExecutionAuthority to database CAS

**Files:**
- Create: `backend/migrations/architectureClosureV2WpB.js`
- Modify: `backend/lib/r32SqliteStore.js`
- Modify: `backend/services/durableExecutionAuthority.js`
- Test: `backend/tests/architectureClosureV2/wpB/schema23Migration.test.js`
- Test: `backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js`

**Interfaces:**
- `createExecution(input) -> frozen ExecutionSnapshot`.
- `transition(input) -> frozen ExecutionSnapshot`.
- Required input fields: `executionId`, `expectedStateVersion`, `allowedStates`, `targetState`, `generation`, `ownerId`, `claimId`, `hostGeneration`, `fencingToken`, `authorityTimestamp`.

- [ ] **Step 1: Implement the forward-only migration contract**

`architectureClosureV2WpB.js` must export:

```js
const MIGRATION_ID = '023_architecture_closure_v2_wp_b';
const TARGET_SCHEMA_VERSION = 23;
const MIGRATION_CHECKSUM = crypto.createHash('sha256')
  .update(JSON.stringify({ migrationId: MIGRATION_ID, contract: WP_B_SCHEMA_CONTRACT }))
  .digest('hex');
```

The migration must add execution columns for command hash, state version, host generation, fencing token, claim ID, lease start/expiry, heartbeat sequence, deadline, remote request, cancellation/terminal/late receipt IDs, retry policy version, checkpoint version, and explicit timestamps. It must create `external_action_intents`, `external_action_attempts`, `external_action_receipts`, `external_outcome_reconciliations`, and `durable_execution_checkpoints` with hash constraints and append-only triggers where facts are immutable.

- [ ] **Step 2: Register Schema 23 in the store**

Import `applyArchitectureClosureV2WpB` and `ACV2_WP_B_SCHEMA_VERSION` in `r32SqliteStore.js`, include version 23 in `SCHEMA_VERSION`, and invoke the migration after Schema 22. Opening a version greater than 23 must continue to fail fast.

- [ ] **Step 3: Replace unconditional update with one CAS statement**

The authoritative transition SQL must follow this shape:

```sql
UPDATE durable_executions
SET state=?, state_version=state_version+1, generation=?, owner_id=?, claim_id=?,
    host_generation=?, fencing_token=?, lease_started_at=?, lease_expires_at=?,
    heartbeat_sequence=?, updated_at=?, completed_at=?
WHERE execution_id=?
  AND state IN (SELECT value FROM json_each(?))
  AND state_version=?
  AND generation=?
  AND owner_id=?
  AND claim_id=?
  AND host_generation=?
  AND fencing_token=?
  AND EXISTS (
    SELECT 1 FROM authority_write_host_lease
    WHERE singleton_id=1 AND state='ACTIVE'
      AND host_generation=? AND fencing_token=?
  );
```

The exact allowed-state representation may use generated placeholders instead of `json_each`, but all concurrency predicates must remain in the SQL `WHERE` clause. `changes !== 1` throws `WP_B_EXECUTION_CAS_REJECTED`.

- [ ] **Step 4: Bind idempotency keys to canonical command hashes**

`createExecution` must return the original execution for the same operation kind, idempotency key and hash; a different hash throws `WP_B_EXECUTION_IDEMPOTENCY_CONFLICT`. The lowercase SHA-256 shape and hash version are enforced by Schema 23 triggers.

- [ ] **Step 5: Preserve compatibility through delegation, not a second writer**

Existing methods `schedule`, `claim`, `heartbeat`, `waitRemote`, `succeed`, `fail`, `requestCancel`, `acknowledgeCancel`, `retry`, and `deadLetter` remain public facades but must call the single V2 transition path. They may read the current snapshot to form expected CAS inputs; they may not execute legacy SQL.

- [ ] **Step 6: Run migration and CAS tests**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/schema23Migration.test.js \
  backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js \
  backend/tests/architectureClosureV2/wpA/schema22PostMergeIntegrityMigration.test.js \
  tests/wp5/m5-sqlite-ownership.test.js
```

Expected: Schema 1–23 upgrade, reopen, checksum mismatch, future-schema rejection, idempotency conflict and stale CAS matrices all GREEN.

- [ ] **Step 7: Commit Schema 23 and CAS authority**

```bash
git add backend/migrations/architectureClosureV2WpB.js backend/lib/r32SqliteStore.js \
  backend/services/durableExecutionAuthority.js \
  backend/tests/architectureClosureV2/wpB/schema23Migration.test.js \
  backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js
git commit -m "feat(acv2): enforce Schema 23 durable execution CAS"
```

## Task 5: Implement committed outbox, dispatcher and uncertain-outcome reconciliation

**Files:**
- Create: `backend/services/externalActionOutboxAuthority.js`
- Create: `backend/services/externalActionDispatcher.js`
- Create: `backend/services/externalOutcomeReconciliation.js`
- Test: `backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js`
- Test: `backend/tests/architectureClosureV2/wpB/transactionIoBoundary.test.js`
- Test: `backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js`
- Create: `tools/architecture-closure-v2/run-wp-b-contracts.js`
- Create: `.github/workflows/wp-b-validation.yml`
- Create: `governance/architecture-closure-v2/wp-b-m1-review.json`

**Interfaces:**
- `createIntent(input) -> frozen ExternalActionIntent`.
- `claimIntent(input) -> frozen ExternalActionClaim`.
- `startAttempt(input) -> frozen ExternalActionAttempt`.
- `recordReceipt(input) -> frozen ExternalActionReceipt`.
- `markUncertain(input) -> frozen ExternalOutcomeReconciliation`.
- `dispatchOne({ operationKind, adapter }) -> Promise<DispatchResult>`.
- `reconcileExternalOutcome({ intentId, attemptId, adapter, authorityTimestamp }) -> Promise<ReconciliationResult>`.

- [ ] **Step 1: Implement intent hash and CAS claim authority**

An intent contains only stable scope, operation kind, content hash, redacted reference metadata, deadline and receipt lookup policy. Claim SQL conditions on intent state, state version, owner, claim ID, lease expiry, host generation and fencing token.

- [ ] **Step 2: Persist an attempt before physical I/O**

`ExternalActionDispatcher` must use two authority calls around the Adapter:

```js
async dispatchClaim(claim, adapter) {
  const attempt = this.outbox.startAttempt({ ...claim, authorityTimestamp: this.clock.issue() });
  try {
    const observation = await adapter.perform(deepFreeze({
      intentId: claim.intentId,
      attemptId: attempt.attemptId,
      operationKind: claim.operationKind,
      requestReference: claim.requestReference
    }));
    return this.outbox.recordReceipt({ attempt, observation, authorityTimestamp: this.clock.issue() });
  } catch (error) {
    if (error.remoteOutcomeCertain === true) {
      return this.outbox.recordFailureReceipt({ attempt, error, authorityTimestamp: this.clock.issue() });
    }
    return this.outbox.markUncertain({ attempt, reasonCode: 'REMOTE_OUTCOME_UNCERTAIN', authorityTimestamp: this.clock.issue() });
  }
}
```

No Adapter function may be reachable from an `AuthorityTransactionCoordinator` projector callback.

- [ ] **Step 3: Implement reconciliation outcomes**

The Adapter reconciliation result must be one of `REMOTE_SUCCESS_PROVEN`, `REMOTE_ABSENCE_PROVEN`, or `REMOTE_RESULT_UNKNOWN`. Unknown remains nonterminal; manual resolution creates an append-only receipt containing actor, reason code, evidence reference and authority timestamp.

- [ ] **Step 4: Run complete Milestone 1 contracts locally**

```bash
node tools/architecture-closure-v2/run-wp-b-contracts.js --milestone 1
npm run test:acv2:wp-a
npm run test:security-scan
```

Expected: all WP-B Milestone 1 contracts GREEN and all WP-A regressions GREEN.

- [ ] **Step 5: Run Ubuntu and Windows CI**

The workflow must use pinned `actions/checkout` and `actions/setup-node`, install with `npm ci --ignore-scripts --no-audit --no-fund`, run `run-wp-b-contracts.js --milestone 1`, run WP-A regression contracts, and verify a clean worktree. Both operating systems must pass against the exact same Head.

- [ ] **Step 6: Complete independent Review Gate 1**

The independent reviewer verifies the complete RED-precedence chain, Schema 23, SQL CAS, XState boundary, upstream-test evidence, no transaction I/O, uncertain-outcome behavior and exact changed-file scope. `wp-b-m1-review.json` may be set to `APPROVED` only by evidence from that independent review and the exact reviewed Head.

- [ ] **Step 7: Commit Milestone 1 integrated GREEN and review receipt**

```bash
git add backend/services/externalAction*.js backend/services/externalOutcomeReconciliation.js \
  backend/tests/architectureClosureV2/wpB tools/architecture-closure-v2/run-wp-b-contracts.js \
  .github/workflows/wp-b-validation.yml governance/architecture-closure-v2/wp-b-m1-review.json
git commit -m "feat(acv2): close WP-B milestone-one durable outbox core"
```

---

# Milestone 2 — Business Flow and Recovery Closure

## Task 6: Build the six mandatory operation Adapters and migrate physical call ownership

**Files:**
- Create: `backend/services/durableOperationRegistry.js`
- Create: `backend/services/durableOperations/aiProviderExecutionOperation.js`
- Create: `backend/services/durableOperations/outboundMessageSendOperation.js`
- Create: `backend/services/durableOperations/deliveryReceiptReconciliationOperation.js`
- Create: `backend/services/durableOperations/mediaTransferOperation.js`
- Create: `backend/services/durableOperations/historySynchronizationOperation.js`
- Create: `backend/services/durableOperations/sessionRestoreOperation.js`
- Modify: `backend/services/modelExecutionHost.js`
- Modify: `backend/services/communicationAuthority.js`
- Modify: `backend/services/channelAdapterRuntime.js`
- Test: `backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js`

**Interfaces:**
- Each Adapter implements `perform(attemptEnvelope) -> Promise<ExternalObservation>` and `reconcile(reconciliationEnvelope) -> Promise<ReconciliationObservation>`.
- Adapter envelopes contain references and hashes only; credentials are resolved through existing custody boundaries immediately before the physical call and are never persisted into WP-B records.

- [ ] **Step 1: Write the common Adapter contract test**

```js
for (const operationKind of REQUIRED_OPERATION_KINDS) {
  test(`${operationKind} has physical-call and reconciliation adapters`, async () => {
    const adapter = registry.require(operationKind);
    assert.equal(typeof adapter.perform, 'function');
    assert.equal(typeof adapter.reconcile, 'function');
    assert.throws(() => { adapter.operationKind = 'changed'; }, TypeError);
  });
}
```

- [ ] **Step 2: Implement the registry with exact operation kinds**

```js
const OPERATION_KINDS = Object.freeze({
  AI_PROVIDER_EXECUTION: 'AI_PROVIDER_EXECUTION',
  OUTBOUND_MESSAGE_SEND: 'OUTBOUND_MESSAGE_SEND',
  DELIVERY_RECEIPT_RECONCILIATION: 'DELIVERY_RECEIPT_RECONCILIATION',
  MEDIA_TRANSFER: 'MEDIA_TRANSFER',
  HISTORY_SYNCHRONIZATION: 'HISTORY_SYNCHRONIZATION',
  SESSION_RESTORE: 'SESSION_RESTORE'
});
```

Unknown kinds fail with `WP_B_OPERATION_ADAPTER_NOT_REGISTERED`.

- [ ] **Step 3: Migrate model execution**

`modelExecutionHost.js` must create an `AI_PROVIDER_EXECUTION` durable execution and intent before forking the worker. Worker protocol readiness, provider-request ID, result, error, timeout and process exit are observations used to issue receipts. Exit after provider request but without a trusted result becomes `UNCERTAIN_REMOTE_OUTCOME`, not ordinary failure.

- [ ] **Step 4: Migrate communication operations**

`communicationAuthority.js` creates durable operations for outbound send, receipt reconciliation, media transfer and history synchronization. `channelAdapterRuntime.js` may invoke a platform SDK only when called by `ExternalActionDispatcher` with a valid persisted attempt envelope.

- [ ] **Step 5: Migrate session restoration**

Session restore becomes a durable operation with a stable account-scoped idempotency key, deadline, remote/session probe receipt and uncertain-state reconciliation. Startup code may request restoration but cannot call platform SDKs directly.

- [ ] **Step 6: Run operation contract and existing focused regressions**

```bash
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js \
  backend/tests/fix6jExecutionEnvelope.test.js \
  backend/tests/fix6jWorkerEnvelopeVerification.test.js \
  backend/tests/fix6jMissingCredentialForkGuard.test.js \
  backend/tests/telegramHistorySyncRegression.test.js \
  backend/tests/facebookBusinessSuiteReconciliationRegression.test.js
```

Expected: all physical-call entrypoints require a persisted attempt and existing FIX6J/platform contracts remain GREEN.

- [ ] **Step 7: Commit the operation migration**

```bash
git add backend/services/durableOperationRegistry.js backend/services/durableOperations \
  backend/services/modelExecutionHost.js backend/services/communicationAuthority.js \
  backend/services/channelAdapterRuntime.js \
  backend/tests/architectureClosureV2/wpB/mandatoryOperationAdapters.test.js
git commit -m "feat(acv2): migrate mandatory operations to WP-B outbox"
```

## Task 7: Implement restart recovery, lease takeover and complete fault closure

**Files:**
- Create: `backend/services/durableExecutionRecoveryAuthority.js`
- Modify: `backend/runtime/AppRuntimeComposition.js`
- Modify: `backend/runtime/AppRuntimeFactory.js`
- Modify: `backend/server.js`
- Create: `backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js`
- Create: `tools/architecture-closure-v2/wp-b-process-fault-matrix.js`
- Modify: `governance/architecture-closure-v2/wp-b-operation-inventory.json`
- Create: `governance/architecture-closure-v2/wp-b-m2-review.json`

**Interfaces:**
- `recoverNonterminalExecutions({ authorityTimestamp, hostToken }) -> frozen RecoveryReport`.
- `recoverExecution(snapshot, context) -> frozen RecoveryDecision`.
- Recovery decisions: `REQUEUE_SAFE`, `RECONCILE_REQUIRED`, `CANCEL_CONFIRMATION_REQUIRED`, `DEADLINE_EXPIRED`, `NO_ACTION`.

- [ ] **Step 1: Write restart-state table tests**

```js
const expectations = [
  ['SCHEDULED', 'REQUEUE_SAFE'],
  ['CLAIMED', 'REQUEUE_SAFE'],
  ['RUNNING', 'REQUEUE_SAFE'],
  ['WAITING_REMOTE', 'RECONCILE_REQUIRED'],
  ['UNCERTAIN_REMOTE_OUTCOME', 'RECONCILE_REQUIRED'],
  ['CANCEL_REQUESTED', 'CANCEL_CONFIRMATION_REQUIRED']
];
for (const [state, decision] of expectations) {
  test(`restart maps ${state} to ${decision}`, () => {
    assert.equal(recoverFixture(state).decision, decision);
  });
}
```

A persisted attempt always changes `RUNNING` recovery to `RECONCILE_REQUIRED`; the state name alone may never authorize a retry.

- [ ] **Step 2: Compose one recovery authority after write-host acquisition**

`server.js` startup order must be:

```text
acquire AuthorityWriteHost
→ build AuthorityTransactionCoordinator
→ apply migrations through Schema 23
→ compose dispatcher and operation registry
→ recover WP-B nonterminal executions through commands
→ perform no direct legacy recovery writes
→ mark runtime ready
```

- [ ] **Step 3: Implement the process fault matrix**

The matrix launches two backend/dispatcher processes against one temporary database and covers:

1. kill before physical call;
2. kill after persisted attempt but before call;
3. kill during call;
4. remote success then kill before receipt;
5. receipt committed then kill before terminal transition;
6. duplicate dispatcher claims;
7. lease expiry and takeover;
8. stale owner, generation and fencing token;
9. clock rollback and forward jump;
10. deadline and cancellation races.

Every row records exact process IDs, host generation, fencing token, claim ID, attempt count, receipt count and final state without storing business content.

- [ ] **Step 4: Prove no duplicate external side effect**

Use an instrumented fake remote endpoint with persistent request IDs and idempotency lookup. The matrix must assert one physical side effect for success and unknown scenarios, and must demonstrate that unknown blocks retry until reconciliation proves absence.

- [ ] **Step 5: Run Milestone 2 contracts and platform matrices**

```bash
node tools/architecture-closure-v2/run-wp-b-contracts.js --milestone 2
node tools/architecture-closure-v2/wp-b-process-fault-matrix.js
npm run test:round12-platform-core
npm run test:source-uat-delivery
```

Run the same contract and fault commands on Ubuntu and Windows against the exact same Head.

- [ ] **Step 6: Complete independent Review Gate 2**

The independent reviewer verifies six operation migrations, process-kill evidence, restart decisions, stale-token rejection, cancellation/deadline separation, old-call blocking, source-scope discipline and absence of secret/business-content leakage. Blocker or High findings prevent Milestone 3.

- [ ] **Step 7: Commit recovery closure and Review Gate 2**

```bash
git add backend/services/durableExecutionRecoveryAuthority.js backend/runtime \
  backend/server.js backend/tests/architectureClosureV2/wpB/recoveryFaultMatrix.test.js \
  tools/architecture-closure-v2/wp-b-process-fault-matrix.js \
  governance/architecture-closure-v2/wp-b-operation-inventory.json \
  governance/architecture-closure-v2/wp-b-m2-review.json
git commit -m "feat(acv2): close WP-B recovery and fault scenarios"
```

---

# Milestone 3 — Source Closure and Final Gates

## Task 8: Generalize source closure and remove every superseded WP-B path

**Files:**
- Modify: `tools/architecture-closure-v2/source-closure-scan.js`
- Create: `backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js`
- Modify: `governance/architecture-closure-v2/wp-b-operation-inventory.json`
- Modify: files identified by the frozen inventory only when their old writer, timer, retry, recovery or direct-call entrypoint must be deleted or delegated.

**Interfaces:**
- `scanRegisteredSources({ wp: 'B' }) -> report` with `violationCount`, `legacyCallablePathCount`, and classified violations.
- WP-A invocation `--wp A` must remain byte-for-byte equivalent in output semantics.

- [ ] **Step 1: Add WP-B source-closure RED assertions**

```js
test('WP-B source closure has no unregistered external calls or legacy recovery paths', () => {
  const report = scanRegisteredSources({ wp: 'B' });
  assert.equal(report.violationCount, 0);
  assert.equal(report.legacyCallablePathCount, 0);
  assert.equal(report.directExternalCallOutsideAdapterCount, 0);
  assert.equal(report.blindRetryPathCount, 0);
});
```

- [ ] **Step 2: Refactor scanner selection rather than duplicate it**

Add a frozen work-package configuration map:

```js
const WORK_PACKAGE_CONFIG = Object.freeze({
  A: Object.freeze({
    baselinePath: 'governance/architecture-closure-v2/wp-a-baseline.json',
    registryPath: 'governance/architecture-closure-v2/authority-registry.json'
  }),
  B: Object.freeze({
    baselinePath: 'governance/architecture-closure-v2/wp-b-baseline.json',
    registryPath: 'governance/architecture-closure-v2/wp-b-operation-inventory.json'
  })
});
```

WP-B detection patterns must include direct provider/platform SDK calls, timers, retry loops, startup recovery and physical Adapter calls outside `backend/services/durableOperations/` and `externalActionDispatcher.js`.

- [ ] **Step 3: Delete or delegate all frozen legacy paths**

For every inventory row, set one final state: `DELETED`, `DELEGATES_TO_WP_B_AUTHORITY`, or `READ_ONLY_PROJECTION`. `DISABLED_BY_FLAG`, `WARNING_ONLY`, and callable fallback states are invalid.

- [ ] **Step 4: Run both WP-A and WP-B source closure**

```bash
node tools/architecture-closure-v2/source-closure-scan.js --wp A
node tools/architecture-closure-v2/source-closure-scan.js --wp B
node --test --test-concurrency=1 \
  backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js \
  backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js
```

Expected: both reports have zero violations.

- [ ] **Step 5: Commit explicit source removal/delegation**

```bash
git add tools/architecture-closure-v2/source-closure-scan.js \
  backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js \
  governance/architecture-closure-v2/wp-b-operation-inventory.json \
  backend electron services
git commit -m "refactor(acv2): remove legacy WP-B execution and external-call paths"
```

## Task 9: Produce final verification, provenance and closure governance

**Files:**
- Modify: `tools/architecture-closure-v2/run-wp-b-contracts.js`
- Create: `tools/architecture-closure-v2/verify-wp-b-closure.js`
- Create: `docs/architecture/YANCE_ACV2_WP_B_SOURCE_REVIEW_ZH.md`
- Modify: `governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json`
- Create: `governance/architecture-closure-v2/wp-b-closure.json`
- Create: `.github/workflows/wp-b-post-merge-validation.yml`
- Modify: `package.json`

**Interfaces:**
- `verifyWpBClosure(repositoryRoot) -> { ok, changedFileCount, changedFileSetSha256, violations }`.
- Final receipt must bind reviewed Head, ordered file set, CI run/job IDs, artifacts, review ID, migration checksum, open-source evidence and all release flags.

- [ ] **Step 1: Add final package scripts**

```json
{
  "test:acv2:wp-b": "node tools/architecture-closure-v2/run-wp-b-contracts.js --milestone all",
  "verify:acv2:wp-b:source-closure": "node tools/architecture-closure-v2/source-closure-scan.js --wp B",
  "verify:acv2:wp-b:open-source": "node tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js",
  "verify:acv2:wp-b": "npm run test:acv2:wp-b && npm run verify:acv2:wp-b:source-closure && npm run verify:acv2:wp-b:open-source"
}
```

- [ ] **Step 2: Run the final local matrix**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:acv2:wp-b
npm run verify:acv2:wp-a
npm run test:round12-platform-core
npm run test:source-uat-delivery
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

- [ ] **Step 3: Run license, provenance, NOTICE and SBOM closure**

Generate an SPDX or CycloneDX SBOM from the exact lockfile, record XState package integrity and MIT license, record the exact upstream tag/commit and upstream-test output hash, and record Temporal as reference-only with zero imported files. Verify that no enterprise/restricted source path was imported.

- [ ] **Step 4: Run final Ubuntu/Windows and fault-injection CI**

`wp-b-validation.yml` must run the full WP-B matrix, WP-A regressions, process fault matrix, source closure, license/security/provenance verification and clean-worktree checks. Every job must execute against the exact final reviewed Head; no `continue-on-error` is permitted.

- [ ] **Step 5: Complete independent final source review**

The final reviewer verifies exact changed files and hashes, RED precedence, migration history, SQL CAS, operation ownership, uncertain-outcome convergence, legacy deletion, open-source eleven-step evidence, Ubuntu/Windows results, secret/content scans and post-merge policy. The reviewer does not authorize formal release or WP-C.

- [ ] **Step 6: Write the final closure receipt**

The receipt must contain these exact conclusions:

```json
{
  "status": "CLOSED_PENDING_MAIN_POST_MERGE_VALIDATION",
  "schemaVersionTarget": 23,
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
  "wpCAuthorized": false,
  "formalRelease": false,
  "publish": false
}
```

- [ ] **Step 7: Add permanent main post-merge validation**

Model `.github/workflows/wp-b-post-merge-validation.yml` after WP-A's permanent workflow. Trigger on relevant backend, Electron, governance, package, lockfile, WP-B tests and architecture-closure tools. Include Ubuntu/Windows contracts, source closure, open-source provenance, process fault tests and an aggregate gate. The summary must keep `wpCAuthorized=false`, `formalRelease=false`, and `publish=false`.

- [ ] **Step 8: Commit final source closure and governance**

```bash
git add package.json tools/architecture-closure-v2 \
  docs/architecture/YANCE_ACV2_WP_B_SOURCE_REVIEW_ZH.md \
  governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json \
  governance/architecture-closure-v2/wp-b-closure.json \
  .github/workflows/wp-b-post-merge-validation.yml
git commit -m "governance(acv2): close WP-B after independent review"
```

- [ ] **Step 9: Verify the exact final Head before promotion discussion**

```bash
git rev-parse HEAD
node tools/architecture-closure-v2/verify-wp-b-closure.js --require-head "$(git rev-parse HEAD)"
git diff --check main...HEAD
```

Expected: verification GREEN. PR remains Draft until a separate promotion authorization is created. No merge, formal release, publish, or WP-C implementation authorization occurs in this plan.

---

## Review and CI Topology

1. **Review Gate 1 — Milestone 1:** full RED precedence, XState admission/upstream tests, Schema 23, lifecycle, CAS, outbox and uncertain-outcome core.
2. **Review Gate 2 — Milestone 2:** six operation migrations, startup recovery, two-process/fault matrices, old-call blocking and Windows behavior.
3. **Review Gate 3 — Final closure:** exact source diff, legacy removal, provenance/SBOM/NOTICE, all regressions and permanent post-merge validation.

Normal focused CI runs on every commit. Only these three checkpoints require formal independent handoff.

## Definition of Done

WP-B is not done when tests merely pass. It is done only when the final reviewed Head proves all of the following:

- Schema 23 is forward-only, checksum-pinned and reopen-safe.
- Every execution mutation is database-CAS and stale workers change zero rows.
- Every idempotency key is content-hash bound.
- Every public authority value is deeply immutable.
- Every physical call has a persisted attempt created before I/O.
- Every uncertain result is reconciled or explicitly manually resolved, never blindly retried.
- All six mandatory operation kinds use the same durable/outbox substrate.
- Every old WP-B writer, recovery, timer, retry and direct physical call is deleted or delegates to the one authority.
- XState and all future third-party assets satisfy the ordered eleven-step gate.
- Ubuntu, Windows, forced-kill, clock-jump, duplicate-dispatcher, security, source-closure and WP-A regression matrices are GREEN on the exact reviewed Head.
- The final receipt keeps `wpCAuthorized=false`, `formalRelease=false`, and `publish=false`.
