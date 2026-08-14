# Yance V2.1 Agent Lightning P2 VERL Candidate Training Design

## Status

Approved successor design for `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1`.

This document is a fresh-main successor to the merged P1 implementation at `main@c25cf23e3a4ab3ca821c7a980731b220e935d73f`. It does not revive historical Agent Lightning pre-contract drafts and does not inherit P1 implementation authority automatically.

## Goal

Add one real local model-training slice using mature upstream Agent Lightning VERL/GRPO while preserving the already-landed Yance authority model:

```text
Learning-approved relationship/global evidence
  -> exact finite numeric Langfuse reward
  -> sealed Agent Lightning VERL/GRPO training runtime
  -> isolated local candidate model + vLLM/VERL execution
  -> bounded model checkpoint evidence
  -> CANDIDATE_ONLY
  -> existing Learning proposal/evaluation/review/promotion authorities
```

P2 must prove that Yance can train a real candidate model locally without turning Deep Training into a second production model gateway, a second Learning brain, a Yance-built trainer, or an automatic production-promotion path.

## Fresh OSS-fit decision

### Candidate A — Agent Lightning Unsloth SFT

Upstream Agent Lightning v0.3.0 includes an Unsloth SFT example. The example collects rollout triplets, carries reward values into a Hugging Face dataset, sorts triplets by reward, retains only the configured top fraction, and then launches Unsloth training and saves a new model generation.

This is not admitted for P2 because the current landed `learningDeepTrainingContract` authorizes a minimized trajectory plus Learning-approved score evidence, but it does not delegate canonical supervised-target/sample-selection authority to Deep Training. Adopting the example unchanged would let Deep Training decide which high-reward records become supervised targets. Reimplementing that policy in Yance would create new Learning infrastructure without an OSS-fit justification.

Disposition: **defer SFT to a later successor that first establishes an explicit Learning-owned supervised-example contract.**

### Candidate B — Agent Lightning built-in VERL / GRPO

Agent Lightning v0.3.0 provides a first-class `VERL` `Algorithm` implementation that delegates training to the upstream VERL PPO runner. Upstream documentation defines a packaged VERL runtime, vLLM-backed rollout execution, Agent Lightning adapter/triplet processing, scalar reward association and PPO/GRPO training.

The landed P1 contract already requires every reward crossing into Agent Lightning to be a finite numeric Learning-approved Langfuse Score and forbids Yance reward shaping/normalization. That satisfies the material reward-input prerequisite for an initial RL successor without adding a Yance reward engine.

Disposition: **adopt for P2.**

### Candidate C — contract-only prerequisite

A contract-only work package could add a future SFT/model-artifact seam without real training. It is safer than violating the current SFT authority boundary but produces less capability than Candidate B and is unnecessary for VERL.

Disposition: **not selected for P2.**

## Upstream freeze

### Microsoft Agent Lightning

- Repository: `microsoft/agent-lightning`
- Stable release revalidated on 2026-08-14: `v0.3.0`
- Exact commit: `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`
- License: MIT
- Python floor: `>=3.10`
- Existing Yance upstream lock identity remains authoritative:
  - `runtime/deep-training/agent-lightning/uv.lock`
  - byte size: `12,891,147`
  - Git blob SHA-1: `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`
- P2 reuses the exact upstream lock already landed by P1. It must not hand-author or regenerate an alternate dependency closure.

Relevant upstream implementation paths at the fixed revision include:

- `agentlightning/algorithm/verl/interface.py`
- `agentlightning/verl/config.yaml`
- `agentlightning/verl/entrypoint.py`
- `agentlightning/verl/trainer.py`
- `agentlightning/verl/daemon.py`

Upstream dependency guidance explicitly warns that installing `agentlightning[verl]` in isolation can create compatibility problems. The fixed upstream `pyproject.toml` defines the compatible heavy-training groups, including the stable Torch/vLLM/flash-attn/tensordict/VERL closure. P2 therefore materializes only from the exact fixed upstream lock and selected upstream groups during sealed build/provisioning, never by runtime resolution.

## Initial candidate base model freeze

P2 freezes a real small instruct model rather than a synthetic or toy stand-in:

- Model repository: `Qwen/Qwen2.5-1.5B-Instruct`
- Exact revision: `fb163acb387a011a0cd205b259aa1b253299a05d`
- License: Apache-2.0
- Primary weight file: `model.safetensors`
- SHA-256: `dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee`
- Frozen remote byte size from the source audit: `3,087,467,144` bytes

Primary source identities:

- `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/tree/fb163acb387a011a0cd205b259aa1b253299a05d`
- `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/fb163acb387a011a0cd205b259aa1b253299a05d/model.safetensors`
- `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/fb163acb387a011a0cd205b259aa1b253299a05d/LICENSE`

The model repository is a supply-chain source, not a runtime network dependency. Model files are **not committed to the Yance Git repository**. They must be pre-materialized into a sealed local model asset root and verified before training. Runtime network download, fallback to a different revision, or acceptance based only on model name is forbidden.

Before the final P2 authorization merge, the exact revision, license, SHA-256 and byte-size metadata must be freshly revalidated against the source. Any drift closes the proposal and requires a new frozen identity rather than silently following upstream `main`.

## Authority model

### Learning remains canonical

The existing `backend/services/learningDeepTrainingContract.js` remains reuse-only in P2. Learning continues to own:

- learning eligibility;
- `do_not_learn` enforcement;
- PII/data minimization before projection;
- canonical relationship/global scope;
- canonical signal ordering and identity;
- outcome evidence;
- Langfuse Score approval;
- experiment evidence binding;
- regression;
- shadow evaluation;
- review readiness;
- promotion;
- rollback.

P2 must not add a second canonical dataset, reward database, selection policy or profile state in Agent Lightning.

### Production Model Brain remains canonical

Model Brain remains the only authority for normal Yance production model execution, provider credentials, provider routing and provider-facing inference.

P2 introduces one explicitly separate authority:

> **TRAINING_ONLY candidate-model execution inside the sealed Deep Training runtime.**

This authority exists only because upstream VERL requires a locally deployed training model and rollout endpoint. It is not a Model Brain replacement.

The local VERL/vLLM candidate model:

- has no OpenAI/Anthropic/Gemini/OpenRouter or other production provider credentials;
- is never registered into the Model Brain production route table by P2;
- cannot service normal Yance inference requests;
- is reachable only inside the bounded training execution context;
- is destroyed/stopped with the training run;
- produces candidate checkpoint artifacts only.

No P2 code may create a generic second model gateway or generic training RPC infrastructure.

## Reward and trajectory contract

Each Learning-issued signal becomes one bounded Agent Lightning rollout/task identity.

For every record:

1. `signalId`, canonical scope and minimized content remain unchanged.
2. Reward must be a finite JavaScript/Python numeric value.
3. Reward evidence must have `authority = Langfuse` and `approvedByLearning = true` before crossing the P2 adapter boundary.
4. The numeric value crosses unchanged.
5. Yance performs no scaling, normalization, clipping, weighting, categorical mapping, inferred success conversion or reward shaping.
6. Two Learning signals must never be merged into one canonical reward subject.

Agent Lightning VERL may use its upstream same-trajectory reward/credit-assignment behavior inside one rollout. P2 does not fork or alter that behavior. In particular, upstream VERL's propagation of the final scalar trajectory reward to the triplets within that same trajectory is treated as adopted algorithm behavior, not a new Yance reward policy.

If upstream behavior would require reward propagation across different Learning signals/scopes, the run must fail closed rather than adapt the Learning contract.

## Runtime architecture

P2 extends the one landed runtime rather than introducing a second Deep Training engine:

- `backend/services/agentLightningTrainingAdapter.js`
- `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
- `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
- `runtime/deep-training/agent-lightning/pyproject.toml`
- existing exact upstream `uv.lock`
- `tools/deep-training/agent-lightning-preflight.ps1`

The Python entrypoint gains a bounded algorithm mode for VERL while retaining the P1 APO path without regression.

Conceptual envelope:

```text
schemaVersion
workPackage = V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1
algorithm = VERL_GRPO
statusBoundary = CANDIDATE_ONLY
projection = Learning-issued object
rewards = unchanged finite numeric Learning-approved scores
modelAsset = exact frozen Qwen identity + verified sealed local path
trainingConfig = bounded frozen VERL config
```

The adapter must validate provenance and scope before process launch. The Python runtime must validate the exact Agent Lightning version, model asset identity and training envelope again before initializing VERL.

## VERL configuration policy

P2 adopts upstream VERL/GRPO behavior with a bounded configuration rather than exposing arbitrary Hydra overrides from product inputs.

The frozen authorization must define at least:

- advantage estimator: GRPO;
- one-node Linux execution;
- bounded GPU count;
- bounded rollout `n`;
- bounded train/validation batch sizes;
- bounded prompt/response lengths;
- bounded epochs/steps;
- explicit save/checkpoint frequency;
- explicit local checkpoint root;
- no external experiment logger requiring cloud credentials;
- no runtime model download;
- no arbitrary user-supplied `trainer_cls` or `daemon_cls`;
- no arbitrary Hydra path override;
- no training-time shell/plugin injection.

Any upstream default that enables an external network logger or writes outside the sealed run root must be overridden fail-closed in the fixed configuration.

## Candidate artifact contract

P2 output remains exactly `CANDIDATE_ONLY`.

The result may contain a bounded candidate manifest such as:

- candidate kind: model checkpoint;
- candidate/artifact ID;
- base model repository + revision;
- base model primary-weight SHA-256;
- Agent Lightning release + commit;
- selected upstream lock identity;
- VERL config digest;
- Learning projection digest;
- reward projection digest;
- checkpoint content/tree digest;
- local run-scoped checkpoint path or opaque run artifact locator;
- bounded training metrics/evidence.

The result must not:

- mutate production configuration;
- add a Model Brain route;
- replace an active model;
- claim `READY_FOR_PROMOTION`;
- publish/upload the checkpoint;
- contain provider secrets;
- contain raw private unminimized content;
- become canonical Learning state by itself.

Actual model checkpoints remain outside Git in a run-scoped sealed artifact root. Their existence does not imply promotion or production readiness.

## Evaluation and promotion

P2 reuses the landed Learning proposal/evaluation pipeline. No second candidate database or promotion engine is introduced.

The intended successor flow is:

```text
VERL checkpoint candidate
  -> Learning proposal
  -> existing regression evaluator / Promptfoo evidence
  -> shadow evaluation
  -> READY_FOR_REVIEW only if existing Learning rules permit
  -> separate explicit review/promotion authority
```

P2 itself has no production activation, formal release, publish or automatic promotion authority.

## Security and privacy

P2 must fail closed when any of the following occurs:

- projection was not issued by the landed Learning contract;
- canonical scope mismatches;
- a reward is missing, string/categorical, boolean, non-finite, unapproved or non-Langfuse;
- raw/private content bypasses Learning minimization;
- model asset revision/hash/size/license receipt is missing or mismatched;
- Agent Lightning version or source identity drifts;
- dependency lock identity drifts;
- runtime attempts network model/dependency resolution;
- provider credentials appear in the training child environment, argv, files, logs or candidate manifest;
- checkpoint writes escape the run-scoped artifact root;
- VERL tries to expose a training endpoint beyond the sealed runtime boundary;
- P1 APO regression fails;
- candidate output is anything other than `CANDIDATE_ONLY`.

The existing minimal/scrubbed child environment pattern remains mandatory. GPU-related environment variables may be explicitly allowlisted only as required by the sealed local runtime; broad inherited environment forwarding is forbidden.

## Windows boundary

Linux remains the execution authority.

On Windows, P2 may claim only WSL2-backed execution after preflight proves:

- WSL2 Linux is available;
- compatible GPU/CUDA access is available inside WSL2 when real GPU training is requested;
- the exact sealed Python environment is materialized;
- the exact Qwen asset is present and verified inside an accessible sealed path;
- required runtime disk capacity is available;
- no Docker/cloud/alternate trainer fallback is used.

Native-Windows VERL training is not claimed by this work package.

## Dependency and SBOM policy

The P1 exact upstream Agent Lightning `uv.lock` remains the dependency source of truth. P2 may select the already-frozen upstream heavy-training group(s) needed by VERL, but must not regenerate or replace that lock merely to create a smaller P2 lock.

The runtime receipt and SBOM must make the selected dependency group/closure explicit. Materialization is permitted only during controlled build/provisioning or CI verification, never at normal runtime startup.

Qwen is recorded as a model asset with a separate model-license/source receipt. Code dependency SBOM evidence and model-asset provenance must not be conflated.

## Route-bootstrap prerequisite

Fresh inspection of `governance/layered-ci/wp0-routing-policy.json` shows that the existing P1 runtime/config/license exact paths are routed, while unknown paths fail closed.

P2 deliberately reuses existing runtime paths. The minimum new supply-chain paths proposed by this design are:

- `config/upstreams/v21-agent-lightning-p2-verl.json`
- `third_party/licenses/qwen2.5-1.5b-instruct-Apache-2.0.txt`

These two paths require a separate exact route-bootstrap work package before P2 product implementation. The route change must add only literal exact paths. It must not add broad `config/`, `config/upstreams/`, `third_party/` or `third_party/licenses/` product prefixes.

If final planning introduces any additional unrouted supply-chain path, the route authorization must be regenerated from fresh main before any causal implementation RED.

## Proposed P2 product scope shape

The final authorization must freeze exact paths after route closure. The design intends to reuse/modify only the minimum existing runtime surfaces plus P2-specific evidence/tests. Expected categories are:

- one P2 dedicated Linux workflow;
- existing Agent Lightning Node adapter;
- existing Agent Lightning Python entrypoint/SBOM/runtime receipt;
- existing WSL2 preflight;
- the exact P2 upstream/model receipt;
- Qwen Apache-2.0 license evidence;
- successor design + implementation plan;
- P2-only failure-first contract tests;
- shared third-party notice only if the final source/license audit proves it is required.

The existing `uv.lock` should remain byte-identical unless fresh upstream/source evidence proves that the selected fixed Agent Lightning revision cannot materialize VERL from that lock. Such a failure is a real authorization redesign boundary, not permission to generate an ad-hoc lock.

## Failure-first requirements

The first P2 implementation commit must be test-only and must establish causal RED for missing P2 capability, not routing, dependency download, or an intentionally unavailable GPU runner.

The failure-first suite must at minimum prove that trusted main currently lacks:

1. a P2 VERL/GRPO algorithm envelope;
2. a training-only local candidate-model authority distinct from production Model Brain;
3. exact Qwen asset verification;
4. one-Learning-signal/one-rollout reward identity;
5. unchanged finite numeric reward transfer;
6. built-in upstream Agent Lightning VERL adoption rather than a Yance trainer;
7. bounded `CANDIDATE_ONLY` checkpoint manifest behavior;
8. no provider-credential inheritance/direct provider fallback;
9. no runtime model/dependency download;
10. P1 APO non-regression under the shared runtime.

Tests that require a physical GPU must not be used as the only causal RED. Contract RED must be deterministic on ordinary CI. Real GPU/WSL2 execution is a later environment/UAT gate when the required hardware is available.

## Verification strategy

Final exact-head verification must include:

- all P2 contract tests;
- full existing P1 Agent Lightning contract suite;
- landed Learning Deep Training authority/regression suite;
- Model Brain authority regressions that are relevant to credential/route ownership;
- Python compile/self-check;
- exact Agent Lightning commit/lock identity;
- exact Qwen revision/license/hash/size receipt verification;
- deterministic SBOM/model provenance evidence;
- sealed environment/no-runtime-download checks;
- real VERL import/config construction from the frozen dependency closure;
- a bounded execution/probe appropriate for available CI hardware;
- real GPU training UAT when the authorized execution environment provides compatible GPU capacity;
- Stage/Layered/ACV2 and other base-owned gates triggered by the exact path set;
- independent exact-head review with P0=0/P1=0;
- unresolved review threads = 0 before ordinary merge.

No skipped or unavailable GPU environment may be represented as a successful real-training UAT.

## Rollback

P2 is additive and candidate-only. Rollback consists of reverting the P2 product commit/ordinary merge or disabling invocation of the P2 algorithm path while leaving P1 APO and the landed Learning/Model Brain authorities intact.

No rollback procedure may delete or rewrite published Git history, mutate canonical Learning evidence, or silently promote an older checkpoint.

## Explicitly out of scope

The following remain unauthorized in P2:

- Unsloth/SFT;
- Tinker/cloud training;
- Azure/OpenAI hosted fine-tuning;
- Agent Lightning Mongo store as canonical Yance Learning storage;
- Agent Lightning LLMProxy/server as production Model Brain gateway;
- production model activation or route mutation;
- automatic promotion;
- model publication/upload/release;
- arbitrary external model selection;
- multi-model joint optimization;
- custom Yance reward shaping/credit-assignment engine;
- a second generic Yance trainer, model gateway, dataset store or artifact registry;
- native-Windows VERL execution claims;
- Docker/cloud fallback.

## Governance sequence

1. This written spec is reviewed and approved.
2. Write the detailed implementation/authorization plan from fresh main.
3. Freeze and ordinary-merge the exact two-path (or freshly proven minimal) route-bootstrap authorization.
4. Establish causal route RED and literal route GREEN; pass exact-head gates/review; ordinary-merge the route fix.
5. Re-read fresh main and produce the P2 product authorization with exact path digest, upstream/model receipts, failure-first scope and authority rules.
6. Pass authorization exact-head gates + independent review and ordinary-merge the authorization.
7. Create the P2 product branch from that exact authorization merge.
8. Create the mandatory test-only causal RED and record exact failure evidence.
9. Implement the full authorized P2 scope without temporary bypasses.
10. Pass exact-head CI, security/privacy/license/source checks, P1 regressions, applicable real training UAT and independent review.
11. Stop at the final ordinary-merge boundary unless standing owner authorization and project governance both permit the routine merge at that exact head.

No step grants automatic authority to a later SFT/P3/promotion/release work package.
