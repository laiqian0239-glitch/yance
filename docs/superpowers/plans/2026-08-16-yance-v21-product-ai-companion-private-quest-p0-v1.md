# V21 Product AI Companion / Private Quest P0 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the selected-person relationship AI surface into a truthful, hidden-by-default Private Quest experience composed only from existing Parlant goal/progress and RelationshipProjectionAuthority insight/next data, while removing the Learning admin workspace from the normal Product path.

**Architecture:** Keep Element/Matrix, Parlant, Graphiti/Neo4j, Letta, Learning, Base UI, Motion and Rive as their existing authorities. Make only a thin Product-composition change: `ProductExperienceShell` stops mounting `LearningWorkspace` on the normal path; `RelationshipAssistant` becomes the Private Quest presenter; `experienceProjection`/`experienceTypes` compose existing authority outputs without new state ownership, IPC, routes, storage or dependencies.

**Tech Stack:** React / TypeScript / Element module Product Experience / existing Electron desktop APIs / Parlant goal APIs / RelationshipProjectionAuthority projection / Motion / Rive / Node `node:test` contracts.

## Global Constraints

- Work package: `V21-PRODUCT-AI-COMPANION-PRIVATE-QUEST-P0-V1`.
- Trusted implementation may start only from the effective ordinary two-parent authorization merge.
- Fast Closure V2 is mandatory: tests-only first commit, fresh causal Stage RED, optional same-root tests-only diagnostic REDs, Closure Matrix `unknownBlockers = 0`, then first production commit with exact RED trailers.
- Product thesis: People-first, AI invisible, current-person continuity, Relationship World as the normal context.
- Element / Matrix remains conversation/timeline/composer/navigation authority.
- Parlant remains Goal/Journey authority; existing goal write APIs remain unchanged.
- Graphiti + Neo4j + RelationshipProjectionAuthority remain relationship inference/projection authority.
- Letta remains long-term Agent/runtime authority but its runtime inventory is not user-facing Product UX.
- Learning runtime remains intact and is not deleted or rewritten by this package.
- No new dependency, workflow, IPC channel, preload API, backend route, database table, cache, service, sidecar, memory engine, journey engine, reply engine, relationship engine or general-purpose Yance infrastructure.
- No local social-heuristic, message-count, Letta-agent-count or Learning-evidence fallback may substitute for RelationshipProjectionAuthority output.
- No fabricated insight, next step, progress, suggested reply, memory hint or AI readiness.
- Existing #443 conversation-scoped relationship evidence join must remain unchanged.
- No squash, rebase, force push, amend of published governed history or gate weakening.
- Final implementation merge is ordinary/two-parent only after exact-head routed CI, independent review, unresolved-thread check and fresh-main anti-drift.

---

## File Structure

- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js` — failure-first and final source-level Product contract for Private Quest composition and negative authority proofs.
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx` — normal Product composition root; removes permanent `LearningWorkspace` mount only.
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx` — Private Quest UI and existing Parlant goal mutations.
- `integration/element-module/src/product-experience/RelationshipWorld.tsx` — passes trusted selected relationship intelligence into the contextual companion and preserves hidden-by-default behavior.
- `integration/element-module/src/product-experience/experienceProjection.ts` — composes existing Parlant + Letta readiness projection; must not add new bridge calls or re-key relationship intelligence.
- `integration/element-module/src/product-experience/experienceTypes.ts` — presentation-only Private Quest projection type if needed; no new authority/state model.
- `integration/element-module/src/product-experience/ProductExperienceShell.css` — Private Quest presentation styles within existing Product design tokens.

---

### Task 1: Freeze the Private Quest failure-first contract

**Files:**
- Create: `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`

**Interfaces:**
- Consumes: current `ProductExperienceShell`, `RelationshipAssistant`, `RelationshipWorld`, `experienceProjection`, `experienceTypes` source.
- Produces: exact source-level contract proving the current Product still exposes Learning/admin and runtime telemetry instead of a relationship-native Private Quest.

- [ ] **Step 1: Create the tests-only failure-first file**

Use this contract shape:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shell = () => read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const assistant = () => read('integration/element-module/src/product-experience/RelationshipAssistant.tsx');
const world = () => read('integration/element-module/src/product-experience/RelationshipWorld.tsx');
const projection = () => read('integration/element-module/src/product-experience/experienceProjection.ts');

test('normal Product path is relationship-first and does not permanently mount Learning admin', () => {
  assert.doesNotMatch(shell(), /import\s+\{\s*LearningWorkspace\s*\}|<LearningWorkspace\s*\/>/u);
});

test('selected-person companion is presented as Private Quest instead of runtime telemetry', () => {
  const source = assistant();
  assert.match(source, /Private Quest/u);
  assert.match(source, /Current intention/u);
  assert.match(source, /Progress/u);
  assert.match(source, /Relationship insight/u);
  assert.match(source, /Next step/u);
  assert.doesNotMatch(source, /<dt>Letta<\/dt>|<dt>Agents<\/dt>|Recent context/u);
});

test('Private Quest preserves existing authority outputs and never substitutes local telemetry', () => {
  const source = projection();
  assert.match(source, /getParlantRelationshipGoal/u);
  assert.match(source, /progress/u);
  assert.doesNotMatch(source, /relationshipPotential|customer_social_state|social_rule_projection|message_baseline/u);
  assert.doesNotMatch(source, /agentCount\s*[:=].*(stage|summary|next)|recentConversationCount\s*[:=].*(stage|summary|next)/u);
});

test('Relationship World keeps companion contextual and relationship intelligence conversation-scoped', () => {
  assert.match(world(), /assistantVisible/u);
  assert.match(world(), /relationship=/u);
  assert.match(projection(), /relationshipConversationIdsByContactId/u);
  assert.match(projection(), /relationshipIntelligence\[conversationId\]/u);
  assert.doesNotMatch(projection(), /relationshipIntelligence\[stableContactId\]/u);
});
```

- [ ] **Step 2: Run the focused test locally or in the governed branch environment before publishing**

Run:

```bash
node --test tests/wp0/v21-product-ai-companion-private-quest-p0.test.js
```

Expected on the authorization-merge baseline: FAIL because `ProductExperienceShell` still mounts `LearningWorkspace`, `RelationshipAssistant` still exposes `Letta / Agents / Recent context`, and it does not yet have the Private Quest hierarchy.

- [ ] **Step 3: Immutable/topology preflight before the first governed commit**

Fresh-read `main`, authorization merge topology, trusted `shared/release/implementationBranchPolicy.js`, exact authorization JSON, branch name, allowed failure-first path/digest and required trailers. Do not create the governed commit if any exact field is uncertain.

- [ ] **Step 4: Commit only the test file**

```bash
git add tests/wp0/v21-product-ai-companion-private-quest-p0.test.js
git commit -m "test(v21): freeze Product Private Quest failure-first contract"
```

- [ ] **Step 5: Push and collect fresh causal Stage RED on the exact tests-only head**

The Stage RED must fail on the new Private Quest contract while existing architecture routing/installation remains valid. Record exact RED head, run id and conclusion. If another same-root boundary is discovered, only another tests-only diagnostic commit is permitted before production.

---

### Task 2: Close the diagnostic window and freeze the Closure Matrix

**Files:**
- Test: `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`
- Read-only audit of authorized production files.

**Interfaces:**
- Consumes: fresh causal RED from Task 1 and any same-root diagnostic RED.
- Produces: `unknownBlockers = 0` and exact first-production-commit RED evidence.

- [ ] **Step 1: Audit every same-root boundary**

Classify exactly:

```text
ROOT_IMPLEMENTATION  ProductExperienceShell normal-path Learning mount
ROOT_IMPLEMENTATION  RelationshipAssistant technical/runtime presentation
PRESERVE             Parlant goal write/progress authority
PRESERVE             RelationshipProjectionAuthority summary/next/evidence
PRESERVE             #443 conversation-scoped evidence join
PRESERVE             Letta runtime ownership/readiness
PRESERVE             Element timeline/composer/navigation
NEGATIVE_PROOF       no agent-count/message-count/local-heuristic substitution
NEGATIVE_PROOF       no new AI/memory/journey/reply/relationship engine
NEGATIVE_PROOF       no new IPC/backend/database/workflow/dependency
```

- [ ] **Step 2: Add another tests-only diagnostic only if fresh evidence proves a same-root missing boundary**

Any diagnostic change must remain inside the authorization's failure-first test scope and obtain a new exact-head Stage RED. A newly required production path outside authorization requires a same-work-package scope amendment before use.

- [ ] **Step 3: Stop diagnostics only when `unknownBlockers = 0`**

The latest exact causal RED becomes the one bound to the first production commit.

---

### Task 3: Implement the relationship-native Private Quest root fix

**Files:**
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify: `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
- Modify: `integration/element-module/src/product-experience/RelationshipWorld.tsx`
- Modify only if required by the frozen contract: `integration/element-module/src/product-experience/experienceProjection.ts`
- Modify only if required by the frozen contract: `integration/element-module/src/product-experience/experienceTypes.ts`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`
- Test: `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`

**Interfaces:**
- Consumes: existing `RelationshipProjection.relationshipIntelligence`, existing `RelationshipAssistantProjection.goal`, existing Parlant mutation functions, existing Letta readiness signal.
- Produces: contextual `RelationshipAssistant` that receives the selected `relationship` projection and renders Private Quest without new authority.

- [ ] **Step 1: Remove the Learning admin workspace from the normal Product composition root**

In `ProductExperienceShell.tsx`:

```tsx
// remove
import { LearningWorkspace } from "../LearningWorkspace";

// remove from the normal render path
<LearningWorkspace />
```

Do not delete Learning files or runtime wiring outside this Product composition path.

- [ ] **Step 2: Pass the selected relationship into the companion**

Change the call site to:

```tsx
<RelationshipAssistant
  relationship={selectedRelationship}
  onStateChange={setAiState}
/>
```

Change `RelationshipAssistantProps` to:

```ts
type RelationshipAssistantProps = {
  relationship: RelationshipProjection;
  onStateChange?: (state: RelationshipAiState) => void;
};
```

Use `relationship.id` for the existing Parlant/Letta projection load; do not create a second selected-person state.

- [ ] **Step 3: Preserve the existing authority load and mutation flow**

Keep these existing operations unchanged in authority:

```ts
loadRelationshipAssistant(relationship.id)
updateRelationshipGoal(relationship.id, goalText)
setRelationshipGoalPaused(relationship.id, paused)
deleteRelationshipGoal(relationship.id)
```

No new bridge call is required for relationship insight: consume `relationship.relationshipIntelligence` already delivered by #443.

- [ ] **Step 4: Replace runtime telemetry UI with the Private Quest hierarchy**

Render only relationship-native sections equivalent to:

```tsx
<aside className="yance-assistant" aria-label="Private Quest">
  <header>
    <div>
      <span className="yance-eyebrow">Private Quest</span>
      <strong>Stay close to what matters with {relationship.name}</strong>
    </div>
    <span className="yance-agent-dot" data-ready={projection?.agentReady || undefined} aria-hidden="true" />
  </header>

  <section aria-labelledby="yance-private-quest-intention">
    <h3 id="yance-private-quest-intention">Current intention</h3>
    {/* existing goal textarea + Save/Pause/Remove controls */}
  </section>

  <section aria-labelledby="yance-private-quest-progress">
    <h3 id="yance-private-quest-progress">Progress</h3>
    {projection?.goal.exists === true && projection.goal.progress.path.length
      ? <ol>{projection.goal.progress.path.map((step) => <li key={step}>{step}</li>)}</ol>
      : <p>Progress is not available yet.</p>}
  </section>

  <section aria-labelledby="yance-private-quest-insight">
    <h3 id="yance-private-quest-insight">Relationship insight</h3>
    <p>{relationship.relationshipIntelligence?.summary || relationship.relationshipIntelligence?.analysisStatusLabel || "No confirmed relationship insight yet."}</p>
  </section>

  <section aria-labelledby="yance-private-quest-next">
    <h3 id="yance-private-quest-next">Next step</h3>
    <p>{relationship.relationshipIntelligence?.next || "No trusted next step is available yet."}</p>
  </section>
</aside>
```

Do not render `Letta`, `Agents`, `Recent context`, provider/model names or raw runtime counts.

- [ ] **Step 5: Preserve truthful degradation**

Use existing `statusText()`/error paths for goal or AI-interaction readiness, but relationship insight must remain visible even when Letta is unavailable. Never use Letta/agent/conversation counts to fill `summary`, `next` or progress.

- [ ] **Step 6: Add only presentation CSS inside existing Product tokens**

Add bounded selectors under `.yance-assistant`, for example:

```css
.yance-private-quest-section {
  display: grid;
  gap: var(--yance-space-2);
}

.yance-private-quest-progress {
  margin: 0;
  padding-inline-start: 1.25rem;
}
```

Reuse existing typography, surface, focus and reduced-motion rules; introduce no new design system.

- [ ] **Step 7: Re-run focused contracts**

Run:

```bash
node --test tests/wp0/v21-product-ai-companion-private-quest-p0.test.js
node --test tests/wp0/v21-product-experience-shell-p0.test.js
node --test tests/wp0/v21-product-experience-shell-accessibility.test.js
node --test tests/wp0/v21-product-experience-shell-interaction.test.js
node --test tests/wp0/v21-parlant-workspace-contract.test.js
node --test tests/wp0/v21-product-relationship-intelligence-surface.test.js
node --test tests/wp0/v21-element-workspace-contract.test.js
```

Expected: all GREEN on the production head.

- [ ] **Step 8: Commit the first production implementation once with exact latest RED trailers**

Commit message shape:

```text
feat(v21): make relationship AI a Private Quest

Yance-Failure-First-Red-Head: <latest exact tests-only RED head>
Yance-Failure-First-Red-Run: <latest exact failing Stage run id>
Yance-Failure-First-Red-Conclusion: failure
Yance-Closure-Matrix-Unknown-Blockers: 0
```

Only authorized production paths may be present.

---

### Task 4: Exact-head closure and ordinary merge boundary

**Files:**
- No new scope unless a real same-root RED requires an authorized amendment.

**Interfaces:**
- Consumes: stable implementation exact head.
- Produces: merge-ready evidence, not an automatic merge authorization.

- [ ] **Step 1: Run/collect exact-head routed CI**

Collect and report truthfully:

```text
Stage / WP0
ACV2 WP-A
Layered / WP-A validation when triggered
Product Experience Final Validation when triggered
Graphiti validation when triggered
Model/sealed-runtime validation when triggered
```

A skipped job is reported as skipped, never GREEN.

- [ ] **Step 2: Independent exact-head review**

Review the complete authorized diff for P0/P1, authority drift, stale runtime telemetry, fabricated insight/progress/next, accessibility/focus regressions and any new infrastructure/dependency surface.

- [ ] **Step 3: Resolve review threads at the root**

No warning-only resolution or test weakening.

- [ ] **Step 4: Fresh anti-drift verification immediately before merge**

Verify exact `main`, PR head/base, changed paths/digest, mergeability, required CI conclusions and unresolved thread count.

- [ ] **Step 5: Stop at the final ordinary-merge owner boundary**

Use ordinary merge only after owner confirmation. Never squash or rebase.
