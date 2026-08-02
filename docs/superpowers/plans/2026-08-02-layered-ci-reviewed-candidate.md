# Reviewed Candidate and Layered CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed reviewed-candidate identity gate for A6 and introduce A7+ task lifecycle plus L0–L3 layered CI without modifying PR #5.

**Architecture:** A pure Node.js policy library validates machine-readable manifests and Git graph facts through an injected Git adapter. Separate policy modules classify changed paths into CI levels and validate lifecycle transitions. GitHub Actions workflows consume these modules, while the A6 workflow checks out the exact reviewed commit after independently validating its relationship to the current authorized branch tip.

**Tech Stack:** Node.js 22, `node:test`, Git, GitHub Actions YAML, JSON governance manifests.

## Global Constraints

- Do not modify, merge, rebase, or move PR #5 or its branch.
- PR #5 Head remains `e877aec9e16663296e632c224a1da3b7892f1f2b`.
- Reviewed Head remains `3684dbd840faec8d6e732b0b68eae25f1ad9b2b3`.
- Governance Base remains `d81599d8a3f3de891da369b6f1ddbd01e264c78d`.
- Reviewed changed-file count remains `83`.
- Reviewed changed-file set SHA-256 remains `d2cac11bd6864b02e09fa68015dbdba5c41bb2777bf79e821f00a846b651702a`.
- Post-review commit set is exactly `e877aec9e16663296e632c224a1da3b7892f1f2b` and is evidence-only.
- All authorization is exact; wildcard post-review paths are forbidden.
- `readyForPromotion` remains false.
- Production behavior is implemented only after a failing test is observed.

---

### Task 1: Reviewed-candidate contract RED

**Files:**
- Create: `tests/layered-ci/reviewed-candidate.test.js`
- Create: `governance/layered-ci/reviewed-candidate-a6.json`

**Interfaces:**
- Consumes: CommonJS module path `tools/layered-ci/reviewed-candidate.js`.
- Produces: expected API `validateManifest(manifest)` and `evaluateReviewedCandidate({ manifest, git })`.

- [ ] **Step 1: Write failing tests**

Tests must require the missing production module and cover:

```js
const {
  validateManifest,
  evaluateReviewedCandidate
} = require('../../tools/layered-ci/reviewed-candidate');
```

Required behaviors:

```js
assert.equal(validateManifest(validManifest).pass, true);
assert.equal(validateManifest({ ...validManifest, allowedPostReviewPaths: ['governance/**'] }).pass, false);
assert.equal(evaluateReviewedCandidate({ manifest: validManifest, git: validGit }).pass, true);
assert.equal(evaluateReviewedCandidate({ manifest: validManifest, git: driftingRemoteGit }).reasonCode, 'BRANCH_TIP_MISMATCH');
assert.equal(evaluateReviewedCandidate({ manifest: validManifest, git: changedScopeGit }).reasonCode, 'REVIEWED_SCOPE_MISMATCH');
assert.equal(evaluateReviewedCandidate({ manifest: validManifest, git: extraCommitGit }).reasonCode, 'POST_REVIEW_COMMIT_MISMATCH');
assert.equal(evaluateReviewedCandidate({ manifest: validManifest, git: extraPathGit }).reasonCode, 'POST_REVIEW_PATH_MISMATCH');
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test --test-concurrency=1 tests/layered-ci/reviewed-candidate.test.js
```

Expected: FAIL because `tools/layered-ci/reviewed-candidate.js` does not exist.

- [ ] **Step 3: Commit RED**

```bash
git add tests/layered-ci/reviewed-candidate.test.js governance/layered-ci/reviewed-candidate-a6.json
git commit -m "test: define reviewed candidate fail-closed contract"
```

### Task 2: Reviewed-candidate implementation GREEN

**Files:**
- Create: `tools/layered-ci/reviewed-candidate.js`
- Create: `tools/layered-ci/verify-reviewed-candidate.js`

**Interfaces:**
- Consumes: manifest JSON and a Git adapter `(args: string[]) => string`.
- Produces:
  - `validateManifest(manifest): { pass: boolean, reasonCode: string|null }`
  - `evaluateReviewedCandidate({ manifest, git }): object`
  - CLI JSON output and exit code 1 on failure.

- [ ] **Step 1: Implement strict manifest validation**

Require schema version 1, exact repository and PR, exact SHA format, exact allowed classifications, exact path syntax, no wildcard characters, no duplicates, and `readyForPromotion === false`.

- [ ] **Step 2: Implement Git graph checks**

Execute through the injected adapter:

```js
git(['cat-file', '-e', `${sha}^{commit}`]);
git(['merge-base', '--is-ancestor', governanceBase, reviewedHead]);
git(['merge-base', '--is-ancestor', reviewedHead, branchTip]);
git(['rev-parse', `refs/remotes/origin/${authorizedBranch}`]);
git(['diff', '--name-only', governanceBase, reviewedHead]);
git(['rev-list', '--reverse', `${reviewedHead}..${branchTip}`]);
git(['diff', '--name-only', reviewedHead, branchTip]);
```

Compute the reviewed file digest as SHA-256 over sorted unique paths joined by `\n` plus a trailing newline.

- [ ] **Step 3: Verify GREEN**

```bash
node --test --test-concurrency=1 tests/layered-ci/reviewed-candidate.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit GREEN**

```bash
git add tools/layered-ci/reviewed-candidate.js tools/layered-ci/verify-reviewed-candidate.js
git commit -m "feat: validate reviewed candidate identity and scope"
```

### Task 3: Lifecycle and risk policy RED/GREEN

**Files:**
- Create: `governance/layered-ci/task-lifecycle.json`
- Create: `governance/layered-ci/risk-policy.json`
- Create: `tests/layered-ci/governance-policy.test.js`
- Create: `tools/layered-ci/governance-policy.js`
- Create: `tools/layered-ci/select-ci-level.js`

**Interfaces:**
- Produces:
  - `validateLifecyclePolicy(policy)`
  - `validateTransition(policy, from, to, context)`
  - `classifyChangedFiles(policy, changedFiles)` returning `{ requiredLevel, reasons }`.

- [ ] **Step 1: Write failing tests**

Test the exact lifecycle chain, reject direct `GREEN_PROVISIONAL → CLOSED`, allow `INDEPENDENT_REVIEW → CLOSED` only with independent review and L2 evidence, reject wildcard policy entries, and upgrade SQLite/runtime/workflow/WP0/package paths to L2.

- [ ] **Step 2: Verify RED**

```bash
node --test --test-concurrency=1 tests/layered-ci/governance-policy.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal policy functions and CLI**

The CLI reads newline-delimited paths from stdin or `--files`, prints JSON, and writes `required_level` to `GITHUB_OUTPUT` when present.

- [ ] **Step 4: Verify GREEN**

```bash
node --test --test-concurrency=1 tests/layered-ci/governance-policy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add governance/layered-ci tests/layered-ci/governance-policy.test.js tools/layered-ci/governance-policy.js tools/layered-ci/select-ci-level.js
git commit -m "feat: add lifecycle and layered CI risk policy"
```

### Task 4: L0 and A6 candidate workflows

**Files:**
- Create: `.github/workflows/layered-ci-fast.yml`
- Create: `.github/workflows/reviewed-candidate-a6.yml`

**Interfaces:**
- `layered-ci-fast.yml` emits independent checks `layered-ci-policy` and `layered-ci-risk`.
- `reviewed-candidate-a6.yml` emits `a6-reviewed-candidate-identity` and `a6-reviewed-wp0`.

- [ ] **Step 1: Add L0 workflow**

Use full history checkout, Node 22, run both test files, compute changed files against PR base, and invoke `select-ci-level.js`.

- [ ] **Step 2: Add A6 workflow**

On pull requests changing `governance/layered-ci/**`, `tools/layered-ci/**`, or this workflow:

1. checkout the governance PR branch with full history;
2. fetch `acv2/wp-a-identity-ledger-write-host` into trusted `refs/remotes/origin/...`;
3. run `verify-reviewed-candidate.js`;
4. checkout exact reviewed Head;
5. run the WP0 required tests and scope tests that do not reintroduce the old `reviewedHead == branchTip` assertion;
6. keep source-closure outside the A6 closure check;
7. never set promotion or release flags.

- [ ] **Step 3: Commit workflows**

```bash
git add .github/workflows/layered-ci-fast.yml .github/workflows/reviewed-candidate-a6.yml
git commit -m "ci: add fast feedback and A6 reviewed candidate gates"
```

### Task 5: L1–L3 workflow structure

**Files:**
- Create: `.github/workflows/layered-ci-task.yml`
- Create: `.github/workflows/layered-ci-promotion.yml`

**Interfaces:**
- L1/L2 workflow_dispatch inputs: `candidate_sha`, `required_level`, `task_test_command`.
- L3 inputs: exact commit and tree; publishing remains disabled.

- [ ] **Step 1: Implement L1/L2 workflow**

Validate SHA format and object existence. Run Ubuntu task tests for L1. For L2, run Ubuntu and Windows jobs plus WP0/legacy regressions. Reject arbitrary shell injection by accepting an enum of predefined suite identifiers instead of a raw command.

- [ ] **Step 2: Implement L3 workflow**

Require exact commit and tree, verify both, run promotion verification only, and hard-code `publish=false` behavior.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/layered-ci-task.yml .github/workflows/layered-ci-promotion.yml
git commit -m "ci: add task, work-package, and promotion layers"
```

### Task 6: Verification and Draft PR

**Files:**
- Modify only if test evidence requires correction; do not touch PR #5 files.

- [ ] **Step 1: Run local deterministic tests**

```bash
node --test --test-concurrency=1 tests/layered-ci/*.test.js
```

Expected: all pass.

- [ ] **Step 2: Verify manifest against the real repository graph**

```bash
git fetch --no-tags origin acv2/wp-a-identity-ledger-write-host:refs/remotes/origin/acv2/wp-a-identity-ledger-write-host
git fetch --no-tags origin 3684dbd840faec8d6e732b0b68eae25f1ad9b2b3
git fetch --no-tags origin d81599d8a3f3de891da369b6f1ddbd01e264c78d
node tools/layered-ci/verify-reviewed-candidate.js governance/layered-ci/reviewed-candidate-a6.json
```

Expected: PASS.

- [ ] **Step 3: Create Draft PR**

Title:

```text
治理：A6 可信候选身份门禁与 A7+ 分层 CI
```

Body must preserve:

```text
PR #5 untouched
A6.closed=false
readyForPromotion=false
formalRelease=false
```

- [ ] **Step 4: Observe Actions and fix only root causes**

Do not disable, skip, soften, or mark failing checks optional. Fix implementation or workflow identity at the source.

- [ ] **Step 5: Final verification**

Confirm the new PR is Draft and unmerged, PR #5 remains Draft and unchanged, and report all workflow run/job IDs and conclusions.