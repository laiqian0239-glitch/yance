# Yance V2.1 Agent Lightning P2 VERL Candidate Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land one real, sealed Agent Lightning v0.3.0 VERL/GRPO candidate-model training slice that consumes only Learning-approved evidence, trains an isolated local Qwen2.5-1.5B-Instruct candidate, and returns checkpoint evidence as `CANDIDATE_ONLY` without creating a second production model gateway or promotion path.

**Architecture:** Reuse the already-landed P1 Agent Lightning adapter, Python entrypoint, exact upstream `uv.lock`, SBOM generator and WSL2 preflight. Add a second explicitly bounded `VERL_GRPO` execution mode in the same runtime; VERL owns the training-only local vLLM/ProxyLLM model endpoint, while Learning remains canonical for training eligibility/reward evidence and Model Brain remains canonical for normal production inference. Route/bootstrap and product authorization remain separate predecessor work packages so no implementation path is widened after RED.

**Tech Stack:** Node.js 22.19.0 tests/adapters, Python 3.12 control code, Microsoft Agent Lightning v0.3.0 @ `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`, upstream VERL + vLLM dependency closure from the exact Agent Lightning `uv.lock`, Qwen/Qwen2.5-1.5B-Instruct @ `fb163acb387a011a0cd205b259aa1b253299a05d`, WSL2/Linux, GitHub Actions, CycloneDX 1.7.

## Global Constraints

- Trusted starting main is `c25cf23e3a4ab3ca821c7a980731b220e935d73f`; every authorization proposal must be rebuilt if live `main` moves before its ordinary merge.
- P2 work package is `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1`.
- Agent Lightning source remains exactly `microsoft/agent-lightning` release `v0.3.0`, commit `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`, MIT, Python `>=3.10`.
- `runtime/deep-training/agent-lightning/uv.lock` remains byte-identical to upstream: Git blob SHA-1 `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`, size `12,891,147` bytes.
- Initial candidate model is exactly `Qwen/Qwen2.5-1.5B-Instruct@fb163acb387a011a0cd205b259aa1b253299a05d`, Apache-2.0; primary `model.safetensors` SHA-256 is `dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee`, size `3,087,467,144` bytes.
- Model files are never committed to Yance Git and are never downloaded at normal runtime startup.
- Linux is execution authority; Windows may execute only through validated WSL2. No native-Windows, Docker, cloud-trainer or alternate-engine fallback.
- Learning remains canonical for eligibility, `do_not_learn`, privacy/minimization, relationship/global scope, canonical signal identity/order, Learning-approved Langfuse Score evidence, experiment evidence, regression/shadow/promotion/rollback.
- Each Learning signal is one P2 rollout identity. Finite numeric Learning-approved Langfuse Score crosses unchanged. Yance performs no reward scaling, mapping, clipping, normalization, weighting or shaping.
- Production Model Brain remains the only normal Yance model/provider/routing authority. P2 local vLLM/ProxyLLM execution is `TRAINING_ONLY` and must not enter Model Brain routing.
- P2 must use upstream Agent Lightning `VERL`/VERL framework/vLLM behavior. No Yance trainer, reward engine, RL engine, second canonical dataset store, second generic model gateway or generic training RPC framework.
- P2 outputs only a bounded checkpoint manifest plus training evidence with `status = CANDIDATE_ONLY`. It does not claim `READY_FOR_REVIEW`, `READY_FOR_PROMOTION`, production activation, formal release or publish.
- Existing P1 APO behavior is a mandatory regression surface and must remain GREEN.
- SFT/Unsloth, Tinker/cloud training, Azure fine-tuning and Mongo LightningStore canonicalization remain out of scope.
- No Git history rewrite: no amend, rebase, force-push or squash authority substitution. Ordinary merge keeps two-parent history.

## Planned File Map

### Documentation / governance predecessors

- Existing approved design: `docs/superpowers/specs/2026-08-14-yance-v21-agent-lightning-p2-verl-design.md`.
- This plan: `docs/superpowers/plans/2026-08-14-yance-v21-agent-lightning-p2-verl.md`.
- Route authorization proposal: `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1-authorization.json`.
- Route implementation: `governance/layered-ci/wp0-routing-policy.json` plus `tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js`.
- Product authorization proposal: `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-candidate-v1-authorization.json`.

### Expected P2 product implementation scope after route closure

The following is the expected 16-path product scope. The product authorization must recompute it from then-current `main`; implementation must not silently widen it if the reconstruction differs.

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

Expected canonical path-set SHA-256 if unchanged: `bba7fb993746435a9fe25312aedb258639ea342502ece0610189263193de2021`.

Expected five-test failure-first scope SHA-256: `57d94ec2ecdd64aa99e5ca544b4df222f30080007720b926e4f0536d687654c9`.

`runtime/deep-training/agent-lightning/uv.lock` is a required immutable dependency-control input, not an expected changed path.

---

### Task 1: Close the exact P2 supply-chain identity before any route authorization

**Files:**
- Read: `runtime/deep-training/agent-lightning/uv.lock`
- Read: `runtime/deep-training/agent-lightning/pyproject.toml`
- Read: upstream Agent Lightning `pyproject.toml` at `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`
- No repository write in this task.

**Interfaces:**
- Consumes: exact P1 upstream lock blob `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`.
- Produces: exact locked package versions and exact source repository/tag/40-SHA/license identities for the P2 direct adopted engines `verl` and `vllm`; confirmation that existing Yance PyTorch/LiteLLM license evidence can be reused.

- [ ] **Step 1: Re-read live main and verify the lock is still the P1 exact blob**

Run against fresh main:

```bash
git rev-parse origin/main
git hash-object runtime/deep-training/agent-lightning/uv.lock
wc -c < runtime/deep-training/agent-lightning/uv.lock
```

Expected before discovery proceeds:

```text
lock blob = 5a98a2ac121b050b0a82f6ac8dc207577ce3af4e
lock bytes = 12891147
```

If either differs, stop at authorization redesign; do not parse a drifted lock as P2 authority.

- [ ] **Step 2: Parse the lock with a non-mutating TOML reader**

From a machine containing the exact repository bytes, use Python 3.11+:

```powershell
python -c "import json,pathlib,tomllib; p=pathlib.Path(r'runtime/deep-training/agent-lightning/uv.lock'); d=tomllib.loads(p.read_text(encoding='utf-8')); wanted={'verl','vllm','torch','torchvision','flash-attn','tensordict','transformers','litellm'}; print(json.dumps({x['name']:x.get('version') for x in d['package'] if x['name'] in wanted},sort_keys=True,indent=2))"
```

Record the exact lock-selected versions. `verl` must satisfy the fixed upstream `torch-gpu-stable` requirement `>=0.6.0`; the vLLM selection must satisfy the exact fixed upstream compatibility constraints. A missing/incompatible package is a real authorization redesign boundary, not permission to generate a second lock.

- [ ] **Step 3: Resolve each direct engine version to its authoritative source tag and 40-character commit**

Direct P2 adopted engines requiring new source/license evidence are:

```text
verl-project/verl        Apache-2.0
vllm-project/vllm        Apache-2.0
Qwen/Qwen2.5-1.5B-Instruct model asset Apache-2.0
```

For `verl` and `vllm`, resolve the exact lock-selected release tag to a 40-character Git commit using GitHub release/tag refs. Do not pin current `main` and do not substitute a nearby release.

- [ ] **Step 4: Revalidate the fixed Qwen revision and model asset**

Revalidate all of:

```text
revision = fb163acb387a011a0cd205b259aa1b253299a05d
license = Apache-2.0
model.safetensors sha256 = dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee
model.safetensors size = 3087467144
```

Also enumerate the exact revision's runtime metadata/tokenizer files (`config.json`, `generation_config.json`, `tokenizer.json`, `tokenizer_config.json`, `merges.txt`, `vocab.json`) in the upstream receipt so a local directory cannot be accepted solely because its large weight file has the right hash.

- [ ] **Step 5: Freeze the route-bootstrap source set**

The route-bootstrap source set is exactly:

```text
config/upstreams/v21-agent-lightning-p2-verl.json
third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt
third_party/licenses/verl-Apache-2.0.txt
third_party/licenses/vllm-Apache-2.0.txt
```

Canonical SHA-256: `ffd81db6e8a122119a7b4862eedf85524bb25286028cc1d05d62209e055ee73c`.

PyTorch and LiteLLM must reuse their already-landed Yance license evidence; transitive lock packages are represented through the exact lock/SBOM rather than creating one route/license path per transitive package.

---

### Task 2: Land the approved P2 design and this implementation plan as documentation-only history

**Files:**
- Create/already present: `docs/superpowers/specs/2026-08-14-yance-v21-agent-lightning-p2-verl-design.md`
- Create/already present: `docs/superpowers/plans/2026-08-14-yance-v21-agent-lightning-p2-verl.md`

**Interfaces:**
- Consumes: user-approved design and written spec.
- Produces: trusted-main documentation predecessor referenced by later governance authorizations.

- [ ] **Step 1: Verify the docs branch is a clean descendant of the expected main**

```bash
git diff --name-only c25cf23e3a4ab3ca821c7a980731b220e935d73f...HEAD
```

Expected exactly the design and plan documents, with no product/governance/runtime paths.

- [ ] **Step 2: Open a docs-only PR and run applicable exact-head gates**

Require route/documentation classification, no unresolved P0/P1 review finding, and no scope drift.

- [ ] **Step 3: Ordinary-merge the docs PR only if live main still matches the validated base**

If live main moved, reconcile by ordinary descendant history and revalidate; do not rebase/amend/force-push.

---

### Task 3: Create the P2 four-path route-bootstrap authorization

**Files:**
- Create: `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1-authorization.json`

**Interfaces:**
- Consumes: trusted-main design/plan; Task 1 exact source identities; existing delegated route mutation guard.
- Produces: authority for a two-file route implementation and nothing else.

- [ ] **Step 1: Create a fresh governance branch from then-current trusted main**

Branch:

```text
governance/v21-deep-training-p2-agent-lightning-verl-route-bootstrap-v1-authorization
```

Authorization file only. Expected one-file path-set SHA-256:

```text
452256583647f7bbb074081613810ae9557b5edcdeff6a65bca93a88a2f2e39b
```

- [ ] **Step 2: Encode the exact route contract**

The authorization must include:

```json
{
  "workPackage": "V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-ROUTE-BOOTSTRAP-V1",
  "implementation": {
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
  },
  "bootstrapPaths": [
    "config/upstreams/v21-agent-lightning-p2-verl.json",
    "third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt",
    "third_party/licenses/verl-Apache-2.0.txt",
    "third_party/licenses/vllm-Apache-2.0.txt"
  ],
  "bootstrapPathCount": 4,
  "bootstrapPathSetSha256": "ffd81db6e8a122119a7b4862eedf85524bb25286028cc1d05d62209e055ee73c"
}
```

Also bind the exact then-current routing-policy blob, exact base/main commit, `unknownPathFailsClosed = true`, existing generic `bootstrapPaths` guard, no broad-prefix mutation, no runtime/product authority, and the exact direct OSS/model source identities from Task 1.

- [ ] **Step 3: Validate authorization exact head**

Require applicable Stage, Layered/route-governance and ACV2 gates plus independent review with unresolved P0/P1 = 0.

- [ ] **Step 4: Stop only if the authorization ordinary-merge boundary itself requires a new owner decision**

The authorization does not become effective until ordinary two-parent merge. If exact scope/base/gates remain valid and the standing owner authorization is accepted by repository governance, merge ordinarily; otherwise surface this as the real authorization boundary.

---

### Task 4: Establish route-bootstrap causal RED, then add only four exact route literals

**Files:**
- Create: `tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js`
- Modify: `governance/layered-ci/wp0-routing-policy.json`

**Interfaces:**
- Consumes: effective Task 3 authorization merge and existing `tools/wp0/lib.js` route selector.
- Produces: four exact supply-chain paths classified `PRODUCT_WP0` while adjacent decoys remain `UNKNOWN_PATH`.

- [ ] **Step 1: Write the test-only first commit**

Core assertions:

```js
const bootstrapPaths = [
  'config/upstreams/v21-agent-lightning-p2-verl.json',
  'third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt',
  'third_party/licenses/verl-Apache-2.0.txt',
  'third_party/licenses/vllm-Apache-2.0.txt',
];
for (const target of bootstrapPaths) {
  assert.equal(selectRoute([target]).reason, 'WP0_ROUTE_UNKNOWN_PATH');
}
```

Also assert nearby decoys such as `config/upstreams/v21-agent-lightning-p2-unapproved.json`, `third_party/licenses/verl-unapproved.txt` and a fake model license remain unknown after GREEN.

- [ ] **Step 2: Run the route test and record causal RED**

```bash
node --test tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js
```

Expected: FAIL because all four exact P2 supply-chain paths are still `WP0_ROUTE_UNKNOWN_PATH`. A parser/test bug is not valid RED.

- [ ] **Step 3: Commit the test-only RED and record exact CI run evidence**

The commit changes exactly one path and zero routing policy/product/runtime files.

- [ ] **Step 4: Modify only `productExactPaths`**

Add the four exact literals to `governance/layered-ci/wp0-routing-policy.json`. Do not add or change product prefixes, governance prefixes, documentation prefixes, `unknownPathFailsClosed`, or the generic delegated route guard.

- [ ] **Step 5: Re-run route and governance suites**

```bash
node --test tests/layered-ci/v21-agent-lightning-p2-verl-routing.test.js
node --test tests/layered-ci/*.test.js
```

Expected: the four targets select `PRODUCT_WP0`; adjacent decoys remain `UNKNOWN_PATH`.

- [ ] **Step 6: Commit GREEN, push normally, run exact-head gates/review and ordinary-merge**

Final route diff must remain exactly the two authorized paths.

---

### Task 5: Reconstruct and merge the exact P2 product authorization from fresh post-route main

**Files:**
- Create: `governance/layered-ci/v21-deep-training-p2-agent-lightning-verl-candidate-v1-authorization.json`

**Interfaces:**
- Consumes: merged four-path route closure, trusted design/plan, exact Task 1 source identities, landed P1 Learning/Model Brain/Agent Lightning seams.
- Produces: exact implementation and failure-first scope for P2.

- [ ] **Step 1: Freshly re-read overlaps and frozen reuse-only authorities**

At minimum re-read:

```text
backend/services/learningDeepTrainingContract.js
backend/services/learningProposalService.js
backend/services/learningEvaluationAdapter.js
backend/services/modelBrainRuntime.js or current Model Brain authority seam
backend/services/agentLightningTrainingAdapter.js
runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py
THIRD_PARTY_NOTICES.md
```

Search all open PRs for overlap with the expected 16 paths, especially `THIRD_PARTY_NOTICES.md` and shared Agent Lightning runtime files.

- [ ] **Step 2: Freeze the exact 16-path implementation scope only if reconstruction still matches**

Expected path-set SHA-256:

```text
bba7fb993746435a9fe25312aedb258639ea342502ece0610189263193de2021
```

Freeze the five P2 test paths as the mandatory first implementation commit, expected SHA-256:

```text
57d94ec2ecdd64aa99e5ca544b4df222f30080007720b926e4f0536d687654c9
```

If a real necessary new path is discovered, do not widen the branch. Close/rebuild the authorization from fresh main.

- [ ] **Step 3: Encode authority rules explicitly**

The authorization must state at least:

```text
Learning-issued projection required
one signal = one rollout identity
finite numeric Learning-approved Langfuse Score unchanged
Yance reward shaping = forbidden
VERL/vLLM endpoint = TRAINING_ONLY
production Model Brain route mutation = forbidden
provider credential inheritance = forbidden
runtime dependency/model download = forbidden
checkpoint writes outside run root = forbidden
output = CANDIDATE_ONLY only
READY_FOR_REVIEW/PROMOTION claim = forbidden in P2
P1 APO regression required
SFT/Tinker/cloud/Azure FT/Mongo canonicalization = forbidden
```

- [ ] **Step 4: Validate and ordinary-merge the single-file authorization**

Require exact-head Stage/Layered/ACV2/applicable gates and independent review. Product implementation branch may start only from the exact ordinary authorization merge.

---

### Task 6: Create the mandatory five-test P2 causal RED

**Files:**
- Create: `tests/wp0/v21-agent-lightning-p2-authority-boundary.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-supply-chain.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js`
- Create: `tests/wp0/v21-agent-lightning-p2-wsl-runtime.test.js`

**Interfaces:**
- Consumes: effective Task 5 product authorization.
- Produces: causal RED proving trusted main lacks P2 VERL capability before production/runtime changes.

- [ ] **Step 1: Write authority-boundary tests**

Assert the future adapter exposes explicit P2 methods rather than a caller-controlled arbitrary algorithm switch:

```js
assert.equal(typeof adapter.trainVerlRelationship, 'function');
assert.equal(typeof adapter.trainVerlGlobal, 'function');
assert.equal(adapter.authority.includes('TRAINING_ONLY'), true);
```

Assert a non-Learning projection, mixed scope, boolean/string/non-finite score, and unapproved score fail before runtime invocation.

- [ ] **Step 2: Write one-signal/one-rollout and unchanged-reward tests**

Capture the runtime envelope and assert:

```js
assert.equal(envelope.algorithm, 'VERL_GRPO');
assert.deepEqual(
  envelope.tasks.map(x => [x.signalId, x.reward]),
  projection.trajectory.map(x => [x.signalId, x.score.value])
);
assert.equal(new Set(envelope.tasks.map(x => x.signalId)).size, envelope.tasks.length);
```

- [ ] **Step 3: Write built-in VERL/runtime tests**

Source-contract assertions must require imports/use of upstream `agentlightning.VERL` or `agentlightning.algorithm.verl.VERL`, upstream `Trainer`, and a rollout that consumes `resources['main_llm']` / its `ProxyLLM` endpoint. Explicitly reject P2 VERL rollout through the P1 `ModelBrainBridge`.

- [ ] **Step 4: Write candidate artifact tests**

Require only:

```json
{
  "status": "CANDIDATE_ONLY",
  "candidate": {
    "kind": "MODEL_CHECKPOINT",
    "artifactId": "...",
    "checkpointDigest": "..."
  }
}
```

Reject `READY_FOR_REVIEW`, `READY_FOR_PROMOTION`, production route mutation, upload/publish fields, provider secrets and paths outside the run-scoped artifact root.

- [ ] **Step 5: Write exact supply-chain tests**

Require the four new supply-chain files, exact Agent Lightning lock blob/size, Qwen exact revision/weight identity, exact locked VERL/vLLM versions plus their exact source commits, Apache-2.0 license copies, and reuse of existing PyTorch/LiteLLM evidence.

- [ ] **Step 6: Write WSL/preflight tests**

Require P2 mode to check WSL2 GPU/CUDA visibility, exact sealed Python environment, explicit model path, model identity and writable run-artifact capacity. Reject native Windows, Docker, cloud and runtime download fallback.

- [ ] **Step 7: Run only the new five-test suite**

```bash
node --test tests/wp0/v21-agent-lightning-p2-*.test.js
```

Expected: causal failures for missing P2 methods/config/runtime/source receipts, not route failures and not absence of a physical GPU.

- [ ] **Step 8: Commit test-only RED and capture exact failing CI evidence**

Commit changes exactly the five frozen test paths and zero product/runtime/config/workflow/license/documentation files.

---

### Task 7: Extend the Node adapter with an explicit VERL candidate-training seam

**Files:**
- Modify: `backend/services/agentLightningTrainingAdapter.js`
- Test: `tests/wp0/v21-agent-lightning-p2-authority-boundary.test.js`
- Test: `tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js`

**Interfaces:**
- Consumes: existing `learningContract.projectRelationship/projectGlobal/bindExperimentEvidence`; P2 model asset descriptor supplied at adapter construction or trusted call boundary; sealed runtime invoker.
- Produces: `trainVerlRelationship(input)` and `trainVerlGlobal(input)` returning frozen `CANDIDATE_ONLY` checkpoint candidate evidence.

- [ ] **Step 1: Preserve the P1 API unchanged**

Do not reinterpret existing `trainRelationship`/`trainGlobal`; they remain APO/P1 methods.

- [ ] **Step 2: Add a dedicated P2 envelope builder**

Use a fixed method rather than arbitrary `input.algorithm`:

```js
const result = await runtimeInvoker(Object.freeze({
  schemaVersion: 2,
  workPackage: 'V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1',
  algorithm: 'VERL_GRPO',
  statusBoundary: 'CANDIDATE_ONLY',
  projection,
  rewards,
  tasks,
  modelAsset: Object.freeze({ ...candidateModelAsset }),
  runArtifactRoot: clean(input.runArtifactRoot),
}));
```

The adapter must reject a missing/relative/untrusted run root according to the frozen authorization contract and must not pass `complete`/Model Brain provider execution into P2 VERL.

- [ ] **Step 3: Validate returned candidate**

Require `status === 'CANDIDATE_ONLY'`, `candidate.kind === 'MODEL_CHECKPOINT'`, bounded digest/identity fields and a checkpoint locator inside the run root. Bind evidence through Learning exactly as P1 already does.

- [ ] **Step 4: Run Node P1 + P2 adapter tests**

```bash
node --test tests/wp0/v21-agent-lightning-contract-adapter.test.js tests/wp0/v21-agent-lightning-authority-boundary.test.js tests/wp0/v21-agent-lightning-p2-authority-boundary.test.js tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js
```

Expected: P1 remains GREEN; P2 adapter contracts become GREEN.

---

### Task 8: Implement sealed upstream VERL/GRPO training inside the existing Python entrypoint

**Files:**
- Modify: `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
- Test: `tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js`
- Test: `tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js`

**Interfaces:**
- Consumes: schema-v2 P2 envelope, verified local Qwen asset path, run-scoped artifact root, Learning-projected tasks/rewards.
- Produces: upstream Agent Lightning VERL checkpoint plus bounded content-addressed `CANDIDATE_ONLY` manifest.

- [ ] **Step 1: Dispatch P1 and P2 envelopes separately**

Keep `_validate_envelope`/APO behavior intact for schema v1. Add a distinct P2 validator for schema v2 + exact work-package/algorithm/status values.

- [ ] **Step 2: Verify model asset before importing/starting VERL**

Stream-hash the primary weight rather than reading 3 GB into memory:

```python
def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()
```

Require exact weight byte size/SHA-256 and presence of the exact-revision metadata/tokenizer file set recorded in `config/upstreams/v21-agent-lightning-p2-verl.json`. No network fallback.

- [ ] **Step 3: Implement a minimal upstream `LitAgent` rollout against VERL's own `main_llm` resource**

The essential topology must match the upstream v0.3.0 VERL example:

```python
class YanceVerlAgent(agl.LitAgent[dict[str, Any]]):
    def rollout(self, task, resources, rollout):
        llm = cast(agl.LLM, resources['main_llm'])
        base_url = llm.get_base_url(rollout.rollout_id, rollout.attempt.attempt_id)
        # Use the local OpenAI-compatible VERL/vLLM endpoint only.
        # Return exactly task['reward']; do not compute a new reward.
        ...
        return float(task['reward'])
```

The implementation must use `llm.model` and bounded sampling parameters from the VERL resource, not a production provider/model identifier. A dummy local API key may be supplied only to satisfy the local OpenAI-compatible client; no provider key may be inherited.

- [ ] **Step 4: Build a frozen GRPO configuration in code**

The fixed config must include:

```python
{
  'algorithm': {'adv_estimator': 'grpo', 'use_kl_in_reward': False},
  'actor_rollout_ref': {
    'model': {'path': verified_local_model_path},
    'rollout': {'name': 'vllm', 'tensor_model_parallel_size': 1, 'n': bounded_n},
  },
  'trainer': {
    'n_gpus_per_node': 1,
    'nnodes': 1,
    'logger': ['console'],
    'total_epochs': bounded_epochs,
    'save_freq': 1,
    'default_local_dir': verified_checkpoint_root,
  }
}
```

Set bounded train/validation batch sizes, prompt/response lengths, PPO micro/mini-batches, GPU memory utilization and one-step/one-epoch acceptance profile in the authorization/test contract. Do not expose arbitrary Hydra dict overrides from the caller.

- [ ] **Step 5: Invoke built-in Agent Lightning VERL through `Trainer`**

```python
algorithm = agl.VERL(config)
trainer = agl.Trainer(n_runners=1, algorithm=algorithm)
trainer.fit(YanceVerlAgent(), train_dataset=dataset, val_dataset=dataset)
```

Do not vendor/fork `VERL`, `RayPPOTrainer`, vLLM or reward/advantage code.

- [ ] **Step 6: Seal checkpoint output**

After training, find only checkpoint files under the verified run checkpoint root, compute a deterministic path+size+SHA-256 tree digest, and return a manifest. Reject symlink/path escape.

- [ ] **Step 7: Run Python syntax/self-check and source-contract tests**

```bash
python -m py_compile runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py
python runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py --self-check
node --test tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js tests/wp0/v21-agent-lightning-p2-candidate-artifact.test.js
```

---

### Task 9: Close source receipts, licenses, SBOM, notices and sealed preflight

**Files:**
- Create: `config/upstreams/v21-agent-lightning-p2-verl.json`
- Create: `third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt`
- Create: `third_party/licenses/verl-Apache-2.0.txt`
- Create: `third_party/licenses/vllm-Apache-2.0.txt`
- Modify: `runtime/deep-training/agent-lightning/pyproject.toml`
- Modify: `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `tools/deep-training/agent-lightning-preflight.ps1`
- Test: `tests/wp0/v21-agent-lightning-p2-supply-chain.test.js`
- Test: `tests/wp0/v21-agent-lightning-p2-wsl-runtime.test.js`

**Interfaces:**
- Consumes: Task 1 exact direct-engine identities and existing immutable Agent Lightning lock.
- Produces: auditable P2 source/license/model/runtime receipt and no-network preflight.

- [ ] **Step 1: Write the P2 upstream receipt**

Record exact repository/tag/40-SHA/license for Agent Lightning, VERL and vLLM; exact lock blob/size; exact Qwen revision/license/primary-weight hash/size; exact metadata/tokenizer file list; selected upstream heavy-training dependency groups; Linux/WSL2 boundary; no-runtime-download rule.

- [ ] **Step 2: Copy exact upstream Apache-2.0 license texts**

Each new license file must be byte/source traceable to its frozen source revision. Do not synthesize license summaries.

- [ ] **Step 3: Update the existing runtime receipt without changing the lock**

`runtime/deep-training/agent-lightning/pyproject.toml` remains a Yance receipt, not a second resolver authority. Preserve `agentlightning[apo]==0.3.0` and record P2 VERL materialization as selected groups from the exact upstream lock. Do not regenerate `uv.lock`.

- [ ] **Step 4: Extend deterministic SBOM evidence**

CycloneDX output must include Agent Lightning plus the exact direct P2 engine/model identities and explicitly identify the immutable upstream lock. SBOM generation remains offline-oriented.

- [ ] **Step 5: Update `THIRD_PARTY_NOTICES.md`**

Add bounded entries for VERL, vLLM and Qwen model asset. Re-read live main immediately before edit and reconcile any overlapping notice work only by ordinary descendant history.

- [ ] **Step 6: Extend PowerShell preflight with `-Mode Verl`**

P2 preflight must require WSL2, Linux kernel, visible CUDA/NVIDIA GPU for real training, exact sealed Python environment, explicit local model path, exact model SHA/size/provenance files and sufficient writable artifact root. It must never download/install anything.

- [ ] **Step 7: Run supply-chain/WSL tests and P1 regressions**

```bash
node --test tests/wp0/v21-agent-lightning-p2-supply-chain.test.js tests/wp0/v21-agent-lightning-p2-wsl-runtime.test.js
node --test tests/wp0/v21-agent-lightning-*.test.js
```

---

### Task 10: Add immutable exact-head P2 Linux CI without pretending a CPU runner is a GPU UAT

**Files:**
- Create: `.github/workflows/v21-agent-lightning-p2-verl-linux.yml`
- Test: `tests/wp0/v21-agent-lightning-p2-verl-runtime.test.js`
- Test: `tests/wp0/v21-agent-lightning-p2-supply-chain.test.js`

**Interfaces:**
- Consumes: P2 source/runtime/tests; standard GitHub Linux runner.
- Produces: exact-head contract/supply-chain/static verification. Does not claim real VERL GPU training unless the runner actually has authorized GPU hardware.

- [ ] **Step 1: Copy the P1 security posture, not mutable action tags**

Use immutable full action SHAs and `persist-credentials: false`; verify checked-out PR head explicitly.

- [ ] **Step 2: Validate exact source and lock identities**

Checkout Agent Lightning commit `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`; compare its `uv.lock` byte-for-byte with Yance; verify direct source receipts/licenses/Qwen metadata.

- [ ] **Step 3: Run all P1+P2 Node contracts and Python static/self-checks**

A standard CPU runner may validate source contracts, envelope rules, model-receipt logic with bounded fixture metadata and P1 APO regression. It must not mark a skipped physical-GPU run as successful real training.

- [ ] **Step 4: If an authorized GPU runner exists, run the real bounded VERL probe there; otherwise leave real GPU UAT as an explicit external required gate**

No Docker/cloud fallback may be introduced merely to make GitHub-hosted CI green.

---

### Task 11: Perform real local WSL2 GPU UAT with the exact Qwen snapshot

**Files:**
- No model file enters Git.
- Evidence is captured in the approved work-package evidence mechanism / PR discussion, not as an unapproved new repository path.

**Interfaces:**
- Consumes: exact P2 implementation head, sealed Agent Lightning/VERL environment and exact local Qwen snapshot.
- Produces: real one-step/one-epoch checkpoint candidate evidence proving actual local candidate weights are trained through VERL/vLLM.

- [ ] **Step 1: Materialize the exact Qwen revision outside the Git worktree**

Use a user-controlled local asset directory and download the exact revision only during provisioning. Verify the primary weight hash/size and the exact revision metadata/tokenizer files before invoking Yance.

- [ ] **Step 2: Materialize the heavy-training environment from the exact Agent Lightning lock**

Use the fixed upstream source checkout and the lock-selected P2 GPU groups; no ad-hoc `pip install`, no alternate lock, no dependency weakening.

- [ ] **Step 3: Run P2 WSL preflight**

Expected: WSL2 + CUDA/GPU + sealed env + exact model + disk/artifact root all GREEN. If physical GPU/CUDA is unavailable or insufficient, report a real environment/UAT boundary; do not substitute CPU/mock/cloud as real training evidence.

- [ ] **Step 4: Run a bounded real VERL/GRPO training probe**

Use at least one Learning-shaped task envelope with two or more rollout samples so GRPO has a valid comparison group. Verify:

```text
VERL/vLLM local candidate endpoint used
Learning reward values unchanged
no Model Brain/provider credential used by P2 rollout
checkpoint files created only under run root
checkpoint digest non-empty and stable when recomputed
result.status = CANDIDATE_ONLY
```

- [ ] **Step 5: Preserve machine-readable UAT evidence without committing the model**

Record exact implementation head, model revision/hash, Agent Lightning/VERL/vLLM identities, CUDA/GPU identity, config digest, checkpoint tree digest and result manifest. Never upload the model checkpoint as part of source PR.

---

### Task 12: Final exact-head verification, independent review and ordinary merge

**Files:**
- No new paths beyond the exact product authorization.

**Interfaces:**
- Consumes: implementation head after Tasks 7-11.
- Produces: merge-ready P2 candidate-training implementation, or a real blocking RED/review/authorization boundary.

- [ ] **Step 1: Seal exact changed paths against the effective product authorization**

Expected if unchanged: exactly 16 authorized product paths and canonical SHA-256 `bba7fb993746435a9fe25312aedb258639ea342502ece0610189263193de2021`.

- [ ] **Step 2: Run all applicable exact-head gates in parallel**

Require Stage, Layered, ACV2, WP-A post-merge validation where applicable, Model Brain/Learning regressions, P1 Agent Lightning regression and P2 dedicated workflow. Treat path-skipped workflows only as expected when their path filters genuinely do not apply.

- [ ] **Step 3: Obtain independent exact-head review**

Resolve every actionable P0/P1 security/privacy/authority/correctness finding with bottom-layer fixes and new test evidence. Do not accept risk or weaken guards to reach GREEN.

- [ ] **Step 4: Re-read live main immediately before merge**

If main moved, ordinary-forward reconcile and re-run exact-head scope/gates/review. Do not rebase/amend/force-push.

- [ ] **Step 5: Ordinary two-parent merge only at the valid final boundary**

Use expected-head protection. After merge, verify the merge commit has the validated main parent and exact implementation-head parent, and verify current `main` equals that merge commit.

- [ ] **Step 6: Stop at the next true successor boundary**

P2 completion does not authorize checkpoint evaluator/loading, production model registration, SFT, promotion, release or publish. The next candidate-evaluator/model-loader work package requires its own fresh OSS-fit/design/authorization.
