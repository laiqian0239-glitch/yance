# V21 Product Relationship Universe Immersive P0 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a truthful, Chinese, immersive `关系宇宙` to People Home while keeping `列表` as the default entry, preserving current-person continuity into the existing Relationship World, and translating the normal Product relationship chrome without creating a second relationship/graph authority.

**Architecture:** `ProductExperienceShell` owns ephemeral People Home mode/focus and selected-person continuity; `PeopleSurface` remains the single People Home authority and renders both list and deterministic radial constellation modes. The universe is presentation-only over existing `RelationshipProjection` data: center `我`, one uniform spoke per relationship, no person-to-person edges or relationship scoring. Existing Element/Matrix, RelationshipProjectionAuthority/Graphiti, Parlant, Letta, Base UI, Motion, Rive, Howler, search/translation, and child-workspace authorities remain unchanged.

**Tech Stack:** React / TypeScript / Element module Product Experience / existing Base UI 1.7.0 / Motion 12.42.2 / Rive React Canvas 4.31.0 / existing Product CSS tokens / Node `node:test` source and behavior contracts.

## Global Constraints

- Work package: `V21-PRODUCT-RELATIONSHIP-UNIVERSE-IMMERSIVE-P0-V1`.
- Design baseline: trusted `main@8953ee98f99e615dfb6a0e26745764593696ae8d`; formal implementation must use the later effective fresh-main authorization merge, not this documentation baseline.
- Product choice: **C full immersive relationship universe + A list-default entry**.
- Fast Closure V2: exact six-path tests-only first commit → fresh exact-head causal Stage RED → optional same-root tests-only diagnostics → Closure Matrix `unknownBlockers = 0` → first production commit bound to the latest RED.
- Failure-first scope is exactly 6 paths, digest `7208e33efc9e5c470f5ad90ce61a12977044b2f0c88cc35092f62349dfd4cc94`.
- Production scope is exactly 9 paths, digest `a542f650304b9c0fc8f0ba21555fcfe5659c5fd6ebc6d1bfa909390cf721e54b`.
- Total implementation scope is exactly 15 paths, digest `eeec2eb0ebd3210f5bc4d83128324a1f2e9b7490e626a22cc58f4cfbed4f4f88`.
- Do not add `RelationshipUniverse.tsx`; `PeopleSurface.tsx` remains the exact-routed People Home authority.
- Default People Home mode is `list`; switching to `universe` is always explicit.
- Universe topology is only center `我` → each existing relationship. No person-to-person edges.
- Position/ring/size/color/motion must not represent affection, relationship strength, importance, compatibility, priority, or influence.
- `RelationshipProjection.relationshipIntelligence` remains the only Product relationship-intelligence projection.
- `experienceProjection.ts` customer → conversation → relationship-intelligence join remains unchanged.
- Element / Matrix remains conversation/timeline/composer/room/navigation authority.
- Parlant remains Goal/Journey authority. Letta remains Agent/memory runtime authority.
- Search and durable translation-job authority remain unchanged.
- Media / Presence / Voice / Learning workspaces remain child authorities; this package translates only their Product host/chrome.
- Internal enum/runtime keys stay stable. Visible Product chrome follows the Chinese copy frozen in the design spec.
- Use existing Base UI / Motion / Rive / Howler primitives. No Sigma.js, Cytoscape.js, React Flow, Graphology, D3-force, or new graph dependency in this P0.
- No new dependency, workflow, routing-policy mutation, IPC channel, preload API, backend route, database, service, cache, sidecar, social-graph engine, layout engine, relationship engine, or general-purpose Yance infrastructure.
- No timers or force simulation for universe motion. Reduced-motion mode is static.
- No gamification or relationship score vocabulary.
- No squash, rebase, force push, published-history amend, test weakening, warning-only closure, or permissive fallback.
- Final implementation merge is ordinary/two-parent only after exact-head routed gates, independent P0=0/P1=0 review, unresolved threads=0, and fresh-main anti-drift.

---

## File Structure

### Failure-first / executable contract paths

- `tests/wp0/v21-product-relationship-universe-immersive-p0.test.js` — new root contract for list-default + universe, deterministic truth semantics, focus/selection continuity, Chinese Product shell, and negative graph proof.
- `tests/wp0/v21-product-relationship-intelligence-surface.test.js` — migrate People/World visible-copy assertions to the Chinese successor contract while preserving relationship authority/provenance checks.
- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js` — migrate visible Private Quest and Learning-control copy to Chinese while preserving Parlant/relationship-authority semantics.
- `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js` — migrate visible search/translation controls to Chinese while preserving durable job lifecycle and navigation assertions.
- `tests/wp0/v21-product-experience-shell-interaction.test.js` — migrate visible relationship-tool labels to Chinese while preserving action kinds, Popover, Rive internal states, and Howler policy.
- `tests/wp0/v21-product-experience-shell-accessibility.test.js` — migrate reduced-motion visible Rive state contract and add universe keyboard/non-color-only coverage without changing Base UI/focus authority.

### Production paths

- `integration/element-module/src/product-experience/PeopleSurface.tsx` — People Home list/universe modes, deterministic constellation, focus rail, Chinese People copy.
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx` — default-list state, focus continuity, stale-focus cleanup, Chinese shell/settings copy.
- `integration/element-module/src/product-experience/RelationshipWorld.tsx` — Chinese Relationship World and authority-aware relationship-intelligence presentation.
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx` — Chinese relationship-native Private Quest copy only; Parlant/Letta semantics unchanged.
- `integration/element-module/src/product-experience/BilingualSearchPanel.tsx` — Chinese Product search/translation lifecycle copy only; behavior unchanged.
- `integration/element-module/src/product-experience/ProductComposerAccessory.tsx` — Chinese relationship-tool labels and user-oriented hints; existing action kinds unchanged.
- `integration/element-module/src/product-experience/RelationshipOverlayHost.tsx` — Chinese host copy and no raw Matrix room id in normal chrome; child workspace authority unchanged.
- `integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx` — Chinese visible/accessibility mapping for existing seven internal states.
- `integration/element-module/src/product-experience/ProductExperienceShell.css` — universe stage, nodes, spokes, focus rail, responsive/reduced-motion styling using existing `--yance-*` tokens.

---

## Task 1: Freeze the complete failure-first Product contract

**Files:**
- Create: `tests/wp0/v21-product-relationship-universe-immersive-p0.test.js`
- Modify: the other five failure-first test paths listed above.

**Interfaces:**
- Consumes the effective authorization-merge baseline with no production changes.
- Produces the exact tests-only causal contract for universe behavior, Chinese real UI, preservation, and negative graph proof.

- [ ] **Step 1: Create the new root universe contract**

Use source assertions with this structure:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shell = () => read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const people = () => read('integration/element-module/src/product-experience/PeopleSurface.tsx');
const css = () => read('integration/element-module/src/product-experience/ProductExperienceShell.css');
const pkg = () => JSON.parse(read('integration/element-module/package.json'));

test('People Home defaults to list and exposes an explicit relationship universe peer view', () => {
  const shellSource = shell();
  const peopleSource = people();
  assert.match(shellSource, /useState<[^>]*PeopleHomeView[^>]*>\("list"\)|useState\("list"\)/u);
  assert.match(peopleSource, /列表/u);
  assert.match(peopleSource, /关系宇宙/u);
  assert.match(peopleSource, /viewMode/u);
  assert.match(peopleSource, /onViewModeChange/u);
  assert.doesNotMatch(shellSource, /useState<[^>]*PeopleHomeView[^>]*>\("universe"\)|useState\("universe"\)/u);
});

test('relationship universe is user-centered and does not invent contact-to-contact graph authority', () => {
  const source = people();
  assert.match(source, />我</u);
  assert.match(source, /relationships\.map/u);
  assert.match(source, /进入关系世界/u);
  assert.match(source, /focusedRelationshipId/u);
  assert.match(source, /relationship\.relationshipIntelligence/u);
  assert.doesNotMatch(source, /relationshipPotential|affection|closeness|compatibility|influence|priorityScore/iu);
  assert.doesNotMatch(source, /sourceId|targetId|personToPerson|contactEdges|socialGraph/iu);
});

test('Product shell preserves universe mode and focus across Relationship World selection', () => {
  const source = shell();
  assert.match(source, /focusedRelationshipId/u);
  assert.match(source, /peopleHomeView/u);
  assert.match(source, /onFocus/u);
  assert.match(source, /onSelect/u);
  assert.match(source, /clearSelectedRelationship/u);
  assert.match(source, /setFocusedRelationshipId\(""\)/u);
  assert.doesNotMatch(source, /setPeopleHomeView\("list"\)[\s\S]{0,160}clearSelectedRelationship/u);
});

test('normal Product relationship chrome is Chinese and graph dependencies are not added', () => {
  const productPackage = pkg();
  const source = `${shell()}\n${people()}`;
  assert.match(source, /我的关系/u);
  assert.match(source, /体验设置/u);
  assert.match(source, /正在加载关系|关系数据暂不可用/u);
  for (const dependency of ['sigma', 'graphology', 'cytoscape', '@xyflow/react', 'd3-force']) {
    assert.equal(Object.hasOwn(productPackage.dependencies || {}, dependency), false);
  }
});

test('universe presentation uses existing Product motion and reduced-motion contracts', () => {
  const source = `${people()}\n${css()}`;
  assert.match(source, /motion\./u);
  assert.match(source, /reducedMotion/u);
  assert.match(source, /yance-relationship-universe/u);
  assert.doesNotMatch(source, /setInterval\s*\(|requestAnimationFrame\s*\(|forceSimulation\s*\(/u);
});
```

The final exact regex details may be tightened to the implemented code shape, but the semantic assertions above may not be weakened.

- [ ] **Step 2: Migrate relationship-intelligence visible-copy assertions**

In `v21-product-relationship-intelligence-surface.test.js`:

- preserve all bridge/join/provenance/forbidden-heuristic assertions;
- migrate the People aria assertion from English to:

```js
assert.match(people, /打开与 \$\{relationship\.name\} 的关系。\$\{analysisStatusLabel\}/u);
```

- require Chinese visible labels in `RelationshipWorld`:

```js
for (const label of ['关系世界', '关系智能', 'AI 分析', '证据来源', '阶段', '关系摘要', '下一步']) {
  assert.match(world, new RegExp(label, 'u'));
}
```

- continue requiring Graphiti provenance and user annotation semantics.

- [ ] **Step 3: Migrate Private Quest visible-copy assertions**

In `v21-product-ai-companion-private-quest-p0.test.js`, preserve the selected `RelationshipProjection`, Parlant, conversation-scoped intelligence, and Learning gated-reachability assertions. Replace visible English expectations with:

```js
for (const label of ['关系私密任务', '当前意图', '进展', '关系洞察', '下一步']) {
  assert.match(source, new RegExp(label, 'u'));
}
assert.match(shell(), /学习控制/u);
```

Continue forbidding user-facing Letta/Agents/Recent-context telemetry.

- [ ] **Step 4: Migrate search/translation visible controls without weakening lifecycle checks**

In `v21-product-experience-bilingual-search-translation-task-ux.test.js`, keep every existing job lifecycle, bounded polling, race, navigation, CSS-token, and API authority assertion. Replace only superseded visible labels:

```js
assert.match(panel, />\s*取消\s*</u);
assert.match(panel, />\s*重试\s*</u);
assert.match(panel, /翻译任务/u);
assert.match(panel, /消息、姓名或中文翻译/u);
```

- [ ] **Step 5: Migrate relationship-tool copy while preserving action kinds**

In `v21-product-experience-shell-interaction.test.js`, require visible labels:

```js
for (const label of ['照片', '语音', '实时陪伴', '附件']) {
  assert.match(accessory, new RegExp(label, 'u'));
}
for (const kind of ['photo', 'voice', 'live', 'attachment']) {
  assert.match(accessory, new RegExp(`kind:\\s*["']${kind}["']`, 'u'));
}
```

Keep existing Popover, roomId, Rive internal state, and Howler assertions.

- [ ] **Step 6: Migrate reduced-motion visible-state accessibility contract**

In `v21-product-experience-shell-accessibility.test.js`, preserve Base UI, reduced-motion, focus-visible, `aria-live`, and no-gamification checks. Replace the raw `{state}` visible contract with an explicit translated label lookup contract, for example:

```js
assert.match(rive, /RELATIONSHIP_STATE_LABELS/u);
for (const label of ['静默', '唤醒', '倾听', '思考', '就绪', '表达', '异常']) {
  assert.match(rive, new RegExp(label, 'u'));
}
assert.match(rive, /RELATIONSHIP_STATE_LABELS\[state\]/u);
```

Also require `PeopleSurface` universe controls to remain real buttons and expose semantic selected/focus state.

- [ ] **Step 7: Run the six-path focused baseline**

Run:

```bash
node --test \
  tests/wp0/v21-product-relationship-universe-immersive-p0.test.js \
  tests/wp0/v21-product-relationship-intelligence-surface.test.js \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js \
  tests/wp0/v21-product-experience-shell-interaction.test.js \
  tests/wp0/v21-product-experience-shell-accessibility.test.js
```

Expected on the effective authorization-merge baseline: RED only for the new universe / Chinese successor contracts. Existing authority-preservation assertions should remain GREEN.

- [ ] **Step 8: Run mandatory immutable/topology preflight before committing**

Fresh-read and verify:

- effective authorization merge is ordinary/two-parent and rooted in the authorization’s exact trusted main;
- implementation branch starts exactly at that merge;
- authorization parser recognizes exact branch and scope;
- six-path failure-first digest is exactly `7208e33efc9e5c470f5ad90ce61a12977044b2f0c88cc35092f62349dfd4cc94`;
- total fifteen-path digest is exactly `eeec2eb0ebd3210f5bc4d83128324a1f2e9b7490e626a22cc58f4cfbed4f4f88`;
- all nine production paths are already PRODUCT_WP0-routed on trusted main;
- no open PR overlaps the fifteen implementation paths;
- `experienceProjection.ts` still joins relationship intelligence through conversation identity;
- package dependencies still require no graph library.

Fail closed before the immutable commit if any proof is false or uncertain.

- [ ] **Step 9: Commit exactly the six tests**

```bash
git add \
  tests/wp0/v21-product-relationship-universe-immersive-p0.test.js \
  tests/wp0/v21-product-relationship-intelligence-surface.test.js \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js \
  tests/wp0/v21-product-experience-shell-interaction.test.js \
  tests/wp0/v21-product-experience-shell-accessibility.test.js
git commit -m "test(v21): freeze immersive relationship universe"
```

- [ ] **Step 10: Push and capture fresh causal Stage RED on that exact head**

The Stage run must prove valid Product routing/install/policy and fail specifically on the frozen successor Product contracts. Record the exact RED head, exact Stage run id, failing test groups, and conclusion. Production remains forbidden.

---

## Task 2: Close the Fast Closure V2 diagnostic window

**Files:**
- Tests-only scope remains exactly the six failure-first paths.
- Production paths are read-only during diagnosis.

**Interfaces:**
- Consumes fresh exact-head causal RED evidence.
- Produces a Closure Matrix with `Unknown blockers = 0` and binds the latest RED to the first production commit.

- [ ] **Step 1: Classify the known boundaries**

```text
ROOT_IMPLEMENTATION  PeopleSurface list-only -> list/universe People Home
ROOT_IMPLEMENTATION  deterministic radial constellation presentation
ROOT_IMPLEMENTATION  universe focus-only insight rail and CTA
ROOT_IMPLEMENTATION  Product shell list-default/view/focus continuity
ROOT_IMPLEMENTATION  Chinese Product relationship chrome
ROOT_IMPLEMENTATION  Chinese visible Rive state mapping
ROOT_IMPLEMENTATION  successor executable visible-copy contracts
PRESERVE             RelationshipProjection identity/schema
PRESERVE             conversation-scoped RelationshipProjectionAuthority join
PRESERVE             Graphiti/Neo4j inference authority
PRESERVE             Parlant goal/progress mutations
PRESERVE             Letta runtime/internal readiness
PRESERVE             Element timeline/composer/room/navigation
PRESERVE             durable search/translation job lifecycle
PRESERVE             Media/Presence/Voice/Learning child authorities
PRESERVE             Base UI/Motion/Rive/Howler primitive ownership
NEGATIVE_PROOF       no contact-to-contact edges
NEGATIVE_PROOF       no relationship score/strength/priority/affection
NEGATIVE_PROOF       no local heuristic/count/runtime-telemetry substitution
NEGATIVE_PROOF       no graph engine/force simulation/new graph dependency
NEGATIVE_PROOF       no new IPC/backend/database/workflow/service/cache/sidecar
```

- [ ] **Step 2: Use a tests-only diagnostic commit only when fresh RED proves another same-root executable boundary**

Any diagnostic must stay within the six test paths and obtain a new exact-head Stage RED. If a new production path is required, stop production and use the same-work-package scope-amendment mechanism first.

- [ ] **Step 3: Close only when every failure is classified and `unknownBlockers = 0`**

The first production commit must bind the latest causal RED, not an earlier diagnostic head.

---

## Task 3: Implement list-default People Home and the immersive relationship universe

**Files:**
- Modify: `integration/element-module/src/product-experience/PeopleSurface.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`

**Interfaces:**
- Consumes: `readonly RelationshipProjection[]`, existing selected relationship session, `reducedMotion`.
- Produces: list/universe peer views, ephemeral focus, deterministic presentation coordinates, insight rail, existing relationship selection only.

- [ ] **Step 1: Add the local People Home view contract**

In `PeopleSurface.tsx` export or define a small UI-only type:

```ts
export type PeopleHomeView = "list" | "universe";
```

Use props:

```ts
type PeopleSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  selectedRelationshipId: string;
  focusedRelationshipId: string;
  viewMode: PeopleHomeView;
  reducedMotion: boolean;
  onViewModeChange: (view: PeopleHomeView) => void;
  onFocus: (relationshipId: string) => void;
  onSelect: (relationshipId: string) => void;
};
```

Do not add a domain model or change `experienceTypes.ts`.

- [ ] **Step 2: Move People Home mode/focus ownership into the shell**

In `ProductExperienceShell.tsx`:

```ts
const [peopleHomeView, setPeopleHomeView] = useState<PeopleHomeView>("list");
const [focusedRelationshipId, setFocusedRelationshipId] = useState("");
```

Pass them into `PeopleSurface`:

```tsx
<PeopleSurface
  relationships={relationships}
  selectedRelationshipId={session.selectedRelationshipId}
  focusedRelationshipId={focusedRelationshipId}
  viewMode={peopleHomeView}
  reducedMotion={preferences.reducedMotion}
  onViewModeChange={setPeopleHomeView}
  onFocus={setFocusedRelationshipId}
  onSelect={chooseRelationship}
/>
```

Do not reset `peopleHomeView` when `selectedRelationshipId` changes.

- [ ] **Step 3: Clear stale focus during existing relationship refresh**

After successful `loadRelationshipProjections()`:

```ts
setFocusedRelationshipId((current) => (
  current && !next.some((row) => row.id === current) ? "" : current
));
```

Keep the existing selected-relationship invalidation behavior separately.

- [ ] **Step 4: Implement explicit List / Universe switching**

Render semantic buttons above the People Home content:

```tsx
<div className="yance-people-view-switch" aria-label="关系视图">
  <button
    type="button"
    aria-pressed={viewMode === "list"}
    onClick={() => onViewModeChange("list")}
  >
    列表
  </button>
  <button
    type="button"
    aria-pressed={viewMode === "universe"}
    onClick={() => onViewModeChange("universe")}
  >
    关系宇宙
  </button>
</div>
```

Switching views must not call `onSelect`.

- [ ] **Step 5: Keep the list path intact, only translating visible copy**

Continue mapping the same `relationships` array to real buttons. Use:

```tsx
<span className="yance-eyebrow">关系</span>
<h2>我的关系</h2>
```

Fallback relationship status:

```ts
const analysisStatusLabel = relationship.relationshipIntelligence?.analysisStatusLabel
  || "暂无已确认的关系智能";
```

List aria:

```tsx
aria-label={`打开与 ${relationship.name} 的关系。${analysisStatusLabel}`}
```

- [ ] **Step 6: Add deterministic UI-only constellation placement**

Use a pure presentation helper local to `PeopleSurface.tsx`:

```ts
type UniversePosition = { x: number; y: number; ring: number };

function universePosition(index: number, count: number): UniversePosition {
  const firstRingCapacity = 8;
  const ring = index < firstRingCapacity ? 0 : 1 + Math.floor((index - firstRingCapacity) / 12);
  const ringStart = ring === 0 ? 0 : firstRingCapacity + (ring - 1) * 12;
  const ringCount = ring === 0
    ? Math.min(count, firstRingCapacity)
    : Math.min(12, Math.max(1, count - ringStart));
  const slot = ring === 0 ? index : index - ringStart;
  const angle = ((slot / Math.max(1, ringCount)) * Math.PI * 2) - (Math.PI / 2);
  const radius = 31 + ring * 14;
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
    ring,
  };
}
```

This helper is strictly visual. Do not read intelligence, timestamps, message counts, or heuristic fields to determine coordinates.

- [ ] **Step 7: Render center, uniform spokes, and relationship buttons**

Use a stage structure like:

```tsx
<div className="yance-relationship-universe__stage" aria-label="关系宇宙">
  <div className="yance-relationship-universe__center" aria-hidden="true">
    <span>我</span>
  </div>
  {relationships.map((relationship, index) => {
    const position = universePosition(index, relationships.length);
    const focused = relationship.id === focusedRelationshipId;
    const status = relationship.relationshipIntelligence?.analysisStatusLabel || "暂无已确认的关系智能";
    return (
      <React.Fragment key={relationship.id}>
        <span
          className="yance-relationship-universe__spoke"
          style={{ "--yance-node-x": `${position.x}%`, "--yance-node-y": `${position.y}%` } as React.CSSProperties}
          aria-hidden="true"
        />
        <motion.button
          type="button"
          className="yance-relationship-universe__node"
          data-focused={focused || undefined}
          style={{ left: `${position.x}%`, top: `${position.y}%` }}
          aria-pressed={focused}
          aria-label={`查看 ${relationship.name} 的关系洞察。${status}`}
          onClick={() => onFocus(relationship.id)}
          whileTap={reducedMotion ? undefined : { scale: 0.97 }}
        >
          {/* avatar/name/status indicator */}
        </motion.button>
      </React.Fragment>
    );
  })}
</div>
```

No spoke connects two relationship nodes.

- [ ] **Step 8: Render the focused trusted insight rail**

Resolve:

```ts
const focusedRelationship = relationships.find((row) => row.id === focusedRelationshipId) || null;
```

No-focus copy:

```tsx
<p>选择一个人，查看可信关系洞察</p>
```

Focused state must use only:

```ts
const intelligence = focusedRelationship.relationshipIntelligence;
const latestEvidence = intelligence?.events.at(-1) || null;
```

Render `关系状态`, optional `阶段`, optional `关系摘要`, optional `下一步`, optional `最近证据`, plus truthful pending text. CTA:

```tsx
<button type="button" onClick={() => onSelect(focusedRelationship.id)}>
  进入关系世界
</button>
```

- [ ] **Step 9: Add bounded responsive CSS with existing tokens**

Use existing `--yance-*` variables only. Required layout classes include:

```css
.yance-relationship-universe {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.36fr);
  gap: var(--yance-space-4);
}

.yance-relationship-universe__stage {
  position: relative;
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--yance-border);
  border-radius: var(--yance-radius-lg);
  background: var(--yance-surface);
}

.yance-relationship-universe__node {
  position: absolute;
  transform: translate(-50%, -50%);
}

.yance-relationship-universe__insight {
  display: grid;
  align-content: start;
  gap: var(--yance-space-3);
}
```

On narrow screens, stack insight below the stage and lower stage height. Preserve `:focus-visible`.

- [ ] **Step 10: Make reduced-motion universe static**

Motion props must be conditional on `reducedMotion`. Do not introduce CSS infinite animations, timers, `requestAnimationFrame`, or a force simulation.

---

## Task 4: Translate Relationship World, Private Quest, search, settings, tools, overlays, and visible living states

**Files:**
- Modify: `ProductExperienceShell.tsx`
- Modify: `RelationshipWorld.tsx`
- Modify: `RelationshipAssistant.tsx`
- Modify: `BilingualSearchPanel.tsx`
- Modify: `ProductComposerAccessory.tsx`
- Modify: `RelationshipOverlayHost.tsx`
- Modify: `RiveRelationshipCompanion.tsx`
- Modify: `ProductExperienceShell.css` only where Chinese layout needs existing scoped styling.

**Interfaces:**
- Consumes current runtime/API/type behavior unchanged.
- Produces Chinese Product chrome only.

- [ ] **Step 1: Translate shell status and settings while preserving enum values**

Use Chinese visible labels, but explicit option values keep internal enums stable:

```tsx
<select value={preferences.soundMode} onChange={(event) => preferences.setSoundMode(event.target.value as SoundMode)}>
  <option value="Off">关闭</option>
  <option value="Essential only">仅必要提示</option>
  <option value="Immersive">沉浸</option>
</select>
```

Do the same for Motion and Atmosphere. Translate `Experience`, Learning controls, reduced-motion note, load/error/status strings, and shell aria label per design spec.

- [ ] **Step 2: Translate Relationship World without changing authority identifiers**

Keep `RelationshipProjectionAuthority`, Graphiti source handling, Date parsing, trusted stage/summary/next/events, and pending logic intact. Translate visible headings/copy:

```tsx
<span className="yance-eyebrow">关系世界</span>
<button aria-label="返回我的关系">←</button>
<button aria-label={assistantVisible ? "收起私人任务" : "打开私人任务"}>私人任务</button>
```

Visible authority badge may say `可信关系投影`; technical authority id remains in code/data semantics.

- [ ] **Step 3: Translate Private Quest without changing Parlant mutations**

Keep all existing calls to `loadRelationshipAssistant`, `updateRelationshipGoal`, `setRelationshipGoalPaused`, `deleteRelationshipGoal`, relationship event subscription, dirty-draft behavior, and agent readiness semantics. Translate only visible copy to `关系私密任务`, `当前意图`, `进展`, `关系洞察`, `下一步`, Chinese actions/status/errors.

- [ ] **Step 4: Translate search and translation lifecycle without changing async behavior**

Do not change debounce, job polling, exponential backoff, cancellation, retry, sequence guards, latest-query ref, result-to-relationship resolution, or Element navigation. Translate visible Product copy only.

Required controls include:

```tsx
<span>搜索</span>
<button type="button">清除</button>
<span className="yance-bilingual-search__label">消息、姓名或中文翻译</span>
<button type="button">取消</button>
<button type="button">重试</button>
```

Keep `result.text` as original message and `translatedZh` as Chinese translation evidence.

- [ ] **Step 5: Translate relationship tools and remove implementation-oriented hints**

Keep internal kinds exact:

```ts
const ACTIONS = [
  { label: "照片", kind: "photo", hint: "照片库与智能编辑" },
  { label: "语音", kind: "voice", hint: "语音能力" },
  { label: "实时陪伴", kind: "live", hint: "实时空间" },
  { label: "附件", kind: "attachment", hint: "媒体与文件" },
] as const;
```

Keep `Popover`, `captureExperienceFocus`, `requestRelationshipOverlay`, `playExperienceSound`, and Matrix room binding unchanged.

- [ ] **Step 6: Translate overlay host and hide raw room identifier from normal copy**

Translate overlay title/eyebrow/close aria. Replace visible raw room-id description:

```tsx
<Dialog.Description>
  {activeMatrixRoomId ? "当前关系会话" : "当前关系"}
</Dialog.Description>
```

Do not remove or rewrite `activeMatrixRoomId`; it remains internal context for existing child authorities.

- [ ] **Step 7: Map existing Rive internal states to Chinese visible labels**

Add:

```ts
const RELATIONSHIP_STATE_LABELS: Readonly<Record<RelationshipAiState, string>> = Object.freeze({
  idle: "静默",
  wake: "唤醒",
  listening: "倾听",
  thinking: "思考",
  ready: "就绪",
  speaking: "表达",
  error: "异常",
});
```

Use `RELATIONSHIP_STATE_LABELS[state]` for reduced-motion visible state, aria label, and screen-reader status. Keep Rive state-machine input values and `STATE_INDEX` unchanged.

---

## Task 5: Create the first production commit bound to the latest causal RED

**Files:**
- Exactly the nine production paths.

**Interfaces:**
- Consumes `Unknown blockers = 0` and the latest exact tests-only RED.
- Produces the complete root implementation without scope expansion.

- [ ] **Step 1: Run the six frozen successor tests before committing production**

Run the exact six-test command from Task 1. Expected: GREEN.

- [ ] **Step 2: Run immediate preservation tests**

Run:

```bash
node --test \
  tests/wp0/v21-product-experience-shell-p0.test.js \
  tests/wp0/v21-product-relationship-intelligence-surface.test.js \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js \
  tests/wp0/v21-product-experience-shell-interaction.test.js \
  tests/wp0/v21-product-experience-shell-accessibility.test.js
```

Expected: GREEN.

- [ ] **Step 3: Commit exactly the nine production paths**

Stage only:

```bash
git add \
  integration/element-module/src/product-experience/BilingualSearchPanel.tsx \
  integration/element-module/src/product-experience/PeopleSurface.tsx \
  integration/element-module/src/product-experience/ProductComposerAccessory.tsx \
  integration/element-module/src/product-experience/ProductExperienceShell.css \
  integration/element-module/src/product-experience/ProductExperienceShell.tsx \
  integration/element-module/src/product-experience/RelationshipAssistant.tsx \
  integration/element-module/src/product-experience/RelationshipOverlayHost.tsx \
  integration/element-module/src/product-experience/RelationshipWorld.tsx \
  integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx
```

Commit message must be:

```text
feat(v21): add immersive relationship universe

Yance-Failure-First-Red-Head: <exact latest causal tests-only RED head captured in Task 1/2>
Yance-Failure-First-Red-Run: <exact latest failing Stage run id captured in Task 1/2>
Yance-Failure-First-Red-Conclusion: failure
Yance-Closure-Matrix-Unknown-Blockers: 0
```

Use the actual captured values; never guess or reuse stale evidence.

---

## Task 6: Final exact-head closure

**Files:**
- No scope expansion.

**Interfaces:**
- Consumes the complete governed implementation head.
- Produces exact-head release/merge evidence only; no extra Product feature work.

- [ ] **Step 1: Run the full focused Product set**

At minimum:

```bash
node --test \
  tests/wp0/v21-product-relationship-universe-immersive-p0.test.js \
  tests/wp0/v21-product-relationship-intelligence-surface.test.js \
  tests/wp0/v21-product-ai-companion-private-quest-p0.test.js \
  tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js \
  tests/wp0/v21-product-experience-shell-interaction.test.js \
  tests/wp0/v21-product-experience-shell-accessibility.test.js \
  tests/wp0/v21-product-experience-shell-p0.test.js
```

Also run every existing current Parlant, Graphiti relationship authority, Element workspace, Learning capability, Product routing, and model/runtime preservation contract selected by the trusted CI routing.

- [ ] **Step 2: Run TypeScript/build validation selected by the current Product pipeline**

Use the repository’s existing package-manager/install authority and `@yance/element-module` build/lint commands. Do not regenerate dependency authority or alter lockfiles because this package adds no dependency.

- [ ] **Step 3: Push exact head and collect routed gates**

Collect exact-head status for:

- Stage / WP0;
- Layered CI when triggered;
- ACV2 WP-A when triggered;
- WP-A post-merge/promotion checks when applicable;
- Product/Model gates selected by current routing;
- any CodeRabbit/independent review required by repository policy.

Truthfully report skipped gates rather than treating them as GREEN.

- [ ] **Step 4: Independent exact-head review**

Review against the authorization and design with explicit focus on:

- no invented contact-to-contact edges;
- no relationship scoring semantics hidden in layout/CSS;
- focus versus select behavior;
- list-default behavior;
- round-trip People Home view/focus continuity;
- stale focus cleanup;
- Chinese real UI completeness across normal Product chrome;
- unchanged Graphiti/RelationshipProjectionAuthority join;
- unchanged Parlant/Element/translation/child-workspace authorities;
- no new dependency or infrastructure;
- keyboard, screen-reader, focus-visible, and reduced-motion behavior.

Required independent result: P0=0, P1=0.

- [ ] **Step 5: Resolve every review thread and re-run affected exact-head checks**

No unresolved thread may be carried into final merge.

- [ ] **Step 6: Fresh-main anti-drift**

Immediately before merge, fresh-read `main` and compare it with the implementation PR base. If main moved, re-evaluate authorization/topology and do not silently merge a stale candidate.

- [ ] **Step 7: Stop at the final ordinary merge boundary**

Report exact head, exact main/base, routed gate results, independent review result, unresolved thread count, and whether fresh-main drift is zero. Final implementation merge remains an explicit owner boundary.

---

## Plan self-review

- **Spec coverage:** list-default A, immersive C, deterministic truthful topology, focus/select continuity, Chinese Product chrome, reduced motion, accessibility, OSS-first reuse, failure behavior, negative graph proof, and final governance closure all have implementation tasks.
- **No unowned type/data expansion:** `experienceTypes.ts` and `experienceProjection.ts` remain preservation-only.
- **No route bootstrap:** no new Product source path is introduced; all nine production paths already exist in exact Product routing.
- **No dependency expansion:** existing Base UI/Motion/Rive/Howler are sufficient.
- **Scope consistency:** six failure-first paths + nine production paths = fifteen total paths; digests match the design spec.
- **Authority consistency:** Element, RelationshipProjectionAuthority/Graphiti, Parlant, Letta, search/translation, and child workspaces remain the same authorities.
