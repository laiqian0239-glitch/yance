# Yance V2.1 Learned Policy Architecture Design

Status: **approved successor design — review-hardened**

This design supersedes the product meaning of `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1` and closed PR #367. It does not rewrite or invalidate the already-landed Agent Lightning P1 infrastructure. It changes what Yance is trying to learn.

## 1. Product invariant

Yance must not spend its primary learning budget training a small local language model to compete with current frontier ChatGPT/Claude as the final reply generator.

The permanent product invariant is:

> **Frontier models provide general intelligence and final language generation. Yance learns the person, the relationship, the relevant context, the communication strategy, the candidate preference, and the logical model/reasoning choice from real Decision → Outcome evidence.**

The normal production path is therefore:

```text
Conversation / relationship evidence
        ↓
Yance state + learned policy
        ↓
context / memory / strategy / candidate / logical model choice
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

A local model may later be authorized for a bounded classifier/ranker/state task, a pipeline fixture, or a future domain distillation challenger. It is not the default Yance reply brain.

## 2. Non-goals

This architecture does **not** authorize:

- a Yance-built LLM training framework;
- a second model/provider gateway;
- a second memory or relationship database;
- a second experiment/dataset platform;
- a second telemetry/score framework;
- a Yance-built contextual-bandit/RL engine;
- automatic production policy promotion;
- autonomous final sending;
- raw private chat persistence in training records;
- reward derived directly from reply latency, reply length, or another single behavioral proxy;
- local Qwen reply generation as a production fallback introduced by this workline;
- live randomized exploration in the first policy work package.

## 3. Existing authorities that remain unchanged

### 3.1 Model Brain

Model Brain / LiteLLM remains the unique production model execution/provider credential authority. Learned Policy may choose only a bounded logical route or strategy input that Model Brain accepts; it may not call OpenAI, Anthropic, Gemini, OpenRouter, Ollama, or another provider directly.

### 3.2 Learning

Learning remains canonical for:

- learning eligibility;
- DoNotLearn/privacy policy;
- minimization;
- experiment evidence;
- approved Langfuse Score evidence;
- candidate evaluation;
- Regression;
- Shadow;
- explicit Promotion;
- Rollback.

A raw human outcome is evidence, not reward authority.

### 3.3 Relationship and memory authorities

Letta, Graphiti, Person/Contact authority, Persona, Parlant, and existing relationship projections remain authoritative for their current domains. Learned Policy consumes bounded immutable projections; it does not become a new source-of-truth database.

### 3.4 Existing optimization/evaluation OSS

- Langfuse + OpenTelemetry: trace/score/dataset/experiment evidence.
- DSPy + GEPA: prompt/program optimization.
- Promptfoo + existing Learning evaluation: regression/evaluation.
- OpenFeature + flagd: staged Learning rollout state.
- RouteLLM + LiteLLM: logical model routing where already authorized.
- Agent Lightning P1: dormant reusable bounded training execution infrastructure; no product reply-model objective.

## 4. Learned Policy heads

Yance may evolve several policy heads, each independently versioned and authorized:

1. **Relationship State projection** — bounded relationship/interaction state useful to decisions.
2. **Context/Memory Selector** — which already-authorized memory/evidence references should enter this reply.
3. **Structured Strategy Policy** — initiative, warmth, brevity, directness, question policy, and existing candidate strategy branch.
4. **Candidate Ranker** — rank frontier-generated reply candidates for this user/relationship.
5. **Logical Model/Reasoning Router** — select an allowed Model Brain logical route/tier.

The first implementation work package deliberately learns only one existing structured action dimension:

```text
candidateStrategyBranch
```

It does not attempt to learn all heads at once.

## 5. Reuse / Retire / New matrix

| Capability | Decision |
|---|---|
| Frontier reply generation | REUSE Model Brain/LiteLLM |
| Provider credentials | REUSE Model Brain only |
| Memory/relationship facts | REUSE Letta/Graphiti/Person authorities |
| Persona/Journey | REUSE Persona/Parlant |
| Trace/score/dataset | REUSE Langfuse/OTel |
| Prompt/program optimization | REUSE DSPy/GEPA |
| Regression/Shadow | REUSE Promptfoo/Learning evaluation |
| Promotion/Rollback | REUSE Learning/OpenFeature/flagd |
| Agent Lightning P1 | REUSE dormant, only for later bounded need |
| Local reply-model P2 | RETIRE as product goal |
| DecisionRecord | NEW thin causal contract |
| OutcomeVector | NEW thin causal contract |
| Decision↔Outcome binding | NEW thin adapter over existing events/signals |
| First bounded policy learner | ADOPT mature OSS after OSS-fit |
| Policy consumption | NEW thin adapter at existing reply Brain seam |

No new Yance infrastructure may enter an authorization unless V2.1 OSS-fit proves there is a real gap.

## 6. Canonical `DecisionRecordV1`

Every production decision that may later be learned from must be recorded at the moment the action is chosen, before final frontier generation.

### 6.1 Identity namespace and valid scope

The first work package supports only conversation-scoped reply decisions:

```text
scopeType = "conversation"
scopeId   = conversationId
```

Every persisted decision must also bind to:

- `conversationId` — required and exactly equal to `scopeId`;
- `contactId` — required canonical Contact participating in that conversation;
- `personId` — required canonical Person resolved by existing `PersonContextAuthority` for that `contactId`/`conversationId` pair;
- `personaProfileId` — required user Persona profile whose style/identity was used for the decision.

Before persistence, context compilation, or Learning projection, existing identity authorities must prove all of the following:

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

This prevents two contacts/profiles with colliding conversation-looking identifiers from sharing learning evidence.

### 6.2 Replayable immutable state bundle

A production decision must be replayable against the exact bounded state that produced it. Mutable state row IDs alone are insufficient.

`DecisionRecordV1` therefore requires:

- `stateSnapshotRef` — SHA-256/content-addressed reference to the bounded decision-state projection bytes;
- `stateSnapshotSchemaVersion` — schema version for those bytes;
- `featureSchemaRef` — content-addressed or exact immutable feature schema identity;
- `contextCandidateSetRef` — immutable digest/reference for the available bounded context/memory candidate IDs;
- `actionSetRef` — immutable digest/reference for the available actions and their encoding/order;
- `decisionTraceId` — trace identity that resolves to the same immutable bundle;
- existing `stateVersion`, `strategyVersion`, and `promptProgramVersion`.

The decision also records explicit version references for every policy head that materially produced the chosen action, even when that head is still baseline/rule-based:

```text
relationshipPolicyVersion
memoryPolicyVersion
strategyPolicyVersion
candidateRankerVersion
routingPolicyVersion
```

A baseline component uses an explicit stable identifier such as `baseline-rules-v1`; absence is not interpreted as baseline.

### 6.3 Contextual-bandit action logging contract

For any DecisionRecord eligible for Vowpal Wabbit contextual-bandit training or off-policy evaluation, the following are mandatory at decision time:

- `actionId` — stable identifier of the chosen action;
- `actionEncodingVersion` — schema/version defining how action IDs map to the ADF action rows;
- `allowedActionSet` — exact bounded set seen by the behavior policy;
- `actionSetRef` — immutable digest/reference for the encoded action set;
- `chosenAction` — structured action `{kind, value}`;
- `behaviorPolicyVersion` — the exact policy that made the production choice;
- `actionProbability` — the behavior-policy propensity for that exact chosen action, recorded at decision time.

The propensity must never be reconstructed later from a newer model or normalized retrospectively.

A row missing any of these fields, containing an out-of-set action, or containing nonfinite/out-of-range propensity is **ineligible for contextual-bandit training and off-policy evaluation**.

P1 production is deterministic and does not introduce live random exploration, so deterministic baseline/production actions use `actionProbability = 1.0` and explicitly record `exploration = false`. This is valid provenance for the behavior actually executed; it does not imply broad counterfactual support.

### 6.4 Required DecisionRecord envelope

Conceptual v1 shape:

```text
schemaVersion
authority
decisionId
scopeType
scopeId
contactId
personId
conversationId
personaProfileId
stateSnapshotRef
stateSnapshotSchemaVersion
featureSchemaRef
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

The record contains hashes/references and bounded structural features. It does not persist raw private chat text merely to support learning.

## 7. Canonical `OutcomeVectorV1`

A downstream human event must never be stored as a loose bag of booleans. Each OutcomeVector is a causally bindable observation envelope.

### 7.1 Required outcome envelope

Every outcome record requires:

```text
schemaVersion
authority
outcomeId
decisionId
scopeType
scopeId
contactId
personId
conversationId
observedAt
observationWindow
signals
rawPrivateChatPersisted = false
```

The identity tuple must resolve to the same canonical Person/Contact/Conversation binding as the DecisionRecord. A mismatch is rejected before persistence or Learning projection.

`outcomeId` is immutable/idempotent for the source observation. `decisionId` is mandatory; outcomes without an unambiguous decision binding do not become policy-learning rows.

### 7.2 Per-signal provenance, window, and missingness

Each signal is represented as a structured observation:

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

`value=false`, `value=0`, `status=pending`, and `status=unavailable` are distinct states.

Examples:

- `replyLatencyMs` can be observed once a reply arrives and is tied to the sent message and inbound message IDs.
- `conversationContinued` may be observed in the immediate reply window.
- `nextDayReinitiation` cannot be evaluated at the same timestamp; before its defined window closes it is `pending`, not `false`.
- If platform history is unavailable or privacy policy excludes the evidence, status is `unavailable`, not negative.

P1 may emit a partial OutcomeVector immediately when an inbound reply arrives and later append a new immutable outcome observation/version for a different closed window. It must not mutate earlier evidence to pretend the later signal existed at the earlier timestamp.

### 7.3 Initial outcome signals

The architecture allows, when evidence exists:

- reply latency;
- reply length / length delta;
- conversation continued;
- new topic initiated;
- returned question;
- later reinitiation;
- user accepted candidate;
- user edited candidate;
- user rejected candidate;
- relationship-state delta;
- explicit user feedback.

No single signal is intrinsically the reward.

## 8. Reward/evaluation remains a separate versioned artifact

Outcome observation and reward attribution are separate contracts.

```text
DecisionRecordV1
     +
OutcomeVectorV1 observation(s)
     ↓
Learning evaluation/attribution
     ↓
Learning-approved Langfuse Score
     ↓
policy training projection
```

The approved score record must preserve its existing canonical subject/provenance rules and additionally identify the decision/outcome evidence set it evaluates.

Learned Policy must not:

- treat reply arrival as automatic positive reward;
- map silence to negative reward;
- invent missing signals;
- aggregate multiple relationships into one reward unless separately authorized by canonical global Learning eligibility;
- clip/normalize/weight a Learning-approved scalar inside a policy adapter without a separately versioned Learning rule.

For a learner such as VW that minimizes cost, an authorized adapter may mechanically represent a finite approved scalar reward as `cost = -reward`; that sign conversion does not grant authority to reshape the reward.

## 9. First OSS learner: Vowpal Wabbit candidate

The first bounded strategy-policy learner is selected through V2.1 OSS-fit as Vowpal Wabbit rather than a Yance-built contextual-bandit engine.

Frozen source candidate:

```text
repository: VowpalWabbit/vowpal_wabbit
release: 9.11.2
commit: 122bae254a5b8bc2b774d13b33d53e6dbc2cfba7
license: BSD-3-Clause
mode: contextual-bandit ADF
```

The implementation must place VW inside the existing sealed Learning Python runtime. It does not create a new daemon, dataset service, model gateway, credential store, or scheduler.

P1 does not enable live random exploration. It first proves:

```text
historical canonical decision/outcome/approved-score rows
→ bounded VW policy candidate
→ existing Regression/Shadow
→ explicit Learning promotion
→ later production decision consumes promoted bounded action
→ Model Brain still writes final reply
→ rollback restores prior/baseline policy
```

## 10. Production consumption boundary

The learned policy must be consumed before final frontier reply generation.

Existing high-level sequence becomes:

```text
existing relationship/persona/memory context
        ↓
existing candidate plan / allowed branch set
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

If no promoted policy exists, the existing baseline rules remain active and the DecisionRecord explicitly records the baseline policy version.

## 11. Failure semantics

Failure behavior is intentionally different for safety violations, active-artifact corruption, and missing learning evidence.

### 11.1 No promoted learned artifact

Normal condition, not an error:

```text
use existing baseline policy
record explicit baseline policy versions
continue frontier reply generation
```

### 11.2 Active learned artifact is corrupt, hash-invalid, unreadable, or returns an out-of-set action

The active learned artifact must not be used. The policy layer fails closed to a **previous explicitly recorded last-known-good promoted policy** when one exists; otherwise it uses the explicit baseline policy. The event is surfaced as policy-runtime degradation evidence.

It may not silently claim the broken artifact was executed.

This preserves reply availability because the learning-policy artifact is advisory to reply strategy, not provider/safety authority.

### 11.3 Decision identity/scope mismatch

Hard block the affected DecisionRecord persistence, Learning projection, and learned-policy context compilation. Do not reinterpret the identifiers or bind across profiles.

If this mismatch is detected before the reply policy choice, the learned-policy path is unavailable for that turn. The existing safe baseline reply path may continue only with freshly resolved canonical context and a new valid DecisionRecord; it may not reuse the invalid record.

### 11.4 Ineligible private content or minimization denial

Hard block that content from Learning projection and from any learned-policy feature/provider-bound context derived from it. Privacy denial cannot be converted into a missing/default feature that leaks the original value.

The broader reply may continue only with the already-authorized privacy-safe context that independently passes existing provider-boundary rules.

### 11.5 Missing/late outcome evidence

Preserve reply availability. Mark the relevant signal `pending` or `unavailable`; exclude the row from any training/evaluation that requires the missing observation. Never convert absence to negative reward.

### 11.6 Learning runtime unavailable

No automatic promotion occurs. For production reply policy consumption, use last-known-good/baseline strategy according to 11.2 and record degradation. Provider generation remains with Model Brain.

## 12. Privacy boundary

The canonical learning data should prefer identifiers, hashes, versions, bounded features, and minimized content references.

Mandatory properties:

- raw private chat is not persisted merely for policy training;
- DoNotLearn is enforced before Learning persistence/projection;
- decision/outcome references cannot escape canonical person/contact/conversation scope;
- ineligible private memories never enter provider-bound requests through Learned Policy;
- an eligible bounded field may survive while an adjacent ineligible private field is omitted;
- policy learner/provider credentials are prohibited from Learning runtime;
- no policy model artifact may contain a hidden copy of unminimized raw data by design.

Provider-bound privacy is tested at the actual message/request construction seam, not only by source scanning.

## 13. Promotion and rollback

Training output is always a candidate artifact.

Required chain:

```text
canonical Learning projection
→ OSS policy candidate
→ existing Learning proposal
→ Regression
→ Shadow
→ READY_FOR_REVIEW
→ explicit Learning approval
→ OpenFeature/flagd rollout metadata
→ production policy adapter
```

No candidate trains itself into production.

Rollback uses the existing Learning rollback authority and preserves historical Decision/Outcome evidence. A rollback changes the active policy version; it does not rewrite the historical policy version recorded on old decisions.

## 14. First implementation work package

The first executable successor is:

`V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`

It is intentionally bounded to:

1. DecisionRecordV1 identity/replayability/behavior-policy logging;
2. OutcomeVectorV1 causal envelope and observation semantics;
3. canonical Learning projection with existing approved score authority;
4. one VW-backed `candidateStrategyBranch` policy head;
5. consumption before frontier generation;
6. existing Regression/Shadow/Promotion/Rollback;
7. one real closed-loop UAT.

It does not add context ranker, candidate ranker, full router learning, or RL in the same authorization.

## 15. Acceptance criteria

The work package is not complete unless all of the following are proven executable:

1. Final reply text still comes from existing Model Brain/LiteLLM frontier execution.
2. A production turn creates `DecisionRecordV1` before final reply generation.
3. `scopeType/scopeId/contactId/personId/conversationId/personaProfileId` are validated as one canonical identity bundle before persistence.
4. A two-profile/two-person collision test proves the same-looking conversation/contact references cannot cross-bind Learning evidence.
5. Decision state and feature schema are immutable/content-addressed; historical decision replay cannot resolve to a newer mutable state.
6. Every policy head that influenced the action has an explicit version, including baseline heads.
7. VW-eligible records contain stable action ID, immutable action-set encoding/ref, original behavior-policy version, and original propensity.
8. Missing/invalid propensity makes a row ineligible for CB training/OPE rather than guessed later.
9. A real successful send is bound to the originating decision.
10. A later inbound human response creates an `OutcomeVectorV1` with `outcomeId`, `decisionId`, canonical identity, observation window, and per-signal provenance/missingness.
11. A next-day or delayed metric is `pending` until its own window closes and is never silently `false` early.
12. Silence/no evidence is not negative reward.
13. Raw OutcomeVector does not contain `approvedReward` authority.
14. Learning-approved Langfuse Score remains a separate versioned attribution artifact.
15. Ineligible private memory is absent/rejected at the actual provider-bound request while an eligible bounded field remains usable.
16. DoNotLearn/minimization failures exclude learning content without blocking unrelated privacy-safe reply generation.
17. VW source/version/license/lock/SBOM are exact and reproducible.
18. No provider credential exists in Learning/VW runtime.
19. A trained policy is only a candidate until existing Regression + Shadow + explicit Promotion succeed.
20. A later production turn consumes the promoted bounded action before Model Brain generation.
21. Corrupt active artifact fails to last-known-good/baseline and produces degradation evidence; it cannot masquerade as successful learned execution.
22. Rollback restores previous/baseline policy without rewriting historical evidence.
23. Agent Lightning P1 remains unchanged.
24. No local reply-model production path is introduced.
25. No second Yance learning/database/router/eval/reward/provider framework is introduced.

## 16. Future successor worklines

Only after the canonical Decision→Outcome seam proves real may later work packages independently OSS-fit and authorize:

- richer context/memory selection;
- candidate ranking/preference models;
- learned logical Model Brain routing;
- relationship-state estimators;
- explicit exploration/counterfactual evaluation policy;
- Agent Lightning RL for a bounded policy head where it outperforms simpler OSS;
- later frontier-to-local domain distillation after enough high-quality Yance-specific data exists.

Each successor must reuse the same canonical decision/outcome/evaluation authority instead of inventing another learning loop.

## 17. Permanent product truth

The target product statement is:

> **ChatGPT/Claude remain the general intelligence and final-language engines. Yance becomes increasingly useful because it learns, under privacy and evaluation controls, which relationship context, strategy, candidate, and logical model choice works for this person and this relationship.**

The moat is the governed longitudinal Decision → Outcome evidence and policy improvement, not a low-end clone of a frontier model.
