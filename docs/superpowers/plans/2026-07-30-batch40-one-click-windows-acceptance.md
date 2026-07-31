# Batch40 One-Click Windows Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single downloadable Windows package that automatically validates, extracts, tests, and archives evidence for the repaired Batch40 source.

**Architecture:** Extend the existing Batch40 acceptance generator with a PowerShell bootstrap and a thin CMD launcher. Embed the exact repaired source ZIP, bind both source and Node runtime by SHA-256, execute repository gates fail-closed, and package all logs and receipts.

**Tech Stack:** Node.js generator/tests, Windows PowerShell 5.1, CMD, ZIP/SHA-256.

## Global Constraints

- Runtime is isolated Node.js 22.16.0 with npm 10.9.2.
- Node runtime and source payload must match fixed SHA-256 values.
- No administrator access or system PATH mutation.
- Automated success does not set `readyForPromotion` or `formalRelease`.

---

### Task 1: Bootstrap contract

**Files:**
- Modify: `backend/tests/batch40WindowsAcceptancePackage.test.js`
- Modify: `scripts/create-batch40-windows-acceptance.js`

**Interfaces:**
- Consumes: source ZIP path and SHA-256.
- Produces: `buildOneClickPowerShell(options)` and `buildOneClickLauncher()`.

- [ ] Write tests asserting fixed Node URL/hash, source hash, isolated runtime, strict commands, fail-closed behavior, and evidence ZIP creation.
- [ ] Run the focused test and confirm it fails because the new builders do not exist.
- [ ] Implement the minimal builders and include them in generator exports.
- [ ] Run the focused test and confirm it passes.

### Task 2: All-in-one package

**Files:**
- Modify: `scripts/create-batch40-windows-acceptance.js`
- Create: generated acceptance ZIP and checksum in the workspace delivery root.

**Interfaces:**
- Consumes: repaired source ZIP.
- Produces: one ZIP containing launcher, PowerShell bootstrap, manifest, instructions, and source payload.

- [ ] Add generator arguments for source payload and output directory.
- [ ] Generate the package and fail if the source hash differs from the declared value.
- [ ] Inspect ZIP members and verify its checksum.
- [ ] Run Batch40 focused tests and `git diff --check`.
