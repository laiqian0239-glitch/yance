# Yance V21 Product Experience Bilingual Search + Translation Task UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Product Experience message-level bilingual search/navigation plus truthful translation job progress/cancel/retry UX by composing existing backend, Electron, Element and Product Experience authorities.

**Architecture:** Extend the existing `r32StoreBridge -> preload -> product-experience/experienceProjection` path with exact adapters for the already-landed Store search and translation-job endpoints. Render a scoped `BilingualSearchPanel` inside the Product Shell and inject Element's public `api.navigation` as the only room/permalink navigation authority; no direct renderer HTTP client, private Element selector, second task registry, or second search/translation engine.

**Tech Stack:** Node.js, Electron contextBridge/IPC, React >=18, Element Web Module API v1.12.25, existing Base UI/Motion/Product Experience CSS token layer, Node `node:test` failure-first contracts.

## Global Constraints

- Work package: `V21-PRODUCT-EXPERIENCE-BILINGUAL-SEARCH-TRANSLATION-TASK-UX-P0`.
- Design authority: `docs/superpowers/specs/2026-08-15-yance-v21-product-experience-bilingual-search-translation-task-ux-design.md`.
- Planning baseline: trusted `main@9252ebba53d0e6d4bd0388a88ede2d0e74c7164c`; implementation must start from the later ordinary authorization merge commit, not this docs baseline.
- Existing backend `/api/r32/store/search` and translation job endpoints remain authoritative; no backend task/search/translation reimplementation.
- Existing `MessageTranslationService` + `AsyncOperationLifecycleAuthority` remain job lifecycle authority.
- Element/Matrix remains timeline, composer, room navigation, message state and send authority.
- Pinned Element v1.12.25 public `api.navigation.openRoom()` / `toMatrixToLink()` only; no private Element DOM/store navigation.
- No new dependency, search index, task database, design-system runtime, router, modal framework, translation provider, or general-purpose Yance infrastructure.
- Full-product visual consistency is a hard constraint: reuse existing Product Shell tokens, focus semantics, reduced-motion policy, surface hierarchy and bilingual evidence hierarchy; keep new view primitives replaceable for a later whole-product UX polish pass.
- No force-push, rebase, amend, squash, temporary bypass, wildcard authorization, gate weakening, or hidden fallback.
- First implementation commit after authorization is failure-first tests only.
- Final merge is ordinary two-parent merge after exact-head CI and independent review.

---

## File Structure

- `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js` — causal RED and architecture/UX/bridge contracts.
- `electron/r32StoreBridge.js` — thin IPC adapters to existing Store search and translation job HTTP endpoints.
- `electron/preload.js` — context-isolated bridge methods only.
- `integration/element-module/src/product-experience/experienceTypes.ts` — narrow search-result/job projection types.
- `integration/element-module/src/product-experience/experienceProjection.ts` — typed desktop bridge wrappers and result normalization; no persistent authority.
- `integration/element-module/src/product-experience/BilingualSearchPanel.tsx` — search/results/translation-job interaction UI.
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx` — composes search panel into both People and Relationship states.
- `integration/element-module/src/product-experience/ProductExperienceShell.css` — scoped visual states reusing existing tokens.
- `integration/element-module/src/index.tsx` — injects Element public navigation adapter into the Product Shell composition.
- `docs/uat/V21_PRODUCT_EXPERIENCE_BILINGUAL_SEARCH_TRANSLATION_TASK_UX_P0_UAT.md` — exact-head closure receipt and explicit Windows/CI evidence.
- `implementation/product-experience-phase1-status.json` — mark this Phase-1 slice complete only after evidence is true.

---

### Task 1: Freeze causal Product UX contracts

**Files:**
- Create: `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js`

**Interfaces:**
- Consumes: trusted-main Product Shell, existing Store search/translation authority, pinned Element public Module API.
- Produces: a tests-only causal RED proving Product Shell bridge/UI/navigation closure is absent while backend authority already exists.

- [ ] **Step 1: Write backend-reuse and no-duplicate-infrastructure assertions**

Require current backend route source to contain `/search`, `/translations/messages/:messageId/jobs`, `/translations/jobs/:jobId`, cancel and retry, and require the new Product source to avoid `fetch(`, `axios`, SQLite, custom queue/index/task-store names, and private Element selectors.

- [ ] **Step 2: Write Electron bridge RED assertions**

Require exact channel literals and exact endpoint mappings for:

```text
store:search-workspace -> GET /api/r32/store/search?q=...&limit=...
store:create-translation-job -> POST /api/r32/store/translations/messages/:messageId/jobs
store:get-translation-job -> GET /api/r32/store/translations/jobs/:jobId
store:cancel-translation-job -> DELETE /api/r32/store/translations/jobs/:jobId
store:retry-translation-job -> POST /api/r32/store/translations/jobs/:jobId/retry
```

Require matching preload methods and ensure no renderer token/credential transport is added.

- [ ] **Step 3: Write Product UI/navigation RED assertions**

Require `BilingualSearchPanel.tsx`, original + Chinese result evidence, loading/empty/error states, `aria-live`, progress semantics, Cancel, Retry, and bounded polling cleanup. Require `index.tsx` to consume `api.navigation.openRoom` and/or `api.navigation.toMatrixToLink`; reject `querySelector(...timeline|composer...)`, `mx_RoomView`, `mx_MessageComposer`, and private Element store imports.

- [ ] **Step 4: Write visual-consistency assertions**

Require all new CSS selectors under `.yance-product-shell`, reuse of existing `--yance-*` variables, visible focus treatment, reduced-motion handling, and no new top-level token namespace or hard-coded one-off brand palette.

- [ ] **Step 5: Commit tests only and prove causal RED remotely**

The first implementation commit must modify only this test file. Push it, run exact-head Stage/Layered/Product/Windows routing, and record the failure as missing bridge/UI/navigation Product closure rather than unrelated baseline breakage.

---

### Task 2: Extend the existing Electron Store bridge

**Files:**
- Modify: `electron/r32StoreBridge.js`
- Modify: `electron/preload.js`
- Test: `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js`

**Interfaces:**
- Produces preload methods:
  - `storeSearchWorkspace({ query, limit })`
  - `storeCreateTranslationJob({ messageId, force?, forceNew?, timeoutMs? })`
  - `storeGetTranslationJob({ jobId })`
  - `storeCancelTranslationJob({ jobId })`
  - `storeRetryTranslationJob({ jobId, timeoutMs? })`

- [ ] **Step 1: Add exact channels to `CHANNELS`**

Use descriptive literals listed in Task 1; do not overload reply-generation cancellation or create a generic arbitrary-URL bridge.

- [ ] **Step 2: Add thin handler mappings**

Validate required IDs with existing `clean()`, use `URLSearchParams` for search, `jsonBody()` for POSTs, and delegate to `apiRequest()` only. Return backend payload unchanged.

- [ ] **Step 3: Expose exact preload methods**

Each method calls `invokeStore()` on one exact channel. Do not expose raw `ipcRenderer`, raw local-API URL, or generic invoke.

- [ ] **Step 4: Run targeted RED/GREEN tests**

Expected: bridge/preload assertions GREEN while Product panel/navigation assertions remain RED.

- [ ] **Step 5: Commit**

Commit only bridge/preload changes plus any test expectation refinement that follows the frozen contract without weakening it.

---

### Task 3: Add typed Product projections and public navigation injection

**Files:**
- Modify: `integration/element-module/src/product-experience/experienceTypes.ts`
- Modify: `integration/element-module/src/product-experience/experienceProjection.ts`
- Modify: `integration/element-module/src/index.tsx`
- Modify: `integration/element-module/src/YanceWorkspace.tsx` only if required to pass the navigation adapter without creating a second root; otherwise leave untouched.
- Test: `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js`

**Interfaces:**
- Produces normalized types `BilingualSearchResult`, `TranslationJobProjection`, and Product functions `searchWorkspace`, `createTranslationJob`, `readTranslationJob`, `cancelTranslationJob`, `retryTranslationJob`.
- Produces a Product navigation callback that receives normalized result/relationship identity and delegates only to public Element navigation.

- [ ] **Step 1: Define narrow types**

Include only fields already returned by backend/search/job snapshots: IDs, contact name/platform, original text, `translatedZh`, source language, direction, sent time, status/progress/durable state/error and cancellability.

- [ ] **Step 2: Add bridge wrappers**

`experienceProjection.ts` reads `window.yanceDesktop` methods, validates required identifiers, normalizes arrays/objects, and throws explicit bridge-unavailable errors. It must not persist results or job state beyond the calling component.

- [ ] **Step 3: Inject Element navigation from module root**

Create the smallest composition seam needed so a Product result can call `api.navigation.openRoom(roomIdOrAlias)` or `api.navigation.toMatrixToLink(permalink)`. Do not import Element application internals into Product files.

- [ ] **Step 4: Preserve truthful unresolved-navigation behavior**

When only provider/session identifiers exist and no Matrix room/permalink can be proven, select the matching Product relationship context and surface `exactNavigationAvailable=false`; never coerce provider IDs into Matrix IDs.

- [ ] **Step 5: Run targeted tests and commit**

Expected: projection/navigation architecture GREEN; panel rendering remains RED.

---

### Task 4: Build the bilingual search and translation-task surface

**Files:**
- Create: `integration/element-module/src/product-experience/BilingualSearchPanel.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`
- Test: `tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js`

**Interfaces:**
- Consumes Task 3 typed projection methods and navigation callback.
- Produces one scoped Product UX surface; no new authority.

- [ ] **Step 1: Implement collapsed/expanded search interaction**

Use a labeled search input, explicit submit/debounce behavior, Escape/collapse behavior that does not steal Element timeline focus, and `aria-live=polite` status text.

- [ ] **Step 2: Render truthful result evidence**

Each message result displays contact/platform, original message, Chinese translation only when present, sent time, and navigation availability. Contacts and messages are grouped semantically; no fabricated translation placeholder is shown as success.

- [ ] **Step 3: Implement job lifecycle UX**

Creating a job stores only the selected authoritative snapshot in React state. Poll only while `queued/running`, clamp displayed progress to 0..100, stop on terminal/unmount, expose Cancel only when `cancellable`, Retry only after failed/cancelled, and keep last snapshot on transport error.

- [ ] **Step 4: Integrate into `ProductExperienceShell`**

Keep the control available in People and Relationship scenes without remounting Element timeline/composer. Search navigation may select an existing Product relationship but must not mutate message/composer state.

- [ ] **Step 5: Apply visual consistency constraints**

Use existing `.yance-*` surface/input/button patterns and `--yance-*` variables. Add scoped search/result/progress selectors, visible `:focus-visible`, reduced-motion override, stable min-heights for async state, and restrained Motion usage only for expand/result state transitions.

- [ ] **Step 6: Run targeted tests and commit**

Expected: complete targeted test file GREEN.

---

### Task 5: No-regression and Product closure evidence

**Files:**
- Create: `docs/uat/V21_PRODUCT_EXPERIENCE_BILINGUAL_SEARCH_TRANSLATION_TASK_UX_P0_UAT.md`
- Modify: `implementation/product-experience-phase1-status.json`
- Test: existing Product/Store/translation suites plus new WP0 test.

**Interfaces:**
- Produces exact-head evidence only; no new runtime behavior.

- [ ] **Step 1: Run targeted existing suites**

At minimum:

```bash
node --test --test-concurrency=1 \
  tests/wp0/v21-product-experience-bilingual-search-translation-task-ux.test.js \
  tests/wp0/v21-product-experience-shell-p0.test.js \
  tests/wp0/v21-product-experience-shell-interaction.test.js \
  tests/wp0/v21-product-experience-shell-accessibility.test.js \
  backend/tests/messageTranslationService.test.js
```

If exact existing translation test filename differs, use the repository's actual landed MessageTranslationService test without adding an alias.

- [ ] **Step 2: Run routed repository gates**

Require exact-head Stage 6.4.5.9, ACV2, Layered CI, Product Experience Final Validation, and Windows sealed/runtime gates selected by current routing policy.

- [ ] **Step 3: Record UAT truthfully**

The UAT receipt records search original/Chinese evidence, room/permalink navigation when resolvable, unresolved-navigation truthfulness, queued/running/progress/cancel/retry/terminal job states, keyboard/focus/reduced-motion behavior, and exact CI run IDs. Do not claim a physical Windows interaction that was not executed.

- [ ] **Step 4: Update Phase-1 status**

Move only `Complete message-level bilingual search/navigation and translation task progress/cancel UX` from `nextImplementationSlice` into `completed` after exact-head evidence is GREEN. Preserve unrelated remaining slices.

- [ ] **Step 5: Commit evidence/status**

No runtime changes in this commit.

---

### Task 6: Independent exact-head review and ordinary merge

- [ ] **Step 1: Freeze exact implementation Head**

Re-read remote branch Head, current `main`, authorization scope/digest, changed-file set, and compare ahead/behind. No tentative SHA is merge authority.

- [ ] **Step 2: Require independent review**

Review explicitly for P0/P1 blockers in: duplicate authority, IPC privilege expansion, unbounded polling, stale-job writeback claims, private Element navigation, fabricated Matrix IDs, focus theft, translation evidence hierarchy, reduced motion, async error recovery, CSS/token divergence, and Product Shell remount/state regression.

- [ ] **Step 3: Root-fix findings**

Any material finding gets a normal descendant commit plus exact-head CI rerun; no temporary bypass, ignore, suppression, or review-only waiver.

- [ ] **Step 4: Fresh merge check**

Re-read `main` and exact implementation Head. If `main` moved, reconcile with ordinary history only and rerun exact-head verification/review.

- [ ] **Step 5: Ordinary merge**

Merge with `merge_method=merge` and `expected_head_sha=<reviewed exact head>` only after all required checks/review are GREEN.

- [ ] **Step 6: Post-merge validation**

Confirm trusted `main` advanced to the ordinary merge commit and the merged tree contains the exact reviewed feature closure before claiming completion.
