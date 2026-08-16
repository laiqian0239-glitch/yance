# V21 Product AI Companion / Private Quest P0 V1 Design

## Status

Design for the next Product critical-path work package after `V21-PRODUCT-RELATIONSHIP-INTELLIGENCE-SURFACE-P0-V1` ordinary-merged as `c9dd2031a94734ff2a7f0642fe7cf12698b610f7`.

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

The remaining product-level gap is not missing AI infrastructure. It is a **composition-authority mismatch**:

1. the normal Product shell still permanently mounts the Learning administrative workspace; and
2. the current relationship AI surface exposes implementation-oriented runtime facts (`Letta`, `Agents`, `Recent context`) instead of a relationship-native private quest experience.

Fresh-main preflight also proves an executable same-root legacy contract: `tests/wp0/v21-learning-growth-brain-ui.test.js` still requires `ProductExperienceShell -> LearningWorkspace`. The older Learning reconciliation authorization encoded that composition before the Living Relationship OS became the Product Experience SSOT. This successor must update that executable Product-consumer contract while preserving the Learning runtime itself.

## Goal

Turn the existing hidden relationship AI drawer into the first real **AI Companion / Private Quest** experience and retire the stale normal-path Learning composition contract, without creating any new AI engine, memory system, graph, journey engine, messaging surface, IPC family, backend route, database, or general-purpose Yance infrastructure.

The user-visible result is a contextual relationship companion for the selected person that answers four questions only from existing trusted authorities:

1. **What matters now?** — current Parlant goal/objective, when one exists.
2. **How is it progressing?** — Parlant goal progress path/completion only.
3. **What does the relationship evidence say?** — trusted RelationshipProjectionAuthority summary / state / evidence labels already present on the selected relationship projection.
4. **What is the next useful step?** — authority-provided relationship next action when available; otherwise truthful pending/no-suggestion state.

## Non-goals

This package does not:

- invent memory hints from Letta conversation counts;
- generate suggested replies unless an existing trusted reply authority is explicitly proven and separately authorized;
- expose model/provider/agent/runtime telemetry as relationship UX;
- delete, rewrite, or weaken the Learning runtime, Learning admin workspace, Learning privacy/consent controls, or Learning OSS composition;
- move Learning governance/admin functionality into Product;
- change Graphiti, Letta, Parlant, LiteLLM, Learning, Voice, Media, Presence, Matrix, or canonical state ownership;
- add a new Product framework, orchestration engine, cache, service, route, IPC channel, preload API, database table, workflow, or dependency.

## Architecture

### 1. Product shell boundary

`ProductExperienceShell` remains the normal Yance composition root.

The normal relationship experience must no longer directly import or mount `LearningWorkspace`. Learning remains an existing modular domain/admin authority in `integration/element-module/src/LearningWorkspace.tsx`; this P0 does not delete or rewrite it.

The executable Learning UI contract must be migrated from "Learning must be mounted in Product" to "Learning remains modular and complete, but the normal people-first Product path must not permanently mount it." This is a successor Product-consumer contract change, not retirement of Learning capability.

### 2. Private Quest data flow

No new Product data model is required.

Reuse the already-existing projections exactly:

- `RelationshipProjection.relationshipIntelligence` from #443 for trusted analysis status / summary / next / evidence semantics;
- `RelationshipAssistantProjection.goal` for Parlant goal existence, text, paused state and progress path/completion;
- `RelationshipAssistantProjection.agentReady` only as internal AI-interaction readiness.

`RelationshipAssistant` receives the already-selected `RelationshipProjection` directly from `ProductExperienceShell` and continues loading Parlant/Letta state by `relationship.id` through the existing `loadRelationshipAssistant()` seam.

No evidence may be re-keyed or synthesized. Relationship intelligence continues to inherit the conversation-scoped authority join established by #443. No modification to `experienceProjection.ts` or `experienceTypes.ts` is required for this P0.

### 3. AI Companion / Private Quest UI

`RelationshipAssistant` is evolved into a relationship-native contextual drawer/aside.

Required user-facing hierarchy:

- **Private Quest** title / relationship-native copy, not an AI admin heading.
- **Current intention**: existing Parlant goal with edit/pause/remove controls.
- **Progress**: only existing Parlant progress; if empty, state that progress is not yet available.
- **Relationship insight**: trusted summary/status from `relationship.relationshipIntelligence`.
- **Next step**: trusted `relationship.relationshipIntelligence.next` only when authority output exists; otherwise truthful pending state.

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

## Exact implementation scope for authorization

Fresh-main causal analysis reduces the original proposal to exactly five paths:

- `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
- `integration/element-module/src/product-experience/ProductExperienceShell.css`
- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`
- `tests/wp0/v21-learning-growth-brain-ui.test.js`

No `RelationshipWorld`, `experienceProjection` or `experienceTypes` modification is required. Their existing contracts are preservation evidence.

Any newly proven same-root required path after authorization must use the Fast Closure V2 same-work-package scope-amendment mechanism before production changes use it.

## Failure-first contract

The mandatory first implementation commit is tests-only and changes exactly:

- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`
- `tests/wp0/v21-learning-growth-brain-ui.test.js`

The exact authorization-merge baseline must RED because:

1. normal Product composition still directly mounts `LearningWorkspace`;
2. the existing Learning UI contract still requires that stale normal-path mount;
3. relationship AI exposes implementation/runtime facts rather than Private Quest presentation;
4. the selected `RelationshipProjection` is not yet passed into the companion for trusted summary/next presentation;
5. existing Product authority boundaries and #443 conversation-scoped relationship evidence remain unchanged.

Additional tests-only diagnostic RED commits are allowed only for the same root cause and only before production implementation. Production begins only with Closure Matrix `unknownBlockers = 0`.

## Closure Matrix boundaries

Before production implementation, classify at minimum:

- Product shell normal-path Learning mount — `ROOT_IMPLEMENTATION`;
- stale executable Learning composition test — `ROOT_IMPLEMENTATION`;
- RelationshipAssistant technical/runtime presentation — `ROOT_IMPLEMENTATION`;
- Parlant goal write/progress authority — `PRESERVE`;
- RelationshipProjectionAuthority summary/next/evidence — `PRESERVE`;
- #443 conversation-scoped evidence join — `PRESERVE`;
- Learning runtime/admin workspace capability — `PRESERVE`;
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
- Learning OSS stack — retained as its existing modular/admin authority;
- Base UI / Motion / Rive — Product interaction/motion/living-state primitives.

Yance adds only a thin presentation/composition layer over these existing authorities.

## Validation

Focused validation must include:

- the new Private Quest P0 failure-first/final test;
- migrated `v21-learning-growth-brain-ui.test.js` Product-consumer contract;
- existing Product Experience shell architecture/accessibility/interaction tests;
- existing Parlant workspace contract;
- #443 Product relationship intelligence test;
- Graphiti relationship authority regression;
- existing Element workspace contract;
- Learning runtime/contract tests sufficient to prove Learning capability itself remains intact.

Final exact-head validation follows Fast Closure V2 routing and must truthfully report skipped jobs. Required routed gates include Stage/WP0 plus ACV2/Layered/WP-A/Product/Model where triggered, independent exact-head review, unresolved-thread check and fresh-main anti-drift.

## Acceptance

P0 is complete only when:

- normal Product experience is People/Relationship-first and no longer permanently exposes the Learning admin workspace;
- Learning runtime/admin capability remains present and its own contracts stay green;
- selected-person AI is a hidden-by-default Private Quest surface;
- current goal, real progress, trusted relationship insight and trusted next step are composed without duplicate authority;
- unavailable/pending states remain truthful;
- no technical `Letta / Agents / Recent context` dashboard facts remain in the normal relationship UX;
- no new runtime authority or infrastructure is introduced;
- accessibility/focus/reduced-motion contracts remain intact;
- exact-head required gates and independent review are green;
- final merge is ordinary/two-parent from fresh trusted main.
