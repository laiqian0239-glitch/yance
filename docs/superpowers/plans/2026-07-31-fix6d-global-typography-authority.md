# FIX6D Global Typography Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all competing formal-frontend font authorities with one semantic token contract, close UI-033 through UI-037, and prove the source with static and real Chromium computed-style gates without claiming Windows UAT.

**Architecture:** `r32-global-reading.css` becomes a token-only authority. Component styles consume semantic tokens directly, while a repository audit gate forbids fixed font sizes, inline/dynamic sizing, duplicate reading selectors, legacy typography variables, and font-size `!important`. A batched Chromium probe mutates the production DOM across the full route/state/theme matrix and reports only contract violations.

**Tech Stack:** HTML, CSS custom properties, browser JavaScript, Node.js 22 test runner, Python Playwright, Chromium 138, Fallow CLI when available, SonarQube CLI/MCP when available.

## Global Constraints

- 禁止新增一层全局 CSS 覆盖来压旧规则，必须移除或迁移旧硬编码。
- 禁止逐页临时补丁，必须建立唯一语义字号令牌和组件消费契约。
- 标准/舒适/大字同时影响标题、正文、说明、状态、标签、数据值和按钮。
- 字号放大后自然重排，不得裁切、遮挡、嵌套滚动或压缩列表有效区域。
- 先证明 `557e758` 失败，再修改生产代码。
- 不生成正式候选包；Windows 100%/125%/150% 未验前保持三项发布门禁为 false。

---

### Task 1: Baseline Typography Debt Gate

**Files:**
- Create: `tools/uat/fix6d-global-typography-audit.js`
- Create: `tests/uat/fix6dGlobalTypographyAudit.test.js`
- Create: `governance/fix6d-global-typography-baseline.json`

**Interfaces:**
- Produces `auditTypography(root): { pass, counts, violations, authority }`.
- CLI exits 1 when violations exist and writes deterministic JSON with `--json`.

- [ ] Write the audit test and scanner for literal font sizes, inline/dynamic sizing, `font-size !important`, duplicate `data-reading`, legacy typography variables, missing semantic tokens, and multiple token definers.
- [ ] Run the test on untouched production files and record the expected RED counts.
- [ ] Commit the failing gate and baseline evidence only.

### Task 2: Full Computed-Style Failure Matrix

**Files:**
- Modify: `tools/uat/fix6d_computed_style_probe.py`
- Modify: `tests/uat/helpers/fix6dComputedStyleProbe.js`
- Create: `tests/uat/fix6dGlobalTypographyComputedStyle.test.js`
- Modify: `tests/uat/fixtures/fix6d-computed-style.html`

**Interfaces:**
- Produces `runTypographyMatrix(config)` with aggregated violations, scenario count, role deltas, overflow, list-fill, safe-offset, and overlay results.
- Reuses one Chromium page and mutates state to make the complete matrix practical.

- [ ] Add route/role manifests and full state/theme enumeration.
- [ ] Add assertions for body +3px, caption/meta/status +2px, control growth, no clipping, list fill, safe title offset, final-item reachability, AI and Persona role coverage.
- [ ] Run on untouched production and preserve the expected RED evidence.
- [ ] Commit test infrastructure only.

### Task 3: Token-Only Reading Authority

**Files:**
- Rewrite: `frontend/r32-global-reading.css`
- Modify: `frontend/r32-theme-motion.js`
- Modify: `frontend/index.html`

**Interfaces:**
- Defines exactly the ten `--type-*` tokens, line-height tokens and `--control-min-block-size` for the three reading modes.
- Removes all runtime JS writes to typography size variables and all inline `data-reading` definitions.

- [ ] Replace the override sheet with token definitions and inheritance roots only.
- [ ] Remove duplicate inline reading declarations and dynamic size writes.
- [ ] Run static and focused computed-style tests.
- [ ] Commit the authority change.

### Task 4: Formal Component Migration

**Files:**
- Modify: `frontend/index.html`
- Modify: all loaded `frontend/r32-*.css` files containing typography debt
- Test: `tests/uat/fix6dGlobalTypographyAudit.test.js`

**Interfaces:**
- Every formal `font-size` declaration outside the authority uses one `var(--type-*)` token and contains no `!important`.
- Inline style font sizes and legacy typography variable consumption are zero.

- [ ] Migrate page titles, section/card titles, body/strong text, caption/meta/status, controls, badges and data values by component semantics.
- [ ] Remove fixed fallbacks and competing declarations rather than layering overrides.
- [ ] Run the audit until all forbidden categories are zero.
- [ ] Commit the component migration.

### Task 5: AI Panel and Persona Semantic Layout

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/r32-persona.css`
- Modify: `frontend/r32-conversation-center-v2.css`
- Modify: `frontend/r32-conversation-center-v3.css`
- Modify: `frontend/r32-conversation-capabilities.css`
- Test: `tests/uat/fix6dGlobalTypographyComputedStyle.test.js`

**Interfaces:**
- AI state, evidence, targets, relationship, candidates, explanations, tuning labels and actions consume distinct semantic roles.
- Persona readable grids use `repeat(auto-fit,minmax(...))` and naturally reduce columns under large reading or narrow width.

- [ ] Verify RED role deltas for AI and Persona.
- [ ] Migrate semantic roles and remove micro-size rules.
- [ ] Verify no clipping and natural card/grid growth.
- [ ] Commit AI/Persona closure.

### Task 6: Remaining Height and Scroll Safety Contracts

**Files:**
- Modify: `frontend/r32-workspace-scroll-layout.css`
- Modify: `frontend/r32-production-workspace-layout.css`
- Modify: `frontend/r32-account-center.css`
- Modify: relationship/list styles in `frontend/index.html`
- Test: `tests/uat/fix6dGlobalTypographyComputedStyle.test.js`

**Interfaces:**
- Master panes use `auto auto minmax(0,1fr)` or equivalent semantic rows.
- `--ui-scroll-safe-offset` is the only title-safe offset authority.

- [ ] Add list-fill and scroll-safe RED assertions.
- [ ] Refactor list/body tracks and title safe offset at shared shells.
- [ ] Verify no new nested scroll owners and preserve FIX6D V4 scroll protections.
- [ ] Commit UI-033/UI-034 closure.

### Task 7: Full Verification and Static Analysis

**Files:**
- Modify: `tools/runtime-delivery/round11-prelaunch-contract.js` only if the new test list requires gate registration.
- Create: `03_REPORTS/YANCE_BATCH40_FIX6D_GLOBAL_TYPOGRAPHY_SOURCE_REPORT_ZH.md`
- Create: `03_REPORTS/YANCE_BATCH40_FIX6D_GLOBAL_TYPOGRAPHY_VERIFICATION.json`

**Interfaces:**
- Report records source closure separately from Windows UAT and keeps release flags false.

- [ ] Run static audit, full Chromium matrix, existing FIX6D computed-style/scroll/empty-state tests, theme audit, syntax checks and `git diff --check`.
- [ ] Run Fallow audit/health/CSS analysis when the CLI is reachable; record inability without substituting claims when unavailable.
- [ ] Run SonarQube analysis/quality gate when MCP or CLI is reachable; record infrastructure blocker when unavailable.
- [ ] Build a source-only handoff ZIP, verify SHA256 and reverse-extract/retest; do not label it a Windows candidate.
- [ ] Commit reports and source handoff metadata.
