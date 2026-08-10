# Yance V2.1 Deep Training P1 — Agent Lightning OSS-Fit Design

## Status

Design-only, non-executable work package for `V21-DEEP-TRAINING-P1-AGENT-LIGHTNING-OSS-FIT`.

Trusted repository snapshot used for this design:

- `main`: `a05f8547f1374ab79bb1628731967b8b86418b2a`
- parallel registry: Issue `#178`
- Learning / Growth Brain implementation PR: `#188`
- observed Learning Head: `66787ac4ec9d9753a5af7ba9f2bceaa92315be8c`
- Learning state at design time: open + Draft; final contracts are not on trusted `main`

This document intentionally does **not** authorize or implement Agent Lightning runtime/training behavior. It freezes OSS-fit, authority boundaries, a pre-contract future path candidate, expected failure-first contracts, and the mandatory dependency stop.

## Hard dependency boundary

The next real Agent Lightning runtime/training implementation step is forbidden until `V21-LEARNING-GROWTH-BRAIN-P0-V2` / PR `#188` ordinary-merges its final contracts into then-current trusted `main`.

At minimum the landed Learning contracts must formally define:

1. training-eligible learning record / experience;
2. conversation / decision trajectory semantics;
3. outcome / success / failure semantics;
4. reward / score / evaluation authority;
5. privacy / PII redaction / training eligibility;
6. relationship-level versus global learning isolation;
7. candidate evaluation / regression baseline;
8. shadow evaluation and promotion / rollback.

Before that merge, Deep Training may not create a runtime implementation branch, a causal RED implementation commit, a temporary reward schema, a second trajectory schema, a training dataset authority, a reward/evaluator engine, a mock Learning adapter, or a production interface based on guessed Learning structures.

Terminal pre-implementation state:

`BLOCKED BY INTENTIONAL LEARNING CONTRACT DEPENDENCY — WAIT FOR V21-LEARNING-GROWTH-BRAIN-P0-V2 TO LAND ON TRUSTED MAIN`

## Upstream pin

Agent Lightning is adopted as a mature OSS training runtime, not reimplemented.

- repository: `microsoft/agent-lightning`
- stable release: `v0.3.0`
- exact release commit: `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`
- annotated tag object: `bf09fc9c72e345d3b75ae6b65af90a456881cdc1`
- license: MIT
- Python package: `agentlightning==0.3.0`
- Python requirement: `>=3.10`
- upstream `uv.lock` blob: `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`
- officially supported execution: Linux; Ubuntu 22.04+ recommended
- Windows support: WSL2 only; native Windows execution is not claimed

The moving upstream `main` is not an implementation pin. Any future successor authorization must re-verify the release/tag/commit/license and decide whether `v0.3.0` remains the approved stable pin.

## OSS-fit decision

### Adopt whole: Agent Lightning core

Yance should use the upstream abstractions directly:

- `Trainer`
- `Algorithm`
- `Runner` / `LitAgentRunner`
- `LightningStore`
- upstream span/tracing model
- upstream resource / rollout / attempt semantics
- upstream adapters where their representation matches the landed Learning contract

Yance must not create a parallel trainer, rollout scheduler, training queue, algorithm framework, tracing framework, or generic resource state machine.

### FIT: APO

Agent Lightning APO is the initial algorithm candidate for P1 because it is an upstream algorithm module and optimizes a prompt resource without requiring Yance to build an optimizer.

Initial P1 adoption is limited to upstream APO after the landed Learning contract supplies an eligible dataset, evaluation outcome, and candidate gate. The thin Yance adapter may bind a Learning-approved prompt candidate to the upstream resource representation; it may not implement a second prompt optimizer.

### CONDITIONAL FIT: SFT

The v0.3.0 Unsloth SFT material is an upstream recipe built around vLLM, Agent Lightning LLMProxy, trace-to-triplet adaptation, reward-ranked sample selection, Unsloth and TRL. It is GPU-heavy and the documented recipe relies on behavior in TRL that upstream explicitly describes as undocumented.

Therefore SFT is not part of the first executable P1 slice. A future successor may authorize it only after:

- the Learning contract defines the exact curated training-example authority;
- model/checkpoint identity and artifact custody are separately frozen;
- GPU/CUDA dependency closure is sealed;
- the training-time LLM/proxy boundary is proven not to create a second production Model Brain;
- the selected SFT recipe no longer requires Yance-owned reward/sample-selection policy.

### CONDITIONAL / BLOCKED: VERL RL

Agent Lightning v0.3.0 VERL adapts traces to prompt-response-reward triplets and propagates the final scalar reward to preceding triplets using an identical-assignment strategy. The wrapper does not expose fine-grained reward propagation / credit assignment control.

Yance must not fork or rewrite that wrapper merely to invent custom reward shaping. VERL/RL may be authorized only if the final Learning reward contract is semantically compatible with the upstream strategy or a later mature upstream release exposes a compatible mechanism. Otherwise VERL remains out of scope.

### Excluded from P1 authority

- Agent Lightning dashboard as a second Yance product UI
- Mongo as a new canonical dataset/database authority
- Agent Lightning LLMProxy as a production model-routing authority
- Tinker or remote training service credentials by default
- any custom Yance RL/APO/SFT framework
- any fork whose purpose is to bypass an upstream training semantic mismatch

## Unique authority boundaries

### Learning / Growth Brain — canonical learning authority

Learning owns all product semantics that determine what may be trained and what may be promoted:

- canonical experience / learning record;
- training eligibility;
- consent and `doNotLearn`;
- source-side Presidio PII redaction;
- canonical trajectory meaning;
- outcome, success and failure meaning;
- reward / score / evaluation meaning;
- relationship / segment / global isolation;
- canonical dataset / experiment evidence through Langfuse + OpenTelemetry;
- candidate regression baseline through Promptfoo;
- shadow evaluation;
- staged rollout through OpenFeature/flagd;
- promotion and rollback.

Agent Lightning may not recompute, reinterpret, or override these authorities.

### Agent Lightning — training execution authority only

After the Learning dependency lands, Agent Lightning may own only:

- execution of an approved training run;
- upstream run-local resource / rollout / attempt / span mechanics;
- upstream algorithm execution for an authorized algorithm;
- run-scoped `LightningStore` working state;
- production of a training **candidate artifact** plus training-run evidence.

Every output is `CANDIDATE_ONLY`. Agent Lightning may not activate a prompt, model, adapter, Persona, Journey, routing policy, or product behavior.

`LightningStore` is not Yance canonical training-data truth. It is a run-scoped upstream working store populated only from Learning-approved material. Durable Yance learning truth remains under the Learning/Langfuse/OTel authority.

### Model Brain

Model Brain remains the sole authority for live provider credentials, logical model execution, physical provider routing, health, fallback and inference evidence.

Agent Lightning must not become a second production LiteLLM gateway. Upstream `LLMProxy` is disabled for production routing. If a later SFT/RL successor requires an internal training-only proxy, that use requires an explicit isolated contract and must not receive product provider-routing authority.

### Letta

Letta remains long-term Agent / interaction-memory and Learning Coach agent-loop authority. Agent Lightning training-run state is not written into Letta as memory truth, and Agent Lightning does not replace the Letta Agent SDK/runtime.

### Graphiti

Graphiti remains relationship-fact / temporal-fact authority. Deep Training receives only a Learning-approved redacted projection; it may not write relationship facts directly.

### Parlant

Parlant remains Goal/Journey state and behavioral-policy authority. Journey outcomes may enter Learning evidence, but Agent Lightning may not mutate Journey state or declare Journey success independently.

### Persona

Persona/Character mutation remains under the Persona authority and Learning promotion gate. A trained prompt or adapter is a candidate, not an automatic Persona mutation.

## Canonical post-dependency data flow

The only permitted semantic direction is:

`Learning eligible/redacted experience`
`→ frozen mechanical Deep Training projection`
`→ Agent Lightning Dataset/Rollout/Span representation`
`→ upstream Agent Lightning algorithm execution`
`→ CANDIDATE_ONLY artifact + training-run evidence`
`→ Learning evaluation / Promptfoo regression / Langfuse experiment`
`→ Learning Shadow`
`→ OpenFeature/flagd staged rollout`
`→ Learning-owned Promote or Rollback`

The Deep Training adapter is a representation adapter, not a scoring engine.

### Trajectory mapping rule

The adapter may preserve canonical Learning IDs, ordering, parent/child links, model execution evidence and already-computed outcome/reward fields while projecting them into upstream rollout/spans/triplets.

It may not:

- infer omitted trajectory steps;
- reorder decisions for algorithm convenience;
- convert a send event into success;
- combine relationships;
- create a second trajectory identifier namespace that becomes product truth.

### Reward mapping rule

If an upstream algorithm requires a scalar reward, the scalar used by the run must already be supplied or explicitly derivable by the landed Learning reward contract. The Deep Training adapter cannot invent weights, reward shaping, credit assignment, normalization, thresholds, or success semantics.

If the Learning contract does not provide a compatible scalar projection, the algorithm fails closed as `REWARD_CONTRACT_INCOMPATIBLE` rather than adding Yance-owned reward logic.

## Privacy and isolation

- raw private chat training is off by default;
- `doNotLearn` / non-eligible records never cross the Learning→Deep Training boundary;
- PII redaction occurs before Deep Training ingestion;
- relationship-scoped batches remain relationship-scoped;
- cross-relationship/global training requires the Learning contract's explicit eligibility and regression evidence;
- remote training/telemetry is off by default;
- no provider credentials are persisted in Agent Lightning run state;
- training run artifacts must not contain raw secrets or unredacted source content beyond the explicit Learning-approved training payload.

## Platform boundary

Agent Lightning v0.3.0 is not presented as a native Windows runtime.

- Linux is the execution authority.
- Windows desktop integration uses WSL2 preflight only.
- If WSL2 / Linux runtime is unavailable, the product reports `TRAINING_RUNTIME_UNAVAILABLE`.
- No hidden native-Windows rewrite, Python compatibility fork, Docker fallback, remote fallback, or alternate training engine is permitted merely to make a Windows gate green.
- CPU-only evaluation/APO paths may operate without GPU when upstream supports them.
- GPU/CUDA materialization for SFT/RL is outside the first executable P1 slice.

## Fail-closed status vocabulary

The future adapter/runtime must use explicit non-success states rather than silent fallback:

- `LEARNING_CONTRACT_UNAVAILABLE`
- `TRAINING_INELIGIBLE`
- `DATA_INSUFFICIENT`
- `TRAJECTORY_CONTRACT_MISSING`
- `REWARD_CONTRACT_MISSING`
- `REWARD_CONTRACT_INCOMPATIBLE`
- `EVALUATION_BASELINE_MISSING`
- `PRIVACY_POLICY_DENIED`
- `RELATIONSHIP_ISOLATION_DENIED`
- `MODEL_BRAIN_ROUTE_UNAVAILABLE`
- `TRAINING_RUNTIME_UNAVAILABLE`
- `TRAINING_RUN_FAILED`
- `CANDIDATE_NOT_PROMOTABLE`

None of these statuses authorizes fallback to a custom training path.

## Pre-contract future implementation path candidate

This exact set is frozen only for OSS-fit / overlap / authorization preparation. It is **non-executable** and must be recalculated after #188 lands.

1. `.github/workflows/v21-agent-lightning-p1-linux.yml`
2. `THIRD_PARTY_NOTICES.md`
3. `backend/services/agentLightningTrainingAdapter.js`
4. `config/upstreams/v21-agent-lightning-p1.json`
5. `docs/superpowers/plans/2026-08-10-yance-v21-agent-lightning-p1.md`
6. `docs/superpowers/specs/2026-08-10-yance-v21-agent-lightning-p1-design.md`
7. `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
8. `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
9. `runtime/deep-training/agent-lightning/pyproject.toml`
10. `runtime/deep-training/agent-lightning/uv.lock`
11. `tests/wp0/v21-agent-lightning-authority-boundary.test.js`
12. `tests/wp0/v21-agent-lightning-contract-adapter.test.js`
13. `tests/wp0/v21-agent-lightning-evaluation-gate.test.js`
14. `tests/wp0/v21-agent-lightning-oss-fit.test.js`
15. `tests/wp0/v21-agent-lightning-privacy-isolation.test.js`
16. `tests/wp0/v21-agent-lightning-training-runtime.test.js`
17. `tests/wp0/v21-agent-lightning-wsl-runtime.test.js`
18. `third_party/licenses/agent-lightning-MIT.txt`
19. `tools/deep-training/agent-lightning-preflight.ps1`

Canonicalization: normalized repository-relative paths, unique, JavaScript default sort, UTF-8, LF separator, one trailing LF.

- path count: `19`
- path-set SHA-256: `5e3bcfd244096c416c9803fb1e711bfcf270cdf6d4f16d04f3af05d0d6308f4e`

Future first implementation commit candidate — exactly seven tests:

- `tests/wp0/v21-agent-lightning-authority-boundary.test.js`
- `tests/wp0/v21-agent-lightning-contract-adapter.test.js`
- `tests/wp0/v21-agent-lightning-evaluation-gate.test.js`
- `tests/wp0/v21-agent-lightning-oss-fit.test.js`
- `tests/wp0/v21-agent-lightning-privacy-isolation.test.js`
- `tests/wp0/v21-agent-lightning-training-runtime.test.js`
- `tests/wp0/v21-agent-lightning-wsl-runtime.test.js`

- test path count: `7`
- test path-set SHA-256: `8db739b4d5597929551d49a1df558349af8bb58921942d0de4a96a548835c61b`

Python dependency-control candidate:

- `runtime/deep-training/agent-lightning/pyproject.toml`
- `runtime/deep-training/agent-lightning/uv.lock`

- dependency-control path count: `2`
- dependency-control path-set SHA-256: `80c66a839a5979f445de27a69d356427176dc2baeccc1c2905b185d0facae9f1`

## Route-bootstrap gap

Current WP0 routing policy does not yet contain these six exact `config/runtime/license` paths:

- `config/upstreams/v21-agent-lightning-p1.json`
- `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
- `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
- `runtime/deep-training/agent-lightning/pyproject.toml`
- `runtime/deep-training/agent-lightning/uv.lock`
- `third_party/licenses/agent-lightning-MIT.txt`

- route-bootstrap path count: `6`
- route-bootstrap path-set SHA-256: `b560e29a0410b9b86b83d65e955219459a344edf97ba04cf3d6bcde51fd1e5ca`

A future executable authorization must not hide these files under an already-routed prefix. A dedicated exact route-bootstrap predecessor is required unless the then-current main already routes the exact successor paths.

## Active PR overlap snapshot

The coordination set is the current active workline PRs plus the stacked implementation-policy PR referenced by current authorizations. Historical long-lived Drafts remain historical unless #178 / active handoff reactivates them.

Against the 19-path pre-contract Agent Lightning candidate:

| PR | Current-Head overlap | Authorized/frozen maximum overlap | Exact paths |
|---|---:|---:|---|
| #214 Presence | 1 | 1 | `THIRD_PARTY_NOTICES.md` |
| #211 Voice | 1 | 1 | `THIRD_PARTY_NOTICES.md` |
| #188 Learning | 0 at current test-only Head | 1 | `THIRD_PARTY_NOTICES.md` |
| #158 Model Brain | 0 | 0 | — |
| #139 Persona | 1 | 1 | `THIRD_PARTY_NOTICES.md` |
| #160 stacked policy fix | 0 | 0 | — |

No Learning runtime/service path is included in the pre-contract Agent Lightning set. The future integration seam is intentionally isolated in the new `agentLightningTrainingAdapter.js` until the final Learning contracts exist.

Shared-notice rule: first ordinary merge wins; the later workline must re-read fresh main and forward-reconcile `THIRD_PARTY_NOTICES.md` without force push, rebase, amend, squash, notice deletion, or scope smuggling.

## Failure-first contracts to create only after the dependency boundary opens

The future first commit must be test-only and prove all seven families RED for missing product capability rather than infrastructure accidents:

1. exact upstream v0.3.0 pin, MIT evidence, Python/Linux/WSL support boundary, no Yance trainer;
2. Learning/Agent Lightning/Model Brain/Letta/Graphiti/Parlant/Persona authority separation;
3. exact landed Learning contract consumption with no mock/fallback and mechanical-only trajectory/reward projection;
4. upstream Trainer/Runner/Store/APO execution path producing `CANDIDATE_ONLY`;
5. consent/PII/relationship isolation and remote-off behavior;
6. regression/shadow/promotion delegation back to Learning, with direct promotion impossible;
7. Linux/WSL2 runtime/preflight, with native Windows fake compatibility rejected.

## Mandatory resume sequence after #188 lands

1. Read live trusted `main`.
2. Read Learning #188 final merge commit and post-merge evidence.
3. Read all still-open active PRs and #178.
4. Read the actual landed Learning contract modules and exact interfaces.
5. Re-evaluate Agent Lightning upstream stable release and license.
6. Re-derive the Learning→Deep Training projection from landed contracts.
7. Recalculate implementation paths and exact active overlap.
8. Recalculate all path-set SHA-256 values.
9. Determine whether exact route bootstrap is still required.
10. Create a fresh successor authorization from then-current main; do not amend/rebase an old proposal.
11. Ordinary-merge the valid successor authorization only after applicable gates and independent review.
12. Create the implementation branch from that exact authorization merge.
13. Make the first implementation commit exactly the newly frozen test-only path set.
14. Establish causal RED before any runtime/product code.

Until step 1 is enabled by Learning #188 landing, steps 10–14 are intentionally closed.