# PR #2 WP0 Gate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Stage 6.4.5.9 WP0 failures without disabling checks, broadening authorized implementation branches, or suppressing active release-surface violations.

**Architecture:** The portable repository does not contain the original provenance commit `c150182219edea2faf49c714275e9921a21df742`, so it cannot truthfully create or verify a live annotated tag that peels to that absent object. The rejected decision is therefore anchored to an immutable commit and blob that do exist in this repository, while the original commit remains provenance metadata. Historical audit delivery classification is policy-driven and narrow, PR branch identity is bound to a fetched remote branch tip, and derived payload identity is generated only in a git-free sealed export.

**Tech Stack:** Node.js 22, node:test, GitHub Actions, Git, Git LFS, JSON governance policies.

## Global Constraints

- All defects must be fixed in shared authority layers; temporary bypasses and relaxed validation are forbidden.
- Stage 6.4.5.8 remains permanently rejected.
- Authorized implementation branches remain `stage/6.4.5.9-architecture-closure` or `rebuild/windows-release-closure-YYYYMMDD[-suffix]`.
- Runtime, build, package, release, deploy, scripts, services, and tools remain active scan surfaces.
- Only `INDEPENDENT_AUDIT_DELIVERY` is declared reference-only, through explicit governance policy.
- The archive anchor commit, ancestor relationship, path, blob object, and rejected decision fields all fail closed.
- `readyForPromotion`, `formalRelease`, and `candidatePackageGenerated` remain false.

---

### Task 1: Policy-driven reference-only classification

**Files:**
- Modify: `tests/wp0/forbidden-hotfix-entrypoints.test.js`
- Modify: `governance/repository-scope-policy.json`
- Modify: `tools/wp0/lib.js`

- [x] Add a fixture proving `INDEPENDENT_AUDIT_DELIVERY/FULL_SOURCE_FILE_MANIFEST.json` is classified `REFERENCE_ONLY_AUDIT_DELIVERY`.
- [x] Add an active `tools/` control fixture proving the same rejected-stage text is still blocked.
- [x] Validate policy paths, classifications, duplicates, and protected active-root overlap.
- [ ] Execute `node --test tests/wp0/forbidden-hotfix-entrypoints.test.js` and capture fresh output.

### Task 2: Portable rejected-baseline archive authority

**Files:**
- Modify: `tests/wp0/freeze-rejected-baseline.test.js`
- Modify: `governance/stage-policy.json`
- Modify: `governance/rejected-baselines/stage-6.4.5.8.json`
- Modify: `tools/wp0/lib.js`

**Authority values:**
- Provenance commit: `c150182219edea2faf49c714275e9921a21df742`
- Archive anchor commit: `570823e722f6db475066d6ef80ba900ac5c6cb39`
- Archive path: `governance/rejected-baselines/stage-6.4.5.8.json`
- Archive blob: `6a5ffc68e76baf6a477668c6c2faf61934e94720`

- [x] Verify the anchor object is a commit and an ancestor of `HEAD`.
- [x] Verify the exact path resolves to the expected blob object.
- [x] Compare the archived and current rejection decision fields.
- [x] Declare `originalVcsHistoryAvailable=false` and fail if the absent provenance object is incorrectly treated as repository history.
- [x] Keep the historical tag name only as a label, not as an unverifiable live ref claim.
- [x] Add a blob-mismatch fail-closed regression.
- [ ] Execute `node --test tests/wp0/freeze-rejected-baseline.test.js` and capture fresh output.

### Task 3: Reviewed PR branch identity

**Files:**
- Modify: `tools/wp0/verify-gate.js`
- Modify: `.github/workflows/stage-6459-wp0-gates.yml`
- Test: `tests/wp0/freeze-rejected-baseline.test.js`

- [x] Parse `--branch` and validate it with `git check-ref-format`.
- [x] Require `refs/remotes/origin/<branch>` and require its tip to equal checked-out `HEAD`.
- [x] Check out the reviewed PR head rather than the synthetic merge commit.
- [x] Fetch the reviewed branch into the trusted `origin` namespace.
- [x] Add matching-tip and mismatched-tip regressions.
- [ ] Confirm a fresh GitHub Actions run completes successfully.

### Task 4: Electron archive tracking authority

**Files:**
- Create: `tests/runtime-delivery/electron-archive-tracking-authority.test.js`
- Modify: `.gitignore`
- Verify: `.gitattributes`

- [x] Add the narrow `!vendor/electron/*.zip` ignore exception.
- [x] Keep unrelated ZIP files ignored.
- [x] Require `filter=lfs diff=lfs merge=lfs -text` through `git check-attr`.
- [ ] Execute the focused runtime-delivery test and capture fresh output.

### Task 5: Mutable repository versus sealed export identity

**Files:**
- Create: `tests/runtime-delivery/repository-source-identity-authority.test.js`
- Modify: `.gitignore`
- Delete: `YANCE_DERIVED_SOURCE_IDENTITY.json`
- Modify: `YANCE_ARTIFACT_DESCRIPTOR.json`
- Modify: `tools/runtime-delivery/create-derived-source-identity.js`

- [x] Remove the stale tracked derived payload seal from the mutable repository.
- [x] Ignore repository-root `YANCE_DERIVED_SOURCE_IDENTITY.json`.
- [x] Describe the repository as `MUTABLE_GIT_IMPLEMENTATION_REPOSITORY` with runtime `HEAD`/tree resolution.
- [x] Keep all release and promotion flags false.
- [x] Reject derived identity CLI generation in any root containing `.git`.
- [x] Preserve derived identity generation for git-free source exports.
- [ ] Execute `node --test tests/runtime-delivery/repository-source-identity-authority.test.js` and the existing derived-identity regressions.

### Task 6: Verification and review

- [ ] Run `npm run test:wp0`.
- [ ] Run `npm run verify:wp0:gate -- --branch rebuild/windows-release-closure-20260802-gate0-wp0-fix` with the trusted remote branch ref present.
- [ ] Run the focused runtime-delivery identity and LFS tests.
- [ ] Verify `tools/protocol/validate-v3-protocols.js` accepts the repository descriptor.
- [ ] Inspect the fresh GitHub Actions job log and record its run ID and conclusion.
- [ ] Keep PR #4 Draft until all fresh evidence is available; do not claim promotion or formal release readiness.
