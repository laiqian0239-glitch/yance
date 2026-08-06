# Yance UI Migration Prerequisites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the four bottom-layer capabilities required before the approved Yance UI migration can begin: root-agnostic UI authorization, deterministic dynamic current-main receipts, active-handoff decoupling, and base-owned execution gates.

**Architecture:** The prerequisite is delivered through two ordinary governance pull requests. A minimal exact-route bootstrap first registers only the future prerequisite paths in the existing base-owned routing policy. A single prerequisite capability branch is then created from that route merge and implements the static authorization package, receipt generator/verifier, and base-owned evaluator. That capability branch is reviewed and merged as governance infrastructure; it never uses the new UI policy to authorize itself. Only after the capability is present in `main` may the next plan create the approved 28-path UI-WP1 causal RED branch and its branch-time receipt.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, strict Git plumbing through `execFileSync`, UTF-8/LF deterministic JSON, NUL-framed path evidence, GitHub Actions, and the existing WP0 routing and delegated-authority infrastructure.

## Product and authority boundary

This plan implements governance/runtime-enablement infrastructure only. It must not add or change:

- Vue Product Shell source;
- Chatwoot, shadcn-vue or other upstream source copies;
- UI runtime dependencies;
- notification sounds or installer distribution;
- application data writers;
- translation or send behavior;
- identity merge, contact, relationship-memory or AI behavior;
- legacy/Vue cutover;
- production, release, publish or promotion authority.

The approved UI design snapshot remains the product design authority. This plan only makes that design executable without rebinding four documents every time `main` or `project-state/active-handoff` advances.

## Why two governance pull requests are required

A candidate branch cannot safely add both a new route and the new files that depend on that route, because the exact base-owned routing policy would not recognize candidate-owned route changes. Likewise, a candidate cannot rely on a policy module that exists only in its own tree to authorize itself.

Therefore:

1. **Route bootstrap PR:** modifies only already trusted routing-policy and routing-test paths. It registers a literal future path set and no implementation behavior.
2. **Prerequisite capability PR:** starts from the ordinary route-bootstrap merge. Every new path is already classified by the base-owned routing policy. The branch is validated as governance infrastructure by the existing gates, then merged ordinarily.
3. **Future UI-WP1 RED PR:** starts only after both prerequisite PRs are in `main`. Its receipt and scope are evaluated by policy code already owned by the pull-request base.

This is not a temporary bypass. It removes the bootstrap and self-trust cycle at the architecture boundary.

## Branch and commit topology

```text
fresh main after PR #90
  |
  +-- governance/ui-migration-prerequisite-routes
  |     -> test-only exact-route RED
  |     -> exact-route GREEN
  |     -> ordinary merge to main
  |
  +-- governance/ui-migration-prerequisites
        -> static package test-only RED
        -> static package GREEN
        -> policy test-only RED
        -> policy GREEN
        -> receipt test-only RED
        -> receipt generator/verifier GREEN
        -> base-owned gate test-only RED
        -> base-owned gate GREEN = reviewedCodeHead
        -> ordinary merge to main
```

No receipt for a product/UI implementation branch is checked in by this plan. Receipt generation is tested with immutable Git fixtures and real temporary repositories. The first real receipt is created by the next UI-WP1 RED plan from the then-current trusted `main`.

No amend, rebase, squash, force push or history rewrite is permitted.

## Exact future prerequisite paths

The route bootstrap registers exactly these new paths:

```text
governance/layered-ci/ui-wp1-root-agnostic-authorization.json
governance/ui-migration/ui-wp1-current-main-receipt.json
shared/release/uiMigrationWorkPackagePolicy.js
tests/layered-ci/ui-migration-base-owned-gate.test.js
tests/layered-ci/ui-migration-static-package.test.js
tests/ui-migration/ui-wp1-current-main-receipt.test.js
tests/wp0/ui-migration-work-package-authorization.test.js
tools/ui-migration/generate-ui-wp1-current-main-receipt.js
tools/ui-migration/verify-ui-wp1-current-main-receipt.js
```

The following four companion paths are already exact UI governance routes and remain unchanged as path identities:

```text
docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml
docs/ui-migration/UI_ASSET_BASELINE.json
docs/ui-migration/UI_WP1_AUTHORIZATION.md
docs/ui-migration/UPSTREAM_PINS.yaml
```

Existing files modified by the capability implementation are:

```text
.github/workflows/stage-6459-wp0-gates.yml
governance/layered-ci/wp0-routing-policy.json
shared/release/implementationBranchPolicy.js
tests/layered-ci/ui-product-shell-wp0-routing.test.js
tests/layered-ci/wp0-routing.test.js
tests/wp0/implementation-branch-policy.test.js
tools/wp0/work-package-scope-gate.js
```

Any need to change a path outside these sets must stop implementation and revise this plan before code changes continue.

---

## Task 0: Lock current refs and verify the approved design merge

**Files:** None.

**Step 1: Fetch exact remote refs**

```bash
git fetch --prune origin main design/unified-ui-open-source-migration-2026-08-06
git rev-parse refs/remotes/origin/main
git rev-parse refs/remotes/origin/design/unified-ui-open-source-migration-2026-08-06
```

Expected: two exact 40-character commits. Never copy a stale SHA from this plan.

**Step 2: Verify PR #90 was ordinarily merged**

```bash
gh pr view 90 --json state,mergedAt,mergeCommit,headRefOid,baseRefOid
```

Expected:

- `state` is `CLOSED`;
- `mergedAt` is non-null;
- `mergeCommit` is non-null;
- the merge commit has two parents in the expected order.

If PR #90 is not ordinarily merged, stop. The design branch itself grants no implementation authority.

**Step 3: Establish a clean baseline**

```bash
git worktree add ../yance-ui-route-bootstrap \
  -b governance/ui-migration-prerequisite-routes \
  refs/remotes/origin/main
cd ../yance-ui-route-bootstrap
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: clean baseline and existing routing contracts GREEN.

---

## Task 1: Create a test-only RED for exact prerequisite routes

**Files:**

- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`

**Step 1: Add exact-route contracts**

Require the base-owned route policy to classify each of the nine new prerequisite paths as governance scope and to preserve the existing four UI document routes.

The tests must also prove that these remain denied or product-routed:

- `governance/ui-migration/extra.json`;
- `shared/release/uiMigrationWorkPackagePolicy-copy.js`;
- `tools/ui-migration/arbitrary.js`;
- `tests/ui-migration/arbitrary.test.js`;
- any path accepted only through a prefix, glob, case fold or separator normalization.

The route set must contain no `governance/ui-migration/`, `tools/ui-migration/`, `tests/ui-migration/` or `shared/release/` wildcard/prefix expansion introduced for this work package.

**Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: only the new exact paths fail because the base routing policy does not yet list them. Syntax, discovery and infrastructure failures are invalid RED.

**Step 3: Commit tests only**

```bash
git add \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
git commit -m "test(wp0): require exact UI prerequisite routes"
```

---

## Task 2: Register the exact routes and merge the bootstrap PR

**Files:**

- Modify: `governance/layered-ci/wp0-routing-policy.json`
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`

**Step 1: Add the nine literal paths**

Add every new path from **Exact future prerequisite paths** individually. Do not add a directory prefix, glob, branch wildcard or generic UI exception.

The future receipt path is registered now but is not created on this branch.

**Step 2: Run focused routing tests**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: GREEN, including all negative near-match cases.

**Step 3: Run the existing governance matrix**

```bash
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
```

Expected: GREEN.

**Step 4: Commit the GREEN route change**

```bash
git add \
  governance/layered-ci/wp0-routing-policy.json \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
git commit -m "fix(wp0): register exact UI prerequisite routes"
```

**Step 5: Open, review and ordinarily merge the route PR**

The PR must contain exactly the three paths above. Require:

- exact Head verification;
- zero unresolved P0/P1 findings;
- no wildcard or prefix authority;
- ordinary two-parent merge;
- no Product Shell, receipt or prerequisite implementation files.

After merge:

```bash
git fetch --prune origin main
ROUTE_MERGE="$(git rev-parse refs/remotes/origin/main)"
git show --no-patch --format='%P' "${ROUTE_MERGE}"
```

Expected: the merge has two ordered parents and contains only the reviewed route PR delta.

---

## Task 3: Create the prerequisite capability branch from the route merge

**Files:** None.

**Step 1: Create a new isolated worktree**

```bash
cd ../yance
git worktree add ../yance-ui-prerequisites \
  -b governance/ui-migration-prerequisites \
  "${ROUTE_MERGE}"
cd ../yance-ui-prerequisites
test "$(git rev-parse HEAD)" = "${ROUTE_MERGE}"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

**Step 2: Verify all future paths are base-owned before creating them**

Run the routing evaluator or its exact tests against the route-merge base and prove every future path is already registered. A candidate-owned routing file may not be used for this assertion.

**Step 3: Run the baseline**

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
npm run test:wp0
```

Expected: GREEN before adding prerequisite behavior.

---

## Task 4: Define static-package and active-handoff causal RED

**Files:**

- Create: `tests/layered-ci/ui-migration-static-package.test.js`

**Step 1: Write static-package contracts**

Require exactly:

- document type `YANCE_UI_MIGRATION_ROOT_AGNOSTIC_AUTHORIZATION`;
- repository `laiqian0239-glitch/yance`;
- work package `UI-WP1`;
- the approved design snapshot path;
- the exact four companion document paths;
- immutable upstream commit/blob and local source-snapshot identities;
- exact future UI-WP1 RED branch name and 28-path set identity;
- exact Yance authority, single-writer and non-production closure fields;
- exact prerequisite implementation path set and digest;
- no executable current-main commit/tree, authorization parent or active-handoff identity.

The test must fail closed on:

- missing, duplicate, malformed, traversal, case-variant or separator-variant paths;
- a prefix/wildcard path authority;
- Product Shell, source copy, sound distribution, cutover, production, release, publish or automatic continuation set true;
- a changed upstream commit/blob without a matching reviewed static package;
- an `activeHandoffObserved`, `requiredActiveHandoff`, `activeHandoffCommit`, `baseCommit`, `baseTree` or `authorizationParent` field used as executable authority.

Historical observations may exist only under an `observations` object with `authoritative: false`; changing or deleting that object must not change authorization identity.

**Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js
```

Expected: failure only because the five static package files do not yet exist.

**Step 3: Commit the test only**

```bash
git add tests/layered-ci/ui-migration-static-package.test.js
git commit -m "test(ui): define root-agnostic static package contracts"
```

---

## Task 5: Create the root-agnostic static package

**Files:**

- Create: `docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml`
- Create: `docs/ui-migration/UI_ASSET_BASELINE.json`
- Create: `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- Create: `docs/ui-migration/UPSTREAM_PINS.yaml`
- Create: `governance/layered-ci/ui-wp1-root-agnostic-authorization.json`
- Modify: `tests/layered-ci/ui-migration-static-package.test.js`

**Step 1: Build from the approved design and reviewed source identities**

Use the approved design snapshot as the product/design source. Reuse only already reviewed exact upstream commits, blobs, versions and Yance source-snapshot identities from the prior UI authorization work.

Do not treat PR #65, PR #85 or their branch roots as current execution parents. They are historical source evidence only.

**Step 2: Remove executable root bindings**

The four companion documents and static authority must not require:

- a current `main` SHA or tree;
- `project-state/active-handoff` existence or SHA;
- an authorization branch parent;
- a workflow run ID;
- a candidate Head.

Where historical capture information is retained, place it under:

```json
{
  "observations": {
    "authoritative": false
  }
}
```

Equivalent YAML/Markdown forms are allowed only when tests prove they cannot affect execution identity or package digests.

**Step 3: Freeze exact static identities**

The authorization must include:

- exact four-document byte digests;
- one normalized authorization digest;
- one deterministic static package digest;
- exact 28-path future RED set digest;
- exact prerequisite capability path set digest;
- explicit denial of all implementation and production authorities not granted by this package.

Hash rules must be defined once in the static-package test and later implemented identically by the pure policy. Records use UTF-8 LF bytes, lexicographic path order, and `path + NUL + digest + "\n"` package framing.

**Step 4: Run the focused test**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js
```

Expected: GREEN.

**Step 5: Verify active-handoff independence**

```bash
git grep -nE \
  'activeHandoffObserved|requiredActiveHandoff|activeHandoffCommit|authorizationParent' \
  -- docs/ui-migration governance/layered-ci/ui-wp1-root-agnostic-authorization.json
```

Expected: no executable match. Any historical match must be explicitly non-authoritative and excluded from authorization digests by tests.

**Step 6: Commit the GREEN static package**

```bash
git add \
  docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml \
  docs/ui-migration/UI_ASSET_BASELINE.json \
  docs/ui-migration/UI_WP1_AUTHORIZATION.md \
  docs/ui-migration/UPSTREAM_PINS.yaml \
  governance/layered-ci/ui-wp1-root-agnostic-authorization.json \
  tests/layered-ci/ui-migration-static-package.test.js
git commit -m "docs(ui): freeze root-agnostic migration package"
```

---

## Task 6: Define causal RED for the pure UI migration policy

**Files:**

- Create: `tests/wp0/ui-migration-work-package-authorization.test.js`

**Step 1: Write policy contracts before the module exists**

The test imports:

```js
const policy = require('../../shared/release/uiMigrationWorkPackagePolicy');
```

Require focused exports:

```js
validateStaticAuthorization(document)
validateCurrentMainReceipt(document, context)
evaluateUiMigrationCandidate(input)
changedFileSetSha256(paths)
```

Contracts must prove:

- exact repository-path validation without lossy normalization;
- canonical path-set and package digests;
- static authority validation independent of active-handoff and current main;
- receipt validation requires trusted graph/file adapters;
- candidate-owned static authority or policy mutation cannot authorize itself;
- non-production closure fields are mandatory;
- results and normalized inputs are immutable;
- distinct reason codes exist for static identity, scope, receipt, graph and closure failure.

**Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: failure only because the module does not yet exist.

**Step 3: Commit test only**

```bash
git add tests/wp0/ui-migration-work-package-authorization.test.js
git commit -m "test(ui): define migration policy contracts"
```

---

## Task 7: Implement the pure policy

**Files:**

- Create: `shared/release/uiMigrationWorkPackagePolicy.js`
- Modify: `tests/wp0/ui-migration-work-package-authorization.test.js`
- Modify: `tests/layered-ci/ui-migration-static-package.test.js`

**Step 1: Implement validation primitives**

Requirements:

- CommonJS and no network access;
- dependency injection for Git graph and file evidence;
- exact UTF-8 repository paths;
- rejection of duplicate, malformed and normalization-dependent paths;
- deterministic SHA-256 helpers;
- no branch, prefix or wildcard expansion;
- immutable return values;
- no reading `project-state/active-handoff`.

**Step 2: Replace duplicated test hashing with the production helper**

The static-package test must use the same public deterministic digest functions, while retaining independent known-answer fixtures so a broken implementation cannot merely agree with itself.

**Step 3: Run RED-to-GREEN tests**

```bash
node --check shared/release/uiMigrationWorkPackagePolicy.js
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: GREEN.

**Step 4: Commit the implementation**

```bash
git add \
  shared/release/uiMigrationWorkPackagePolicy.js \
  tests/layered-ci/ui-migration-static-package.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
git commit -m "feat(ui): implement root-agnostic migration policy"
```

---

## Task 8: Define causal RED for deterministic current-main receipts

**Files:**

- Create: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Step 1: Write receipt contracts using temporary Git repositories**

The receipt must bind:

- document type `YANCE_UI_WP1_CURRENT_MAIN_RECEIPT`;
- repository and work package;
- exact future implementation branch;
- trusted base commit resolved when the branch is created;
- reviewed code Head;
- reviewed Head ancestry from trusted base;
- exact static authorization blob and file hash from the trusted base;
- exact implementation path count and digest excluding only the receipt path;
- exact companion static package digest;
- allowed post-review path set containing only the receipt path;
- all production/release/publish/promotion/automatic-next-package fields false.

Negative fixtures must reject:

- stale or fabricated base;
- wrong ancestry or merge-parent order;
- receipt self-reference;
- dirty worktree;
- wrong branch;
- candidate-owned static authority or policy;
- duplicate, invalid or widened path sets;
- an extra post-review commit or path;
- CRLF/platform-dependent receipt bytes;
- Git replacement/config/environment injection.

Changing active-handoff refs or observations in the temporary repository must not change generated receipt bytes.

**Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
```

Expected: failure only because generator and verifier modules do not yet exist.

**Step 3: Commit test only**

```bash
git add tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "test(ui): define dynamic current-main receipt contracts"
```

---

## Task 9: Implement deterministic receipt generation and verification

**Files:**

- Create: `tools/ui-migration/generate-ui-wp1-current-main-receipt.js`
- Create: `tools/ui-migration/verify-ui-wp1-current-main-receipt.js`
- Modify: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Step 1: Implement trusted Git adapters**

Use `execFileSync('git', args, options)` only, with:

- explicit repository root;
- `GIT_NO_REPLACE_OBJECTS=1`;
- `GIT_TERMINAL_PROMPT=0`;
- repository/object/config override variables stripped;
- bounded timeout and buffer;
- no shell interpolation;
- NUL-framed changed-file transport;
- fatal UTF-8 decoding.

**Step 2: Implement generation**

Required CLI:

```bash
node tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  --repository-root <path> \
  --base <trusted-main-sha> \
  --reviewed-head <reviewed-code-sha> \
  --branch <exact-implementation-branch> \
  --output <receipt-path>
```

Generation must be deterministic and must refuse:

- dirty worktrees;
- missing ancestry;
- altered trusted static authority;
- wrong branch identity;
- implementation paths outside the static authorization;
- receipt inclusion in its own implementation digest.

**Step 3: Implement verification**

Required CLI:

```bash
node tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  --check \
  --repository-root <path> \
  --receipt <path> \
  --base <trusted-main-sha> \
  --head <candidate-sha> \
  --branch <exact-implementation-branch>
```

`--check` regenerates in memory and compares exact UTF-8 LF bytes without rewriting the file.

**Step 4: Run tests**

```bash
node --check tools/ui-migration/generate-ui-wp1-current-main-receipt.js
node --check tools/ui-migration/verify-ui-wp1-current-main-receipt.js
node --test --test-concurrency=1 \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: GREEN on deterministic and adversarial fixtures.

**Step 5: Commit implementation**

```bash
git add \
  tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "feat(ui): implement deterministic current-main receipts"
```

Do not create `governance/ui-migration/ui-wp1-current-main-receipt.json` on this branch.

---

## Task 10: Define causal RED for the base-owned execution gate

**Files:**

- Create: `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`

**Step 1: Add workflow structure contracts**

Require the permanent workflow to:

- resolve exact pull-request base and Head;
- create or use a detached worktree at the exact base;
- execute UI static-authority and receipt semantics from the base-owned module;
- pass explicit implementation branch identity for detached checkout;
- execute the exact focused contract once and fail fast;
- reject candidate-owned verifier execution;
- reject broad test globs, duplicate invocation, `continue-on-error`, warning-only closure and shell suppression.

**Step 2: Add delegated-authority contracts**

Require the existing branch policy and scope gate to:

- recognize only the exact future UI-WP1 RED branch defined by the static package;
- verify static authority from the pull-request base, not the candidate;
- verify receipt bytes, trusted-base ancestry and exact path digest;
- exclude only the receipt path from implementation scope;
- deny arbitrary `feat/ui-*` and near-match branches;
- deny static authority, policy or workflow mutation by the future implementation branch;
- return `readyForPromotion: false`.

**Step 3: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
```

Expected: only the new base-owned gate contracts fail.

**Step 4: Commit test only**

```bash
git add \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
git commit -m "test(wp0): require base-owned UI migration gate"
```

---

## Task 11: Integrate the base-owned gate

**Files:**

- Modify: `.github/workflows/stage-6459-wp0-gates.yml`
- Modify: `shared/release/implementationBranchPolicy.js`
- Modify: `tools/wp0/work-package-scope-gate.js`
- Modify: `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`

**Step 1: Add one UI migration authority descriptor**

Extend the existing delegated-authority mechanism; do not create a parallel generic branch-authority registry.

The descriptor must point to the trusted static authorization path and exact future implementation branch. Runtime adapters must verify the static file from the pull-request base and its exact content identity.

**Step 2: Add isolated candidate evaluation**

In `tools/wp0/work-package-scope-gate.js`, add a focused UI path that:

- reads static authority and policy code from the base worktree;
- reads only candidate receipt and candidate changed-file evidence from the candidate tree;
- uses strict Buffer/NUL-framed Git evidence;
- verifies clean worktree, ancestry and exact branch;
- excludes exactly `governance/ui-migration/ui-wp1-current-main-receipt.json` from implementation scope;
- delegates semantics to `uiMigrationWorkPackagePolicy.js`;
- denies production and promotion.

**Step 3: Update the permanent workflow**

The workflow must execute the base-owned UI evaluator for applicable future branches. Candidate modifications to the workflow, policy, static authority or verifier must not alter the evaluator used for that run.

**Step 4: Run focused tests**

```bash
node --check shared/release/implementationBranchPolicy.js
node --check tools/wp0/work-package-scope-gate.js
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/layered-ci/wp0-routing.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/wp0/implementation-branch-policy.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
```

Expected: GREEN.

**Step 5: Run repository-level verification**

```bash
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
```

Expected: GREEN.

**Step 6: Commit the reviewed code Head**

```bash
git add \
  .github/workflows/stage-6459-wp0-gates.yml \
  shared/release/implementationBranchPolicy.js \
  tools/wp0/work-package-scope-gate.js \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
git commit -m "fix(wp0): execute base-owned UI migration policy"
```

Record this commit as `reviewedCodeHead`.

---

## Task 12: Complete hermetic Linux and Windows verification

**Files:** No planned changes. A discovered defect requires a new focused failing test before repair.

**Step 1: Verify Linux from a clean dependency install**

```bash
rm -rf node_modules
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Expected: GREEN and clean.

**Step 2: Verify Windows**

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 `
  tests/layered-ci/ui-migration-static-package.test.js `
  tests/layered-ci/ui-migration-base-owned-gate.test.js `
  tests/wp0/ui-migration-work-package-authorization.test.js `
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
if (git status --porcelain=v1 --untracked-files=all) { throw 'worktree is dirty' }
```

Expected: identical semantic result and deterministic receipt bytes.

**Step 3: Run mutation controls**

At minimum mutate temporary fixtures for:

- base SHA;
- branch name;
- static authority blob;
- companion package digest;
- duplicate implementation path;
- extra post-review path;
- candidate-owned verifier;
- Git replacement/config injection;
- active-handoff ref and observation.

Expected: every authority mutation fails. Active-handoff ref/observation mutation does not change authorization or receipt bytes.

---

## Task 13: Review and ordinarily merge the prerequisite capability

**Files:** PR metadata only unless a real defect is found.

**Step 1: Open one prerequisite capability PR**

The PR must identify:

- exact route-bootstrap merge base;
- every test-only RED Head and its causal failure;
- reviewed code Head;
- exact changed-file set and digest;
- Linux and Windows results;
- confirmation that no real current-main receipt was created;
- confirmation that no Product Shell/source copy/distribution/cutover authority exists.

**Step 2: Require independent review**

Review must verify:

- the branch was routed by the pre-existing base policy;
- it did not use the new UI policy to authorize itself;
- static documents contain no executable current-main or active-handoff binding;
- receipt generation is deterministic and non-self-referential;
- the permanent evaluator reads policy and static authority from the PR base;
- only the future candidate receipt and changed-file facts come from the candidate;
- all routes and branch identities are exact;
- no hidden UI implementation exists.

All P0/P1 findings and unresolved threads must be zero before merge.

**Step 3: Fresh ref lock**

```bash
git fetch --prune origin main governance/ui-migration-prerequisites
test "$(git rev-parse HEAD)" = \
  "$(git rev-parse refs/remotes/origin/governance/ui-migration-prerequisites)"
git merge-base --is-ancestor refs/remotes/origin/main HEAD
```

If `main` changed a relevant routing, authority or gate path, merge fresh main ordinarily into the branch and rerun the full matrix. Do not rebase or force-update.

**Step 4: Merge ordinarily after explicit user approval**

Use an ordinary two-parent merge commit. Squash and rebase are forbidden.

**Step 5: Verify merged main**

Run the focused contracts and the permanent WP0 suite on the exact merge commit. Confirm the policy and static authority are now base-owned for subsequent pull requests.

**Step 6: Close superseded historical UI authorization PRs**

After merged-main verification, close PR #65 and PR #85 unmerged as superseded historical evidence. Do not delete their history or treat them as implementation parents.

---

## Task 14: Stop at the prerequisite boundary

This plan ends when the prerequisite capability is verified on `main`.

The next plan creates the approved 28-path causal RED package on one implementation branch. That next RED package covers:

- preserved theme/settings/sound identities;
- bilingual message and composer contracts;
- left/right dock state machines;
- unified multi-platform conversation center;
- explicit surface-state labels;
- crash/restart behavior;
- DPI, keyboard and accessibility behavior.

No Product Shell GREEN source, Chatwoot source copy, sound distribution or business integration begins until the next RED package is reviewed and authorized.

## Definition of done

The prerequisite is complete only when:

- PR #90 is ordinarily merged;
- the exact-route bootstrap is ordinarily merged before any new prerequisite path is created;
- one static root-agnostic authorization package exists in `main`;
- no executable current-main or active-handoff SHA exists in that static package;
- active-handoff changes cannot change static authorization or receipt bytes;
- deterministic receipt generation and verification pass real temporary-repository tests on Linux and Windows;
- candidate-owned policy, static authority, verifier and workflow changes cannot authorize a future candidate;
- permanent WP0 evaluates applicable future UI branches using policy and authority from the exact PR base;
- all routes, paths and branches are literal and fail closed on near matches;
- full WP0, security and protocol suites are GREEN;
- the prerequisite capability PR merges ordinarily with no force push or history rewrite;
- no UI implementation, source copy, distribution, cutover, production, release, publish or promotion authority has been granted.