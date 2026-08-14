# Yance V2.1 Learned Policy Architecture Design

Status: **approved successor design — review-hardened**

This design supersedes the product meaning of `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1` and closed PR #367. It does not rewrite or invalidate landed Agent Lightning P1. It changes the product learning target.

## 1. Permanent product invariant

Yance must not spend its primary learning budget training a small local language model to compete with current frontier ChatGPT/Claude as the final reply generator.

> **Frontier models provide general intelligence and final language generation. Yance learns the person, the relationship, the relevant context, the communication strategy, the candidate preference, and the logical model/reasoning choice from real Decision → Outcome evidence.**

Normal production path:

```text
Conversation / relationship evidence
        ↓
Yance canonical state + learned policy
        ↓
context / memory / strategy / candidate / logical-model choice
        ↓
existing Model Brain / LiteLLM
        ↓
OpenAI / Anthropic frontier generator
        ↓
user-selected / user-approved final send
        ↓
real downstream human outcome
        ↓
Learning / Langfuse evidence
        ↓
new governed Yance policy candidate
```

A local model may later be separately authorized for a bounded classifier/ranker/state task, a training-pipeline fixture, or a future domain distillation challenger. It is not the default Yance reply brain.

## 2. Non-goals

This architecture does **not** authorize:

- a Yance-built LLM training framework;
- a second model/provider gateway or credential authority;
- a second memory, Person, relationship, Persona, or Journey store;
- a second trace/dataset/experiment/evaluation/reward platform;
- a Yance-built contextual-bandit/RL engine;
- automatic production policy promotion;
- autonomous final sending;
- raw private chat persistence for policy training;
- reward derived directly from latency, reply length, or a single behavioral proxy;
- a local Qwen reply generator as a production path;
- live randomized exploration in the first Learned Policy work package.

## 3. Existing authorities remain authoritative

### 3.1 Model Brain

Model Brain / LiteLLM remains the unique production model-execution and provider-credential authority. Learned Policy may choose only a bounded structured strategy or an already-authorized logical route. It may not call providers directly.

### 3.2 Learning

Learning remains canonical for:

- learning eligibility and DoNotLearn;
- privacy/minimization;
- experiment evidence;
- approved Langfuse Scores;
- Regression and Shadow;
- proposal/review status;
- explicit Promotion;
- Rollback.

A raw human outcome is evidence, not reward authority.

### 3.3 Identity, relationship, memory, Persona, and Journey

Existing Person/Contact authorities, Letta, Graphiti, Persona, Parlant, and current relationship projections remain authoritative. Learned Policy consumes bounded projections; it does not become a new source-of-truth database.

### 3.4 Existing OSS composition

- Langfuse + OpenTelemetry: trace/score/dataset/experiment evidence.
- DSPy + GEPA: prompt/program optimization.
- Promptfoo + existing Learning evaluation: regression/evaluation.
- OpenFeature + flagd: staged Learning rollout state.
- RouteLLM + LiteLLM: logical model routing where already authorized.
- Agent Lightning P1: dormant reusable bounded training execution infrastructure; not the product reply-model objective.

## 4. Learned Policy heads

Future independently authorized heads may include:

1. Relationship-state projection.
2. Context/memory selection.
3. Structured communication strategy.
4. Candidate ranking.
5. Logical Model Brain/reasoning routing.

The first implementation work package learns only the existing structured action:

```text
candidateStrategyBranch
```

It does not attempt to learn all heads at once.

## 5. Reuse / Retire / New matrix

| Capability | Decision |
|---|---|
| Frontier reply generation | REUSE Model Brain/LiteLLM |
| Provider credentials | REUSE Model Brain only |
| Person/contact binding | REUSE PersonContextAuthority/current identity authorities |
| Memory/relationship facts | REUSE Letta/Graphiti/current projections |
| Persona/Journey | REUSE Persona/Parlant |
| Trace/score/dataset/experiment | REUSE Langfuse/OTel |
| Prompt/program optimization | REUSE DSPy/GEPA |
| Regression/Shadow | REUSE Promptfoo/Learning evaluation |
| Promotion/Rollback | REUSE Learning/OpenFeature/flagd |
| Agent Lightning P1 | REUSE dormant, only for later bounded need |
| Local reply-model P2 | RETIRE as product goal |
| DecisionRecordV1 | NEW thin causal contract |
| OutcomeVectorV1 | NEW thin causal contract |
| Decision↔Outcome attribution | NEW thin adapter over existing events/signals |
| First bounded policy learner | ADOPT Vowpal Wabbit after exact OSS-fit/source closure |
| Policy consumption | NEW thin adapter at existing reply Brain seam |

No new Yance infrastructure may enter authorization unless V2.1 OSS-fit proves a real gap.

## 6. Canonical causal event topology

The first Learned Policy loop deliberately reuses the existing immutable Learning ledger instead of inventing a mutable approval store.

```text
production decision
      ↓
existing eligible decision-bearing source signal
(candidate_sent / other explicitly authorized eligible source)
      │
      ├──────────────┐
      ↓              ↓
DecisionRecordV1   raw OutcomeVectorV1 observations
(inside source       (`policy_outcome_observed`, permanently
 signal evidence)     learningEligible=false)
      │              │
      └──────┬───────┘
             ↓
Learning attribution / Langfuse Score
             ↓
approved score keyed to eligible sourceSignalId
and bound to exact decisionId + outcomeIds
             ↓
`projectPolicy` starts from eligible source signal,
joins immutable raw outcomes by decisionId,
then emits a read-only training row
```

### 6.1 Immutable-ledger rule

A raw `policy_outcome_observed` ledger row is **never mutated from `learningEligible=false` to true**. Its non-trainable status is permanent evidence semantics.

The trainable anchor is an existing immutable source signal that was eligible at production time and carries the exact DecisionRecord provenance. A Learning-approved Score is keyed to that eligible `sourceSignalId` under the existing score-subject rules and additionally binds to:

```text
decisionId
outcomeIds[]
outcomeEvidenceSetRef
rewardPolicyVersion
```

`projectPolicy` must not pretend the raw outcome row itself became eligible. It must:

1. query eligible decision-bearing source signals;
2. validate their DecisionRecord;
3. find immutable raw OutcomeVector observations for the same canonical decision/person/conversation;
4. require the Learning-approved Score for the eligible source signal;
5. verify that the Score's `decisionId/outcomeIds/outcomeEvidenceSetRef` identify exactly the joined evidence set;
6. emit the read-only learner row.

This keeps the existing immutable ledger semantics intact and avoids a second approval-state machine.

## 7. Canonical `DecisionRecordV1`

Every production decision that may later be learned from is recorded when the action is chosen, before final frontier generation.

### 7.1 Identity namespace and valid scope

P1 supports only conversation-scoped reply decisions:

```text
scopeType = "conversation"
scopeId   = conversationId
```

Every decision also requires:

- `conversationId` equal to `scopeId`;
- canonical `contactId` participating in that conversation;
- canonical `personId` resolved by existing `PersonContextAuthority` for the contact/conversation pair;
- `personaProfileId` from the exact Persona context used for generation.

Before persistence, context compilation, or Learning projection, existing authorities must prove:

```text
PersonContextAuthority.resolve({contactId, conversationId}).found == true
resolved.personId == decision.personId
resolved.contactIds contains decision.contactId
resolved.conversationIds contains decision.conversationId
decision.scopeType == "conversation"
decision.scopeId == decision.conversationId
personaProfileId matches the Persona context used for generation
```

Any mismatch is a hard contract rejection. No best-effort cross-profile or cross-contact repair is permitted inside Learned Policy.

### 7.2 Replayable bounded feature bundle

A hash alone is not enough. The learner must have the exact safe features that the behavior policy saw in production without recomputing them from later mutable relationship state.

`DecisionRecordV1` therefore carries an immutable `featureBundle` under a fixed `featureSchemaVersion`.

P1 `featureBundle` rules:

- fixed allowlist of bounded categorical/numeric/boolean fields only;
- no free-form chat text;
- no raw memory text;
- no message bodies;
- no provider credentials;
- no arbitrary extension object;
- values must already satisfy existing privacy/minimization policy for Learning;
- every field has a deterministic encoding defined by `featureSchemaRef`.

The exact P1 field allowlist is frozen in the product authorization/test contract after fresh-main inspection of existing state authorities. It may include only fields already present in authorized relationship/interaction/persona projections and required for the first `candidateStrategyBranch` policy.

The DecisionRecord requires:

- `featureBundle` — immutable safe bytes/object persisted with the decision-bearing eligible source signal;
- `featureSchemaVersion`;
- `featureSchemaRef` — exact immutable schema identity;
- `stateSnapshotRef` — SHA-256 of canonical serialized `featureBundle` bytes;
- `contextCandidateSetRef` — digest/reference for the bounded context/memory candidate IDs available at decision time;
- `actionSetRef` — digest/reference for available actions and their encoding/order;
- `decisionTraceId` — trace identity bound to the same bundle;
- `stateVersion`, `strategyVersion`, `promptProgramVersion`.

Training and replay consume the stored `featureBundle`; they never regenerate historical features from current state.

No new generic serialization framework is authorized. Product implementation must first reuse an existing trusted canonical-serialization seam. If fresh-main inspection proves none exists, that is an OSS-fit/authorization boundary, not permission to silently build one.

### 7.3 Explicit contributing policy versions

Every policy head that materially produced the action has an explicit version, including baseline/rule-based heads:

```text
relationshipPolicyVersion
memoryPolicyVersion
strategyPolicyVersion
candidateRankerVersion
routingPolicyVersion
promptProgramVersion
```

A baseline component uses an explicit stable identity such as `baseline-rules-v1`; absence is never interpreted as baseline.

### 7.4 Contextual-bandit behavior logging

For any DecisionRecord eligible for Vowpal Wabbit training or off-policy evaluation, record at decision time:

- `actionId` — stable chosen-action ID;
- `actionEncodingVersion` — ADF action-row encoding version;
- `allowedActionSet` — exact bounded action set seen by the behavior policy;
- `actionSetRef` — immutable identity of that encoded set;
- `chosenAction` — structured `{kind, value}`;
- `behaviorPolicyVersion` — exact policy that chose it;
- `actionProbability` — original behavior-policy propensity for the chosen action;
- `exploration` — whether stochastic exploration was active.

Propensity is never reconstructed later from a newer policy.

Missing/out-of-range propensity, missing action identity/encoding, or out-of-set action makes the row ineligible for contextual-bandit training and OPE.

P1 uses no live randomized exploration. Deterministic baseline/production decisions record `actionProbability=1.0` and `exploration=false`. This truthfully records the executed behavior and does not claim counterfactual support for unchosen actions.

### 7.5 Required DecisionRecord envelope

```text
schemaVersion
authority
decisionId
sourceSignalId (when immutable eligible source signal exists)
scopeType
scopeId
contactId
personId
conversationId
personaProfileId
featureBundle
featureSchemaVersion
featureSchemaRef
stateSnapshotRef
contextCandidateSetRef
actionSetRef
decisionTraceId
stateVersion
relationshipPolicyVersion
memoryPolicyVersion
strategyPolicyVersion
candidateRankerVersion
routingPolicyVersion
promptProgramVersion
actionId
actionEncodingVersion
allowedActionSet
chosenAction
behaviorPolicyVersion
actionProbability
exploration
modelLogicalRoute
createdAt
rawPrivateChatPersisted = false
```

## 8. Canonical `OutcomeVectorV1`

A downstream human event is a causally bound observation envelope, not a loose bag of booleans.

### 8.1 Required envelope

```text
schemaVersion
authority
outcomeId
decisionId
sourceSignalId
scopeType
scopeId
contactId
personId
conversationId
observedAt
observationWindow
signals
learningEligible = false
rawPrivateChatPersisted = false
```

The identity tuple must resolve to the same canonical Person/Contact/Conversation binding as the DecisionRecord and source signal. A mismatch is rejected before persistence or Learning projection.

`outcomeId` is immutable/idempotent for the source observation. Outcomes without an unambiguous decision binding never become policy-learning evidence.

### 8.2 Per-signal provenance, window, and missingness

Each signal is represented as:

```text
value
status = observed | pending | unavailable | not_applicable
observedAt
windowStart
windowEnd
sourceType
sourceId
provenanceRef
```

`false`, `0`, `pending`, and `unavailable` are distinct.

Examples:

- reply latency is observed when a bound inbound reply arrives;
- conversation continuation may be observed in that immediate window;
- next-day reinitiation remains `pending` until its own defined window closes;
- privacy exclusion or unavailable platform history becomes `unavailable`, not negative.

A later window creates a new immutable outcome observation/version. Earlier evidence is not mutated to pretend later information existed earlier.

### 8.3 Initial allowed outcome families

When evidence exists, future observations may represent:

- reply latency;
- reply length / length delta;
- conversation continuation;
- new topic initiation;
- returned question;
- later reinitiation;
- user accepted/edited/rejected candidate;
- relationship-state delta;
- explicit user feedback.

No single signal is intrinsically reward.

## 9. Reward/evaluation is a separate versioned artifact

```text
eligible source signal + DecisionRecordV1
                 +
immutable OutcomeVectorV1 observation(s)
                 ↓
Learning evaluation/attribution
                 ↓
Learning-approved Langfuse Score
                 ↓
projectPolicy training row
```

The approved score preserves existing canonical subject/provenance rules and binds to the exact decision/outcome evidence set with `rewardPolicyVersion`.

Learned Policy must not:

- treat reply arrival as automatic positive reward;
- map silence to negative reward;
- invent missing signals;
- mutate raw outcome eligibility;
- aggregate multiple relationships absent separately authorized canonical global eligibility;
- clip/normalize/weight a Learning-approved scalar inside the policy adapter without a separately versioned Learning rule.

For a learner that minimizes cost, a finite already-approved scalar reward may be represented mechanically as `cost=-reward`; the sign conversion grants no reward-shaping authority.

## 10. First OSS learner: Vowpal Wabbit

Selected P1 candidate under V2.1 OSS-fit:

```text
repository: VowpalWabbit/vowpal_wabbit
release: 9.11.2
commit: 122bae254a5b8bc2b774d13b33d53e6dbc2cfba7
license: BSD-3-Clause
mode: contextual-bandit ADF
```

VW must run inside the existing sealed Learning Python runtime. It does not create another daemon, dataset service, provider gateway, credential store, scheduler, or policy store.

P1 proves:

```text
eligible source signal + stored DecisionRecord
+ joined immutable raw outcomes
+ Learning-approved score
→ bounded VW policy candidate
→ existing Regression/Shadow
→ explicit Learning promotion
→ later production decision consumes promoted bounded action
→ Model Brain still writes final reply
→ rollback/fallback preserves availability
```

## 11. Production consumption boundary

Learned policy is consumed before final frontier reply generation:

```text
existing canonical relationship/persona/memory context
        ↓
existing candidate plan / allowed branch set
        ↓
build bounded privacy-safe featureBundle
        ↓
resolve active Learning-promoted policy artifact
        ↓
choose one allowed candidateStrategyBranch
        ↓
create immutable DecisionRecordV1
        ↓
apply existing branch/strategy composition
        ↓
existing Model Brain / LiteLLM call
        ↓
frontier-generated reply candidate
```

The policy adapter may not generate reply text.

If no promoted policy exists, existing baseline rules remain active and all baseline policy versions are explicit in the DecisionRecord.

## 12. Failure semantics

### 12.1 No promoted policy

Use existing baseline policy, record explicit baseline versions, continue frontier generation.

### 12.2 Active artifact corrupt/hash-invalid/unreadable/out-of-set

Do not use it. Fall to a previously verified last-known-good promoted policy when existing rollout history provides one; otherwise use explicit baseline. Emit degradation evidence and record the policy that actually executed. The broken artifact may not masquerade as successful learned execution.

### 12.3 Identity/scope mismatch

Hard block the affected DecisionRecord persistence, Learning projection, and learned-policy context compilation. Do not reinterpret identifiers or cross-bind profiles. Reply may continue only after fresh canonical context resolution and creation of a new valid baseline decision.

### 12.4 Ineligible private content or minimization denial

Hard block that content from Learning projection and any learned feature/provider-bound context derived from it. Broader reply generation may continue only with independently authorized privacy-safe context.

### 12.5 Missing/late outcome evidence

Preserve reply availability. Mark signals `pending` or `unavailable`; exclude rows from training/evaluation that require missing observations. Never convert absence to negative reward.

### 12.6 Learning runtime unavailable

No automatic promotion. Production strategy uses last-known-good/baseline with degradation evidence. Provider generation remains with Model Brain.

## 13. Privacy boundary

Mandatory properties:

- raw private chat is not persisted merely for policy training;
- DoNotLearn is enforced before eligible source-signal persistence/projection;
- Decision/Outcome references cannot escape canonical Person/Contact/Conversation scope;
- `featureBundle` is allowlisted and contains no raw/private free text;
- ineligible memories never enter provider-bound requests through Learned Policy;
- an independently eligible bounded field may survive while an adjacent ineligible private field is omitted;
- no provider credential enters Learning/VW runtime;
- no policy artifact is designed to contain unminimized raw data.

Provider-bound privacy is tested at the actual final request construction seam, not only by source scanning.

## 14. Promotion and rollback

Training output is always a candidate artifact:

```text
canonical Learning projection
→ OSS policy candidate
→ existing Learning proposal
→ Regression
→ Shadow
→ READY_FOR_REVIEW
→ explicit Learning approval
→ existing rollout/OpenFeature/flagd metadata
→ production policy adapter
```

No candidate trains itself into production.

Rollback changes the active policy version and preserves historical Decision/Outcome/source-signal evidence.

## 15. First implementation work package

`V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`

Bounded scope:

1. canonical identity-bound DecisionRecordV1;
2. stored safe replayable featureBundle + exact action/propensity log;
3. immutable raw OutcomeVectorV1 observations;
4. existing eligible source signal as the trainable anchor;
5. Learning-approved score bound to sourceSignalId + decisionId + outcomeIds;
6. `projectPolicy` joins these without mutating the ledger;
7. one VW-backed `candidateStrategyBranch` policy head;
8. consumption before frontier generation;
9. existing Regression/Shadow/Promotion/Rollback;
10. one real closed-loop UAT.

It does not add context ranker, candidate ranker, full router learning, or RL in the same authorization.

## 16. Acceptance criteria

The work package is not complete unless executable tests prove all of the following:

1. Final reply text comes from existing Model Brain/LiteLLM frontier execution.
2. A production turn chooses policy and creates DecisionRecordV1 before final generation.
3. Person/contact/conversation/persona identity is canonically bound; a two-person/two-profile collision cannot cross-bind evidence.
4. `featureBundle` is fixed-schema, stored, privacy-safe, free of raw chat/memory text, and content-addressed.
5. Historical training/replay uses the stored featureBundle, not current relationship state.
6. Every contributing policy head has an explicit version.
7. VW-eligible decisions contain stable action ID, exact action-set encoding/ref, original behavior-policy version, and original propensity.
8. Missing/invalid propensity makes a row ineligible rather than guessed later.
9. The decision-bearing eligible source signal is immutable and includes exact DecisionRecord provenance.
10. Raw `policy_outcome_observed` remains permanently `learningEligible=false`.
11. A real successful send is bound to the originating decision/source signal.
12. A later human response produces an OutcomeVectorV1 with immutable ID, canonical identity, window, provenance, and missingness.
13. A delayed metric is `pending` until its window closes; silence/no evidence is not negative reward.
14. Learning-approved Score is separate and binds to exact `sourceSignalId + decisionId + outcomeIds + outcomeEvidenceSetRef + rewardPolicyVersion`.
15. `projectPolicy` starts from eligible source signals, joins immutable raw outcomes, verifies the Score binding, and never mutates ledger eligibility.
16. Ineligible private memory is absent/rejected at the actual provider-bound request while an eligible bounded field remains usable.
17. DoNotLearn/minimization failures exclude learning content without blocking unrelated privacy-safe reply generation.
18. VW source/version/license/lock/SBOM are exact and reproducible.
19. No provider credential exists in Learning/VW runtime.
20. A trained policy is candidate-only until existing Regression + Shadow + explicit Promotion succeed.
21. A later production turn consumes the promoted bounded action before Model Brain generation.
22. Corrupt active artifact falls to last-known-good/baseline and emits degradation evidence.
23. Rollback restores previous/baseline policy without rewriting history.
24. Agent Lightning P1 remains unchanged.
25. No local reply-model production path is introduced.
26. No second Yance learning/database/router/eval/reward/provider framework is introduced.

## 17. Future successor worklines

Only after this canonical loop proves real may later work packages independently OSS-fit and authorize richer context selection, candidate ranking, learned logical routing, relationship-state estimators, explicit exploration/OPE, Agent Lightning RL for a bounded head, or later frontier-to-local domain distillation.

Every successor must reuse the same canonical Decision/source-signal/Outcome/Score topology instead of inventing another learning loop.

## 18. Permanent product truth

> **ChatGPT/Claude remain the general intelligence and final-language engines. Yance becomes increasingly useful because it learns, under privacy and evaluation controls, which relationship context, strategy, candidate, and logical model choice works for this person and this relationship.**

The durable moat is governed longitudinal Decision → Outcome evidence and policy improvement, not a low-end clone of a frontier model.
