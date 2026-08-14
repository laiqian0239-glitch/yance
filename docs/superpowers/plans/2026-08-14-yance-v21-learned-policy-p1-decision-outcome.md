# Yance V2.1 Learned Policy P1 Decision→Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, privacy-governed Decision → Outcome → Policy loop in which Yance improves one existing structured reply-strategy action while OpenAI/Anthropic remain the final language generators through existing Model Brain/LiteLLM authority.

**Architecture:** Reuse `contextAwareReplyBrain → StoreManager AI task/candidate → Outbox → learning_signal_ledger → Learning evaluation/promotion`. Add only thin contracts/adapters: `DecisionRecordV1`, `OutcomeVectorV1`, a read-only Learning projection, and Vowpal Wabbit 9.11.2 inside the existing sealed Learning Python runtime. The first learned action is the existing `candidateStrategyBranch`; production policy selection happens before the final `aiGateway.execute(...)`. Identity, privacy, reward, provider execution, promotion, rollback, and final send remain with their existing authorities.

**Tech Stack:** Node.js/CommonJS; existing StoreManager/SQLite; `PersonContextAuthority`; Langfuse + OpenTelemetry; existing Learning proposal/evaluation/promotion; existing Model Brain/LiteLLM; sealed CPython 3.12 Learning runtime; Vowpal Wabbit `9.11.2` (`VowpalWabbit/vowpal_wabbit@122bae254a5b8bc2b774d13b33d53e6dbc2cfba7`, BSD-3-Clause); `uv`; Node test runner.

## Global constraints

- Work package: `V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`.
- Final reply text remains frontier-generated through Model Brain/LiteLLM.
- No Qwen/local LLM production reply-generator path is introduced.
- Agent Lightning P1 is unchanged and dormant for this work package.
- No second model gateway, memory store, relationship graph, dataset/experiment platform, reward framework, policy framework, evaluator, scheduler, feature store, RL engine, or credential authority.
- `DecisionRecordV1` and `OutcomeVectorV1` are thin immutable contracts carried by existing persistence/evidence seams.
- Raw human behavior is evidence, not reward. Only Learning-approved Langfuse Score/evaluation evidence enters policy training.
- Missing/late evidence is `pending` or `unavailable`, not `false`/negative.
- P1 learns only `candidateStrategyBranch`, from the existing bounded action set.
- No live randomized exploration in P1. Deterministic behavior-policy propensity is recorded as `1.0` with `exploration=false`; this does not claim counterfactual support for unchosen actions.
- Vowpal Wabbit is the mature OSS learner; no Yance contextual-bandit implementation.
- Existing Learning runtime stays Python `>=3.12,<3.13`; `uv.lock` is package-manager generated only.
- Existing Regression → Shadow → explicit Promotion/Rollback stays authoritative.
- Existing user approval/final-send authority stays unchanged.
- Invalid identity/scope/private content blocks the affected Learned Policy evidence path. Missing learning evidence does not block an otherwise privacy-safe reply. Broken active policy artifact falls back to last-known-good or baseline with degradation evidence.
- Fresh-main authorization and test-only causal RED are mandatory before product code.
- No force push, rebase, amend published history, squash merge, bypass, fake success, or gate weakening.

## Reuse / Retire / New

| Capability | Disposition |
|---|---|
| Frontier generation / credentials | REUSE Model Brain/LiteLLM |
| Canonical Person/Contact binding | REUSE PersonContextAuthority/current identity authorities |
| Memory/relationship facts | REUSE Letta/Graphiti/current projections |
| Journey/Persona | REUSE Parlant/Persona |
| Trace/score/dataset/experiment | REUSE Langfuse/OTel |
| Prompt optimization | REUSE DSPy/GEPA |
| Regression/Shadow | REUSE Promptfoo/Learning evaluation |
| Promotion/Rollback | REUSE Learning/OpenFeature/flagd |
| Agent Lightning P1 | REUSE dormant, no mutation |
| Local/VERL reply-model goal | RETIRE/SUPERSEDED |
| DecisionRecordV1 | NEW thin contract |
| OutcomeVectorV1 | NEW thin contract |
| Decision↔Outcome attribution | NEW thin adapter over existing signals/events |
| Strategy policy learner | ADOPT Vowpal Wabbit 9.11.2 |
| Policy runtime consumption | NEW thin adapter on existing Brain seam |

## Candidate product scope

Fresh-main authorization must freeze this exact **22-path** candidate set unless inspection proves a path can be removed. Any addition requires a recomputed scope/digest and fresh authorization.

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

`backend/services/personContextAuthority.js` is read-only reused authority and is not modified. Current expected route gap is only:

```text
third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt
```

No broad `third_party/` or `third_party/licenses/` product prefix is allowed.

---

### Task 1: Finish and merge the docs-only successor

**Files:**
- `docs/superpowers/specs/2026-08-14-yance-v21-learned-policy-architecture-design.md`
- `docs/superpowers/plans/2026-08-14-yance-v21-learned-policy-p1-decision-outcome.md`

- [ ] **Step 1: Verify net scope**

Fresh compare must contain exactly these two docs files, zero runtime/product/governance paths.

- [ ] **Step 2: Verify OSS-fit source facts**

Freeze:

```text
VowpalWabbit/vowpal_wabbit
release 9.11.2
commit 122bae254a5b8bc2b774d13b33d53e6dbc2cfba7
BSD-3-Clause
python_requires >=3.10
selected mode contextual-bandit ADF
P1 live exploration disabled
```

Disposition:

```text
Agent Lightning VERL/Qwen reply model = retired for this product goal
Yance contextual-bandit engine = rejected duplicate
RouteLLM = reuse for later logical routing, not first strategy head
DSPy/GEPA = reuse for prompt/program optimization
```

- [ ] **Step 3: Resolve all review findings**

Require no unresolved P0/P1/major causal-contract finding on the exact docs head.

- [ ] **Step 4: Exact-head CI then ordinary merge**

Read exact PR head into `reviewedHeadSha`; require applicable Stage/ACV2 checks GREEN; merge with `merge_method=merge` and `expected_head_sha=reviewedHeadSha`.

---

### Task 2: Route-bootstrap exactly the new VW license path

**Files:**
- Create authorization: `governance/layered-ci/v21-learning-policy-p1-route-bootstrap-v1-authorization.json`
- After authorization merge: modify `governance/layered-ci/wp0-routing-policy.json`
- After authorization merge: create `tests/layered-ci/v21-learning-policy-p1-routing.test.js`

- [ ] **Step 1: Prove route gap**

On fresh main verify:

```js
const bootstrapPaths = Object.freeze([
  'third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt'
]);
```

is not already product-routed.

- [ ] **Step 2: Create route authorization following existing exact schema**

It must contain fresh-main SHA, exact path/digests, overlap inventory, ordinary-merge requirement, failure-first requirement and auditable OSS-fit:

```json
{
  "reviewedCandidates": [
    "Vowpal Wabbit 9.11.2",
    "existing DSPy/GEPA",
    "existing RouteLLM",
    "existing Agent Lightning P1"
  ],
  "selected": "Vowpal Wabbit 9.11.2 for bounded candidateStrategyBranch contextual-bandit policy",
  "retireOrAvoid": [
    "local Qwen reply-generator P2",
    "Yance-built contextual-bandit engine",
    "second policy framework"
  ]
}
```

- [ ] **Step 3: Stop at owner authorization boundary**

Do not merge this new authorization or create route implementation before explicit owner approval.

- [ ] **Step 4: After authorization merge, create test-only route RED**

`tests/layered-ci/v21-learning-policy-p1-routing.test.js` asserts exact license path routes as product and broad third-party prefixes remain forbidden.

```bash
node --test tests/layered-ci/v21-learning-policy-p1-routing.test.js
```

Expected RED: license path currently unknown/non-product.

- [ ] **Step 5: GREEN with one exact literal**

Add only:

```json
"third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt"
```

to `productExactPaths`. Run targeted routing + applicable Layered gate.

- [ ] **Step 6: Exact-head review and ordinary merge**

No scope expansion, broad prefix, or history rewrite.

---

### Task 3: Fresh product authorization and causal RED

**Files:**
- Create authorization: `governance/layered-ci/v21-learning-policy-p1-decision-outcome-v1-authorization.json`
- First implementation commit creates exactly:
  - `tests/wp0/v21-learning-policy-p1-decision-record.test.js`
  - `tests/wp0/v21-learning-policy-p1-outcome-binding.test.js`
  - `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`
  - `tests/wp0/v21-learning-policy-p1-projection.test.js`
  - `tests/wp0/v21-learning-policy-p1-supply-chain.test.js`
  - `tests/wp0/v21-learning-policy-p1-vw-runtime.test.js`

- [ ] **Step 1: Fresh overlap inventory**

Inspect active PRs touching any of the 22 candidate paths, especially `THIRD_PARTY_NOTICES.md`, reply Brain, StoreManager, Learning contract, Learning runtime/config.

- [ ] **Step 2: Freeze exact product/first-test digests mechanically**

Sort paths bytewise, join with `\n`, append final `\n`, SHA-256 exact bytes. Store real digests; no manually typed substitute.

- [ ] **Step 3: RED DecisionRecord tests**

Minimum assertions:

```js
assert.equal(record.schemaVersion, 1);
assert.equal(record.authority, 'LearningPolicyDecisionContract');
assert.equal(record.scopeType, 'conversation');
assert.equal(record.scopeId, record.conversationId);
assert.ok(record.contactId);
assert.ok(record.personId);
assert.ok(record.personaProfileId);
assert.match(record.stateSnapshotRef, /^[a-f0-9]{64}$/u);
assert.match(record.featureSchemaRef, /^[a-f0-9]{64}$/u);
assert.match(record.contextCandidateSetRef, /^[a-f0-9]{64}$/u);
assert.match(record.actionSetRef, /^[a-f0-9]{64}$/u);
assert.ok(record.actionId);
assert.ok(record.actionEncodingVersion);
assert.ok(record.behaviorPolicyVersion);
assert.ok(record.actionProbability > 0 && record.actionProbability <= 1);
assert.equal(record.rawPrivateChatPersisted, false);
```

Include two-person/two-profile collision fixtures where same-looking conversation IDs must be rejected when Person binding differs.

- [ ] **Step 4: RED OutcomeVector tests**

```js
assert.equal(outcome.schemaVersion, 1);
assert.equal(outcome.authority, 'LearningOutcomeAttribution');
assert.ok(outcome.outcomeId);
assert.equal(outcome.decisionId, decision.decisionId);
assert.equal(outcome.personId, decision.personId);
assert.equal(outcome.scopeId, decision.scopeId);
assert.equal(outcome.signals.replyLatencyMs.status, 'observed');
assert.equal(outcome.signals.nextDayReinitiation.status, 'pending');
assert.equal(outcome.approvedReward, undefined);
assert.equal(outcome.missingMeansNegative, false);
```

Each signal fixture must include `observedAt/windowStart/windowEnd/sourceType/sourceId/provenanceRef` as applicable.

- [ ] **Step 5: RED propensity/projection tests**

Rows missing `actionId`, `actionSetRef`, `actionEncodingVersion`, `behaviorPolicyVersion`, or original propensity are ineligible for VW training/OPE. No later reconstruction is allowed.

- [ ] **Step 6: RED privacy/provider test**

At actual provider-message construction seam, an ineligible private memory must be absent/rejected while an independently eligible bounded feature remains present.

- [ ] **Step 7: Push exact six-test head and capture causal RED**

Only missing product contracts count as intended RED; route/environment/tooling failures must be repaired at source first.

---

### Task 4: Implement replayable `DecisionRecordV1`

**Files:**
- Create `backend/services/learningPolicyDecisionContract.js`
- Modify `backend/services/contextAwareReplyBrain.js`
- Modify `backend/store/commands/registerAiReplyCommands.js`

- [ ] **Step 1: Resolve canonical identity with existing authority**

Before creating a decision:

```js
const person = personContextAuthority.resolve({ contactId, conversationId });
if (!person.found || person.personId !== expectedPersonId) {
  throw policyError('LEARNING_POLICY_PERSON_BINDING_REQUIRED');
}
if (!person.contactIds.includes(contactId) || !person.conversationIds.includes(conversationId)) {
  throw policyError('LEARNING_POLICY_SCOPE_BINDING_MISMATCH');
}
```

`personaProfileId` comes from the exact Persona context used for generation. No cross-profile repair.

- [ ] **Step 2: Create content-addressed immutable bundle refs**

Use canonical deterministic JSON bytes for bounded projections and SHA-256:

```js
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const stateSnapshotRef = sha256(stableJson(decisionStateProjection));
const featureSchemaRef = sha256(stableJson(featureSchema));
const contextCandidateSetRef = sha256(stableJson(contextCandidateRefs));
const actionSetRef = sha256(stableJson(encodedAllowedActions));
```

Do not hash mutable object serialization with unstable key order; use existing stable/canonical JSON helper if available, otherwise a tiny local canonicalization inside the thin contract after OSS-fit confirms no existing seam.

- [ ] **Step 3: Record all contributing policy versions**

Required explicit values:

```text
relationshipPolicyVersion
memoryPolicyVersion
strategyPolicyVersion
candidateRankerVersion
routingPolicyVersion
promptProgramVersion
behaviorPolicyVersion
```

Baseline head values are explicit version strings such as `baseline-rules-v1`, never blank-as-baseline.

- [ ] **Step 4: Record behavior action exactly at choice time**

```js
{
  actionId,
  actionEncodingVersion: 'candidate-strategy-branch-v1',
  allowedActionSet,
  actionSetRef,
  chosenAction: { kind: 'candidateStrategyBranch', value: selectedBranch },
  behaviorPolicyVersion,
  actionProbability: 1,
  exploration: false
}
```

- [ ] **Step 5: Persist inside existing task/candidate payloads**

Add bounded `learningPolicyDecision`; no new table.

- [ ] **Step 6: Apply policy before final generation**

Selection happens after existing candidate-plan/memory preparation and before the first final reply `aiGateway.execute(...)`. Reuse existing `applyCandidateBranch(...)`; do not duplicate strategy logic.

- [ ] **Step 7: Verify**

```bash
node --test tests/wp0/v21-learning-policy-p1-decision-record.test.js tests/wp0/v21-learning-policy-p1-production-consumption.test.js
```

---

### Task 5: Decision-bound candidate/send evidence + `OutcomeVectorV1`

**Files:**
- Create `backend/services/learningOutcomeAttributionService.js`
- Modify `backend/services/candidateInteractionLearningService.js`
- Modify `backend/services/replyFeedbackLearningService.js`
- Modify `backend/services/storeManagerService.js`

- [ ] **Step 1: Add bounded decision provenance to existing signals**

Persist IDs/versions/action/probability only; no raw state/chat copy:

```js
{
  decisionId,
  decisionSchemaVersion,
  personId,
  personaProfileId,
  behaviorPolicyVersion,
  actionId,
  actionValue,
  actionSetRef,
  actionProbability
}
```

- [ ] **Step 2: Reuse existing `message:inserted` event**

No second inbound pipeline. Bind inbound human message to exactly one latest eligible successful sent decision satisfying canonical `conversationId`, `contactId`, `personId`, and monotonic sent-before-inbound order. Ambiguity rejects attribution.

- [ ] **Step 3: Construct immutable outcome envelope**

```js
const outcome = Object.freeze({
  schemaVersion: 1,
  authority: 'LearningOutcomeAttribution',
  outcomeId,
  decisionId,
  scopeType: 'conversation',
  scopeId: conversationId,
  contactId,
  personId,
  conversationId,
  observedAt: inboundTimestamp,
  observationWindow: Object.freeze({ start: sentTimestamp, end: inboundTimestamp }),
  signals: Object.freeze({
    replyLatencyMs: Object.freeze({
      value: latencyMs,
      status: 'observed',
      observedAt: inboundTimestamp,
      windowStart: sentTimestamp,
      windowEnd: inboundTimestamp,
      sourceType: 'message-pair',
      sourceId: `${outboundMessageId}:${inboundMessageId}`,
      provenanceRef: messagePairDigest
    }),
    conversationContinued: Object.freeze({
      value: true,
      status: 'observed',
      observedAt: inboundTimestamp,
      windowStart: sentTimestamp,
      windowEnd: inboundTimestamp,
      sourceType: 'inbound-message',
      sourceId: inboundMessageId,
      provenanceRef: inboundEvidenceDigest
    }),
    nextDayReinitiation: Object.freeze({
      value: null,
      status: 'pending',
      observedAt: '',
      windowStart: inboundTimestamp,
      windowEnd: nextDayWindowEnd,
      sourceType: 'conversation-window',
      sourceId: conversationId,
      provenanceRef: ''
    })
  }),
  approvedReward: undefined,
  missingMeansNegative: false,
  rawPrivateChatPersisted: false
});
```

Do not store inbound raw text in the outcome signal.

- [ ] **Step 4: Keep windows immutable**

When a later window closes, append a new idempotent outcome observation/version; do not mutate the earlier vector to pretend later evidence existed earlier.

- [ ] **Step 5: Persist via existing Learning signal repository**

Raw outcome signal remains non-trainable until approved score exists:

```text
signalType = policy_outcome_observed
idempotencyKey = policy-outcome:<decisionId>:<sourceObservationId>
learningEligible = false
```

- [ ] **Step 6: Lifecycle-manage subscriber**

Start after StoreManager hydration and stop cleanly; duplicate events/restarts are idempotent.

- [ ] **Step 7: Verify**

```bash
node --test tests/wp0/v21-learning-policy-p1-outcome-binding.test.js
```

Cover duplicate event, wrong contact/person, two-profile collision, ambiguous ordering, pending delayed signal, unavailable evidence, and silence-not-negative.

---

### Task 6: Extend canonical Learning projection and privacy boundary

**Files:**
- Modify `backend/services/learningDeepTrainingContract.js`
- Test `tests/wp0/v21-learning-policy-p1-projection.test.js`
- Test `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`

- [ ] **Step 1: Add `projectPolicy` to existing Learning contract**

Projection row:

```js
{
  decision: replayableDecisionProjection,
  outcomes: immutableOutcomeObservations,
  approvedScore: approvedLangfuseScore,
  minimizedContent
}
```

- [ ] **Step 2: Enforce identity and replayability**

Reject mismatched `scope/contact/person/conversation/personaProfile`, missing/invalid content-addressed refs, or a decision trace that does not resolve to the same bundle.

- [ ] **Step 3: Enforce CB training eligibility**

Exclude rows without exact `actionId`, `actionEncodingVersion`, `actionSetRef`, `behaviorPolicyVersion`, original finite propensity `(0,1]`, or chosen action inside allowed set.

- [ ] **Step 4: Preserve existing privacy/minimization**

DoNotLearn, raw-private persistence, or minimization denial excludes affected content. No private field may leak through a learned feature into the provider request.

- [ ] **Step 5: Provider-boundary acceptance**

Build one actual frontier request fixture where:

```text
private memory = ineligible → absent/rejected
bounded relationship feature = eligible → still present
```

The test targets the existing `buildModelMessages`/equivalent final provider-bound request seam, not merely source text.

- [ ] **Step 6: Preserve reward unchanged**

No normalization, clipping, weighting, inferred reward, cross-decision aggregation, or missing-signal conversion.

- [ ] **Step 7: Verify**

```bash
node --test tests/wp0/v21-learning-policy-p1-projection.test.js tests/wp0/v21-learning-policy-p1-production-consumption.test.js
```

---

### Task 7: Adopt Vowpal Wabbit 9.11.2 in existing sealed Learning runtime

**Files:**
- Modify `runtime/learning-growth/python/pyproject.toml`
- Modify `runtime/learning-growth/python/uv.lock`
- Modify `runtime/learning-growth/python/learning_entrypoint.py`
- Modify `config/upstreams/v21-learning-growth-brain-p0.json`
- Create `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt`
- Modify `THIRD_PARTY_NOTICES.md`
- Test `tests/wp0/v21-learning-policy-p1-vw-runtime.test.js`
- Test `tests/wp0/v21-learning-policy-p1-supply-chain.test.js`

- [ ] **Step 1: Add exact package**

```toml
"vowpalwabbit==9.11.2"
```

- [ ] **Step 2: Regenerate real lock**

```bash
cd runtime/learning-growth/python
uv lock
```

If current execution environment cannot access PyPI, use the user's local machine to generate the exact `uv.lock`, upload it, then verify bytes/blob before commit. Never synthesize lock hashes.

- [ ] **Step 3: Add exact upstream receipt/license/notice**

```json
"vowpalWabbit": {
  "repository": "VowpalWabbit/vowpal_wabbit",
  "version": "9.11.2",
  "commit": "122bae254a5b8bc2b774d13b33d53e6dbc2cfba7",
  "license": "BSD-3-Clause",
  "mode": "contextual-bandit-adf-offline-candidate-policy"
}
```

Copy exact upstream LICENSE bytes from the frozen commit.

- [ ] **Step 4: Add runtime operations**

```text
policy_runtime_contract
policy_train
policy_predict
```

The training adapter may convert an already-approved scalar reward to VW cost only by:

```python
cost = -float(approved_score)
```

No other reward shaping.

- [ ] **Step 5: Encode ADF record from original behavior log**

Use the exact logged action set/action ID/original propensity. Never reconstruct propensity at training time.

- [ ] **Step 6: Seal artifact identity**

```python
policy_artifact_version = hashlib.sha256(artifact_bytes).hexdigest()
```

- [ ] **Step 7: Deterministic P1 prediction**

Return chosen allowed action, exact artifact version, `probability=1.0`, `exploration=false`. Reject unknown actions, hash mismatch, corrupt artifact, nonfinite score, or provider-execution request.

- [ ] **Step 8: Verify runtime/supply chain**

```bash
node --test tests/wp0/v21-learning-policy-p1-vw-runtime.test.js tests/wp0/v21-learning-policy-p1-supply-chain.test.js
```

Also verify CPython 3.12 runtime, reproducible `uv`, SBOM contains VW 9.11.2, no provider credentials, no runtime package download.

---

### Task 8: Thin production policy adapter with availability-safe failure semantics

**Files:**
- Create `backend/services/learningPolicyRuntimeAdapter.js`
- Modify `backend/services/contextAwareReplyBrain.js`
- Test `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`

- [ ] **Step 1: No promoted policy → explicit baseline**

```js
return Object.freeze({
  source: 'baseline-rules',
  action: baselineAction,
  probability: 1,
  exploration: false,
  policyArtifactVersion: 'baseline-rules-v1'
});
```

- [ ] **Step 2: Resolve only Learning-promoted artifact metadata**

Do not accept arbitrary request-supplied model/artifact paths. Candidate identity/path/hash comes from existing Learning rollout/OpenFeature/flagd projection.

- [ ] **Step 3: Active artifact valid → predict**

Call sealed runtime with bounded state/action set and verify returned artifact hash/action.

- [ ] **Step 4: Active artifact corrupt → last-known-good/base**

Do not turn a strategy-learning artifact failure into a reply outage. Use previously verified last-known-good promoted artifact when existing rollout history provides it; otherwise explicit baseline. Emit degradation evidence and record which policy actually executed.

- [ ] **Step 5: Identity/privacy mismatch is not a generic fallback**

A mismatched DecisionRecord or ineligible private feature is discarded/blocked. Re-resolve canonical privacy-safe context and create a new valid baseline decision if reply generation can safely continue; never reuse the invalid evidence.

- [ ] **Step 6: Prove generator authority**

Policy selection must occur before final `aiGateway.execute(...)`; reply text still comes from existing Model Brain execution evidence.

- [ ] **Step 7: Prove rollback**

Existing Learning rollback restores previous/baseline policy; historical decisions retain original versions.

---

### Task 9: Real closed-loop UAT

**Files:**
- Create `tools/uat/v21LearningPolicyClosedLoopEvidence.js`

- [ ] **Step 1: Exercise real StoreManager chain**

```text
canonical contact/person/conversation/persona
→ DecisionRecordV1
→ AI candidate
→ user-approved Outbox
→ successful send
→ sent learning signal
→ inbound human message
→ OutcomeVectorV1
```

Use existing test/precomputed Model Brain seam; do not create another provider adapter.

- [ ] **Step 2: Bind Learning-approved score**

Use existing Langfuse/Learning evidence seam. Raw latency/continuation is not reward.

- [ ] **Step 3: Project + train VW candidate**

```text
projectPolicy
→ policy_train
→ artifact SHA-256
```

- [ ] **Step 4: Existing evaluation/promotion**

Candidate reaches production only after existing Regression + Shadow + explicit Learning approval.

- [ ] **Step 5: Later decision consumes promoted policy before frontier call**

Require later decision ID differs, policy artifact SHA matches promoted candidate, chosen action is within exact allowed action set, and final reply execution evidence is Model Brain.

- [ ] **Step 6: Artifact failure and rollback evidence**

Prove corrupt active artifact uses last-known-good/base with degradation receipt, then explicit rollback restores prior/baseline without rewriting history.

- [ ] **Step 7: Emit closure receipt**

```json
{
  "workPackage": "V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1",
  "canonicalIdentityBound": true,
  "decisionReplayable": true,
  "behaviorPropensityLoggedAtDecision": true,
  "outcomeWindowsAndMissingnessExplicit": true,
  "decisionOutcomeBound": true,
  "rawOutcomeIsNotReward": true,
  "providerPrivacyBoundaryProved": true,
  "learner": "VowpalWabbit 9.11.2",
  "frontierGenerationAuthority": "Model Brain / LiteLLM",
  "policyConsumedBeforeGeneration": true,
  "promotionAuthority": "Learning",
  "availabilityFallbackProved": true,
  "rollbackProved": true,
  "localReplyModelUsed": false
}
```

---

### Task 10: Exact-head verification, independent review, ordinary merge

- [ ] **Step 1: Run all six new WP0 tests**

```bash
node --test \
  tests/wp0/v21-learning-policy-p1-decision-record.test.js \
  tests/wp0/v21-learning-policy-p1-outcome-binding.test.js \
  tests/wp0/v21-learning-policy-p1-production-consumption.test.js \
  tests/wp0/v21-learning-policy-p1-projection.test.js \
  tests/wp0/v21-learning-policy-p1-supply-chain.test.js \
  tests/wp0/v21-learning-policy-p1-vw-runtime.test.js
```

- [ ] **Step 2: Run no-regression authorities**

At minimum existing Learning Growth WP0, Learning Deep Training contract tests, Agent Lightning P1 tests, Model Brain routing tests, Stage 6.4.5.9 WP0, ACV2 WP-A, and correctly routed Layered product verification.

- [ ] **Step 3: Run UAT**

```bash
node tools/uat/v21LearningPolicyClosedLoopEvidence.js
```

Require exit 0 and full receipt from Task 9.

- [ ] **Step 4: Independent exact-head review**

Require P0=0/P1=0 and no unresolved causal/privacy/data-integrity finding. Explicitly review identity collision, immutable state refs, original propensity, outcome windows/missingness, provider privacy, artifact availability fallback, frontier generator authority, VW supply-chain closure, and Agent Lightning non-regression.

- [ ] **Step 5: Fresh merge check**

Re-read main, implementation head, authorization path digest, active overlaps, CI/review. If main moved, ordinary-history reconciliation only.

- [ ] **Step 6: Ordinary merge**

Read exact reviewed implementation head into `reviewedHeadSha`; call merge with `merge_method=merge` and `expected_head_sha=reviewedHeadSha`.

- [ ] **Step 7: Post-merge claim discipline**

Only after post-merge validation may Yance claim a real governed mechanism:

```text
canonical immutable decision
→ frontier Model Brain generation
→ causally bound real human outcomes with explicit windows/missingness
→ Learning-approved reward evidence
→ OSS-trained bounded policy candidate
→ Regression/Shadow/explicit promotion
→ later decision consumes promoted policy
→ rollback/fallback remains available
```

Do not claim personalization quality is already optimal; the landed mechanism is what enables longitudinal improvement.
