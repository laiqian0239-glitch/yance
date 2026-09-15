# Yance Post-Release AI Relationship Authority Gap Audit

Date: 2026-09-15  
Audit base: `2400bf953ae1e0c3183f349b5ebb69fb63f1d5bb`  
Status: `POST_RELEASE_REFERENCE_ONLY`  
Production authority: `NONE`  
Dependency adoption authority: `NONE`  
Current Release impact: `NONE`

## 0. Purpose and hard boundary

This document records a read-only architecture audit of Yance's existing AI / Relationship / Memory authority topology and identifies capability gaps that may be considered **after the current Release is complete**.

This document does **not** authorize:

- any mutation to the active Release causal batch;
- any new runtime, dependency, package, service, model provider, background daemon, scheduler or sidecar;
- any replacement of Element / Matrix, Graphiti / Neo4j, Parlant, Letta, PersonaBrain, Learning, Electron, Docker Compose or existing Yance owners;
- any production implementation of the design-reference projects named below;
- any upgrade of existing OSS pins during the current Release;
- any new shadow authority, parallel lifecycle, mirror state, fallback state machine, second memory owner, second relationship owner, second send authority or second agent lifecycle owner.

All future implementation remains subject to `AGENTS.md`, Mature Authority Preservation / no Shadow Authority, OSS Authority Refresh Audit, exact authorization and the live Controller State at the time of implementation.

## 1. Executive conclusion

Yance does **not** currently lack a mature AI brain. The repository already contains mature authorities for the majority of capabilities that are often proposed as missing:

1. **Element / Matrix** owns real communication timeline, session, crypto, composer and send authority.
2. **Graphiti / Neo4j** owns temporal relationship-fact memory and provenance-aware retrieval.
3. **Parlant** owns relationship-goal and daily conversational journey state/progress.
4. **Letta** is already integrated as a persistent Agent runtime through its official CLI / public SDK seam.
5. **PersonaBrain + existing style/persona seams** own persona/truth-safe reply composition inputs.
6. **RelationshipProjectionAuthority** owns the Product relationship-intelligence projection and rejects stale legacy relationship truth as Product authority.
7. **contextAwareReplyBrain** already composes rich relationship, memory, language, persona, temporal and strategy context for reply generation.
8. **interactionGovernor** already models initiative limits, contact cadence, unanswered-message tolerance, relationship stage and boundary-sensitive proactive policy.

The remaining high-value gaps are therefore narrower:

- continuous AI existence while no inbound message is arriving;
- background reflection / internally-triggered recall without creating a second memory authority;
- inner-state-driven proactive contact using existing policy/send authorities;
- an explicit autonomous decision semantic for `reply / wait / do not reply / contact later`, distinct from simple permission gates.

The post-release direction should therefore be **deeper use of existing mature owners**, not another large AI framework.

## 2. Current authority topology

| Capability | Current owner | Repository evidence | Decision |
|---|---|---|---|
| Real chat timeline / crypto / session / composer / send | Element / Matrix | existing Matrix/Element integration and Product composition | KEEP; no second owner |
| Temporal relationship facts | Graphiti + Neo4j | `runtime/graphiti/yance_graphiti_server.py`, `config/upstreams/v21-graphiti-p0.json` | KEEP; authoritative fact memory |
| Relationship fact Product projection | `RelationshipProjectionAuthority` | `backend/services/relationshipProjectionAuthority.js` | KEEP; thin projection only |
| Relationship goal / journey | Parlant | `runtime/parlant/yance_parlant_server.py`, `electron/parlantRelationshipRuntime.js` | KEEP; journey lifecycle owner |
| Daily conversational goal | Parlant | `/yance/daily-chat-goals/*` in Parlant bridge | KEEP; no Yance journey clone |
| Persistent agent runtime | Letta | `electron/lettaAgentRuntime.js`, `config/upstreams/v21-letta-p0.json` | KEEP; deepen public seam only if authorized later |
| Persona / truth-safe composition | PersonaBrain + existing style/persona authorities | `backend/personaBrain/*`, `backend/services/contextAwareReplyBrain.js` | KEEP |
| Reply strategy and contextual generation | `contextAwareReplyBrain` and existing model-policy authorities | `backend/services/contextAwareReplyBrain.js` | KEEP; not the primary gap |
| Social-contact policy | `interactionGovernor` | `backend/store/social/interactionGovernor.js` | KEEP; current automation remains policy-gated |
| Product relationship UI projection | Product thin projection | `integration/element-module/src/product-experience/*` | KEEP thin; no domain authority migration into renderer |

## 3. Graphiti audit

### 3.1 Existing mature owner

Yance already pins and consumes Graphiti through:

- `config/upstreams/v21-graphiti-p0.json`;
- `runtime/graphiti/yance_graphiti_server.py`;
- `electron/graphitiRelationshipRuntime.js`;
- existing relationship-authority tests/governance.

The bridge uses Graphiti's native `add_episode` and native `search` seams. It preserves temporal/provenance fields such as:

- `factId`;
- `episodeUuid`;
- `groupId`;
- `validAt`;
- `invalidAt`;
- `referenceTime`;
- episode provenance.

Relationship isolation is derived by deterministic relationship group identity rather than by a new Yance graph runtime.

### 3.2 Product projection

`backend/services/relationshipProjectionAuthority.js` recognizes Graphiti inference rows and user annotations for relationship timeline presentation. Product relationship intelligence is projected through a single authority identifier:

`RelationshipProjectionAuthority`

The projection no longer needs a second local rules engine to become the Product relationship-truth owner.

### 3.3 Decision

`GRAPHITI_AUTHORITY=KEEP`

Do not add another generic memory product as a second relationship-memory authority. Any future recall/continuity feature must first reuse Graphiti's current public fact/search seam or Letta's native agent-memory seam according to ownership.

## 4. Parlant audit

### 4.1 Existing mature owner

`runtime/parlant/yance_parlant_server.py` creates and persists the mature Parlant objects that own relationship conversational progression:

- Agent;
- Customer;
- Session;
- Journey;
- Journey nodes/edges;
- Journey evaluation/progress.

Long-lived Relationship Goal and per-local-date Daily Chat Goal are separate Parlant Journeys over the same canonical relationship agent/customer/session runtime.

### 4.2 Important ownership property

Yance does not need a parallel relationship-goal state machine. The Product adapter reads and mutates Parlant through narrow authenticated loopback seams and projects progress upward.

### 4.3 Decision

`PARLANT_AUTHORITY=KEEP`

Do not implement another Yance relationship journey engine, goal state machine, retry lifecycle or conversation-progress registry.

## 5. Letta audit — largest mature-owner opportunity

### 5.1 Existing integration

`electron/lettaAgentRuntime.js` currently owns Electron-side hosting of the official Letta runtime and exposes a narrow surface:

- `start`;
- `stop`;
- `snapshot`;
- `listAgents`;
- `listConversations`.

The current Product projection primarily uses Letta for readiness and bounded agent/conversation visibility.

### 5.2 Gap

The repository audit does not show the Product consuming Letta as the explicit persistent identity/inner-continuity owner for each Relationship.

The current adapter does not expose a Product seam for capabilities such as persistent relationship-agent binding or mature native agent-memory/continuity features. This is a **capability-usage gap**, not evidence that a new framework is required.

### 5.3 Required post-release investigation order

Before designing any new background cognition or memory infrastructure:

1. audit the then-current pinned Letta public API and official runtime features completely;
2. determine whether persistent agent identity, memory blocks, conversation continuity, scheduled/native background behavior or related requirements already have a stable public seam;
3. preserve Letta lifecycle/state as Letta-owned;
4. expose only the thinnest Yance projection needed by Product;
5. reject any design that mirrors Letta memory/state into a new Yance-owned agent database.

### 5.4 Decision

`LETTA_AUTHORITY=KEEP_AND_AUDIT_DEEPER_POST_RELEASE`

No Letta upgrade is authorized by this document. Any version refresh must be a separate post-release OSS Authority Refresh Audit.

## 6. Existing proactive-social capability

`backend/store/social/interactionGovernor.js` already contains meaningful social-policy semantics, including relationship-stage-dependent controls such as:

- proactive budget;
- minimum contact interval;
- unanswered-message limit;
- maximum question count;
- conversational depth;
- negative/positive signal handling;
- fatigue/boundary/tension handling;
- initiative, warmth, empathy, directness and brevity weighting.

Important current defaults include:

- `manualApprovalRequired: true`;
- `proactiveAutomationEnabled: false`.

This means Yance already knows how to **bound** proactive behavior, but the repository does not yet establish a mature autonomous inner-state owner that decides when to create proactive intent.

The platform layer already has proactive-send capability modeling and the social selector exposes `canProactivelyContact`. Therefore the missing work is not another sending stack.

`PROACTIVE_SEND_OWNER=EXISTING_PLATFORM_AUTHORITY`

`PROACTIVE_POLICY_OWNER=EXISTING_INTERACTION_GOVERNOR`

The post-release gap is the upstream **intent decision**, not transport or policy reimplementation.

## 7. True post-release capability gaps

### GAP-A — Continuous AI existence

Desired behavior:

- the relationship agent remains a continuous identity even when no inbound message arrives;
- time passing may change internal context through mature owner mechanisms;
- next interaction may reflect prior unresolved thoughts or background consolidation;
- no fake activity may be invented and no relationship fact may bypass Graphiti evidence/truth rules.

This gap must not be solved by a second scheduler/state database if Letta or another already-adopted mature owner provides the required lifecycle/public seam.

### GAP-B — Background reflection / internally-triggered recall

Desired behavior:

- a mature agent owner may re-surface relevant existing memories/relationship facts;
- any relationship factual recall remains sourced from Graphiti/approved truth evidence;
- reflection output must not become a second factual truth store;
- no raw private-chat training or silent profile rewrite may be introduced.

### GAP-C — Inner-state-driven proactive contact

Desired decision pipeline:

```text
existing relationship facts / evidence
        -> mature persistent agent state
        -> Parlant relationship/daily goal context
        -> social intent decision
        -> interactionGovernor policy gate
        -> existing platform capability/send authority
```

A proactive intent must be blocked when existing boundary/cadence/unanswered/policy gates reject contact.

### GAP-D — Autonomous reply decision semantics

Today Yance has permission gates (`allowReplies`, `blocked`, automation mode) and strong reply generation. The audit did not identify a first-class behavior authority whose output can explicitly be one of:

```text
reply
wait
no_reply
defer_contact
```

Future implementation should add only the narrow decision semantic needed by Product, and should first determine whether the adopted mature agent/journey owner already exposes such a decision seam.

A new general state machine is forbidden unless an OSS-fit audit proves no mature owner can satisfy the need.

## 8. External design references — reference only, never current production authority

The following projects are useful as behavioral references, not adoption decisions:

### Shikigami-style reference

Useful ideas:

- background reflection;
- internal energy/emotion/affinity influencing social urge;
- proactive contact based on internal state;
- persona evolution and non-static continuity.

Decision: extract requirements only. Do not adopt its runtime or state ownership without a fresh post-release maturity/license/authority audit.

### Crescent Grove-style reference

Useful idea:

- the AI's world/time continues while the user is absent;
- old memories may surface without a direct user prompt;
- next interaction reflects continuous existence rather than a frozen request/response snapshot.

Decision: use as behavior-spec inspiration only. Do not introduce another memory/identity lifecycle owner.

### eros-engine / RP-engine-style reference

Useful idea:

- separate `should/how to act` from text generation;
- relationship state may produce `reply / ghost / defer / other action` before generation.

Decision: only the decision-layer concept is relevant. Do not import a second relationship-state engine.

### Concordia / OASIS-style reference

Useful role:

- offline simulation and adversarial behavior evaluation;
- multi-agent relationship dynamics;
- over-contact / over-reply / monotonic-intimacy / harassment-loop testing;
- large-scale social-policy stress testing.

Decision: potential **lab/test authority only**, never production conversation, memory, identity or send authority.

Before any use, perform a fresh version/license/security/maturity audit.

## 9. Recommended post-release target topology

```text
                         Graphiti / Neo4j
                    relationship facts + provenance
                              |
                              v
                            Letta
               persistent agent identity / continuity
                              |
                              v
                           Parlant
              relationship journey / daily direction
                              |
                              v
                  Social Intent Decision Seam
                  reply / wait / no_reply / contact
                              |
                              v
                    interactionGovernor
          boundary / cadence / unanswered / approval gate
                              |
                              v
                  contextAwareReplyBrain
                  only when reply text is needed
                              |
                              v
                      Matrix / Element
              real timeline / composer / send authority
```

Ownership invariants:

- Graphiti remains factual relationship-memory owner.
- Letta remains agent lifecycle/state owner where its mature public seam applies.
- Parlant remains conversational journey/goal owner.
- `interactionGovernor` remains Yance social-policy projection/gate.
- Matrix/Element/platform adapters remain communication/send owners.
- Yance Product owns People / Relationship World / AI Product identity/navigation and the thinnest projections.
- No component above may mirror another owner's state merely for convenience.

## 10. Explicit non-goals

Do not create:

- `YanceMemoryEngine` beside Graphiti;
- `YanceAgentStateDB` beside Letta;
- `YanceJourneyEngine` beside Parlant;
- `YanceMessageTimeline` beside Matrix;
- a second proactive-send queue beside existing platform/outbox authority;
- a renderer-owned relationship intelligence database;
- a background helper daemon whose only purpose is to emulate mature agent scheduling;
- a custom recovery/retry supervisor for mature subsystem lifecycle;
- automatic relationship-fact promotion from reflection text without evidence/provenance.

## 11. Post-release candidate work package

Candidate name:

`AI_RELATIONSHIP_CONTINUITY_AND_PROACTIVE_AGENCY_POST_RELEASE`

Admission sequence:

1. current Release must already be complete;
2. fresh Controller State must authorize new work;
3. perform a focused OSS Authority Refresh Audit for the **already adopted** Letta/Graphiti/Parlant pins before considering new OSS;
4. map exact public seams for persistent identity, background activity and decision semantics;
5. prove no shadow authority is introduced;
6. define the smallest same-root production boundary;
7. obtain exact path authorization before mutation;
8. local proof first, then one Exact Head / one CI / ordinary merge under normal repository policy.

Potential acceptance outcomes, to be refined only after mature-owner audit:

- a Relationship maps deterministically to its mature persistent agent identity;
- continuity survives app restart through mature owner state, not Yance mirror state;
- background activity never fabricates relationship facts;
- proactive intent is explainable, bounded and blocked by existing social policy when required;
- `no_reply`/`wait` is a valid behavior decision rather than a generator error;
- user/relationship boundaries always dominate proactive urge;
- Matrix/Element remains the only real message/session/send authority;
- Product UI exposes only useful relationship-native projection, not raw admin/runtime state.

## 12. Final decision matrix

| Candidate | Current decision |
|---|---|
| Graphiti | KEEP; already authoritative for temporal relationship facts |
| Neo4j | KEEP as Graphiti storage owner per current sealed runtime |
| Parlant | KEEP; already authoritative for relationship/daily journey state |
| Letta | KEEP; first candidate to deepen through official public seams after Release |
| PersonaBrain / current style seams | KEEP |
| contextAwareReplyBrain | KEEP; not the primary architecture gap |
| interactionGovernor | KEEP; extend only through narrow authorized semantics if needed |
| Mem0 or another generic memory layer | DO NOT ADD as parallel relationship-memory owner |
| Shikigami | DESIGN REFERENCE ONLY |
| Crescent Grove | DESIGN REFERENCE ONLY |
| eros-engine / RP-engine | DESIGN REFERENCE ONLY |
| Concordia | POSSIBLE OFFLINE LAB ONLY |
| OASIS | POSSIBLE OFFLINE LAB ONLY |

## 13. One-sentence architecture direction

**Do not make Yance better by adding another AI brain; make it more alive by letting the mature owners already in the repository provide continuous identity, truthful memory, relationship journeys and bounded autonomous social intent through the narrowest public seams.**
