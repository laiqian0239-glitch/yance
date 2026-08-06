# Yance UI Migration Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the routing and governance capabilities required before the approved Yance unified UI migration can begin: literal governance routing, root-agnostic UI authorization, deterministic dynamic current-main receipts, active-handoff decoupling, and base-owned execution gates.

**Architecture:** Delivery is split into three ordinary governance pull requests. The first removes broad governance-prefix authority from the WP0 router and converts every currently trusted governance path into an exact literal route. The second registers only the nine future UI prerequisite paths. The third implements the static authorization package, receipt generator/verifier, and base-owned evaluator. Only after all three are merged to `main` may the approved 28-path UI-WP1 causal RED branch be created.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, strict Git plumbing through `execFileSync`, UTF-8/LF deterministic JSON, NUL-framed path evidence, GitHub Actions, and the existing WP0 routing and delegated-authority infrastructure.

## Global Constraints

- 禁止临时绕过，必须底层重构。
- Failure tests precede implementation; every RED must be causal, reproducible, and limited to the missing behavior.
- No amend, rebase, squash, force push, history rewrite, warning-only closure, skipped gate, or candidate self-authorization.
- Every work package uses an independent branch, independent pull request, exact Head verification, and ordinary two-parent merge.
- Yance remains the sole product, data, settings, notification, translation, identity, and send authority.
- This plan grants no Product Shell implementation, Chatwoot source copy, shadcn-vue source copy, sound redistribution, legacy writer cutover, production, release, publish, promotion, or automatic next-work-package authority.
- Repository path identity is exact canonical UTF-8 text. No trimming, case folding, slash conversion, globbing, prefix inference, or normalization is permitted; non-canonical inputs are rejected rather than transformed.
- Historical PR #90 and PR #91 remain closed and unmerged. Their branches are evidence only and are never execution parents.
- The approved design snapshot is bound by both path and content:

```text
approvedDesignSnapshotPath=docs/superpowers/specs/2026-08-06-yance-unified-ui-open-source-migration-design-snapshot.md
approvedDesignSnapshotSha256=b9849d8d3bf0cbda867b32565bc465db0c7eb70c4d7e1d929c725a39c6b58ba9
```

A file at the same path with different bytes is not the approved snapshot. Any digest change requires a separately reviewed design revision and explicit user approval.

## Normative NUL-Framed Path Evidence

Every exact Git path-set check in this plan must use raw `Buffer` output with `-z`, split on NUL bytes, and decode each field with fatal UTF-8. Newline-delimited output, `encoding: 'utf8'` on the Git call, implicit `core.quotePath`, trimming, normalization, and locale sorting are forbidden.

Use this procedure for `git diff`, `git ls-tree`, `git ls-files`, and staged/worktree scope checks:

```js
'use strict';
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const decoder = new TextDecoder('utf-8', { fatal: true });

function decodeGitPathList(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('expected Buffer');
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error('missing terminal NUL');

  const paths = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index === start) throw new Error('empty Git path field');
    paths.push(decoder.decode(buffer.subarray(start, index)));
    start = index + 1;
  }
  return paths;
}

function bytewiseSort(paths) {
  return [...paths].sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  );
}

function gitPaths(args, options = {}) {
  return decodeGitPathList(execFileSync('git', args, {
    ...options,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024
  }));
}

function assertExactPathSet(actual, expected) {
  const sortedActual = bytewiseSort(actual);
  const sortedExpected = bytewiseSort(expected);
  if (actual.length !== new Set(actual).size) throw new Error('duplicate actual path');
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`unexpected path set: ${JSON.stringify(sortedActual)}`);
  }
}
```

All later references to “the NUL-framed verifier” mean this exact procedure. Tests must include filenames containing spaces, tabs, quotes, backslashes, and newlines, plus invalid UTF-8 bytes, proving distinct or invalid paths cannot be silently accepted.

---

## Verified Root Cause

At the planning baseline, `governance/layered-ci/wp0-routing-policy.json` is schema version 2 and contains broad `governancePrefixes`, including:

```text
.github/actions/resolve-diff-range/
governance/layered-ci/
tools/layered-ci/
tests/layered-ci/
tools/independent-review/
docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate
docs/superpowers/plans/2026-08-02-layered-ci-reviewed-candidate
```

`tools/layered-ci/wp0-routing.js` checks governance exact paths **or prefixes** before product routing. Therefore arbitrary new files under `governance/layered-ci/` and `tests/layered-ci/` currently receive `GOVERNANCE_WP0`. Three planned UI prerequisite paths are already accepted before any bootstrap change:

```text
governance/layered-ci/ui-wp1-root-agnostic-authorization.json
tests/layered-ci/ui-migration-base-owned-gate.test.js
tests/layered-ci/ui-migration-static-package.test.js
```

The former plan's assertion that all nine future paths initially fail routing is therefore false. This plan repairs the route model first instead of weakening the RED.

## Delivery Topology

```text
replacement design/plan PR from live main
  |
  +-- governance/wp0-exact-route-hardening
  |     -> routing-model test-only RED
  |     -> schema-v3 literal-governance GREEN
  |     -> ordinary merge to main
  |
  +-- governance/ui-migration-prerequisite-routes
  |     -> nine-path test-only RED
  |     -> nine literal routes GREEN
  |     -> ordinary merge to main
  |
  +-- governance/ui-migration-prerequisites
        -> static-package RED/GREEN
        -> pure-policy RED/GREEN
        -> deterministic-receipt RED/GREEN
        -> base-owned-gate RED/GREEN
        -> ordinary merge to main
  |
  +-- feat/unified-ui-product-shell-wp1-red-contracts-v2
        -> separate future 28-path causal RED plan only
```

## Exact Future Prerequisite Paths

The UI route bootstrap registers exactly these nine new paths after exact-route hardening is present in `main`:

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

The following four companion document paths are already exact governance routes and remain unchanged as path identities:

```text
docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml
docs/ui-migration/UI_ASSET_BASELINE.json
docs/ui-migration/UI_WP1_AUTHORIZATION.md
docs/ui-migration/UPSTREAM_PINS.yaml
```

Existing files modified by the prerequisite capability are already exact routes after the hardening merge:

```text
.github/workflows/stage-6459-wp0-gates.yml
shared/release/implementationBranchPolicy.js
tests/layered-ci/ui-product-shell-wp0-routing.test.js
tests/layered-ci/wp0-routing.test.js
tests/wp0/implementation-branch-policy.test.js
tools/wp0/work-package-scope-gate.js
```

Any need to change a path outside the task-specific sets below stops execution and requires a reviewed plan revision before code changes continue.

---

### Task 0: Lock Live Refs and Verify the Replacement Design/Plan Merge

**Files:** None.

**Interfaces:**
- Consumes: remote `main`, frozen PR #90/#91 state, replacement branch `design/unified-ui-open-source-migration-2026-08-07-clean`.
- Produces: exact trusted `DESIGN_MERGE` used as the base of the routing hardening branch.

- [ ] **Step 1: Fetch exact refs**

```bash
git fetch --prune origin \
  main \
  design/unified-ui-open-source-migration-2026-08-07-clean

MAIN="$(git rev-parse refs/remotes/origin/main)"
REPLACEMENT_HEAD="$(git rev-parse refs/remotes/origin/design/unified-ui-open-source-migration-2026-08-07-clean)"
printf 'main=%s\nreplacement=%s\n' "$MAIN" "$REPLACEMENT_HEAD"
```

Expected: two lowercase 40-character commit IDs.

- [ ] **Step 2: Verify historical PRs remain closed and unmerged**

```bash
gh pr view 90 --json state,mergedAt,headRefOid
gh pr view 91 --json state,mergedAt,headRefOid
```

Expected for both PRs: `state=CLOSED` and `mergedAt=null`.

- [ ] **Step 3: Resolve and capture the merged replacement PR without hard-coding its number**

```bash
MERGED_JSON="$(gh pr list \
  --state merged \
  --head design/unified-ui-open-source-migration-2026-08-07-clean \
  --json number,mergedAt,mergeCommit,headRefOid,baseRefOid)"

test "$(jq 'length' <<<"$MERGED_JSON")" -eq 1
DESIGN_MERGE="$(jq -r '.[0].mergeCommit.oid' <<<"$MERGED_JSON")"
MERGED_HEAD="$(jq -r '.[0].headRefOid' <<<"$MERGED_JSON")"
MERGED_BASE="$(jq -r '.[0].baseRefOid' <<<"$MERGED_JSON")"

test "$MERGED_HEAD" = "$REPLACEMENT_HEAD"
git merge-base --is-ancestor "$DESIGN_MERGE" "$MAIN"
printf 'design_merge=%s\nmerged_head=%s\nmerged_base=%s\n' \
  "$DESIGN_MERGE" "$MERGED_HEAD" "$MERGED_BASE"
```

Expected: exactly one merged PR; `MERGED_HEAD` equals `REPLACEMENT_HEAD`; `DESIGN_MERGE` equals current `MAIN` or is an ancestor of current `MAIN`.

- [ ] **Step 4: Verify merge parents, replacement topology, and exact scope**

```bash
read -r DESIGN_BASE DESIGN_SECOND EXTRA \
  <<<"$(git show --no-patch --format='%P' "$DESIGN_MERGE")"

test -n "$DESIGN_BASE"
test -n "$DESIGN_SECOND"
test -z "${EXTRA:-}"
test "$DESIGN_SECOND" = "$REPLACEMENT_HEAD"
test "$MERGED_BASE" = "$DESIGN_BASE"

test "$(git rev-list --count "$DESIGN_BASE..$REPLACEMENT_HEAD")" -eq 2
git log --format='%H %T %P %s' "$DESIGN_BASE..$REPLACEMENT_HEAD"
```

Then use the NUL-framed verifier with:

```js
const base = process.argv[2];
const head = process.argv[3];
const expected = [
  'docs/superpowers/plans/2026-08-06-yance-ui-migration-prerequisites.md',
  'docs/superpowers/specs/2026-08-06-yance-unified-ui-open-source-migration-design-snapshot.md'
];
assertExactPathSet(
  gitPaths(['diff', '--no-renames', '-z', '--name-only', base, head]),
  expected
);
```

Invoke it as `node - "$DESIGN_BASE" "$REPLACEMENT_HEAD"`. Do not use `git merge-base` as the comparison point after merge.

For each of the two commits, verify its tree differs from its first parent's tree. Any extra parent, wrong second parent, missing path, extra path, invalid UTF-8 path, duplicate path, or content-identical commit stops execution.

- [ ] **Step 5: Establish the hardening worktree**

```bash
git worktree add ../yance-wp0-exact-routing \
  -b governance/wp0-exact-route-hardening \
  "$DESIGN_MERGE"
cd ../yance-wp0-exact-routing

test "$(git rev-parse HEAD)" = "$DESIGN_MERGE"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
npm ci --ignore-scripts --no-audit --no-fund
```

---

### Task 1: Create a Causal RED for Literal Governance Routing

**Files:**
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`

**Interfaces:**
- Consumes: schema-v2 policy and `classifyWp0Route(policy, changedFiles)`.
- Produces: contracts requiring schema v3, no governance prefix authority, preserved exact current governance files, and product escalation for unregistered near matches.

- [ ] **Step 1: Capture the exact legacy-prefix inventory from the immutable base**

Run from the clean hardening worktree before editing. Use the NUL-framed verifier's decoder; do not request string encoding from Git:

```bash
BASE="$(git rev-parse HEAD)"
node - "$BASE" <<'NODE'
'use strict';
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const decoder = new TextDecoder('utf-8', { fatal: true });
const base = process.argv[2];
const prefixes = [
  '.github/actions/resolve-diff-range/',
  'governance/layered-ci/',
  'tools/layered-ci/',
  'tests/layered-ci/',
  'tools/independent-review/',
  'docs/superpowers/specs/2026-08-02-layered-ci-reviewed-candidate',
  'docs/superpowers/plans/2026-08-02-layered-ci-reviewed-candidate'
];
const buffer = execFileSync(
  'git',
  ['ls-tree', '-r', '-z', '--name-only', base, '--', ...prefixes],
  { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }
);
if (buffer.length === 0 || buffer[buffer.length - 1] !== 0) process.exit(1);
const paths = [];
let start = 0;
for (let index = 0; index < buffer.length; index += 1) {
  if (buffer[index] !== 0) continue;
  if (index === start) process.exit(1);
  paths.push(decoder.decode(buffer.subarray(start, index)));
  start = index + 1;
}
paths.sort((left, right) =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
);
if (paths.length === 0 || new Set(paths).size !== paths.length) process.exit(1);
process.stdout.write(`${JSON.stringify(paths, null, 2)}\n`);
NODE
```

Copy this exact sorted array into `LEGACY_GOVERNANCE_EXACT_PATHS` in `tests/layered-ci/wp0-routing.test.js`. This is a reviewed fixed fixture, not a runtime directory scan.

- [ ] **Step 2: Add the schema and no-prefix assertions**

Add contracts equivalent to:

```js
test('governance routing is literal-only and preserves the reviewed baseline set', () => {
  assert.equal(policy.schemaVersion, 3);
  assert.equal(Object.hasOwn(policy, 'governancePrefixes'), false);
  assert.deepEqual(
    LEGACY_GOVERNANCE_EXACT_PATHS.filter(path => !policy.governanceExactPaths.includes(path)),
    []
  );
});
```

- [ ] **Step 3: Add near-match escalation assertions**

Add a table proving each unregistered path is **not** `GOVERNANCE_WP0`:

```js
for (const file of [
  'governance/layered-ci/extra.json',
  'governance/layered-ci/wp0-routing-policy-copy.json',
  'tests/layered-ci/extra.test.js',
  'tests/layered-ci/WP0-routing.test.js',
  'tools/layered-ci/extra.js',
  'tools/independent-review/extra.js',
  '.github/actions/resolve-diff-range/extra.yml'
]) {
  const result = classifyWp0Route(policy, [file]);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.PRODUCT, file);
  assert.equal(result.governanceChangesPresent, false, file);
}
```

Also preserve fail-closed invalid-path tests for traversal, backslashes, controls, globs, drive letters, empty segments, outer whitespace, non-NFC Unicode, lone UTF-16 surrogates, and invalid UTF-8 Git evidence.

- [ ] **Step 4: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: failures only because the current policy is schema v2 and the current classifier still grants governance prefix authority. Syntax, discovery, missing fixture, and infrastructure failures are invalid RED.

- [ ] **Step 5: Commit tests only**

```bash
git add \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
git commit -m "test(wp0): require literal governance routes"
```

Record this commit as `EXACT_ROUTE_RED`.

---

### Task 2: Implement Schema-v3 Exact Governance Routing

**Files:**
- Modify: `governance/layered-ci/wp0-routing-policy.json`
- Modify: `tools/layered-ci/wp0-routing.js`
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`

**Interfaces:**
- Consumes: `LEGACY_GOVERNANCE_EXACT_PATHS` fixture and current product routing fields.
- Produces: schema-v3 policy where governance classification is exact-only; product and documentation routing retain their reviewed semantics.

- [ ] **Step 1: Upgrade the policy schema**

In `governance/layered-ci/wp0-routing-policy.json`:

```json
{
  "schemaVersion": 3,
  "documentType": "YANCE_WP0_SCOPE_ROUTING_POLICY"
}
```

Remove the `governancePrefixes` field entirely. Merge every path from `LEGACY_GOVERNANCE_EXACT_PATHS` into `governanceExactPaths`, sort by raw UTF-8 bytes, and reject duplicates. Do not change `productDocumentationPrefixes`, `productDocumentationExtensions`, `productExactPaths`, `productPrefixes`, `mixedChangesEscalateToProduct`, `unknownPathFailsClosed`, or `readyForPromotion` in this work package.

- [ ] **Step 2: Split exact governance matching from product prefix matching**

Replace the governance call to `matchesExactOrPrefix` with exact membership:

```js
function matchesExact(file, exactPaths) {
  return exactPaths.includes(file);
}

function matchesExactOrPrefix(file, exactPaths, prefixes) {
  return matchesExact(file, exactPaths)
    || prefixes.some(prefix => file.startsWith(prefix));
}
```

In `classifyWp0Route`:

```js
if (matchesExact(file, policy.governanceExactPaths)) {
  governance = true;
  continue;
}
```

Product routing may continue to use exact-or-prefix matching. Governance routing may not.

- [ ] **Step 3: Reject the old schema and field**

`validateWp0RoutingPolicy` must require:

```js
policy.schemaVersion === 3
Object.hasOwn(policy, 'governancePrefixes') === false
validRules(policy.governanceExactPaths) === true
```

A policy containing `governancePrefixes`, even as an empty array, fails with reason code `WP0_ROUTE_GOVERNANCE_PREFIX_FORBIDDEN`.

- [ ] **Step 4: Run focused GREEN tests**

```bash
node --check tools/layered-ci/wp0-routing.js
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: GREEN; every reviewed baseline governance path still selects `GOVERNANCE_WP0`, and every unregistered near match selects `PRODUCT_WP0` or fails closed but never governance.

- [ ] **Step 5: Run repository-level governance verification and compare the complete change set**

```bash
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
```

Use the NUL-framed verifier to union all paths from:

```js
gitPaths(['diff', '--no-renames', '-z', '--name-only'])
gitPaths(['diff', '--no-renames', '-z', '--cached', '--name-only'])
gitPaths(['ls-files', '-z', '--others', '--exclude-standard'])
```

Compare that complete union exactly with:

```js
[
  'governance/layered-ci/wp0-routing-policy.json',
  'tests/layered-ci/ui-product-shell-wp0-routing.test.js',
  'tests/layered-ci/wp0-routing.test.js',
  'tools/layered-ci/wp0-routing.js'
]
```

This check must detect tracked modifications, deletions, renames as delete/add via `--no-renames`, staged files, and untracked files. Any extra path stops execution.

- [ ] **Step 6: Stage, verify the staged set, and commit the GREEN implementation**

```bash
git add \
  governance/layered-ci/wp0-routing-policy.json \
  tools/layered-ci/wp0-routing.js \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Before committing, use the NUL-framed verifier and require:

```js
assertExactPathSet(
  gitPaths(['diff', '--no-renames', '-z', '--cached', '--name-only']),
  [
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/ui-product-shell-wp0-routing.test.js',
    'tests/layered-ci/wp0-routing.test.js',
    'tools/layered-ci/wp0-routing.js'
  ]
);
```

Also require the unstaged tracked and untracked path sets to be empty after staging. Then commit:

```bash
git commit -m "fix(wp0): replace governance prefixes with exact routes"
```

Record this commit as `EXACT_ROUTE_GREEN`.

---

### Task 3: Review and Ordinarily Merge WP0 Exact-Route Hardening

**Files:** PR metadata only unless a real defect is found through a new failing test.

**Interfaces:**
- Consumes: `EXACT_ROUTE_RED`, `EXACT_ROUTE_GREEN`.
- Produces: trusted main merge `EXACT_ROUTE_MERGE` whose base-owned router has no governance prefix authority.

- [ ] **Step 1: Verify the PR path set with NUL-framed evidence**

Use the NUL-framed verifier:

```js
assertExactPathSet(
  gitPaths(['diff', '--no-renames', '-z', '--name-only', DESIGN_MERGE, 'HEAD']),
  [
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/ui-product-shell-wp0-routing.test.js',
    'tests/layered-ci/wp0-routing.test.js',
    'tools/layered-ci/wp0-routing.js'
  ]
);
```

- [ ] **Step 2: Require exact-Head CI and independent review**

The exact Head must have:

- Stage WP0 GREEN;
- Layered CI GREEN on Ubuntu and Windows where applicable;
- security scan and protocol validation GREEN;
- zero unresolved P0/P1 findings;
- no candidate-owned bypass, prefix fallback, warning-only closure, or skipped focused contract.

- [ ] **Step 3: Merge only after explicit user approval**

Use an ordinary two-parent merge commit. Squash and rebase are forbidden.

- [ ] **Step 4: Verify merged main**

```bash
git fetch --prune origin main
EXACT_ROUTE_MERGE="$(git rev-parse refs/remotes/origin/main)"
git show --no-patch --format='%P' "$EXACT_ROUTE_MERGE"
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: two ordered merge parents and GREEN exact-route contracts.

---

### Task 4: Create the Nine-Path UI Prerequisite Routing RED

**Files:**
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`

**Interfaces:**
- Consumes: base-owned schema-v3 exact router from `EXACT_ROUTE_MERGE`.
- Produces: causal RED proving none of the nine new prerequisite paths has governance authority before registration.

- [ ] **Step 1: Create an isolated route worktree**

```bash
git worktree add ../yance-ui-route-bootstrap \
  -b governance/ui-migration-prerequisite-routes \
  "$EXACT_ROUTE_MERGE"
cd ../yance-ui-route-bootstrap
npm ci --ignore-scripts --no-audit --no-fund
```

- [ ] **Step 2: Add exact route contracts for all nine paths**

Define one frozen array containing the nine paths from **Exact Future Prerequisite Paths**. For each path assert:

```js
const result = classifyWp0Route(policy, [file]);
assert.equal(result.pass, true, JSON.stringify(result));
assert.equal(result.route, ROUTES.GOVERNANCE, file);
assert.equal(policy.governanceExactPaths.includes(file), true, file);
```

Add near-match denials for:

```text
governance/layered-ci/ui-wp1-root-agnostic-authorization-copy.json
governance/ui-migration/extra.json
shared/release/uiMigrationWorkPackagePolicy-copy.js
tests/layered-ci/ui-migration-base-owned-gate-copy.test.js
tests/ui-migration/arbitrary.test.js
tests/wp0/ui-migration-work-package-authorization-copy.test.js
tools/ui-migration/arbitrary.js
```

Near matches must not select `GOVERNANCE_WP0`.

- [ ] **Step 3: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: exactly the nine new path assertions fail because they currently select `PRODUCT_WP0`; all near-match and baseline assertions remain GREEN.

- [ ] **Step 4: Commit tests only**

```bash
git add \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
git commit -m "test(wp0): require exact UI prerequisite routes"
```

Record as `UI_ROUTE_RED`.

---

### Task 5: Register the Nine Literal UI Prerequisite Routes

**Files:**
- Modify: `governance/layered-ci/wp0-routing-policy.json`
- Modify: `tests/layered-ci/wp0-routing.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`

**Interfaces:**
- Consumes: `UI_ROUTE_RED` and schema-v3 policy.
- Produces: base-owned literal routes for exactly the nine future prerequisite paths.

- [ ] **Step 1: Add the nine literal paths**

Insert all nine paths individually into `governanceExactPaths`, maintaining raw-UTF-8 byte order and uniqueness. Do not add a prefix, glob, branch rule, or generic UI exception. The receipt path is registered but not created on this branch.

- [ ] **Step 2: Run focused routing tests**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
```

Expected: GREEN, including all near-match denials.

- [ ] **Step 3: Run the full governance matrix**

```bash
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
```

Expected: GREEN.

- [ ] **Step 4: Commit the GREEN route change**

```bash
git add \
  governance/layered-ci/wp0-routing-policy.json \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
git commit -m "fix(wp0): register exact UI prerequisite routes"
```

Record as `UI_ROUTE_GREEN`.

---

### Task 6: Review and Ordinarily Merge the UI Route Bootstrap

**Files:** PR metadata only unless a real defect is found through a new failing test.

**Interfaces:**
- Consumes: `UI_ROUTE_RED`, `UI_ROUTE_GREEN`.
- Produces: trusted `UI_ROUTE_MERGE` used as the sole base of the prerequisite capability branch.

- [ ] **Step 1: Verify exact three-file scope with NUL-framed evidence**

Use the NUL-framed verifier:

```js
assertExactPathSet(
  gitPaths(['diff', '--no-renames', '-z', '--name-only', EXACT_ROUTE_MERGE, 'HEAD']),
  [
    'governance/layered-ci/wp0-routing-policy.json',
    'tests/layered-ci/ui-product-shell-wp0-routing.test.js',
    'tests/layered-ci/wp0-routing.test.js'
  ]
);
```

- [ ] **Step 2: Require review and exact-Head CI**

Require zero unresolved P0/P1 findings, no prefix authority, no Product Shell source, no receipt file, and no prerequisite implementation file.

- [ ] **Step 3: Merge only after explicit user approval**

Use an ordinary two-parent merge commit.

- [ ] **Step 4: Lock the merged route base**

```bash
git fetch --prune origin main
UI_ROUTE_MERGE="$(git rev-parse refs/remotes/origin/main)"
git show --no-patch --format='%P' "$UI_ROUTE_MERGE"
```

---

### Task 7: Create the Prerequisite Capability Branch

**Files:** None.

**Interfaces:**
- Consumes: `UI_ROUTE_MERGE`.
- Produces: isolated branch `governance/ui-migration-prerequisites` where every planned path is already base-owned.

- [ ] **Step 1: Create the worktree**

```bash
git worktree add ../yance-ui-prerequisites \
  -b governance/ui-migration-prerequisites \
  "$UI_ROUTE_MERGE"
cd ../yance-ui-prerequisites

test "$(git rev-parse HEAD)" = "$UI_ROUTE_MERGE"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
npm ci --ignore-scripts --no-audit --no-fund
```

- [ ] **Step 2: Verify every planned path is base-owned**

Use the base copy of `tools/layered-ci/wp0-routing.js` and the base policy to classify the full capability path set. Every path must select `GOVERNANCE_WP0`; the candidate policy must not be consulted.

- [ ] **Step 3: Run the baseline**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/wp0-routing.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js
npm run test:wp0
```

Expected: GREEN before adding capability behavior.

---

### Task 8: Define the Root-Agnostic Static-Package RED

**Files:**
- Create: `tests/layered-ci/ui-migration-static-package.test.js`

**Interfaces:**
- Consumes: approved design snapshot and reviewed historical identities from PR #65 as non-executable source evidence.
- Produces: contracts for one root-agnostic authorization document plus four companion documents.

- [ ] **Step 1: Write static-package contracts**

Require:

```text
documentType=YANCE_UI_MIGRATION_ROOT_AGNOSTIC_AUTHORIZATION
repository=laiqian0239-glitch/yance
workPackage=UI-WP1
redBranch=feat/unified-ui-product-shell-wp1-red-contracts-v2
redChangedFileCount=28
redChangedFileSetSha256=da83c59da1f9e4f483cde355340f83d0f193e3872f5f534e662672f959f231dd
approvedDesignSnapshotPath=docs/superpowers/specs/2026-08-06-yance-unified-ui-open-source-migration-design-snapshot.md
approvedDesignSnapshotSha256=b9849d8d3bf0cbda867b32565bc465db0c7eb70c4d7e1d929c725a39c6b58ba9
```

The test must read the approved design snapshot bytes from the trusted base, hash those exact bytes with SHA-256, and require both the path and digest. A mutation at the same path must fail. Candidate-tree bytes cannot satisfy this check.

The test must also require exact identities for the four companion documents, the 28 RED paths, the nine prerequisite paths, Yance authority boundaries, single-writer closure, and all non-production flags.

It must reject executable authority from any of these fields:

```text
baseCommit
baseTree
authorizationParent
activeHandoffObserved
requiredActiveHandoff
activeHandoffCommit
workflowRunId
candidateHead
```

Historical observations may appear only under `observations.authoritative=false` and must be excluded from all authorization digests.

- [ ] **Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js
```

Expected: failure only because the five static package files do not exist.

- [ ] **Step 3: Commit tests only**

```bash
git add tests/layered-ci/ui-migration-static-package.test.js
git commit -m "test(ui): define root-agnostic static package contracts"
```

---

### Task 9: Create the Root-Agnostic Static Package

**Files:**
- Create: `docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml`
- Create: `docs/ui-migration/UI_ASSET_BASELINE.json`
- Create: `docs/ui-migration/UI_WP1_AUTHORIZATION.md`
- Create: `docs/ui-migration/UPSTREAM_PINS.yaml`
- Create: `governance/layered-ci/ui-wp1-root-agnostic-authorization.json`
- Modify: `tests/layered-ci/ui-migration-static-package.test.js`

**Interfaces:**
- Consumes: Task 8 contracts and reviewed source identities from historical PR #65.
- Produces: immutable static package independent of current `main` and active-handoff refs.

- [ ] **Step 1: Rebuild the four documents without executable root binding**

Preserve the approved Scheme C design, 29 themes, 136 stable sound IDs, Chatwoot commit/blob evidence, adapter authority boundaries, surface-state labels, exact RED branch, exact 28-path set, and non-authorization fields. Remove current-main, active-handoff, authorization-parent, run-ID, and candidate-Head requirements from executable identity.

The authorization document must carry both `approvedDesignSnapshotPath` and `approvedDesignSnapshotSha256`. Before generating package digests, read the snapshot from the trusted base with Git plumbing, hash the returned raw bytes, and fail unless it equals `b9849d8d3bf0cbda867b32565bc465db0c7eb70c4d7e1d929c725a39c6b58ba9`.

- [ ] **Step 2: Define deterministic package hashing**

Validate every package path as canonical exact UTF-8, reject duplicates, sort by raw UTF-8 bytes, and use records:

```text
path + NUL + sha256(fileBytes) + "\n"
```

Use UTF-8 LF bytes. The authorization's self-referential digest fields are zeroed exactly as specified by the tests before hashing. Historical observations are not included.

- [ ] **Step 3: Run focused tests**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js
```

Expected: GREEN.

- [ ] **Step 4: Commit the static package**

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

## Canonical `changedFileSetSha256` Contract

The `changedFileSetSha256(paths)` input and bytes are frozen as follows:

1. Every item must be a JavaScript string containing valid Unicode scalar values and must pass the exact repository-relative path validator.
2. Reject empty paths, absolute paths, drive-letter paths, backslashes, `.` or `..` segments, empty segments, controls, NUL, glob metacharacters, outer whitespace, lone UTF-16 surrogates, and any string for which `path.normalize('NFC') !== path`. Never normalize an input into acceptance.
3. Reject exact duplicates before sorting.
4. Encode each validated path as UTF-8 and sort records with `Buffer.compare` over those raw bytes.
5. Serialize each sorted path as `utf8(path) + NUL`. There is no LF, no length prefix, and no extra terminator beyond each record's NUL.
6. The empty set serializes to zero bytes, so its digest is the SHA-256 of the empty byte string.

Independent known-answer vectors:

```text
input paths (deliberately unsorted): ["docs/β.md", "a.txt"]
canonical serialized hex: 612e74787400646f63732fceb22e6d6400
changedFileSetSha256: a771219a44bcc69ae441eaceb4398eb5e8d4cb867b2bca9db8a69f9a8292dd14

input paths: []
canonical serialized hex: <empty>
changedFileSetSha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

Tests must compute these expected digests from literal fixture bytes independent of the production helper and must include duplicate, non-NFC, newline, invalid path, and order-permutation mutations.

### Task 10: Define the Pure UI Migration Policy RED

**Files:**
- Create: `tests/wp0/ui-migration-work-package-authorization.test.js`

**Interfaces:**
- Produces required CommonJS exports:

```js
validateStaticAuthorization(document)
validateCurrentMainReceipt(document, context)
evaluateUiMigrationCandidate(input)
changedFileSetSha256(paths)
```

- [ ] **Step 1: Write policy contracts**

Require exact repository-path validation, the normative `changedFileSetSha256` serialization above, canonical package digests, static authority independent of active-handoff and current main, trusted graph/file adapters for receipts, candidate-self-authorization rejection, immutable results, mandatory non-production closure, and distinct reason codes for static identity, scope, receipt, graph, and closure failures.

The test must use the independent known-answer vectors above and prove duplicate, non-canonical, normalized-but-different, reordered, newline-containing, and empty inputs behave exactly as specified.

- [ ] **Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

Expected: failure only because `shared/release/uiMigrationWorkPackagePolicy.js` does not exist.

- [ ] **Step 3: Commit tests only**

```bash
git add tests/wp0/ui-migration-work-package-authorization.test.js
git commit -m "test(ui): define migration policy contracts"
```

---

### Task 11: Implement the Pure UI Migration Policy

**Files:**
- Create: `shared/release/uiMigrationWorkPackagePolicy.js`
- Modify: `tests/wp0/ui-migration-work-package-authorization.test.js`
- Modify: `tests/layered-ci/ui-migration-static-package.test.js`

**Interfaces:**
- Consumes: Task 10 signatures and the frozen canonical digest contract.
- Produces: network-free, deterministic, dependency-injected policy evaluation.

- [ ] **Step 1: Implement strict validation primitives**

Use CommonJS, exact canonical UTF-8 paths, duplicate/normalization rejection, raw-byte sorting, the exact NUL serialization defined above, deterministic SHA-256, immutable return values, and dependency injection for Git graph and file evidence. The module must not read `project-state/active-handoff` or remote refs.

- [ ] **Step 2: Keep independent known-answer fixtures**

The static-package and policy tests may call production digest helpers but must retain the literal known-answer bytes and fixed hashes from this plan so a broken helper cannot pass by agreeing with itself.

- [ ] **Step 3: Run focused GREEN tests**

```bash
node --check shared/release/uiMigrationWorkPackagePolicy.js
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-static-package.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

- [ ] **Step 4: Commit implementation**

```bash
git add \
  shared/release/uiMigrationWorkPackagePolicy.js \
  tests/layered-ci/ui-migration-static-package.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
git commit -m "feat(ui): implement root-agnostic migration policy"
```

---

## Canonical Receipt JSON Bytes

Receipt generation and `--check` byte equality use one frozen serializer:

1. Accept JSON primitives, arrays, and plain objects only. Reject `undefined`, functions, symbols, `BigInt`, non-finite numbers, sparse arrays, cycles, custom prototypes, and lone UTF-16 surrogates.
2. Object keys must be canonical Unicode scalar strings. Recursively sort object keys by raw UTF-8 bytes with `Buffer.compare`; array element order is preserved.
3. Serialize with standard JSON string escaping and two-space indentation. Non-ASCII characters remain Unicode characters encoded as UTF-8; no BOM is permitted.
4. Line endings are LF only. Emit exactly one final LF after the closing token; no trailing spaces or extra blank line are allowed.
5. The generator and verifier must share this serializer. `--check` regenerates bytes in memory and compares exact buffers without rewriting the file.

Independent known-answer receipt fixture:

```json
{
  "allowedPostReviewPaths": [
    "governance/ui-migration/ui-wp1-current-main-receipt.json"
  ],
  "documentType": "YANCE_UI_WP1_CURRENT_MAIN_RECEIPT",
  "productionAuthorized": false,
  "repository": "laiqian0239-glitch/yance"
}
```

The code block's bytes include one LF after `}`. Its SHA-256 is:

```text
88322aef4564dd7d48e1cf75de2029773d495b99b6a3fbb5e3cec40cf39b70a1
```

Tests must keep the literal expected bytes or their literal hex independent of the implementation under test and must mutate key insertion order, CRLF, indentation, escaping, final newline, and invalid JSON values.

### Task 12: Define Deterministic Current-Main Receipt RED

**Files:**
- Create: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Interfaces:**
- Produces CLI contracts for generator and verifier.

- [ ] **Step 1: Write temporary-repository receipt contracts**

Require the receipt to bind:

```text
documentType=YANCE_UI_WP1_CURRENT_MAIN_RECEIPT
repository=laiqian0239-glitch/yance
workPackage=UI-WP1
branch=feat/unified-ui-product-shell-wp1-red-contracts-v2
```

It must also bind trusted base commit, reviewed code Head, ancestry, static-authorization blob from the trusted base, exact implementation path count/digest excluding only the receipt path, static package digest, and an allowed post-review set containing only the receipt path. All production/release/publish/promotion/automatic-next-package flags remain false.

The test must freeze the canonical receipt serializer and independent known-answer fixture above before the generator exists. It must reject stale or fabricated base, wrong ancestry, self-reference, dirty worktree, wrong branch, candidate-owned authority/policy, widened paths, extra post-review commit/path, CRLF drift, wrong key order or indentation, missing/extra final LF, Git replacement, config/environment injection, and non-deterministic bytes. Active-handoff mutation must not change receipt bytes.

- [ ] **Step 2: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
```

Expected: failure only because generator and verifier modules do not exist.

- [ ] **Step 3: Commit tests only**

```bash
git add tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "test(ui): define dynamic current-main receipt contracts"
```

---

### Task 13: Implement Deterministic Receipt Generation and Verification

**Files:**
- Create: `tools/ui-migration/generate-ui-wp1-current-main-receipt.js`
- Create: `tools/ui-migration/verify-ui-wp1-current-main-receipt.js`
- Modify: `tests/ui-migration/ui-wp1-current-main-receipt.test.js`

**Interfaces:**
- Produces CLIs:

```bash
node tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  --repository-root <path> \
  --base <trusted-main-sha> \
  --reviewed-head <reviewed-code-sha> \
  --branch feat/unified-ui-product-shell-wp1-red-contracts-v2 \
  --output governance/ui-migration/ui-wp1-current-main-receipt.json

node tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  --check \
  --repository-root <path> \
  --receipt governance/ui-migration/ui-wp1-current-main-receipt.json \
  --base <trusted-main-sha> \
  --head <candidate-sha> \
  --branch feat/unified-ui-product-shell-wp1-red-contracts-v2
```

- [ ] **Step 1: Implement trusted Git adapters**

Use `execFileSync('git', args, options)` only, explicit repository root, `GIT_NO_REPLACE_OBJECTS=1`, `GIT_TERMINAL_PROMPT=0`, stripped repository/object/config override variables, bounded timeout/buffer, no shell interpolation, NUL-framed changed-file transport, and fatal UTF-8 decoding through the normative path procedure.

- [ ] **Step 2: Implement deterministic generation and `--check` verification**

Generation refuses dirty worktrees, missing ancestry, altered trusted static authority or approved design snapshot bytes, wrong branch, out-of-scope paths, and receipt self-inclusion. Both generation and `--check` use the canonical receipt JSON serializer above. `--check` regenerates in memory and compares exact UTF-8/LF buffers without rewriting.

- [ ] **Step 3: Run GREEN tests**

```bash
node --check tools/ui-migration/generate-ui-wp1-current-main-receipt.js
node --check tools/ui-migration/verify-ui-wp1-current-main-receipt.js
node --test --test-concurrency=1 \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js \
  tests/wp0/ui-migration-work-package-authorization.test.js
```

- [ ] **Step 4: Commit implementation**

```bash
git add \
  tools/ui-migration/generate-ui-wp1-current-main-receipt.js \
  tools/ui-migration/verify-ui-wp1-current-main-receipt.js \
  tests/ui-migration/ui-wp1-current-main-receipt.test.js
git commit -m "feat(ui): implement deterministic current-main receipts"
```

Do not create the real receipt on the prerequisite capability branch.

---

### Task 14: Define the Base-Owned Execution Gate RED

**Files:**
- Create: `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`

**Interfaces:**
- Produces: workflow and delegated-authority contracts requiring base-owned evaluation.

- [ ] **Step 1: Add workflow structure contracts**

Require the permanent workflow to resolve exact PR base and Head, create a detached base worktree, execute policy/static authority from the base, pass explicit implementation branch identity, run the focused contract exactly once, and reject candidate-owned verifier execution, broad globs, duplicate invocation, `continue-on-error`, warning-only closure, and shell suppression.

- [ ] **Step 2: Add delegated-authority contracts**

Recognize only `feat/unified-ui-product-shell-wp1-red-contracts-v2`; verify static authority and approved design snapshot bytes from the PR base; verify receipt bytes, trusted-base ancestry, exact path digest; exclude only `governance/ui-migration/ui-wp1-current-main-receipt.json`; deny near-match branches; deny candidate mutation of policy/static authority/workflow/verifier; return `readyForPromotion=false`.

- [ ] **Step 3: Run and confirm causal RED**

```bash
node --test --test-concurrency=1 \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
```

Expected: failures only for the absent base-owned UI gate behavior.

- [ ] **Step 4: Commit tests only**

```bash
git add \
  tests/layered-ci/ui-migration-base-owned-gate.test.js \
  tests/layered-ci/ui-product-shell-wp0-routing.test.js \
  tests/wp0/implementation-branch-policy.test.js
git commit -m "test(wp0): require base-owned UI migration gate"
```

---

### Task 15: Integrate the Base-Owned UI Migration Gate

**Files:**
- Modify: `.github/workflows/stage-6459-wp0-gates.yml`
- Modify: `shared/release/implementationBranchPolicy.js`
- Modify: `tools/wp0/work-package-scope-gate.js`
- Modify: `tests/layered-ci/ui-migration-base-owned-gate.test.js`
- Modify: `tests/layered-ci/ui-product-shell-wp0-routing.test.js`
- Modify: `tests/wp0/implementation-branch-policy.test.js`

**Interfaces:**
- Consumes: pure policy, static package, deterministic receipt verifier.
- Produces: permanent base-owned evaluator for the future UI-WP1 RED branch.

- [ ] **Step 1: Extend the existing delegated-authority mechanism**

Add one UI migration authority descriptor. Do not create a parallel generic branch-authority registry. The descriptor points to the trusted static authorization path and exact future branch.

- [ ] **Step 2: Isolate candidate evidence from base-owned semantics**

`tools/wp0/work-package-scope-gate.js` reads policy, static authority, and approved design snapshot bytes from the base worktree. It reads only candidate receipt bytes and candidate changed-file evidence from the candidate tree. Use strict Buffer/NUL-framed Git evidence, verify clean worktree and ancestry, exclude exactly the receipt path, delegate semantics to `uiMigrationWorkPackagePolicy.js`, and deny promotion/production.

- [ ] **Step 3: Update the permanent workflow**

Applicable future UI branches execute the base-owned evaluator. Candidate changes to workflow, policy, static authority, design snapshot, or verifier cannot change the evaluator or authority used for that run.

- [ ] **Step 4: Run focused GREEN tests**

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

- [ ] **Step 5: Run repository-level verification**

```bash
npm run test:wp0
npm run test:security-scan
node tools/protocol/validate-v3-protocols.js
git diff --check
```

- [ ] **Step 6: Commit the reviewed code Head**

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

Record as `reviewedCodeHead`.

---

### Task 16: Complete Cross-Platform Verification and Merge the Capability

**Files:** No planned file changes. A discovered defect requires a new focused failing test before repair.

**Interfaces:**
- Consumes: `reviewedCodeHead`.
- Produces: trusted main with all prerequisite capabilities base-owned.

- [ ] **Step 1: Verify Linux from a clean dependency install**

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

- [ ] **Step 2: Verify Windows**

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

- [ ] **Step 3: Run mutation controls**

Mutate base SHA, branch name, static authority blob, approved design snapshot digest/bytes, companion digest, duplicate path, non-canonical path, extra post-review path, candidate-owned verifier, receipt key order/CRLF/final-LF, Git replacement/config injection, and active-handoff observation. Every authority or canonical-byte mutation must fail; active-handoff-only mutation must leave static authorization and receipt bytes unchanged.

- [ ] **Step 4: Open the prerequisite capability PR**

The PR records every test-only RED Head, causal failure, reviewed code Head, exact path set/digest, approved design snapshot path/digest, Linux/Windows results, confirmation that no real receipt exists, and confirmation that no Product Shell/source copy/distribution/cutover authority exists.

- [ ] **Step 5: Require independent review and explicit user approval**

All P0/P1 findings and unresolved threads must be zero. Merge only through an ordinary two-parent merge commit after explicit user approval.

- [ ] **Step 6: Verify merged main**

Run the focused contracts and permanent WP0 suite at the exact merge commit. Confirm the exact router, UI routes, static authority, approved design bytes, pure policy, receipt tools, and evaluator are now base-owned.

- [ ] **Step 7: Close superseded historical UI authorization PRs**

After merged-main verification, close PR #65 and PR #85 unmerged as superseded historical evidence. Do not delete their history or use them as implementation parents.

---

### Task 17: Stop at the Prerequisite Boundary

**Files:** None.

**Interfaces:**
- Consumes: exact merged main from Task 16.
- Produces: authorization to write a separate plan for the 28-path RED branch, not authorization to implement Product Shell GREEN.

- [ ] **Step 1: Verify definition of done**

The prerequisite is complete only when:

- PR #90 and PR #91 remain closed and unmerged as historical evidence;
- the replacement design/plan PR is ordinarily merged;
- schema-v3 WP0 governance routing contains no `governancePrefixes` field;
- every reviewed governance path is literal and every unregistered near match is denied governance routing;
- the nine-path UI route bootstrap is ordinarily merged after exact-route hardening;
- one root-agnostic static package exists in `main`;
- the approved design snapshot is bound by exact trusted-base path and SHA-256 bytes;
- no executable current-main or active-handoff identity exists in that static package;
- deterministic receipt generation and verification pass real temporary-repository tests on Linux and Windows;
- candidate-owned policy, authority, design snapshot, verifier, and workflow changes cannot authorize a future candidate;
- permanent WP0 evaluates the exact future branch using policy and authority from the exact PR base;
- full WP0, security, protocol, and focused suites are GREEN;
- no UI implementation, source copy, distribution, cutover, production, release, publish, or promotion authority has been granted.

- [ ] **Step 2: Stop**

The next plan may create only `feat/unified-ui-product-shell-wp1-red-contracts-v2` with the already approved 28-path causal RED set. It may not add `src/shell/**`, `src/components/**`, adapter implementations, source transplants, production integration, or legacy frontend mutations.
