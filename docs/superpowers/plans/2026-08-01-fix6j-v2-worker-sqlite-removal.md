# FIX6J V2 Work Execution Plan

> **For agentic workers:** implement task-by-task with RED → GREEN checkpoints. Do not start backend-full until Tasks 1–8 and the checkpoint review pass.

**Goal:** complete the SQLite-free isolated model worker architecture without weakening ownership/fencing, add a versioned and integrity-checked execution envelope, enforce process-role storage denial, prevent source-tree test pollution, and preserve all persistence in the host process.

**Architecture:** the host resolves credentials, policy, route and qualification state into a canonical immutable execution envelope. The worker verifies the envelope, executes only provider calls, and returns result/telemetry. Storage access is denied both structurally and at runtime for `model-execution-worker` processes.

**Tech stack:** Node.js CommonJS, Electron child-process IPC, Node `crypto`, Node test runner, SQLite ownership/fencing, Windows PowerShell UAT.

## Global constraints

- Upstream baseline is the verified `YANCE_FIX6I_SOURCE.zip`, SHA256 `850f9ea4e068235cdc1451f93346e67dc9a30d7f0c50397f10cec6936a79d4da`.
- Do not implement from the stale GitHub `main` source tree.
- Do not remove, relax, bypass or retry around SQLite ownership/fencing.
- Worker must not load SQLite, DocumentStore, Store Singleton, system-policy repository, route repository, qualification repository or evidence repository.
- API keys may exist only in host memory and one execute IPC payload; they must never be logged, diagnosed, persisted, hashed in plaintext or returned in receipts.
- No production behavior may vary by arbitrary `workerPath`.
- Test data must use temporary roots and leave the source tree byte-identical outside intentional source/test/artifact files.
- Product runtime floor for verification: Node `v22.22.1`.
- Fixed gates remain false: `windowsUiUat`, `readyForPromotion`, `formalRelease`, `candidatePackageGenerated`.

---

## File map

### Create

- `backend/services/modelExecutionEnvelopeAuthority.js` — canonical execution-envelope creation, validation and digest calculation.
- `backend/services/systemPolicyCore.js` — pure policy normalization/assertion logic with no I/O.
- `backend/services/systemPolicyRepository.js` — host-only SQLite persistence for system policy.
- `backend/services/systemPolicySnapshotAuthority.js` — immutable host-side policy snapshot creation.
- `backend/lib/runtimeRoleGuard.js` — process-role and storage-access fail-closed authority.
- `backend/tests/fix6jExecutionEnvelope.test.js`
- `backend/tests/fix6jRuntimeRoleIsolation.test.js`
- `backend/tests/fix6jMissingCredentialForkGuard.test.js`
- `backend/tests/fix6jSystemPolicySnapshot.test.js`
- `backend/tests/fix6jSourceTreeCleanliness.test.js`

### Modify

- `backend/services/modelExecutionSpecResolver.js`
- `backend/services/modelExecutionHost.js`
- `backend/services/modelExecutionWorker.js`
- `backend/services/isolatedModelExecutor.js`
- `backend/services/systemPolicy.js`
- `backend/lib/r32SqliteStore.js`
- `backend/lib/sqliteDocumentStore.js`
- `backend/lib/r32StoreSingleton.js`
- existing worker fixtures referenced by `batch39AiPhysicalExecution.test.js`, `fix6gModelExecutionTelemetry.test.js`, and `fix6gWindowsFailureComposition.test.js`

### Restore from baseline before final verification

- `backend/data/database/yance-r32.db`
- all test-created `backend/data/migration-backups/*`

---

## Task 1 — Canonical execution-envelope authority

**Produces**

```js
createModelExecutionEnvelope(input) -> frozen envelope
verifyModelExecutionEnvelope(envelope) -> verified frozen envelope
canonicalizeExecutionEnvelopePayload(payload) -> string
credentialFingerprint(apiKey) -> string
```

Envelope schema:

```js
{
  schemaVersion: 1,
  type: 'execute',
  executionId,
  correlationId,
  task,
  executionSpec: {
    provider,
    endpoint,
    modelName,
    modelId,
    credential: { apiKey },
    credentialFingerprint
  },
  policySnapshot,
  routeReceipt,
  qualificationReceipt,
  messages,
  options,
  deadlineAt,
  integrity: {
    algorithm: 'sha256',
    digest
  }
}
```

Digest payload must exclude `credential.apiKey` and include `credentialFingerprint`. Canonicalization must sort object keys recursively and preserve array order.

- [ ] Write RED tests covering valid envelope, missing fields, unsupported schema, digest tampering, key-order invariance, credential fingerprint change and deep freeze.
- [ ] Run:

```powershell
node --test backend/tests/fix6jExecutionEnvelope.test.js
```

Expected RED: module not found or missing exported functions.

- [ ] Implement `modelExecutionEnvelopeAuthority.js` using `node:crypto` SHA256 and a recursive canonicalizer.
- [ ] Re-run and require all tests PASS.
- [ ] Save RED and GREEN stdout/stderr plus exit codes under `artifacts/fix6j-v2/task-01/`.

## Task 2 — System policy split and immutable snapshot

**Produces**

```js
normalizeSystemPolicy(value) -> normalized policy
assertWriteAllowedFromPolicy(policy, action) -> true | throws
createSystemPolicySnapshot(policy, context) -> deeply frozen snapshot
```

- [ ] Write RED tests proving `systemPolicyCore.js` and `systemPolicySnapshotAuthority.js` have no imports from `backend/lib`, stores, event bus or logger.
- [ ] Test snapshot fields: `schemaVersion`, `emergencyStop`, `privacyMode`, `operatingModeAuthority`, `createdAt`, `sourceVersion`.
- [ ] Test mutation resistance and deterministic projection excluding repository metadata such as `updatedBy` where not required by execution.
- [ ] Move SQLite-backed read/update behavior to `systemPolicyRepository.js`.
- [ ] Convert `systemPolicy.js` into a host-only facade combining repository, core, event bus and logger.
- [ ] Run:

```powershell
node --test backend/tests/fix6jSystemPolicySnapshot.test.js
```

Require PASS and save evidence under `artifacts/fix6j-v2/task-02/`.

## Task 3 — Process-role storage guard

**Produces**

```js
currentProcessRole() -> string
assertStorageAccess(operation) -> true | throws MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN
assertHostProcess(operation) -> true | throws
```

Role values:

```text
desktop-host
model-execution-worker
test-fixture
```

- [ ] Write RED tests that spawn a process with:

```text
YANCE_PROCESS_ROLE=model-execution-worker
YANCE_SQLITE_ACCESS=forbidden
```

and attempt to instantiate `SqliteDocumentStore`, `R32SqliteStore` and `getR32Store()`.
- [ ] Expected error for each path:

```text
code=MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN
```

- [ ] Implement `runtimeRoleGuard.js`.
- [ ] Call `assertStorageAccess()` at the earliest public entry of `R32SqliteStore`, `SqliteDocumentStore` and `getR32Store()`.
- [ ] Do not modify ownership/fencing behavior for host processes.
- [ ] Re-run and require PASS.

## Task 4 — Unified host envelope and fork-before-validation prevention

**Consumes:** Task 1, Task 2 and the existing `resolveModelExecutionSpec(model)`.

- [ ] Write RED Host integration tests using an injectable child-process factory counter, not arbitrary production `workerPath` protocol branching.
- [ ] Missing credential case must prove:
  - error code `MODEL_CREDENTIAL_MISSING`;
  - fork count `0`;
  - no execution evidence write;
  - no credentialRef in error/receipt.
- [ ] Valid case must prove the host constructs one verified envelope before fork.
- [ ] Modify `modelExecutionHost.js`:
  1. resolve credential and execution spec;
  2. read and snapshot policy/route/qualification state;
  3. create verified envelope;
  4. fork production worker with environment:

```text
YANCE_PROCESS_ROLE=model-execution-worker
YANCE_SQLITE_ACCESS=forbidden
YANCE_MODEL_EXECUTION_ID=<id>
```

  5. send `{ type: 'execute', envelope }` only.
- [ ] Remove protocol behavior that changes based on arbitrary `workerPath`. Test fixtures must consume the same envelope schema.
- [ ] Run:

```powershell
node --test backend/tests/fix6jMissingCredentialForkGuard.test.js backend/tests/fix6jExecutionEnvelope.test.js
```

Require PASS.

## Task 5 — Worker verification and stateless execution

- [ ] Write RED tests that send malformed, tampered, expired and valid envelopes to the production worker.
- [ ] Invalid envelopes must emit an error with:

```text
MODEL_EXECUTION_ENVELOPE_INVALID
```

and must not call provider clients.
- [ ] Expired envelope must emit:

```text
MODEL_EXECUTION_DEADLINE_EXCEEDED
```

- [ ] Modify `modelExecutionWorker.js` so its top-level dependency closure contains only:
  - envelope authority/verifier;
  - isolated executor;
  - Node built-ins required for IPC/abort.
- [ ] `started` must be sent only after envelope verification and worker protocol readiness, before provider invocation.
- [ ] Provider messages must retain `correlationId` and include `providerRequestId` when available.
- [ ] Run the worker isolation suite and require the runtime dependency closure to exclude:

```text
sqlite
r32StoreSingleton
SqliteDocumentStore
systemPolicy
securityGuardSingleton
storeProvider
```

## Task 6 — Host-only persistence and exactly-once receipt

- [ ] Add tests around the host evidence boundary proving:
  - worker never imports `modelExecutionEvidenceStore`;
  - one result produces exactly one evidence write;
  - repeated `provider-request` and result messages cannot duplicate the receipt;
  - cancellation and timeout produce distinct reason codes;
  - API key, credentialRef and authorization header never appear in serialized receipt/error/diagnostic values.
- [ ] Keep all writes through the existing host-side `modelExecutionEvidenceStore`.
- [ ] Preserve the existing telemetry fields from FIX6G+ and add envelope metadata only as non-secret values:

```text
envelopeSchemaVersion
envelopeDigest
policySnapshotVersion
```

- [ ] Run focused execution telemetry tests and require PASS.

## Task 7 — Source-tree test isolation and baseline restoration

- [ ] Restore the database and migration-backup paths from the original FIX6I ZIP before running cleanliness tests.
- [ ] Refactor FIX6J tests to create a unique temporary root with `fs.mkdtemp()` and set every applicable Yance data-root environment variable before importing storage modules.
- [ ] Ensure each test closes stores/heartbeats and recursively removes the temporary root in teardown.
- [ ] Add `fix6jSourceTreeCleanliness.test.js` that hashes protected source-data paths before and after the focused suite and rejects any new/changed `.db`, `.sqlite`, `.wal`, `.shm` or migration-backup files.
- [ ] Run the focused suite twice consecutively. Both runs must PASS and protected-path hashes must remain unchanged.

## Task 8 — Product-runtime checkpoint

Use Node `v22.22.1`, not the ambient Node 24 runtime.

- [ ] Record:

```powershell
node --version
npm --version
```

- [ ] Run:

```powershell
node --test --test-concurrency=1 `
  backend/tests/fix6jModelExecutionSpecResolver.test.js `
  backend/tests/fix6jIsolatedModelExecutor.test.js `
  backend/tests/fix6jWorkerSqliteIsolation.test.js `
  backend/tests/fix6jExecutionEnvelope.test.js `
  backend/tests/fix6jRuntimeRoleIsolation.test.js `
  backend/tests/fix6jMissingCredentialForkGuard.test.js `
  backend/tests/fix6jSystemPolicySnapshot.test.js `
  backend/tests/fix6jSourceTreeCleanliness.test.js
```

- [ ] Run related regression:

```powershell
node --test --test-concurrency=1 `
  backend/tests/batch39AiPhysicalExecution.test.js `
  backend/tests/fix6gModelExecutionTelemetry.test.js `
  backend/tests/fix6gWindowsFailureComposition.test.js
```

- [ ] Run Round13 and relevant WP5 ownership/state tests.
- [ ] Save commands, stdout/stderr, exit codes, runtime versions and all modified-file SHA256 values under `artifacts/fix6j-v2/checkpoint/`.
- [ ] Stop and report. Do not start backend-full yet.

---

# Checkpoint review gate

The first Work session must stop after Task 8. It may proceed to full regression only when all are true:

```text
focused PASS
related regression PASS
Round13 PASS
WP5 relevant PASS
Node 22.22.1 confirmed
source data baseline unchanged
worker dependency closure clean
missing credential fork count = 0
envelope tamper tests PASS
runtime storage denial tests PASS
```

The checkpoint report must include:

- exact modified/created files;
- RED and GREEN commands and log paths;
- envelope schema and digest algorithm;
- evidence that plaintext API keys are absent from artifacts;
- evidence that source database hashes match the original FIX6I baseline;
- tests deliberately not yet executed.

---

# Second Work session — only after checkpoint approval

## Task 9 — Full backend isolation regression

- Run every backend test file in a separate Node process with a per-file timeout.
- Report file count, test count, failures, timeouts and log index.
- Any failure must be fixed at the shared authority layer; no test exclusion or assertion weakening.

## Task 10 — Independent review

- Run CodeRabbit on the complete diff when available.
- Run SonarQube when a real configured scanner/server is available.
- Do not substitute mocks or StubEngine output for review evidence.
- Resolve all blocker/high findings and re-run affected tests.

## Task 11 — Package and package-self-test

- Generate a new derived identity, not FIX6I.
- Exclude `.git`, temporary roots, database mutations, migration backups, secrets and raw diagnostics.
- Apply the Windows Explorer maximum extracted-path gate before creating ZIPs.
- Build full source ZIP, evidence ZIP, patch, machine-readable verification JSON, root-cause report and Windows UAT checklist.
- Re-extract final ZIP and re-run identity, focused, Round13, WP5 and Source UAT gates from the extracted bytes.

## Task 12 — Windows real UAT

Required evidence:

- host owns the real SQLite database;
- Claude Opus 5 and GPT-5.6 Sol both reach `workerStarted=true`;
- both return non-empty real `providerRequestId` values;
- no `SQLITE_OWNERSHIP_CONFLICT`;
- no API-key leakage in exported redacted diagnostics;
- main/backup concurrency produces no duplicate or torn receipts;
- timeout, caller cancel, provider failure and illegal storage access remain separately classified.

Release gates remain false until this task is completed and independently reviewed.
