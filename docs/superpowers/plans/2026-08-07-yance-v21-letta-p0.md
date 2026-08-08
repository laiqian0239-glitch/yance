# Yance V2.1 Letta P0 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt Letta Agent SDK 0.6.2 plus Letta Code 0.30.5 as Yance's persistent-agent authority while keeping Yance limited to desktop child-process supervision, guarded IPC, Yance-rooted storage and projection inside the existing Element Yance Workspace.

**Architecture:** Yance launches the official `@letta-ai/letta-code` CLI with the existing trusted Node runtime and `server --backend local --listen ws://127.0.0.1:0`. The explicit local backend prevents machine/user backend preference from silently selecting the cloud/API backend. The adapter parses the official listening line, rejects non-loopback URLs, binds `LETTA_LOCAL_BACKEND_DIR` under the resolved Yance data root, removes cloud API credentials from the child environment, and connects `@letta-ai/letta-agent-sdk` through its public `backend: "remote"` management API. Here `remote` describes the SDK connection topology to the already-running App Server; Letta Code remains on its local persistent backend. Letta owns persistent agent state, memory, conversations, compaction and App Server internals; Yance never persists a parallel agent/memory model.

**Tech Stack:** Electron 39.8.5, Node >=22.19.0, CommonJS desktop host, `@letta-ai/letta-agent-sdk@0.6.2`, `@letta-ai/letta-code@0.30.5`, Node test runner, Element runtime module/React workspace.

## Global Constraints

- Authorization: `governance/layered-ci/v21-letta-p0-v2-authorization.json`, merged by ordinary two-parent commit `cb8f816759dec6a17d22a9bd37cd2a23a72946fd`.
- Implementation branch: exactly `product/v21-letta-p0-v2`.
- Final implementation diff: exactly the 14 authorized paths; no workflow modification.
- Direct exact dependencies: `@letta-ai/letta-agent-sdk` = `0.6.2`; `@letta-ai/letta-code` = `0.30.5`; mutable ranges forbidden.
- Supported runtime floor: Node `>=22.19.0`; Electron `39.8.5` compatibility remains explicit.
- Letta Code CLI command: `server --backend local --listen ws://127.0.0.1:0`; deprecated `app-server` alias forbidden.
- Loopback only. No `0.0.0.0`, LAN or externally supplied listen URL in the Yance launch path.
- Shutdown authority: SIGTERM to the Letta Code CLI, whose upstream handler owns App Server close; no Agent SDK private-field access.
- Forbidden: `managementTransport`, `ownedConnection`, unexported Agent SDK subpaths, copied SDK launcher code, Yance memory engine, Yance agent state machine, provider hardcoding, Parlant, LiteLLM/RouteLLM, Langfuse, second AI frontend, or message-send authority.
- The existing Element Yance Workspace is the only AI product surface.
- Production use, release, publish, promotion and automatic next-work-package authorization remain withheld.

---

### Task 1: Failure-first Letta authority contracts

**Files:**
- Create: `tests/wp0/v21-letta-p0.test.js`
- Create: `tests/wp0/v21-letta-workspace-contract.test.js`

**Interfaces:**
- Consumes: current trusted main with no Letta implementation.
- Produces: executable contracts for exact dependency/upstream pins, Node floor, adapter API, official CLI lifecycle, guarded IPC and single-workspace projection.

- [ ] **Step 1: Add exact dependency/upstream RED contracts**

The test must require:

```js
assert.equal(pkg.dependencies['@letta-ai/letta-agent-sdk'], '0.6.2');
assert.equal(pkg.dependencies['@letta-ai/letta-code'], '0.30.5');
assert.equal(pkg.engines.node, '>=22.19.0');
```

It must also require `config/upstreams/v21-letta-p0.json` to bind SDK commit `c48df1693731443682fe8c7f356ef9b8a33df6c0` and Letta Code commit `3e5ead65dcf3b7fdf1e2da595660eb85063a9722` under Apache-2.0.

- [ ] **Step 2: Add adapter RED contracts**

Require `electron/lettaAgentRuntime.js` to export:

```js
{
  LETTA_AGENT_SDK_VERSION,
  LETTA_CODE_VERSION,
  assertLoopbackListenUrl,
  resolveLettaCodeEntrypoint,
  buildLettaEnvironment,
  createLettaAgentRuntime
}
```

The source contract must prove use of the official Letta Code package/`server --backend local --listen`, public Agent SDK `backend: 'remote'`, SIGTERM shutdown, and absence of forbidden private/internal access.

- [ ] **Step 3: Add workspace/IPC RED contracts**

Require the existing IPC manifest, preload, main process and `YanceWorkspace.tsx` to expose Letta status/identity without adding a second frontend or direct renderer Node access.

- [ ] **Step 4: Verify causal RED**

Run:

```bash
node --test --test-concurrency=1 tests/wp0/v21-letta-p0.test.js tests/wp0/v21-letta-workspace-contract.test.js
```

Expected: FAIL because the trusted base lacks the exact Letta dependencies/config/adapter/IPC/workspace projection. The failure must be assertion-based and attributable to the missing authorized implementation, not syntax or fixture errors.

- [ ] **Step 5: Commit the test-only RED**

```bash
git add tests/wp0/v21-letta-p0.test.js tests/wp0/v21-letta-workspace-contract.test.js
git commit -m "test(v21): lock Letta P0 v2 contracts"
```

### Task 2: Exact Letta dependency, upstream and license closure

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `config/upstreams/v21-letta-p0.json`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `third_party/licenses/letta-agent-sdk-Apache-2.0.txt`
- Create: `third_party/licenses/letta-code-Apache-2.0.txt`
- Test: `tests/wp0/v21-letta-p0.test.js`

**Interfaces:**
- Consumes: exact versions/commits from the authorization.
- Produces: reproducible package-lock and upstream/license evidence used by the runtime adapter tests.

- [ ] **Step 1: Change only the dependency metadata needed by the RED**

Set direct dependencies exactly:

```json
"@letta-ai/letta-agent-sdk": "0.6.2",
"@letta-ai/letta-code": "0.30.5"
```

Set `engines.node` to `>=22.19.0`. Keep unrelated package metadata/scripts unchanged.

- [ ] **Step 2: Regenerate the lock from the updated package manifest**

Run `npm install --package-lock-only --ignore-scripts` with the locked npm toolchain. Verify both direct packages resolve exactly and retain registry integrity fields.

- [ ] **Step 3: Add exact upstream lock and Apache-2.0 license copies**

`config/upstreams/v21-letta-p0.json` must record both repositories, tags, 40-character commits, npm package identities, license and the official Letta Code CLI launch contract.

- [ ] **Step 4: Extend `THIRD_PARTY_NOTICES.md`**

Add Letta Agent SDK and Letta Code entries without weakening or replacing existing notices.

- [ ] **Step 5: Run Task 1 dependency/upstream tests**

Run:

```bash
node --test --test-concurrency=1 tests/wp0/v21-letta-p0.test.js
```

Expected: dependency/upstream/license subtests GREEN; adapter lifecycle subtests may remain RED until Task 3.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json config/upstreams/v21-letta-p0.json THIRD_PARTY_NOTICES.md third_party/licenses/letta-agent-sdk-Apache-2.0.txt third_party/licenses/letta-code-Apache-2.0.txt
git commit -m "build(v21): pin Letta P0 authorities"
```

### Task 3: Thin Letta Code App Server lifecycle adapter

**Files:**
- Create: `electron/lettaAgentRuntime.js`
- Test: `tests/wp0/v21-letta-p0.test.js`

**Interfaces:**
- Consumes: trusted Node executable path supplied by Electron main; Yance data root; exact direct Letta packages.
- Produces: `createLettaAgentRuntime(options)` object with `start()`, `stop()`, `snapshot()`, `listAgents()` and `listConversations()`; no persistent Yance-side agent/memory storage.

- [ ] **Step 1: Implement pure guards first**

`assertLoopbackListenUrl(url)` accepts only `ws://127.0.0.1:<port>` / IPv6 loopback equivalents produced by the official CLI and throws a reason-coded error otherwise.

`buildLettaEnvironment(baseEnv, yanceDataRoot)` returns a child environment with:

```js
LETTA_LOCAL_BACKEND_DIR = path.join(yanceDataRoot, 'letta', 'local-backend')
```

and removes both `ELECTRON_RUN_AS_NODE` and `LETTA_API_KEY` from the child environment. The CLI backend flag, rather than inherited user/cloud settings, is the backend authority.

- [ ] **Step 2: Resolve the official package entrypoint**

`resolveLettaCodeEntrypoint()` must use Node package resolution for the direct `@letta-ai/letta-code` package. Do not traverse `@letta-ai/letta-agent-sdk/node_modules` and do not import SDK internals.

- [ ] **Step 3: Implement start/management connection**

Spawn the trusted Node executable with:

```text
<resolved Letta Code entry> server --backend local --listen ws://127.0.0.1:0
```

Parse the official `WebSocket: ws://127.0.0.1:<port>` line, enforce the loopback guard, then construct `new LettaAgentClient({ backend: 'remote', url })`. The SDK `remote` value is only the connection topology to the Yance-owned pre-started App Server; the CLI's explicit `--backend local` owns persistence/backend selection. Use sessionless `client.agents.list()` / `client.conversations.list()` for management reads.

- [ ] **Step 4: Implement supported clean shutdown**

`stop()` sends `SIGTERM` only to the child process owned by this adapter and waits for its exit. Do not kill arbitrary PIDs and do not use Agent SDK private fields.

- [ ] **Step 5: Run unit/source contracts**

Run the Task 1 test file and verify the adapter source/API contracts are GREEN.

- [ ] **Step 6: Run a real management probe**

Start the actual App Server on loopback with the explicit local backend, call a sessionless management read without generating a model turn or requiring `LETTA_API_KEY`, call `stop()`, and assert the child exits cleanly. The probe must use a temporary Yance data root and confirm `LETTA_LOCAL_BACKEND_DIR` is beneath it.

- [ ] **Step 7: Commit**

```bash
git add electron/lettaAgentRuntime.js tests/wp0/v21-letta-p0.test.js
git commit -m "feat(v21): host official Letta App Server"
```

### Task 4: Guarded Electron IPC integration

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `electron/m2/ipcManifest.json`
- Test: `tests/wp0/v21-letta-workspace-contract.test.js`

**Interfaces:**
- Consumes: `createLettaAgentRuntime({ nodeExecutablePath, dataRoot })` from Task 3 and existing `ipcGuardHandle`/preload patterns.
- Produces: readonly renderer methods `getLettaState()`, `listLettaAgents()` and `listLettaConversations(input)`; lifecycle stays main-process-owned.

- [ ] **Step 1: Wire runtime ownership into `electron/main.js`**

Create one main-process runtime instance after trusted paths/data root are available; start it during desktop startup and stop it during the existing quit path. No renderer method may start/stop the process.

- [ ] **Step 2: Register guarded IPC**

Add exact channels:

```text
desktop:letta-get-state
desktop:letta-list-agents
desktop:letta-list-conversations
```

Use the existing main-frame `ipcGuardHandle` boundary. Conversation listing input is a schema-bounded object; no arbitrary filesystem/process input is accepted.

- [ ] **Step 3: Expose readonly preload APIs**

Expose only the three methods above through the existing context bridge. Do not expose Node, spawn, paths, environment mutation or generic Letta client objects.

- [ ] **Step 4: Update IPC manifest**

Add the exact channels with renderer-to-main direction, appropriate lifecycle phase, schemas, reason codes and no sensitive-field leakage.

- [ ] **Step 5: Run workspace/IPC contracts**

```bash
node --test --test-concurrency=1 tests/wp0/v21-letta-workspace-contract.test.js
```

Expected: IPC/preload/main contracts GREEN; visual workspace projection may remain RED until Task 5.

- [ ] **Step 6: Commit**

```bash
git add electron/main.js electron/preload.js electron/m2/ipcManifest.json tests/wp0/v21-letta-workspace-contract.test.js
git commit -m "feat(v21): expose guarded Letta management IPC"
```

### Task 5: Project Letta identity into the existing Element workspace

**Files:**
- Modify: `integration/element-module/src/YanceWorkspace.tsx`
- Test: `tests/wp0/v21-letta-workspace-contract.test.js`

**Interfaces:**
- Consumes: readonly preload Letta APIs from Task 4.
- Produces: Letta runtime/agent/conversation status inside the existing `data-yance-workspace` surface only.

- [ ] **Step 1: Add readonly Letta state loading**

The workspace reads runtime state and management lists through the trusted desktop API when available. It must tolerate the desktop API being absent when Element runs outside Electron.

- [ ] **Step 2: Render status/identity in the existing workspace**

Add a compact Letta status section showing runtime state and authoritative agent/conversation identity. Do not add a separate route, page, shell, model-provider default or message send action.

- [ ] **Step 3: Preserve runtime ownership boundaries**

The component must not contain Node imports, `spawn`, filesystem APIs, direct Agent SDK imports, process control, Letta persistence, or duplicated memory state.

- [ ] **Step 4: Run workspace contracts**

Run the workspace test and existing Element workspace contract tests. Both must remain GREEN.

- [ ] **Step 5: Commit**

```bash
git add integration/element-module/src/YanceWorkspace.tsx tests/wp0/v21-letta-workspace-contract.test.js
git commit -m "feat(v21): project Letta state in Yance Workspace"
```

### Task 6: Full authorized-scope verification and review boundary

**Files:**
- Verify all 14 authorized paths only.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: an exact review candidate; no merge authority.

- [ ] **Step 1: Verify exact changed-path scope**

Compare from authorization merge `cb8f816759dec6a17d22a9bd37cd2a23a72946fd` and require the final sorted path list to equal the authorization's 14 paths and SHA-256 `97a70af318307f072f029266b25b49f1ea3caeddf4382313adc452c9f0dab65d`.

- [ ] **Step 2: Run focused Letta tests**

```bash
node --test --test-concurrency=1 tests/wp0/v21-letta-p0.test.js tests/wp0/v21-letta-workspace-contract.test.js
```

Require zero failures and a successful real App Server lifecycle probe.

- [ ] **Step 3: Run full WP0 gate locally when dependencies are available**

```bash
npm run test:wp0
npm run verify:wp0:gate
```

- [ ] **Step 4: Verify forbidden architecture is absent**

Search the 14-path diff for Agent SDK private fields/internal subpaths, deprecated `app-server` alias, non-loopback listen addresses, Yance memory/agent persistence, provider defaults, Parlant, RouteLLM/LiteLLM, Langfuse and second-frontend patterns. Any occurrence that grants those authorities is a failure.

- [ ] **Step 5: Push exact Head and require CI/review**

Stage WP0, Layered CI, ACV2, CodeRabbit and independent review must bind the same exact Head. Resolve only findings proved fixed by successor commits and fresh verification.

- [ ] **Step 6: Stop at final implementation merge boundary**

Do not merge the implementation PR without explicit owner approval. Ordinary two-parent merge is required; squash/rebase/force-push/amend are forbidden.