# Yance V2.1 Learned Policy P1 Decision→Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a real, privacy-governed Decision → Outcome → Policy mechanism in which Yance learns one existing structured reply-strategy action while OpenAI/Anthropic remain the final language generators through existing Model Brain/LiteLLM authority.

**Architecture:** Reuse the existing `contextAwareReplyBrain → StoreManager AI task/candidate → Outbox → immutable learning_signal_ledger → Learning evaluation/promotion` chain. Add only thin causal contracts/adapters: `DecisionRecordV1`, `OutcomeVectorV1`, a read-only `projectPolicy` projection, and Vowpal Wabbit 9.11.2 inside the existing sealed Learning Python runtime. The first action is existing `candidateStrategyBranch`. The behavior decision is recorded before final `aiGateway.execute(...)`; the successful eligible `candidate_sent` signal becomes the immutable trainable source anchor; raw human outcomes remain permanently non-trainable evidence rows and are joined by `decisionId`; Learning-approved Langfuse Score remains separate reward authority.

**Tech Stack:** Node.js/CommonJS; existing StoreManager/SQLite and `learning_signal_ledger`; `PersonContextAuthority`; current Persona/relationship projections; Langfuse + OpenTelemetry; existing Learning proposal/evaluation/promotion; existing Model Brain/LiteLLM; sealed CPython 3.12 Learning runtime; Vowpal Wabbit `9.11.2` at `VowpalWabbit/vowpal_wabbit@122bae254a5b8bc2b774d13b33d53e6dbc2cfba7`, BSD-3-Clause; `uv`; Node test runner.

## Global constraints

- Work package: `V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`.
- Final reply text remains frontier-generated through Model Brain/LiteLLM.
- No Qwen/local LLM production reply-generator path.
- Agent Lightning P1 remains unchanged and dormant.
- No second model gateway, memory system, identity store, relationship graph, Persona/Journey engine, dataset/experiment platform, reward framework, policy framework, evaluator, scheduler, feature store, RL engine, or credential authority.
- First learned action is only `candidateStrategyBranch` using the existing bounded branch set.
- P1 has no live randomized exploration. Deterministic behavior records `actionProbability=1.0`, `exploration=false`.
- Raw human behavior is evidence, not reward.
- Raw `policy_outcome_observed` records are permanently `learningEligible=false` and are never mutated later.
- P1 trainable source anchor is an existing immutable **eligible `candidate_sent` signal** carrying exact DecisionRecord provenance.
- Learning-approved Score is keyed to the eligible source signal and binds exact `decisionId + outcomeIds + outcomeEvidenceSetRef + rewardPolicyVersion`.
- `projectPolicy` starts from eligible source signals and joins immutable raw outcomes; it never promotes/mutates raw outcome eligibility.
- Historical learner input uses a stored bounded `featureBundle`; it never recomputes yesterday's features from today's relationship state.
- `featureBundle` is fixed-schema and contains no free-form chat text, raw memory text, message bodies, arbitrary extension objects, or credentials.
- Existing Regression → Shadow → explicit Promotion/Rollback remains authoritative.
- Existing user final-send approval remains authoritative.
- Broken active policy artifact falls to verified last-known-good or baseline with degradation evidence; identity/privacy violations block the affected policy evidence instead of being silently repaired.
- Fresh-main route authorization and product authorization are mandatory before implementation.
- First product implementation commit is test-only causal RED.
- No rebase, amend published history, force push, squash merge, bypass, warning-only closure, or fake success.

## Reuse / Retire / New

| Capability | Disposition |
|---|---|
| Frontier generation / provider credentials | REUSE Model Brain/LiteLLM |
| Canonical Person/Contact binding | REUSE PersonContextAuthority/current identity authorities |
| Memory/relationship projections | REUSE Letta/Graphiti/current authorities |
| Persona/Journey | REUSE Persona/Parlant |
| Trace/score/dataset/experiment | REUSE Langfuse/OTel |
| Prompt/program optimization | REUSE DSPy/GEPA |
| Regression/Shadow | REUSE Promptfoo/Learning evaluation |
| Promotion/Rollback | REUSE Learning/OpenFeature/flagd |
| Immutable Learning ledger | REUSE existing `learning_signal_ledger` |
| Agent Lightning P1 | REUSE dormant, no mutation |
| Local/VERL reply-model goal | RETIRE/SUPERSEDED |
| DecisionRecordV1 | NEW thin contract |
| OutcomeVectorV1 | NEW thin contract |
| Decision↔Outcome attribution | NEW thin adapter over existing events/signals |
| Strategy policy learner | ADOPT Vowpal Wabbit 9.11.2 |
| Policy runtime consumption | NEW thin adapter on existing Brain seam |

## Candidate product scope

Fresh-main authorization must freeze this exact **22-path** candidate set unless inspection proves a path can be removed. Any addition requires recomputing the complete authorization scope and digest.

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

`backend/services/personContextAuthority.js` is read-only reused authority and is not modified.

Expected fresh-main route gap:

```text
third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt
```

No `third_party/` or `third_party/licenses/` broad product prefix is allowed.

---

### Task 1: Close and ordinary-merge the docs-only successor

**Files:**
- `docs/superpowers/specs/2026-08-14-yance-v21-learned-policy-architecture-design.md`
- `docs/superpowers/plans/2026-08-14-yance-v21-learned-policy-p1-decision-outcome.md`

- [ ] **Step 1: Verify net scope**

Fresh compare from current `main` must show exactly these two documentation paths and zero product/runtime/governance changes.

- [ ] **Step 2: Verify primary OSS identity**

Freeze:

```text
repository = VowpalWabbit/vowpal_wabbit
release = 9.11.2
commit = 122bae254a5b8bc2b774d13b33d53e6dbc2cfba7
license = BSD-3-Clause
python_requires = >=3.10
selected mode = contextual-bandit ADF
P1 live exploration = disabled
```

Disposition:

```text
Agent Lightning VERL/Qwen reply model = retired for this product goal
Yance contextual-bandit engine = rejected duplicate
RouteLLM = reuse for later logical routing, not first strategy head
DSPy/GEPA = reuse for prompt/program optimization
```

- [ ] **Step 3: Independent exact-head documentation audit**

Require:

```text
P0 = 0
P1 = 0
no unresolved identity/privacy/reward/immutability/propensity finding
22-path scope count matches the printed list
no TODO/TBD/placeholder digest
raw Outcome is never described as mutable eligibility
featureBundle is stored and bounded, not hash-only
```

CodeRabbit exact-head review may supplement this audit but an external review-service rate limit is not a product RED.

- [ ] **Step 4: Exact-head CI and ordinary merge**

Require applicable Stage/ACV2 checks GREEN. Read exact reviewed PR head into `reviewedHeadSha`, fresh-read main, then merge using `merge_method=merge` and `expected_head_sha=reviewedHeadSha`. No squash/rebase.

---

### Task 2: Route-bootstrap exactly one VW license path

**Files:**
- Create authorization: `governance/layered-ci/v21-learning-policy-p1-route-bootstrap-v1-authorization.json`
- After authorization ordinary merge: modify `governance/layered-ci/wp0-routing-policy.json`
- After authorization ordinary merge: create `tests/layered-ci/v21-learning-policy-p1-routing.test.js`

- [ ] **Step 1: Prove exact route gap on fresh main**

Require exactly:

```js
const bootstrapPaths = Object.freeze([
  'third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt'
]);
```

and prove it is not currently product-routed.

- [ ] **Step 2: Create fresh route authorization using existing repository schema**

Authorization records fresh main, path/digests, overlap inventory, ordinary-merge requirement, failure-first requirement, and OSS-fit including:

```json
{
  "reviewedCandidates": [
    "existing trusted delegated route guard",
    "Vowpal Wabbit 9.11.2 future product dependency",
    "existing DSPy/GEPA",
    "existing RouteLLM",
    "existing Agent Lightning P1"
  ],
  "selected": "existing trusted route guard; exact VW license literal only",
  "retireOrAvoid": [
    "broad third_party product prefix",
    "second Yance route engine",
    "local Qwen reply-generator P2",
    "Yance-built contextual-bandit engine"
  ]
}
```

- [ ] **Step 3: Stop at new authorization owner boundary**

Do not merge this authorization and do not create route implementation until explicit owner approval.

- [ ] **Step 4: After authorization merge, create test-only route RED**

Test requires the exact license path to route as product and broad third-party prefixes to remain forbidden.

```bash
node --test tests/layered-ci/v21-learning-policy-p1-routing.test.js
```

Expected causal RED: exact license path remains unknown/non-product.

- [ ] **Step 5: GREEN with one literal**

Add only the exact VW license path to `productExactPaths`, run targeted route test and applicable Layered route gate.

- [ ] **Step 6: Exact-head review and ordinary merge**

No path expansion or history rewrite.

---

### Task 3: Fresh product authorization and six-test causal RED

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

Inspect active PRs touching any candidate path, especially `THIRD_PARTY_NOTICES.md`, reply Brain, StoreManager, immutable feedback service, Learning contract, runtime/config.

- [ ] **Step 2: Freeze exact path digests mechanically**

For product and first-test sets: sort bytewise, join with newline, append final newline, SHA-256 exact bytes. Store real digests in authorization; no manually typed substitute.

- [ ] **Step 3: RED DecisionRecord contract**

Require:

```js
assert.equal(record.schemaVersion, 1);
assert.equal(record.authority, 'LearningPolicyDecisionContract');
assert.equal(record.scopeType, 'conversation');
assert.equal(record.scopeId, record.conversationId);
assert.ok(record.contactId);
assert.ok(record.personId);
assert.ok(record.personaProfileId);
assert.equal(typeof record.featureBundle, 'object');
assert.equal(hasFreeText(record.featureBundle), false);
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

Include two-person/two-profile collision cases.

- [ ] **Step 4: RED immutable-ledger topology**

Require one eligible `candidate_sent` source signal carrying exact decision provenance, one raw `policy_outcome_observed` signal with `learningEligible=false`, and no code path that updates the raw row to true.

- [ ] **Step 5: RED OutcomeVector contract**

Require `outcomeId`, `decisionId`, `sourceSignalId`, canonical identity, observation window, per-signal provenance/missingness, and:

```js
assert.equal(outcome.signals.replyLatencyMs.status, 'observed');
assert.equal(outcome.signals.nextDayReinitiation.status, 'pending');
assert.equal(outcome.approvedReward, undefined);
assert.equal(outcome.learningEligible, false);
```

- [ ] **Step 6: RED score/projection contract**

`projectPolicy` must reject a Score unless it is keyed to the eligible source signal and binds exactly:

```text
sourceSignalId
decisionId
outcomeIds
outcomeEvidenceSetRef
rewardPolicyVersion
```

Rows missing original action/action-set/behavior propensity are ineligible for VW training/OPE.

- [ ] **Step 7: RED provider-bound privacy**

At the actual final provider-message seam, prove an ineligible private memory is absent/rejected while an independently eligible bounded field remains available.

- [ ] **Step 8: Push exact test-only Head and capture causal RED**

Only missing Learned Policy contracts count as intended RED; environment/routing/tooling failures must be fixed at source first.

---

### Task 4: Implement canonical `DecisionRecordV1`

**Files:**
- Create `backend/services/learningPolicyDecisionContract.js`
- Modify `backend/services/contextAwareReplyBrain.js`
- Modify `backend/store/commands/registerAiReplyCommands.js`

- [ ] **Step 1: Resolve canonical Person/Contact/Conversation**

Before persistence:

```js
const person = personContextAuthority.resolve({ contactId, conversationId });
if (!person.found || person.personId !== expectedPersonId) {
  throw policyError('LEARNING_POLICY_PERSON_BINDING_REQUIRED');
}
if (!person.contactIds.includes(contactId) || !person.conversationIds.includes(conversationId)) {
  throw policyError('LEARNING_POLICY_SCOPE_BINDING_MISMATCH');
}
```

`personaProfileId` must be the exact profile used by current Persona compilation.

- [ ] **Step 2: Freeze P1 feature schema from existing state authorities**

The product authorization/test contract must enumerate exact allowed feature keys. Rules:

```text
bounded enum/numeric/boolean only
no message body
no memory text
no contact name
no arbitrary string extension
no provider credential
no field that fails existing Learning privacy/minimization
```

Do not invent a generic feature framework.

- [ ] **Step 3: Persist exact `featureBundle` and content identities**

Use an existing trusted canonical-serialization seam. If fresh-main inspection proves none exists, stop at OSS-fit/authorization boundary rather than silently self-building one.

Compute SHA-256 for canonical feature bytes, context-candidate ID set, and encoded action set.

- [ ] **Step 4: Record all contributing policy versions**

Explicitly record relationship, memory, strategy, candidate-ranker, routing, prompt-program, and behavior-policy versions. Baseline versions are explicit stable strings.

- [ ] **Step 5: Record behavior action at decision time**

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

- [ ] **Step 6: Apply action before frontier generation**

Choose/apply existing branch after candidate-plan/context preparation and before first final `aiGateway.execute(...)`. Reuse current `applyCandidateBranch(...)` logic.

- [ ] **Step 7: Carry DecisionRecord through existing task/candidate persistence**

No new table.

- [ ] **Step 8: Verify**

```bash
node --test tests/wp0/v21-learning-policy-p1-decision-record.test.js tests/wp0/v21-learning-policy-p1-production-consumption.test.js
```

---

### Task 5: Bind successful eligible send and immutable raw outcomes

**Files:**
- Modify `backend/services/candidateInteractionLearningService.js`
- Modify `backend/services/replyFeedbackLearningService.js`
- Create `backend/services/learningOutcomeAttributionService.js`
- Modify `backend/services/storeManagerService.js`

- [ ] **Step 1: Make eligible `candidate_sent` the P1 source anchor**

The existing immutable sent signal carries the bounded DecisionRecord needed for replay/training. It keeps existing truth/emergency/DoNotLearn eligibility rules.

If the sent source signal is not learning-eligible, P1 does **not** create downstream policy-learning Outcome evidence for that decision.

- [ ] **Step 2: Never mutate source or raw outcome eligibility**

No `UPDATE learning_signal_ledger SET learning_eligible=...` is introduced. Existing immutable insert semantics remain intact.

- [ ] **Step 3: Reuse existing `message:inserted` event**

No second inbound pipeline. Bind an inbound human message to exactly one latest eligible successful sent decision satisfying same canonical `conversationId`, `contactId`, `personId`, and strict sent-before-inbound ordering. Ambiguity rejects attribution.

- [ ] **Step 4: Create immutable `OutcomeVectorV1`**

Conceptual immediate observation:

```js
{
  schemaVersion: 1,
  authority: 'LearningOutcomeAttribution',
  outcomeId,
  decisionId,
  sourceSignalId,
  scopeType: 'conversation',
  scopeId: conversationId,
  contactId,
  personId,
  conversationId,
  observedAt: inboundTimestamp,
  observationWindow: { start: sentTimestamp, end: inboundTimestamp },
  signals: {
    replyLatencyMs: {
      value: latencyMs,
      status: 'observed',
      observedAt: inboundTimestamp,
      windowStart: sentTimestamp,
      windowEnd: inboundTimestamp,
      sourceType: 'message-pair',
      sourceId: messagePairId,
      provenanceRef: messagePairDigest
    },
    conversationContinued: {
      value: true,
      status: 'observed',
      observedAt: inboundTimestamp,
      windowStart: sentTimestamp,
      windowEnd: inboundTimestamp,
      sourceType: 'inbound-message',
      sourceId: inboundMessageId,
      provenanceRef: inboundEvidenceDigest
    },
    nextDayReinitiation: {
      value: null,
      status: 'pending',
      observedAt: '',
      windowStart: inboundTimestamp,
      windowEnd: nextDayWindowEnd,
      sourceType: 'conversation-window',
      sourceId: conversationId,
      provenanceRef: ''
    }
  },
  learningEligible: false,
  rawPrivateChatPersisted: false
}
```

No inbound raw text is stored in the outcome signal.

- [ ] **Step 5: Persist idempotently**

Use existing Learning signal repository with deterministic idempotency from decision + source observation ID. Raw outcome remains permanently false for learning eligibility.

- [ ] **Step 6: Late windows append, never rewrite**

A closed later window creates a new immutable outcome observation/version tied to the same decision/source signal.

- [ ] **Step 7: Lifecycle-manage subscriber**

Start after StoreManager hydration; stop cleanly; duplicate event/restart is idempotent.

- [ ] **Step 8: Verify**

```bash
node --test tests/wp0/v21-learning-policy-p1-outcome-binding.test.js
```

Cover duplicate, wrong contact/person, two-profile collision, ambiguity, pending delayed metric, unavailable evidence, and silence-not-negative.

---

### Task 6: Implement immutable `projectPolicy` on existing Learning contract

**Files:**
- Modify `backend/services/learningDeepTrainingContract.js`
- Test `tests/wp0/v21-learning-policy-p1-projection.test.js`
- Test `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`

- [ ] **Step 1: Start projection from eligible source signals**

Use existing repository query with `learningEligible=true` and P1 source type `candidate_sent`. Do not start from raw outcome rows.

- [ ] **Step 2: Validate stored DecisionRecord**

Require canonical identity, fixed safe feature schema, content-addressed refs, exact action/action-set encoding, explicit policy versions, and original finite propensity.

- [ ] **Step 3: Join raw outcomes by exact decision/source identity**

Query same scope including `learningEligible=false`, select only `policy_outcome_observed` rows where `decisionId`, `sourceSignalId`, `personId`, and conversation identity match the source DecisionRecord.

- [ ] **Step 4: Require Learning-approved Score for source signal**

Reuse existing `approvedScoresBySignalId[sourceSignalId]` authority and additionally require exact evidence binding:

```text
score.decisionId == decisionId
score.sourceSignalId == sourceSignalId
score.outcomeIds == joined immutable outcome IDs
score.outcomeEvidenceSetRef == digest of canonical joined evidence IDs/provenance refs
score.rewardPolicyVersion is explicit
```

No mutation of raw outcomes occurs.

- [ ] **Step 5: Emit read-only learner row**

```js
{
  sourceSignalId,
  decision: storedDecisionRecord,
  outcomes: immutableOutcomeObservations,
  approvedScore,
  minimizedContent
}
```

Historical features come from stored `featureBundle`, never current state.

- [ ] **Step 6: Preserve privacy/reward authority**

DoNotLearn, raw-private persistence, minimization denial, identity mismatch, missing score binding, or invalid propensity excludes/rejects the row. No reward normalization/clipping/weighting or missing-signal conversion.

- [ ] **Step 7: Provider-bound privacy acceptance**

At actual final provider request construction prove:

```text
ineligible private memory → absent/rejected
independently eligible bounded relationship feature → remains present
```

- [ ] **Step 8: Verify**

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

- [ ] **Step 1: Add exact dependency**

```toml
"vowpalwabbit==9.11.2"
```

- [ ] **Step 2: Generate real lock with `uv`**

```bash
cd runtime/learning-growth/python
uv lock
```

If current environment cannot reach PyPI, user generates this exact file locally and uploads it. Verify bytes/blob before commit. Never synthesize lock hashes.

- [ ] **Step 3: Add source receipt/license/notices**

```json
"vowpalWabbit": {
  "repository": "VowpalWabbit/vowpal_wabbit",
  "version": "9.11.2",
  "commit": "122bae254a5b8bc2b774d13b33d53e6dbc2cfba7",
  "license": "BSD-3-Clause",
  "mode": "contextual-bandit-adf-offline-candidate-policy"
}
```

Copy exact upstream LICENSE bytes from frozen commit.

- [ ] **Step 4: Add sealed runtime operations**

```text
policy_runtime_contract
policy_train
policy_predict
```

Training accepts only `projectPolicy` rows. It consumes the stored `featureBundle`, exact action encoding, chosen action, original propensity, and finite Learning-approved score.

- [ ] **Step 5: Mechanical reward-to-cost conversion only**

```python
cost = -float(approved_score)
```

No other shaping.

- [ ] **Step 6: Seal artifact identity**

SHA-256 artifact bytes and return the 64-hex digest as `policyArtifactVersion`.

- [ ] **Step 7: Deterministic P1 prediction**

Return an action inside supplied exact action set, artifact identity, `probability=1.0`, `exploration=false`. Reject corrupt/mismatched artifact, unknown action, nonfinite score, invalid logged propensity, or provider-execution request.

- [ ] **Step 8: Verify runtime and supply chain**

```bash
node --test tests/wp0/v21-learning-policy-p1-vw-runtime.test.js tests/wp0/v21-learning-policy-p1-supply-chain.test.js
```

Also verify CPython 3.12, reproducible `uv`, SBOM includes VW 9.11.2, no provider credentials, no runtime package download.

---

### Task 8: Thin production policy adapter with availability-safe fallback

**Files:**
- Create `backend/services/learningPolicyRuntimeAdapter.js`
- Modify `backend/services/contextAwareReplyBrain.js`
- Test `tests/wp0/v21-learning-policy-p1-production-consumption.test.js`

- [ ] **Step 1: No promoted artifact → explicit baseline**

Return existing baseline action with probability 1, exploration false, and explicit baseline policy version.

- [ ] **Step 2: Resolve only existing Learning-promoted artifact metadata**

Do not accept arbitrary request-supplied policy paths/hashes.

- [ ] **Step 3: Valid active artifact → sealed runtime prediction**

Provide the same fixed-schema bounded features and exact allowed action set; validate returned artifact identity/action before applying the branch.

- [ ] **Step 4: Broken active artifact → last-known-good or baseline**

If existing rollout history provides a previously verified promoted artifact, use it; otherwise explicit baseline. Emit degradation evidence and record which policy actually executed. Do not turn advisory strategy-policy failure into reply outage.

- [ ] **Step 5: Identity/privacy mismatch is not generic fallback**

Discard invalid evidence. Re-resolve canonical privacy-safe context and create a new valid baseline decision if reply generation can safely continue; never reuse invalid DecisionRecord/private features.

- [ ] **Step 6: Prove frontier authority and rollback**

Policy selection occurs before final `aiGateway.execute(...)`; text comes from Model Brain. Existing Learning rollback restores previous/baseline policy without rewriting historical evidence.

---

### Task 9: Real closed-loop UAT

**Files:**
- Create `tools/uat/v21LearningPolicyClosedLoopEvidence.js`

- [ ] **Step 1: Exercise real StoreManager chain**

```text
canonical contact/person/conversation/persona
→ bounded featureBundle + DecisionRecordV1
→ frontier-generated AI candidate
→ user-approved Outbox
→ successful eligible candidate_sent source signal
→ inbound human message
→ immutable raw OutcomeVectorV1 learningEligible=false
```

Use existing Model Brain test/precomputed execution seam; no second provider adapter.

- [ ] **Step 2: Bind a Learning-approved Score**

Through existing Langfuse/Learning evidence seam, create one finite score keyed to `sourceSignalId` and bound to exact decision/outcome evidence set + reward policy version.

- [ ] **Step 3: `projectPolicy` then train VW candidate**

Prove projection starts from eligible source signal, joins raw false-eligible outcome, preserves stored historical featureBundle, and produces a sealed VW candidate.

- [ ] **Step 4: Existing evaluation/promotion**

Candidate reaches production only after existing Regression + Shadow + explicit Learning approval.

- [ ] **Step 5: Later turn consumes promoted policy before frontier call**

Later decision ID differs; artifact SHA matches promoted candidate; action is in exact set; Model Brain generates final text.

- [ ] **Step 6: Fallback and rollback**

Corrupt active artifact proves last-known-good/baseline availability path with degradation evidence. Explicit rollback restores prior/baseline without rewriting history.

- [ ] **Step 7: Emit closure receipt**

```json
{
  "workPackage": "V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1",
  "canonicalIdentityBound": true,
  "storedHistoricalFeatureBundle": true,
  "behaviorPropensityLoggedAtDecision": true,
  "eligibleSourceSignalAnchored": true,
  "rawOutcomeEligibilityImmutableFalse": true,
  "outcomeWindowsAndMissingnessExplicit": true,
  "scoreEvidenceBindingVerified": true,
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

At minimum run existing Learning Growth WP0, Learning Deep Training contract tests, Agent Lightning P1 tests, Model Brain routing tests, Stage 6.4.5.9 WP0, ACV2 WP-A, and correctly routed Layered product verification.

- [ ] **Step 3: Run UAT**

```bash
node tools/uat/v21LearningPolicyClosedLoopEvidence.js
```

Require exit 0 and full Task 9 receipt.

- [ ] **Step 4: Independent exact-head review**

Require P0=0/P1=0 with explicit review of:

```text
canonical identity collision
stored immutable featureBundle and schema
original behavior propensity/action-set identity
immutable eligible source-signal anchor
raw outcome permanently learningEligible=false
score binding to exact source/decision/outcome set
outcome windows/missingness
provider-bound privacy
artifact availability fallback
frontier generator authority
VW source/license/lock/SBOM
Agent Lightning P1 non-regression
no duplicate infrastructure
```

- [ ] **Step 5: Fresh merge check**

Re-read main, exact implementation Head, authorization path digest, active overlaps, CI, and review. If main moved, use ordinary-history reconciliation only.

- [ ] **Step 6: Ordinary merge**

Read exact reviewed implementation Head into `reviewedHeadSha`; merge with `merge_method=merge` and `expected_head_sha=reviewedHeadSha`.

- [ ] **Step 7: Post-merge claim discipline**

Only after post-merge validation may Yance claim the governed mechanism:

```text
canonical production decision + stored bounded features
→ frontier Model Brain generation
→ eligible immutable source signal
→ immutable raw human outcomes with explicit windows/missingness
→ Learning-approved bound Score
→ OSS-trained bounded policy candidate
→ Regression/Shadow/explicit promotion
→ later production decision consumes promoted policy
→ fallback/rollback preserves availability and history
```

Do not claim personalization quality is already optimal. The landed mechanism is what enables longitudinal improvement.
