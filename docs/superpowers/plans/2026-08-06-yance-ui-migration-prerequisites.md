# Yance UI Migration Prerequisites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the four structural blockers that currently force every Yance UI authorization package to be rebuilt whenever `main` or `project-state/active-handoff` advances: provide root-agnostic UI authorization, a deterministic dynamic current-main receipt, active-handoff decoupling, and base-owned execution gates.

**Architecture:** Keep the reviewed UI product design and immutable asset/upstream identities static, while moving branch-time identities into one deterministic receipt generated from Git history. A pure CommonJS policy validates the static authority and receipt without network access. The permanent WP0 workflow evaluates candidate scope using the exact pull-request base worktree, so candidate-owned policy cannot authorize itself. The implementation uses one branch and ordinary checkpoint commits: test-only RED, bottom-layer GREEN, receipt-only final metadata.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, Git plumbing with NUL-framed path evidence, JSON/YAML governance documents, GitHub Actions, existing WP0 route and work-package scope infrastructure.

## Scope and non-scope

This plan may establish only the four prerequisite capabilities required by the approved design snapshot.

It must not add:

- Vue Product Shell source;
- Chatwoot, shadcn-vue or other upstream source copies;
- dependencies for the future UI renderer;
- sound redistribution or installer inclusion;
- business-state writers, send behavior, translation behavior or data migration;
- legacy/Vue cutover;
- production, release, publish or promotion authority.

The future Product Shell and the 28-path causal RED package require separate plans and separate authorization after this prerequisite closes.

## Target branch and checkpoint topology

After PR #90 is ordinarily merged, create exactly one implementation branch from the freshly resolved `main`:

```text
feat/ui-migration-prerequisites
```

Commit topology:

```text
fresh trusted main
  -> test-only root-agnostic authorization RED
  -> root-agnostic authorization GREEN
  -> test-only dynamic receipt RED
  -> deterministic receipt GREEN
  -> test-only active-handoff decoupling RED
  -> static companion document refactor GREEN
  -> test-only base-owned gate RED
  -> base-owned gate GREEN = reviewedCodeHead
  -> receipt-only final metadata commit = exact branch tip
```

No amend, rebase, squash, force push or history rewrite is permitted.

## Planned repository paths

### New static authority and policy

- `governance/ui-migration/ui-wp1-root-agnostic-authorization.json`
- `shared/release/uiMigrationWorkPackagePolicy.js`
- `tests/wp0/ui-migration-work-package-authorization.test.js`

### New dynamic receipt implementation

- `governance/ui-migration/ui-wp1-current-main-receipt.json`
- `tools/ui-migration/generate-ui-wp1-current-main-receipt.js`
- `tools/ui-migration/verify-ui-wp1-current-main-receipt.js`
- `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

### Existing frozen companion documents to refactor

- `docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml`
- `docs/ui-migration/UI_ASSET_BASELINE.json`
- `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- `docs/ui-migration/UPSTREAM_PINS.yaml`

### Base-owned gate integration

- `.github/workflows/stage-6459-wp0-gates.yml`
- `governance/layered-ci/wp0-routing-policy.json`
- `shared/release/implementationBranchPolicy.js`
- `tools/wp0/work-package-scope-gate.js`
- `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- `tests/layered-ci/wp0-routing.test.js`
- `tests/wp0/implementation-branch-policy.test.js`

Any implementation need outside this set must stop and revise this plan before changing code.

---

## Task 0: Lock fresh refs and create an isolated worktree

**Files:** None.

**Step 1: Read exact remote refs**

```bash
git fetch --prune origin main design/unified-ui-open-source-migration-2026-08-06
git rev-parse refs/remotes/origin/main
git rev-parse refs/remotes/origin/design/unified-ui-open-source-migration-2026-08-06
```

Expected: both commands return exact 40-character commits. Record the values in the PR description; do not copy a stale SHA from this plan.

**Step 2: Confirm PR #90 is merged before implementation begins**

```bash
gh pr view 90 --json state,mergedAt,mergeCommit,headRefOid,baseRefOid
```

Expected: `state=CLOSED`, non-null `mergedAt`, and an ordinary merge commit on `main`. If not merged, stop; this plan itself grants no implementation authority.

**Step 3: Create one isolated worktree and branch**

```bash
git worktree add ../yance-ui-migration-prerequisites \
  -b feat/ui-migration-prerequisites \
  refs/remotes/origin/main
cd ../yance-ui-migration-prerequisites
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Expected: clean worktree exactly at fresh remote `main`.

**Step 4: Establish the local baseline**

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 tests/layered-ci/ui-product-shell-wp0-routing.test.js
npm run test:wp0
```

Expected: existing tests pass before new contracts are added. Infrastructure failure is not a RED and must be repaired separately.

---

## Task 1: Define causal RED for root-agnostic UI authorization

**Files:**

- Create: `tests/wp0/ui-migration-work-package-authorization.test.js`

**Step 1: Write the static-authority contracts**

The test must require all of the following:

- exact document type `YANCE_UI_MIGRATION_ROOT_AGNOSTIC_AUTHORIZATION`;
- repository `laiqian0239-glitch/yance` and work package `UI-WP1`;
- exact immutable companion paths and package digests;
- no executable `base.commit`, `base.tree`, `authorizationParent`, `activeHandoffObserved` or workflow-run identity;
- no branch prefix, wildcard or generic `docs/ui-migration/` authority;
- explicit denial of Product Shell implementation, source copy, sound distribution, cutover, production, release, publish and automatic continuation;
- malformed, duplicate, case-variant and traversal paths fail closed;
- a candidate-owned replacement authority cannot validate itself.

The initial test may import the not-yet-existing module:

```js
const policy = require('../../shared/release/uiMigrationWorkPackagePolicy');
```

**Step 2: Run the focused test and verify causal RED**

```bash
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: failure only because the policy/static authority does not yet exist. Syntax errors, missing test discovery or unrelated failures are invalid RED.

**Step 3: Commit test only**

```bash
git add tests/wp0/ui-migration-work-package-authorization.test.js
git commit -m "test(ui): define root-agnostic authorization contracts"
```

---

## Task 2: Implement the root-agnostic authority and pure policy

**Files:**

- Create: `governance/ui-migration/ui-wp1-root-agnostic-authorization.json`
- Create: `shared/release/uiMigrationWorkPackagePolicy.js`
- Modify: `tests/wp0/ui-migration-work-package-authorization.test.js`

**Step 1: Create the static authority**

The authority must contain only stable identities:

- immutable design/spec path;
- exact companion document paths;
- content digests and upstream identities;
- authorized future 28-path RED set identity;
- required single-writer and Yance-authority boundaries;
- prohibited actions.

It must not name a current `main` commit/tree or active-handoff commit.

**Step 2: Implement the pure policy**

Export focused functions such as:

```js
validateUiMigrationAuthorization(document)
validateUiMigrationReceipt(document, context)
evaluateUiMigrationScope(input)
changedFileSetSha256(paths)
```

Requirements:

- no network access;
- dependency injection for graph and file evidence;
- exact repository-path validation without lossy normalization;
- canonical sorted path-set digest;
- immutable result objects;
- distinct reason codes for authority identity, scope, receipt, graph and closure failures.

**Step 3: Run focused RED-to-GREEN tests**

```bash
node --check shared/release/uiMigrationWorkPackagePolicy.js
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: all root-agnostic authorization contracts pass.

**Step 4: Run related regressions**

```bash
node --test --test-concurrency=1 \
  tests/wp0/implementation-branch-policy.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: existing delegated-authority and exact-route behavior remains GREEN.

**Step 5: Commit implementation**

```bash
git add \
  governance/ui-migration/ui-wp1-root-agnostic-authorization.json \
  shared/release/uiMigrationWorkPackagePolicy.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
git commit -m "feat(ui): implement root-agnostic migration authority"
```

---

## Task 3: Define causal RED for the dynamic current-main receipt

**Files:**

- Create: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Step 1: Write deterministic receipt contracts**

The receipt shape must bind:

- exact repository/work package/document type;
- exact implementation branch;
- exact trusted `main` base commit resolved at branch creation;
- exact reviewed code Head;
- reviewed Head ancestry from trusted base;
- static authorization introduction merge, original blob and file hash;
- exact implementation paths/count/digest excluding only the receipt path;
- exact companion package digests;
- allowed post-review path set containing only the receipt;
- all production/release/publish/promotion/automatic-next-package fields false.

Negative contracts must reject:

- stale or fabricated base;
- wrong ancestry or parent order;
- receipt self-reference;
- duplicate, invalid or widened path sets;
- manual receipt drift;
- wrong branch;
- candidate-owned static authority;
- extra post-review commit/path.

**Step 2: Run the focused test and verify causal RED**

```bash
node --test --test-concurrency=1 \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
```

Expected: failure only because the generator/verifier is absent.

**Step 3: Commit test only**

```bash
git add tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "test(ui): define dynamic current-main receipt contracts"
```

---

## Task 4: Implement deterministic receipt generation and verification

**Files:**

- Create: `tools/ui-migration/generate-ui-wp1-current-main-receipt.js`
- Create: `tools/ui-migration/verify-ui-wp1-current-main-receipt.js`
- Modify: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Step 1: Implement trusted Git adapters**

Use `execFileSync('git', args, ...)` with:

- an explicit repository root;
- stripped repository/object replacement/config override variables;
- `GIT_NO_REPLACE_OBJECTS=1`;
- `GIT_TERMINAL_PROMPT=0`;
- bounded timeout and buffer;
- NUL-framed changed-file transport;
- fatal UTF-8 decoding;
- no shell interpolation.

**Step 2: Implement deterministic generation**

Required CLI behavior:

```bash
node tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  --base <trusted-main-sha> \
  --reviewed-head <reviewed-code-sha> \
  --branch feat/ui-migration-prerequisites \
  --output <path>
```

Generation must be byte-deterministic for identical Git inputs. It must refuse dirty worktrees, missing ancestry, changed static authority, invalid branch identity and any implementation path outside the approved set.

**Step 3: Implement strict verification**

Required CLI behavior:

```bash
node tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  --receipt <path> \
  --base <trusted-main-sha> \
  --head <candidate-sha> \
  --branch feat/ui-migration-prerequisites
```

`--check` must regenerate to memory and compare exact UTF-8 LF bytes without rewriting the file.

**Step 4: Run tests**

```bash
node --check tools/ui-migration/generate-ui-wp1-current-main-receipt.js
node --check tools/ui-migration/verify-ui-wp1-current-main-receipt.js
node --test --test-concurrency=1 \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: all receipt and static-authority contracts pass.

**Step 5: Commit generator and verifier**

```bash
git add \
  tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "feat(ui): implement deterministic current-main receipt"
```

Do not create the final checked-in receipt yet; its `reviewedHead` must point to a later GREEN code commit.

---

## Task 5: Define causal RED for active-handoff decoupling

**Files:**

- Modify: `tests/wp0/ui-migration-work-package-authorization.test.js`
- Modify: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Step 1: Add non-authority mutation contracts**

Prove that all of these produce the same authorization result:

- active-handoff ref present;
- active-handoff ref missing;
- active-handoff ref advanced;
- historical observation text changed;
- no active-handoff field at all.

Also prove that any executable field named `activeHandoffObserved`, `requiredActiveHandoff`, `activeHandoffCommit` or equivalent is rejected by the static authority and receipt schemas.

**Step 2: Run and verify causal RED**

```bash
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
```

Expected: only the new decoupling contracts fail because the four existing companion documents still encode current-main/active-handoff observations as package identity.

**Step 3: Commit test only**

```bash
git add \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "test(ui): prove active handoff is non-authoritative"
```

---

## Task 6: Refactor the four companion documents into immutable snapshots

**Files:**

- Modify: `docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml`
- Modify: `docs/ui-migration/UI_ASSET_BASELINE.json`
- Modify: `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- Modify: `docs/ui-migration/UPSTREAM_PINS.yaml`
- Modify: `governance/ui-migration/ui-wp1-root-agnostic-authorization.json`

**Step 1: Separate immutable source identity from observations**

For every companion document:

- retain exact upstream commits, blobs, local authoritative file blobs and behavior boundaries;
- rename current-root fields to immutable source snapshot fields where they identify bytes actually reviewed;
- remove `baseCommit`, `baseTree`, `authorizationParent` and active-handoff values from execution authority;
- when historical observations remain useful, place them under an explicitly non-authoritative `observations` section with `authoritative: false`;
- never use an observation in a digest that determines execution authority.

**Step 2: Recompute static package digests**

Use one deterministic helper in `uiMigrationWorkPackagePolicy.js`; do not hand-maintain parallel hashing algorithms.

**Step 3: Run focused tests**

```bash
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: all static authority, receipt and active-handoff decoupling contracts pass.

**Step 4: Verify no executable active-handoff binding remains**

```bash
git grep -nE \
  'activeHandoffObserved|requiredActiveHandoff|activeHandoffCommit' \
  -- \
  docs/ui-migration \
  governance/ui-migration \
  shared/release/uiMigrationWorkPackagePolicy.js \
  tools/ui-migration
```

Expected: either no match, or matches only inside explicitly non-authoritative observation/test text.

**Step 5: Commit the bottom-layer refactor**

```bash
git add \
  docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml \
  docs/ui-migration/UI_ASSET_BASELINE.json \
  docs/ui-migration/UI_WP1_AUTHORIZATION.md \
  docs/ui-migration/UPSTREAM_PINS.yaml \
  governance/ui-migration/ui-wp1-root-agnostic-authorization.json
git commit -m "refactor(ui): decouple active handoff from migration authority"
```

---

## Task 7: Define causal RED for a base-owned UI migration gate

**Files:**

- Create: `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`

**Step 1: Add structural workflow contracts**

Require the permanent workflow to:

- resolve the exact PR base and Head;
- create a detached base-owned policy worktree;
- execute the UI migration authorization contract exactly once and fail fast;
- run receipt verification against the candidate using the base-owned policy implementation;
- pass the explicit `IMPLEMENTATION_BRANCH` when checkout is detached;
- reject broad `tests/wp0/*.test.js` substitutions, duplicate invocation, `continue-on-error`, shell suppression and candidate-owned verifier execution.

**Step 2: Add scope-gate contracts**

Require:

- `feat/ui-migration-prerequisites` is applicable only through exact trusted authority;
- the receipt path is the only path excluded from implementation digest;
- wrong branch, stale base, widened scope and candidate policy mutation fail closed;
- unrelated UI branches and arbitrary `feat/ui-*` branches remain denied;
- the four existing UI governance paths remain exact governance routes;
- new authority, receipt, verifier and tests receive exact routes without adding a directory wildcard.

**Step 3: Run and verify causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/layered-ci/wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
```

Expected: only new base-owned gate and exact-route contracts fail.

**Step 4: Commit test only**

```bash
git add \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/layered-ci/wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
git commit -m "test(wp0): require base-owned UI migration gate"
```

---

## Task 8: Integrate the base-owned UI migration gate

**Files:**

- Modify: `.github/workflows/stage-6459-wp0-gates.yml`
- Modify: `governance/layered-ci/wp0-routing-policy.json`
- Modify: `shared/release/implementationBranchPolicy.js`
- Modify: `tools/wp0/work-package-scope-gate.js`
- Modify: `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`

**Step 1: Register only exact new paths**

Add each approved governance/test/tool path literally. Do not add `governance/ui-migration/`, `tools/ui-migration/`, `tests/ui-migration/` or any other prefix/wildcard authority.

**Step 2: Add a trusted UI authority descriptor**

Extend the existing delegated-authority mechanism or call the new pure policy through one exact descriptor rooted in the ordinary main merge that introduced the static authority. Verify:

- ordered merge parents;
- reviewed authorization Head;
- original authorization blob;
- trusted-Head ancestry;
- exact implementation branch and path digest;
- all non-production closure fields.

Do not copy the OSS-A product registry or create a second generic branch authority.

**Step 3: Add UI scope evaluation**

In `tools/wp0/work-package-scope-gate.js`, add an isolated `evaluateUiMigrationScope` path that:

- resolves the trusted static authority and checked-in receipt from the base-owned policy root;
- uses strict Buffer/NUL-framed Git path evidence;
- checks clean worktree and exact ancestry;
- excludes only `governance/ui-migration/ui-wp1-current-main-receipt.json` from implementation scope;
- delegates semantic validation to `uiMigrationWorkPackagePolicy.js`;
- returns `readyForPromotion: false`.

**Step 4: Execute the exact contract in the workflow**

The `GOVERNANCE_WP0` job must execute the new static authorization contract exactly once. The `PRODUCT_WP0` base-owned executable gate must evaluate the implementation branch and receipt through the trusted base worktree. No candidate-owned script may decide its own authority.

**Step 5: Run focused tests**

```bash
node --check shared/release/implementationBranchPolicy.js
node --check tools/wp0/work-package-scope-gate.js
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/layered-ci/wp0-routing.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/wp0/implementation-branch-policy.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
```

Expected: all focused contracts pass.

**Step 6: Run repository-level verification**

```bash
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

The final clean-tree assertion is run after staging/committing, not while intended changes remain uncommitted.

**Step 7: Commit the GREEN code Head**

```bash
git add \
  .github/workflows/stage-6459-wp0-gates.yml \
  governance/layered-ci/wp0-routing-policy.json \
  shared/release/implementationBranchPolicy.js \
  tools/wp0/work-package-scope-gate.js \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/layered-ci/wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
git commit -m "fix(wp0): execute base-owned UI migration authorization"
```

Record this commit as `reviewedCodeHead`.

---

## Task 9: Complete hermetic and cross-platform verification

**Files:** No planned changes. Any discovered defect requires a new focused RED before repair.

**Step 1: Reinstall from lock and run the complete local matrix**

```bash
rm -rf node_modules
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js \
  tests/layered-ci/ui-migration-base-owned-gate.test.js
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Expected: GREEN and clean on Linux.

**Step 2: Run equivalent Windows commands**

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 `
  tests/wp0/ui-migration-work-package-authorization.test.js `
  tests/ui-migration/ui-wp1-current-main-receipt.test.js `
  tests/layered-ci/ui-migration-base-owned-gate.test.js
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
if (git status --porcelain=v1 --untracked-files=all) { throw 'worktree is dirty' }
```

Expected: identical semantic result. Path separators, line endings and detached checkout must not alter receipt bytes or authorization decisions.

**Step 3: Run mutation controls**

At minimum mutate in temporary fixtures:

- base SHA;
- branch name;
- static authority blob;
- one companion digest;
- duplicate implementation path;
- extra post-review path;
- active-handoff observation;
- candidate-owned verifier.

Expected: every authority mutation fails except the active-handoff observation mutation, which must not affect the result.

---

## Task 10: Generate the receipt-only final metadata commit

**Files:**

- Create: `governance/ui-migration/ui-wp1-current-main-receipt.json`

**Step 1: Resolve immutable inputs**

```bash
TRUSTED_BASE="$(git merge-base refs/remotes/origin/main HEAD)"
REVIEWED_HEAD="$(git rev-parse HEAD)"
test "${REVIEWED_HEAD}" = "$(git rev-parse feat/ui-migration-prerequisites)"
git merge-base --is-ancestor "${TRUSTED_BASE}" "${REVIEWED_HEAD}"
```

Expected: `REVIEWED_HEAD` is the Task 8 GREEN code commit and the branch has not moved.

**Step 2: Generate the checked-in receipt**

```bash
node tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  --base "${TRUSTED_BASE}" \
  --reviewed-head "${REVIEWED_HEAD}" \
  --branch feat/ui-migration-prerequisites \
  --output governance/ui-migration/ui-wp1-current-main-receipt.json
```

**Step 3: Verify exact bytes before commit**

```bash
node tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  --check \
  --receipt governance/ui-migration/ui-wp1-current-main-receipt.json \
  --base "${TRUSTED_BASE}" \
  --head "${REVIEWED_HEAD}" \
  --branch feat/ui-migration-prerequisites
```

Expected: GREEN with no file rewrite.

**Step 4: Commit only the receipt**

```bash
git add governance/ui-migration/ui-wp1-current-main-receipt.json
git diff --cached --name-only
git commit -m "chore(ui): record current-main migration receipt"
```

Expected staged path list contains exactly one path.

**Step 5: Prove post-review topology**

```bash
TIP="$(git rev-parse HEAD)"
git diff --name-only "${REVIEWED_HEAD}" "${TIP}"
git rev-list --count "${REVIEWED_HEAD}..${TIP}"
```

Expected:

```text
governance/ui-migration/ui-wp1-current-main-receipt.json
1
```

**Step 6: Rerun the full matrix at the exact tip**

```bash
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js \
  tests/layered-ci/ui-migration-base-owned-gate.test.js
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Expected: exact-tip GREEN and clean.

---

## Task 11: Review, ordinary merge and next-work-package boundary

**Files:** PR metadata only unless a real defect is found.

**Step 1: Open one implementation PR against fresh `main`**

The PR must record:

- trusted base;
- each test-only RED Head and exact failure;
- reviewed code Head;
- receipt-only exact tip;
- exact changed path set/digest;
- Linux and Windows commands/results;
- no Product Shell/source-copy/distribution/cutover authority.

**Step 2: Require independent review**

Review must verify:

- candidate-owned policy cannot self-authorize;
- active-handoff has no executable role;
- only the receipt is dynamic;
- the receipt is deterministic and non-self-referential;
- base-owned workflow invokes exact tests once and fail fast;
- no wildcard route or branch authority;
- no hidden Product Shell implementation.

All P0/P1 findings and unresolved threads must be zero before merge.

**Step 3: Perform a fresh ref lock**

```bash
git fetch --prune origin main feat/ui-migration-prerequisites
test "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/feat/ui-migration-prerequisites)"
git merge-base --is-ancestor refs/remotes/origin/main HEAD
```

If `main` changed a policy/authority path relevant to this plan, do not rebase or force-update. Resolve through an ordinary main merge and regenerate only the dynamic receipt, preserving the static package identity.

**Step 4: Merge ordinarily after explicit user approval**

Use an ordinary two-parent merge commit. Squash and rebase are forbidden.

**Step 5: Close stale UI authorization PRs only after the new mechanism is in main**

PR #65 and PR #85 become superseded historical evidence. Close them unmerged after the new root-agnostic authority and dynamic receipt mechanism are verified on `main`.

**Step 6: Stop at the prerequisite boundary**

This merge authorizes no UI implementation by itself. The next plan must create the approved 28-path causal RED contract package for:

- design tokens and theme/settings adapters;
- bilingual message/composer contracts;
- dock state machines;
- unified conversation center;
- explicit surface-state labels;
- crash/restart and DPI/accessibility behavior.

No Product Shell GREEN source begins until that next RED package is reviewed and authorized.

## Definition of done

This prerequisite is complete only when all of the following are true:

- one static root-agnostic authority validates without a current-main or active-handoff SHA;
- changing active-handoff observations cannot change authorization;
- one deterministic receipt binds the exact branch-time base and reviewed Head;
- receipt generation is reproducible on Linux and Windows;
- candidate-owned policy cannot authorize itself;
- permanent WP0 executes the exact base-owned UI gate;
- exact routes are registered without prefixes or wildcards;
- the final tip differs from reviewed code Head by exactly one receipt path;
- full WP0, security and protocol suites are GREEN;
- implementation PR merges ordinarily with no force push or history rewrite;
- Product Shell implementation remains explicitly unauthorized.