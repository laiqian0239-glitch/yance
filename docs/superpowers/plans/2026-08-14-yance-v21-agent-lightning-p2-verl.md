# Yance V2.1 Agent Lightning P2 VERL Candidate Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land one real, sealed Agent Lightning v0.3.0 VERL/GRPO candidate-model training slice that consumes only Learning-approved evidence, trains an isolated local Qwen2.5-1.5B-Instruct candidate, and returns checkpoint evidence as `CANDIDATE_ONLY` without creating a second production model gateway or promotion path.

**Architecture:** Reuse the landed P1 Agent Lightning Node adapter, Python entrypoint, exact upstream `uv.lock`, SBOM generator and WSL2 preflight. Add one explicit `VERL_GRPO` mode in the same runtime. VERL owns the training-only local vLLM/ProxyLLM endpoint; Learning remains canonical for eligibility/reward evidence; Model Brain remains canonical for normal production inference. Route bootstrap and product authorization remain separate predecessor work packages so implementation scope cannot widen after failure-first RED.

**Tech Stack:** Node.js 22.19.0, Python 3.12 control code, Microsoft Agent Lightning v0.3.0 @ `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`, VERL + vLLM selected by that revision's exact `uv.lock`, Qwen/Qwen2.5-1.5B-Instruct @ `fb163acb387a011a0cd205b259aa1b253299a05d`, Linux/WSL2, GitHub Actions, CycloneDX 1.7.

## Global Constraints

- Starting trusted main: `c25cf23e3a4ab3ca821c7a980731b220e935d73f`. Rebuild any authorization proposal if live `main` moves before its ordinary merge.
- P2 work package: `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1`.
- Agent Lightning: `microsoft/agent-lightning`, `v0.3.0`, commit `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`, MIT, Python `>=3.10`.
- Immutable Agent Lightning lock: `runtime/deep-training/agent-lightning/uv.lock`, Git blob `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`, `12,891,147` bytes.
- Initial model: `Qwen/Qwen2.5-1.5B-Instruct@fb163acb387a011a0cd205b259aa1b253299a05d`, Apache-2.0. `model.safetensors` SHA-256 `dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee`, `3,087,467,144` bytes.
- Model files never enter Yance Git. Normal runtime never downloads a model or resolves/install dependencies.
- Linux is execution authority. Windows uses validated WSL2 only. No native-Windows, Docker, cloud trainer or alternate-engine fallback.
- Learning owns eligibility, `do_not_learn`, privacy/minimization, canonical relationship/global scope, signal identity/order, Learning-approved Langfuse Score evidence, experiment evidence, regression, shadow, promotion and rollback.
- One Learning signal maps to one P2 rollout identity. Only finite numeric Learning-approved Langfuse Score values cross; values cross unchanged. Yance performs no reward scaling, clipping, mapping, normalization, weighting or shaping.
- Model Brain remains the only normal production model/provider/routing authority. P2 vLLM/ProxyLLM is `TRAINING_ONLY` and never enters the production route table.
- P2 uses upstream Agent Lightning `VERL`, VERL framework and vLLM. No Yance trainer, RL engine, reward engine, second canonical training store, generic model gateway or generic training RPC framework.
- Output is a bounded checkpoint manifest plus evidence with `status = CANDIDATE_ONLY`. P2 cannot claim `READY_FOR_REVIEW`, `READY_FOR_PROMOTION`, production activation, formal release or publish.
- P1 APO is a mandatory regression surface.
- SFT/Unsloth, Tinker/cloud training, Azure fine-tuning and Mongo LightningStore canonicalization stay out of scope.
- No amend/rebase/force-push/squash authority substitution. Integration uses ordinary two-parent history.

## File Map and Frozen Candidate Scopes

Documentation predecessors:

- `docs/superpowers/specs/2026-08-14-yance-v21-agent-lightning-p2-verl-design.md`
- `docs/superpowers/plans/2026-08-14-yance-v21-agent-lightning-p2-verl.md`

Route authorization proposal:

- `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1-authorization.json`

Route implementation:

- `governance/layered-ci/wp0-routing-policy.json`
- `tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js`

Product authorization proposal:

- `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-candidate-v1-authorization.json`

Expected P2 product implementation scope after route closure:

1. `.github/workflows/v21-agent-lightning-p2-verl-linux.yml`
2. `THIRD_PARTY_NOTICES.md`
3. `backend/services/agentLightningTrainingAdapter.js`
4. `config/upstreams/v21-agent-lightning-p2-verl.json`
5. `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
6. `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
7. `runtime/deep-training/agent-lightning/pyproject.toml`
8. `tests/wp0/v21-agent-lightning-p2-authority-boundary.test.js`
9. `tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js`
10. `tests/wp0/v21-agent-lightning-p2-supply-chain.test.js`
11. `tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js`
12. `tests/wp0/v21-agent-lightning-p2-wsl-runtime.test.js`
13. `third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt`
14. `third_party/licenses/verl-Apache-2.0.txt`
15. `third_party/licenses/vllm-Apache-2.0.txt`
16. `tools/deep-training/agent-lightning-preflight.ps1`

Expected 16-path canonical SHA-256 if fresh reconstruction is unchanged: `bba7fb993746435a9fe25312aedb258639ea342502ece0610189263193de2021`.

Expected five-test failure-first SHA-256: `57d94ec2ecdd64aa99e5ca544b4df222f30080007720b926e4f0536d687654c9`.

The existing `uv.lock` is an immutable dependency-control input, not an expected changed path.

---

### Task 1: Close exact P2 supply-chain identity before route authorization

**Files:**
- Read: `runtime/deep-training/agent-lightning/uv.lock`
- Read: upstream Agent Lightning `pyproject.toml` at `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`
- No repository write.

**Interfaces:**
- Consumes: exact P1 lock blob.
- Produces: exact lock-selected versions and exact release-tag/40-SHA/license identities for direct P2 engines `verl` and `vllm`; exact Qwen snapshot receipt inputs.

- [ ] **Step 1: Verify the lock before parsing**

```powershell
git fetch origin
$main = (git rev-parse origin/main).Trim()
$blob = (git hash-object runtime/deep-training/agent-lightning/uv.lock).Trim()
$bytes = (Get-Item runtime/deep-training/agent-lightning/uv.lock).Length
if ($blob -ne '5a98a2ac121b050b0a82f6ac8dc207577ce3af4e') { throw "Agent Lightning lock blob drift: $blob" }
if ($bytes -ne 12891147) { throw "Agent Lightning lock size drift: $bytes" }
```

A lock mismatch is an authorization redesign boundary.

- [ ] **Step 2: Parse exact package versions without modifying the lock**

```powershell
python -c "import json,pathlib,tomllib; d=tomllib.loads(pathlib.Path(r'runtime/deep-training/agent-lightning/uv.lock').read_text(encoding='utf-8')); wanted={'verl','vllm','torch','torchvision','flash-attn','tensordict','transformers','litellm'}; found={x['name']:x.get('version') for x in d['package'] if x['name'] in wanted}; print(json.dumps(found,sort_keys=True,indent=2)); assert 'verl' in found and 'vllm' in found"
```

`verl` must satisfy Agent Lightning's fixed `torch-gpu-stable` requirement `>=0.6.0`; vLLM must satisfy the fixed revision's compatibility constraints. Missing/incompatible packages invalidate P2 authorization rather than permitting a new lock.

- [ ] **Step 3: Resolve direct engines to exact source commits**

For the lock-selected versions, resolve release tags to 40-character commits from the authoritative repositories:

```text
verl-project/verl     Apache-2.0
vllm-project/vllm     Apache-2.0
```

Do not use repository `main` or a nearby release.

- [ ] **Step 4: Revalidate the Qwen snapshot**

Require:

```text
revision: fb163acb387a011a0cd205b259aa1b253299a05d
license: Apache-2.0
model.safetensors size: 3087467144
model.safetensors sha256: dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee
```

Freeze SHA-256 values in the P2 upstream receipt for these exact-revision runtime files as well:

```text
config.json
generation_config.json
merges.txt
tokenizer.json
tokenizer_config.json
vocab.json
```

The runtime later reads those hashes from the trusted receipt; it does not trust caller-supplied expected hashes.

- [ ] **Step 5: Freeze the four route-bootstrap supply-chain paths**

```text
config/upstreams/v21-agent-lightning-p2-verl.json
third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt
third_party/licenses/verl-Apache-2.0.txt
third_party/licenses/vllm-Apache-2.0.txt
```

Canonical SHA-256: `ffd81db6e8a122119a7b4862eedf85524bb25286028cc1d05d62209e055ee73c`.

Existing Yance PyTorch and LiteLLM license evidence is reused. Other lock packages remain transitive SBOM members rather than new direct route/license files.

---

### Task 2: Land approved design + plan as docs-only trusted history

**Files:**
- `docs/superpowers/specs/2026-08-14-yance-v21-agent-lightning-p2-verl-design.md`
- `docs/superpowers/plans/2026-08-14-yance-v21-agent-lightning-p2-verl.md`

**Interfaces:**
- Produces: trusted-main design/plan predecessor for later authorization files.

- [ ] **Step 1: Verify branch diff is documentation-only**

```powershell
git diff --name-only c25cf23e3a4ab3ca821c7a980731b220e935d73f...HEAD
```

Expected exactly those two docs paths.

- [ ] **Step 2: Open docs-only PR, run applicable exact-head gates and independent review**

No product/runtime/governance path is allowed in this PR.

- [ ] **Step 3: Ordinary-merge after fresh-main recheck**

If main moved, reconcile by ordinary descendant history and revalidate. Never rebase/amend/force-push.

---

### Task 3: Authorize the four-path route bootstrap

**Files:**
- Create: `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1-authorization.json`

**Interfaces:**
- Consumes: Task 1 source identities and trusted docs.
- Produces: authority for exactly one route test plus one route-policy edit.

- [ ] **Step 1: Create fresh branch from then-current main**

```text
governance/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1-authorization
```

Single authorized file path digest: `452256583647f7bbb074081613810ae9557b5edcdeff6a65bca93a88a2f2e39b`.

- [ ] **Step 2: Encode exact route authorization**

Required implementation seal:

```json
{
  "branch": "fix/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1",
  "allowedChangedPaths": [
    "governance/layered-ci/wp0-routing-policy.json",
    "tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js"
  ],
  "approvedChangedFileCount": 2,
  "approvedChangedFileSetSha256": "eef295ce805fe9f2c0938d00db5da1ee0c11eb77ede3881def2d0cf9c2d79380",
  "firstCommitMustBeTestOnly": true,
  "firstCommitAllowedChangedPaths": [
    "tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js"
  ],
  "firstCommitChangedFileSetSha256": "3ca133c456bcc19a0ece33f2945eae5b1cdadcc6ab87f30d2d5438427c813c3b"
}
```

Required `bootstrapPaths` are the four paths from Task 1 with digest `ffd81db6e8a122119a7b4862eedf85524bb25286028cc1d05d62209e055ee73c`.

Also bind the then-current base commit, routing-policy blob, `unknownPathFailsClosed = true`, existing generic `bootstrapPaths` guard, exact Task 1 OSS/model identities, no broad prefix mutation and zero P2 runtime/product authority.

- [ ] **Step 3: Run applicable Stage/Layered/ACV2 gates and independent review**

Unresolved P0/P1 must be zero.

- [ ] **Step 4: Apply ordinary-merge rule**

Authorization is ineffective before ordinary two-parent merge. If repository governance still requires an owner action at that exact head, this is the real authorization boundary; otherwise use the standing owner authorization only while base/scope/gates remain exact.

---

### Task 4: Route failure-first RED, then literal four-path GREEN

**Files:**
- Create: `tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js`
- Modify: `governance/layered-ci/wp0-routing-policy.json`

**Interfaces:**
- Produces: four exact P2 supply-chain paths routed as product; adjacent decoys remain unknown.

- [ ] **Step 1: Write the test-only RED**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRoute } = require('../../tools/wp0/lib');

const targets = [
  'config/upstreams/v21-agent-lightning-p2-verl.json',
  'third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt',
  'third_party/licenses/verl-Apache-2.0.txt',
  'third_party/licenses/vllm-Apache-2.0.txt',
];

test('P2 VERL supply-chain paths require exact product routes', () => {
  for (const target of targets) {
    assert.equal(selectRoute([target]).reason, 'PRODUCT_WP0');
  }
});

test('P2 route repair does not create broad-prefix authority', () => {
  for (const target of [
    'config/upstreams/v21-agent-lightning-p2-unapproved.json',
    'third_party/licenses/verl-unapproved.txt',
    'third_party/licenses/qwen-unapproved.txt',
  ]) {
    assert.equal(selectRoute([target]).reason, 'WP0_ROUTE_UNKNOWN_PATH');
  }
});
```

- [ ] **Step 2: Run and record causal RED**

```powershell
node --test tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js
```

Expected: first test fails because the four target paths are `WP0_ROUTE_UNKNOWN_PATH`; decoy test already passes. A parser/assertion bug is not valid RED.

- [ ] **Step 3: Commit test-only RED and capture exact CI failure**

Exactly one changed path; zero routing-policy/product/runtime changes.

- [ ] **Step 4: Add only four literals to `productExactPaths`**

Do not mutate prefixes, governance precedence, documentation precedence, `unknownPathFailsClosed` or generic delegated route guard.

- [ ] **Step 5: Run GREEN suites**

```powershell
node --test tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js
node --test tests/layered-ci/*.test.js
```

- [ ] **Step 6: Exact-head gates/review, then ordinary merge**

Final diff is exactly the two authorized route paths.

---

### Task 5: Reconstruct and merge the exact P2 product authorization

**Files:**
- Create: `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-candidate-v1-authorization.json`

**Interfaces:**
- Consumes: merged route closure, trusted docs, exact source identities and landed P1/Learning/Model Brain seams.
- Produces: exact product + failure-first scope.

- [ ] **Step 1: Freshly inspect overlaps and reuse-only seams**

Re-read:

```text
backend/services/learningDeepTrainingContract.js
backend/services/learningProposalService.js
backend/services/learningEvaluationAdapter.js
backend/services/agentLightningTrainingAdapter.js
runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py
THIRD_PARTY_NOTICES.md
```

Also re-read current Model Brain execution/routing authority and all open PR overlaps for the expected 16 paths.

- [ ] **Step 2: Freeze the expected 16-path scope only if reconstruction still matches**

Expected digest: `bba7fb993746435a9fe25312aedb258639ea342502ece0610189263193de2021`.

Failure-first scope is exactly the five new P2 tests, digest `57d94ec2ecdd64aa99e5ca544b4df222f30080007720b926e4f0536d687654c9`.

If a necessary new path appears, close/rebuild authorization; do not widen implementation after RED.

- [ ] **Step 3: Freeze authority rules**

Authorization must explicitly require:

```text
Learning-issued projection only
one signal = one rollout identity
finite numeric Learning-approved Langfuse Score unchanged
Yance reward shaping forbidden
VERL/vLLM endpoint TRAINING_ONLY
P2 rollout through production Model Brain forbidden
provider credential inheritance forbidden
runtime dependency/model download forbidden
checkpoint writes outside run root forbidden
CANDIDATE_ONLY only
READY_FOR_REVIEW/PROMOTION claim forbidden
P1 APO regression required
SFT/Tinker/cloud/Azure FT/Mongo canonicalization forbidden
```

- [ ] **Step 4: Exact-head gates/review, ordinary-merge single-file authorization**

Implementation starts only from the effective authorization merge commit.

---

### Task 6: Create the mandatory five-test causal RED

**Files:**
- Create: `tests/wp0/v21-agent-lightning-p2-authority-boundary.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-supply-chain.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-wsl-runtime.test.js`

**Interfaces:**
- Produces: test-only causal evidence that P2 capability is absent before implementation.

- [ ] **Step 1: Freeze explicit adapter API expectations**

```js
assert.equal(typeof adapter.trainVerlRelationship, 'function');
assert.equal(typeof adapter.trainVerlGlobal, 'function');
assert.match(adapter.authority, /TRAINING_ONLY/u);
```

Tests reject non-Learning projection, mixed scope, boolean/string/non-finite score and non-Learning-approved score before runtime launch.

- [ ] **Step 2: Freeze one-signal/one-rollout and unchanged reward**

```js
assert.equal(envelope.algorithm, 'VERL_GRPO');
assert.deepEqual(
  envelope.tasks.map(item => [item.signalId, item.reward]),
  projection.trajectory.map(item => [item.signalId, item.score.value])
);
assert.equal(new Set(envelope.tasks.map(item => item.signalId)).size, envelope.tasks.length);
```

- [ ] **Step 3: Freeze correct VERL topology**

Source tests require upstream `VERL` + `Trainer` and a P2 rollout consuming `resources['main_llm']` / its local ProxyLLM endpoint. They reject use of P1 `ModelBrainBridge` in the P2 rollout path.

- [ ] **Step 4: Freeze candidate manifest boundary**

Require:

```js
assert.equal(result.status, 'CANDIDATE_ONLY');
assert.equal(result.candidate.kind, 'MODEL_CHECKPOINT');
assert.match(result.candidate.artifactId, /^agent-lightning-verl-[0-9a-f]{24}$/u);
assert.match(result.candidate.checkpointDigest, /^[0-9a-f]{64}$/u);
assert.match(result.candidate.checkpointRelativePath, /^[^/].*/u);
assert.equal('productionRoute' in result.candidate, false);
assert.equal('promotionStatus' in result.candidate, false);
```

- [ ] **Step 5: Freeze supply-chain and WSL contracts**

Require exact four new supply-chain paths, immutable Agent Lightning lock identity, exact Qwen receipt, exact lock-selected VERL/vLLM source commits, Apache-2.0 license copies, WSL2/CUDA/model/run-root checks and no native-Windows/Docker/cloud/download fallback.

- [ ] **Step 6: Run the five-test suite and validate causal RED**

```powershell
node --test tests/wp0/v21-agent-lightning-p2-*.test.js
```

Failures must be missing P2 methods/runtime/receipts, not routing and not absence of physical GPU hardware.

- [ ] **Step 7: Commit exactly the five tests and record exact CI RED**

No production/runtime/config/workflow/license/docs changes in the first implementation commit.

---

### Task 7: Add explicit P2 methods to the existing Node adapter

**Files:**
- Modify: `backend/services/agentLightningTrainingAdapter.js`
- Test: P2 authority + candidate tests

**Interfaces:**
- Consumes: construction-time P2 options `{ candidateModelPath, runArtifactRoot }`, landed Learning contract and existing sealed runtime invoker.
- Produces: `trainVerlRelationship(input)` and `trainVerlGlobal(input)`.

- [ ] **Step 1: Preserve P1 methods exactly**

`trainRelationship` and `trainGlobal` remain APO/P1 methods.

- [ ] **Step 2: Validate P2 construction-time paths**

Both paths must be absolute, non-empty and fixed before a training call. On Windows convert them with the existing `windowsPathToWsl` helper before sending the envelope. Product call input cannot override either path.

- [ ] **Step 3: Build the fixed P2 envelope**

```js
const envelope = Object.freeze({
  schemaVersion: 2,
  workPackage: 'V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1',
  algorithm: 'VERL_GRPO',
  statusBoundary: 'CANDIDATE_ONLY',
  projection,
  rewards,
  tasks,
  modelAssetPath: candidateModelPath,
  runArtifactRoot,
});
const result = await runtimeInvoker(envelope);
```

Do not add `complete` or production Model Brain execution to this P2 envelope.

- [ ] **Step 4: Validate and bind result evidence**

Require `MODEL_CHECKPOINT`, 64-hex checkpoint digest, 24-hex artifact suffix and a relative checkpoint path. Bind training evidence through the existing Learning contract; return frozen `CANDIDATE_ONLY` result.

- [ ] **Step 5: Run P1 + P2 adapter tests**

```powershell
node --test tests/wp0/v21-agent-lightning-contract-adapter.test.js tests/wp0/v21-agent-lightning-authority-boundary.test.js tests/wp0/v21-agent-lightning-p2-authority-boundary.test.js tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js
```

---

### Task 8: Implement real upstream VERL/GRPO in the existing Python entrypoint

**Files:**
- Modify: `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
- Test: P2 VERL runtime + candidate tests

**Interfaces:**
- Consumes: schema-v2 P2 envelope, trusted P2 upstream receipt, exact local Qwen snapshot and run root.
- Produces: upstream VERL checkpoint tree + bounded manifest.

- [ ] **Step 1: Keep schema-v1 APO dispatch intact and add separate schema-v2 validation**

P2 validator requires exact work-package/algorithm/status values, non-empty tasks, one unique `signalId` per task, finite numeric rewards and absolute model/run paths.

- [ ] **Step 2: Verify the local Qwen snapshot from trusted receipt values**

Use streaming SHA-256:

```python
def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()
```

Verify `model.safetensors` size/hash plus receipt-pinned SHA-256 values for `config.json`, `generation_config.json`, `merges.txt`, `tokenizer.json`, `tokenizer_config.json`, `vocab.json`. Any mismatch fails before VERL initialization.

- [ ] **Step 3: Implement a minimal `LitAgent` that uses VERL's own local model resource**

```python
from openai import OpenAI
from typing import cast
import agentlightning as agl

class YanceVerlAgent(agl.LitAgent[dict[str, Any]]):
    def rollout(
        self,
        task: dict[str, Any],
        resources: agl.NamedResources,
        rollout: agl.Rollout,
    ) -> float:
        llm = cast(agl.LLM, resources['main_llm'])
        base_url = llm.get_base_url(rollout.rollout_id, rollout.attempt.attempt_id)
        client = OpenAI(base_url=base_url, api_key='yance-training-only-local')
        response = client.chat.completions.create(
            model=llm.model,
            messages=[{'role': 'user', 'content': str(task['content'])}],
            temperature=0.0,
            max_tokens=256,
        )
        text = response.choices[0].message.content
        if not isinstance(text, str) or not text:
            raise RuntimeError('AGENT_LIGHTNING_VERL_LOCAL_COMPLETION_REQUIRED')
        return float(task['reward'])
```

The endpoint is VERL/vLLM's `ProxyLLM` endpoint. No production provider URL/key or Model Brain bridge is permitted.

- [ ] **Step 4: Use one frozen GRPO acceptance configuration**

Use these fixed acceptance values for P2 v1:

```python
config = {
    'algorithm': {'adv_estimator': 'grpo', 'use_kl_in_reward': False},
    'data': {
        'train_batch_size': 1,
        'val_batch_size': None,
        'max_prompt_length': 1024,
        'max_response_length': 256,
        'truncation': 'error',
    },
    'actor_rollout_ref': {
        'rollout': {
            'tensor_model_parallel_size': 1,
            'n': 2,
            'log_prob_micro_batch_size_per_gpu': 1,
            'multi_turn': {'format': 'hermes'},
            'name': 'vllm',
            'gpu_memory_utilization': 0.60,
        },
        'actor': {
            'ppo_mini_batch_size': 2,
            'ppo_micro_batch_size_per_gpu': 1,
            'optim': {'lr': 1e-6},
            'use_kl_loss': False,
            'kl_loss_coef': 0.0,
            'entropy_coeff': 0,
            'clip_ratio_low': 0.2,
            'clip_ratio_high': 0.3,
            'fsdp_config': {'param_offload': True, 'optimizer_offload': True},
        },
        'ref': {
            'log_prob_micro_batch_size_per_gpu': 1,
            'fsdp_config': {'param_offload': True},
        },
        'model': {
            'path': verified_local_model_path,
            'use_remove_padding': True,
            'enable_gradient_checkpointing': True,
        },
    },
    'trainer': {
        'n_gpus_per_node': 1,
        'nnodes': 1,
        'val_before_train': False,
        'critic_warmup': 0,
        'logger': ['console'],
        'project_name': 'YanceAgentLightningP2',
        'experiment_name': 'verl-grpo-candidate-v1',
        'save_freq': 1,
        'test_freq': 1,
        'total_epochs': 1,
        'total_training_steps': 1,
        'default_local_dir': verified_checkpoint_root,
    },
}
```

No product input may alter this Hydra configuration in P2 v1.

- [ ] **Step 5: Execute built-in Agent Lightning VERL**

```python
algorithm = agl.VERL(config)
trainer = agl.Trainer(n_runners=1, algorithm=algorithm)
trainer.fit(YanceVerlAgent(), train_dataset=dataset, val_dataset=dataset)
```

`rollout.n = 2` supplies a real GRPO comparison group even when acceptance UAT uses one Learning task. Do not vendor/fork VERL, RayPPOTrainer, vLLM or advantage/reward code.

- [ ] **Step 6: Seal checkpoint tree**

Reject symlinks and paths escaping the run root. For each checkpoint file, hash the tuple `relative-path`, byte size and file SHA-256 in sorted relative-path order to obtain one deterministic tree digest. Return:

```python
candidate = {
    'kind': 'MODEL_CHECKPOINT',
    'artifactId': f"agent-lightning-verl-{checkpoint_digest[:24]}",
    'checkpointRelativePath': checkpoint_root.relative_to(run_root).as_posix(),
    'checkpointDigest': checkpoint_digest,
}
```

- [ ] **Step 7: Run syntax/self-check + P2 source contracts**

```powershell
python -m py_compile runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py
python runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py --self-check
node --test tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js
```

---

### Task 9: Close receipts, licenses, notices, SBOM and WSL2 preflight

**Files:**
- Create: `config/upstreams/v21-agent-lightning-p2-verl.json`
- Create: `third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt`
- Create: `third_party/licenses/verl-Apache-2.0.txt`
- Create: `third_party/licenses/vllm-Apache-2.0.txt`
- Modify: `runtime/deep-training/agent-lightning/pyproject.toml`
- Modify: `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `tools/deep-training/agent-lightning-preflight.ps1`

**Interfaces:**
- Produces: auditable exact direct-engine/model receipts and fail-closed real-training preflight.

- [ ] **Step 1: Write exact P2 source receipt**

Record Agent Lightning, lock, lock-selected VERL and vLLM versions + exact source tags/40-SHAs/licenses, Qwen revision/weight + metadata hashes, selected upstream heavy-training groups, Linux/WSL2 boundary and no-runtime-download rule.

- [ ] **Step 2: Copy exact Apache-2.0 license texts from frozen sources**

Do not synthesize license summaries.

- [ ] **Step 3: Update existing runtime receipt but keep lock bytes unchanged**

`pyproject.toml` remains a receipt. Preserve P1 `agentlightning[apo]==0.3.0`; record P2 heavy-training materialization as exact upstream lock groups. Do not create or regenerate another lock.

- [ ] **Step 4: Extend deterministic CycloneDX 1.7 evidence**

Include Agent Lightning plus direct P2 engine/model identities and immutable lock evidence. Generator remains offline-oriented.

- [ ] **Step 5: Update `THIRD_PARTY_NOTICES.md` after fresh overlap re-read**

Add VERL, vLLM and Qwen model entries. Reconcile competing notice changes only through ordinary descendant history.

- [ ] **Step 6: Add `-Mode Verl` preflight**

Require WSL2, Linux kernel, visible NVIDIA/CUDA for real training, sealed Python environment, explicit local model path, exact model identity and writable artifact capacity. Never install/download in preflight.

- [ ] **Step 7: Run supply-chain/WSL + all P1/P2 Agent Lightning tests**

```powershell
node --test tests/wp0/v21-agent-lightning-p2-supply-chain.test.js tests/wp0/v21-agent-lightning-p2-wsl-runtime.test.js
node --test tests/wp0/v21-agent-lightning-*.test.js
```

---

### Task 10: Add exact-head P2 Linux CI without fake GPU success

**Files:**
- Create: `.github/workflows/v21-agent-lightning-p2-verl-linux.yml`

**Interfaces:**
- Produces: exact-head source/contract/static validation on standard Linux; real GPU training remains a separate required gate unless an authorized GPU runner is actually available.

- [ ] **Step 1: Preserve P1 workflow security posture**

Use immutable full action SHAs, `persist-credentials: false`, exact PR-head checkout and explicit head verification.

- [ ] **Step 2: Verify source + lock + receipts**

Checkout Agent Lightning commit `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`; compare `uv.lock` byte-for-byte; validate exact direct source receipts/licenses and Qwen provenance metadata.

- [ ] **Step 3: Run all P1/P2 Node contracts and Python compile/self-check**

Standard CPU CI must not claim a real VERL training pass. A skipped GPU step is not real UAT evidence.

- [ ] **Step 4: Use a real GPU job only if repository runner inventory actually provides one**

Do not add Docker/cloud fallback to manufacture GPU GREEN.

---

### Task 11: Real WSL2 GPU UAT with exact Qwen snapshot

**Files:**
- No model/checkpoint file enters Git.
- Evidence stays in the approved PR/work-package evidence channel; no unapproved repository evidence path is created.

**Interfaces:**
- Produces: real checkpoint proof from the exact implementation head.

- [ ] **Step 1: Provision exact Qwen revision outside the Git worktree**

Use the user's local machine/network during provisioning. Verify all receipt-pinned hashes before training. If the ChatGPT/container download boundary blocks the 3+ GB asset, the user downloads it locally; do not upload the model to this chat unless a later exact-byte audit specifically requires a smaller manifest/receipt file.

- [ ] **Step 2: Materialize Agent Lightning heavy-training environment from the immutable upstream lock**

Use the exact source checkout and exact lock-selected groups. No ad-hoc `pip install`, alternate lock or dependency weakening.

- [ ] **Step 3: Run P2 WSL preflight**

Physical WSL2 GPU/CUDA, sealed env, exact model and artifact capacity must all be GREEN. Hardware insufficiency is a real UAT boundary, not permission to substitute CPU/mock/cloud evidence.

- [ ] **Step 4: Execute one real bounded training run**

One Learning task with `rollout.n = 2`, one training step and one epoch is sufficient for P2 acceptance. Verify local VERL/vLLM endpoint use, unchanged Learning reward, no production provider credentials, checkpoint containment, deterministic recomputed checkpoint tree digest and `CANDIDATE_ONLY` result.

- [ ] **Step 5: Record UAT identity evidence**

Record exact implementation head, Qwen revision/hash, Agent Lightning/VERL/vLLM identities, GPU/CUDA identity, config digest, checkpoint tree digest and candidate manifest. Never commit/upload checkpoint weights into source PR.

---

### Task 12: Final exact-head verification, independent review and ordinary merge

**Files:**
- No path beyond effective product authorization.

**Interfaces:**
- Produces: merged P2 or a real RED/review/authorization boundary.

- [ ] **Step 1: Seal final diff**

If unchanged from Task 5, require exactly 16 authorized product paths and digest `bba7fb993746435a9fe25312aedb258639ea342502ece0610189263193de2021`.

- [ ] **Step 2: Run applicable exact-head gates in parallel**

Require Stage, Layered, ACV2, WP-A where applicable, Learning/Model Brain regressions, P1 Agent Lightning regression and P2 dedicated workflow. Treat path-skips as expected only when the path filter genuinely does not apply.

- [ ] **Step 3: Obtain independent exact-head review**

Every actionable P0/P1 security/privacy/authority/correctness finding is fixed at the bottom layer with test evidence. No risk acceptance or guard weakening to reach GREEN.

- [ ] **Step 4: Fresh-main merge check**

If main moved, ordinary-forward reconcile and rerun exact-head scope/gates/review. Never rewrite published history.

- [ ] **Step 5: Ordinary two-parent merge with expected-head protection**

After merge, verify parent 1 is the validated main head, parent 2 is the validated implementation head, signature/merge state is valid and current `main` equals the merge commit.

- [ ] **Step 6: Stop at successor boundary**

P2 does not authorize checkpoint evaluator/loading, production model registration, SFT, promotion, release or publish. Each requires a fresh successor OSS-fit/design/authorization.
