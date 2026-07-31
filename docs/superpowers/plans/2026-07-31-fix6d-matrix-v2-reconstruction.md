# FIX6D Matrix V2 UI Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 26 open FIX6D UI defects from the approved 85-screenshot matrix while preserving the 9 frozen normal-state baselines and keeping model/runtime work out of this branch.

**Architecture:** Remove the competing routed-page document-flow authority and replace it with one viewport-to-workspace height chain. Routed business pages consume one master/detail and empty-state shell; conversation navigation and AI panel consume one state authority; notifications use one Windows-safe overlay authority; global reading variables drive every AI-panel text role, not only controls. Browser-computed style probes run in Electron/Xvfb against production CSS before packaging.

**Tech Stack:** Electron 39, Node.js 22 test runner, browser JavaScript, CSS Grid/Flexbox, CSS custom properties, hidden BrowserWindow computed-style probes.

## Global Constraints

- Do not modify Facebook, Telegram, WhatsApp, model routing, OpenRouter onboarding, credentials, SQLite business logic, or queues.
- Do not add page-local fixed pixel heights, screenshot-specific width hacks, or tail-end `!important` patches.
- Do not re-open `UI-011` or `UI-012`; compact binary switch geometry and same-card association are protected baseline `P-009`.
- Every task must demonstrate one failing test before production changes and rerun all earlier protection tests after the change.
- No Windows UI UAT ZIP is generated until all source, computed-style, state-matrix, and protection gates pass.

---

### Task 1: Browser-Computed Regression Harness

**Files:**
- Create: `tools/uat/fix6d-computed-style-probe-main.js`
- Create: `tests/uat/fixtures/fix6d-computed-style.html`
- Create: `tests/uat/fix6dComputedStyleRegression.test.js`

**Interfaces:**
- `runProbe(scenario)` returns measured viewport, app, routed workspace, columns, notification, switch, and AI typography geometry.
- Scenarios cover navigation expanded/compact/hidden, AI open/closed, conversation/routed views, reading standard/large, and 1920/1496/1100 widths.

- [ ] Write the Electron fixture and a failing test that proves current production CSS leaves routed workspaces/content-height driven and AI non-button text unchanged in large reading mode.
- [ ] Run `node --test --test-concurrency=1 tests/uat/fix6dComputedStyleRegression.test.js` and verify the expected failures.
- [ ] Commit only the harness and failing tests.

### Task 2: Single Viewport and Routed Workspace Height Authority

**Files:**
- Modify: `frontend/r32-flat-document-flow.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/r32-workspace-scroll-layout.css`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/index.html`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`

**Interfaces:**
- `#app` and each routed workspace resolve to the available viewport height.
- Routed pages use `grid-template-rows:auto ... minmax(0,1fr)` and inner body regions use `min-height:0;height:100%`.
- `r32-flat-document-flow.css` no longer owns desktop routed layout; it is limited to explicitly narrow/mobile document mode.

- [ ] Add route-height and conversation-height failing assertions.
- [ ] Remove desktop competition between flat document flow and production workspace authority.
- [ ] Verify conversation with AI open/closed and every routed workspace reaches the shell bottom without body-background exposure.
- [ ] Commit the height authority change.

### Task 3: Shared Master/Detail and Empty-State Shell

**Files:**
- Create: `frontend/r32-workspace-empty-state.css`
- Modify: `frontend/index.html`
- Modify: `frontend/r32-account-center.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: relationship workspace markup/classes in `frontend/index.html`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/fix6dWorkspaceEmptyStateContract.test.js`

**Interfaces:**
- `.ui-master-detail-shell`, `.ui-master-pane`, `.ui-detail-pane`, and `.ui-empty-state-fill` define one equal-height contract.
- Empty states center within the available detail/list region and do not create nested fixed-height decorative shells.
- Empty gradient-only title tracks are removed from profile/timeline detail markup or hidden only when semantically empty through the shared class.

- [ ] Write failing source and computed-style tests for account/profile/timeline/insights empty states.
- [ ] Apply shared semantic classes and remove duplicate fixed-short empty containers.
- [ ] Verify left/right panes share height and protected statistics remain horizontally intact.
- [ ] Commit the shared shell.

### Task 4: Conversation Layout State and Responsive Header/Floating Layers

**Files:**
- Modify: `frontend/js/r32-workspace-layout-authority.js`
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/js/r32-floating-menu-position.js`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/fix6dConversationStateMatrix.test.js`

**Interfaces:**
- Layout authority computes columns and row height for all navigation/contact/AI combinations.
- Header actions use deterministic wide/desktop/narrow/mobile breakpoints.
- Floating language/menu layers anchor to the actual trigger and clamp to the visual viewport.

- [ ] Add the 3×2 navigation/AI state matrix and narrow-header/floating-layer failing tests.
- [ ] Refactor root state application and responsive header grid.
- [ ] Verify `P-004` conversation-height baselines and no horizontal overlap.
- [ ] Commit the conversation state authority.

### Task 5: Windows-Safe Notification Overlay

**Files:**
- Modify: `frontend/js/r32-notification-layout-authority.js`
- Modify: `frontend/r32-theme-authority.css`
- Modify: `frontend/index.html`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/fix6dNotificationSafeArea.test.js`

**Interfaces:**
- Region is a fixed overlay below the Electron titlebar and left of Windows control-safe inset.
- Maximum visible items is 2; overflow is summarized into one counter notice.
- Region never participates in `.app` grid/document flow and never changes workspace geometry.

- [ ] Add failing geometry and overflow tests.
- [ ] Implement safe inset variables, fixed overlay bounds, and overflow aggregation.
- [ ] Verify system center and AI workbench layout geometry is identical before/after notifications.
- [ ] Commit the notification authority.

### Task 6: AI Panel Typography, Density, and AI Workbench Responsive Actions

**Files:**
- Modify: `frontend/r32-global-reading.css`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/index.html`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/fix6dAiTypographyContract.test.js`

**Interfaces:**
- AI panel text roles consume `--ws-section-title`, `--ws-card-title`, `--ws-body`, `--ws-small`, and `--ws-meta`.
- Standard→large mode increases non-button text by the same semantic role ratio; buttons are not the only changed elements.
- AI workbench top actions wrap as one bounded group without dropping an isolated button below the title.

- [ ] Add failing computed-style ratios for title/body/meta/candidate labels and narrow action group tests.
- [ ] Replace hard-coded AI panel text sizes with semantic variables and normalize panel spacing.
- [ ] Verify protected full-width AI workbench cards remain non-overlapping.
- [ ] Commit AI typography and responsive actions.

### Task 7: System Center Natural Card Layout and Binary-Control Protection

**Files:**
- Modify: `frontend/r32-system-center.css`
- Modify: `frontend/r32-global-reading.css`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/fix6dWindowsUiPublicContract.test.js`

**Interfaces:**
- Content/control columns use intrinsic rows and bounded columns rather than forced equal height.
- `.ui-binary-control` geometry remains unchanged in standard/large and compact/comfortable modes.

- [ ] Add failing unequal-content card and switch-protection computed assertions.
- [ ] Remove forced equal-height row behavior and preserve intrinsic card height.
- [ ] Verify `P-003`, `P-006`, and `P-009`.
- [ ] Commit system center layout closure.

### Task 8: Theme/Navigation Semantics and Diagnostic Closure

**Files:**
- Modify: `frontend/r32-theme-authority.css`
- Modify: `frontend/r32-theme-semantic-contract.css`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/js/r32-layout-diagnostics.js`
- Test: `tests/uat/fix6dComputedStyleRegression.test.js`
- Test: `tests/uat/layoutDiagnosticsRouteAuthority.test.js`

**Interfaces:**
- Brand, navigation active state, borders, focus, and buttons use semantic theme tokens.
- Navigation brand/business/bottom tools share one hit-area and radius scale.
- Diagnostics read route authority plus measured geometry after two animation frames.

- [ ] Add theme-switch computed-color and navigation-geometry protection tests.
- [ ] Normalize navigation component contract and route diagnostics.
- [ ] Verify all themes and route probes.
- [ ] Commit theme/navigation/diagnostic closure.

### Task 9: Full Gates, Screenshot Protection Matrix, and Packaging Hold

**Files:**
- Modify: `tools/runtime-delivery/round11-prelaunch-contract.js`
- Create: `tests/uat/fix6dScreenshotMatrixGate.test.js`
- Update package contracts only after measured final test count.

**Interfaces:**
- Gate maps every open `UI-001..UI-028` (excluding closed `UI-011/012`) and every `P-001..P-009` to at least one automated assertion or Windows-only evidence requirement.

- [x] Run all focused tests, Batch14 3/3, theme/layout 43/43, Batch40 66/66, full prelaunch, theme audit, syntax checks, and `git diff --check`.
- [x] Record Windows-only DPI/visual requirements without marking them passed.
- [x] Do not build a UAT ZIP until source gates are green and the branch is clean.

### Task 10: Route Scroll Ownership and Theme Reachability (UI-030..UI-032)

**Files:**
- Modify: `frontend/r32-workspace-scroll-layout.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/index.html`
- Modify: `frontend/r32-theme-motion.js`
- Modify: `tools/uat/fix6d_computed_style_probe.py`
- Modify: `tests/uat/fixtures/fix6d-computed-style.html`
- Create: `tests/uat/fix6dRouteScrollAuthority.test.js`

**Interfaces:**
- Every routed non-conversation workspace is the sole vertical scroll owner.
- Route headers, sub-navigation, cards, master/detail panes, and ordinary lists remain in normal flow.
- Conversation message and AI streams remain explicit exceptions; modal and horizontal rails are unaffected.
- The final interactive control on every routed page is reachable at maximum scroll.

- [x] Add failing computed-style tests for one root scroll owner, no sticky/fixed occlusion, and theme-page reachability.
- [x] Remove competing inner vertical scroll owners from routed workspace CSS.
- [x] Make each route workspace own vertical scrolling while preserving viewport fill and empty-state protection.
- [x] Rerun all FIX6D computed-style, state-matrix, and screenshot protection gates.
- [x] Commit the scroll authority as an independent change.

### Task 11: Screenshot-4 Empty State and Filter Rail Closure (UI-014/UI-015/UI-022/UI-029)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/js/r32-ui-runtime.js`
- Modify: `frontend/r32-workspace-empty-state.css`
- Modify: `tools/uat/fix6d_computed_style_probe.py`
- Modify: `tests/uat/fixtures/fix6d-computed-style.html`
- Modify: `tests/uat/fix6dWorkspaceEmptyStateContract.test.js`
- Modify: `tests/uat/fix6dComputedStyleRegression.test.js`
- Modify: `tests/uat/fix6dRouteScrollAuthority.test.js`

**Interfaces:**
- Contacts, profiles, timeline, and insights share one master/detail and empty-state authority.
- An empty detail decoration row collapses completely; the fill state spans every detail grid track.
- Filter labels are atomic horizontal controls inside a horizontally scrollable rail.
- The contacts route participates in the same sole-scroll-owner matrix as every other routed workspace.

- [x] Add failing tests for the missing contacts empty detail, decoration track, centered fill geometry, and wrapped filter labels.
- [x] Bind contacts to the shared master/detail, filter-rail, and empty-decoration contracts.
- [x] Render an explicit contacts detail empty state when no contact exists.
- [x] Add contacts to the browser scroll and computed-style route matrix.
- [x] Update the screenshot matrix and measured prelaunch count to 136.
- [x] Rerun focused, theme/layout, prelaunch, and computed-style gates.
