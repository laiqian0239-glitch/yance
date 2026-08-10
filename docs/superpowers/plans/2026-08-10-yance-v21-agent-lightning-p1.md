# Yance V2.1 Deep Training P1 — Agent Lightning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans only after the stop gate in this document opens. Until then this is a non-executable pre-implementation plan.

**Goal:** Adopt Microsoft Agent Lightning as the sole Deep Training execution runtime for Learning-approved training candidates without creating a second Yance learning, reward, trajectory, evaluator, optimizer, training, model-routing, promotion, or rollout framework.

**Architecture:** Agent Lightning is downstream of the final Learning / Growth Brain contract. Learning owns canonical experience, eligibility, trajectory, outcome, reward/evaluation, privacy/isolation, regression, shadow, rollout, promotion and rollback. Agent Lightning owns only an approved training run using upstream training abstractions and returns a `CANDIDATE_ONLY` artifact/evidence projection to Learning.

**Current upstream candidate:** `microsoft/agent-lightning` release `v0.3.0`, exact commit `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`, MIT, Python `>=3.10`, Linux execution with Windows supported only through WSL2.

## Global Constraints

- Implementation is blocked until Learning PR #188 ordinary-merges its final contracts into then-current trusted `main`.
- Do not create the Agent Lightning implementation branch before that dependency lands.
- Do not create causal RED implementation tests before that dependency lands.
- Do not create a mock/temporary Learning adapter.
- Do not invent reward, trajectory, dataset, evaluator, training-eligibility, success/failure, isolation, regression, shadow, promotion or rollback semantics.
- Do not create a custom Yance RL/APO/SFT framework.
- Do not fork Agent Lightning merely to bypass an upstream semantic mismatch.
- Agent Lightning output is `CANDIDATE_ONLY`; direct production activation is forbidden.
- Model Brain remains production provider-credential and model-routing authority.
- Letta, Graphiti, Parlant and Persona retain their existing authorities.
- `LightningStore` is run-scoped upstream working state, not Yance canonical learning truth.
- Agent Lightning `LLMProxy` is not a second production Model Brain.
- Linux is the execution authority; Windows integration is WSL2 preflight only.
- No force push, rebase, amend, squash, gate weakening, warning-only closure, release, publish or automatic promotion.

---

## STOP GATE — CLOSED NOW

No executable task below this section may start until all four conditions are true on live GitHub:

1. PR #188 is merged.
2. Its merge commit is an ordinary two-parent merge on then-current trusted `main`.
3. Applicable post-merge evidence is GREEN.
4. Landed Learning contracts formally cover:
   - training-eligible experience / learning records;
   - conversation / decision trajectory semantics;
   - outcome / success / failure semantics;
   - reward / score / evaluation authority;
   - privacy / PII redaction / training eligibility;
   - relationship-level versus global isolation;
   - candidate evaluation / regression baseline;
   - shadow evaluation and promotion / rollback.

If any condition is false, stop with exactly:

`BLOCKED BY INTENTIONAL LEARNING CONTRACT DEPENDENCY — WAIT FOR V21-LEARNING-GROWTH-BRAIN-P0-V2 TO LAND ON TRUSTED MAIN`

The stop gate cannot be bypassed with fixtures, mocks, guessed field names, compatibility adapters, temporary schemas, alternate trainers, or warning-only behavior.

---

## Task 1: Re-baseline after Learning #188 lands

**This is the first task that may execute after the stop gate opens. It still changes no runtime/product code.**

**Read:**

- live `main`;
- #188 final merged Head, merge commit, parents and post-merge evidence;
- `governance/layered-ci/v21-learning-growth-brain-p0-v2-authorization.json`;
- every final #188 changed path that implements the required Learning contracts;
- Issue #178;
- every still-active open PR exact Head and changed-path set;
- `governance/layered-ci/wp0-routing-policy.json`;
- the then-current Agent Lightning stable release/tag/commit/license/dependency/platform evidence.

**Required output:** a successor design + successor implementation plan that names the actual landed Learning source modules, functions/types/fields and exact Agent Lightning API constructors. The current document does not authorize guessed production interfaces.

- [ ] Record exact trusted-main SHA.
- [ ] Record #188 merge SHA and its two parents.
- [ ] Record #188 exact merged Head and post-merge evidence IDs.
- [ ] Map each required semantic capability to an actual landed Learning source path and exact blob identity.
- [ ] Confirm whether Learning supplies an Agent-Lightning-compatible scalar reward projection; if not, keep reward-dependent algorithms blocked.
- [ ] Re-evaluate Agent Lightning stable release. Never float to upstream `main`.
- [ ] Recompute implementation paths from the landed contracts rather than copying the pre-contract 19-path list.
- [ ] Recompute exact overlap against all still-active worklines.
- [ ] Recompute canonical path-set SHA-256 values.
- [ ] Recompute exact WP0 route-bootstrap gaps.
- [ ] Replace this pre-contract plan with a successor plan containing verified concrete interfaces before any causal RED implementation commit.

**Hard rule:** if the landed interfaces differ from the current design assumptions, the landed Learning contract wins. Create a fresh successor authorization; do not rebase/amend the pre-contract proposal into executable authority.

---

## Task 2: Re-evaluate Agent Lightning algorithm fit

This task is design verification only and precedes executable authorization.

### Core

Adopt upstream Agent Lightning training abstractions rather than reimplementing them. The v0.3.0 documentation demonstrates upstream `agentlightning` rollout, `APO`, `Trainer`, resource and adapter concepts. The successor plan must use the exact API exposed by the selected release.

### APO

Current decision: **FIT candidate**.

For v0.3.0, upstream documentation shows APO instantiated with an async OpenAI-compatible client and passed into upstream `Trainer`. The final Yance integration must bind this to the post-#188 Model Brain/Learning contract without creating a second production provider-routing authority.

### SFT

Current decision: **conditional successor only**.

Do not include SFT in the first executable P1 slice unless a successor authorization separately freezes:

- canonical curated training examples from Learning;
- model/checkpoint identity and custody;
- GPU/CUDA dependency closure;
- exact training-only model/proxy boundary;
- upstream recipe semantics without Yance-owned reward or sample-selection policy.

### VERL / RL

Current decision: **blocked pending final Learning reward compatibility**.

Agent Lightning v0.3.0 VERL uses final scalar reward propagation across triplets and does not expose the fine-grained reward propagation/credit-assignment control needed to justify custom Yance shaping. If the landed Learning reward contract is incompatible, fail closed and keep VERL out of scope rather than forking or creating a Yance reward engine.

---

## Task 3: Close exact WP0 route gaps if still required

Current pre-contract unrouted candidate paths are:

- `config/upstreams/v21-agent-lightning-p1.json`
- `runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`
- `runtime/deep-training/agent-lightning/generate_runtime_sbom.py`
- `runtime/deep-training/agent-lightning/pyproject.toml`
- `runtime/deep-training/agent-lightning/uv.lock`
- `third_party/licenses/agent-lightning-MIT.txt`

Current pre-contract route path-set SHA-256:

`b560e29a0410b9b86b83d65e955219459a344edf97ba04cf3d6bcde51fd1e5ca`

After Task 1, recalculate this set. If any exact paths remain unrouted:

- [ ] Create a separate one-file route-bootstrap authorization from fresh main.
- [ ] Freeze only exact future paths; no wildcard or broad `runtime/deep-training/` prefix.
- [ ] Ordinary-merge that route authorization only through its owner boundary.
- [ ] Create route implementation from the exact authorization merge.
- [ ] First route implementation commit changes only `tests/layered-ci/wp0-routing.test.js` and establishes exact causal RED.
- [ ] Add only the authorized exact paths to `productExactPaths`.
- [ ] Prove unknown paths still fail closed and mixed changes still route to product.
- [ ] Ordinary-merge only after required route gates and independent review are clean.

No Agent Lightning runtime/product implementation begins in this task.

---

## Task 4: Create fresh executable Agent Lightning authorization

**Create only after Tasks 1–3 are complete.**

Future authorization path candidate:

`governance/layered-ci/v21-deep-training-p1-agent-lightning-authorization.json`

Future implementation branch candidate:

`product/v21-deep-training-p1-agent-lightning`

The successor authorization must freeze:

- then-current trusted main;
- actual #188 Learning merge identity and landed contract source/blob identities;
- current Agent Lightning release/tag/commit/license;
- exact implementation paths/count/digest;
- exact first test-only path set/count/digest;
- exact workflow/dependency-control paths;
- exact route-bootstrap predecessor if required;
- current active overlap snapshot;
- algorithm FIT decisions;
- Linux/WSL2 platform boundary;
- all authority/prohibition rules.

- [ ] Create exactly one authorization JSON on an independent governance branch.
- [ ] Verify proposal transport against fresh main.
- [ ] Run applicable Stage/Layered/ACV2/PVEP gates.
- [ ] Complete independent exact-Head review with P0=0 / P1=0.
- [ ] Stop at the authorization merge owner boundary.
- [ ] Only after explicit owner merge may the implementation branch be created from that exact ordinary two-parent merge.

---

## Task 5: Establish causal RED — test-only first implementation commit

The pre-contract candidate contains seven future test paths:

- `tests/wp0/v21-agent-lightning-authority-boundary.test.js`
- `tests/wp0/v21-agent-lightning-contract-adapter.test.js`
- `tests/wp0/v21-agent-lightning-evaluation-gate.test.js`
- `tests/wp0/v21-agent-lightning-oss-fit.test.js`
- `tests/wp0/v21-agent-lightning-privacy-isolation.test.js`
- `tests/wp0/v21-agent-lightning-training-runtime.test.js`
- `tests/wp0/v21-agent-lightning-wsl-runtime.test.js`

Current pre-contract test path-set SHA-256:

`8db739b4d5597929551d49a1df558349af8bb58921942d0de4a96a548835c61b`

This set is not executable authority and must be recalculated in Task 1.

The successor first implementation commit must prove causal RED for exactly these contract families, using the successor-frozen test paths:

1. exact OSS pin/license/platform boundary and absence of a Yance trainer;
2. Learning / Agent Lightning / Model Brain / Letta / Graphiti / Parlant / Persona authority separation;
3. exact landed Learning contract consumption with no mock/fallback;
4. upstream Agent Lightning training execution returning `CANDIDATE_ONLY`;
5. privacy/PII/relationship isolation rejection before training;
6. Learning-owned regression/shadow/promotion hand-back with direct promotion impossible;
7. Linux/WSL2 support with native-Windows fake compatibility rejected.

The first implementation commit must contain zero product/runtime/config/workflow/dependency code.

---

## Task 6: Freeze the minimal upstream runtime dependency closure

This task may execute only after causal RED is proven on the successor-authorized implementation branch.

Candidate runtime control paths:

- `runtime/deep-training/agent-lightning/pyproject.toml`
- `runtime/deep-training/agent-lightning/uv.lock`

Current pre-contract two-path SHA-256:

`80c66a839a5979f445de27a69d356427176dc2baeccc1c2905b185d0facae9f1`

Requirements:

- [ ] Pin the exact successor-approved `agentlightning` release; never use an unbounded version.
- [ ] Preserve upstream Python requirement semantics. For v0.3.0 the verified upstream requirement is `>=3.10`; do not invent an unsupported upper bound.
- [ ] Materialize a Yance-minimal core+approved-algorithm lock instead of copying upstream development/all-extras dependency closure.
- [ ] Record exact source release/commit/license in `config/upstreams/v21-agent-lightning-p1.json`.
- [ ] Record MIT notice under the successor-authorized license path.
- [ ] Generate deterministic runtime SBOM bound to exact lock identity.
- [ ] Runtime startup must not perform dynamic dependency resolution.

Any future fixed Python interpreter version must be justified by sealed-runtime compatibility evidence and frozen in the successor authorization; it must not be guessed in this pre-contract plan.

---

## Task 7: Implement only the landed Learning → Agent Lightning mechanical adapter

The current candidate adapter path is:

`backend/services/agentLightningTrainingAdapter.js`

**Do not use this task until Task 1 has replaced this document with a successor plan containing the actual landed Learning interface names.**

The adapter may only:

- verify exact Learning contract identity/version;
- enforce Learning-provided eligibility/privacy/isolation decisions;
- project Learning-approved fields mechanically into the Agent Lightning run envelope;
- invoke the sealed Agent Lightning runtime;
- validate and return a `CANDIDATE_ONLY` result/evidence projection.

It may not:

- compute success/failure semantics;
- shape or normalize reward;
- build a second canonical trajectory;
- select cross-relationship/global eligibility;
- own provider credentials or physical model routing;
- promote, activate, roll back or stage candidates;
- persist a second canonical training dataset.

Missing/mismatched landed Learning contract must fail closed as `LEARNING_CONTRACT_UNAVAILABLE` or the exact successor-frozen equivalent. No fixture/mock path may become production fallback.

---

## Task 8: Implement upstream Agent Lightning execution, not a Yance trainer

Current candidate runtime entrypoint:

`runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py`

The successor plan must name the exact constructors and arguments from the selected Agent Lightning release before this task starts. The pre-contract plan intentionally does not guess constructor parameters.

Requirements:

- [ ] Accept only a bounded, versioned envelope produced by the verified adapter.
- [ ] Use upstream Agent Lightning rollout/trainer/algorithm/store abstractions exposed by the selected release.
- [ ] Use only successor-authorized algorithms; initial target remains APO if Task 2 still approves it.
- [ ] Treat upstream store state as run-scoped working state, not canonical Yance learning truth.
- [ ] Consume only Learning-supplied/authorized reward representation.
- [ ] Emit candidate artifact identity plus bounded training-run evidence.
- [ ] Never mutate live Persona/Journey/Model Brain configuration.
- [ ] Never emit provider secrets or unredacted source data.

---

## Task 9: Hand candidate evaluation and promotion back to Learning

Deep Training ends at `CANDIDATE_ONLY`.

The landed Learning pipeline remains responsible for:

- candidate evaluation;
- Promptfoo regression or its final authorized equivalent;
- Langfuse/OTel experiment evidence or its final authorized equivalent;
- shadow evaluation;
- OpenFeature/flagd staged rollout or its final authorized equivalent;
- promote/rollback.

Any direct activation request through Deep Training is RED. Deep Training may provide evidence required by Learning but may not duplicate those authorities.

---

## Task 10: Linux/WSL2 preflight without compatibility bypass

Current candidate preflight path:

`tools/deep-training/agent-lightning-preflight.ps1`

Requirements:

- Linux is the execution authority.
- On Windows, only WSL2-backed Agent Lightning execution is claimed.
- Missing supported Linux/WSL2 runtime returns `TRAINING_RUNTIME_UNAVAILABLE` or the successor-frozen equivalent.
- No native-Windows rewrite.
- No hidden Docker fallback.
- No cloud fallback.
- No alternate Yance training engine.
- Do not automatically install/enable WSL or download dependencies at application startup.

---

## Task 11: Final exact-scope verification

Before final implementation merge:

- [ ] Diff from the executable successor authorization merge equals exactly the successor-authorized path set and digest.
- [ ] Re-read live main and all active PR Heads.
- [ ] Forward-reconcile shared `THIRD_PARTY_NOTICES.md` if another workline merged first.
- [ ] Do not rebase/force/amend/squash to resolve shared notice drift.
- [ ] Run all applicable Stage/Layered/ACV2/PVEP gates.
- [ ] Run dedicated Linux Agent Lightning runtime verification.
- [ ] Run Windows/WSL preflight contract.
- [ ] Run landed Learning regression/authority suites.
- [ ] Complete independent exact-Head review with P0=0 / P1=0.
- [ ] Stop at the final implementation owner merge boundary.

No release, publish or automatic candidate promotion is implied by implementation GREEN.

---

## Pre-contract candidate path snapshot — DESIGN EVIDENCE ONLY

Current candidate paths:

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

Current canonical path-set SHA-256:

`5e3bcfd244096c416c9803fb1e711bfcf270cdf6d4f16d04f3af05d0d6308f4e`

This path set and all pre-contract hashes are deliberately non-executable. Task 1 must recompute them after Learning #188 lands. Reusing an old digest merely because filenames still look plausible is forbidden.
