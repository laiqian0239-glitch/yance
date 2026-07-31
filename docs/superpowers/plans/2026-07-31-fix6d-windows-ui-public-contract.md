# FIX6D Windows UI Public Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Windows UI shell around one semantic theme authority, one workspace layout state machine, one shared density/control contract, and one route-authority-driven diagnostic probe so the screenshot-confirmed navigation, theme, layout, switch-row, notification, and diagnostic defects close without page-local overrides.

**Architecture:** Introduce a small public layout authority module that owns normalized shell state and publishes CSS custom properties/data attributes. Move theme-sensitive navigation and brand presentation to semantic tokens. Keep page workspaces consuming the same shell contract, and make diagnostics activate routes through `YanceWorkspaceRouteAuthority` before measuring. Regression tests assert behavior and source contracts before production edits.

**Tech Stack:** Electron 39, Node.js 22, browser JavaScript, CSS custom properties, Node built-in test runner.

## Global Constraints

- Do not modify Facebook, Telegram, WhatsApp, AI Provider routing, SQLite business transactions, or queues in FIX6D.
- Do not hide diagnostic failures, loosen gates, add page-tail `!important` patches, or use fixed-width screenshot-only workarounds.
- Brand, navigation, buttons, borders, and focus rings must derive from semantic theme tokens.
- Root shell columns must be computed from `navMode`, `contactMode`, `aiVisible`, `viewportBand`, and `density` only.
- Model/OpenRouter failures and recent-operation event semantics belong to FIX6M, not FIX6D.
- Existing Batch14 3/3, theme/layout 43/43, Batch40 focused 66/66, and all prelaunch tests must remain green.

---

### Task 1: Semantic Theme and Navigation Token Authority

**Files:**
- Modify: `frontend/r32-theme-authority.css`
- Modify: `frontend/r32-theme-semantic-contract.css`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/index.html`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`

**Interfaces:**
- Produces CSS variables `--ui-brand-accent`, `--ui-brand-accent-soft`, `--ui-nav-active-surface`, `--ui-nav-active-border`, `--ui-nav-icon-color`, `--ui-control-border`, `--ui-focus-ring`, `--ui-panel-surface-1`, `--ui-panel-surface-2`, `--ui-panel-surface-3`, `--ui-text-primary`, `--ui-text-secondary`, and `--ui-text-muted`.
- Existing components consume the variables through `var(...)`; no component writes a fixed cyan/gold active color.

- [ ] **Step 1: Write failing semantic-token tests**

Add tests that load the CSS/HTML source and assert all required variables exist, the navigation active state references `--ui-nav-*`, the brand image uses a theme-aware mask/currentColor wrapper, and component active-state rules do not reference `var(--cyan)`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js
```

Expected: FAIL because the FIX6D variables and brand presentation contract do not exist.

- [ ] **Step 3: Implement semantic variables and brand rendering**

Define the semantic variables in the theme authority, map them to existing theme tokens, replace navigation active/brand rules to consume them, and change the brand mark to a CSS-mask element using `currentColor`/`--ui-brand-accent` while preserving the accessible label.

- [ ] **Step 4: Run the focused test and theme audit**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js
node scripts/audit-theme-colors.js
```

Expected: PASS, with no hard-coded new theme color findings.

- [ ] **Step 5: Commit**

```bash
git add frontend/r32-theme-authority.css frontend/r32-theme-semantic-contract.css frontend/r32-conversation-center-v2.css frontend/index.html tests/uat/fix6dWindowsUiPublicContract.test.js
git commit -m "Refactor FIX6D semantic theme and navigation tokens"
```

### Task 2: Shell Layout State Machine

**Files:**
- Create: `frontend/js/r32-workspace-layout-authority.js`
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: `frontend/js/r32-workspace-route-authority.js`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/index.html`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`

**Interfaces:**
- Produces `YanceWorkspaceLayoutAuthority.normalizeState(input, viewportWidth)` and `YanceWorkspaceLayoutAuthority.apply(app, state, viewportWidth)`.
- `apply` writes `data-nav-mode`, `data-contact-mode`, `data-ai-visible`, `data-viewport-band`, `data-density`, and shell column custom properties.
- `YanceWorkspaceRouteAuthority.applyRoute` preserves layout data attributes and does not clear shell layout state.

- [ ] **Step 1: Add failing state-matrix tests**

Test expanded/compact/hidden navigation, normal/compact/hidden contacts, AI open/closed, and routed workspace states. Assert hidden columns resolve to `0px`, routed workspaces use only navigation plus `minmax(0,1fr)`, and no legacy page class defines its own root grid.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js
```

Expected: FAIL because the authority module is missing and root-grid rules are duplicated.

- [ ] **Step 3: Implement the layout authority**

Create the pure normalization/column computation module, load it before `r32-ui-runtime.js`, replace direct class-only shell calculation in `applyConversationLayout`, and publish one `--ui-shell-columns` value consumed by `.app`. Routed pages must remove contact/AI columns without leaving empty tracks.

- [ ] **Step 4: Run tests**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js tests/uat/round11ConversationCenterUi.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/r32-workspace-layout-authority.js frontend/js/r32-ui-runtime.js frontend/js/r32-workspace-route-authority.js frontend/r32-conversation-center-v2.css frontend/r32-production-workspace-layout.css frontend/index.html tests/uat/fix6dWindowsUiPublicContract.test.js
git commit -m "Refactor FIX6D workspace layout state authority"
```

### Task 3: Shared Navigation, AI Panel, and Control Density

**Files:**
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/r32-system-center.css`
- Modify: `frontend/r32-settings-recovery.css`
- Modify: `frontend/index.html`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`

**Interfaces:**
- Produces shared density variables for navigation width, icon hit area, control height, radius, panel gap, body text, and muted text.
- `.sc32-toggle-row` and `.sr32-toggle-row` use the same bounded label-description-control contract.

- [ ] **Step 1: Add failing density and switch-row tests**

Assert navigation has one active surface/border marker, compact buttons retain at least a 40px hit area, AI cards use the shared readable text variables, and system/settings switch rows use a bounded grid rather than a detached fixed right column.

- [ ] **Step 2: Run and verify RED**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js
```

- [ ] **Step 3: Implement shared density contract**

Define density variables once, simplify navigation shadows/borders, normalize AI panel typography and card spacing, and align both switch-row implementations to `minmax(0,1fr) auto` with a narrow-screen row fallback.

- [ ] **Step 4: Run focused and existing control tests**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js backend/tests/f25WindowsUatRepairBatch15.test.js tests/uat/componentReadabilityContract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/r32-conversation-center-v2.css frontend/r32-production-workspace-layout.css frontend/r32-system-center.css frontend/r32-settings-recovery.css frontend/index.html tests/uat/fix6dWindowsUiPublicContract.test.js
git commit -m "Unify FIX6D navigation and control density"
```

### Task 4: Notification Safe Area

**Files:**
- Create: `frontend/js/r32-notification-layout-authority.js`
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: `frontend/r32-system-center.js`
- Modify: `frontend/r32-settings-recovery.js`
- Modify: `frontend/index.html`
- Modify: `frontend/r32-theme-authority.css`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`

**Interfaces:**
- Produces `YanceNotificationLayoutAuthority.mount(document)` and `.show({message, tone, timeoutMs})`.
- Uses one `#globalNotificationRegion` below the desktop titlebar, with stacked dismissible notices in normal flow/safe overlay bounds.

- [ ] **Step 1: Add failing notification tests**

Assert a single global region exists, toast producers call the authority, the region top offset includes the titlebar/safe gap, and no notification uses a centered fixed top position over page headers.

- [ ] **Step 2: Run and verify RED**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js
```

- [ ] **Step 3: Implement notification authority and migrate producers**

Create the shared region/queue, migrate the conversation, system, and settings toast helpers, and preserve existing message/tone semantics.

- [ ] **Step 4: Run tests**

```bash
node --test --test-concurrency=1 tests/uat/fix6dWindowsUiPublicContract.test.js tests/uat/round11ConversationCenterUi.test.js
```

- [ ] **Step 5: Commit**

```bash
git add frontend/js/r32-notification-layout-authority.js frontend/js/r32-ui-runtime.js frontend/r32-system-center.js frontend/r32-settings-recovery.js frontend/index.html frontend/r32-theme-authority.css tests/uat/fix6dWindowsUiPublicContract.test.js
git commit -m "Route FIX6D notifications through a safe layout region"
```

### Task 5: Route-Authority Diagnostic Probe

**Files:**
- Modify: `frontend/js/r32-layout-diagnostics.js`
- Modify: `frontend/js/r32-workspace-route-authority.js`
- Modify: `frontend/r32-system-center.js`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`
- Test: `tests/uat/layoutDiagnosticsRouteAuthority.test.js`

**Interfaces:**
- Produces asynchronous `YanceLayoutDiagnostics.runRouteMatrix({app, document, routeAuthority, waitForReady, measure})`.
- Each result distinguishes `route_activation_failed`, `route_ready_timeout`, and `workspace_layout_failed`.
- Restores logical route, layout state, focus, and scroll through authorities.

- [ ] **Step 1: Write failing behavioral tests with a fake DOM**

Cover authority activation, two-animation-frame wait, ready timeout classification, successful nine-route measurement, and restoration without direct `className` assignment.

- [ ] **Step 2: Run and verify RED**

```bash
node --test --test-concurrency=1 tests/uat/layoutDiagnosticsRouteAuthority.test.js
```

- [ ] **Step 3: Implement asynchronous route probe**

Refactor diagnostics to use route names/authority, wait for route integrity and non-zero workspace geometry, collect metrics, and restore through `applyRoute` plus layout authority state.

- [ ] **Step 4: Run diagnostic and UI tests**

```bash
node --test --test-concurrency=1 tests/uat/layoutDiagnosticsRouteAuthority.test.js tests/uat/fix6dWindowsUiPublicContract.test.js tests/uat/round11ConversationCenterUi.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/r32-layout-diagnostics.js frontend/js/r32-workspace-route-authority.js frontend/r32-system-center.js tests/uat/layoutDiagnosticsRouteAuthority.test.js tests/uat/fix6dWindowsUiPublicContract.test.js
git commit -m "Refactor FIX6D route diagnostics through route authority"
```

### Task 6: Gate Integration and UI UAT Package

**Files:**
- Modify: `tools/runtime-delivery/round11-prelaunch-contract.js`
- Modify: `backend/tests/batch40WindowsAcceptancePackage.test.js`
- Modify: `scripts/create-batch40-windows-acceptance.js`
- Modify: `tools/runtime-delivery/create-round11-windows-uat-package.js`
- Test: all FIX6D and existing gate tests

**Interfaces:**
- Adds FIX6D tests to the round11 prelaunch list and updates exact counts from measured TAP output.
- Generates a new identity-bound Windows UI UAT package only after all source gates pass.

- [ ] **Step 1: Add gate-list assertions and update exact count from the real test total**

Run the prelaunch test list, count the TAP tests, then update `EXPECTED_ROUND11_PRELAUNCH_TESTS` and package assertions to that exact measured number.

- [ ] **Step 2: Run all source gates**

```bash
node --test --test-concurrency=1 backend/tests/f25WindowsUatRepairBatch14.test.js
node --test --test-concurrency=1 backend/tests/f25WindowsUatRepairBatch14.test.js backend/tests/phase2Batch3ThemeComputedAudit.test.js backend/tests/phase2ThemeSemanticContract.test.js tests/frontend-security/global-theme-authority.test.js tests/uat/componentReadabilityContract.test.js tests/uat/fix15-global-layout-account-media.test.js tests/uat/themeStudioExpansion.test.js tests/wp2/global-theme-completion.test.js tests/wp6/m6-release-layout.test.js tests/wp7/production-layout-contract.test.js
node tools/runtime-delivery/run-round11-prelaunch-gates.js
node scripts/audit-theme-colors.js
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify syntax and CSS parsing**

Run `node --check` for every changed JavaScript file and the repository CSS parser used by the existing package tests.

- [ ] **Step 4: Commit gate integration**

```bash
git add tools/runtime-delivery/round11-prelaunch-contract.js backend/tests/batch40WindowsAcceptancePackage.test.js scripts/create-batch40-windows-acceptance.js tools/runtime-delivery/create-round11-windows-uat-package.js
git commit -m "Integrate FIX6D UI contracts into Windows gates"
```

- [ ] **Step 5: Build and reverse-verify the final UI UAT ZIP**

Generate from clean HEAD, verify package SHA256, source commit/tree, internal checksums, unzip to a fresh directory, and rerun the focused FIX6D tests plus round11 prelaunch gates from the extracted bytes.
