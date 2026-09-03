# V21 Product Final — Living Relationship OS Checkpoint

> Status: `FROZEN_PRODUCT_RED / SUCCESSOR_REQUIRED`
>
> This document is a machine-style release checkpoint and reconciliation ledger. It is **not** implementation authorization by itself. Live Git refs, exact heads, branch-specific authorization and consumed workflow evidence remain authoritative. Before any Product Final continuation, reconcile this checkpoint against live GitHub state first.

## 1. Machine checkpoint

- CURRENT MAIN OBSERVED: `604b3788fcfd61135870b8bbc972675741694f42`
- CURRENT EXACT HEAD: `94676c71c2678c64114d1912b8bdda760176e58f`
- CURRENT BRANCH: `fix/v21-product-integration-authority-p0-successor-v10`
- CURRENT PR: none
- V10 STATUS: `FROZEN_PRODUCT_RED`
- V10 COMMIT: `fix(v21): make Yance the primary product integration authority`
- CONSUMED CI RUN: `33739369614` = GREEN; **never rerun**
- FROZEN PRIOR GREEN: V6–V9 Matrix identity/session/credential/recovery; Element 0015/0016 local closure
- CURRENT ROOT CAUSE:
  `PRODUCT_FINAL / LIVING_RELATIONSHIP_OS_COMPOSITION_INCOMPLETE`
- KNOWN SEPARATE ROOTS FROM THIS READ-ONLY CENSUS: none
- NEXT SUCCESSOR TARGET: `fix/v21-product-final-living-relationship-os-successor-v11`

## 2. Product authority / final experience contract

The approved Product direction is **Yance Living Relationship OS**:

- People-first.
- Game feel, but no points/cheap gamification.
- AI invisible unless contextually useful.
- Primary navigation is people/relationships, not AI / Goal / Media / Presence / Learning / Model tools.
- Each person owns one Relationship World.
- Conversation remains the center.
- Moments, Voice, Photo, Live and Private Quest unfold around the current relationship/conversation.
- Yance owns relationship orchestration and visual identity only.
- Element / Matrix remains the sole real conversation/timeline/composer/session authority.
- Letta / Graphiti / Parlant / LiteLLM / Immich / ComfyUI / LiveKit / CyberVerse / Voice / Learning remain existing mature domain authorities.
- No second timeline, second composer, second chat runtime, second account backend, second route registry, second credential store, custom UI framework or custom animation engine.

Visual intent to preserve in the successor:

- important people are the first meaningful content after access is usable;
- stable living cards / relationship universe;
- restrained breathing / living feedback that never pretends a person is online;
- person-specific decorative relationship palette without inventing intimacy semantics;
- avatar spatial continuity into Relationship World;
- tool opening should feel spatially continuous with the composer;
- Private Quest shows progress / memory hint / next step, not model internals.

## 3. Frozen GREEN — keep, do not recreate

The following are not current debugging targets unless the successor diff directly invalidates them:

1. Electron starts the Product location `#/yance`.
2. Element public navigation location renderer exists.
3. Element public composer accessory seam exists.
4. Existing Element login/session authority remains the sole Matrix session authority.
5. V6–V9 Matrix local identity, session, credential and recovery evidence remains frozen GREEN.
6. Photo / Attachment / Voice existing domain runtimes remain mature child authorities.
7. Store search / translation durable authorities remain.
8. Theme/font Store authority and Element appearance integration remain.
9. Windows native titlebar source closure remains; final drag/min/max/close is local-harness acceptance, not UAT debugging.
10. Existing backend `/api/r32/accounts` account lifecycle/auth authority remains; do not rebuild account backend.
11. Existing Personal Access backend remains entitlement authority and must stay fail-closed.
12. Existing backup/portable-backup authority remains; do not build a second backup engine.

## 4. Product Final Causal Census V2 — confirmed RED / SAME ROOT

### P0-A — People-first composition is still false

Current usable Product still prepends Personal Access / OWNER management and renders Search before People. `PeopleSurface` itself exists, but the first meaningful experience is not "important people".

Required closure:

- entitlement remains a gate, not homepage content once usable;
- OWNER management moves to a reachable secondary admin surface;
- Search / Accounts / Settings become secondary controls;
- usable startup lands directly on People;
- zero relationships must show a direct platform-account onboarding CTA instead of a dead empty state.

### P0-B — Relationship World is not conversation-centered

Current `RelationshipWorld` explicitly presents "conversation remains in Element" while the visible body is Rive + relationship intelligence/evidence. That is a composition defect, not a Matrix defect.

Required closure:

- Relationship World is organized around "continue this relationship / continue conversation";
- actual room/timeline/composer remains Element;
- Moments / Next Step / Private Quest surround the conversation path;
- no duplicate timeline/composer or private Element DOM/store access.

### P0-C — Person -> canonical conversation -> Matrix room reverse routing is missing

`RelationshipProjection` defines `matrixRoomId` / `matrixPermalink`, but current Store projection does not reliably populate them. Current relationship intelligence join also takes the first conversation ID for a contact, which is not a valid multi-platform routing rule.

The existing safe route resolver only works in the opposite direction:

`active Element room -> m.bridge / uk.half-shot.bridge -> unique Store canonical conversation`.

Required closure:

1. A relationship must project the **set of canonical conversations** for that contact; never silently use `[0]` as the routing truth.
2. A person with zero conversations has an explicit no-conversation state.
3. A person with one canonical conversation can continue directly.
4. A person with multiple conversations/platforms gets an explicit conversation/account choice or an evidence-backed deterministic recent-conversation selection with visible switch; no arbitrary first-row behavior.
5. Resolve canonical conversation -> unique Matrix room using the same standard bridge identity (`m.bridge` / `uk.half-shot.bridge`) and the existing Store route authority.
6. Zero or multiple Matrix-room matches fail closed.

#### Element public seam census

Pinned Element v1.12.25 public `ClientApi` exposes `getRoom(id)` but no room enumeration. Existing Yance 0013 adds read-only `Room.getStateEvents()` only for a known room.

Repository census found no canonical Yance backend room registry that should replace standard Matrix bridge state; prior route governance explicitly selected standard `m.bridge` state and rejected a second route registry.

Therefore, if implementation preflight confirms no already-published safe enumeration seam, one **new additive thin Element module API patch** is allowed to expose read-only room enumeration backed by upstream MatrixClient room enumeration and existing safe Room wrappers. It must not edit/rewrite frozen 0013/0015/0016 evidence and must not expose MatrixClient itself.

A new patch is justified only for this missing read-only Product seam; no other Element upstream mutation is authorized by this checkpoint.

### P0-D — Desktop activation/deep-link path is not wired into Product

Electron still emits `onOpenConversation` / `onOpenView` for notification clicks, tray/second-instance/deep-link activation. Current Element Product module does not consume these events.

Required closure:

- the same canonical conversation -> Matrix room resolver used by People must also serve desktop activation;
- notification click to a conversation opens the correct real Element room;
- view activations open the corresponding Product secondary surface when supported;
- activation with stale/ambiguous identity fails closed and remains on a safe Product state;
- no legacy frontend-only activation dependency may be required for the packaged Product.

### P0-E — `#/yance` still carries unrelated Element chrome

Pinned Element `LoggedInView` suppresses the ordinary room list for a module renderer, but still renders `SpacePanel` for module full-screen views. Therefore "load #/yance" is not sufficient proof that Yance owns the visible Product shell.

Required closure:

- Yance module Product view must not show unrelated Element SpacePanel as primary Product chrome;
- actual Element room view must retain normal Element conversation navigation/chrome;
- prefer a narrow generic/additive module-layout seam over brittle CSS that targets private Element DOM;
- combine with the new read-only room seam only if both can be closed cleanly in one additive pinned Element successor patch; otherwise do not broaden the patch.

### P0-F — Platform Accounts is only a list; mature lifecycle already exists elsewhere

Current Product account surface only lists/refreshes accounts. The repository already has a mature account-center state machine and backend authority. Do **not** invent a new simplified account auth mechanism from scratch.

Source-migrate the proven lifecycle semantics from existing `frontend/r32-account-center.js` into the Element Product, with thin typed React/IPC adaptation and Product-first presentation.

Required end-user lifecycle:

- platform capability/availability gating;
- add account;
- update basic account identity/display fields where already supported;
- connect;
- reconnect;
- sync / sync all;
- set default;
- pause / resume;
- logout;
- remove with explicit confirmation;
- authorization pending / discard-pending recovery;
- runtime/auth-challenge projection;
- safe-mode/offline/error truth;
- bounded polling only during active auth continuation;
- failure cleanup and no duplicate auth attempt.

Required platform continuation:

- WhatsApp QR/auth challenge path;
- Telegram QR;
- Telegram phone -> code -> password -> cancel;
- Facebook Page OAuth start/status/select-page/cancel;
- Facebook personal-identity account kind where supported by the existing authority;
- Facebook personal Messenger start/input/wait/cancel.

Credentials/secrets remain transient and backend-owned. Product renderer must not introduce localStorage/sessionStorage/file credential persistence and must not repurpose generic `saveCredential()` as a second account-auth store.

### P0-G — Zero-state onboarding is missing

People-first must not become a dead-end blank page.

Required closure:

- no relationships + no connected platform account => direct "连接账号" onboarding CTA;
- account connected but no relationships yet => visible sync/recovery state and refresh/sync action;
- once relationships arrive, People becomes primary automatically;
- no engineering error codes as the main empty-state copy.

### P0-H — First-use login still exposes architecture and duplicated steps

Current first-use surface asks the user to create a local Matrix identity while the Element login form is also present, then tells the user to re-enter the Matrix ID/password below. Fixed Element config already pins the local Yance homeserver and disables custom URLs.

Required closure:

- Product language says Yance/local account, not Matrix/Synapse architecture as the primary copy;
- do not show the underlying Element form until the local identity step is ready for handoff;
- hide fixed server-selection chrome where it provides no user choice;
- preserve truthful recovery/unknown-outcome semantics;
- preserve Element as login/session authority.

Explicit defer/non-blocker: do **not** expand frozen Matrix identity/session secret semantics merely to create one-click auto-login. Pinned Element public auth API only supports overwriting already-issued auth credentials; current local identity receipt intentionally does not persist/return access tokens. No private DOM automation and no new secret persistence for convenience.

### P0-I — Engineering/admin surfaces leak into ordinary Product

Ordinary Product must not expose the following as primary user UI:

- Graphiti / AI-analysis authority labels;
- Product account authority labels;
- Model Brain / LiteLLM routing internals;
- Ollama model downloads;
- local runtime materialization;
- SHA-256 / asset paths / GPU-RAM planner internals;
- Learning rollout/promotion/rollback/evidence governance screens.

Preserve the underlying authorities; remove them from ordinary Product composition.

### P0-J — Media relationship tool itself leaks developer configuration

Current Product Photo/Media overlay exposes "media library address", API key, external connection policy, generation-engine address and runtime status. Hiding only top-level system settings is insufficient.

Required closure:

- Product-embedded Media mode shows user photo/video library, people/albums, generation/edit, preview and send;
- developer endpoint/API-key/external-policy settings remain outside ordinary Relationship World;
- existing secure settings authority remains untouched;
- standalone/admin Media mode may preserve those controls if still needed, but Product route must not expose them.

Voice Product mode already hides manual platform/account/JID fields when route-bound; preserve that behavior and keep user-facing voice controls.

### P0-K — Live/Presence is not bound to the current relationship route

Current photo/attachment/voice tools require a resolved Product route; Live does not.

Required closure:

- Live opens only against the active relationship/conversation context or explicitly fails closed;
- no second Presence route state;
- keep LiveKit/CyberVerse authority unchanged.

### P0-L — User settings were accidentally lost while engineering settings remained

Removing `ProductSystemSettingsSurface` wholesale would be another regression. The current legacy/basic surfaces contain real persisted end-user settings and update/data-protection abilities that must survive the Product cutover.

Successor must **split user settings from engineering settings**.

User-facing secondary settings to preserve/project from existing authorities:

- theme / font size;
- sound / motion / atmosphere;
- close-to-tray;
- auto-connect accounts;
- desktop notification enablement;
- notification sound enablement;
- existing backup / verify / staged restore;
- portable backup import/create/verify/stage/export/delete;
- update state/check/download/install only under truthful safety gating;
- OWNER Personal Access management as a secondary OWNER-only admin surface.

Where existing desktop settings already expose auto-launch/start-minimized/update preferences, preserve them only if they are currently backed by the real settings authority; do not invent React-only toggles.

Engineering-only model/runtime/Learning governance remains hidden from ordinary Product.

#### Update safety caveat

Legacy update UI derived `unsavedChanges` from old frontend DOM selectors. That detector is not valid for the Element composer. Do not port that DOM probe.

If Product exposes update install:

- backend `/api/r32/system/update-preflight` remains required;
- renderer work-state must be truthfully derived from Product/public Element seams or remain fail-closed;
- no private Element composer DOM/store inspection;
- never report `unsavedChanges=false` merely because the old `#composerText` element is absent.

If truthful renderer work-state cannot be proven in the successor scope, keep install action outside the Product surface rather than weakening the updater gate.

### P0-M — AI must remain epistemically honest while visually invisible

Current UI exposes Graphiti/AI/projection provenance as ordinary copy. Product should translate it into user language without erasing uncertainty.

Required closure:

- confirmed/user-marked events can be shown as confirmed moments;
- inferred content must remain visibly tentative (e.g. "可能" / "待确认"), not silently promoted to fact;
- unavailable/stale intelligence must not fabricate stage/summary/next step;
- no relationship strength/closeness ranking from decorative geometry.

### P0-N — Moments is an evidence list, not a Product moment surface

Reuse existing trusted relationship events / annotations. Do not create a new memory authority.

Product projection should present:

- important/recent moments;
- source confidence in human language only when relevant;
- date/time where valid;
- no raw Graphiti/projection-engine vocabulary.

### P0-O — Product tests currently allow false GREEN

Static token/file-presence tests are necessary but insufficient. A candidate can currently satisfy many source assertions while the shipped user path remains obviously wrong.

New regression closure must assert **reachable paths and negative Product contracts**, not just component names.

## 5. Design completeness — same batch, no new authority

These are part of Product Final quality and should be closed when low-risk within the same successor; they must not create separate infrastructure.

1. Matching Motion layout identity for People avatar -> Relationship World avatar; current world declares a layoutId but People avatar does not match it.
2. Restrained breathing/living feedback on people cards/nodes; fully disabled under reduced motion.
3. Stable person-specific decorative palette derived from a non-semantic stable key; it must never encode untrusted intimacy/importance.
4. Relationship status ring, if retained, must represent a truthful Product state (e.g. data freshness/readiness) and must never masquerade as online presence.
5. Tool open/close transitions should maintain spatial continuity with the composer/relationship tool trigger without duplicating media state.
6. Verify 1180x720 minimum window and Windows display scaling 100/125/150%; no clipped relationship/world/settings/auth controls.

Exact image-to-preview "bloom" is a Product polish target, not justification for a second media framework or private Element DOM dependency.

## 6. Multi-conversation routing contract

Relationship routing must be modeled explicitly:

`contact / relationship -> canonical Store conversations[] -> selected canonical conversation -> unique Matrix room -> Element openRoom()`

Each canonical conversation carries existing Store identity:

- platform;
- source account ID;
- platform contact identity/chat JID;
- conversation/session ID;
- last-message/update timestamps where already authoritative.

Matrix room matching uses standard bridge room state. No Yance-maintained mapping registry is allowed.

The exact same resolver must be reused by:

- People / Relationship World continue-conversation action;
- search result navigation;
- desktop notification click;
- tray/second-instance/deep-link conversation activation;
- relationship tool route continuity where directionally applicable.

## 7. Product hierarchy after closure

Normal user path:

```text
Yance
├─ People / Relationship Universe        PRIMARY
│  └─ Person / Relationship World
│     ├─ Conversation                    CENTER (real Element room)
│     ├─ Moments
│     ├─ Photo / Voice / Live / Attachment
│     └─ Private Quest / Next Step
├─ Search                                SECONDARY
├─ Accounts                              SECONDARY + zero-state CTA
└─ Settings                              SECONDARY
   ├─ Appearance / sound / motion
   ├─ Desktop / notifications
   ├─ Data protection / restore
   ├─ Update (only truthful safe path)
   └─ OWNER access management (OWNER only)
```

Ordinary Product must not become an AI/Model/Learning/runtime admin dashboard.

## 8. Source-migration / reuse rules

Do not reinvent mechanisms already present in the repository.

Read-only source references for successor implementation:

- `frontend/r32-account-center.js` — mature account lifecycle/auth continuation semantics;
- `frontend/r32-basic-settings.js` — persisted basic desktop/runtime/notification settings semantics;
- `frontend/r32-update-center.js` — update phase/error/product copy, **excluding legacy DOM dirty-state detection**;
- current `ProductSystemSettingsSurface.tsx` — existing backup/portable-backup projection, to be separated from model/runtime admin;
- existing `RelationshipOverlayHost.tsx` — canonical active-room -> Store route matching/fail-closed semantics;
- upstream Element/Matrix APIs at the pinned commit — only thin additive public read/layout seams when no existing public seam exists.

Legacy frontend remains a reference source, not a second Product runtime authority. Do not make the final Product depend on the legacy frontend being mounted.

## 9. Allowed mutation for successor-v11

Initial allowed Product paths:

- `integration/element-module/src/index.tsx`
- `integration/element-module/src/YanceWorkspace.tsx`
- `integration/element-module/src/YanceLogin.tsx`
- `integration/element-module/src/YanceLogin.css`
- `integration/element-module/src/product-experience/**`
- `integration/element-module/src/MediaWorkspace.tsx`
- `integration/element-module/src/VoiceWorkspace.tsx` only for Product-mode presentation/routing if required
- `integration/element-module/src/PresenceWorkspace.tsx`
- `electron/r32StoreBridge.js`
- `electron/preload.js`
- `electron/m2/ipcManifest.json`
- directly affected Product/desktop tests

Conditional allowed upstream seam, only after exact implementation preflight reconfirms necessity:

- one new additive Element patch after 0016 for read-only room enumeration and/or Product full-screen module chrome closure;
- `tools/matrix/bootstrap.js` only to apply that one new pinned patch;
- exact focused tests for the new public seam.

Do not modify frozen 0013/0015/0016 patch bytes to solve the successor.

## 10. Explicitly forbidden scope unless a genuinely different root is proven

- backend account routes/services/core;
- Matrix local-identity backend semantics;
- SQLite schema/migrations/storage;
- Docker/Compose/Matrix runtime topology;
- Graphiti/Letta/Parlant/LiteLLM engines;
- Media/Voice/Presence engines;
- Learning pipeline/governance;
- release workflows/routing governance merely to make the change pass;
- dependency/package/lockfile changes unless an exact new seam strictly requires an already-approved pinned package;
- second chat timeline/composer;
- second account backend;
- second route registry;
- new credential persistence;
- private Element DOM/store imports;
- reinstall/download loops before local causal closure.

If implementation proves a required fix lies outside this scope, stop and classify it as a genuinely different root before mutation.

## 11. Local acceptance before any new Exact Head

Required focused contracts/local harness:

### Product entry / chrome

1. Existing session startup -> `#/yance`.
2. usable entitlement -> People immediately primary.
3. unusable entitlement -> fail-closed access gate.
4. OWNER access management reachable secondarily, never prepended to usable Product.
5. Yance module view does not expose unrelated Element SpacePanel/product chrome.
6. Entering a real Element room restores normal Element conversation chrome.

### Relationship / conversation

7. zero relationships -> direct account onboarding CTA.
8. one relationship/one conversation -> continue conversation opens exact room.
9. one relationship/multiple conversations -> no arbitrary `[0]`; explicit/deterministic truthful selection.
10. zero matching Matrix rooms -> fail closed.
11. multiple matching Matrix rooms -> fail closed.
12. Person -> Relationship World -> Element room -> Yance return preserves the selected person/context.
13. Search result uses the same resolver.
14. notification/deep-link `onOpenConversation` uses the same resolver.
15. stale activation payload does not navigate to a wrong person/room.
16. no duplicate timeline/composer/private Element internals.

### Relationship tools

17. Photo current-room binding.
18. Voice current-room binding.
19. Attachment current-room binding.
20. Live current-room/relationship binding or fail-closed.
21. Product Media hides endpoint/API-key/external-policy developer settings.
22. Private Quest reachable and does not expose model internals.
23. Moments/Next Step reachable and epistemically honest.

### Accounts

24. zero-state exposes supported platform onboarding.
25. create/update/default/pause/resume/connect/reconnect/sync/logout/remove lifecycle as supported by existing backend.
26. WhatsApp auth challenge/QR path.
27. Telegram QR path.
28. Telegram phone/code/password/cancel path.
29. Facebook Page OAuth continuation.
30. Facebook personal-identity kind where supported.
31. Facebook personal Messenger continuation.
32. safe-mode/offline/pending-auth failure states are visible and no duplicate auth attempt occurs.
33. secrets transient IPC only; no renderer persistence/logging.
34. IPC manifest <-> preload <-> main bridge exact alignment.
35. only `/api/r32/accounts` authority; no `/api/accounts` bypass.

### Settings / safety

36. appearance/sound/motion user settings persist.
37. close-to-tray / auto-connect / notification toggles project existing real settings only.
38. backup/verify/stage restore remains reachable.
39. portable backup lifecycle remains reachable.
40. update UI never uses legacy DOM dirty-state detector and never reports a false safe-to-install state.
41. engineering Model Brain/Ollama/runtime/Learning-governance screens are not reachable on ordinary Product path.

### Visual / Windows

42. avatar spatial transition present when motion is enabled and absent under reduced motion.
43. living/breathing feedback does not imply online status and is disabled under reduced motion.
44. 1180x720, 100%, 125%, 150% Windows scaling: no clipped login/People/world/accounts/settings/tool controls.
45. native drag/min/max/close GREEN.
46. existing session restart -> Product primary and selected/durable authorities intact.
47. `git diff --check` GREEN.
48. affected Element module build/types/focused tests GREEN using existing local cache/toolchain.

Only after all affected local acceptance is GREEN may the causal batch create one new Exact Head.

## 12. CI / merge / RC / UAT conditions

- One causal batch -> one new Exact Head.
- One new Exact Head -> one CI validation.
- Same exact head must never rerun a consumed validation.
- CI is validator, not debugger.
- GREEN candidate -> ordinary merge immediately once merge conditions are satisfied.
- One merged production candidate -> one RC.
- RC only after Windows Local Release Harness proves affected real user paths.
- One real Windows UAT is final proof, not debugging.
- A UAT-discovered class must be added to local harness/regression before any successor RC.

## 13. Reconciliation protocol — mandatory on every future continuation

Before any Product Final mutation, the Controller must read and compare:

1. live `main` SHA;
2. live V10 frozen branch/head;
3. this checkpoint;
4. current Product Final successor branch/PR if one exists;
5. consumed workflow runs and conclusions;
6. active PR/path overlap for the exact successor scope;
7. exact diff/path census of the candidate under review.

If any identity differs from this checkpoint:

- do not guess;
- do not ask WorkBuddy to re-investigate GitHub evidence already available;
- do not rerun frozen CI;
- reconcile live refs/evidence first;
- preserve frozen RED/GREEN identities;
- only then update this checkpoint or create the next successor checkpoint.

No implementation action is allowed merely because a prior chat said it was next. GitHub exact identity + this causal ledger must agree first.

## 14. Current next allowed action

After this checkpoint is committed, next work is **successor-v11 local batch causal closure**, not CI/RC/UAT.

Before implementation begins, perform one narrow preflight only:

- confirm the new Element read-only room-enumeration/full-screen module seam is still necessary at the live successor base;
- confirm no newer trusted main authority already provides the same seam;
- confirm active PR overlap on the exact Product paths.

Then complete the entire causal batch locally before producing the single successor Exact Head.
