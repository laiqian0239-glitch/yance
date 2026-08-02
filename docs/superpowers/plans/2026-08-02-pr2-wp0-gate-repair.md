# PR #2 WP0 Gate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Stage 6.4.5.9 WP0 failures without disabling checks, broadening authorized implementation branches, or suppressing active release-surface violations.

**Architecture:** Move reference-only classification into an explicit governance policy consumed by the scanner, make pull-request branch identity an explicit CLI input, fetch immutable tags with an auditable Git command, and govern Electron ZIP tracking with matching `.gitignore` and LFS assertions. Generated source-identity documents remain fail-closed and must be regenerated only after the final source tree is fixed.

**Tech Stack:** Node.js 22, node:test, GitHub Actions, Git, Git LFS, JSON governance policies.

## Global Constraints

- All defects must be fixed in shared authority layers; temporary bypasses and relaxed validation are forbidden.
- Stage 6.4.5.8 remains permanently rejected.
- Authorized implementation branches remain `stage/6.4.5.9-architecture-closure` or `rebuild/windows-release-closure-YYYYMMDD[-suffix]`.
- Historical evidence may be reference-only only through an explicit policy entry; runtime, build, package, release, deploy, and tool paths remain active by default.
- Missing or non-annotated immutable tags remain a hard failure.
- `readyForPromotion`, `formalRelease`, and `candidatePackageGenerated` remain false.

---

### Task 1: Policy-driven reference-only classification

**Files:**
- Modify: `tests/wp0/forbidden-hotfix-entrypoints.test.js`
- Modify: `governance/repository-scope-policy.json`
- Modify: `tools/wp0/lib.js`

**Interfaces:**
- Consumes: `repository-scope-policy.json`
- Produces: `referenceOnlyRoots: string[]` and policy-driven `classifyScanPath(relativePath, policy)` behavior.

- [ ] **Step 1: Write the failing test**

Add a fixture containing `INDEPENDENT_AUDIT_DELIVERY/FULL_SOURCE_FILE_MANIFEST.json` with rejected-stage historical text and assert zero violations plus `REFERENCE_ONLY_AUDIT_DELIVERY`. Add a control fixture under `tools/` with the same text and assert a violation.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wp0/forbidden-hotfix-entrypoints.test.js`
Expected: FAIL because `INDEPENDENT_AUDIT_DELIVERY` is currently classified as `ACTIVE_SOURCE_OR_AUTOMATION`.

- [ ] **Step 3: Write minimal implementation**

Add `referenceOnlyRoots` to the governance policy and make the scanner load, validate, normalize, and apply those roots before defaulting to active source. Keep `governance/`, `tests/wp0/`, `tools/wp0/`, `evidence/`, and `implementation/` classifications explicit.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wp0/forbidden-hotfix-entrypoints.test.js`
Expected: PASS, with the active control fixture still rejected.

- [ ] **Step 5: Commit**

Commit message: `fix(wp0): govern reference-only audit delivery roots`

### Task 2: Pull-request branch and immutable-tag transport authority

**Files:**
- Modify: `tests/wp0/freeze-rejected-baseline.test.js`
- Modify: `tools/wp0/verify-gate.js`
- Modify: `.github/workflows/stage-6459-wp0-gates.yml`

**Interfaces:**
- Consumes: `--branch <name>` CLI input and `github.head_ref`/`github.ref_name`.
- Produces: explicit reviewed-branch identity passed to `verifyWp0Gate({ branch })`.

- [ ] **Step 1: Write the failing test**

Add a child-process test invoking `tools/wp0/verify-gate.js --branch rebuild/windows-release-closure-20260802-gate0-wp0-fix` and assert the reported runtime target branch equals the supplied branch rather than detached HEAD.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wp0/freeze-rejected-baseline.test.js`
Expected: FAIL because `verify-gate.js` ignores `--branch`.

- [ ] **Step 3: Write minimal implementation**

Parse `--branch`, pass it into `verifyWp0Gate`, and update the workflow to execute `git fetch --force origin +refs/tags/*:refs/tags/*` followed by `git show-ref --verify refs/tags/stage-6.4.5.8-rejected-architecture`. Invoke the gate with `--branch "${{ github.head_ref || github.ref_name }}"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wp0/freeze-rejected-baseline.test.js`
Expected: PASS when the immutable annotated tag exists; missing tag remains a hard failure with a precise diagnostic.

- [ ] **Step 5: Commit**

Commit message: `fix(wp0): bind PR gate to reviewed branch and fetched tags`

### Task 3: Electron archive tracking authority

**Files:**
- Modify: `tests/runtime-delivery/source-uat-delivery.test.js`
- Modify: `.gitignore`
- Verify: `.gitattributes`

**Interfaces:**
- Produces: normal Git discovery for `vendor/electron/*.zip` while all other ZIP files remain ignored and Electron ZIPs remain LFS-managed.

- [ ] **Step 1: Write the failing test**

Add assertions that `.gitignore` contains `!vendor/electron/*.zip`, `.gitattributes` contains `vendor/electron/*.zip filter=lfs diff=lfs merge=lfs -text`, and no broad `!*.zip` exception exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/runtime-delivery/source-uat-delivery.test.js`
Expected: FAIL because the narrow `.gitignore` exception is absent.

- [ ] **Step 3: Write minimal implementation**

Add only `!vendor/electron/*.zip` immediately after the global `*.zip` ignore rule.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/runtime-delivery/source-uat-delivery.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix(delivery): track trusted Electron archives without force-add`

### Task 4: Remote verification and source identity reseal

**Files:**
- Regenerate: `YANCE_DERIVED_SOURCE_IDENTITY.json`
- Regenerate: `YANCE_ARTIFACT_DESCRIPTOR.json`
- Regenerate any manifest or receipt whose contract binds the full payload.

**Interfaces:**
- Consumes: final fixed source tree and immutable annotated tag.
- Produces: a new payload manifest SHA-256 and matching generated identity documents.

- [ ] **Step 1: Run focused tests and WP0 gate**

Run: `npm run test:wp0 && npm run verify:wp0:gate -- --branch rebuild/windows-release-closure-20260802-gate0-wp0-fix`
Expected: PASS after the immutable annotated tag exists remotely.

- [ ] **Step 2: Regenerate identity after all code changes**

Run the repository's `tools/runtime-delivery/create-derived-source-identity.js` against the clean final export, using the final base commit/tree and a new derived version.

- [ ] **Step 3: Verify fail-closed behavior**

Modify one exported payload byte and confirm `SOURCE_UAT_DERIVED_IDENTITY_MISMATCH`; restore the byte and confirm verification passes.

- [ ] **Step 4: Push final commit and inspect GitHub Actions**

Expected: `Stage 6.4.5.9 WP0 Architecture Gates` concludes `success`; the PR remains Draft and all release gates remain false.
