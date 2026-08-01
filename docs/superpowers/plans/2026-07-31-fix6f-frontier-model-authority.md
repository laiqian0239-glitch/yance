# FIX6F Frontier Model Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Opus 5 the preferred OpenRouter primary candidate and GPT-5.6 Sol the preferred cross-provider fallback, while fixing candidate discovery, Batch-model isolation, source-UAT state contamination, and derived source identity.

**Architecture:** Add one frontier-candidate authority that converts the live `/models/user` catalog into an auditable, provider-diverse shortlist without treating model names as formal quality proof. OpenRouter onboarding consumes explicit preferred slugs only when present and interactive; formal champion receipts remain authoritative. Source UAT defaults to an identity-scoped data directory, and derived packages use a payload-manifest identity rather than inheriting the upstream FIX6D checkpoint.

**Tech Stack:** Node.js 22+, CommonJS, `node:test`, SQLite `DatabaseSync`, Electron source-UAT delivery tools.

## Global Constraints

- No StubEngine result may be used as real OpenRouter evidence.
- Batch-only models must never enter interactive reply, smoke, or reply-model presentation paths.
- Preferred model slugs configure candidate order only; they do not mint formal qualification receipts.
- Existing real `%APPDATA%\Yance` data must never be mutated by isolated source-UAT startup.
- All fixes must be in common authorities, not UI-only exceptions.

---

### Task 1: Frontier candidate authority

**Files:**
- Create: `backend/services/openRouterFrontierCandidateAuthority.js`
- Modify: `backend/services/openRouterAutoConfigurationService.js`
- Test: `backend/tests/fix6fFrontierModelAuthority.test.js`

- [ ] Write RED tests for exact preferred slugs, provider diversity, regular-over-Fast selection, and Batch exclusion.
- [ ] Run tests and verify expected failures.
- [ ] Implement catalog normalization and frontier shortlist authority.
- [ ] Re-run tests and verify GREEN.

### Task 2: Preferred smoke and route intent

**Files:**
- Modify: `backend/services/openRouterOnboardingSmokeService.js`
- Modify: `backend/services/modelRegistry.js`
- Test: `backend/tests/fix6fFrontierModelAuthority.test.js`

- [ ] Write RED tests proving smoke tries `anthropic/claude-opus-5` first and `openai/gpt-5.6-sol` second when both exist.
- [ ] Persist preferred primary/fallback slugs and model IDs as candidate intent without formal qualification.
- [ ] Verify conditional routes use those two independent providers after real smoke success.

### Task 3: Batch and background model presentation isolation

**Files:**
- Modify: `backend/services/modelRuntimeAuthority.js`
- Modify: `frontend/js/r32-ai-workbench-runtime.js`
- Test: `backend/tests/fix6fModelPresentation.test.js`

- [ ] Add backend purpose projection (`interactive-reply`, `background-utility`, `batch-only`).
- [ ] Render Batch-only models in a separate collapsed background section, never in the reply-model grid.
- [ ] Verify static UI contract and backend projection.

### Task 4: Source-UAT isolation and migration safety

**Files:**
- Modify: `tools/runtime-delivery/source-uat-delivery.js`
- Modify: `tools/runtime-delivery/start-source-uat.js`
- Test: `tests/runtime-delivery/fix6f-source-uat-isolation.test.js`

- [ ] Write RED test proving different source identities resolve to different isolated data roots.
- [ ] Implement identity-scoped default data root and legacy-root discovery.
- [ ] Verify explicit `--existing-data` and custom roots remain unchanged.

### Task 5: Derived source identity

**Files:**
- Modify: `tools/runtime-delivery/source-uat-delivery.js`
- Create: `tools/runtime-delivery/create-derived-source-identity.js`
- Test: `tests/runtime-delivery/fix6f-derived-source-identity.test.js`

- [ ] Add payload-manifest identity validation excluding only the identity document itself.
- [ ] Reject stale or tampered derived packages.
- [ ] Generate FIX6F identity after final commit and verify source-UAT preparation from a `.git`-free copy.

### Task 6: Regression, review, and packaging

**Files:**
- Create: `YANCE_BATCH40_FIX6F_FRONTIER_MODEL_AUTHORITY_REPORT_ZH.md`
- Create: `YANCE_BATCH40_FIX6F_FRONTIER_MODEL_AUTHORITY_VERIFICATION.json`

- [ ] Run focused RED→GREEN and full related regression suites.
- [ ] Run backend tests per file with independent timeout.
- [ ] Run CodeRabbit committed review and address verified issues only.
- [ ] Package full source and evidence ZIPs, verify CRC/path safety/hash manifests, and keep release gates false.
