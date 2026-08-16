# V21 Product AI Companion / Private Quest P0 V1 Design

## Status

Design proposal for the next Product critical-path work package after `V21-PRODUCT-RELATIONSHIP-INTELLIGENCE-SURFACE-P0-V1` ordinary-merged as `c9dd2031a94734ff2a7f0642fe7cf12698b610f7`.

This document is design-only. It grants no implementation, merge, release, or promotion authority.

## Product basis

The Product Experience SSOT is the Living Relationship OS direction:

- People-first.
- AI invisible.
- Each person owns one Relationship World.
- AI / Goal / Memory are progressively disclosed around the current person rather than becoming top-level capability silos.
- Element / Matrix remains the conversation and messaging authority.
- Letta / Graphiti / Parlant / LiteLLM remain mature runtime authorities.
- Product may own only relationship orchestration and presentation.

Current trusted Product already has:

- People Home / PeopleSurface;
- Relationship World;
- Graphiti/RelationshipProjectionAuthority-backed relationship intelligence from #443;
- Parlant relationship Goal projection and progress;
- Letta readiness/context projection;
- Base UI / Motion / Rive product primitives;
- existing relationship event refresh.

The remaining product-level gap is that the normal Product shell still mounts the Learning administrative workspace, and the current relationship AI surface exposes implementation-oriented runtime facts (`Letta`, `Agents`, `Recent context`) instead of a relationship-native private quest experience.

## Goal

Turn the existing hidden relationship AI drawer into the first real **AI Companion / Private Quest** experience without creating any new AI engine, memory system, graph, journey engine, messaging surface, IPC family, backend route, database, or general-purpose Yance infrastructure.

The user-visible result is a contextual relationship companion for the selected person that answers four questions only from existing trusted authorities:

1. **What matters now?** — current Parlant goal/objective, when one exists.
2. **How is it progressing?** — Parlant goal progress path/completion only.
3. **What does the relationship evidence say?** — trusted RelationshipProjectionAuthority summary / state / evidence labels.
4. **What is the next useful step?** — authority-provided relationship next action when available; otherwise truthful pending/no-suggestion state.

## Non-goals

This package does not:

- invent memory hints from Letta conversation counts;
- generate suggested replies unless an existing trusted reply authority is explicitly proven and separately authorized;
- expose model/provider/agent/runtime telemetry as relationship UX;
- replace or delete the Learning runtime;
- move Learning governance/admin functionality into Product;
- change Graphiti, Letta, Parlant, LiteLLM, Learning, Voice, Media, Presence, Matrix, or canonical state ownership;
- add a new Product framework, orchestration engine, cache, service, route, IPC channel, preload API, database table, workflow, or dependency.

## Architecture

### 1. Product shell boundary

`ProductExperienceShell` remains the composition root.

The normal relationship experience must no longer directly mount `LearningWorkspace`. Learning remains an existing domain authority available only through its own operational/admin boundary, not as a permanent child of the people-first normal Product scene.

No deletion of Learning runtime or Learning files is required for this P0.

### 2. Private Quest projection

Reuse and extend only the existing Product read model in `experienceProjection.ts` / `experienceTypes.ts`.

A Private Quest projection is presentation-only and may contain:

- selected `relationshipId`;
- Parlant goal existence, text, paused state and progress path/completion;
- RelationshipProjectionAuthority analysis status, stage/summary/next and evidence-state metadata already present on the selected `RelationshipProjection`;
- Letta availability only as an internal readiness signal needed to decide whether the companion can offer AI interaction; no agent counts or raw runtime inventory are user-facing.

No evidence may be re-keyed or synthesized. Relationship intelligence continues to inherit the conversation-scoped authority join established by #443.

### 3. AI Companion / Private Quest UI

`RelationshipAssistant` is evolved into a relationship-native contextual drawer/aside.

Required user-facing hierarchy:

- **Private Quest** title / relationship-native copy, not an AI admin heading.
- **Current intention**: existing Parlant goal with edit/pause/remove controls.
- **Progress**: only existing Parlant progress; if empty, state that progress is not yet available.
- **Relationship insight**: trusted summary/status from RelationshipProjectionAuthority.
- **Next step**: trusted `next` only when authority output exists; otherwise truthful pending state.

The UI must not show:

- `Letta` as a product label;
- agent count;
- recent Letta conversation count;
- model/provider names;
- Graphiti implementation internals beyond already-approved epistemic source labels where evidence provenance matters.

### 4. AI invisible behavior

The companion remains hidden by default and opens only from the current Relationship World.

Opening it must preserve the selected person and Element conversation state. Closing it must not alter Parlant goal state, Matrix timeline, composer, search, or relationship selection.

The companion may use the existing Rive AI state projection (`idle/wake/listening/thinking/ready/error`) as bounded ambient feedback; it must not create a new state engine.

### 5. Truthfulness / failure behavior

- No Parlant goal: show a neutral invitation to set a private intention.
- Goal authority unavailable: preserve relationship intelligence and show goal unavailable without fabricating state.
- Relationship intelligence pending/empty: show pending / no confirmed insight; do not invent stage/summary/next.
- Letta unavailable: goal/intelligence remain visible; only AI-interaction readiness degrades.
- Any existing goal write failure remains explicit and non-destructive.

No permissive fallback may substitute local social heuristics, Letta counts, message counts, or Learning evidence for relationship intelligence.

## Proposed exact implementation scope

Keep the first P0 deliberately small and inside already routed Product paths:

- `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
- `integration/element-module/src/product-experience/RelationshipWorld.tsx`
- `integration/element-module/src/product-experience/experienceProjection.ts`
- `integration/element-module/src/product-experience/experienceTypes.ts`
- `integration/element-module/src/product-experience/ProductExperienceShell.css`
- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`

The implementation authorization may reduce this set after exact fresh-main causal analysis. It may not silently expand it. Any newly proven same-root required path must use the Fast Closure V2 same-work-package scope-amendment mechanism before production changes use it.

## Failure-first contract

The mandatory first implementation commit is tests-only and must prove, on the effective authorization merge baseline:

1. normal Product composition still directly mounts `LearningWorkspace`;
2. relationship AI exposes implementation/runtime facts rather than Private Quest presentation;
3. no Private Quest projection composes Parlant goal progress with trusted relationship intelligence;
4. relationship insight / next-step states do not yet have a single relationship-native companion presentation contract;
5. existing Product authority boundaries and #443 conversation-scoped relationship evidence remain unchanged.

Additional tests-only diagnostic RED commits are allowed only for the same root cause and only before production implementation. Production begins only with Closure Matrix `unknownBlockers = 0`.

## Closure Matrix boundaries

Before production implementation, classify at minimum:

- Product shell normal-path Learning mount — `ROOT_IMPLEMENTATION`;
- RelationshipAssistant technical/runtime presentation — `ROOT_IMPLEMENTATION`;
- Parlant goal write/progress authority — `PRESERVE`;
- RelationshipProjectionAuthority summary/next/evidence — `PRESERVE`;
- #443 conversation-scoped evidence join — `PRESERVE`;
- Letta runtime ownership — `PRESERVE`;
- Element timeline/composer/navigation — `PRESERVE`;
- no agent-count/message-count/local-heuristic substitution — `NEGATIVE_PROOF`;
- no new AI/memory/journey/reply engine — `NEGATIVE_PROOF`;
- no new IPC/backend/database/workflow/dependency — `NEGATIVE_PROOF`.

## OSS-fit

No new OSS selection is needed for this P0.

The mature authorities are already selected and integrated:

- Parlant — Goal/Journey authority;
- Graphiti + Neo4j — temporal relationship inference;
- Letta — persistent Agent / long-term memory runtime;
- Element / Matrix — conversation state and messaging;
- Base UI / Motion / Rive — Product interaction/motion/living-state primitives.

Yance adds only a thin presentation/composition layer over these existing authorities.

## Validation

Focused validation must include:

- the new Private Quest P0 failure-first/final test;
- existing Product Experience shell architecture/accessibility/interaction tests;
- existing Parlant workspace contract;
- #443 Product relationship intelligence test;
- Graphiti relationship authority regression;
- existing Element workspace contract.

Final exact-head validation follows Fast Closure V2 routing and must truthfully report skipped jobs. Required routed gates include Stage/WP0 plus ACV2/Layered/WP-A/Product/Model where triggered, independent exact-head review, unresolved-thread check and fresh-main anti-drift.

## Acceptance

P0 is complete only when:

- normal Product experience is People/Relationship-first and no longer permanently exposes the Learning admin workspace;
- selected-person AI is a hidden-by-default Private Quest surface;
- current goal, real progress, trusted relationship insight and trusted next step are composed without duplicate authority;
- unavailable/pending states remain truthful;
- no technical `Letta / Agents / Recent context` dashboard facts remain in the normal relationship UX;
- no new runtime authority or infrastructure is introduced;
- accessibility/focus/reduced-motion contracts remain intact;
- exact-head required gates and independent review are green;
- final merge is ordinary/two-parent from fresh trusted main.
