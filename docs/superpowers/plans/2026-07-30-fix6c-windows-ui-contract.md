# Yance Batch40 FIX6C Windows UI Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Repair all screenshot-confirmed Windows UI contract defects in shared frontend components while preserving FIX6B production behavior and security gates.

**Architecture:** Add source-level regression contracts first, then update the shared conversation, account-center, system-center, and display-settings presentation layers. Keep all business logic unchanged and bind the resulting tree to a new FIX6C Windows UI UAT candidate.

**Tech Stack:** Electron renderer HTML, vanilla JavaScript, CSS Grid/Flexbox, Node.js `node:test`.

## Global Constraints

- Do not weaken local API authentication or evidence gates.
- Do not modify platform adapters, AI routing, persistence, or backend business logic.
- Fix shared components, not individual screenshot dimensions with one-off margins.
- Preserve stylesheet order: layout before `r32-theme-authority.css`, which remains the last external application stylesheet.
- Maintain accessible names and keyboard focus behavior for every icon-only control.

---

### Task 1: Add FIX6C UI regression contracts

**Files:**
- Modify: `tests/uat/round11ConversationCenterUi.test.js`
- Modify: `tests/desktop-fixes/machine-uat-closure.test.js`
- Modify: `backend/tests/f25WindowsUatRepairBatch15.test.js`

**Interfaces:**
- Consumes: production HTML/CSS/renderer source.
- Produces: failing source contracts for all screenshot-confirmed defects.

- [x] Add assertions that the composer has an empty disabled placeholder, icon-only tool content, stable translation semantics, and equal display action sizing.
- [x] Add assertions that AI-hidden layouts use `minmax(0,1fr)`, the header has a wrap breakpoint, compact navigation does not absolutely overlap the brand, and quick-tune controls wrap or expose a complete scroll contract.
- [x] Add Batch15 assertions that account-center narrow rules override late desktop rules and system toggles are bounded row cards.
- [x] Run the three test files and verify failures correspond to FIX6B defects.

### Task 2: Repair conversation shell and composer contracts

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/r32-conversation-center-v3.css`

**Interfaces:**
- Consumes: existing IDs and event listeners.
- Produces: responsive header/reflow and accessible icon composer controls without changing event IDs.

- [x] Replace the redundant disabled textarea placeholder with an empty string while preserving the live status text.
- [x] Replace composer tool text nodes with inline SVG icons and keep existing IDs, titles, and `aria-label` values.
- [x] Replace unstable translation glyph text with deterministic language/status markup.
- [x] Change all shell grid variants to `minmax(0,1fr)` and add a header wrap breakpoint before overlap.
- [x] Move the compact navigation toggle into a non-overlapping layout slot.
- [x] Make quick-tune actions wrap and remain fully reachable.
- [x] Run Task 1 tests and the existing conversation UI tests.

### Task 3: Repair account-center and system-setting shared layouts

**Files:**
- Modify: `frontend/r32-account-center.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/r32-system-center.css`

**Interfaces:**
- Consumes: existing account/system markup.
- Produces: one-column narrow account center and bounded label-control setting rows.

- [x] Ensure late production layout rules include narrow overrides with equal or greater specificity.
- [x] Allow account filters and hero content to wrap, and prevent horizontal clipping.
- [x] Restyle `.sc32-toggle-row` as a bounded card row with its switch inside the same visual unit.
- [x] Add narrow and large-text behavior that preserves label-control association.
- [x] Run Task 1 tests and existing machine/theme contracts.

### Task 4: Normalize display-settings peer actions

**Files:**
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: existing `resetDisplaySettings` and `runDiagnostics` handlers.
- Produces: equal-height/equal-width peer buttons with color-only hierarchy.

- [x] Apply a shared action class to both controls.
- [x] Normalize height, padding, line-height, and align-self in the embedded style block.
- [x] Run Task 1 tests.

### Task 5: Preserve authenticated evidence collection semantics

**Files:**
- Modify: `tools/runtime-delivery/templates/COLLECT_YANCE_ROUND11_UI_EVIDENCE.ps1.template`
- Modify: `tools/runtime-delivery/templates/YANCE_ROUND11_UAT_README_ZH.md.template`
- Modify: `tests/runtime-delivery/round11-windows-ui-uat-package.test.js`
- Modify: `tools/runtime-delivery/run-round11-prelaunch-gates.js`

**Interfaces:**
- Consumes: authenticated Electron runtime evidence endpoint and prelaunch gate logs.
- Produces: an honest evidence ZIP even when standalone runtime export is denied, without weakening authentication.

- [x] Preserve the HTTP 401 fail-closed behavior and do not expose or persist the Electron session token.
- [x] Record `RUNTIME_EXPORT_STATUS.json` and raw export output when the authenticated runtime export is unavailable.
- [x] Include prelaunch gate logs in the evidence ZIP and continue to prohibit automatic desktop screenshots.
- [x] Add regression coverage for the partial-evidence package contract.

### Task 6: Full verification and FIX6C delivery

**Files:**
- Create: `YANCE_BATCH40_FIX6C_WINDOWS_UI_REPAIR_REPORT_ZH.md`
- Update/create: Windows UI UAT packaging output outside the repository.

**Interfaces:**
- Consumes: final clean Git tree.
- Produces: source candidate ZIP, one-click Windows UI UAT ZIP, hashes, and audit report.

- [x] Run syntax checks and `git diff --check`.
- [x] Run Batch14 3/3, theme/layout 43/43, Batch40 focused, FIX6C focused UI tests, and full `backend/run_all_tests.js`.
- [x] Verify exact TAP counts and zero failures.
- [ ] Commit the final tree and record commit/tree IDs.
- [ ] Generate and independently hash source and Windows UI UAT ZIPs.
- [x] Keep `readyForPromotion=false` and `formalRelease=false` until Windows screenshot re-verification passes.
