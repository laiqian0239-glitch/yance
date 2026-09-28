# Yance Compact Conversation Workspace & Window Navigation Design

**Date:** 2026-09-27
**Status:** owner-approved design, pending written-spec review gate
**Scope:** desktop window sizing, Home→Conversation entry, Conversation chrome/layout, right inspector density, Reply Brain default presentation.

## 1. Intent

Yance must open as a focused desktop application rather than a near-maximized dashboard. The default experience is optimized first for a 14-inch laptop used in a normal non-fullscreen window, while remaining visually calm on large desktop monitors.

Conversation is the primary work surface. Permanent chrome must not consume space needed by the contact list, real Element timeline, canonical composer, Reply Brain, or inspector.

The implementation must preserve mature runtime authority: Element remains room/timeline/composer/send authority; existing Persona, Relationship, Memory, Goal, model routing, media, voice, Live, translation, learning and human-typing capabilities remain intact.

## 2. Owner Decisions That Supersede Prior Review Text

This design explicitly supersedes `C-06` in `docs/design/yance-v4-final-2026-09-23/review/YANCE_V4_OWNER_ACCEPTANCE_RECONCILIATION_2026-09-26_ZH.md` **for the Conversation route only**.

The previous rule required the single Global Rail to remain visible in Conversation. The new owner decision is:

- Home / Relationship World / Settings may keep the single global navigation rail.
- Conversation hides that global rail entirely.
- Conversation must not create a second rail or shadow navigation system.
- A compact `返回首页` control in the Conversation toolbar is the only persistent global-navigation affordance inside the Conversation work surface.

All other non-regression requirements from the reconciliation document continue to apply



### 3.1 First-run/default window

- Default outer window: **1060 × 720 px**.
- Minimum outer window: **980 × 680 px**.
- Never launch maximized or fullscreen by default.
- Center the first-run window.
- The first-run size must not exceed **72% of the current work-area width** or **82% of the current work-area height**; if either limit is smaller than 1060×720, clamp the default to that work-area bound while never going below the supported minimum when the OS work area can accommodate it.

### 3.2 Subsequent launches

- Preserve the user's last normal window bounds and position when they have explicitly resized/moved the app.
- Do not overwrite a smaller user-selected normal window with the default 1060×720.
- A maximized session may restore maximized only if that state is already part of the existing trusted window-state persistence contract; this design does not add a new persistence subsystem.

### 3.3 Background and launch visual

- Electron window background remains the approved navy-black `#06111D` to avoid purple launch flashes.
- Conversation's formal navy/gold presentation remains independent of a persisted optional Theme Studio theme.

## 4. Home Navigation Contract

Home becomes the explicit launchpad for Conversation.

- Add a clear **“对话”** primary navigation action on Home.
- Keep the existing contextual **“继续 <联系人> 的对话”** action on the focused relationship card.
- The generic `对话` action opens the Conversation work surface using the most recently active/selected real conversation when one exists.
- If no real conversation can be resolved, open the existing empty Conversation state and ask the user to select a contact; do not fabricate a room, contact or message



Conversation is a focused work mode rather than another dashboard page.

### 5.1 Global rail

- Hide `.yance-desktop-rail` while the Conversation surface is active.
- Remove the rail's reserved left padding from Conversation; the reclaimed width belongs to the three-column work surface.
- Do not unmount or rewrite global navigation state; route exit restores the same global rail used by Home/Relationship World/Settings.

### 5.2 Conversation toolbar

Target toolbar height: **46 px**, hard range **44–48 px**.

Visible hierarchy:

1. `← 首页` / Home icon button.
2. Compact identity: `对话 · <当前联系人>` plus platform/status only when space permits.
3. Compact intelligence status.
4. Search / Settings / More as icon-sized secondary actions.

The toolbar must not repeat large brand treatment, marketing subtitle, avatar blocks, or duplicate controls already present elsewhere.

## 6. Three-Column Workspace

At the default 1060×720 outer window, the middle timeline is the priority.

- Contact list: **220 px** target, allowed **210–230 px**.
- Center conversation: `minmax(0, 1fr)`, target **≥ 560 px** at the supported default window when the right inspector is summarized.
- Right inspector summary: **210 px** target, allowed **200–220 px**.
- No horizontal page scrolling at supported minimum size.
### 6.1 Contact list density

- Keep a continuous high-density list; ordinary rows use weak boundaries and only the selected row receives warm-gold emphasis.
- Preserve real unread counts, platform labels, timestamps and avatars.
- Do not hide the list merely to make the center wider at the default window; collapsing remains an explicit user action.

### 6.2 Right inspector summary-first behavior

Default inspector presentation is a compact summary, not the full persistent information wall.

Summary shows only:

- current person identity;
- current relationship/status line;
- compact counts such as `记忆 2 · 目标 1` when real data exists;
- one `展开` action.

Expanded inspector may use **260–280 px** and exposes the existing AI / 人格 / 关系 / 记忆 / 目标 tabs and their complete current content. Collapse returns immediately to the 200–220 px summary width without losing tab state.

No relationship, memory, persona, goal or AI explanation data may be deleted to create the summary state.

## 7. Reply Brain and Composer Height Priority

The center timeline must recover vertical space by default.

### 7.1 Reply Brain default state

- Default state is **collapsed**.
- Collapsed bar height: **42 px**.
- It shows real candidate count from `candidates.length`, a one-line preview when candidates exist, and `展开` / `换一批` actions.
- `0` candidates shows `尚未生成` and the existing real generation action when available.
- Collapsed content must leave layout flow; `visibility:hidden` or transparent reserved height is forbidden.
### 7.2 Expanded Reply Brain

- Expanded workbench target height: **210–220 px**.
- In short supported windows, cap expanded height at **190–200 px** before stealing additional timeline height.
- Candidate bodies scroll inside their cards; the workbench itself does not grow with long AI text.
- Keep three real candidates, style controls, `为什么这样回`, learning feedback, `使用此回复`, and `发送并学习`.
- `使用此回复` writes the draft only and never auto-sends.
- `Esc` or `收起` returns to collapsed state without discarding current candidates.

### 7.3 Composer

- Canonical Element composer remains send authority.
- Input + send region target height: **50–54 px** in the default compact state.
- Media / image generation / voice / Live / translation / model / provider / routing tools move behind the existing compact `+`/tool affordance where possible, without deleting capability.
- Human-typing mode remains visible as current runtime state, not as a large permanent tool row.

## 8. State and Route Rules

- Conversation work-surface state has no shadow router; use the existing Product/Element route and session projection.
- Home `对话` and contextual `继续对话` must converge on the same existing Conversation activation path.
- Switching contacts clears or freezes candidate state according to the existing per-conversation policy; candidates must never leak across contacts.
- Reply Brain collapsed/expanded preference may be remembered across tray/minimize restore using existing UI state ownership; do not invent a second persistence store.
- Right inspector summary/expanded state is presentation state only; data ownership remains unchanged.
- Returning Home must restore the one global rail and Home chrome consistently



Conversation keeps the formal premium-calm authority already reconciled on 2026-09-27:

- app ink `#06111D`;
- panel navy around `#081A2A`;
- warm gold primary accent around `#D7AD4A`;
- gold indicates selected/current AI action/primary action rather than coating every card;
- persisted optional Theme Studio themes must not recolor the formal Conversation master back to violet.

The design is compact, not miniature: reduce permanent chrome and empty padding before reducing readable typography.

## 10. Non-Regression Boundaries

This change must not modify or replace:

- Element room, timeline, composer, send, crypto, membership, retry or recovery authority;
- Facebook/Telegram/WhatsApp real conversation identities or message history;
- reply generation backend, learning policy, Persona/Relationship/Memory/Goal stores;
- model/provider/routing authority;
- media, generated-image, voice, Live, translation or human-typing capability;
- existing unrelated dirty worktree bytes.

No fake data, shadow composer, second timeline, second global rail or overlay-only workaround is allowed.

## 11. Acceptance Matrix

### Window

- First-run/default BrowserWindow is 1060×720 and non-maximized.
- Minimum supported normal window is 980×680.
- 32-inch desktop: default window reads as a compact app window rather than near-fullscreen.
- 14-inch laptop: default window remains fully operable without requiring fullscreen.
### Conversation layout

- Conversation global rail is absent; Home/Relationship World/Settings still use the single global rail.
- Conversation toolbar is 44–48 px.
- At compact default width, contact list is 210–230 px, right summary is 200–220 px, and center gets the remaining width with no page-level horizontal scroll.
- Returning Home restores the global rail and Home chrome.

### Reply Brain / composer

- Initial Reply Brain state is 42 px collapsed.
- Expanded workbench never exceeds 220 px in normal height and 200 px in short supported height.
- Composer remains canonical Element composer.
- Candidate count always equals real `candidates.length`.
- `使用此回复` remains draft-only.

### Responsive visibility target

At 100% display scaling, using the default normal window:

- collapsed Reply Brain: timeline should expose roughly **5–6 ordinary text-message rows** when message content permits;
- expanded Reply Brain: roughly **3–4 ordinary text-message rows** should remain visible;
- at 125% display scaling, collapsed target is **4–5**, expanded target **≥3**;
- at 150% display scaling, collapsed target is **3–4**, expanded target **2–3**.

These are visual-density acceptance targets, not permission to fabricate messages or alter Element timeline semantics.

## 12. Implementation Boundary Map

Expected existing owners:

- `electron/main.js` — BrowserWindow default/minimum size and existing state restore policy.
- `integration/element-module/src/product-experience/ProductExperienceShell.tsx` — single global rail visibility, Home entry, Conversation toolbar/navigation, inspector presentation state.
- `integration/element-module/src/product-experience/PeopleSurface.tsx` — generic Home `对话` entry placement if the Home surface owns the visual action.
- `integration/element-module/src/product-experience/ProductConversationProjection.tsx` — Reply Brain collapsed/expanded presentation only; no backend rewrite.
- `integration/element-module/src/product-experience/ProductExperienceShell.css` — compact dimensions, responsive layout and formal Conversation visual authority.
- focused regression tests under `tests/wp0/` and `tests/desktop-fixes/`.

No new subsystem or route owner is introduced by this design.
