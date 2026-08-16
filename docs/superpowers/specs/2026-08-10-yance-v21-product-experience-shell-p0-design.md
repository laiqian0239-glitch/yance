# Yance V2.1 Product Experience Shell P0 — Living Relationship OS Design

- Date: 2026-08-10
- Work package: `V21-PRODUCT-EXPERIENCE-SHELL-P0`
- Status: product direction approved by owner; **design / OSS-fit only in this document**
- Trusted design base at creation: `main@0164d22982dbdbc471135e43948c9890bb71b0e8`
- Implementation authorization: **not granted by this document**
- Product positioning: personal, open-source, relationship-first AI communication assistant; not CRM / marketing / sales software

## 0. Decision

Yance will not finish as a flat capability dashboard such as:

```text
AI | Goal | Contact | Presence | Media | Voice | Learning
```

The target product experience is a **Living Relationship OS**:

```text
People
  -> Person / Relationship World
       -> Conversation
       -> Shared Moments
       -> Voice / Photo / Live
       -> invisible AI Relationship Layer
```

The first-class product object is the **person / relationship**, not a backend capability.

The UI must feel alive and game-responsive without looking like a game HUD. The target is:

> Signal-level private-chat calm + Discord/console-quality interaction feedback + Nintendo-like delight + Apple-like polish + Yance relationship intelligence.

Game feel means spatial continuity, low-latency feedback, spring motion, stateful visual life, restrained sound, presence and depth. It does **not** mean XP, streak manipulation, affection scores, leaderboards or relationship levels.

## 1. Non-regression boundary

This is a forward Product Shell refactor. It must not rebuild or replace mature runtime authorities already adopted by Yance.

Existing authorities remain:

- Matrix / Element: messaging, rooms, timeline, media event and desktop communication skeleton;
- Letta: persistent agent / memory state;
- Graphiti: temporal relationship facts;
- Parlant: Relationship Goal / Journey;
- Model Brain / LiteLLM: model execution and routing;
- Learning Brain: evidence / optimization / evaluation / rollout through its approved OSS stack;
- Immich + ComfyUI: media library and image workflow authority;
- SenseVoice + CosyVoice: Voice Brain authority;
- LiveKit + CyberVerse / avatar backend: realtime presence and avatar authority.

The new shell consumes their existing projections and IPC/API contracts. It may not create a second messaging runtime, relationship graph, goal engine, media store, voice engine, realtime stack, AI agent runtime, learning framework or send authority.

## 2. Current repository boundary

At design creation:

- trusted `main`: `0164d22982dbdbc471135e43948c9890bb71b0e8`;
- Media implementation PR #197 is merged;
- Presence implementation PR #214 is merged;
- Voice implementation PR #211 remains open Draft at `0ef46efd62f195049640a96ba6e5fe2a1f6a6e6e`;
- Learning implementation PR #223 remains open Draft at `0b48b4dbd04693d21ef3f6545cbd330c6b519289`;
- `integration/element-module/src/YanceWorkspace.tsx` is a shared composition root used by Voice / Learning;
- `integration/element-module/package.json` is a dependency-control root currently modified by Learning #223.

Therefore Product Experience implementation must **not** begin by editing either shared root or by installing the new Product Experience dependencies into the shared manifest. Before any dependency-control write, fresh-read Learning #223. Before any shared composition-root write, fresh-read both Voice #211 and Learning #223. The implementation successor must be created from then-fresh `main` and exact overlap must be reconstructed.

New isolated shell/design-system files should be preferred first; dependency installation and final cutover into `YanceWorkspace.tsx` are late integration steps.

## 3. Historical UI work

PRs #50, #65, #85 and #92 and the Chatwoot-era Product Shell plans are historical design / governance evidence only. They must not become implementation parents for this work package.

Useful durable behaviors such as translation safety, immutable send freeze, unified cross-platform conversation semantics and identity boundaries may be preserved, but the flat split-pane / dock-first visual model is superseded by this relationship-first design.

No checkout / rebase / resurrection of those old branches is permitted.

## 4. Product architecture

```text
YanceAppShell
  |
  +-- PeopleSurface
  |     +-- Living people cards / adaptive orbit
  |     +-- recent / favorites / unread
  |     +-- search and keyboard navigation
  |
  +-- RelationshipWorld
  |     +-- RelationshipHeader
  |     +-- ConversationSurface
  |     +-- SharedMomentsStrip
  |     +-- RelationshipAtmosphere
  |     +-- ActionDock
  |
  +-- RelationshipAssistant
  |     +-- current intention / goal
  |     +-- useful memory
  |     +-- relationship context
  |     +-- suggested next move / reply
  |     +-- Learning evidence / coach projections
  |
  +-- OverlayHost
        +-- media
        +-- voice
        +-- live / avatar
        +-- contact detail
        +-- AI expanded layer
```

No component above owns the underlying domain state. Each consumes a bounded projection and emits product intent through existing authorities.

## 5. People Surface

### 5.1 Desktop default

Wide desktop uses a **Living People** layout: recognizable people are visually primary, with light spatial/orbit composition rather than a dense enterprise sidebar.

A person node can display only concise relationship-presence facts:

- avatar;
- display name;
- online / recent state;
- unread / recent-moment indication;
- relationship-theme ring.

The layout must retain fast search, keyboard navigation and a deterministic fallback list. Visual novelty may never make finding a person slower or inaccessible.

### 5.2 Responsive fallback

- wide window: spatial living cards / orbit composition;
- standard window: living card list/grid;
- narrow window or reduced-motion mode: straightforward accessible list.

The Orbit is not an independent game engine and does not require Canvas / Pixi / Three.js in P0. It must be achievable with normal React DOM + Motion. A later Canvas engine requires a new OSS-fit only if measured performance proves DOM insufficient.

## 6. Relationship World

Opening a person means entering that person's relationship space, not navigating to a generic feature page.

Example:

```text
Lena
Berlin · online

[ conversation timeline ]

+  message composer  voice  photo  live

Shared moments
```

Relationship data is projected around the person:

- current conversation and platform identity;
- shared photos / moments;
- voice and live actions;
- relationship-specific visual atmosphere;
- optional hidden AI companion entry.

Different people may have different restrained color / atmosphere tokens derived from approved theme inputs. No unreadable photo wallpaper, high-contrast visual noise or automatic public inference of sensitive relationship state is allowed.

### 6.1 Visual language — approved direction D

The visual direction is a fusion of warm intimacy, premium night-time atmosphere and restrained future/game feel, with **premium calm overriding spectacle**.

Rules:

- deep warm-neutral / graphite surfaces are the baseline; relationship accents may use amber, rose, violet, blue or green families through semantic theme tokens;
- at most three clear visual depth levels are visible in the normal conversation view;
- translucency / blur is selective material, not the default background of every component;
- no neon-outline-everything, permanent particles, rainbow gradients or cyberpunk HUD vocabulary;
- photos may influence atmosphere color, but never reduce text contrast or become unreadable wallpaper behind active message text;
- primary actions use clear human labels when ambiguity exists; icon-only actions are reserved for universally understood actions and must expose accessible labels/tooltips;
- ordinary desktop interactive targets should be at least 40x40 CSS px where layout permits; compact exceptions must preserve keyboard and accessibility behavior;
- destructive actions are never visually adjacent to high-frequency send / voice controls without separation;
- normal conversation copy uses relationship language such as `People`, `Moments`, `Voice`, `Live`, `For Lena`, `Tonight`; internal engine names are hidden from normal users.

## 7. Conversation Surface

Signal Desktop is the principal private-chat UX benchmark. Cinny remains a minimalism benchmark. Telegram may be used as a high-detail interaction benchmark only.

The Yance conversation surface must prioritize:

- message density and readability;
- stable timeline / scroll anchoring;
- long messages;
- replies / reactions;
- attachments / photo / voice;
- clear sending / failed / offline states;
- keyboard-first desktop operation;
- composer focus stability;
- zero AI obstruction during ordinary conversation.

Element / Matrix remains the messaging runtime. Signal / Cinny / Telegram are UX evidence, not runtime authority.

## 8. AI Relationship Layer

AI is **not** a top-level navigation destination.

Default state: hidden / ambient.

Entry: a small `AI companion` affordance associated with the current relationship.

Expanded content is user-facing relationship language, not internal stack language:

```text
For Lena

Tonight
- reconnect naturally
- understand her weekend plan

What matters now
- recent relevant memory
- current conversational context

Suggested next move
- one concise recommendation

Suggested reply
- optional candidate
```

Do not expose technical names such as Letta, Graphiti, Langfuse, DSPy, LiteLLM or Promptfoo in the normal relationship UI.

The AI layer must not silently send messages, alter relationship facts, promote AI inference to confirmed fact or mutate goals without existing approval authorities.

## 9. Game-feel interaction contract

The target interaction pattern is **visual + motion + sparse sound**.

### 9.1 Person hover / open

Hover:
- subtle 1–3 px magnetic response or equivalent light depth response;
- ring / shadow wake;
- no default sound.

Press:
- approximately 0.96–0.98 scale response;
- immediate visual acknowledgement.

Open:
- avatar visually continues from People Surface into Relationship Header;
- spring / shared-layout transition;
- surrounding content fades / moves with controlled depth;
- optional quiet transition sound only in Immersive sound mode.

### 9.2 Composer action dock

`+` expands photo / voice / live / attachment actions around or above the composer rather than navigating away.

The expansion must preserve input focus and timeline position.

### 9.3 Image preview bloom

A selected thumbnail grows from its origin into preview and collapses back to the same origin. No teleporting modal effect where spatial continuity can be preserved.

### 9.4 AI companion states

The companion visual has explicit states:

```text
idle -> wake -> listening -> thinking -> ready -> speaking/error
```

`thinking` never uses a looping sound. `wake` and `ready` may use a short quiet sound in Immersive mode.

### 9.5 Send / voice / live

- send: subtle bubble motion and restrained tick;
- voice recording: live ring / waveform response, no unnecessary continuous UI sound;
- live / avatar activation: one short activation state transition;
- notification / new message: relationship avatar ring may wake once; sound follows user notification policy.

## 10. Sound identity

Sound is a product material, not decoration.

Modes:

```text
Off
Essential only
Immersive
```

Rules:

- most hover and navigation actions are silent;
- sound is reserved for meaningful state transitions;
- no coin / level-up / laser / arcade vocabulary;
- no continuous AI-thinking loop;
- target sound character: warm, airy, restrained electronic, subtle glass / soft pluck;
- notification, send and UI micro-sounds must respect global user preferences and OS-level accessibility expectations;
- no unverified historical sound assets may be redistributed.

Initial shipping sounds must be either Yance-owned original assets or assets with explicit distributable rights and source receipts.

## 11. Accessibility and reduced motion

The visual system must support:

- `prefers-reduced-motion`;
- complete keyboard operation;
- visible focus states;
- screen-reader compatible primitives;
- no hover-only functionality;
- no color-only semantic states;
- user-controlled Sound / Motion / Relationship atmosphere settings.

Reduced-motion mode keeps state clarity while removing spatial travel, magnetic hover and nonessential ambient animation.

## 12. P0 OSS-fit

### 12.1 Headless UI primitive authority — Base UI

**Selected P0 candidate:** `mui/base-ui`

- release: `v1.7.0`
- release commit: `254f4744f0a241c20697b9eeab33402f4469a081`
- license: MIT
- role: accessible unstyled interaction primitives only
- expected components: Dialog, Drawer, Popover, Menu, Tooltip, ScrollArea, Tabs, Toast, Avatar, Button and related focus / portal / dismissal mechanics
- React compatibility: current Base UI supports React 17+; Yance Element module requires React >=18

Why selected over rebuilding: Base UI owns the difficult focus, pointer, keyboard, portal, popup, drawer and accessibility edge cases. Yance keeps CSS / tokens / composition.

Alternatives reviewed:

- React Aria Components: very strong accessibility and internationalization; remains the first fallback benchmark if a concrete Base UI contract fails;
- Radix Primitives: mature and proven, but do not introduce a second primitive runtime once Base UI is selected;
- shadcn/ui: source / visual composition reference only, not the primitive authority.

### 12.2 Motion authority — Motion

**Selected:** `motiondivision/motion`

- release: `v12.42.2`
- release commit: `40e8756c63b258c9dd07de9501cb788410eefb02`
- license: MIT
- role: React layout transitions, shared-layout movement, spring response, gestures and enter/exit animation

Yance must not create `YanceAnimationEngine`, a custom spring engine or a parallel layout-transition framework.

### 12.3 Stateful living visual authority — Rive runtime

**Selected:** `rive-app/rive-wasm`

- release: `2.39.2`
- release commit: `68dbf3a775df37fc4a6f128fb685eb9ed4bf149b`
- runtime license: MIT
- React integration: official Rive React runtime
- role: a small number of state-machine-driven Yance visual assets such as AI companion orb, presence wake/ring and selected high-value micro-interactions

Rive is not a replacement app framework. `.riv` assets contain Yance visual identity; the runtime remains upstream authority.

### 12.4 UI sound playback authority — Howler.js

**Selected P0 candidate:** `goldfire/howler.js`

- release: `v2.2.4`
- commit: `003b917c40cb41cf382ba47ae0ed7a35ca2abe76`
- license: MIT
- role: short UI sound playback, grouping, volume and global mute policy

Howler is intentionally limited to UI sound playback. It may not own Voice Brain recording, TTS, media streaming or realtime audio.

### 12.5 UX benchmark sources — no runtime authority

- Signal Desktop: primary private conversation UX;
- Stoat/Revolt frontend: friends / social-shell information architecture;
- Cinny: minimalism / spacing / reduced clutter;
- Discord: presence, overlay and game-quality interaction feedback;
- Snapchat / Locket: small-circle, lightweight intimate social communication patterns;
- Hinge / Bumble: person-first conversation prompts and relationship entry points;
- Steam / PlayStation / Nintendo: presence and game-feel benchmark;
- Apple platform UI: motion restraint, material and focus benchmark.

No benchmark source may silently become a second messaging, state, navigation or account authority.

## 13. Yance-owned code admission

Allowed Yance-owned product composition:

```text
YanceAppShell
PeopleSurface
RelationshipWorld
RelationshipHeader
ConversationSurface adapter/composition
RelationshipAssistant
ActionDock
OverlayHost
RelationshipTheme tokens/projection
ExperienceSettings projection
```

Allowed assets:

- Yance design tokens;
- Yance-owned icons / brand assets;
- licensed or Yance-owned sound assets;
- Yance-owned `.riv` animation assets.

Forbidden new infrastructure:

```text
YanceComponentFramework
YanceAnimationEngine
YanceGameUIRuntime
YanceSoundEngine
YanceConversationEngine
YanceOverlayFramework
YanceSocialGraphEngine
YancePresenceEngine
```

If a later requirement appears to need one of those, a new V2.1 OSS-fit is mandatory first.

## 14. Design system contract

Before feature surfaces, freeze semantic tokens for:

- color / surface / text / accent / destructive / success;
- relationship atmosphere;
- typography scale;
- spacing;
- radius;
- elevation / shadow;
- blur / translucency;
- focus ring;
- presence ring;
- message bubble;
- motion duration / spring families;
- sound category / volume family;
- z-layer / overlay depth.

Components may not invent arbitrary per-component durations, radii, shadows or audio volume values outside the token system except through an explicitly reviewed local exception.

## 15. Experience acceptance gates

A functional GREEN is insufficient. Product Experience P0 must add measurable acceptance evidence.

Required contracts include:

- enter a recent relationship in one principal action;
- normal typing never opens or focuses AI automatically;
- photo / voice / send are reachable in one interaction layer;
- AI / Goal / Memory remain within two interaction layers;
- opening and closing an overlay preserves conversation selection, timeline scroll and composer draft;
- shared-layout avatar transition does not remount the relationship identity projection;
- no animation blocks keyboard input;
- no timeline layout jump from late image sizing;
- reduced-motion path is complete and usable;
- sound Off emits no UI playback;
- Essential-only excludes decorative navigation sounds;
- no shipping asset lacks license / provenance evidence;
- no Product Shell component directly calls model providers or mature OSS internal/private state.

Performance targets are acceptance goals to be verified on the real Electron product, not claimed from unit tests alone:

- interaction response should be visually acknowledged within one frame where possible;
- normal animation targets 60fps on the supported Windows baseline;
- timeline scrolling and composer typing must remain responsive while nonessential animation is active;
- ambient Rive animation must settle / pause when not visible where supported.

## 16. Failure-first implementation shape

The future executable authorization should freeze a focused P0 scope and the first implementation commit must be tests / interaction contracts only.

Expected first RED families:

1. current capability navbar still exists instead of relationship-first shell;
2. People Surface / Relationship World contracts are absent;
3. AI remains a capability page instead of current-relationship overlay;
4. Base UI / Motion / Rive / sound identities are not installed / pinned;
5. reduced-motion and sound-mode contracts are absent;
6. spatial continuity / focus / scroll preservation tests are absent or fail;
7. legacy flat Product Shell presentation remains active.

Product code follows only after causal RED is proven.

## 17. Sequencing with Voice and Learning

This Product Experience workline may continue immediately through:

- design;
- OSS-fit;
- exact dependency proposal;
- interaction contracts;
- future path scope derivation;
- overlap calculation;
- authorization preparation.

It must not perform shared-root product implementation until fresh Voice #211 and Learning #223 state is re-read and the exact authorized Product Experience scope accounts for their final shared-root contents.

Preferred implementation sequence:

```text
new isolated design-system / shell files
  -> People Surface
  -> Relationship World
  -> AI overlay
  -> Action Dock / Media / Voice / Live projections
  -> Motion / Rive / sound polish
  -> late shared-root cutover
  -> full UAT / experience gates
```

No rebase / amend / force / squash. Reconciliation uses ordinary forward history only.

## 18. P0 completion definition

P0 is complete only when the real Electron Yance product demonstrates:

- relationship-first opening experience;
- comfortable private conversation;
- working Media / Voice / Presence entry through the current relationship;
- hidden-by-default AI relationship companion;
- polished spatial motion and restrained sound;
- reduced-motion / sound controls;
- no old top-level capability dashboard as the normal product path;
- no duplicate underlying domain authority;
- exact dependency / license / SBOM evidence;
- failure-first tests and product interaction tests GREEN;
- applicable Stage / Layered / ACV2 / Windows / PVEP gates GREEN;
- independent exact-Head review P0=0 / P1=0;
- real visual / interaction UAT accepted before final source merge.

## 19. Explicit non-goals for P0

- no Unity / Unreal / Phaser / Pixi / Three.js runtime;
- no 3D social world;
- no relationship XP / streak / affection score;
- no background music per person;
- no autonomous sending;
- no replacement Matrix timeline database;
- no migration of Voice / Media / Presence internal runtimes;
- no resurrection of Chatwoot as a second Product Shell;
- no unlicensed imported sound distribution;
- no production release / publish / promotion.

## 20. Next governance step

After owner review of this written spec:

1. write an implementation plan from then-fresh repository state;
2. derive exact candidate paths and dependency-control paths;
3. compute exact path-set digests;
4. re-read live `main`, Voice #211 and Learning #223;
5. create a separate Product Experience authorization proposal;
6. ordinary-merge authorization only after permanent gates and independent review;
7. create implementation branch from that exact authorization merge;
8. first implementation commit is failure-first tests only.

This design document never grants wildcard path authority and never authorizes implementation by itself.
