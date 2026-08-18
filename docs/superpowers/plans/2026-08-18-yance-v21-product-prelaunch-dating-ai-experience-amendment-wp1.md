# Yance V2.1 Product Prelaunch Dating AI Experience Amendment — WP-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the pre-launch Chinese-first, global 85%–150% typography, and global theme experience contract across the actual Element-hosted Yance Product surfaces without creating a second theme/typography authority.

**Architecture:** Keep `backend/store/themeAppearancePolicy.js` plus the existing Store UI state as the sole durable appearance/typography authority; extend its current `fontScale` contract from 90–120 to 85–150, expose the already-existing `PUT /api/r32/store/ui/theme/preferences` write through the existing Electron Store bridge, and project that state into the Element-hosted Product module. Shipping Product/Media/Voice/Presence/Learning/search/overlay CSS must consume the repository’s existing semantic typography/theme contract rather than private palettes or hard-coded type sizes. Extend the existing FIX6D typography and theme audits to scan `integration/element-module` instead of inventing a second auditor. User-facing copy becomes Chinese-first and capability-oriented while foreign chat originals and low-level diagnostic codes remain intact.

**Tech Stack:** Node.js 22, Electron IPC/preload bridge, React/TypeScript, CSS custom properties, Element Web module API v1.12.25, Yance Store appearance authority, Node test runner, existing FIX6D typography/theme audits, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-18-yance-v21-product-prelaunch-dating-ai-experience-amendment-design.md` at approved design commit `747edcaae0c6a64ea4ef0ef98d73a02449666f37`.

## Global Constraints

- Implementation authorization is prospective only: fresh-read trusted `main`, create one governance-only authorization PR, ordinary two-parent merge it, and start implementation only from that authorization merge commit.
- No retroactive self-authorization, no history rewrite, no force push, no squash/rebase, no gate/scanner weakening, no baseline inflation.
- First implementation commit is failure-first tests only and must prove causal REDs before production code changes.
- Reuse the existing Store appearance state, `themeAppearancePolicy`, `UPDATE_THEME_PREFERENCES`, existing theme catalog/semantic theme authority, FIX6D typography authority, existing Electron Store bridge, and Element module delivery path.
- Do not add a Product-private theme registry, Product-private typography registry, second persistence path, second CSS override authority, or new general-purpose Yance infrastructure.
- New dependency/package/workflow changes are not part of WP-1 unless a fresh causal RED proves the approved design cannot be implemented through existing authorities and a new prospective authorization is merged first.
- Global font scale is exactly 85%–150%, default 100%, integer 1% steps. Invalid values normalize at the existing authority layer; components do not clamp independently.
- Product Shell, Media, Voice, Presence, Learning, bilingual search/translation surfaces, dialogs/overlays, settings and Element-hosted Yance entry points must all respond to the same effective typography/theme state.
- Normal user UI is Chinese-first and must not expose implementation names such as Letta, Langfuse, DSPy, GEPA, Promptfoo, OpenFeature, flagd, Immich, ComfyUI, CyberVerse, SoulX, SenseVoice, CosyVoice, LiteLLM or internal authority names. Technical codes may remain secondary diagnostics after a Chinese explanation.
- Foreign-language conversation text remains the actual original/sent text. Chinese understanding is a separate projection and must never overwrite the authoritative message body.
- Preserve #478 canonical active-room route binding and all send/media/runtime authorities unchanged.

---

### Task 1: Prospective WP-1 Authorization

**Files:**
- Create on governance branch: `governance/layered-ci/v21-product-prelaunch-dating-ai-experience-amendment-wp1-authorization.json`

**Interfaces:**
- `documentType = YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION`.
- `effectiveBeforeMerge = false`; implementation may start only from the exact ordinary authorization merge commit.
- Authorization branch changes exactly one governance file.
- Implementation allowed path set is exact and hash-bound after the final fresh source audit.

- [ ] Fresh-read GitHub `main`; require the expected trusted head and abandon/recreate the proposal if `main` moved before authorization merge.
- [ ] Re-read `themeAppearancePolicy`, Store UI commands/routes, Electron Store bridge/preload, Element Product surfaces, existing FIX6D typography/theme audits and Product validation tests from that exact main.
- [ ] Record OSS-fit as **REUSE_EXISTING_AUTHORITIES**: existing Store appearance authority + existing semantic theme/typography contracts + pinned Element module path; no new general-purpose infrastructure and no new dependency.
- [ ] Freeze the exact implementation path list, test-only failure-first path list, path-set SHA-256 digests, negative boundaries and required validation commands.
- [ ] Open the governance-only PR, collect same-head governance/architecture Actions, root-fix any real RED without changing the policy meaning, and ordinary-merge only when exact-head checks are GREEN.
- [ ] Record the resulting authorization merge commit as the only valid implementation parent.

### Task 2: Failure-First Product Experience Contracts

**Files:**
- Modify: `tests/uat/themeStudioExpansion.test.js`
- Modify: `tests/uat/fix6dGlobalTypographyAudit.test.js`
- Modify: `tests/wp0/v21-product-experience-shell-interaction.test.js`
- Modify: `tests/wp0/v21-element-workspace-contract.test.js`
- Modify: `tests/wp0/v21-media-brain-ui.test.js`
- Modify: `tests/wp0/v21-voice-brain-ui.test.js`
- Add/modify the existing Presence/Learning focused Product tests selected by fresh source audit; do not create a parallel generic gate when an existing focused test owns the surface.

**Interfaces:**
- Authority test requires `normalizeTypography({fontScale})` to preserve each integer from 85 through 150 and clamp only outside that range.
- Product bridge contract requires a renderer-callable existing Store theme-preferences write, not a new persistence authority.
- Product UI contract requires 85/100/150 settings, 1% step, global theme state consumption, Chinese-first user copy, and no normal-UI implementation-name leakage.
- Audit contract requires shipping `integration/element-module` CSS/TSX coverage.

- [ ] Add the exact tests only; do not modify production files in the first implementation commit.
- [ ] Assert current `fontScale=85` and `fontScale=150` fail against the old 90–120 authority.
- [ ] Assert the current Electron bridge lacks the theme-preferences write seam.
- [ ] Assert Product/Media/Voice/Presence/Learning shipping styles and copy violate the approved semantic typography/theme/Chinese-first contracts.
- [ ] Assert the current typography/theme audits do not cover the shipping Element module path and therefore cannot claim global closure.
- [ ] Assert the Element-hosted entry label and normal Product status/capability labels are Chinese-first and do not expose implementation vendors/frameworks.
- [ ] Push the test-only commit, open the implementation PR, and collect an exact-head causal RED. The RED must be attributable only to the approved WP-1 gaps before any production change.

### Task 3: Correct the Existing Durable Typography Authority and Bridge

**Files:**
- Modify: `backend/store/themeAppearancePolicy.js`
- Modify: `electron/r32StoreBridge.js`
- Modify: `electron/preload.js`
- Test: files from Task 2

**Interfaces:**
- `normalizeTypography().fontScale` clamps to `[85, 150]`, rounds to integer percent, default `100`.
- Existing `UPDATE_THEME_PREFERENCES` and Store persistence remain the only durable write authority.
- Existing backend route `PUT /api/r32/store/ui/theme/preferences` remains unchanged unless a test proves an actual route defect.
- Electron bridge adds one narrow channel/method that forwards the existing route; no new state store or IPC subsystem.

- [ ] Change only the authority-layer bounds from 90–120 to 85–150; do not add component clamps.
- [ ] Add the specific Store bridge channel/handler for the existing theme-preferences route and expose the matching preload method.
- [ ] Verify snapshot domain `ui` still returns the normalized persisted typography/theme state.
- [ ] Run focused authority/bridge tests and require GREEN before touching Product CSS/UI.
- [ ] Commit the authority/bridge correction separately.

### Task 4: Project Global Appearance into the Element-Hosted Product Surface

**Files:**
- Modify: `integration/element-module/src/product-experience/experienceProjection.ts`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify: `integration/element-module/src/YanceWorkspace.tsx` only if the projection must be threaded through the existing wrapper
- Modify: `integration/element-module/src/index.tsx` only for the existing Element entry seam/copy
- Modify: `tests/wp0/v21-product-experience-shell-interaction.test.js`
- Modify: `tests/wp0/v21-element-workspace-contract.test.js`

**Interfaces:**
- Product reads `ui` from the existing Store snapshot and writes typography through the new narrow bridge method.
- Product root exposes the effective global font scale/theme state to descendants through attributes/CSS custom properties that are projections of Store authority, not independent registries.
- Font control is `min=85`, `max=150`, `step=1`, default/effective value from Store.
- Theme controls consume existing Store/theme identity; they do not duplicate `frontend/theme-catalog.json` as a Product-owned catalog.
- Element entry/button text is Chinese-first.

- [ ] Add a typed Product appearance projection over existing `storeSnapshot({domains:["ui"]})` and the existing theme-preferences write seam.
- [ ] Load effective appearance at Product mount and refresh it after user changes; fail closed to safe visual inheritance if the desktop bridge is unavailable rather than inventing persisted state.
- [ ] Add the 85%–150% global font slider and user-readable effective percent to `体验设置`.
- [ ] Add/retain only theme controls that can be backed by existing Store/theme authority; if the current Product surface cannot enumerate legal themes from an existing authority, do not hard-code a second catalog—use the existing global theme control seam or a separately authorized minimal Element/store projection.
- [ ] Apply effective appearance at the Product root so every descendant workspace/overlay receives the same semantic variables.
- [ ] Replace `Yance Workspace` and other normal Element-hosted entry labels with Chinese-first copy.
- [ ] Run Product interaction/Element module contract tests and typecheck.
- [ ] Commit the Product appearance projection.

### Task 5: Migrate Shipping Product CSS to Existing Semantic Typography and Theme Contracts

**Files:**
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css`
- Modify: `integration/element-module/src/MediaWorkspace.css`
- Modify: `integration/element-module/src/VoiceWorkspace.css`
- Modify: `integration/element-module/src/PresenceWorkspace.css`
- Modify: `integration/element-module/src/LearningWorkspace.css`
- Modify only additional shipping Element-module CSS files discovered by the frozen Task 1 audit and explicitly authorized there.

**Interfaces:**
- Product CSS consumes the existing semantic role names (`--surface-*`, `--text-*`, `--accent-*`, `--status-*`, `--focus-ring`, `--type-*`) or an exact approved host mapping to those names.
- No Product-private palette authority such as independent `--yance-surface`, `--yance-muted`, `--yance-accent` definitions remains.
- No shipping component literal `font-size` escapes the semantic type-scale contract.
- Effective scale multiplies semantic type roles uniformly; 85/100/150 produce deterministic descendants without clipping critical controls.

- [ ] Remove Product-private palette definitions and map all surfaces/borders/text/status/focus use to existing semantic theme roles.
- [ ] Replace hard-coded Product/Media/Voice/Presence/Learning font sizes with existing semantic type roles; do not layer a late `!important` override.
- [ ] Preserve layout semantics and increase reflow/min-size only where 150% proves a genuine clipping issue.
- [ ] Verify overlays, forms, buttons, status text and content naturally reflow at 85/100/150.
- [ ] Run focused Product UI tests plus existing typography/theme audit tests.
- [ ] Commit the semantic CSS migration.

### Task 6: Chinese-First Product Copy and Internal-Name Hiding

**Files:**
- Modify: `integration/element-module/src/MediaWorkspace.tsx`
- Modify: `integration/element-module/src/VoiceWorkspace.tsx`
- Modify: `integration/element-module/src/PresenceWorkspace.tsx`
- Modify: `integration/element-module/src/LearningWorkspace.tsx`
- Modify: `integration/element-module/src/LearningToolUiAdapter.tsx` if normal-user labels originate there
- Modify: `integration/element-module/src/product-experience/experienceProjection.ts`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
- Modify only additional normal-user Product TSX discovered/frozen in Task 1.

**Interfaces:**
- Primary user-facing labels/status/errors/settings/empty states are Chinese.
- Implementation names and authority identifiers are absent from normal UI; capability wording replaces them.
- Raw `reasonCode`/technical code may appear only as secondary diagnostics after a Chinese explanation.
- Foreign chat originals and actual candidate send text are not translated/replaced by this task.

- [ ] Replace English surface labels, buttons, health/status strings, placeholders and accessibility labels with Chinese-first wording.
- [ ] Replace normal-user implementation/vendor strings with capability terms such as `媒体库`, `图片生成/编辑`, `实时陪伴`, `语音识别`, `语音生成`, `学习证据`, `优化`, `评估`, `灰度发布`, `学习助手`.
- [ ] Keep vendor/authority identifiers only in non-normal diagnostic/provenance structures when required for engineering evidence.
- [ ] Replace generic `Relationship`, `AI unavailable`, `Ready`, `Not ready` Product projections with Chinese product states without renaming underlying internal APIs.
- [ ] Preserve external language names where they are user-selectable language choices, but show Chinese names for the language options themselves.
- [ ] Run focused Media/Voice/Presence/Learning/Product tests and ensure no functionality/routing authority changed.
- [ ] Commit the Chinese-first copy projection.

### Task 7: Extend Existing Global Audits to the Shipping Element Module

**Files:**
- Modify: `tools/uat/fix6d-global-typography-audit.js`
- Modify: `tests/uat/fix6dGlobalTypographyAudit.test.js`
- Modify: `scripts/audit-theme-colors.js`
- Modify its existing focused test/report fixture only if required by current repository structure
- Modify: `governance/theme-color-debt-report.json` only as deterministic output of the existing audit when the repository contract requires the generated report to be committed

**Interfaces:**
- Existing typography audit scans both historical `frontend/` and shipping `integration/element-module` styles/scripts/TSX without creating a second typography authority.
- Existing theme color audit classifies the shipping Element module and rejects new private/fixed color sources outside existing palette authorities.
- Scanner semantics become stricter only to cover approved shipping scope; no exclusions are added merely to make WP-1 pass.

- [ ] Extend file walking/extensions to include the shipping Element module (`.css`, `.ts`, `.tsx`) while preserving the one typography authority definition.
- [ ] Make semantic token consumption legal in Product styles but reject token redefinition/private palette authorities there.
- [ ] Extend theme audit scope to `integration/element-module`; classify only genuine non-palette literals that are structurally unavoidable and explicitly justified by pre-existing semantic policy.
- [ ] Run the audits on the migrated Product module and require zero unapproved typography/theme violations.
- [ ] Run the historical frontend audit suite to prove no regression in the existing authority.
- [ ] Commit the audit-scope closure.

### Task 8: WP-1 Full Validation and Final Merge Boundary

**Files:**
- No production scope expansion.
- Update the implementation PR body/evidence only; do not change workflows or routing policy to obtain GREEN.

**Interfaces:**
- Exact implementation head must remain a descendant of the ordinary authorization merge and within the authorized path set.
- Final merge method is `merge` only, producing a two-parent ordinary merge commit.

- [ ] Fresh-read current PR head and compare changed paths against the frozen authorization path set/digest.
- [ ] Run/collect focused tests: typography authority, theme studio, Element workspace, Product interaction, Media, Voice, Presence/Learning focused tests, and static Chinese/internal-name contract.
- [ ] Collect `Stage 6.4.5.9 WP0 Architecture Gates` and every exact-head CI workflow triggered by the branch, including `V21 Product Experience Shell P0 Final Validation` when triggered.
- [ ] Collect Product final materialization/typecheck evidence for the exact head; distinguish source GREEN from any environment-specific Windows UAT that is not actually executed.
- [ ] Root-fix every real RED at the owning layer. Do not suppress, exclude, weaken, or baseline away failures.
- [ ] Verify negative proofs: no second theme/typography registry, no new dependency, no send/route/runtime authority change, no selected-relationship routing fallback, no internal OSS names in normal UI, no foreign-message overwrite.
- [ ] Verify the final PR is mergeable and all required checks are GREEN.
- [ ] **STOP at the final ordinary merge boundary.** Report exact head, authorization merge parent, tests/checks, remaining caveats if any, and the only permitted final action: ordinary two-parent `Create merge commit` (no squash/rebase).
