# V21 Product AI Companion / Private Quest P0 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected-person AI experience a truthful, hidden-by-default Private Quest composed from existing Parlant goal/progress and RelationshipProjectionAuthority insight/next data, while removing the stale permanent Learning admin mount from the normal People/Relationship Product path.

**Architecture:** Preserve Element/Matrix, Parlant, Graphiti/Neo4j, Letta and Learning as existing domain authorities. The root fix is a thin Product composition cutover: migrate the stale executable Learning UI consumer contract, remove `LearningWorkspace` from `ProductExperienceShell`, and evolve `RelationshipAssistant` into a relationship-native Private Quest using data already present on the selected `RelationshipProjection` plus the existing assistant projection. No new read model, IPC, route, storage, dependency, engine or shared infrastructure is required.

**Tech Stack:** React / TypeScript / Element module Product Experience / existing Electron desktop APIs / existing Parlant goal APIs / RelationshipProjectionAuthority projection / Motion / Rive / Node `node:test` contracts.

## Global Constraints

- Work package: `V21-PRODUCT-AI-COMPANION-PRIVATE-QUEST-P0-V1`.
- Implementation may start only from the effective ordinary two-parent authorization merge.
- Fast Closure V2 is mandatory: exact tests-only first commit → fresh causal Stage RED → optional same-root tests-only diagnostics → Closure Matrix `unknownBlockers = 0` → first production commit bound to the latest RED.
- Product thesis: People-first, AI invisible, current-person continuity, Relationship World as normal context.
- Exact authorized implementation scope is five paths total: two failure-first tests plus three production Product paths.
- Failure-first scope is exactly:
  - `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`
  - `tests/wp0/v21-learning-growth-brain-ui.test.js`
- Production scope is exactly:
  - `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
  - `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
  - `integration/element-module/src/product-experience/ProductExperienceShell.css`
- `RelationshipWorld.tsx`, `experienceProjection.ts` and `experienceTypes.ts` are preservation evidence and are not modified in this P0.
- Element / Matrix remains conversation/timeline/composer/navigation authority.
- Parlant remains Goal/Journey authority; existing goal write APIs remain unchanged.
- Graphiti + Neo4j + RelationshipProjectionAuthority remain relationship inference/projection authority.
- Letta remains long-term Agent/runtime authority; raw runtime inventory is not normal Product UX.
- Learning runtime/admin workspace remains intact; only its stale mandatory Product mount contract is migrated.
- No new dependency, workflow, IPC channel, preload API, backend route, database, cache, service, sidecar, memory engine, journey engine, reply engine, relationship engine or general-purpose Yance infrastructure.
- No local social heuristic, message count, Letta agent/conversation count or Learning evidence may substitute for relationship intelligence.
- No fabricated insight, next step, progress, suggested reply, memory hint or readiness state.
- Existing #443 conversation-scoped relationship evidence join remains unchanged.
- No squash, rebase, force push, published-history amend, gate weakening or permissive fallback.
- Final implementation merge is ordinary/two-parent only after exact-head routed CI, independent review, zero unresolved threads and fresh-main anti-drift.

---

## File Structure

- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js` — new failure-first/final Product contract for relationship-native Private Quest and authority preservation.
- `tests/wp0/v21-learning-growth-brain-ui.test.js` — migrate the stale executable consumer contract: Learning capability remains present, but normal Product no longer permanently mounts Learning admin.
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx` — remove permanent `LearningWorkspace` mount and pass the selected relationship into the existing contextual assistant.
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx` — preserve Parlant mutations/Letta readiness while presenting only relationship-native Private Quest content.
- `integration/element-module/src/product-experience/ProductExperienceShell.css` — bounded Private Quest presentation using existing Product tokens.

---

### Task 1: Freeze the complete same-root failure-first contract

**Files:**
- Create: `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`
- Modify: `tests/wp0/v21-learning-growth-brain-ui.test.js`

**Interfaces:**
- Consumes current Product and Learning source without production changes.
- Produces a two-test-path causal contract proving both sides of the composition mismatch before implementation.

- [ ] **Step 1: Create the Private Quest failure-first test**

Use source-level assertions equivalent to:

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
const projection = () => read('integration/element-module/src/product-experience/experienceProjection.ts');

test('normal Product path is people-first and does not permanently mount Learning admin', () => {
  assert.doesNotMatch(shell(), /import\s+\{\s*LearningWorkspace\s*\}|<LearningWorkspace\s*\/>/u);
});

test('selected relationship is passed into a relationship-native Private Quest', () => {
  assert.match(shell(), /<RelationshipAssistant[\s\S]*relationship=\{selectedRelationship\}/u);
  const source = assistant();
  assert.match(source, /RelationshipProjection/u);
  assert.match(source, /Private Quest/u);
  assert.match(source, /Current intention/u);
  assert.match(source, /Progress/u);
  assert.match(source, /Relationship insight/u);
  assert.match(source, /Next step/u);
  assert.doesNotMatch(source, /<dt>Letta<\/dt>|<dt>Agents<\/dt>|Recent context/u);
});

test('Private Quest preserves existing Parlant and conversation-scoped relationship authorities', () => {
  const source = projection();
  assert.match(source, /getParlantRelationshipGoal/u);
  assert.match(source, /relationshipConversationIdsByContactId/u);
  assert.match(source, /relationshipIntelligence\[conversationId\]/u);
  assert.doesNotMatch(source, /relationshipIntelligence\[stableContactId\]/u);
  assert.doesNotMatch(source, /relationshipPotential|customer_social_state|social_rule_projection|message_baseline/u);
});
```

The test reads `experienceProjection.ts` only as preservation evidence; that file is outside production change scope.

- [ ] **Step 2: Migrate the executable Learning Product-consumer contract tests-only**

In `tests/wp0/v21-learning-growth-brain-ui.test.js`, preserve all assertions that prove `LearningWorkspace` still contains its Learning admin/tool-ui/privacy/consent capability. Preserve `YanceWorkspace -> ProductExperienceShell` and the absence of a direct `YanceWorkspace -> LearningWorkspace` mount.

Replace only the obsolete requirement that `ProductExperienceShell` must contain `LearningWorkspace` with the successor contract:

```js
assert.doesNotMatch(productShell, /LearningWorkspace/u);
```

This is not test weakening: the Learning capability assertions remain, while the superseded normal-path Product composition requirement is replaced by the Living Relationship OS consumer contract.

- [ ] **Step 3: Focused baseline check before publishing the governed commit**

Run:

```bash
node --test \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-learning-growth-brain-ui.test.js
```

Expected on the effective authorization-merge baseline: RED because production still mounts `LearningWorkspace`, still passes only `relationshipId`, and still renders `Letta / Agents / Recent context` rather than Private Quest.

- [ ] **Step 4: Mandatory immutable/topology preflight**

Fresh-read:

- trusted `main` and effective authorization merge topology;
- exact authorization JSON;
- base-owned `shared/release/implementationBranchPolicy.js`;
- implementation branch exact name;
- five-path implementation set/count/digest;
- two-path failure-first set/count/digest;
- first-commit and diagnostic-window semantics;
- exact trailer keys and validation rules.

Do not create the immutable commit if any item is uncertain.

- [ ] **Step 5: Commit exactly the two test paths**

```bash
git add \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-learning-growth-brain-ui.test.js
git commit -m "test(v21): freeze Product Private Quest cutover"
```

- [ ] **Step 6: Push and collect a fresh causal Stage RED on that exact head**

The RED must be attributable to the new/migrated Product contracts while routing/install/base policy remain valid. Record exact RED head, Stage run id and conclusion. Production remains forbidden.

---

### Task 2: Close the Fast Closure V2 diagnostic window

**Files:**
- Test-only scope remains the exact two failure-first test paths.
- All production paths are read-only during diagnosis.

**Interfaces:**
- Consumes exact-head causal RED evidence.
- Produces a complete Closure Matrix and `unknownBlockers = 0`.

- [ ] **Step 1: Classify every known same-root boundary**

```text
ROOT_IMPLEMENTATION  ProductExperienceShell normal-path Learning mount
ROOT_IMPLEMENTATION  stale executable Learning consumer composition contract
ROOT_IMPLEMENTATION  RelationshipAssistant technical/runtime presentation
PRESERVE             Parlant goal write/progress authority
PRESERVE             RelationshipProjectionAuthority summary/next/evidence
PRESERVE             #443 conversation-scoped evidence join
PRESERVE             Learning runtime/admin workspace capability
PRESERVE             Letta runtime ownership/readiness
PRESERVE             Element timeline/composer/navigation
NEGATIVE_PROOF       no agent-count/message-count/local-heuristic substitution
NEGATIVE_PROOF       no new AI/memory/journey/reply/relationship engine
NEGATIVE_PROOF       no new IPC/backend/database/workflow/dependency
```

- [ ] **Step 2: Add another diagnostic commit only for a newly proven same-root boundary**

Any diagnostic delta must stay inside the two authorized test paths and obtain its own fresh exact-head Stage RED. If a new production path becomes necessary, stop and merge a same-work-package scope amendment before production uses it.

- [ ] **Step 3: Close diagnostics only at `unknownBlockers = 0`**

Bind the latest exact tests-only RED to the first production commit.

---

### Task 3: Implement the root Product composition cutover

**Files:**
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify: `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`

**Interfaces:**
- Consumes existing `RelationshipProjection.relationshipIntelligence`, `RelationshipAssistantProjection.goal`, existing Parlant mutation helpers and internal Letta readiness.
- Produces no new authority or storage; only relationship-native presentation/composition.

- [ ] **Step 1: Remove Learning admin from the normal Product path**

In `ProductExperienceShell.tsx`, remove:

```tsx
import { LearningWorkspace } from "../LearningWorkspace";
```

and remove:

```tsx
<LearningWorkspace />
```

Do not modify or delete `LearningWorkspace.tsx`, Learning runtime code, Learning OSS config or Learning admin capability.

- [ ] **Step 2: Pass the selected relationship directly into the existing assistant**

Change the render call to:

```tsx
<RelationshipAssistant
  relationship={selectedRelationship}
  onStateChange={setAiState}
/>
```

No second selected-person state is allowed.

- [ ] **Step 3: Change `RelationshipAssistant` props without changing authorities**

Use:

```ts
import type {
  RelationshipAiState,
  RelationshipAssistantProjection,
  RelationshipProjection,
} from "./experienceTypes";

type RelationshipAssistantProps = {
  relationship: RelationshipProjection;
  onStateChange?: (state: RelationshipAiState) => void;
};
```

Use `relationship.id` everywhere the existing code currently uses `relationshipId`:

```ts
loadRelationshipAssistant(relationship.id)
updateRelationshipGoal(relationship.id, goalText)
setRelationshipGoalPaused(relationship.id, paused)
deleteRelationshipGoal(relationship.id)
```

Do not modify `experienceProjection.ts` or create a new bridge/API.

- [ ] **Step 4: Replace runtime telemetry with the Private Quest hierarchy**

Render relationship-native sections:

```tsx
<aside className="yance-assistant" aria-label="Private Quest">
  <header>
    <div>
      <span className="yance-eyebrow">Private Quest</span>
      <strong>Stay close to what matters with {relationship.name}</strong>
    </div>
    <span className="yance-agent-dot" data-ready={projection?.agentReady || undefined} aria-hidden="true" />
  </header>

  <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-intention">
    <h3 id="yance-private-quest-intention">Current intention</h3>
    {/* preserve the existing goal textarea and Save/Pause/Remove mutations */}
  </section>

  <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-progress">
    <h3 id="yance-private-quest-progress">Progress</h3>
    {projection?.goal.exists === true && projection.goal.progress.path.length
      ? <ol className="yance-private-quest-progress">{projection.goal.progress.path.map((step) => <li key={step}>{step}</li>)}</ol>
      : <p>Progress is not available yet.</p>}
  </section>

  <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-insight">
    <h3 id="yance-private-quest-insight">Relationship insight</h3>
    <p>{relationship.relationshipIntelligence?.summary || relationship.relationshipIntelligence?.analysisStatusLabel || "No confirmed relationship insight yet."}</p>
  </section>

  <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-next">
    <h3 id="yance-private-quest-next">Next step</h3>
    <p>{relationship.relationshipIntelligence?.next || "No trusted next step is available yet."}</p>
  </section>
</aside>
```

Do not render user-facing `Letta`, agent count, recent Letta conversation count, provider/model identity or raw runtime inventory.

- [ ] **Step 5: Preserve truthful degradation**

- No goal: neutral invitation/current-intention input remains available when authority permits.
- Goal authority unavailable: show existing explicit status; relationship insight remains independent.
- Relationship intelligence pending/empty: use authority status or explicit no-confirmed-insight/no-trusted-next wording.
- Letta unavailable: degrade only internal AI interaction readiness; do not hide Parlant goal or relationship intelligence.
- Never infer progress/summary/next from counts, messages, Learning evidence or legacy social fields.

- [ ] **Step 6: Add bounded CSS only**

Use existing Product tokens and patterns, for example:

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

Preserve existing focus/accessibility/reduced-motion rules and introduce no new design system.

- [ ] **Step 7: Create the first production commit once with exact latest RED trailers**

Commit message shape:

```text
feat(v21): make relationship AI a Private Quest

Yance-Failure-First-Red-Head: <latest exact tests-only RED head>
Yance-Failure-First-Red-Run: <latest exact failing Stage run id>
Yance-Failure-First-Red-Conclusion: failure
Yance-Closure-Matrix-Unknown-Blockers: 0
```

The production delta must contain only the exact three authorized Product paths.

---

### Task 4: Focused regression closure

**Files:**
- No scope expansion.

- [ ] **Step 1: Run the complete focused set**

```bash
node --test \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-learning-growth-brain-ui.test.js \
  tests/wp0/v21-product-experience-shell-p0.test.js \
  tests/wp0/v21-product-experience-shell-accessibility.test.js \
  tests/wp0/v21-product-experience-shell-interaction.test.js \
  tests/wp0/v21-parlant-workspace-contract.test.js \
  tests/wp0/v21-product-relationship-intelligence-surface.test.js \
  tests/wp0/v21-element-workspace-contract.test.js
```

Expected: all GREEN.

- [ ] **Step 2: Verify preservation explicitly**

Confirm from unchanged source/tests:

- LearningWorkspace/admin/tool-ui/privacy/consent capability still exists and is tested.
- `experienceProjection.ts` still uses the existing Parlant APIs.
- #443 still maps contact -> conversation ids and reads relationship intelligence by conversation id.
- Element timeline/composer integration is unchanged.
- no new dependency/workflow/IPC/backend/database path entered the diff.

---

### Task 5: Exact-head closure and final ordinary-merge boundary

**Files:**
- No new scope unless a real same-root RED requires a merged authorization amendment.

- [ ] **Step 1: Collect exact-head routed CI**

Truthfully report:

```text
Stage / WP0
ACV2 WP-A
Layered / WP-A when triggered
Product Experience Final Validation when triggered
Graphiti validation when triggered
Model/sealed-runtime validation when triggered
```

A skipped workflow/job is reported as skipped, never GREEN.

- [ ] **Step 2: Independent exact-head review**

Review all five authorized changed paths for P0/P1, authority drift, stale runtime telemetry, fabricated insight/progress/next, test weakening, accessibility/focus regressions and any new infrastructure/dependency surface.

- [ ] **Step 3: Resolve all review threads at the root**

No warning-only closure, bypass or assertion weakening.

- [ ] **Step 4: Fresh anti-drift verification immediately before merge**

Verify fresh `main`, exact PR head/base, five-path scope/digest, topology, required CI conclusions, mergeability and zero unresolved threads.

- [ ] **Step 5: Stop at the final owner merge boundary**

Only after owner confirmation, ordinary merge with exact-head protection. Never squash or rebase.
