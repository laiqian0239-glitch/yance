# Yance Batch40 FIX6B Windows UAT Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a test-tooling-only FIX6B candidate and one-click Windows acceptance package that binds the new source SHA and enforces Batch14 3/3, theme/layout 43/43, Batch40 focused 66/66, and backend 1197/1197 across 200 files with explicit exit 0.

**Architecture:** Keep production HTML/CSS/JavaScript/backend behavior unchanged. Strengthen `scripts/create-batch40-windows-acceptance.js` so the generated PowerShell launcher executes four explicit automated gates plus a negative SHA tamper control, and strengthen `scripts/verify-batch40-windows-evidence.js` so it independently recomputes the source archive SHA and verifies exact test/file counts from raw logs.

**Tech Stack:** Node.js 22.16.0, npm 10.9.2, Node test runner TAP output, PowerShell 5+, ZIP/SHA-256, CommonJS.

## Global Constraints

- Current FIX6A source candidate SHA is `44a11c01457d56cdd07bc842dd4aace099560d1afbb9be79ccc0ed6c0fbf2d47`.
- No production code changes; only Windows UAT tooling, tests, plan/report/package metadata may change.
- Exact automated gates: Batch14 3 tests; theme/layout 43 tests; Batch40 focused 66 tests; backend 200 files and 1197 tests; every command exit code 0.
- UAT-F6-075 must recompute and bind the candidate archive SHA and include a negative tamper-rejection receipt.
- `readyForPromotion=false` and `formalRelease=false` remain unchanged.
- Old FIX6 SHA and old FIX6 Windows evidence must never be accepted as FIX6B evidence.

---

### Task 1: Encode exact acceptance contract

**Files:**
- Modify: `backend/tests/batch40WindowsAcceptancePackage.test.js`
- Modify: `scripts/create-batch40-windows-acceptance.js`

**Interfaces:**
- Consumes: `buildManifest`, `buildWindowsCommand`, `buildOneClickPowerShell`.
- Produces: manifest exact-count fields and generated launcher commands for Batch14, theme/layout, focused, backend, strict verification, and SHA negative control.

- [ ] **Step 1: Write failing tests** asserting exact counts, explicit test commands, strict verifier arguments, source SHA binding, and tamper-rejection evidence.
- [ ] **Step 2: Run the package test** and confirm failures are caused by missing FIX6B behavior.
- [ ] **Step 3: Implement the minimal generator changes** without modifying production modules.
- [ ] **Step 4: Re-run the package test** and confirm all tests pass.

### Task 2: Verify exact raw evidence

**Files:**
- Create: `backend/tests/batch40WindowsEvidenceVerifier.test.js`
- Modify: `scripts/verify-batch40-windows-evidence.js`

**Interfaces:**
- Consumes: four TAP/log files, four exit codes, expected exact counts, source archive path/SHA, Node/npm versions, commit/tree.
- Produces: `BATCH40_AUTOMATED_RECEIPT.json` containing exact summaries, source archive SHA, log SHA-256 values, and closed automated-gate status while keeping release flags false.

- [ ] **Step 1: Write failing verifier tests** for exact TAP counts, backend section aggregation, source SHA recomputation, and rejection of count/SHA mismatches.
- [ ] **Step 2: Run verifier tests** and confirm expected failures.
- [ ] **Step 3: Implement exact parsing and verification** using real log content rather than trust in command arguments.
- [ ] **Step 4: Re-run verifier tests and package tests** and confirm all pass.

### Task 3: Run final regression and package

**Files:**
- Create: `YANCE_BATCH40_FIX6B_WINDOWS_UAT_GATE_SELF_CHECK_ZH.md`
- Create outside source: source candidate ZIP, one-click Windows acceptance ZIP, SHA-256 files, delivery ZIP.

**Interfaces:**
- Consumes: committed FIX6B working tree and generated source archive SHA.
- Produces: a unique source candidate and a one-click Windows test package bound to its SHA/commit/tree.

- [ ] **Step 1: Run syntax and diff checks.**
- [ ] **Step 2: Run Batch14 3/3, theme/layout 43/43, Batch40 focused 66/66.**
- [ ] **Step 3: Run complete `backend/run_all_tests.js`; require 200 files, 1197 tests, and exit 0.**
- [ ] **Step 4: Commit the tooling-only changes and record commit/tree.**
- [ ] **Step 5: Build a source ZIP excluding `.git`, `node_modules`, runtime data, and generated evidence.**
- [ ] **Step 6: Generate the one-click Windows acceptance package using the exact source ZIP SHA.**
- [ ] **Step 7: Verify ZIP integrity, file manifests, embedded SHA/commit/tree, and package hashes.**
- [ ] **Step 8: Create the self-check report and delivery bundle while retaining promotion/release flags as false.**
