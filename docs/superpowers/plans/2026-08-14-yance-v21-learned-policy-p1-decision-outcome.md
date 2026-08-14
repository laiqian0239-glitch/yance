# Yance V2.1 Learned Policy P1 Decision→Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one canonical, privacy-governed Decision → Outcome learning seam that lets Yance improve a bounded structured reply-strategy decision while OpenAI/Anthropic remain the final language generators through existing Model Brain authority.

**Architecture:** Reuse the existing `contextAwareReplyBrain → StoreManager AI reply task/candidate → Outbox → learning_signal_ledger → Learning evaluation/promotion` chain. Add only thin causal contracts/adapters: a versioned `DecisionRecord`, an `OutcomeVector` binding service over existing immutable signals, a read-only Learning projection, and a Vowpal Wabbit contextual-bandit adapter inside the already-sealed Learning Python runtime. The first policy dimension is `candidateStrategyBranch`; production policy consumption occurs before the existing `aiGateway.execute(...)` frontier call and cannot bypass Model Brain, user final-send authority, Learning reward authority, or existing Regression/Shadow/Promotion/Rollback gates.

**Tech Stack:** Node.js/CommonJS StoreManager services; existing SQLite `learning_signal_ledger`; Langfuse + OpenTelemetry; existing Learning proposal/evaluation/promotion; existing Model Brain/LiteLLM; existing sealed CPython 3.12 Learning runtime; Vowpal Wabbit `9.11.2` (`VowpalWabbit/vowpal_wabbit@122bae254a5b8bc2b774d13b33d53e6dbc2cfba7`, BSD-3-Clause); `uv`; Node test runner.

## Global Constraints

- Work package: `V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`.
- OpenAI / Anthropic frontier models remain the primary final language generators through existing Model Brain / LiteLLM authority.
- Do not train or route production replies through Qwen2.5-1.5B, Qwen3-8B, 14B, or another local reply model.
- Agent Lightning P1 remains dormant reusable training execution infrastructure; this work package does not modify its runtime or turn it into the policy learner.
- No second provider gateway, credential authority, memory system, relationship graph, Journey engine, Persona authority, experiment platform, dataset platform, telemetry system, reward framework, generic evaluator, model registry, RL trainer, prompt optimizer, feature store, or policy-serving framework.
- `DecisionRecord` and `OutcomeVector` are thin canonical contracts, not new storage engines. Persist through existing AI task/candidate payloads and `learning_signal_ledger`/Langfuse evidence.
- Raw downstream behavior is not reward. Only Learning-approved score/evaluation evidence can become learner cost/reward input.
- Missing outcome is unknown, not negative.
- Production decision consumption must happen before frontier generation and must output only a bounded existing action from `allowedActionSet`.
- First learned action dimension is `candidateStrategyBranch`; its allowed values are the existing branch identifiers emitted by `aiDirectorStrategyAuthority.createCandidatePlan(...)`.
- No live random exploration in P1. Baseline/production propensity may be `1.0`; records without valid `(0,1]` propensity are excluded from contextual-bandit training. A later exploration work package is required before nontrivial online exploration.
- Vowpal Wabbit P1 uses contextual-bandit ADF semantics and stays inside the existing sealed Learning Python runtime. It must not call OpenAI/Anthropic or own provider credentials.
- Vowpal Wabbit exact stable source: release `9.11.2`, commit `122bae254a5b8bc2b774d13b33d53e6dbc2cfba7`, BSD-3-Clause, Python `>=3.10`; PyPI publishes a CPython 3.12 Windows x86-64 wheel, so no user-machine native compilation is required for the sealed Windows runtime.
- Existing Learning runtime stays Python `>=3.12,<3.13`.
- Existing `runtime/learning-growth/python/uv.lock` remains package-manager generated; never hand-write lock/integrity records.
- Existing Regression → Shadow → explicit Promotion / Rollback authority remains unchanged.
- Existing final-send user approval remains unchanged.
- No rebase, amend, force-push, squash merge, temporary bypass, warning-only closure, fake success, or gate weakening.
- Fresh-main authorization and failure-first causal RED are mandatory before product implementation.

---

## File Structure

### Reuse without new infrastructure

- `backend/services/contextAwareReplyBrain.js` — existing production decision/generation seam; consumes the promoted learned policy action before final `aiGateway.execute(...)`.
- `backend/store/commands/registerAiReplyCommands.js` — existing durable task/candidate/outbox chain; carries immutable decision provenance into candidate/send evidence.
- `backend/services/candidateInteractionLearningService.js` — existing candidate choice/edit learning signals; add decision provenance only.
- `backend/services/replyFeedbackLearningService.js` — existing sent/rejected immutable signals; add decision provenance and OutcomeVector binding metadata only.
- `backend/services/learningDeepTrainingContract.js` — existing Learning-owned privacy/minimization/approved-score projection; extend with policy projection instead of creating another dataset framework.
- `backend/services/learningProposalService.js`, `backend/services/learningEvaluationAdapter.js`, `backend/services/learningPromotionAdapter.js` — reuse unchanged as proposal/evaluation/promotion authorities.
- `backend/repositories/messageRepository.js` — reuse existing `message:inserted` event; do not create a second inbound-message event pipeline.
- `runtime/learning-growth/python/learning_entrypoint.py` — existing sealed Learning runtime; add VW train/predict operations.

### New thin units

- `backend/services/learningPolicyDecisionContract.js` — creates/validates immutable DecisionRecord v1 and validates bounded policy actions.
- `backend/services/learningOutcomeAttributionService.js` — subscribes to existing `message:inserted`, binds an inbound human response to exactly one latest eligible sent decision in the same canonical conversation/contact scope, and emits a raw OutcomeVector learning signal.
- `backend/services/learningPolicyRuntimeAdapter.js` — thin Node→sealed-Learning-runtime adapter for prediction only; no provider calls, no model gateway.
- `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt` — exact upstream BSD-3-Clause license text.
- `tools/uat/v21LearningPolicyClosedLoopEvidence.js` — deterministic local/CI evidence harness over a temporary store; no mock provider authority.

### Tests

- `tests/wp0/v21-learning-policy-p1-decision-record.test.js`
- `tests/wp0/v21-learning-policy-p1-outcome-binding.test.js`
- `tests/wp0/v21-learning-policy-p1-projection.test.js`
- `tests/wp0/v21-learning-policy-p1-vw-runtime.test.js`
- `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`
- `tests/wp0/v21-learning-policy-p1-supply-chain.test.js`

### Expected product scope before authorization

The authorization candidate path set is exactly these 20 paths unless fresh-main inspection proves one is unnecessary; any addition requires a new authorization scope rather than silent expansion:

```text
THIRD_PARTY_NOTICES.md
backend/services/candidateInteractionLearningService.js
backend/services/contextAwareReplyBrain.js
backend/services/learningDeepTrainingContract.js
backend/services/learningOutcomeAttributionService.js
backend/services/learningPolicyDecisionContract.js
backend/services/learningPolicyRuntimeAdapter.js
backend/services/replyFeedbackLearningService.js
backend/services/storeManagerService.js
backend/store/commands/registerAiReplyCommands.js
config/upstreams/v21-learning-growth-brain-p0.json
runtime/learning-growth/python/learning_entrypoint.py
runtime/learning-growth/python/pyproject.toml
runtime/learning-growth/python/uv.lock
tests/wp0/v21-learning-policy-p1-decision-record.test.js
tests/wp0/v21-learning-policy-p1-outcome-binding.test.js
tests/wp0/v21-learning-policy-p1-production-consumption.test.js
tests/wp0/v21-learning-policy-p1-projection.test.js
tests/wp0/v21-learning-policy-p1-supply-chain.test.js
tests/wp0/v21-learning-policy-p1-vw-runtime.test.js
third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt
tools/uat/v21LearningPolicyClosedLoopEvidence.js
```

The list above contains 22 paths; authorization must use the canonical sorted set exactly as printed and compute its digest mechanically. The only current WP0 route gap expected from fresh main is the new `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt` exact path because the Learning runtime/config paths are already listed in `productExactPaths` and `backend/`, `tests/`, `tools/` are already product prefixes.

---

### Task 1: Merge the approved architecture docs and freeze OSS-fit evidence

**Files:**
- Existing: `docs/superpowers/specs/2026-08-14-yance-v21-learned-policy-architecture-design.md`
- Create/modify in the docs PR: this plan only.

**Interfaces:**
- Consumes: approved successor design and closed/superseded PR #367.
- Produces: trusted-main design/plan authority for the new work package; no product implementation authority.

- [ ] **Step 1: Verify docs PR scope**

Run via GitHub compare:

```text
base = fresh main
head = docs/v21-yance-learned-policy-architecture
expected changed paths = exactly the design spec + this plan
```

Expected: documentation-only, ahead with zero product/runtime/governance mutations.

- [ ] **Step 2: Verify the selected OSS-fit facts from primary sources**

Freeze in review evidence:

```text
VowpalWabbit/vowpal_wabbit
release: 9.11.2
commit: 122bae254a5b8bc2b774d13b33d53e6dbc2cfba7
license: BSD-3-Clause
Python: >=3.10
selected mode: contextual-bandit ADF; offline/candidate training; no live random exploration in P1
Windows runtime: CPython 3.12 x86-64 wheel exists on PyPI 9.11.2
```

Reject as P1 alternatives:

```text
Agent Lightning VERL/Qwen reply model -> RETIRED for this product goal
Yance-built contextual-bandit engine -> REJECTED, duplicates mature OSS
RouteLLM -> REUSE for logical model routing, not selected for first strategy-branch head
DSPy/GEPA -> REUSE for prompt/program optimization, not a replacement for the bounded CB head
```

- [ ] **Step 3: Run exact-head docs CI/review and ordinary-merge the docs PR**

Required: applicable Stage/ACV2/docs gates GREEN, independent review has no unresolved P0/P1, fresh main/head unchanged.

Merge method:

```text
ordinary merge commit only
expected_head_sha = exact reviewed docs head
```

No squash/rebase.

---

### Task 2: Route-bootstrap the one new supply-chain path

**Files:**
- Create: `governance/layered-ci/v21-learning-policy-p1-route-bootstrap-v1-authorization.json`
- Modify after authorization merge: `governance/layered-ci/wp0-routing-policy.json`
- Create after authorization merge: `tests/layered-ci/v21-learning-policy-p1-routing.test.js`

**Interfaces:**
- Consumes: fresh trusted main after Task 1.
- Produces: exact product routing for `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt`; no broad `third_party/licenses/` prefix.

- [ ] **Step 1: Prove the route gap**

Read fresh `wp0-routing-policy.json` and assert:

```js
const bootstrapPaths = [
  'third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt'
];
```

Expected: the path is not in `productExactPaths`, and `third_party/` is not covered by a product prefix.

- [ ] **Step 2: Create a fresh route authorization**

Authorization JSON must include:

```json
{
  "workPackage": "V21-LEARNING-POLICY-P1-ROUTE-BOOTSTRAP-V1",
  "bootstrapPaths": ["third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt"],
  "broadPrefixExpansion": false,
  "ordinaryMergeRequired": true,
  "failureFirstRequired": true,
  "ossFit": {
    "reviewedCandidates": ["Vowpal Wabbit 9.11.2", "existing DSPy/GEPA", "existing RouteLLM", "Agent Lightning P1"],
    "selected": "Vowpal Wabbit 9.11.2 for bounded candidateStrategyBranch contextual-bandit policy",
    "retireOrAvoid": ["local Qwen reply-generator P2", "Yance-built contextual-bandit engine", "second policy framework"]
  }
}
```

Add exact fresh-main SHA, authorization branch/head/path-set digest using the repository's existing authorization format.

- [ ] **Step 3: Create the test-only routing RED after authorization ordinary merge**

`tests/layered-ci/v21-learning-policy-p1-routing.test.js` must assert that the exact VW license path routes as product and no broad third-party prefix is added.

Run:

```bash
node --test tests/layered-ci/v21-learning-policy-p1-routing.test.js
```

Expected RED: unknown path / not product-routed.

- [ ] **Step 4: GREEN by adding exactly one productExactPath literal**

Modify `wp0-routing-policy.json`:

```json
"third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt"
```

Do not add `third_party/` or `third_party/licenses/` prefix routing.

Run the routing test and applicable layered route gate; expected GREEN.

- [ ] **Step 5: Ordinary-merge the route implementation**

Fresh base/head/path digest, exact-head CI, independent review, ordinary merge only.

---

### Task 3: Create fresh product authorization and causal test-only RED

**Files:**
- Create authorization: `governance/layered-ci/v21-learning-policy-p1-decision-outcome-v1-authorization.json`
- Test-only implementation commit creates exactly the six `tests/wp0/v21-learning-policy-p1-*.test.js` files listed in File Structure.

**Interfaces:**
- Consumes: route-bootstrap merge; approved design/plan; VW exact source pin.
- Produces: executable frozen scope and failure-first evidence.

- [ ] **Step 1: Re-read fresh main and active PR overlap**

Re-read at minimum the 22 expected product paths plus active PRs touching:

```text
THIRD_PARTY_NOTICES.md
backend/services/contextAwareReplyBrain.js
backend/services/storeManagerService.js
backend/services/learningDeepTrainingContract.js
backend/store/commands/registerAiReplyCommands.js
runtime/learning-growth/python/*
config/upstreams/v21-learning-growth-brain-p0.json
```

If another active implementation owns an overlapping shared root, record the exact overlap and reconcile by ordinary history only.

- [ ] **Step 2: Freeze the 22-path product scope**

Canonical digest command:

```bash
node -e "const crypto=require('node:crypto');const p=process.argv.slice(1).sort();process.stdout.write(crypto.createHash('sha256').update(p.join('\n')+'\n').digest('hex')+'\n')" <22 exact paths as argv>
```

Record the resulting SHA-256 in the authorization. Do not use a placeholder digest.

- [ ] **Step 3: Freeze first-test scope**

Exactly six paths:

```text
tests/wp0/v21-learning-policy-p1-decision-record.test.js
tests/wp0/v21-learning-policy-p1-outcome-binding.test.js
tests/wp0/v21-learning-policy-p1-production-consumption.test.js
tests/wp0/v21-learning-policy-p1-projection.test.js
tests/wp0/v21-learning-policy-p1-supply-chain.test.js
tests/wp0/v21-learning-policy-p1-vw-runtime.test.js
```

Compute and record the canonical first-test path digest mechanically.

- [ ] **Step 4: Write the RED contracts**

Minimum required assertions:

```js
assert.equal(record.authority, 'LearningPolicyDecisionContract');
assert.equal(record.schemaVersion, 1);
assert.ok(record.decisionId);
assert.deepEqual(record.allowedActionSet, ['natural_hook','playful_attraction','direct_advance']);
assert.equal(record.chosenAction.kind, 'candidateStrategyBranch');
assert.ok(record.actionProbability > 0 && record.actionProbability <= 1);
assert.equal(record.rawPrivateChatPersisted, false);
```

Outcome contract:

```js
assert.equal(outcome.authority, 'LearningOutcomeAttribution');
assert.equal(outcome.decisionId, decision.decisionId);
assert.equal(outcome.scopeId, decision.scopeId);
assert.equal(outcome.conversationContinued, true);
assert.equal(outcome.approvedReward, undefined);
assert.equal(outcome.missingMeansNegative, false);
```

Projection contract:

```js
assert.equal(projection.authority, 'Learning');
assert.equal(projection.readOnly, true);
assert.ok(projection.rows.every(row => row.approvedScore?.approvedByLearning === true));
assert.ok(projection.rows.every(row => row.decision.actionProbability > 0));
```

Production contract must source-scan/execute to prove policy consumption occurs before the first final reply `aiGateway.execute(...)` and final model execution still passes through the existing gateway/Model Brain path.

Supply-chain contract must require exact VW source/version/license and forbid Agent Lightning/Qwen product-target reintroduction.

- [ ] **Step 5: Push exact test-only head and obtain causal RED**

Run the six tests locally if available, then push the exact test-only head. Required CI RED must be caused by missing DecisionRecord/Outcome/VW policy contracts, not route/tooling/environment drift.

Stop and repair the underlying prerequisite if the first failure is not causal.

---

### Task 4: Implement canonical DecisionRecord v1 on the existing production chain

**Files:**
- Create: `backend/services/learningPolicyDecisionContract.js`
- Modify: `backend/services/contextAwareReplyBrain.js`
- Modify: `backend/store/commands/registerAiReplyCommands.js`

**Interfaces:**
- Consumes: existing social decision packet, candidate plan, branch selection, memory recall, logical reply task, strategy versions.
- Produces:
  - `createDecisionRecord(input) -> frozen DecisionRecordV1`
  - `validatePolicyChoice(decision, choice) -> frozen bounded choice`
  - AI task/candidate `learningPolicyDecision` payload.

- [ ] **Step 1: Implement the contract constructor**

Core interface:

```js
const AUTHORITY = 'LearningPolicyDecisionContract';
const SCHEMA_VERSION = 1;

function createDecisionRecord(input = {}) {
  const decisionId = clean(input.decisionId) || `policy-decision-${crypto.randomUUID()}`;
  const allowedActionSet = [...new Set((input.allowedActionSet || []).map(clean).filter(Boolean))];
  const chosen = clean(input.chosenAction?.value);
  const probability = Number(input.actionProbability);
  if (!decisionId) throw contractError('LEARNING_POLICY_DECISION_ID_REQUIRED');
  if (!allowedActionSet.length || !allowedActionSet.includes(chosen)) {
    throw contractError('LEARNING_POLICY_ACTION_OUTSIDE_ALLOWED_SET');
  }
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) {
    throw contractError('LEARNING_POLICY_PROPENSITY_INVALID');
  }
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    decisionId,
    scopeType: clean(input.scopeType),
    scopeId: clean(input.scopeId),
    contactId: clean(input.contactId),
    conversationId: clean(input.conversationId),
    stateSnapshotRef: clean(input.stateSnapshotRef),
    stateVersion: Number(input.stateVersion || 0),
    contextCandidateRefs: Object.freeze((input.contextCandidateRefs || []).map(clean).filter(Boolean)),
    allowedActionSet: Object.freeze(allowedActionSet),
    chosenAction: Object.freeze({ kind: 'candidateStrategyBranch', value: chosen }),
    actionProbability: probability,
    strategyVersion: Number(input.strategyVersion || 0),
    promptProgramVersion: clean(input.promptProgramVersion),
    modelLogicalRoute: clean(input.modelLogicalRoute),
    policyArtifactVersion: clean(input.policyArtifactVersion || 'baseline-rules'),
    decisionTraceId: clean(input.decisionTraceId),
    rawPrivateChatPersisted: false,
    createdAt: clean(input.createdAt) || new Date().toISOString()
  });
}
```

`stateSnapshotRef` must be a hash/reference over the existing compact decision packet; do not embed raw chat text into the DecisionRecord.

- [ ] **Step 2: Insert policy selection after candidate-plan creation and before frontier generation**

In `contextAwareReplyBrain.js`, after `candidatePlan`/memory-recall inputs are available and before the first final reply `aiGateway.execute(...)`:

```js
const policyChoice = await learningPolicyRuntimeAdapter.chooseCandidateStrategyBranch({
  scopeType: 'conversation',
  scopeId: conversationId,
  contactId,
  conversationId,
  state: policyFeatureProjection,
  allowedActionSet: candidatePlan.plan.branches.map(row => row.strategy),
  baselineAction: branchApplication.branch?.strategy || candidatePlan.plan.branches[0]?.strategy
});
```

If no promoted learned artifact is active, adapter returns:

```js
{
  source: 'baseline-rules',
  action: baselineAction,
  probability: 1,
  policyArtifactVersion: 'baseline-rules'
}
```

The adapter must fail closed to the existing baseline only when **no promoted artifact is configured**. If a configured promoted artifact is corrupt/unknown/out-of-set, throw; do not silently ignore a broken active policy.

- [ ] **Step 3: Apply the selected existing branch through the existing branch function**

Do not duplicate strategy math. Reuse `applyCandidateBranch(...)` with the selected existing branch identifier.

- [ ] **Step 4: Persist decision provenance through existing task/candidate state**

Extend `AI_REPLY_TASK_STARTED` task and `AI_REPLY_CANDIDATE_READY` candidate with:

```js
learningPolicyDecision: command.payload.learningPolicyDecision
  ? Object.freeze({ ...command.payload.learningPolicyDecision })
  : null
```

Do not add a new table.

- [ ] **Step 5: Run DecisionRecord + production-consumption tests**

```bash
node --test tests/wp0/v21-learning-policy-p1-decision-record.test.js tests/wp0/v21-learning-policy-p1-production-consumption.test.js
```

Expected GREEN for DecisionRecord wiring; VW runtime test may remain RED until Task 7.

---

### Task 5: Bind user interaction/send evidence and later human response to one decision

**Files:**
- Create: `backend/services/learningOutcomeAttributionService.js`
- Modify: `backend/services/candidateInteractionLearningService.js`
- Modify: `backend/services/replyFeedbackLearningService.js`
- Modify: `backend/services/storeManagerService.js`

**Interfaces:**
- Consumes: candidate `learningPolicyDecision`, existing Outbox/send state, existing `message:inserted` event, existing learning signal repository.
- Produces: immutable raw `policy_outcome_observed` Learning signal with `OutcomeVector`; no reward.

- [ ] **Step 1: Add decision provenance to existing candidate/send signals**

For candidate interactions and sent/rejected feedback, add only bounded metadata:

```js
const decision = candidate.learningPolicyDecision || metadata.learningPolicyDecision || {};
metadata: {
  ...existingMetadata,
  decisionId: clean(decision.decisionId),
  decisionSchemaVersion: Number(decision.schemaVersion || 0),
  policyArtifactVersion: clean(decision.policyArtifactVersion),
  actionKind: clean(decision.chosenAction?.kind),
  actionValue: clean(decision.chosenAction?.value),
  actionProbability: Number(decision.actionProbability || 0)
}
```

No raw Decision State copy in `signal_json`.

- [ ] **Step 2: Implement exact-one inbound attribution**

`LearningOutcomeAttributionService` subscribes to existing `message:inserted` and considers only messages that are inbound/not-from-user.

Selection rules:

```text
same canonical conversationId
same contactId when present
source decision has successful sent signal
sentAt < inbound sentAt
choose the latest eligible sent decision before inbound
reject ambiguity when two eligible records have the same effective sent timestamp without a unique ordering key
never cross contact/conversation scope
never infer negative outcome from timeout/no message
```

- [ ] **Step 3: Build a partial raw OutcomeVector**

For one observed inbound reply:

```js
const outcome = Object.freeze({
  schemaVersion: 1,
  authority: 'LearningOutcomeAttribution',
  decisionId,
  scopeType: 'conversation',
  scopeId: conversationId,
  contactId,
  conversationId,
  replyLatencyMs,
  replyLength: inboundText.length,
  conversationContinued: true,
  newTopicInitiated: null,
  questionReturned: null,
  nextDayReinitiation: null,
  relationshipStateDelta: null,
  explicitUserFeedback: null,
  approvedReward: undefined,
  missingMeansNegative: false,
  observedAt: inboundTimestamp,
  rawPrivateChatPersisted: false
});
```

Do not store inbound raw text in the outcome signal.

- [ ] **Step 4: Insert the immutable outcome signal with idempotency**

Use existing `repository.insertLearningSignal` with:

```text
signalType = policy_outcome_observed
idempotencyKey = policy-outcome:<decisionId>:<inboundMessageId>
learningEligible = false initially
```

Learning approval/scoring is a separate step; raw outcome alone cannot train.

- [ ] **Step 5: Lifecycle-manage the subscriber in StoreManagerService**

Start after StoreManager hydration, stop in `stop()`, and make repeated start idempotent.

- [ ] **Step 6: Run outcome-binding tests**

```bash
node --test tests/wp0/v21-learning-policy-p1-outcome-binding.test.js
```

Must cover restart/hydration, duplicate inbound event idempotency, wrong-contact denial, ambiguous binding denial, and missing-outcome-not-negative.

---

### Task 6: Extend the canonical Learning projection; keep reward authority separate

**Files:**
- Modify: `backend/services/learningDeepTrainingContract.js`
- Test: `tests/wp0/v21-learning-policy-p1-projection.test.js`

**Interfaces:**
- Consumes: canonical decision-bound learning signals + existing Learning-approved Langfuse Scores + existing minimization policy.
- Produces: `projectPolicy(input) -> { authority:'Learning', readOnly:true, rows:[...] }`.

- [ ] **Step 1: Add `projectPolicy` without creating a second dataset API**

Required row shape:

```js
{
  decision: {
    decisionId,
    stateSnapshotRef,
    stateVersion,
    allowedActionSet,
    chosenAction,
    actionProbability,
    strategyVersion,
    promptProgramVersion,
    modelLogicalRoute,
    policyArtifactVersion
  },
  outcome: partialOutcomeVector,
  approvedScore: existingApprovedLangfuseScore,
  minimizedContent: existingMinimizedProjectionContent
}
```

- [ ] **Step 2: Enforce eligibility**

Exclude/deny rows when:

```text
DecisionRecord provenance missing
Decision/outcome scope mismatch
propensity invalid
Learning-approved Langfuse score missing
approved score subject invalid
DoNotLearn / raw-private persistence violation
minimization denied
```

- [ ] **Step 3: Preserve reward unchanged**

The projection may provide the approved numeric score to the learner but must not:

```text
normalize
clip
weight
aggregate across decisions
map categorical behavior to reward
turn missing outcome into zero/negative
```

- [ ] **Step 4: Run projection tests**

```bash
node --test tests/wp0/v21-learning-policy-p1-projection.test.js
```

Expected GREEN with one decision → one approved score row.

---

### Task 7: Adopt Vowpal Wabbit 9.11.2 inside the existing sealed Learning runtime

**Files:**
- Modify: `runtime/learning-growth/python/pyproject.toml`
- Modify: `runtime/learning-growth/python/uv.lock`
- Modify: `runtime/learning-growth/python/learning_entrypoint.py`
- Modify: `config/upstreams/v21-learning-growth-brain-p0.json`
- Create: `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt`
- Modify: `THIRD_PARTY_NOTICES.md`
- Test: `tests/wp0/v21-learning-policy-p1-vw-runtime.test.js`
- Test: `tests/wp0/v21-learning-policy-p1-supply-chain.test.js`

**Interfaces:**
- Consumes: read-only Learning policy projection JSON; approved numeric score only.
- Produces: sealed VW candidate artifact and prediction response; no provider/model calls.

- [ ] **Step 1: Add exact dependency**

`pyproject.toml` dependency:

```toml
"vowpalwabbit==9.11.2"
```

- [ ] **Step 2: Regenerate the lock with real package-manager output**

From `runtime/learning-growth/python` using the project's pinned `uv` toolchain:

```bash
uv lock
```

If the connected execution environment cannot reach PyPI, run the same command on the user's local machine and upload the resulting exact `uv.lock`; verify bytes/blob before commit. Never synthesize hashes manually.

- [ ] **Step 3: Add upstream receipt/license**

Extend `config/upstreams/v21-learning-growth-brain-p0.json`:

```json
"vowpalWabbit": {
  "repository": "VowpalWabbit/vowpal_wabbit",
  "version": "9.11.2",
  "commit": "122bae254a5b8bc2b774d13b33d53e6dbc2cfba7",
  "license": "BSD-3-Clause",
  "mode": "contextual-bandit-adf-offline-candidate-policy"
}
```

Copy the exact license text from upstream commit `122bae...` to `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt` and add the notice to `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 4: Add train/predict operations to the existing entrypoint**

Required operations:

```python
policy_train
policy_predict
policy_runtime_contract
```

Training uses action-dependent features and one approved cost per chosen action. Convert approved reward to VW cost only by the fixed mechanical rule:

```python
cost = -float(approved_score)
```

No clipping, normalization, weighting, or aggregation.

Prediction result:

```json
{
  "status": "READY",
  "authority": "VowpalWabbit 9.11.2",
  "policyArtifactVersion": "<sha256 of artifact bytes>",
  "action": "natural_hook",
  "probability": 1.0
}
```

For P1 production mode, live random exploration is disabled. If VW returns scores rather than a probability distribution under the selected non-exploring configuration, report `probability: 1.0` for the chosen deterministic production action and mark `exploration: false`; do not fabricate a nontrivial propensity.

- [ ] **Step 5: Fail closed on bad artifacts/actions**

Reject missing model file, artifact hash mismatch, unknown action, nonfinite approved score, invalid propensity, or request for provider execution.

- [ ] **Step 6: Run runtime and supply-chain tests**

```bash
node --test tests/wp0/v21-learning-policy-p1-vw-runtime.test.js tests/wp0/v21-learning-policy-p1-supply-chain.test.js
```

Also execute sealed Python runtime contract under CPython 3.12 on Windows and Linux-compatible CI where available.

---

### Task 8: Add the thin Node policy runtime adapter and consume only promoted artifacts

**Files:**
- Create: `backend/services/learningPolicyRuntimeAdapter.js`
- Modify: `backend/services/contextAwareReplyBrain.js`
- Test: `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`

**Interfaces:**
- Consumes: existing Learning promotion/flagd state + sealed Learning runtime + `allowedActionSet`.
- Produces: `{ source, action, probability, policyArtifactVersion }` before frontier generation.

- [ ] **Step 1: Implement baseline behavior without a second policy store**

If no promoted policy artifact is active:

```js
return Object.freeze({
  source: 'baseline-rules',
  action: baselineAction,
  probability: 1,
  policyArtifactVersion: 'baseline-rules'
});
```

- [ ] **Step 2: Resolve only Learning-promoted policy metadata**

The adapter may consume artifact identity/path/hash only from the existing Learning rollout/OpenFeature/flagd authority. Do not read arbitrary user-supplied model paths from reply requests.

- [ ] **Step 3: Invoke the sealed Learning runtime for prediction**

Request shape:

```json
{
  "operation": "policy_predict",
  "policyArtifact": {"path":"...","sha256":"..."},
  "state": {"relationshipStage":"...","emotionalTrend":"...","strategyVersion":1},
  "allowedActionSet": ["natural_hook","playful_attraction","direct_advance"]
}
```

The adapter validates returned action membership and propensity before `contextAwareReplyBrain` applies it.

- [ ] **Step 4: Prove final generation authority is unchanged**

Test must verify the selected branch affects `directedPacket`/strategy before the first final `aiGateway.execute(...)`, while the actual text still comes from the existing gateway/Model Brain result.

- [ ] **Step 5: Prove rollback**

With promoted policy disabled/rolled back, the same request returns to `baseline-rules` behavior without deleting historical decision/outcome evidence.

---

### Task 9: Close the real Decision→Outcome→Policy loop in UAT

**Files:**
- Create: `tools/uat/v21LearningPolicyClosedLoopEvidence.js`
- Reuse all six WP0 tests.

**Interfaces:**
- Consumes: real StoreManager transaction chain and sealed Learning runtime.
- Produces: machine-readable evidence that a later production decision consumes a newly approved policy artifact.

- [ ] **Step 1: Materialize a real temporary-store conversation**

The UAT must use StoreManager commands/repositories, not direct fabricated result objects, to create:

```text
conversation/contact
→ real AI reply task
→ decision record
→ candidate
→ user-approved outbox
→ successful sent signal
→ inbound human-response message event
→ raw OutcomeVector signal
```

Model text may be supplied through the existing test Model Brain seam/precomputed execution fixture; the UAT must not introduce a second provider gateway.

- [ ] **Step 2: Attach Learning-approved score evidence**

Use the existing Langfuse evidence adapter/test seam to bind one finite numeric approved score to the decision. Do not derive reward directly from `replyLatencyMs` or `conversationContinued`.

- [ ] **Step 3: Train a VW candidate policy**

Feed `projectPolicy(...)` into `policy_train`; seal artifact bytes + SHA-256.

- [ ] **Step 4: Evaluate through existing Regression/Shadow seams**

Candidate must remain non-production until existing `learningProposalService` + `learningEvaluationAdapter` yield `READY_FOR_REVIEW` and explicit promotion creates a Learning rollout.

- [ ] **Step 5: Consume the promoted artifact on a later decision**

Evidence must show:

```text
prior decisionId != later decisionId
later decision.policyArtifactVersion == promoted artifact sha256
later decision.chosenAction is inside allowedActionSet
later policy choice occurs before Model Brain final generation
final reply text comes from Model Brain execution evidence
```

- [ ] **Step 6: Roll back and prove baseline restoration**

After existing Learning rollback, subsequent decision uses `baseline-rules` (or the previous approved policy version) while historical evidence remains immutable.

- [ ] **Step 7: Emit one JSON evidence receipt**

Required top-level keys:

```json
{
  "workPackage": "V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1",
  "decisionOutcomeBound": true,
  "rawOutcomeIsNotReward": true,
  "learner": "VowpalWabbit 9.11.2",
  "frontierGenerationAuthority": "Model Brain / LiteLLM",
  "policyConsumedBeforeGeneration": true,
  "promotionAuthority": "Learning",
  "rollbackProved": true,
  "localReplyModelUsed": false
}
```

---

### Task 10: Exact-head verification, independent review, and ordinary merge

**Files:** no new scope.

**Interfaces:**
- Consumes: exact authorized implementation head.
- Produces: reviewed merge candidate only; no release/publish/automatic promotion.

- [ ] **Step 1: Run targeted tests**

```bash
node --test \
  tests/wp0/v21-learning-policy-p1-decision-record.test.js \
  tests/wp0/v21-learning-policy-p1-outcome-binding.test.js \
  tests/wp0/v21-learning-policy-p1-projection.test.js \
  tests/wp0/v21-learning-policy-p1-vw-runtime.test.js \
  tests/wp0/v21-learning-policy-p1-production-consumption.test.js \
  tests/wp0/v21-learning-policy-p1-supply-chain.test.js
```

- [ ] **Step 2: Run existing no-regression authorities**

At minimum:

```text
existing Learning Growth Brain WP0 tests
existing Learning Deep Training contract tests
existing Agent Lightning P1 tests
existing Model Brain production routing tests
Stage 6.4.5.9 WP0 Architecture Gates
ACV2 WP-A Architecture Gates
correct Layered CI route for this product scope
```

- [ ] **Step 3: Run sealed runtime verification**

Verify:

```text
CPython 3.12
uv lock/sync reproducibility
Vowpal Wabbit import/version
runtime SBOM contains vowpalwabbit 9.11.2
no provider credentials in Learning runtime
no runtime package download
```

- [ ] **Step 4: Run UAT evidence harness**

```bash
node tools/uat/v21LearningPolicyClosedLoopEvidence.js
```

Expected exit 0 and receipt fields from Task 9.

- [ ] **Step 5: Independent exact-head review**

Review focus:

```text
P0/P1 = 0
no raw-private leakage
no reward hacking
no ambiguous cross-contact attribution
no second store/framework/router/provider authority
policy action bounded before generation
final text remains Model Brain/frontier generated
VW exact source/license/lock/SBOM closed
Agent Lightning P1 unchanged
```

- [ ] **Step 6: Fresh-main merge check**

Re-read main, implementation exact Head, authorization scope/digest, active overlaps, CI/review. If trusted main moved, reconcile by ordinary history; no rebase/amend/force.

- [ ] **Step 7: Ordinary merge**

Use `merge_method=merge` with `expected_head_sha=<exact reviewed head>`. No squash/rebase.

- [ ] **Step 8: Post-merge truth statement**

Only after post-merge validation may the repository claim the mechanism:

```text
versioned Yance decision
→ frontier Model Brain generation
→ real user/human outcome
→ canonical Learning-approved evidence
→ OSS-trained policy candidate
→ Regression/Shadow/explicit promotion
→ later production decision consumes the new policy
```

Do not claim personalization quality is already optimal; the landed capability is the real learning-growth mechanism and its governed production consumption path.
