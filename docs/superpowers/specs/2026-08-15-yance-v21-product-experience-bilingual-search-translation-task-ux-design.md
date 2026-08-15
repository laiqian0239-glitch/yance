# Yance V21 Product Experience Bilingual Search + Translation Task UX Design

## Status

Approved for continuous execution under the owner's 2026-08-15 full-work-package authorization. The design baseline is trusted `main@9252ebba53d0e6d4bd0388a88ede2d0e74c7164c`.

## Goal

Close the remaining Product Experience Phase-1 slice for message-level bilingual search/navigation and truthful translation task progress/cancel/retry UX without creating any new messaging, search, translation, task, routing, or design-system authority.

## Existing authority reused end-to-end

- `backend/routes/store.js` already exposes `/search`, synchronous translation, durable translation jobs, job read/list, cancel, and retry.
- `backend/services/messageTranslationService.js` already owns translation eligibility, dedupe, durable `AsyncOperationLifecycleAuthority`, progress, cancellation, retry, stale-result rejection, and message writeback.
- `frontend/js/r32-store-client.js` already demonstrates the public HTTP contracts, but the Element Product Shell must not import the legacy frontend client.
- `electron/r32StoreBridge.js` remains the privileged Electron renderer-to-local-API authority.
- `electron/preload.js` remains the context-isolated renderer surface.
- Element Web v1.12.25 public Module API owns navigation. Its pinned `NavigationApi` exposes `openRoom()` and `toMatrixToLink()`; Product code must not query Element private DOM or stores.
- `integration/element-module/src/product-experience/*` remains Product composition only. Element/Matrix continues to own the real timeline, composer, room navigation, message state, and send authority.

## OSS-fit / infrastructure decision

This package adds no dependency and no new general-purpose infrastructure. Mature/repository-native authorities already fit the problem:

1. Element Web Module Navigation API — **FIT** for room/permalink navigation.
2. Existing R32 Store search endpoint — **FIT** for original/translated text search.
3. Existing MessageTranslationService + AsyncOperationLifecycleAuthority — **FIT** for translation task lifecycle.
4. Existing Base UI + Motion + Product Experience token layer — **FIT** for accessible controls and interaction polish.

Explicitly avoid a second search index, second translation queue, renderer-side task registry, custom navigation router, private Element selectors, second modal framework, or new Yance design-system runtime.

## UX model

### 1. Persistent bilingual find surface

Add a compact `BilingualSearchPanel` to `ProductExperienceShell`, available from both People and Relationship states without replacing the Element timeline. The collapsed state is visually quiet; activating it reveals a search input and results region. Search is user-driven with a short debounce and clear loading/empty/error states.

Search results show the relationship/contact, platform when present, the original message text, Chinese translation when available, and message time. A Chinese query can match persisted `translatedZh`; an original-language query can match source text through the existing store search authority.

### 2. Navigation contract

Navigation remains Element-owned. The Element module injects a tiny navigation adapter into Product Experience rather than letting Product components import Element internals.

- If the result can be resolved to an Element room/permalink using already-projected identifiers, call the pinned public `api.navigation.openRoom()` or `api.navigation.toMatrixToLink()`.
- Never synthesize a Matrix room/event identity from a WhatsApp/Telegram/etc. provider identifier.
- If exact Matrix identity is unavailable, select/open the corresponding Yance Relationship World and preserve the search hit as visible context; state explicitly that exact Element message navigation is unavailable rather than silently claiming success.
- No `querySelector()` against Element timeline/composer and no private Matrix/Element store import.

### 3. Translation task controls

For a message result, Product UI may create an existing durable translation job and then observe its authoritative snapshots. The UI renders the backend-owned job fields only: `status`, `progress`, `durableState`, `cancellable`, `errorCode`, `error`, and terminal timestamps.

- `queued/running`: show determinate progress and Cancel when `cancellable=true`.
- `success`: show translated text returned by refreshed search/message state; no duplicate local cache becomes authority.
- `failed`: show concise error and Retry.
- `cancelled`: show cancelled state and Retry.
- Superseded/stale outcomes stay explicit; the UI never promotes an old result locally.

Polling is bounded to an active selected job and stops at terminal state/unmount. Desktop events may be used as an acceleration signal, but correctness cannot depend on an event arriving.

## Component boundaries

- `ProductExperienceShell.tsx`: composition and injected Product navigation callbacks only.
- `BilingualSearchPanel.tsx`: search/query/result/task presentation and accessible interaction state; no direct IPC implementation.
- `experienceProjection.ts`: typed wrappers for desktop search and translation-job bridge operations plus normalization. No persistent task store.
- `experienceTypes.ts`: narrow Product projection types for search results/jobs if needed.
- `index.tsx`: binds Product navigation to Element public `api.navigation`; no search/translation logic.
- `electron/r32StoreBridge.js`: thin channel-to-existing-local-API adapters only.
- `electron/preload.js`: exact bridge methods only.
- `ProductExperienceShell.css`: reuse existing CSS custom properties and semantic classes; new selectors remain scoped under `.yance-product-shell`.

No backend service or database migration is expected unless a failure-first test proves an existing API cannot express the required truth.

## Visual consistency and UX-polish reserve

Full-product visual consistency is a hard constraint. This package must not over-specialize its UI in a way that makes later polish expensive.

- Reuse existing Product Shell typography, radius, spacing, surface, focus, and motion tokens; do not introduce one-off color families or a second token namespace.
- Keep search result, async-status, action-button, empty/error/loading structures semantic and replaceable so a later whole-product polish pass can restyle them without moving data authority.
- Match existing reduced-motion behavior and visible focus conventions.
- Do not add decorative motion to progress, loading, or error states; motion communicates state changes only.
- Preserve bilingual copy hierarchy: original content remains primary evidence, Chinese translation is an explicit secondary representation unless the user's current reading mode says otherwise.
- Keep controls keyboard reachable, with `aria-live` for async status and no focus stealing on background progress updates.

## Failure and recovery

- Search transport failure: keep current query and show retryable error; do not clear prior successful results unless the query changed.
- Translation create/read/cancel/retry failure: show the connector/local-API reason code and keep the last authoritative job snapshot.
- Component unmount or result switch: stop polling; never auto-cancel a backend job unless the user explicitly chose Cancel.
- Missing relationship/navigation identity: preserve the result and open Product relationship context when possible; do not invent identifiers.
- Backend restart: job state is read from the existing durable lifecycle authority where available; UI may show unavailable until the local API returns.

## Verification contract

Failure-first tests must prove the pre-implementation baseline is missing the Product UI/desktop bridge closure while the backend authority already exists. GREEN must require:

- no duplicate translation/search/task implementation;
- Electron bridge channels map exactly to existing store endpoints;
- preload exposes exact typed operations;
- Product projection consumes only those operations;
- search renders original + translated evidence;
- translation job states expose progress/cancel/retry truthfully;
- Element navigation uses public `api.navigation` and rejects private-DOM navigation patterns;
- reduced-motion, focus, live-region, loading, empty, failure, cancellation, and retry states exist;
- existing Product Experience, Store search/translation, Stage, ACV2, Layered CI and Windows sealed-runtime regressions remain GREEN.

## Scope exclusions

No global command palette, no new design system, no semantic/vector search, no new translation model/provider, no automatic bulk translation, no new message database columns, no new Matrix timeline/composer, no autonomous navigation, no live randomized UI experimentation, and no unrelated Product Experience redesign in this work package.
