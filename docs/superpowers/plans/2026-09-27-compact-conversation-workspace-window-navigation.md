# Compact Conversation Workspace & Window Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compact 1060×720 desktop default and a focused Conversation work surface that removes permanent global chrome, summarizes the inspector, and keeps Reply Brain collapsed by default without changing mature messaging authority.

**Architecture:** Reuse the existing Electron desktop-settings document for window geometry, the existing Product shell/session projection for navigation, the existing Conversation inspector state, and the existing Reply Brain generation/send seams. No new router, persistence store, timeline, composer, send path, or data authority is introduced.

**Tech Stack:** Electron 43, React/TypeScript, Element module, CSS, Node `node:test`, Nx/Vite.

**Spec:** `docs/superpowers/specs/2026-09-27-compact-conversation-workspace-window-navigation-design.md`

## Global Constraints

- Default outer window: **1060×720**; minimum: **980×680**; never default fullscreen/maximized.
- First-run geometry is capped by **72% work-area width / 82% work-area height**; user-resized normal bounds are restored through existing desktop settings.
- Conversation hides the single global rail; Home/Relationship World/Settings keep it.
- Conversation toolbar target: **46px**, hard range **44–48px**.
- Contact list target **220px**; inspector summary **210px**; expanded inspector **260–280px**.
- Reply Brain default/collapsed height **42px**; expanded **≤220px**, short-window **≤200px**.
- Preserve Element room/timeline/composer/send/session/crypto authority and all existing AI, learning, persona, relationship, memory, goal, media, voice, Live, translation, human-typing, model/provider/routing capability.
- Never fabricate room IDs, contacts, messages, candidate counts, memory counts, or relationship facts.

## Review Focus

- Persisted window bounds may be smaller than the new minimum or outside the current monitor work area; restore must clamp safely without resetting a valid smaller user choice merely because the monitor is large.
- Home `对话` with no resolvable real conversation must enter the existing empty Conversation presentation without inventing session or room identity.
- Leaving Conversation for Home must restore the same global rail and must not mutate the active Matrix room merely to change Product presentation.
- Switching contacts while Reply Brain is collapsed must never show prior-contact candidates; displayed count always equals the current `candidates.length`.
- 125%/150% scaling and short-height windows must keep timeline/composer usable without page-level horizontal scroll or hiding mature tools permanently.

---

### Task 1: Make Electron use the existing desktop window-state authority

**Files:**
- Modify: `electron/desktopSettingsSchema.js`
- Modify: `electron/main.js`
- Create: `tests/desktop-fixes/compact-default-window.test.js`
- Modify: `tests/wp0/v4-conversation-laptop-theme-authority.test.js`

**Interfaces:**
- Consumes: existing `R32DesktopSettings.read()/update()` and `windowX/windowY/windowWidth/windowHeight/windowMaximized` keys.
- Produces: normalized default geometry `1060×720`, minimum geometry `980×680`, safe work-area clamping, and persisted normal bounds.

- [ ] **Step 1: Write failing desktop geometry tests** asserting schema defaults, BrowserWindow minimums/background, first-run 72%/82% work-area cap, and persisted normal-bounds restoration.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 tests/desktop-fixes/compact-default-window.test.js` and verify RED against the current 1186×758 / 960×680 implementation.
- [ ] **Step 3: Update `desktopSettingsSchema.js`** so default `windowWidth/windowHeight` are `1060/720` and normalization never restores below `980/680`.
- [ ] **Step 4: Update `createWindow()` in `electron/main.js`** to derive first-run bounds from `screen.getPrimaryDisplay().workArea`, restore valid persisted normal bounds/position, clamp off-screen bounds, and use `minWidth: 980`, `minHeight: 680`.
- [ ] **Step 5: Persist only normal bounds** on move/resize/close through `settingsStore.update(...)`; never overwrite stored normal bounds with minimized/maximized geometry, and preserve existing maximize behavior only when already supported.
- [ ] **Step 6: Re-run the focused test** and verify GREEN.
- [ ] **Step 7: Commit** `electron/desktopSettingsSchema.js`, `electron/main.js`, and the focused test as one window-policy commit.

### Task 2: Make Home the explicit Conversation launchpad and remove the permanent Conversation rail

**Files:**
- Modify: `integration/element-module/src/product-experience/PeopleSurface.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Create: `tests/wp0/v4-compact-conversation-navigation.test.js`

**Interfaces:**
- Consumes: existing `onContinueConversation(relationship, conversation)`, `navigateConversation`, Product session selection, and existing Home/Conversation render branches.
- Produces: generic Home `对话` action, contextual `继续 <联系人> 的对话`, compact Conversation `返回首页`, and conditional rendering of the single global rail.

- [ ] **Step 1: Write failing navigation tests** asserting Home exposes a generic `对话` action, Conversation does not render `.yance-desktop-rail`, Conversation exposes `返回首页`, and Home/Relationship World/Settings still retain the one global rail.
- [ ] **Step 2: Add the smallest Product presentation intent needed for an empty Conversation surface** when no real conversation resolves; it may control which existing surface renders but must not invent `selectedConversationId`, Matrix room identity, or a second router.
- [ ] **Step 3: Add the Home `对话` action** in `PeopleSurface.tsx`; when a focused/recent real conversation exists, converge on the existing `onContinueConversation` path, otherwise request the existing empty Conversation presentation.
- [ ] **Step 4: Replace unconditional rail rendering** with `!conversationSurfaceActive` rendering and wire `返回首页` to the existing Home presentation path without clearing/mutating mature Matrix room state solely for presentation.
- [ ] **Step 5: Re-run** `node --test --test-concurrency=1 tests/wp0/v4-compact-conversation-navigation.test.js` and verify GREEN.
- [ ] **Step 6: Commit** the Product navigation changes and focused test.

### Task 3: Compress Conversation chrome and make the inspector summary-first

**Files:**
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`
- Modify: `tests/wp0/v21-conversation-workspace-v4-visual.test.js`
- Modify: `tests/wp0/v4-conversation-laptop-theme-authority.test.js`
- Create: `tests/wp0/v4-compact-conversation-layout.test.js`

**Interfaces:**
- Consumes: existing `rightCollapsed`, `inspectorTab`, real relationship/intelligence/model projections, and current Conversation CSS tokens.
- Produces: 46px compact toolbar, 220px contact list, 210px default inspector summary, 260–280px expanded inspector, and restored center priority.

- [ ] **Step 1: Write failing layout/source tests** for toolbar range, compact identity/no marketing brand block, default summary inspector, expanded tabs, 220px/210px/270px width contracts, and no Conversation rail padding reservation.
- [ ] **Step 2: Change the Conversation toolbar markup** from large Yance branding to `返回首页 | 对话 · <联系人>` plus compact intelligence/search/settings/more controls; keep current room header actions only where they are not duplicated.
- [ ] **Step 3: Reuse `rightCollapsed` as summary-vs-expanded presentation**: default it to summary, render real identity/status and only real available counts in summary, preserve `inspectorTab` state, and render the existing five-tab body only when expanded.
- [ ] **Step 4: Update CSS** so default compact geometry is contact `220px`, center `minmax(0,1fr)`, inspector summary `210px`; expanded inspector uses `270px`; Conversation topbar is `46px`; no page-level horizontal overflow at `980px` supported width.
- [ ] **Step 5: Add responsive assertions** for short height and 125%/150%-equivalent CSS viewport constraints without shrinking typography before chrome/padding.
- [ ] **Step 6: Run** `node --test --test-concurrency=1 tests/wp0/v4-compact-conversation-layout.test.js tests/wp0/v21-conversation-workspace-v4-visual.test.js` and verify GREEN.
- [ ] **Step 7: Commit** the Conversation chrome/inspector batch.

### Task 4: Make Reply Brain truly collapsed-by-default without losing candidates
**Files:**
- Modify: `integration/element-module/src/product-experience/ProductConversationProjection.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`
- Create: `tests/wp0/v4-reply-brain-collapsed-default.test.js`

**Interfaces:**
- Consumes: existing `candidates`, `busy`, `generateBatch`, candidate review/stage/reject paths, and canonical composer placement.
- Produces: default `expanded=false`, 42px compact bar, real candidate count/preview, independent `展开` and `换一批`, Esc collapse, and expanded workbench capped to 220/200px.

- [ ] **Step 1: Write failing Reply Brain tests** asserting `useState(false)`, collapsed DOM only exposes real count/preview/actions, expanded-only workbench controls remain mounted only when expanded, and candidate count is sourced from `candidates.length`.
- [ ] **Step 2: Change the Reply Brain render state machine** so initial automatic generation may continue while collapsed, but candidates/refine/review/learning/chat controls do not reserve layout height until expanded.
- [ ] **Step 3: Split compact actions** so `展开` never regenerates, `换一批` regenerates in either state, busy disables duplicate requests, and `0` candidates shows `尚未生成` plus the real generation action.
- [ ] **Step 4: Add Escape handling** from expanded to collapsed without clearing candidates, review text, or conversation identity; contact changes continue to follow the existing active-conversation generation boundary.
- [ ] **Step 5: Update CSS** to hard-cap collapsed height at `42px`, expanded normal height at `220px`, short-height at `200px`, and keep long candidate text scrolling inside cards.
- [ ] **Step 6: Run** `node --test --test-concurrency=1 tests/wp0/v4-reply-brain-collapsed-default.test.js tests/wp0/v21-conversation-workspace-v4-visual.test.js` and verify GREEN.
- [ ] **Step 7: Commit** the Reply Brain presentation batch.

### Task 5: Integrate, build, materialize, and verify the real Windows presentation
**Files:**
- Verify: all files modified by Tasks 1–4
- Verify: existing frozen Element build/materialization tooling

**Interfaces:**
- Consumes: the committed implementation from Tasks 1–4 and existing frozen runtime admission/materializer.
- Produces: reproducible evidence that source, built bundle, served bundle, and live Product layout agree.

- [ ] **Step 1: Run focused regression set** covering desktop window policy, navigation, compact layout, Reply Brain, and existing v4 Conversation visual contracts; require zero failures in the in-scope set.
- [ ] **Step 2: Run Yance Element module typecheck** with `corepack pnpm exec nx run yance-element-module:lint:types` from the existing Element workspace.
- [ ] **Step 3: Run Yance Element module build** with `corepack pnpm exec nx run yance-element-module:build`; require exit 0.
- [ ] **Step 4: Materialize with the existing frozen Yance lib materializer** and verify SHA256 equality between build output, materialized `index.js`, and HTTP-served bundle.
- [ ] **Step 5: Reload only through the existing safe frozen-runtime admission**; do not restart Matrix/backend/session services. If the known Home→Conversation restore helper remains RED, enter Conversation through the real Home `对话` control and record that distinction.
- [ ] **Step 6: Capture live geometry evidence** for default compact Conversation: no global rail, 44–48px toolbar, ~220px contacts, ~210px summary inspector, 42px collapsed Reply Brain, canonical composer present, and navy/gold tokens.
- [ ] **Step 7: Verify return-to-Home** restores the one global rail and Home chrome without destroying the authenticated/session state.
- [ ] **Step 8: Run `git diff --check` and inspect scoped diff/status**; do not reset, stash, clean, or overwrite unrelated dirty bytes.
- [ ] **Step 9: Commit only the reviewed implementation/test bytes**; leave unrelated Facebook/avatar/history and other existing WIP untouched.

## Plan Self-Review

- Spec coverage: Tasks 1–5 cover window sizing/persistence, Home entry, Conversation rail/toolbar, three-column geometry, inspector summary, Reply Brain default state, responsive constraints, theme authority, and runtime verification.
- Boundary check: no task creates a router, data store, composer, timeline, send path, AI backend, or fake content.
- Type/interface check: navigation converges on existing `onContinueConversation`/`navigateConversation`; window persistence uses existing desktop-setting keys; inspector uses existing `rightCollapsed/inspectorTab`; Reply Brain uses existing `candidates/generateBatch`.
- Review-focus check: off-screen persisted bounds, no-real-conversation entry, Home restoration, candidate leakage, and high-scaling/short-height behavior each have an owning task/test.
- Proportion check: implementation details are limited to pinned interfaces/values and testable outcomes; code bodies remain implementation work.
