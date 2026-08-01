# FIX6J Isolated Model Worker SQLite Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the isolated model Worker execute cloud and Ollama requests without loading or accessing SQLite while preserving the existing process protocol and execution evidence behavior.

**Architecture:** The main process resolves a model plus its credential reference into a frozen minimal execution specification before forking. The Worker consumes that specification through the existing IPC envelope and calls a new store-free executor whose runtime dependency closure excludes all security, policy, repository, and SQLite authorities.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, child-process IPC, existing OpenAI-compatible and Ollama clients, Windows PowerShell validation.

## Global Constraints

- The only source baseline is `YANCE_FIX6I_SOURCE.zip`, SHA256 `850f9ea4e068235cdc1451f93346e67dc9a30d7f0c50397f10cec6936a79d4da`.
- Never overlay, reset, or replace this baseline with GitHub `main` or another source tree.
- Preserve the FIX6I source identity: `FIX6I_MODEL_PROJECTION_LAYOUT_DIAGNOSTIC_AUTHORITY_V1`, base commit `91096c2eb1a9e289b1a68b351a326166cf9c379d`.
- The Worker dependency closure must not reach `node:sqlite`, `SqliteDocumentStore`, `r32StoreSingleton`, `securityGuardSingleton`, `systemPolicy`, or `repositories/storeProvider`.
- API keys must not enter receipts, logs, diagnostics, serialized error details, stdout, or stderr.
- Do not change registry, routing, fallback, queue, connector, UI, SQLite ownership, or release-governance behavior.
- Keep `readyForPromotion=false` and `formalRelease=false` until separate real Windows UAT is complete.
- This source package has no `.git` directory. Do not initialize Git or manufacture history; replace commit steps with a changed-file list, unified diff, and SHA256 checkpoint.
- All production changes follow RED-GREEN-REFACTOR. A test must fail for the intended missing behavior before production code is written.

## File Structure

- Create `backend/services/modelExecutionSpecResolver.js`: main-process-only credential resolution and minimal frozen execution specification construction.
- Create `backend/services/isolatedModelExecutor.js`: store-free provider dispatch using explicit execution specifications.
- Modify `backend/services/modelExecutionHost.js`: resolve the execution specification before `fork`, send it in the existing execute envelope, and never persist it.
- Modify `backend/services/modelExecutionWorker.js`: replace `modelExecutor` with `isolatedModelExecutor` and consume `executionSpec`.
- Create `backend/tests/fix6jModelExecutionSpecResolver.test.js`: resolver behavior, missing credential behavior, and frozen/minimal output.
- Create `backend/tests/fix6jIsolatedModelExecutor.test.js`: cloud/Ollama dispatch and unsupported-provider behavior.
- Create `backend/tests/fix6jWorkerSqliteIsolation.test.js`: real Worker readiness under a live main-process SQLite owner, dependency-closure behavior, protocol compatibility, and secret leak checks.
- Preserve `backend/tests/batch39AiPhysicalExecution.test.js` and `backend/tests/fix6gModelExecutionTelemetry.test.js`; their custom Worker fixtures ignore additional IPC properties and therefore require no compatibility edit.
- Create `YANCE_BATCH40_FIX6J_WORKER_SQLITE_REMOVAL_VERIFICATION.json`: command, exit-code, test-count, identity, and Windows-UAT status summary after verification.

---

### Task 1: Main-Process Execution Specification Resolver

**Files:**
- Create: `backend/tests/fix6jModelExecutionSpecResolver.test.js`
- Create: `backend/services/modelExecutionSpecResolver.js`

**Interfaces:**
- Consumes: `resolveModelExecutionSpec(model, options?)`, where `model` is the registry model and `options.readCredential(ref, context)` is injectable for tests.
- Produces: `resolveModelExecutionSpec(model, options?) -> Readonly<{ provider, endpoint, modelName, modelId, credential?: Readonly<{ apiKey }> }>`.
- Throws: `{ code: 'MODEL_CREDENTIAL_MISSING', status: 400 }` for a cloud model whose credential reference resolves to no usable API key.
- Throws: `{ code: 'UNSUPPORTED_MODEL_PROVIDER', status: 400 }` for unsupported providers.

- [ ] **Step 1: Write the failing resolver tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveModelExecutionSpec } = require('../services/modelExecutionSpecResolver');

test('cloud execution spec contains only the resolved network inputs and is deeply frozen', () => {
  const model = {
    id: 'cloud-1', provider: 'cloud', name: 'gpt-test',
    endpoint: 'https://fallback.invalid/v1', credentialRef: 'cred-1',
    privateRegistryField: 'must-not-cross-ipc'
  };
  const spec = resolveModelExecutionSpec(model, {
    readCredential(ref) {
      assert.equal(ref, 'cred-1');
      return { apiKey: 'fix6j-canary-key', endpoint: 'https://api.example/v1', model: 'provider-model', refreshToken: 'forbidden' };
    }
  });
  assert.deepEqual(spec, {
    provider: 'cloud', endpoint: 'https://api.example/v1',
    modelName: 'provider-model', modelId: 'cloud-1',
    credential: { apiKey: 'fix6j-canary-key' }
  });
  assert.equal(Object.isFrozen(spec), true);
  assert.equal(Object.isFrozen(spec.credential), true);
  assert.equal('credentialRef' in spec, false);
  assert.equal('privateRegistryField' in spec, false);
  assert.equal('refreshToken' in spec.credential, false);
});

test('ollama execution spec does not read or contain credentials', () => {
  let reads = 0;
  const spec = resolveModelExecutionSpec({ id: 'local-1', provider: 'ollama', endpoint: 'http://127.0.0.1:11434', name: 'qwen' }, {
    readCredential() { reads += 1; return { apiKey: 'forbidden' }; }
  });
  assert.deepEqual(spec, { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', modelName: 'qwen', modelId: 'local-1' });
  assert.equal(reads, 0);
});

test('missing cloud credential fails before worker creation can be attempted', () => {
  assert.throws(() => resolveModelExecutionSpec({ id: 'cloud-2', provider: 'cloud', name: 'gpt', credentialRef: 'missing' }, {
    readCredential() { return null; }
  }), error => error.code === 'MODEL_CREDENTIAL_MISSING' && error.status === 400 && !JSON.stringify(error).includes('fix6j-canary-key'));
});
```

- [ ] **Step 2: Run the resolver test and verify RED**

Run:

```powershell
node --test backend/tests/fix6jModelExecutionSpecResolver.test.js
```

Expected: FAIL with `MODULE_NOT_FOUND` for `modelExecutionSpecResolver`; this proves the new boundary does not exist yet.

- [ ] **Step 3: Implement the minimal resolver**

```js
'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function providerOf(model = {}) { return clean(model.provider || model.kind || 'ollama').toLowerCase(); }

function defaultReadCredential(ref, context) {
  const { getSecurityGuard } = require('../core/securityGuardSingleton');
  return getSecurityGuard().credentials.get(ref, context);
}

function resolveModelExecutionSpec(model = {}, options = {}) {
  const provider = providerOf(model);
  const modelId = clean(model.id);
  if (provider === 'ollama') {
    return Object.freeze({ provider, endpoint: clean(model.endpoint), modelName: clean(model.name), modelId });
  }
  if (!['openai', 'openai-compatible', 'cloud'].includes(provider)) {
    throw Object.assign(new Error(`UNSUPPORTED_MODEL_PROVIDER:${provider}`), { code: 'UNSUPPORTED_MODEL_PROVIDER', status: 400 });
  }
  const readCredential = options.readCredential || defaultReadCredential;
  const credential = readCredential(clean(model.credentialRef), { actor: 'backend-core', modelId });
  const apiKey = clean(credential?.apiKey || credential?.key || credential?.token);
  if (!apiKey) {
    throw Object.assign(new Error('Cloud model credential is unavailable'), { code: 'MODEL_CREDENTIAL_MISSING', status: 400, modelId });
  }
  const frozenCredential = Object.freeze({ apiKey });
  return Object.freeze({
    provider,
    endpoint: clean(credential?.endpoint || credential?.baseUrl || model.endpoint),
    modelName: clean(credential?.model || credential?.modelName || model.name),
    modelId,
    credential: frozenCredential
  });
}

module.exports = { resolveModelExecutionSpec };
```

- [ ] **Step 4: Run the resolver test and verify GREEN**

Run:

```powershell
node --test backend/tests/fix6jModelExecutionSpecResolver.test.js
```

Expected: exit code 0, 3 tests passed, 0 failed.

- [ ] **Step 5: Record Task 1 checkpoint**

Run:

```powershell
Get-FileHash -Algorithm SHA256 backend/services/modelExecutionSpecResolver.js,backend/tests/fix6jModelExecutionSpecResolver.test.js
```

Save the output and the exact test exit code in `artifacts/fix6j/task1-checkpoint.log` using the repository's evidence-writing conventions; do not initialize Git.

---

### Task 2: Store-Free Isolated Executor

**Files:**
- Create: `backend/tests/fix6jIsolatedModelExecutor.test.js`
- Create: `backend/services/isolatedModelExecutor.js`

**Interfaces:**
- Consumes: `executeIsolatedModel(executionSpec, messages, options, signal, clients?)`.
- `clients` is optional test injection with the complete `{ cloud, ollama }` interface; production defaults use existing clients.
- Produces: the unchanged result returned by `cloud.chat` or `ollama.streamChat`.

- [ ] **Step 1: Write failing provider-dispatch tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeIsolatedModel } = require('../services/isolatedModelExecutor');

test('cloud execution uses only explicit snapshot values', async () => {
  const calls = [];
  const result = await executeIsolatedModel(
    { provider: 'cloud', endpoint: 'https://api.example/v1', modelName: 'provider-model', modelId: 'cloud-1', credential: { apiKey: 'canary' } },
    [{ role: 'user', content: 'hello' }], { timeoutMs: 1234 }, null,
    { cloud: { async chat(input) { calls.push(input); return { text: 'ok' }; } }, ollama: { async streamChat() { throw new Error('wrong client'); } } }
  );
  assert.deepEqual(result, { text: 'ok' });
  assert.deepEqual(calls, [{ endpoint: 'https://api.example/v1', apiKey: 'canary', model: 'provider-model', messages: [{ role: 'user', content: 'hello' }], options: { timeoutMs: 1234 }, signal: null }]);
});

test('ollama execution never needs a credential object', async () => {
  const result = await executeIsolatedModel(
    { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', modelName: 'qwen', modelId: 'local-1' }, [], {}, null,
    { cloud: { async chat() { throw new Error('wrong client'); } }, ollama: { async streamChat(input) { assert.equal('credential' in input, false); return { text: 'local' }; } } }
  );
  assert.deepEqual(result, { text: 'local' });
});

test('unsupported provider is rejected without invoking either client', async () => {
  let calls = 0;
  const clients = { cloud: { async chat() { calls += 1; } }, ollama: { async streamChat() { calls += 1; } } };
  await assert.rejects(executeIsolatedModel({ provider: 'sqlite-provider' }, [], {}, null, clients), error => error.code === 'UNSUPPORTED_MODEL_PROVIDER');
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run the executor test and verify RED**

Run: `node --test backend/tests/fix6jIsolatedModelExecutor.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `isolatedModelExecutor`.

- [ ] **Step 3: Implement the minimal store-free executor**

```js
'use strict';

const productionCloud = require('./openAiCompatibleClient');
const productionOllama = require('./ollamaClient');

async function executeIsolatedModel(executionSpec = {}, messages = [], options = {}, signal = null, clients = {}) {
  const provider = String(executionSpec.provider || '').trim().toLowerCase();
  const cloud = clients.cloud || productionCloud;
  const ollama = clients.ollama || productionOllama;
  if (['openai', 'openai-compatible', 'cloud'].includes(provider)) {
    return cloud.chat({
      endpoint: executionSpec.endpoint,
      apiKey: executionSpec.credential?.apiKey || '',
      model: executionSpec.modelName,
      messages,
      options,
      signal
    });
  }
  if (provider === 'ollama') {
    return ollama.streamChat({ endpoint: executionSpec.endpoint, model: executionSpec.modelName, messages, options, signal });
  }
  throw Object.assign(new Error(`UNSUPPORTED_MODEL_PROVIDER:${provider}`), { code: 'UNSUPPORTED_MODEL_PROVIDER', status: 400 });
}

module.exports = { executeIsolatedModel };
```

- [ ] **Step 4: Run the executor test and verify GREEN**

Run: `node --test backend/tests/fix6jIsolatedModelExecutor.test.js`

Expected: exit code 0, 3 tests passed, 0 failed.

- [ ] **Step 5: Record Task 2 checkpoint**

Hash the new source and test files and append exact command/exit-code evidence to `artifacts/fix6j/task2-checkpoint.log`.

---

### Task 3: Host/Worker IPC Cutover and SQLite Isolation Regression

**Files:**
- Create: `backend/tests/fix6jWorkerSqliteIsolation.test.js`
- Modify: `backend/services/modelExecutionHost.js`
- Modify: `backend/services/modelExecutionWorker.js`
- Regression-only, no planned edit: `backend/tests/batch39AiPhysicalExecution.test.js`
- Regression-only, no planned edit: `backend/tests/fix6gModelExecutionTelemetry.test.js`

**Interfaces:**
- `startModelExecution(input)` gains optional `resolveExecutionSpec(model)` injection for deterministic tests.
- The IPC `execute` envelope gains `executionSpec`; Worker execution no longer consumes `message.model`.
- Existing result/exit handle interface remains unchanged.

- [ ] **Step 1: Write the failing isolation and leak tests**

Create tests that exercise the real production Host and Worker. The core cases and literal assertions are:

```js
test('production worker reaches protocol readiness while the parent owns SQLite', async () => {
  const handle = startModelExecution({
    model: { id: 'local-fixture', provider: 'ollama', name: 'missing-fixture', endpoint: 'http://127.0.0.1:1' },
    messages: [],
    options: { timeoutMs: 100 },
    resolveExecutionSpec() {
      return Object.freeze({ provider: 'unsupported-after-start', endpoint: '', modelName: '', modelId: 'local-fixture' });
    }
  });
  const started = await handle.started;
  assert.equal(started.workerStarted, true);
  await assert.rejects(handle.result, error => error.code === 'UNSUPPORTED_MODEL_PROVIDER');
  const receipt = await handle.exit;
  assert.equal(receipt.workerStarted, true);
  assert.equal(receipt.stderrTail.includes('SQLITE_OWNERSHIP_CONFLICT'), false);
});

test('credential canary never appears in the execution receipt or captured process output', async () => {
  const canary = 'fix6j-secret-canary-7f4d9e';
  const handle = startModelExecution({
    model: { id: 'cloud-fixture', provider: 'cloud', name: 'missing', credentialRef: 'fixture' },
    messages: [], options: { timeoutMs: 100 },
    resolveExecutionSpec() {
      return Object.freeze({ provider: 'cloud', endpoint: 'http://127.0.0.1:1/v1', modelName: 'missing', modelId: 'cloud-fixture', credential: Object.freeze({ apiKey: canary }) });
    }
  });
  await handle.started;
  await assert.rejects(handle.result);
  const receipt = await handle.exit;
  assert.equal(JSON.stringify(receipt).includes(canary), false);
  assert.equal(receipt.stdoutTail.includes(canary), false);
  assert.equal(receipt.stderrTail.includes(canary), false);
});
```

Also add a runtime dependency-closure test that starts a helper Node process with a preload hook recording every resolved module while loading `modelExecutionWorker.js`. Assert the recorded absolute paths contain none of these path fragments: `sqlite`, `systemPolicy`, `securityGuardSingleton`, `r32StoreSingleton`, `storeProvider`. This tests observed module loading rather than grepping source text.

- [ ] **Step 2: Run the new Worker test and verify RED**

Run: `node --test backend/tests/fix6jWorkerSqliteIsolation.test.js`

Expected: the production Worker fails before protocol readiness with the current SQLite ownership stack, or the injected `resolveExecutionSpec` is ignored. Confirm the failure is not a fixture syntax error.

- [ ] **Step 3: Modify Host to resolve before fork**

Add at module scope:

```js
const { resolveModelExecutionSpec } = require('./modelExecutionSpecResolver');
```

Add an optional input field:

```js
resolveExecutionSpec = resolveModelExecutionSpec
```

Before `fork`, compute:

```js
const executionSpec = resolveExecutionSpec(model);
```

Change only the execute envelope payload:

```js
child.send({ type: 'execute', executionId, correlationId, task: clean(task), executionSpec, messages, options: workerOptions });
```

Do not add `executionSpec` to the returned handle, receipt, errors, logging, or diagnostics.

- [ ] **Step 4: Modify Worker to use the store-free executor**

Replace the production import with:

```js
const { executeIsolatedModel } = require('./isolatedModelExecutor');
```

Inside the execute handler freeze only the expected snapshot fields and call:

```js
const source = message.executionSpec || {};
const executionSpec = Object.freeze({
  provider: String(source.provider || ''),
  endpoint: String(source.endpoint || ''),
  modelName: String(source.modelName || ''),
  modelId: String(source.modelId || ''),
  ...(source.credential && typeof source.credential === 'object'
    ? { credential: Object.freeze({ apiKey: String(source.credential.apiKey || '') }) }
    : {})
});
const result = await executeIsolatedModel(executionSpec, Array.isArray(message.messages) ? message.messages : [], options, controller.signal);
```

Never serialize `executionSpec` in the catch path.

- [ ] **Step 5: Run the Worker tests and verify GREEN**

Run:

```powershell
node --test backend/tests/fix6jWorkerSqliteIsolation.test.js
```

Expected: exit code 0; the real Worker reaches `started`, no SQLite module appears in the observed dependency closure, and the canary has zero receipt/stdout/stderr hits.

- [ ] **Step 6: Run existing protocol and physical-capacity regressions**

Run:

```powershell
node --test backend/tests/batch39AiPhysicalExecution.test.js backend/tests/fix6gModelExecutionTelemetry.test.js backend/tests/fix6gWindowsFailureComposition.test.js
```

Expected: exit code 0 and 0 failed. The existing custom Worker fixtures ignore the added `executionSpec` property, so no test-source compatibility edit is expected. Any unexpected failure requires diagnosis and a new failing regression test before a production change.

- [ ] **Step 7: Refactor only after all Task 3 tests are green**

Deduplicate snapshot normalization only if both Host and Worker contain identical validation logic. Keep credential resolution main-process-only and provider dispatch Worker-only. Re-run Steps 5 and 6 after refactoring.

- [ ] **Step 8: Record Task 3 checkpoint**

Save changed-file hashes, the unified diff from the pristine extracted baseline, both test logs, and exact exit codes under `artifacts/fix6j/`.

---

### Task 4: Full Verification, Evidence, and Windows-UAT Handoff

**Files:**
- Create: `YANCE_BATCH40_FIX6J_WORKER_SQLITE_REMOVAL_VERIFICATION.json`
- Create: `artifacts/fix6j/*.log`
- Do not modify production behavior in this task unless verification reveals a regression; any fix requires a new RED test in the owning task.

**Interfaces:**
- Produces a machine-readable verification document with source identity, hashes, commands, exit codes, test totals, secret-scan result, changed files, and an explicit `windowsRealUat` status.

- [ ] **Step 1: Run the complete FIX6J focused suite**

Run:

```powershell
node --test backend/tests/fix6jModelExecutionSpecResolver.test.js backend/tests/fix6jIsolatedModelExecutor.test.js backend/tests/fix6jWorkerSqliteIsolation.test.js
```

Expected: exit code 0, 0 failed. Save unmodified stdout/stderr and exit code to `artifacts/fix6j/focused.log` and `focused.exitcode.txt`.

- [ ] **Step 2: Run the complete backend suite from a controlled short test root**

Use explicit short Windows paths for `YANCE_TEST_TEMP_ROOT`, `TEMP`, and `TMP`, and preserve the baseline data directory. Run `node backend/run_all_tests.js` from the verified source root and capture the complete output and final exit code.

Expected: exit code 0 and no `FAILED:` markers. A partial run or missing final exit code is a failed gate.

- [ ] **Step 3: Run a runtime secret scan**

Search all FIX6J-generated logs, receipts, and verification JSON for `fix6j-secret-canary-7f4d9e`.

Expected: zero matches outside the test source that defines the canary. Record the scanned paths and zero-match result.

- [ ] **Step 4: Audit scope against the pristine extracted baseline**

Expected production changes are limited to:

```text
backend/services/modelExecutionSpecResolver.js
backend/services/isolatedModelExecutor.js
backend/services/modelExecutionHost.js
backend/services/modelExecutionWorker.js
```

Tests, evidence, design, and plan files may also differ. Any connector, frontend, registry, routing, queue, SQLite ownership, or release-governance change fails the scope gate.

- [ ] **Step 5: Generate the verification JSON**

The document must record these concrete fields from fresh evidence: `schemaVersion: 1`; fix identifier `FIX6J_ISOLATED_MODEL_WORKER_SQLITE_REMOVAL`; the exact archive hash, derived version, and base commit from Global Constraints; and focused, related-regression, and backend-full gate objects containing the observed status, exit code, parsed test total, failed count, and log path. It must also record the observed forbidden-module list, secret-scan match count, changed-file hashes, `windowsRealUat.status`, missing real-UAT evidence, and release flags. Do not emit a gate object until its log exists and its exit code and test totals have been parsed; do not mark a gate PASS without exit code 0 and zero failures.

- [ ] **Step 6: Perform available real Windows UAT without overstating status**

If the installed Yance session and a configured provider are available, run one genuine model request while the main process owns `yance-r32.db`, then export a new diagnostics JSON. Require `workerStarted: true`, a non-sensitive provider receipt, and zero `SQLITE_OWNERSHIP_CONFLICT` hits. Run one cancellation or timeout and verify physical capacity returns to zero.

If provider access or required UI interaction is unavailable, leave `windowsRealUat.status` as `PENDING` and list the missing evidence. Automated tests do not satisfy this gate.

- [ ] **Step 7: Record final no-Git checkpoint**

Produce:

- SHA256 for every changed production and test file;
- SHA256 for all evidence logs and verification JSON;
- a unified source diff against a fresh extraction of the verified FIX6I ZIP;
- the unchanged input ZIP SHA256;
- explicit confirmation that no GitHub `main` overlay was used.

Do not initialize Git solely to create a commit.
