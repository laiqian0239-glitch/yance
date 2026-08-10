# Yance V2.1 Deep Training P1 — Agent Lightning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Microsoft Agent Lightning as the sole Deep Training execution runtime for Learning-approved training candidates while preserving Learning / Model Brain / Letta / Graphiti / Parlant / Persona authority boundaries and never allowing Deep Training to promote itself.

**Architecture:** Agent Lightning `v0.3.0` is adopted as a Linux/WSL2 Python training sidecar using upstream Trainer/Algorithm/Runner/LightningStore and initially upstream APO. Yance owns only a thin product-specific adapter, sealed dependency/runtime composition, provenance/SBOM, fail-closed platform preflight and mechanical mapping from the final Learning contract. Canonical experience, trajectory, reward, privacy, isolation, regression, shadow, rollout, promotion and rollback remain Learning-owned.

**Tech Stack:** Microsoft Agent Lightning `v0.3.0` @ `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`, Python >=3.10, uv locked environment, Node.js contract tests, Linux/WSL2, existing Yance Learning stack (Langfuse/OTel, DSPy/GEPA, Promptfoo, Presidio, OpenFeature/flagd), Model Brain/LiteLLM.

## Global Constraints

- **Current execution state:** implementation is blocked until Learning PR #188 ordinary-merges final contracts into then-current trusted `main`.
- Do not create an Agent Lightning runtime implementation branch or causal RED implementation commit before that dependency lands.
- Do not create a temporary reward schema, trajectory schema, dataset authority, evaluator/reward engine, mock Learning adapter, custom RL/APO/SFT framework, or production interface based on guessed Learning structures.
- Agent Lightning is training execution authority only; every output is `CANDIDATE_ONLY`.
- Learning owns training eligibility, canonical experience/trajectory/outcome/reward/evaluation, privacy/PII, relationship/global isolation, regression, shadow, staged rollout, promotion and rollback.
- Model Brain owns live provider credentials and physical/logical production inference routing.
- Letta owns long-term agent/interaction memory and Coach agent loop; Graphiti owns relationship facts; Parlant owns Goal/Journey state; Persona owns Persona mutation authority.
- Agent Lightning `LLMProxy` may not become a second production Model Brain.
- `LightningStore` is run-scoped working state, never Yance canonical dataset truth.
- Initial executable algorithm target is upstream APO only. SFT is a successor candidate; VERL/RL remains blocked unless the final Learning reward contract is upstream-compatible without Yance reward shaping.
- Official runtime support is Linux; Windows integration is WSL2 preflight only. No native-Windows compatibility fork or alternate training engine.
- No force push, rebase, amend, squash, temporary bypass, warning-only closure, test weakening, release, publish or automatic promotion.

---

## Current Stop Gate — DO NOT EXECUTE TASK 1 YET

Before any checklist item below is executed, verify all of the following from live GitHub:

1. PR #188 is merged.
2. Its merge commit is an ordinary two-parent merge on then-current trusted `main`.
3. Applicable post-merge evidence is GREEN.
4. The final Learning contract covers training eligibility, trajectory, outcome/reward/evaluation, privacy/PII, relationship/global isolation, regression, shadow and promotion/rollback.

If any item is false, stop with exactly:

`BLOCKED BY INTENTIONAL LEARNING CONTRACT DEPENDENCY — WAIT FOR V21-LEARNING-GROWTH-BRAIN-P0-V2 TO LAND ON TRUSTED MAIN`

No later task in this plan may be executed while this gate is closed.

---

### Task 1: Re-baseline from the landed Learning contract

**Files:**
- Read: `governance/layered-ci/v21-learning-growth-brain-p0-v2-authorization.json`
- Read: the final #188 changed paths on its exact merged Head
- Read: `governance/layered-ci/wp0-routing-policy.json`
- Read: Issue `#178` and every still-active implementation PR
- Update successor design only if paths/contracts changed: `docs/superpowers/specs/2026-08-10-yance-v21-agent-lightning-p1-design.md`
- Update successor plan only if required: `docs/superpowers/plans/2026-08-10-yance-v21-agent-lightning-p1.md`

**Interfaces:**
- Consumes: final Learning contract and exact merge evidence.
- Produces: one immutable `LearningDeepTrainingContractSnapshot` definition recorded in the successor authorization, containing exact source paths/blob identities and the allowed semantic fields for eligibility, trajectory, reward/evaluation, privacy/isolation and promotion gating.

- [ ] **Step 1: Resolve fresh trusted main and #188 final merge identity**

Record exact SHA, parents, merged Head, changed paths, final checks and post-merge evidence. Reject cached SHAs.

- [ ] **Step 2: Enumerate the landed Learning→Deep Training fields**

The snapshot must prove, by exact source references, how Learning represents:

```text
experienceId
relationshipScope
trainingEligible
privacyDecision
redactionEvidence
trajectoryId
trajectorySteps
outcome
rewardOrApprovedTrainingScalar
evaluationBaselineId
candidatePolicy
shadowPolicy
promotionPolicy
rollbackPolicy
```

Names above are semantic requirements, not permission to invent fields. The successor document records the actual landed field/function names.

- [ ] **Step 3: Recompute future Agent Lightning paths and overlap**

Start from the current 19-path candidate, compare against then-current main and active PR exact Heads, and remove/add paths only for proven integration needs. Recompute the canonical UTF-8/LF/trailing-LF SHA-256.

- [ ] **Step 4: Re-evaluate upstream Agent Lightning**

Verify stable release, tag, exact commit, license, Python/platform requirements and dependency closure. If `v0.3.0` is no longer the approved stable pin, record a fresh exact release pin rather than floating to `main`.

- [ ] **Step 5: Decide whether APO remains FIT and VERL/SFT remain conditional**

VERL is accepted only if the landed reward contract is semantically compatible with upstream final-scalar propagation. No custom reward shaping is permitted as a compatibility layer.

- [ ] **Step 6: Commit only the successor design/plan update if the re-baseline changed them**

Do not create implementation code in this task.

---

### Task 2: Exact WP0 route bootstrap, only if still required

**Files:**
- Future authorization: `governance/layered-ci/v21-deep-training-p1-agent-lightning-route-bootstrap-authorization.json`
- Modify in route implementation: `governance/layered-ci/wp0-routing-policy.json`
- Test in route implementation: `tests/layered-ci/wp0-routing.test.js`

**Interfaces:**
- Consumes: the Task 1 final successor path set.
- Produces: exact Product WP0 routing for only previously-unrouted Deep Training config/runtime/license paths.

Current pre-contract route-bootstrap candidate is exactly:

```text
config/upstreams/v21-agent-lightning-p1.json
runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py
runtime/deep-training/agent-lightning/generate_runtime_sbom.py
runtime/deep-training/agent-lightning/pyproject.toml
runtime/deep-training/agent-lightning/uv.lock
third_party/licenses/agent-lightning-MIT.txt
```

Current pre-contract digest: `b560e29a0410b9b86b83d65e955219459a344edf97ba04cf3d6bcde51fd1e5ca`.

- [ ] **Step 1: Create a single-file route-bootstrap authorization from fresh main**

Authorization must freeze exact paths/count/digest; no prefix or wildcard.

- [ ] **Step 2: Verify and ordinary-merge the route-bootstrap authorization through the required owner boundary**

Do not start route implementation before the authorization merge.

- [ ] **Step 3: Create the route implementation branch from that exact merge**

First implementation commit changes only `tests/layered-ci/wp0-routing.test.js` and proves the exact Deep Training paths currently fail closed as unrouted.

- [ ] **Step 4: Add only the authorized exact paths to `productExactPaths`**

Do not add `runtime/deep-training/`, `config/upstreams/`, or `third_party/licenses/` prefixes.

- [ ] **Step 5: Prove GREEN**

Run the routing suite and applicable Stage/Layered governance gates. Unknown paths must still fail closed and mixed changes must still escalate to product.

- [ ] **Step 6: Ordinary-merge the route implementation only after exact-Head review is clean**

Re-resolve fresh main before proceeding.

---

### Task 3: Create the fresh executable Agent Lightning authorization

**Files:**
- Create: `governance/layered-ci/v21-deep-training-p1-agent-lightning-authorization.json`

**Interfaces:**
- Consumes: Task 1 Learning contract snapshot and Task 2 routing closure if required.
- Produces: the only execution authorization for `product/v21-deep-training-p1-agent-lightning`.

- [ ] **Step 1: Build a one-file authorization proposal from exact fresh main**

Required fields include:

```json
{
  "schemaVersion": 1,
  "documentType": "YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION",
  "repository": "laiqian0239-glitch/yance",
  "workPackage": "V21-DEEP-TRAINING-P1-AGENT-LIGHTNING",
  "status": "AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE"
}
```

The document must freeze the exact implementation path list, path digest, first-test-only set/digest, upstream pin, final Learning merge identity, contract source identities, algorithm FIT decisions, platform boundary, overlap snapshot and all prohibitions.

- [ ] **Step 2: Encode the dependency contract as already-satisfied evidence, not a future promise**

The executable successor authorization must reference the actual Learning merge commit on main. It must not contain a guessed/mock contract or rely on the old pre-contract proposal as implementation authority.

- [ ] **Step 3: Verify proposal transport**

The authorization branch changes exactly one `governance/layered-ci/*-authorization.json` path, remains based on fresh main, and passes the repository authorization proposal transport gate.

- [ ] **Step 4: Independent exact-Head review**

P0/P1 findings must be zero. Recheck active overlap and upstream pins at the exact authorization Head.

- [ ] **Step 5: Ordinary two-parent merge only at the explicit authorization merge boundary**

No squash/rebase. Implementation branch may be created only from the exact resulting authorization merge.

---

### Task 4: Establish causal RED with seven test-only contracts

**Files:**
- Create: `tests/wp0/v21-agent-lightning-authority-boundary.test.js`
- Create: `tests/wp0/v21-agent-lightning-contract-adapter.test.js`
- Create: `tests/wp0/v21-agent-lightning-evaluation-gate.test.js`
- Create: `tests/wp0/v21-agent-lightning-oss-fit.test.js`
- Create: `tests/wp0/v21-agent-lightning-privacy-isolation.test.js`
- Create: `tests/wp0/v21-agent-lightning-training-runtime.test.js`
- Create: `tests/wp0/v21-agent-lightning-wsl-runtime.test.js`

**Interfaces:**
- Consumes: executable authorization merge.
- Produces: causal product RED for missing Agent Lightning integration, with no runtime/product/config/workflow/dependency implementation.

Current pre-contract seven-test digest: `8db739b4d5597929551d49a1df558349af8bb58921942d0de4a96a548835c61b`.

- [ ] **Step 1: Write OSS-fit test**

Assert exact Agent Lightning config/license/runtime paths are required; assert stable release pin and Linux/WSL boundary; assert no custom Yance trainer/optimizer/reward engine is importable.

- [ ] **Step 2: Write authority-boundary test**

Require the adapter source to delegate eligibility/trajectory/reward/evaluation/promotion to the landed Learning authority and provider routing to Model Brain. Reject `promote`, `rollback`, provider API keys, custom reward calculation and custom trajectory scoring in the Deep Training module.

- [ ] **Step 3: Write contract-adapter test**

Require exact landed Learning contract identities. Missing/mismatched contract must produce `LEARNING_CONTRACT_UNAVAILABLE`; no fixture/mock path may be a production fallback.

- [ ] **Step 4: Write runtime test**

Require the Python entrypoint to import upstream `agentlightning`, create upstream Trainer/Runner/Store/APO composition, and emit only candidate/run evidence. No direct product activation endpoint is permitted.

- [ ] **Step 5: Write privacy/isolation test**

Reject non-eligible, do-not-learn, unredacted or relationship-mismatched input before runtime invocation.

- [ ] **Step 6: Write evaluation gate test**

Prove a successful training run cannot directly promote. Candidate output must return to Learning regression/shadow/promotion authority.

- [ ] **Step 7: Write WSL runtime test**

Native Windows without WSL2 must return `TRAINING_RUNTIME_UNAVAILABLE`; no Docker/cloud/alternate-engine fallback.

- [ ] **Step 8: Commit exactly these seven files**

The commit must be the first implementation commit, have the exact authorization merge as sole parent, and contain zero product/runtime/config/workflow/dependency code.

- [ ] **Step 9: Run remote gates and record causal RED**

Expected failures are only the seven missing Agent Lightning product contract families. Route/schema/governance failures are not accepted as causal RED.

---

### Task 5: Pin and seal the minimal Agent Lightning runtime

**Files:**
- Create: `config/upstreams/v21-agent-lightning-p1.json`
- Create: `third_party/licenses/agent-lightning-MIT.txt`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `runtime/deep-training/agent-lightning/pyproject.toml`
- Create: `runtime/deep-training/agent-lightning/uv.lock`
- Create: `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
- Create: `.github/workflows/v21-agent-lightning-p1-linux.yml`

**Interfaces:**
- Consumes: upstream release `v0.3.0` or Task 1 successor pin.
- Produces: exact offline dependency closure and provenance for the minimal core+APO runtime.

- [ ] **Step 1: Declare only the approved Python dependency**

The minimal dependency declaration is semantically equivalent to:

```toml
[project]
name = "yance-agent-lightning-runtime"
version = "0.0.0"
requires-python = ">=3.10,<3.13"
dependencies = ["agentlightning[apo]==0.3.0"]
```

If Task 1 approves a successor Agent Lightning release, substitute that exact release consistently in config/lock/tests; never use an unbounded version.

- [ ] **Step 2: Generate and commit a Yance-minimal `uv.lock`**

Do not copy the upstream all-extras development environment. Resolve only the exact core+APO runtime and preserve hashes/sources in the lock.

- [ ] **Step 3: Record upstream source and license**

`config/upstreams/v21-agent-lightning-p1.json` binds repository, stable release, exact commit, license, Python/platform support and approved algorithm surface.

- [ ] **Step 4: Generate deterministic runtime SBOM**

SBOM evidence binds the exact `uv.lock` SHA-256 and installed packages. No runtime network resolution is allowed after materialization.

- [ ] **Step 5: Linux CI**

The dedicated workflow installs from the locked dependency graph, runs the Python runtime smoke contract and executes all seven Node contract tests. It must not grant deployment/promotion authority.

- [ ] **Step 6: Run causal tests**

Only OSS-fit/dependency/runtime-absence failures should close in this task; authority/integration tests remain RED until later tasks.

---

### Task 6: Implement the thin Learning→Agent Lightning adapter

**Files:**
- Create: `backend/services/agentLightningTrainingAdapter.js`

**Interfaces:**
- Consumes: the actual Task 1 `LearningDeepTrainingContractSnapshot` sources and an approved Learning training request.
- Produces: a frozen runtime envelope and returns only a `CANDIDATE_ONLY` result projection.

The public adapter surface is constrained to:

```js
class AgentLightningTrainingAdapter {
  preflight(request) {}
  runCandidate(request) {}
  status() {}
}
```

`runCandidate()` returns a projection equivalent to:

```js
{
  status: 'CANDIDATE_ONLY',
  candidateId,
  trainingRunId,
  algorithm,
  artifact,
  evidence
}
```

It may not export `promote()`, `rollback()`, `activate()`, `routeModel()`, `scoreOutcome()`, `shapeReward()` or `buildTrajectory()`.

- [ ] **Step 1: Fail closed on contract identity mismatch**

Verify the exact landed Learning contract version/source identity encoded by the successor authorization before accepting training input.

- [ ] **Step 2: Enforce Learning eligibility/privacy/isolation decisions before process invocation**

Reject missing eligibility, do-not-learn, missing redaction evidence, missing trajectory/reward contract, and relationship-scope mismatch with the frozen status vocabulary.

- [ ] **Step 3: Build a mechanical runtime envelope**

Copy only fields explicitly authorized by the Learning contract. Do not compute new semantic scores or reorder trajectory semantics.

- [ ] **Step 4: Invoke the sealed runtime through one bounded process boundary**

The child environment must be explicit/minimal. No provider credentials are written to disk or copied into generic Agent Lightning store state.

- [ ] **Step 5: Validate candidate-only result**

Reject any runtime result that attempts to claim production activation/promotion.

- [ ] **Step 6: Run authority/contract/privacy tests**

The corresponding Node tests must turn GREEN without weakening assertions.

---

### Task 7: Implement the upstream Agent Lightning core+APO entrypoint

**Files:**
- Create: `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`

**Interfaces:**
- Consumes: one validated training envelope from `agentLightningTrainingAdapter.js`.
- Produces: one candidate artifact plus bounded run evidence.

The entrypoint must use upstream Agent Lightning objects rather than a Yance training framework. The composition is structurally equivalent to:

```python
import agentlightning as agl

algorithm = agl.APO(...)
trainer = agl.Trainer(
    algorithm=algorithm,
    initial_resources={"main_prompt": agl.PromptTemplate(...)},
)
```

Exact constructor arguments are taken from the pinned upstream release and the landed Learning contract; Yance must not replace Trainer/Algorithm/Runner/Store with local equivalents.

- [ ] **Step 1: Parse one versioned stdin envelope and reject unknown fields**

No generic arbitrary-code/task execution surface.

- [ ] **Step 2: Create upstream run-local Store/Runner/Trainer composition**

The store is ephemeral/run-scoped unless the successor authorization explicitly approves an upstream persistence backend. Mongo is not enabled by default.

- [ ] **Step 3: Apply only Learning-supplied reward/evaluation representation**

The entrypoint does not define reward weights, success thresholds or credit assignment.

- [ ] **Step 4: Run upstream APO**

The run produces a prompt/resource candidate only. It cannot mutate live Persona/Journey/Model Brain configuration.

- [ ] **Step 5: Emit one bounded result envelope**

Return candidate artifact identity, training run ID, upstream algorithm/version, evidence digests and status. Do not emit secrets/raw unredacted source material.

- [ ] **Step 6: Run runtime and authority tests**

Training-runtime test becomes GREEN; evaluation/promotion remains delegated to Learning.

---

### Task 8: Enforce Learning evaluation, shadow and promotion hand-back

**Files:**
- Modify only if still in the Task 1 successor scope: `backend/services/agentLightningTrainingAdapter.js`
- Test: `tests/wp0/v21-agent-lightning-evaluation-gate.test.js`

**Interfaces:**
- Consumes: `CANDIDATE_ONLY` result.
- Produces: a Learning-consumable candidate projection; does not perform evaluation/promotion itself.

- [ ] **Step 1: Bind candidate evidence to Learning evaluation identity**

The adapter returns the candidate plus exact training-run evidence needed by Learning's existing candidate/regression pipeline.

- [ ] **Step 2: Reject direct activation requests**

Any caller attempting to bypass Learning regression/shadow/promotion receives `CANDIDATE_NOT_PROMOTABLE`.

- [ ] **Step 3: Prove no OpenFeature/flagd/Langfuse promotion authority is duplicated in Deep Training**

Deep Training may emit evidence for those systems; Learning remains the component that evaluates, shadows, stages, promotes or rolls back.

- [ ] **Step 4: Run evaluation-gate and existing Learning regression tests**

Both the new Deep Training contract and the landed Learning suite must be GREEN.

---

### Task 9: Linux/WSL2 preflight without compatibility bypass

**Files:**
- Create: `tools/deep-training/agent-lightning-preflight.ps1`
- Test: `tests/wp0/v21-agent-lightning-wsl-runtime.test.js`

**Interfaces:**
- Consumes: local Windows/WSL or Linux environment facts.
- Produces: supported/unavailable status only; does not install packages, enable WSL, download runtime assets or switch engines.

- [ ] **Step 1: On Windows, verify WSL2 availability and selected Linux runtime**

Do not claim native Windows Agent Lightning support.

- [ ] **Step 2: Verify Python and sealed runtime identity inside Linux/WSL2**

Minimum Python is 3.10. The runtime lock/config identity must match the successor authorization.

- [ ] **Step 3: Fail closed without fallback**

Missing WSL2/Linux runtime returns `TRAINING_RUNTIME_UNAVAILABLE`; no Docker/cloud/custom-engine fallback.

- [ ] **Step 4: Run Windows-side preflight contract and Linux runtime CI**

Both must reflect upstream support honestly.

---

### Task 10: Final exact-scope verification and independent review

**Files:**
- All paths in the final successor authorization only.

**Interfaces:**
- Consumes: complete implementation.
- Produces: exact-Head evidence for owner merge decision, not automatic merge/promotion.

- [ ] **Step 1: Verify exact changed paths and SHA-256**

Diff from the executable Agent Lightning authorization merge must equal exactly the successor-authorized path set and digest.

- [ ] **Step 2: Recheck active PR overlap against fresh live Heads**

Resolve shared `THIRD_PARTY_NOTICES.md` by forward reconciliation from fresh main. Do not rebase or discard sibling attribution.

- [ ] **Step 3: Run all applicable gates**

Required evidence includes Stage, Layered, ACV2/PVEP as applicable, dedicated Agent Lightning Linux runtime workflow, Windows/WSL preflight contract, existing Learning regression suites, and any successor-specific sealed-runtime/provenance gate.

- [ ] **Step 4: Independent exact-Head review**

Required result: P0=0 / P1=0; zero unresolved blocking threads.

- [ ] **Step 5: Stop at final implementation merge boundary**

No production release, publish, automatic prompt/model promotion or automatic next work package is authorized by successful implementation verification.

---

## Pre-contract scope snapshot (non-executable)

Current 19-path candidate SHA-256:

`5e3bcfd244096c416c9803fb1e711bfcf270cdf6d4f16d04f3af05d0d6308f4e`

Current seven-test first-commit candidate SHA-256:

`8db739b4d5597929551d49a1df558349af8bb58921942d0de4a96a548835c61b`

Current six-path route-bootstrap candidate SHA-256:

`b560e29a0410b9b86b83d65e955219459a344edf97ba04cf3d6bcde51fd1e5ca`

Current two-path Python dependency-control candidate SHA-256:

`80c66a839a5979f445de27a69d356427176dc2baeccc1c2905b185d0facae9f1`

These values are design evidence only. The post-#188 Task 1 re-baseline must recompute them; old digests cannot be reused as executable authority merely because the names still look plausible.