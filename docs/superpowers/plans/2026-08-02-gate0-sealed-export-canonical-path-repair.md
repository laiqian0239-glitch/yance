# Gate 0 Sealed Export Canonical Path Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `GATE0-SEALED-EXPORT-CANONICAL-PATH` by making the shared sealed-export authority evaluate one physical root, reject root links/reparse points, isolate Git discovery from inherited `GIT_*` state, and verify Linux and Windows behavior.

**Architecture:** `assertSealedExportRoot()` remains the only API/CLI authority. It must lstat the caller path, reject a root symbolic link or Windows junction, resolve one canonical physical root, and use that root for ancestor scanning, nested metadata scanning, Git probing, payload traversal, hashing, and identity writes. Git subprocesses receive a clean environment with inherited `GIT_*` variables removed.

**Tech Stack:** Node.js 22 CommonJS, `node:test`, `node:fs`, Git CLI, GitHub Actions Ubuntu and Windows runners.

## Global Constraints

- No caller-side bypass, allowlist, warning-only path, or test exemption.
- No production-code change before a failing regression is committed and observed.
- Root symlink and Windows junction/reparse-point roots are rejected fail-closed.
- Every scan, Git probe, payload walk, hash, and generated identity path uses the canonical physical root returned by the shared authority.
- Inherited environment keys matching `/^GIT_/iu` must not affect repository discovery.
- PR #4 remains Draft; `gate1MayStart=false`; WP-A remains forbidden.

---

### Task 1: Add adversarial RED regressions

**Files:**
- Modify: `tests/runtime-delivery/repository-source-identity-authority.test.js`

**Interfaces:**
- Consumes: `delivery.createDerivedSourceIdentity(root, options)` and `assertSealedExportRoot(root)`.
- Produces: failing coverage for root links, physical canonicalization, and inherited Git environment isolation.

- [ ] **Step 1: Replace the old inherited `GIT_DIR` expectation**

A Git-free physical export must remain Git-free when the parent process supplies `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES`, or lowercase equivalents. The CLI must succeed and produce `YANCE_DERIVED_SOURCE_IDENTITY.json`.

- [ ] **Step 2: Add root link rejection**

Create a real directory and a root alias with:

```js
fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
```

Call the public API and require:

```js
error.reasonCode === 'SOURCE_UAT_DERIVED_IDENTITY_ROOT_LINK_FORBIDDEN'
error.details.relation === 'ROOT_SYMBOLIC_LINK_OR_REPARSE_POINT'
```

- [ ] **Step 3: Add the original bypass reproduction**

Point a root link/junction at a Git worktree and launch the CLI with a poisoned `GIT_CEILING_DIRECTORIES`. The result must still be the root-link rejection above.

- [ ] **Step 4: Add canonical physical-root behavior**

Reach a normal export directory through a linked parent component. `assertSealedExportRoot()` must return `fs.realpathSync.native(input)` and the generated descriptor and identity must exist under that canonical root.

- [ ] **Step 5: Commit RED and verify remotely**

Run through the existing PR workflow. Expected failure is in `repository-source-identity-authority.test.js` because current code follows root links, preserves inherited `GIT_*`, and returns the logical path.

### Task 2: Refactor the shared sealed-export authority

**Files:**
- Modify: `tools/runtime-delivery/sealed-export-authority.js`

**Interfaces:**
- Produces: `sanitizeGitEnvironment(sourceEnv)`, `canonicalizeSealedExportRoot(value)`, and the existing `assertSealedExportRoot(value)` returning the canonical physical root.

- [ ] **Step 1: Add environment isolation**

```js
function sanitizeGitEnvironment(sourceEnv = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(sourceEnv || {})) {
    if (/^GIT_/iu.test(key)) continue;
    if (value != null) environment[key] = String(value);
  }
  environment.LC_ALL = 'C';
  environment.LANG = 'C';
  return environment;
}
```

`gitRepositoryContext()` must use only this result and must not merge an unsanitized `options.env` afterward.

- [ ] **Step 2: Add canonical root resolution**

Use `fs.lstatSync(logicalRoot)` before `fs.statSync`. Reject `lstat.isSymbolicLink()` with `SOURCE_UAT_DERIVED_IDENTITY_ROOT_LINK_FORBIDDEN`. Resolve with `fs.realpathSync.native(logicalRoot)` and validate the canonical target is a directory.

- [ ] **Step 3: Use the canonical root everywhere**

Pass only the canonical root to `existingGitMetadataInAncestors`, `gitRepositoryContext`, and `embeddedGitMetadata`; include both `logicalRoot` and `canonicalRoot` in structured errors; return `canonicalRoot`.

- [ ] **Step 4: Preserve fail-closed probe handling**

Only Git exit status 128 with the canonical `not a git repository` message is a clean negative. Other failures remain `SOURCE_UAT_DERIVED_IDENTITY_GIT_PROBE_FAILED` or are wrapped as Git-root forbidden when physical ancestor metadata is present.

- [ ] **Step 5: Commit GREEN candidate**

Commit only the shared authority change after the RED run has been captured.

### Task 3: Add Linux/Windows executable matrix

**Files:**
- Modify: `.github/workflows/stage-6459-wp0-gates.yml`

**Interfaces:**
- Produces: a platform matrix that executes the same public API/CLI regressions on `ubuntu-latest` and `windows-latest`.

- [ ] **Step 1: Add `sealed-export-platform-matrix` job**

Checkout the reviewed head, set up Node 22, and run:

```text
node --test --test-concurrency=1 tests/runtime-delivery/repository-source-identity-authority.test.js
```

Use a two-OS matrix. Do not download Electron LFS in this focused job.

- [ ] **Step 2: Run the full existing WP0 job unchanged**

The original Ubuntu gate remains authoritative for WP0 tests, secret scanning, LFS integrity, source identity regressions, protocol validation, and local-equivalent gate execution.

### Task 4: Verify and close governance blocker

**Files:**
- Create: `docs/architecture/GATE0_SEALED_EXPORT_CANONICAL_PATH_REPAIR_REVIEW_ZH.md`
- Modify: `governance/yance-architecture-closure-v2-freeze.json`

**Interfaces:**
- Produces: independent source-review evidence and machine-readable blocker status.

- [ ] **Step 1: Verify RED and GREEN workflow evidence**

Record the RED head/run/job and expected failing assertions, then the GREEN head/run/jobs and exact conclusions for both operating systems.

- [ ] **Step 2: Independently review the final diff**

Confirm no caller bypass, every path-sensitive operation consumes the canonical root, inherited `GIT_*` is removed case-insensitively, root links fail before mutation, and the Windows job exercises a real junction.

- [ ] **Step 3: Close only this blocker**

Set `GATE0-SEALED-EXPORT-CANONICAL-PATH` to `CLOSED` only after all jobs pass and independent source review approves. Keep PR Draft and all release/Gate 1 flags false.

- [ ] **Step 4: Update PR review record**

Post commits, workflow IDs, test evidence, source-review conclusion, and the newly authorized next stage. Do not claim production readiness.
