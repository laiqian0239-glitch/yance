# Yance Living Relationship Product Experience Shell P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the normal flat Yance capability dashboard with a relationship-first Living Relationship OS shell that keeps Element/Matrix as conversation authority while adding OSS-owned interaction primitives, motion, Rive living-state visuals, restrained Howler playback, People/Relationship surfaces, current-relationship AI, and Media/Voice/Live entry points.

**Architecture:** Element/Matrix remains the messaging/timeline/composer authority. The Yance Element module owns only product composition: a persistent relationship shell in the existing global right-panel extension point plus a composer accessory mounted through Element's public `registerComposerPreview` API; Media/Presence/Voice/Learning remain their existing workline authorities. Base UI owns focus/portal/dismissal primitives, Motion owns spring/shared-layout/gesture mechanics, Rive owns state-machine visual playback, and Howler owns UI sound playback.

**Tech Stack:** React >=18 / Element Web module API / Base UI 1.7.0 / Motion 12.42.2 / `@rive-app/react-canvas` 4.31.0 backed by `@rive-app/canvas` 2.39.2 / Howler 2.2.4 / `@types/howler` 2.2.13 / Node test contracts / Element pinned v1.12.25 pnpm workspace.

## Global Constraints

- Work package: `V21-PRODUCT-EXPERIENCE-SHELL-P0`.
- Design authority: `docs/superpowers/specs/2026-08-10-yance-v21-product-experience-shell-p0-design.md` merged by PR #226.
- Design baseline main at planning start: `e99d4cd517bc08c2a6b290ef8c25194ec6f5e804`.
- Base UI: `@base-ui/react@1.7.0`, upstream `mui/base-ui@254f4744f0a241c20697b9eeab33402f4469a081`, MIT.
- Motion: `motion@12.42.2`, upstream `motiondivision/motion@40e8756c63b258c9dd07de9501cb788410eefb02`, MIT.
- Rive React: `@rive-app/react-canvas@4.31.0`, upstream `rive-app/rive-react@c05ec1842324a4a61d01f8e49dfd2ac2c37ae72c`, MIT; it pins `@rive-app/canvas@2.39.2`, which corresponds to `rive-app/rive-wasm@68dbf3a775df37fc4a6f128fb685eb9ed4bf149b`, MIT.
- Sound: `howler@2.2.4`, upstream `goldfire/howler.js@003b917c40cb41cf382ba47ae0ed7a35ca2abe76`, MIT; TypeScript definitions `@types/howler@2.2.13`, MIT.
- Element/Matrix owns conversation timeline, composer, message state, room navigation, and account/messaging authority.
- Existing Letta, Graphiti, Parlant, Model Brain, Learning Brain, Immich/ComfyUI, SenseVoice/CosyVoice, LiveKit/CyberVerse authorities remain unchanged.
- No `YanceComponentFramework`, `YanceAnimationEngine`, `YanceGameUIRuntime`, `YanceSoundEngine`, `YanceConversationEngine`, `YanceOverlayFramework`, or `YanceSocialGraphEngine`.
- No relationship XP, affection score, leaderboard, streak, game HUD, autonomous sending, or second Matrix timeline/composer.
- Most hover/navigation actions are silent; AI thinking has no looping sound.
- Sound modes are exactly `Off`, `Essential only`, `Immersive`.
- Reduced motion must remove spatial travel/magnetic feedback/nonessential ambient motion while retaining state clarity.
- Opening/closing Product overlays must not remount Element timeline or composer and must restore the previously focused DOM element when it still exists.
- Shared root `integration/element-module/src/YanceWorkspace.tsx` is late-cutover only.
- Shared dependency root `integration/element-module/package.json` is late-cutover only.
- Before either shared root is modified, fresh-read `main`, Voice PR #211, and Learning PR #223 and recompute exact overlap.
- No force push, rebase, amend of published history, squash, wildcard scope, gate weakening, or temporary bypass.
- Authorization and implementation merges are ordinary two-parent merges only.
- First implementation commit after authorization is failure-first tests only.
- Final implementation stops at merge boundary after exact-head review and all required gates/UAT are GREEN.

---

## File Structure

The implementation is split by product responsibility rather than by technical layer:

- `integration/element-module/src/product-experience/experienceTypes.ts` — product-composition types only: relationship projection, overlay kind, AI state, sound/motion preference.
- `integration/element-module/src/product-experience/experienceProjection.ts` — read-only projection from the existing `window.yanceDesktop.storeSnapshot`, Parlant goal APIs, and existing desktop events; no writes other than Parlant goal operations already owned by Parlant.
- `integration/element-module/src/product-experience/experienceSession.ts` — tiny in-process composition store shared by the global right-panel React root and the Element composer-preview React root; holds only selected relationship id, active Matrix room id, requested Product overlay, and pre-overlay focused element. It never stores messages, drafts, timeline scroll, send state, model state, or social graph state.
- `integration/element-module/src/product-experience/experiencePreferences.ts` — user-local `Sound / Motion / Relationship atmosphere` projection with `prefers-reduced-motion` integration.
- `integration/element-module/src/product-experience/experienceSound.ts` — Howler-only playback policy for a small set of Yance-owned embedded micro-sound data assets; no recording/TTS/streaming.
- `integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx` — official Rive React runtime adapter for `idle -> wake -> listening -> thinking -> ready -> speaking/error`, visibility pausing, and non-Rive accessible fallback.
- `integration/element-module/src/product-experience/PeopleSurface.tsx` — recent/known relationship entry surface using existing customer projections; no second social graph.
- `integration/element-module/src/product-experience/RelationshipAssistant.tsx` — hidden-by-default current-relationship AI/Goal surface using existing Letta/Parlant bridges.
- `integration/element-module/src/product-experience/RelationshipWorld.tsx` — selected relationship header/world composition and shared-layout identity; the real conversation remains Element's central timeline.
- `integration/element-module/src/product-experience/RelationshipOverlayHost.tsx` — Base UI Dialog/Drawer composition hosting existing Media/Presence and future Voice surfaces; no overlay runtime/state machine.
- `integration/element-module/src/product-experience/ProductComposerAccessory.tsx` — Base UI Popover Action Dock mounted by Element's official composer-preview API, opening Product overlays without replacing composer state.
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx` — top-level People -> Relationship World composition.
- `integration/element-module/src/product-experience/ProductExperienceShell.css` — semantic design tokens and surface styling; all timing/radius/elevation/sound-volume families are centralized here or in preference constants.
- `integration/element-module/src/product-experience/assets/yance-relationship-orb.riv` — Yance-owned Rive asset with the required AI state machine. Binary provenance is mandatory before final UAT.
- `integration/element-module/src/index.tsx` — registers the right-panel shell and composer accessory only through Element module APIs.
- `integration/element-module/src/YanceWorkspace.tsx` — late cutover to thin composition wrapper; old flat capability navbar removed from the normal path.
- `integration/element-module/package.json` — exact OSS dependency identities only.
- `upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch` — replayable lock-only patch for pinned Element Web's `pnpm-lock.yaml`, generated from the exact dependency identities after the module overlay is present.
- `tools/matrix/bootstrap.js` — applies the dependency-lock patch after copying `integration/element-module` to `modules/yance`, preserving pinned Element source and frozen dependency replay.
- `config/upstreams/v21-product-experience-shell-p0.json` — exact OSS source pins, package identities, licenses, Rive transitive runtime identity, and asset provenance policy.
- `third_party/licenses/*` — exact upstream license receipts.
- `tests/wp0/v21-product-experience-shell-*.test.js` — failure-first architecture, dependency, accessibility, motion/sound, focus/state-preservation contracts.
- `docs/uat/V21_PRODUCT_EXPERIENCE_SHELL_P0_UAT.md` — final real Electron UAT evidence/results, not a substitute for automated gates.

---

### Task 1: Freeze failure-first Product Experience contracts

**Files:**
- Create: `tests/wp0/v21-product-experience-shell-p0.test.js`
- Create: `tests/wp0/v21-product-experience-shell-interaction.test.js`
- Create: `tests/wp0/v21-product-experience-shell-accessibility.test.js`
- Create: `tests/wp0/v21-product-experience-shell-dependencies.test.js`

**Interfaces:**
- Consumes: merged design PR #226 and the authorized exact path set.
- Produces: source-level contracts that must be RED on the authorization-merge baseline and become GREEN only through the intended architecture.

- [ ] **Step 1: Write the architecture RED tests**

Assert all of the following from source text and file existence:

```js
assert.equal(fs.existsSync('integration/element-module/src/product-experience/ProductExperienceShell.tsx'), true);
assert.doesNotMatch(read('integration/element-module/src/YanceWorkspace.tsx'), /CAPABILITIES\s*=|workspace\.active-capability/u);
assert.match(read('integration/element-module/src/index.tsx'), /registerComposerPreview/u);
assert.doesNotMatch(allProductSource, /YanceConversationEngine|YanceAnimationEngine|YanceSoundEngine|YanceOverlayFramework/u);
```

Also require `PeopleSurface`, `RelationshipWorld`, `RelationshipAssistant`, `ProductComposerAccessory`, `RelationshipOverlayHost`, `RiveRelationshipCompanion`, and the Yance-owned `.riv` path.

- [ ] **Step 2: Write interaction RED tests**

Require one-action People -> Relationship entry, Action Dock labels Photo/Voice/Live, explicit AI states, exact sound modes, focus restoration, and source-level proof that Element timeline/composer are not cloned or queried through private selectors.

```js
for (const label of ['Photo', 'Voice', 'Live']) assert.match(accessory, new RegExp(label, 'u'));
for (const state of ['idle', 'wake', 'listening', 'thinking', 'ready', 'speaking', 'error']) assert.match(rive, new RegExp(state, 'u'));
assert.doesNotMatch(allProductSource, /querySelector\([^)]*(timeline|composer)|mx_RoomView|mx_MessageComposer/u);
```

- [ ] **Step 3: Write accessibility/motion/sound RED tests**

Require Base UI imports, `prefers-reduced-motion`, visible focus styling, `aria-live` for state feedback, keyboard-reachable controls, `Off / Essential only / Immersive`, and explicit no-thinking-loop policy.

- [ ] **Step 4: Write dependency/provenance RED tests**

Require exact package identities in `integration/element-module/package.json`, exact upstream pins in the Product config, license receipt files, a lock replay patch, and the Rive relationship-orb asset provenance record.

- [ ] **Step 5: Commit tests only and prove causal RED**

Run the four Product tests on the exact authorization-merge baseline. Expected failure reason is missing Product Experience source/dependencies, not unrelated baseline breakage. Push this tests-only commit and collect the exact remote Stage/Layered/ACV2/Windows/PVEP evidence required by routing.

---

### Task 2: Add immutable OSS/dependency/provenance closure

**Files:**
- Create: `config/upstreams/v21-product-experience-shell-p0.json`
- Create: `third_party/licenses/base-ui-MIT.txt`
- Create: `third_party/licenses/motion-MIT.txt`
- Create: `third_party/licenses/rive-react-MIT.txt`
- Create: `third_party/licenses/rive-wasm-MIT.txt`
- Create: `third_party/licenses/howler-MIT.txt`
- Create: `third_party/licenses/types-howler-MIT.txt`

**Interfaces:**
- Produces exact immutable source/package identities used by later dependency and UAT tasks.

- [ ] **Step 1: Record exact sources and package identities**

The config must record exactly:

```json
{
  "baseUi": {"package":"@base-ui/react","version":"1.7.0","commit":"254f4744f0a241c20697b9eeab33402f4469a081","license":"MIT"},
  "motion": {"package":"motion","version":"12.42.2","commit":"40e8756c63b258c9dd07de9501cb788410eefb02","license":"MIT"},
  "riveReact": {"package":"@rive-app/react-canvas","version":"4.31.0","commit":"c05ec1842324a4a61d01f8e49dfd2ac2c37ae72c","license":"MIT"},
  "riveRuntime": {"package":"@rive-app/canvas","version":"2.39.2","commit":"68dbf3a775df37fc4a6f128fb685eb9ed4bf149b","license":"MIT"},
  "howler": {"package":"howler","version":"2.2.4","commit":"003b917c40cb41cf382ba47ae0ed7a35ca2abe76","license":"MIT"},
  "howlerTypes": {"package":"@types/howler","version":"2.2.13","license":"MIT"}
}
```

- [ ] **Step 2: Copy upstream license texts verbatim into the authorized license receipt paths**

- [ ] **Step 3: Keep benchmark-only projects out of dependency manifests**

The dependency test must reject Signal/Stoat/Cinny/Discord/Snapchat/Locket/Hinge/Bumble/Telegram/console benchmark packages becoming Product runtime authorities.

- [ ] **Step 4: Re-run Product dependency tests**

Expected: provenance assertions GREEN while source/UI assertions remain RED.

---

### Task 3: Build read-only relationship projection and local experience preferences

**Files:**
- Create: `integration/element-module/src/product-experience/experienceTypes.ts`
- Create: `integration/element-module/src/product-experience/experienceProjection.ts`
- Create: `integration/element-module/src/product-experience/experiencePreferences.ts`
- Create: `integration/element-module/src/product-experience/experienceSession.ts`

**Interfaces:**
- Produces:
  - `type RelationshipProjection = { id: string; name: string; subtitle: string; avatarUrl?: string; platform?: string; accountId?: string; chatJid?: string; sessionKey?: string; updatedAt?: string }`
  - `loadRelationshipProjections(): Promise<readonly RelationshipProjection[]>`
  - `loadRelationshipAssistant(contactId: string): Promise<RelationshipAssistantProjection>`
  - `updateRelationshipGoal(contactId: string, goalText: string): Promise<RelationshipAssistantProjection>`
  - `deleteRelationshipGoal(contactId: string): Promise<void>`
  - `setRelationshipGoalPaused(contactId: string, paused: boolean): Promise<RelationshipAssistantProjection>`
  - `useExperiencePreferences(): { soundMode; motionMode; atmosphere; setSoundMode; setMotionMode; setAtmosphere; reducedMotion }`
  - `useExperienceSession()` plus imperative `setActiveMatrixRoom(roomId)` and `requestRelationshipOverlay(kind)` for the two Element render roots.

- [ ] **Step 1: Implement customer projection using existing `storeSnapshot({domains:['customers']})` only**

Normalize stable IDs/names and optional known target metadata. Sort by valid update timestamp descending, then name, without inventing a second social graph.

- [ ] **Step 2: Move existing Parlant relationship-goal bridge behavior into the product projection**

Reuse existing desktop methods; no new goal authority or scoring.

- [ ] **Step 3: Implement preference projection**

Persist only Product display preferences under `yance.product-experience.*`; respect OS `prefers-reduced-motion` and allow explicit Reduced/Standard motion choice without overriding accessibility reduction.

- [ ] **Step 4: Implement the tiny cross-root composition session**

Store only selected relationship id, active Matrix room id, overlay kind, and a weak/restorable focus target. Never store messages, composer draft, timeline scroll, relationship graph, AI outputs, send queue, or runtime ownership.

- [ ] **Step 5: Run Product architecture/accessibility tests**

Expected: projection/preference/session contracts GREEN; surfaces remain RED.

---

### Task 4: Build People Surface and Relationship World with Motion authority

**Files:**
- Create: `integration/element-module/src/product-experience/PeopleSurface.tsx`
- Create: `integration/element-module/src/product-experience/RelationshipWorld.tsx`
- Create: `integration/element-module/src/product-experience/ProductExperienceShell.css`

**Interfaces:**
- `PeopleSurface({relationships, selectedId, onOpen})`
- `RelationshipWorld({relationship, onBack, onOpenAssistant, onOpenOverlay})`

- [ ] **Step 1: Implement semantic token families in CSS**

Centralize surface/text/accent/destructive/success, atmosphere, typography, spacing, radius, elevation, blur, focus ring, presence ring, motion duration/spring, sound-volume class hints, and overlay z-depth. Components may consume variables but not invent arbitrary per-component motion/radius/shadow constants.

- [ ] **Step 2: Implement People Surface**

A recent relationship opens in one principal button action. Avatar/identity uses stable `layoutId={'relationship-avatar-' + relationship.id}` and keyboard-visible focus.

- [ ] **Step 3: Implement Relationship World**

Use `motion/react` shared-layout/spring transitions while keeping the actual Element timeline mounted outside the Product tree. The Relationship World is identity/context/action composition, not a message list.

- [ ] **Step 4: Implement reduced-motion branch**

Motion uses Motion's reduced-motion hook plus Product preference; Reduced removes magnetic/spatial travel and switches transitions to opacity/state clarity.

- [ ] **Step 5: Run Product interaction/accessibility tests**

Expected: People/World and reduced-motion contracts GREEN; AI/overlay/dependency tests remain RED where not yet implemented.

---

### Task 5: Build hidden Relationship Assistant with Rive living states

**Files:**
- Create: `integration/element-module/src/product-experience/RelationshipAssistant.tsx`
- Create: `integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx`
- Create: `integration/element-module/src/product-experience/assets/yance-relationship-orb.riv`

**Interfaces:**
- `RiveRelationshipCompanion({state, reducedMotion, visible})` where state is exactly `idle | wake | listening | thinking | ready | speaking | error`.
- `RelationshipAssistant({relationship, open, onClose})` uses existing Letta/Parlant projection and never opens/focuses automatically during normal typing.

- [ ] **Step 1: Add the Yance-owned `.riv` binary**

The asset must expose the reviewed state machine/state inputs needed to map the seven AI states. Record creator/source/provenance in the Product upstream/provenance config; do not redistribute an unverified historical or benchmark asset.

- [ ] **Step 2: Integrate official Rive React runtime**

Load only while visible, pause/stop when hidden where supported, and render an accessible static state label/fallback when canvas/runtime is unavailable or reduced-motion semantics require it.

- [ ] **Step 3: Implement hidden-by-default Assistant**

Use Base UI Dialog/Drawer primitives for focus and dismissal. Existing Parlant relationship goal remains the write authority; Letta remains persistent-agent status authority.

- [ ] **Step 4: Enforce sound rule**

`thinking` can never request a looping or repeated sound event.

- [ ] **Step 5: Run Product tests**

Expected: AI state/hidden-by-default/Rive contracts GREEN.

---

### Task 6: Build Howler sound policy and composer Action Dock on Element's real composer

**Files:**
- Create: `integration/element-module/src/product-experience/experienceSound.ts`
- Create: `integration/element-module/src/product-experience/ProductComposerAccessory.tsx`
- Modify late integration root: `integration/element-module/src/index.tsx`

**Interfaces:**
- `playExperienceSound(event: 'open-relationship' | 'assistant-wake' | 'assistant-ready' | 'send-accepted' | 'live-activate', mode: SoundMode): void`
- `ProductComposerAccessory({roomId, composerText, originalPreview})`

- [ ] **Step 1: Implement Howler-only playback**

Use Yance-owned embedded short micro-sound data assets with source/provenance recorded in config. `Off` always returns before constructing/playing sound; `Essential only` excludes relationship navigation/assistant decorative cues; `Immersive` permits the reviewed short cues. No hover playback and no AI-thinking event exists.

- [ ] **Step 2: Implement Base UI Popover Action Dock**

The `+` trigger exposes Photo / Voice / Live / Attachment without replacing Element's composer. Pointer interaction captures the previously focused element before the overlay request; closing restores it if connected.

- [ ] **Step 3: Register composer accessory through Element's public Module API**

In `index.tsx`, use `customComponents.registerComposerPreview(() => true, ...)` and render the original preview plus the Product accessory. Do not patch or query Element private composer/timeline state.

- [ ] **Step 4: Run interaction tests**

Expected: one-layer Photo/Voice/Live reachability, no private composer access, and focus-restoration source contracts GREEN.

---

### Task 7: Build Base UI overlay host over existing Media/Presence authorities

**Files:**
- Create: `integration/element-module/src/product-experience/RelationshipOverlayHost.tsx`
- Optionally modify within authorized scope only if target projection is required: `integration/element-module/src/MediaWorkspace.tsx`

**Interfaces:**
- `RelationshipOverlayHost({relationship, overlay, onClose})`
- Existing `MediaWorkspace` and `PresenceWorkspace` are child authorities; Product does not fork their APIs/runtime logic.

- [ ] **Step 1: Map Product overlay intents**

`photo -> <MediaWorkspace />`, `live -> <PresenceWorkspace />`, `voice -> current Voice authority when present in the reconciled shared-root state`; if Voice has not merged yet, the Product source must present a truthful unavailable state rather than duplicate Voice logic.

- [ ] **Step 2: Preserve underlying Element state by composition**

Overlay opens in Base UI primitives without unmounting the Element timeline/composer. Closing restores captured focus and clears only Product overlay state.

- [ ] **Step 3: Keep Media/Presence authority intact**

No Product source may call ComfyUI/Immich/LiveKit/CyberVerse internals directly; it only renders the existing workspace authority.

- [ ] **Step 4: Run architecture/interaction tests**

Expected: no duplicate media/presence/voice runtime or send queue.

---

### Task 8: Compose the Living Relationship shell and remove the flat dashboard normal path

**Files:**
- Create: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify late shared root: `integration/element-module/src/YanceWorkspace.tsx`
- Modify: `integration/element-module/src/index.tsx`

**Interfaces:**
- `ProductExperienceShell()` owns only Product composition.
- `YanceWorkspace()` becomes a thin wrapper rendering `ProductExperienceShell`.

- [ ] **Step 1: Fresh-read shared roots and open worklines immediately before edit**

Fetch live `main`, Voice #211 exact Head + changed paths/content, Learning #223 exact Head + changed paths/content. Recompute intersection with the authorized Product path set. If a shared root changed after authorization, forward-merge/reconcile or issue a successor authorization; never overwrite or transplant stale blobs.

- [ ] **Step 2: Implement shell composition**

Initial Product view is People/relationship-first, not the `AI / Goal / Contact / Presence / Media` capability navbar. AI/Goal/Memory are hidden interaction-layer surfaces.

- [ ] **Step 3: Cut over `YanceWorkspace`**

Remove legacy capability-selection persistence and make it a thin Product shell wrapper. Preserve existing desktop APIs by consuming them through the Product projection/adapters.

- [ ] **Step 4: Make Product shell visible through the existing global right-panel module surface**

Keep Element shell/navigation/timeline authority. The Yance room-header entry remains available; product load may open the global Product panel through the already-added public module method only if the final UAT proves it does not fight existing right-panel user intent.

- [ ] **Step 5: Run all Product tests**

Expected: old flat dashboard rejection GREEN and all Product source contracts GREEN.

---

### Task 9: Pin Product dependencies into the Element workspace reproducibly

**Files:**
- Modify late shared dependency root: `integration/element-module/package.json`
- Create: `upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch`
- Modify: `tools/matrix/bootstrap.js`

**Interfaces:**
- Direct runtime dependencies: exact `@base-ui/react@1.7.0`, `motion@12.42.2`, `@rive-app/react-canvas@4.31.0`, `howler@2.2.4`.
- Direct dev type dependency: exact `@types/howler@2.2.13`.
- Resolved Rive runtime identity must remain `@rive-app/canvas@2.39.2`.

- [ ] **Step 1: Fresh-read package/shared roots and Voice/Learning before edit**

Apply the same no-stale-blob rule as Task 8.

- [ ] **Step 2: Add only exact dependencies to `integration/element-module/package.json`**

No caret/tilde ranges for Product direct identities.

- [ ] **Step 3: Materialize pinned Element Web and generate lock replay**

On pinned Element Web `a2a996ae50d802878bf48e4bbf3730004bdcc55c`, apply `0001`, copy the exact Yance module overlay, run the pinned pnpm `11.5.2` lock-only resolution, and create a patch containing only the required `pnpm-lock.yaml` importer/package resolution changes. Verify the lock resolves Rive canvas 2.39.2 and no unexpected Product runtime authority.

- [ ] **Step 4: Update bootstrap to apply the lock patch after module copy**

`git apply --check` then `git apply` the lock patch; pinned Element commit remains detached and unchanged except explicit Yance patches/overlay.

- [ ] **Step 5: Re-materialize twice with frozen dependency install/build checks**

Both runs must resolve the same exact Product dependency identities and build/typecheck the Yance module.

---

### Task 10: Final functional, accessibility, motion, sound, performance and visual UAT

**Files:**
- Create: `docs/uat/V21_PRODUCT_EXPERIENCE_SHELL_P0_UAT.md`

**Interfaces:**
- Consumes exact implementation Head and real Electron product.
- Produces auditable acceptance evidence; does not alter runtime behavior.

- [ ] **Step 1: Functional UAT**

Verify People -> Relationship in one principal action; existing Matrix conversation remains usable; Photo/Voice/Live entry points are current-relationship Product actions; AI stays hidden until explicit request; overlay close restores prior conversation/focus state.

- [ ] **Step 2: Accessibility UAT**

Keyboard-only complete pass, visible focus, screen reader names/states, reduced-motion pass, no hover-only action, no color-only state, Sound Off silence.

- [ ] **Step 3: Motion/sound UAT**

Verify shared-layout avatar continuity, restrained spring/press feedback, no AI-thinking loop, Essential-only excludes decorative sounds, Immersive cues remain short/restrained.

- [ ] **Step 4: Performance UAT**

On the supported Windows baseline, record real Electron evidence for responsive composer typing/timeline scroll during nonessential animation, visually prompt interaction response, target 60fps animation behavior, and hidden Rive pause/settle behavior. Do not claim 60fps from unit tests.

- [ ] **Step 5: Visual UAT**

Verify "高级感压住游戏感": private-chat comfort first, high-quality feedback second, no HUD/XP/streak/leaderboard vocabulary. Capture exact-head screenshots/evidence in the UAT record according to existing project evidence policy.

---

### Task 11: Exact-head closure and stop at implementation merge boundary

**Files:**
- No new runtime scope beyond the sealed authorization.

- [ ] **Step 1: Run complete Product tests and build/type checks**

- [ ] **Step 2: Run applicable Stage / Layered / ACV2 / Windows / PVEP gates on the exact implementation Head**

- [ ] **Step 3: Run independent exact-Head review**

Required result: P0=0, P1=0. Resolve every real blocker by root-cause fix inside the authorized scope; do not suppress or waive.

- [ ] **Step 4: Re-read fresh `main`, Voice #211/Learning #223 or their merge results, and exact overlap**

If main moved in an authorized shared root, forward reconcile with ordinary history and re-run all gates/review.

- [ ] **Step 5: Stop**

When exact Head, UAT, gates, and independent review are all GREEN, leave the implementation PR Ready and stop at the final implementation merge boundary for owner approval. Do not merge the implementation PR in this work package turn without explicit final merge authorization.
