# PR #2 WP0 Gate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Stage 6.4.5.9 WP0 failures without disabling checks, broadening authorized implementation branches, or suppressing active release-surface violations.

**Architecture:** The portable repository does not contain the original provenance commit `c150182219edea2faf49c714275e9921a21df742`, so it cannot truthfully create or verify a live annotated tag that peels to that absent object. The rejected decision is anchored to an immutable commit and blob that do exist in this repository, while the original commit remains provenance metadata. Historical audit delivery classification is policy-driven and narrow, PR branch identity is bound to a fetched remote branch tip, and derived payload identity is generated only in a git-free sealed export.

**Evidence rule:** This tracked document deliberately does not embed the final branch HEAD or its workflow run ID. Embedding either value would mutate the source tree and invalidate the identity it claims to record. The authoritative final HEAD and its successful workflow run are recorded in PR #4 metadata after the final source commit, without changing the branch tree.

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
- [x] Execute the WP0 test suite containing `forbidden-hotfix-entrypoints.test.js`; remote result: PASS.

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
- [x] Execute the WP0 test suite containing `freeze-rejected-baseline.test.js`; remote result: PASS.

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
- [x] Confirm fresh GitHub Actions execution succeeds for the reviewed branch HEAD.

### Task 4: Electron archive tracking authority

**Files:**
- Create: `tests/runtime-delivery/electron-archive-tracking-authority.test.js`
- Modify: `.gitignore`
- Verify: `.gitattributes`

- [x] Add the narrow `!vendor/electron/*.zip` ignore exception.
- [x] Keep unrelated ZIP files ignored.
- [x] Require `filter=lfs diff=lfs merge=lfs -text` through `git check-attr`.
- [x] Seed the previously missing remote LFS object only after verifying the official archive SHA-256 and byte size.
- [x] Remove the one-time write-enabled seeding workflow after the object was proven remotely retrievable.
- [x] Execute the focused Electron tracking regression; remote result: PASS.

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
- [x] Execute repository identity and existing export-derived identity regressions; remote result: PASS.

### Task 6: Verification and review

- [x] Run `npm run test:wp0`: 13 passed, 0 failed.
- [x] Run `npm run verify:wp0:gate -- --branch rebuild/windows-release-closure-20260802-gate0-wp0-fix`: 4/4 checks passed.
- [x] Run focused runtime-delivery identity, LFS, and export tests: 10 passed, 0 failed.
- [x] Verify `tools/protocol/validate-v3-protocols.js`: `protocols=PASS`.
- [x] Verify the remote Electron LFS object: SHA-256 `d75c0057fd58c08023ff82ed9dd38443f90b4a962c9a9359aa74d9070f4add34`, size `136644393` bytes, clean Git status after smudge.
- [x] Verify repository release-surface violations: 0.
- [x] Keep PR #4 Draft; do not claim Gate 1 authorization, promotion readiness, candidate package generation, or formal release readiness.

## Required final state

```text
wp0Tests=13/13 PASS
focusedIdentityLfsExportTests=10/10 PASS
protocols=PASS
executableWp0Gate=4/4 PASS
repositoryReleaseSurfaceViolations=0
prState=DRAFT
gate1MayStart=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```
