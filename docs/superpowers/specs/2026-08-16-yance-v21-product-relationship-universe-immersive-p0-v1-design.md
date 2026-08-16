# V21 Product Relationship Universe Immersive P0 V1 Design

## Status

Design for `V21-PRODUCT-RELATIONSHIP-UNIVERSE-IMMERSIVE-P0-V1`, rooted from trusted `main@8953ee98f99e615dfb6a0e26745764593696ae8d`.

This document is design-only. It grants no implementation, merge, release, promotion, or runtime authority.

## Product decision

This package combines two already-selected product decisions:

- **C — 完整沉浸式关系宇宙**: People Home gains a complete immersive relationship-universe view rather than a cosmetic card variation.
- **A — 默认入口策略**: the default People Home remains the familiar list. The user explicitly switches to `关系宇宙`; Yance never silently replaces the list or auto-opens a relationship.

The package also completes the normal Product relationship chrome as a **Chinese real UI**. Internal protocol identifiers, enum values, source authority ids, and runtime state keys remain stable; user-facing copy becomes Chinese.

## Fresh-main findings

Trusted main already contains the required authorities and product seams:

- `ProductExperienceShell` is the People-first composition root.
- `PeopleSurface` is the People Home authority and currently renders the relationship list.
- `RelationshipWorld` is the selected-person relationship context.
- `RelationshipAssistant` is the selected-person Private Quest surface.
- `BilingualSearchPanel` owns Product search and translation-task UX.
- `ProductComposerAccessory` and `RelationshipOverlayHost` expose relationship media/voice/live/file tools around the existing Element composer.
- `RiveRelationshipCompanion` owns the existing bounded seven-state living AI presentation.
- `RelationshipProjection.relationshipIntelligence` is already backed by `RelationshipProjectionAuthority` and the conversation-scoped Graphiti/Neo4j join.
- Element / Matrix remains conversation, timeline, composer, room, and navigation authority.
- Parlant remains Goal/Journey authority; Letta remains Agent/long-term-memory runtime authority.
- Base UI, Motion, Rive, and Howler are already the Product interaction/motion/living-state/sound primitives.

The current user-visible gap is presentation/composition, not missing infrastructure:

1. People Home is still a flat English list with no immersive universe mode.
2. Relationship World and Private Quest remain mostly English.
3. Search, relationship tools, overlays, settings, and living-state feedback still expose mixed English or implementation-oriented copy.
4. The existing relationship projection contains no authorized person-to-person graph edges, no affection score, and no local relationship-strength metric.

## Goal

Turn People Home into a truthful two-mode relationship experience:

1. **列表** — stable default and fast scanning entry.
2. **关系宇宙** — an immersive, spatial, keyboard-accessible constellation centered on the user, composed only from existing `RelationshipProjection` data.

The universe lets the user focus a person, inspect trusted relationship state, then enter the existing Relationship World without creating a second relationship authority, social-graph engine, storage model, backend route, or IPC path.

At the same time, make the normal Product relationship experience Chinese from People Home through Relationship World, Private Quest, search, relationship tools, overlays, settings, and visible Rive state feedback.

## Product thesis

The existing Living Relationship OS direction remains unchanged:

- People-first.
- AI invisible unless contextually requested.
- Each person owns one Relationship World.
- Current-person continuity matters more than capability navigation.
- Element / Matrix owns actual conversation state.
- Relationship facts come only from trusted authorities.
- Product owns orchestration and presentation, not a second inference engine.

The new universe is therefore a **relationship constellation**, not a social-network inference graph.

## Why the universe is not a new graph engine

### Trusted data shape

`RelationshipProjection` provides one record per relationship/person, with identity/account/conversation linkage plus optional `RelationshipProjectionAuthority` intelligence. It does **not** provide authorized edges between two contacts.

Therefore the only truthful topology this package may render is:

- one center representing **我**;
- one outer node per existing `RelationshipProjection`;
- one visual spoke from **我** to each person, expressing only that the relationship belongs to the current user’s relationship universe.

The UI must not create person-to-person edges or interpret distance, angle, line width, node size, color, motion amplitude, or ring membership as relationship strength, affection, importance, compatibility, likelihood, or inferred social structure.

### Mature OSS fit

The repository already contains the mature Product primitives needed for this P0: Base UI for accessible interaction boundaries, Motion for bounded spatial transitions, and Rive for living-state feedback. A graph-specific dependency is not required.

Graph-focused OSS candidates such as Sigma.js, Cytoscape.js, and React Flow solve a broader problem: explicit graph models, arbitrary node/edge relationships, graph analysis, or node-editor canvases. Adopting one here would add a graph model and dependency surface without a trusted Product edge authority.

**Decision:** `REUSE_EXISTING_BASE_UI_MOTION_RIVE_PRODUCT_PRIMITIVES`; no new dependency and no Yance-authored general-purpose graph/layout engine.

A small deterministic constellation layout inside `PeopleSurface` is presentation logic only. It may compute stable visual coordinates from the ordered relationship ids; it must not become a reusable graph engine, physics simulation, inference layer, cache, or shared infrastructure package.

## Architecture

### 1. Keep `PeopleSurface` as the People Home authority

Do not add `RelationshipUniverse.tsx` in this P0.

Fresh routing policy shows Product Experience files are exact-routed rather than admitted through a broad `integration/element-module/src/product-experience/` prefix. `PeopleSurface.tsx` is already a trusted exact Product route and is the correct owner of both People Home presentations.

`PeopleSurface` evolves from a list-only component into a two-mode People Home component:

```ts
type PeopleHomeView = "list" | "universe";

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

`PeopleHomeView` may remain local to `PeopleSurface.tsx` / `ProductExperienceShell.tsx`; no new shared domain type is required.

### 2. Default-entry strategy A lives in `ProductExperienceShell`

`ProductExperienceShell` owns ephemeral Product navigation state:

```ts
const [peopleHomeView, setPeopleHomeView] = useState<PeopleHomeView>("list");
const [focusedRelationshipId, setFocusedRelationshipId] = useState("");
```

Rules:

- default after Product mount is always `list`;
- switching to `universe` requires explicit user action;
- switching view never selects or opens a person automatically;
- focusing a universe node updates only `focusedRelationshipId`;
- `进入关系世界` calls the existing `selectRelationship` path;
- entering Relationship World must not reset `peopleHomeView` or the last focused relationship;
- returning from Relationship World returns to the same People Home mode and focus while the Product shell remains mounted;
- if refresh removes the focused relationship, clear only the stale focus;
- if refresh removes the selected relationship, preserve the existing fail-safe behavior that clears selection.

No persistence/database/local-storage requirement is introduced in P0.

### 3. Deterministic constellation layout

The universe stage is built with normal React DOM/CSS plus Motion transitions.

Required layout semantics:

- center node: `我`;
- relationship nodes placed on one or more visual rings according to stable iteration order;
- stable angle is derived from deterministic index/id ordering, not from relationship strength;
- ring assignment exists only to prevent overlap as the person count grows;
- node size is uniform except for bounded focus treatment;
- spokes use uniform visual weight;
- no force simulation, no random layout, no continuously mutating topology;
- no timers or background polling for visual movement;
- optional ambient motion uses Motion only and is disabled in reduced-motion mode.

The DOM retains real buttons for every relationship node so keyboard focus and screen-reader interaction do not depend on pointer coordinates or SVG hit testing.

### 4. Universe focus and insight rail

The universe has two interaction states:

#### No focused person

Show the constellation and a truthful prompt:

`选择一个人，查看可信关系洞察`

No inferred summary is displayed.

#### Focused person

Highlight exactly one person and show an insight rail using only the focused `RelationshipProjection`:

- name;
- platform/account subtitle already present on the projection;
- relationship intelligence status label;
- stage, only when trusted AI analysis exposes it;
- relationship summary, only when trusted authority exposes it;
- next step, only when trusted authority exposes it;
- latest evidence item, if present;
- explicit pending / unavailable copy when trusted data is absent;
- CTA `进入关系世界`.

The rail must never derive a new relationship score, trend, priority, affinity, closeness, or next action.

### 5. List and universe are peers, not nested navigation

People Home contains a visible segmented/toggle control:

- `列表`
- `关系宇宙`

Both views use the same `relationships` array and the same `onSelect` authority. Search remains a Product-level entry above the People/Relationship scene and continues to resolve to the existing relationship or authoritative Element conversation.

The list remains the default because it is faster, predictable, and familiar. The universe is an intentional immersive view for exploration and context, not a replacement for high-efficiency scanning.

### 6. Relationship World continuity

The existing selected relationship remains the only Relationship World identity.

The universe does not create a second detail route. `进入关系世界` uses the existing `selectRelationship(relationship.id)` flow, after which `ProductExperienceShell` renders the existing `RelationshipWorld` and `RelationshipAssistant` for that exact projection.

Back navigation uses the existing selection clear behavior and reveals the People Home state still held by the shell.

### 7. Chinese real UI boundary

This package translates the normal Product relationship chrome. It does **not** rewrite child domain workspaces such as MediaWorkspace, PresenceWorkspace, VoiceWorkspace, or LearningWorkspace themselves.

Internal enum values, API identifiers, authority ids, and persisted/runtime keys remain unchanged.

#### Shell / settings

- `Loading relationships` → `正在加载关系`
- `${n} relationships ready` → `已载入 ${n} 段关系`
- `No relationships available yet` → `暂无可用关系`
- `Relationship data unavailable` → `关系数据暂不可用`
- `Relationship opened` → `已打开关系`
- shell aria label → `Yance 关系智能操作系统`
- `Experience` → `体验设置`
- `Sound` → `声音`
- `Motion` → `动效`
- `Atmosphere` → `氛围`
- visible option labels are Chinese while existing enum values remain the stored values:
  - Off → `关闭`
  - Essential only → `仅必要提示`
  - Immersive → `沉浸`
  - Standard → `标准`
  - Reduced → `减少动效`
  - Quiet → `安静`
  - Warm → `温暖`
  - Vivid → `鲜活`
- `Learning controls` → `学习控制`
- `Close learning controls` → `收起学习控制`

#### People Home

- `People` → `关系`
- `Your relationships` → `我的关系`
- list tab → `列表`
- universe tab → `关系宇宙`
- universe heading → `关系宇宙`
- universe subcopy → `从你出发，看见每段关系正在发生什么`
- center label → `我`
- no-focus prompt → `选择一个人，查看可信关系洞察`
- fallback status → `暂无已确认的关系智能`
- `No relationships yet` → `暂无关系`
- empty helper → `已有联系人和会话会在这里形成你的关系空间。`
- open aria → `打开与 ${name} 的关系。${status}`
- focus aria → `查看 ${name} 的关系洞察。${status}`
- insight rail labels: `关系状态` / `阶段` / `关系摘要` / `下一步` / `最近证据`
- CTA → `进入关系世界`

#### Relationship World

- `Relationship World` → `关系世界`
- back aria → `返回我的关系`
- visible AI toggle becomes relationship-native `私人任务`
- toggle aria → `打开私人任务` / `收起私人任务`
- `Conversation stays in Element` → `对话仍在 Element`
- helper → `Yance 在关系周围组织上下文、重要时刻和工具，但不会替代 Matrix 对话时间线。`
- `Relationship intelligence` → `关系智能`
- user-visible authority badge → `可信关系投影`
- `AI analysis` → `AI 分析`
- `Evidence authority` → `证据来源`
- `Stage` → `阶段`
- `Summary` → `关系摘要`
- `Next action` → `下一步`
- Graphiti source remains provenance-visible as `Graphiti · AI 推断`
- user annotation → `用户标注`
- all pending/empty/unavailable explanations become Chinese without changing truth semantics.

The technical string `RelationshipProjectionAuthority` may remain in source/data attributes/tests as an authority identifier, but is not the primary visible badge copy.

#### Private Quest

- `Private Quest` → `关系私密任务`
- relationship heading → `专注于与 ${name} 之间真正重要的事`
- `Current intention` → `当前意图`
- `Progress` → `进展`
- `Relationship insight` → `关系洞察`
- `Next step` → `下一步`
- placeholder → `这段关系现在最重要的是什么？`
- `Save intention` → `保存意图`
- `Pause` → `暂停`
- `Resume` → `继续`
- `Remove` → `移除`
- status, unavailable, empty-progress, write-failure, and remove-result copy become Chinese.

Parlant goal values and authority semantics remain unchanged.

#### Search and translation task

- Product search control uses Chinese visible copy while retaining the ability to search original text or Chinese translation.
- `Search / 搜索` → `搜索`
- `Clear` → `清除`
- field label → `消息、姓名或中文翻译`
- placeholder → `搜索原文或中文翻译`
- search/loading/empty/error status strings become Chinese.
- `Translation task` → `翻译任务`
- `Cancel` → `取消`
- `Retry` → `重试`
- `People` result section → `联系人`
- `Original` → `原文`
- navigation-state/result status copy becomes Chinese.

The durable translation-job lifecycle, retry/cancel authority, polling backoff, and Element navigation semantics remain unchanged.

#### Relationship tools and overlays

`ProductComposerAccessory` becomes user-oriented instead of implementation-oriented:

- `Relationship tools` → `关系工具`
- `Photo` → `照片`
- `Voice` → `语音`
- `Live` → `实时陪伴`
- `Attachment` → `附件`
- technical hints such as `Immich library and ComfyUI`, `Voice Brain`, and raw authority names are replaced by user-facing descriptions such as `照片库与智能编辑`, `语音能力`, `实时空间`, `媒体与文件`.

`RelationshipOverlayHost` visible copy becomes Chinese:

- `Relationship tool` → `关系工具`
- titles `照片` / `语音` / `实时陪伴` / `附件`
- close aria → `关闭关系工具`
- do not expose raw Matrix room id as normal UI copy; use `当前关系会话` while preserving `activeMatrixRoomId` internally for child authority context.

#### Rive visible states

Internal state keys remain exactly:

`idle / wake / listening / thinking / ready / speaking / error`

Visible/reduced-motion and screen-reader labels map to:

- idle → `静默`
- wake → `唤醒`
- listening → `倾听`
- thinking → `思考`
- ready → `就绪`
- speaking → `表达`
- error → `异常`

No new AI state machine is created.

## Accessibility and motion

- Every relationship remains a real button in list and universe views.
- View switch exposes selected state with semantic controls.
- Focused universe person has non-color-only state indication.
- Insight rail has a stable accessible heading/region.
- `aria-live` feedback remains for asynchronous data and task state.
- existing Base UI popup/dialog focus authority is preserved.
- `:focus-visible` remains obvious.
- reduced-motion mode disables ambient orbit/travel and uses static deterministic positions.
- no animation loop, timer, force simulation, hover sound, or color-only relationship intelligence is introduced.

## Truthfulness and failure behavior

### Relationship data unavailable

Keep People Home mounted with explicit `关系数据暂不可用`; do not synthesize placeholder people.

### Relationship intelligence absent/pending

A person can still appear because identity/customer data is real, but the UI must state `暂无已确认的关系智能` / pending authority status. Stage, summary, next, and evidence cannot be fabricated.

### Stale analysis

Show the authority-provided stale/update-pending semantics. Do not locally turn staleness into urgency or priority.

### Universe focus disappears on refresh

Clear `focusedRelationshipId`; remain in the selected People Home view.

### Selected relationship disappears on refresh

Preserve existing fail-safe behavior and return to People Home.

### Search/translation errors

Preserve current authoritative job lifecycle and explicit transport errors; Chinese copy must not hide failure states.

### Child tool authority unavailable

The existing child workspace owns its own failure state. Product overlay remains a thin host.

## Non-goals

This package does not:

- create person-to-person relationship edges;
- infer a social graph;
- calculate affection, importance, relationship score, closeness, compatibility, priority, or influence;
- add graph physics, a force engine, layout service, graph cache, or spatial database;
- introduce Sigma.js, Cytoscape.js, React Flow, D3-force, Graphology, or another new graph dependency for this P0;
- modify Graphiti, Neo4j, Parlant, Letta, Learning, Matrix, translation, media, presence, or voice runtime authorities;
- add a new backend route, IPC channel, preload API, database, service, cache, sidecar, workflow, or dependency;
- persist People Home view/focus across application restarts;
- add gamification, XP, streaks, relationship levels, or leaderboards;
- replace Element conversation/timeline/composer/navigation;
- translate child domain workspaces in this package.

## Exact proposed implementation scope

### Failure-first tests-only scope — 6 paths

SHA-256 canonical path digest: `7208e33efc9e5c470f5ad90ce61a12977044b2f0c88cc35092f62349dfd4cc94`

- `tests/wp0/v21-product-relationship-universe-immersive-p0.test.js`
- `tests/wp0/v21-product-relationship-intelligence-surface.test.js`
- `tests/wp0/v21-product-ai-companion-private-quest-p0.test.js`
- `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js`
- `tests/wp0/v21-product-experience-shell-interaction.test.js`
- `tests/wp0/v21-product-experience-shell-accessibility.test.js`

The first path is the new root Product contract. The other five are executable consumer-contract migrations required by the Chinese real UI and universe accessibility while preserving the underlying runtime authorities.

### Production scope — 9 paths

SHA-256 canonical path digest: `a542f650304b9c0fc8f0ba21555fcfe5659c5fd6ebc6d1bfa909390cf721e54b`

- `integration/element-module/src/product-experience/PeopleSurface.tsx`
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- `integration/element-module/src/product-experience/RelationshipWorld.tsx`
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
- `integration/element-module/src/product-experience/BilingualSearchPanel.tsx`
- `integration/element-module/src/product-experience/ProductComposerAccessory.tsx`
- `integration/element-module/src/product-experience/RelationshipOverlayHost.tsx`
- `integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx`
- `integration/element-module/src/product-experience/ProductExperienceShell.css`

### Total authorization scope — 15 paths

SHA-256 canonical path digest: `eeec2eb0ebd3210f5bc4d83128324a1f2e9b7490e626a22cc58f4cfbed4f4f88`

No `experienceProjection.ts`, `experienceTypes.ts`, Electron bridge, preload, backend, dependency, workflow, route-policy, or child workspace modification is expected.

If a fresh causal RED proves another path is truly required, production must stop and use the same-work-package scope-amendment mechanism before that path is touched.

## Failure-first contract

The mandatory first implementation commit is tests-only and changes exactly the six failure-first paths.

The effective authorization-merge baseline must fail because at least the following product contracts are not yet true:

1. People Home has no explicit `列表 / 关系宇宙` view control with list default.
2. There is no deterministic user-centered relationship constellation.
3. There is no focus-only universe state and trusted insight rail with `进入关系世界`.
4. Product Shell does not preserve universe mode/focus across Relationship World round trips.
5. normal relationship UI remains mixed English instead of the frozen Chinese copy contract.
6. existing executable Product tests still assert superseded English visible labels/aria copy.
7. Rive reduced-motion visible state still exposes raw English state keys.

The tests must also prove preservation:

- no new person-to-person edge model;
- no new graph/inference engine;
- no new dependency;
- no change to conversation-scoped RelationshipProjectionAuthority join;
- no change to Parlant Goal/Journey authority;
- no replacement of Element conversation/navigation authority;
- reduced-motion, focus-visible, Base UI, durable translation task, and child-workspace boundaries remain intact.

Fast Closure V2 applies: tests-only first commit → fresh exact-head causal Stage RED → optional same-root tests-only diagnostics → Closure Matrix `unknownBlockers = 0` → first production commit bound to the latest RED.

## Closure Matrix boundaries

Before production, classify at minimum:

### ROOT_IMPLEMENTATION

- `PeopleSurface` list-only home → list/universe dual People Home.
- deterministic radial constellation presentation.
- focus-only universe state and trusted insight rail.
- `ProductExperienceShell` default-list / universe-state continuity.
- Chinese normal Product relationship chrome.
- Chinese visible Rive state mapping.
- executable English-copy consumer contracts that must migrate with the real UI.

### PRESERVE

- `RelationshipProjection` identity and relationship-intelligence schema.
- `experienceProjection.ts` customer → conversation → relationship intelligence join.
- Graphiti / Neo4j inference authority.
- RelationshipProjectionAuthority truth/provenance semantics.
- Parlant goal/progress authority and mutations.
- Letta runtime ownership and internal readiness.
- Element / Matrix conversation, timeline, composer, room, and navigation authority.
- bilingual search and durable translation task lifecycle.
- Media / Presence / Voice / Learning child-workspace authorities.
- Base UI focus/popup/dialog boundary.
- Motion/Rive/Howler existing Product primitive authority.

### NEGATIVE_PROOF

- no person-to-person edges.
- no relationship strength/affection/priority scoring.
- no use of historical local social heuristics, message counts, agent counts, Learning evidence, or runtime telemetry as relationship meaning.
- no new `YanceSocialGraphEngine`, graph model, force simulation, graph cache, or general-purpose layout framework.
- no new dependency, workflow, IPC, preload, backend route, database, service, cache, sidecar, or engine.
- no hidden replacement of Element conversation behavior.
- no test weakening: migrations must assert the successor Chinese/immersive contract and preserve behavior-level authority checks.

### OUT_OF_ROOT_CAUSE_WITH_EVIDENCE

None expected at design time.

`Unknown blockers` must equal `0` before production changes.

## Validation

Focused validation must include at least:

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

Also run the existing Parlant workspace, Graphiti relationship authority, Element workspace, Learning capability, and Product routing contracts selected by current trusted gates.

Final exact-head closure requires routed Stage/WP0 and every triggered ACV2/Layered/WP-A/Product/Model gate, independent exact-head review with P0=0/P1=0, unresolved review threads=0, and fresh-main anti-drift.

## Acceptance

P0 is complete only when all of the following are true:

- Product opens to the existing relationship **列表** by default.
- The user can explicitly switch to **关系宇宙** and back without changing relationship selection.
- The universe is immersive, spatial, and responsive but truthful: center `我`, one node per existing relationship, no invented person-to-person graph.
- focusing a person does not open it; the insight rail uses only existing trusted projection fields.
- `进入关系世界` opens the existing selected-person Relationship World.
- returning from Relationship World restores the same People Home mode and last valid focus.
- relationship refresh preserves mode and clears only invalid focus/selection.
- normal Product relationship chrome is Chinese according to this spec.
- technical runtime identifiers remain internal where they are not useful product facts.
- pending/empty/stale/unavailable relationship intelligence remains explicit and truthful.
- no local score, graph inference, gamification, or relationship-strength semantics are introduced.
- reduced-motion and keyboard/screen-reader usage remain complete.
- no new dependency, workflow, IPC, backend, database, service, sidecar, cache, graph engine, or general-purpose Yance infrastructure is introduced.
- exact-head gates, independent review, and fresh-main anti-drift are green before final ordinary merge.
