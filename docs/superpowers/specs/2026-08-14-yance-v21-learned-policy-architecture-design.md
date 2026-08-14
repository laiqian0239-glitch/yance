# Yance V2.1 Learned Policy Architecture Design

Status: **approved successor design**

This design supersedes the product meaning of `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1` and PR #367. It does not rewrite or invalidate already-landed Agent Lightning P1 infrastructure; it changes what Yance is trying to learn.

## 1. Product objective

Yance must learn and grow **on top of frontier generators**, not by replacing them with a lower-capability local reply model.

The durable invariant is:

> OpenAI / Anthropic frontier models provide general intelligence and final language generation. Yance Learning learns the person, the relationship, the relevant context, the communication strategy, candidate preference and model/reasoning choice from real Decision → Outcome evidence.

The intended production loop is:

```text
Conversation / Relationship / Persona / Memory
        ↓
Canonical Decision State
        ↓
Yance Learned Policy
        ↓
context / memory / strategy / candidate / logical model choice
        ↓
Existing Model Brain
        ↓
OpenAI / Anthropic frontier generator
        ↓
reply candidate
        ↓
user chooses / edits / sends
        ↓
real human outcome
        ↓
Canonical Learning evidence
        ↓
policy/program update
```

Yance does not need to outperform frontier models at general text generation. Its defensible value is long-term, relationship-specific decision quality built from private, provenance-backed outcomes that general frontier providers do not own.

## 2. Non-goals

This workline does **not** authorize:

- training Qwen2.5-1.5B, Qwen3-8B, 14B or another local LLM as Yance's primary final reply generator;
- a second provider gateway, model router or credential authority;
- a second memory system, relationship graph, Journey engine or Persona authority;
- a second experiment platform, dataset platform, telemetry system, reward framework or generic evaluator;
- a Yance-built RL trainer, prompt optimizer, feature store, model registry or policy-serving framework;
- replacing user control over final send;
- automatic policy promotion from raw outcome signals;
- treating fast replies, long replies or any single behavioral signal as self-evidently positive reward;
- implementing every future policy head in one work package.

## 3. Existing architecture to reuse

The current code already contains the right product seams.

`contextAwareReplyBrain` already reasons over relationship state, emotional trend, preferences, interaction policy, reply strategy, relevant memories, director style weights, candidate branches, bounded question policy and other structured decision inputs. The successor should make these decision surfaces learnable and versioned rather than build another reply engine.

The current Learning stack already provides important authorities and OSS foundations:

- Langfuse + OpenTelemetry for trace/evidence/dataset/score/experiment semantics;
- DSPy + GEPA for program/prompt/context optimization;
- Promptfoo and Learning evaluation for regression/benchmark/shadow evidence;
- Learning proposal / evaluation / promotion / rollback seams;
- Letta for long-term memory/agent state;
- Graphiti for temporal relationship facts;
- Parlant for Goal/Journey;
- Persona authority for user style/persona;
- Model Brain / LiteLLM for production model execution/provider authority;
- RouteLLM as the mature logical routing source already selected by the architecture;
- Agent Lightning P1 as a sealed bounded training execution seam if a later policy head proves it needs that class of optimizer.

No successor may duplicate these authorities.

## 4. Learned policy heads

The long-term Learned Policy layer may contain multiple independently testable heads. They share one canonical Decision → Outcome contract and must not each invent their own training-data framework.

### 4.1 Relationship State

Purpose: produce bounded, provenance-aware relationship features such as stage, recent tension, interaction energy, initiation balance, communication preference and uncertainty.

Rules:

- `confirmed fact`, `user fact` and `AI inference` remain distinct;
- inferences carry confidence/provenance;
- one transient emotion must not become a permanent fact;
- the head can inform downstream strategy but cannot own canonical relationship facts.

### 4.2 Context / Memory Selector

Purpose: compile the smallest high-value context package for the current decision.

Possible outputs include:

- selected confirmed facts;
- selected relationship events;
- boundaries/sensitive topics that must be honored;
- relevant open loops/promises;
- excluded stale/irrelevant memory;
- bounded context package metadata and provenance.

It must not copy years of private conversation into a provider request simply because context length allows it.

### 4.3 Structured Strategy Policy

Purpose: choose a bounded communication action before final language generation.

Example action dimensions:

```text
warmth
initiative
brevity
directness
flirtation ceiling
question policy
pace
goal alignment
memory bundle
candidate branch
```

The action space must be explicit and versioned so decisions can be evaluated, shadowed and rolled back.

### 4.4 Candidate Preference / Ranker

Purpose: rank candidates generated through the existing Model Brain according to the user, relationship, constraints and historical real-world outcomes.

It may learn which candidate is more likely to match the user's voice and relationship context. It does not become a second general-purpose Generator.

### 4.5 Model / Reasoning Router Policy

Purpose: learn which **logical Model Brain route** is appropriate for the current task.

It can consider quality, historical outcome, latency, cost, capability, context length and sensitivity. It may not own physical provider credentials, direct provider calls, provider health or production fallback. Those remain Model Brain / LiteLLM authority.

## 5. Canonical causal data model

The prerequisite for all future learned heads is a canonical Decision → Outcome seam.

### 5.1 DecisionRecord

A learnable production decision must be bindable to at least:

```text
DecisionRecord
- decisionId
- scopeType
- scopeId
- contactId
- conversationId
- stateSnapshotRef
- stateVersion
- contextCandidateRefs
- allowedActionSet
- chosenAction
- actionProbability / propensity when applicable
- strategyVersion
- promptProgramVersion
- modelLogicalRoute
- candidateIds
- selectedCandidateId
- sentCandidateId when applicable
- decisionTraceId
- createdAt
```

The contract must preserve the action probability/propensity when the selected OSS learner or offline evaluator requires it. Yance must not reconstruct this value after the fact.

### 5.2 OutcomeVector

Raw real-world outcomes remain multi-dimensional before Learning-approved reward attribution.

```text
OutcomeVector
- replyLatency
- replyLengthDelta
- conversationContinued
- newTopicInitiated
- questionReturned
- nextDayReinitiation
- userAcceptedCandidate
- userEditedCandidate
- userRejectedCandidate
- userTakeover
- relationshipStateDelta
- explicitUserFeedback
- other provenance-backed outcome signals
```

The schema is intentionally not equivalent to a reward function.

### 5.3 Learning-approved reward/evaluation

Only canonical Learning authority may convert outcome evidence into approved training/evaluation signals.

The design preserves the existing principle that Deep Training or a policy learner does not invent its own reward authority. Langfuse Score/experiment evidence can participate, but raw downstream behavior is not automatically positive or negative.

This prevents reward hacking such as learning to ask unnecessary questions merely because questions increase reply frequency.

## 6. OSS-first design

### 6.1 Mandatory reuse

| Capability | Required disposition |
|---|---|
| OpenAI/Anthropic generation | REUSE Model Brain |
| Provider credentials/execution | REUSE LiteLLM / Model Brain |
| Long-term memory | REUSE Letta |
| Temporal relationship facts | REUSE Graphiti |
| Goal/Journey | REUSE Parlant |
| Persona/style authority | REUSE existing Persona authority |
| Trace/score/dataset/experiment | REUSE Langfuse + OTel |
| Program/context optimization | REUSE DSPy + GEPA |
| Regression/shadow evidence | REUSE Promptfoo + Learning evaluation |
| Promotion/rollback | REUSE Learning promotion authority |
| Deep training execution | REUSE Agent Lightning P1 only if later justified |

### 6.2 Mature OSS candidates for policy learning

The first policy-learner OSS-fit must evaluate mature components before any Yance implementation.

Default candidate:

- **Vowpal Wabbit contextual bandits** for bounded state → action → outcome learning and off-policy evaluation semantics.

Depending on the concrete head, the OSS-fit may instead select a mature reranker, embedding model, classifier or pairwise preference framework. The rule is capability-fit first, not forcing every problem into RL.

No new Yance generic learning framework is admitted without V2.1 OSS-fit proving mature OSS cannot own the capability.

## 7. Agent Lightning P1 disposition

Agent Lightning P1 remains valid infrastructure and is not reimplemented.

It is now classified as **dormant bounded training execution authority**, not as the product goal.

A successor may use it only when:

1. a specific bounded policy head is defined;
2. canonical Decision → Outcome evidence exists;
3. Learning owns eligibility/reward/evaluation;
4. simpler mature OSS approaches are insufficient for the selected head;
5. the output remains candidate/policy-only and cannot self-promote;
6. production model/provider execution remains Model Brain-owned.

The old VERL/Qwen reply-generator P2 therefore does not proceed.

## 8. Local model disposition

A local LLM may later be used for a bounded state/ranking/evaluation task, offline/privacy capability, bootstrap training fixture or a separately authorized future distillation/challenger workline.

A bootstrap model only proves training infrastructure works. Its checkpoint is not evidence that Yance's user-facing reply quality improved.

A future distillation workline is justified only after Yance has accumulated a sufficiently strong private domain dataset from frontier outputs plus real human outcomes. It remains separate from the Learned Policy workline.

## 9. Reuse / Retire / New Matrix

Every implementation plan and authorization derived from this design must include this classification and justify any deviation.

| Capability | Disposition |
|---|---|
| Frontier final reply generation | REUSE |
| Model Brain / LiteLLM | REUSE |
| RouteLLM | REUSE |
| Letta / Graphiti / Parlant / Persona | REUSE |
| Langfuse / OTel | REUSE |
| DSPy / GEPA | REUSE |
| Promptfoo / Learning evaluation | REUSE |
| Agent Lightning P1 | REUSE, dormant |
| Local Qwen reply-generator product target | RETIRE |
| Agent Lightning VERL reply-model P2 | RETIRE / SUPERSEDED |
| Canonical DecisionRecord | NEW THIN CONTRACT |
| Canonical OutcomeVector | NEW THIN CONTRACT |
| Decision ↔ Outcome provenance binding | NEW THIN CONTRACT |
| Policy learner | OSS-FIT FIRST |
| Existing Brain policy-consumption seam | NEW THIN ADAPTER only where missing |

Any proposed `NEW` capability that is not a thin contract/adapter is blocked until an OSS-fit proves the gap.

## 10. First successor work package

The first implementation successor is:

`V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`

Its purpose is **not** to ship all learned heads. It establishes one canonical causal contract that every later policy head can reuse.

Expected scope shape:

1. read current production decision surfaces and Learning signals from fresh main;
2. define bounded DecisionRecord and OutcomeVector contracts;
3. bind decisions to existing Langfuse/OTel evidence without creating another store;
4. bind user candidate choice/edit/send and later human response outcomes to the originating decision;
5. preserve privacy/minimization/relationship isolation;
6. expose a read-only Learning projection suitable for OSS learners;
7. prove one minimal learned-policy dimension can consume a versioned policy artifact through an existing Brain seam;
8. keep promotion/rollback behind existing Learning authority.

The concrete policy learner, dependency paths and license closure must be selected only after fresh OSS-fit and exact authorization.

## 11. Failure semantics

The system must fail closed when:

- decision provenance is missing;
- outcome cannot be bound to one canonical decision;
- scope/contact/conversation isolation conflicts;
- private raw content crosses a boundary without minimization/eligibility;
- a learner tries to invent reward outside Learning authority;
- a learned policy references an unknown schema/program/version;
- a policy artifact attempts direct provider execution;
- a policy tries to bypass user final-send authority;
- a new framework duplicates an existing OSS/Yance authority;
- a promotion tries to skip offline/regression/shadow evidence required by the applicable Learning contract.

Missing outcome evidence is not equivalent to a negative outcome.

## 12. Testing and acceptance

The first successor must prove at least:

1. DecisionRecord is generated from real existing Yance decision surfaces, not a synthetic parallel decision engine.
2. The record carries version/provenance and bounded action semantics.
3. User selection/edit/send can bind to the originating decision.
4. Later relationship/human-response evidence can bind to the same decision without ambiguous cross-contact leakage.
5. OutcomeVector remains separate from approved reward.
6. Only Learning-approved evidence crosses into learner training/evaluation.
7. The selected mature OSS learner can consume the projection through a thin adapter.
8. A new policy/program artifact can change at least one real decision dimension before frontier generation.
9. Final text is still generated through the existing Model Brain/OpenAI-or-Anthropic production path.
10. Regression/shadow/evaluation and rollback remain existing Learning authorities.
11. Existing P1 Agent Lightning functionality does not regress.
12. No new generic Yance model gateway, experiment platform, dataset store, memory system, reward engine, RL framework or policy framework is introduced.

The long-term product claim **"Yance learns and grows on top of ChatGPT/Claude"** is allowed only when the production loop demonstrates:

```text
versioned Yance decision
        -> frontier generation
        -> real user/human outcome
        -> canonical Learning evidence
        -> updated policy/program
        -> later production decision consumes the update
```

The existence of this mechanism does not imply that personalization is already optimal on day one; personalization strength grows with real longitudinal Decision → Outcome evidence.

## 13. Supersession and history

PR #367 is closed as `SUPERSEDED — DO NOT MERGE`.

The branch and commits remain immutable historical design evidence. They must not be rebased, amended or force-pushed into a new authority.

Future chats or plans that encounter the old `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1` must stop treating it as an executable product direction and resume from this successor architecture instead.

## 14. Fundamental invariant

> **Yance does not need to become a weaker ChatGPT. It must become the layer that makes the strongest available frontier model increasingly specific to this person, this relationship and this moment, while learning only from canonical, privacy-governed real outcomes.**
