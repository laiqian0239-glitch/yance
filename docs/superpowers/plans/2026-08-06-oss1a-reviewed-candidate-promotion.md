# OSS-1A Reviewed Candidate Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the independently reviewed OSS-1A Task 11 exact head into a fail-closed reviewed-candidate role without modifying implementation history or weakening permanent WP0.

**Architecture:** First prove whether the existing permanent WP0 recognizes a `reviewed-candidate/` branch purely from PR head identity by creating an exact same-tree ref and continuation PR. If that remains RED, generalize the existing A6 reviewed-candidate manifest contract by replacing PR-5-specific draft binding with a manifest-bound pull request rule, add an OSS-1A manifest bound to PR #24 review evidence, and add a trusted registration workflow that validates the exact graph, scope digest, review payload and required Actions runs before creating or advancing the reviewed-candidate ref.

**Tech Stack:** GitHub refs and pull requests, Node.js 22, built-in `node:test`, GitHub Actions, existing `tools/layered-ci/reviewed-candidate.js` and independent-review contract.

## Global Constraints

- No force push, rebase, squash, or history rewrite.
- No temporary bypass, warning-only success, wildcard path authorization, or gate weakening.
- The reviewed candidate must remain bound to `3e3a52ed9dd255ca5ba027a3b12704b5e281448d`.
- Review evidence must remain bound to PR #24 review ID `4868185392` and exact reviewed head.
- Any new implementation commit invalidates the review and requires a new review.
- Source merge approval does not authorize production promotion or formal release.

---

### Task 1: Same-tree reviewed-candidate role probe

**Files:**
- No repository file changes.

**Interfaces:**
- Produces: branch `reviewed-candidate/oss1a-task11` and a Draft continuation PR against `governance/oss-1a-canonical-projection-checkpoint-authorization`.

- [ ] Create the branch at exact SHA `3e3a52ed9dd255ca5ba027a3b12704b5e281448d`.
- [ ] Create a Draft PR with the same base as PR #24.
- [ ] Verify the PR head SHA equals the reviewed SHA and the compare relation to PR #24 head is identical.
- [ ] Observe permanent WP0. Treat acceptance as GREEN and any branch-role rejection as the required RED for Task 2.

### Task 2: Generalize reviewed-candidate manifest draft binding

**Files:**
- Modify: `tests/layered-ci/reviewed-candidate.test.js`
- Modify: `tools/layered-ci/reviewed-candidate.js`

**Interfaces:**
- Produces: `validateManifest(manifest)` accepting `governance.pullRequestMustRemainDraft === true` for any positive manifest `pullRequest` while preserving compatibility with the A6 manifest.

- [ ] Add failing tests for PR #24 and rejection of missing/false generic draft binding.
- [ ] Run `node --test --test-concurrency=1 tests/layered-ci/reviewed-candidate.test.js` and witness RED.
- [ ] Replace the hard-coded `pr5MustRemainDraft` check with exact generic draft binding while accepting the historical A6 field only for PR #5.
- [ ] Re-run the test and witness GREEN.

### Task 3: OSS-1A reviewed-candidate manifest and review binding

**Files:**
- Create: `governance/layered-ci/reviewed-candidate-oss1a-task11.json`
- Create: `tests/layered-ci/reviewed-candidate-oss1a.test.js`

**Interfaces:**
- Manifest binds repository, PR #24, implementation branch, governance base, reviewed head, branch tip, exact changed-file count/digest, zero post-review implementation commits, review ID and review protocol fields.

- [ ] Write a failing repository contract requiring the manifest and exact identities.
- [ ] Compute changed paths from `87a855ce63ac1c00c1414fc234234b070a66376c..3e3a52ed9dd255ca5ba027a3b12704b5e281448d` and seal count plus SHA-256.
- [ ] Add the manifest with `readyForPromotion=false`, no wildcard authorization and no post-review paths.
- [ ] Run layered-CI tests and witness GREEN.

### Task 4: Trusted registration workflow

**Files:**
- Create: `.github/workflows/register-reviewed-candidate-oss1a.yml`
- Create: `tests/layered-ci/reviewed-candidate-oss1a-workflow.test.js`

**Interfaces:**
- Workflow validates the manifest from trusted source, fetches PR #24 reviews, selects the exact current-head structured review, validates required successful workflow runs, verifies branch graph and scope, then creates or fast-forwards only `reviewed-candidate/oss1a-task11`.

- [ ] Write workflow source contract and witness RED.
- [ ] Implement workflow with job-scoped permissions, no candidate-controlled validator, no force update and exact post-write ref verification.
- [ ] Run workflow and layered-CI contracts and witness GREEN.

### Task 5: Permanent WP0 reviewed-candidate verification

**Files:**
- Modify only if the Task 1 role probe proves current policy lacks reviewed-candidate recognition: the exact branch-role policy file and its existing test.

**Interfaces:**
- Produces: permanent WP0 acceptance only when the branch name, manifest reviewed head, PR review and current ref are all exact.

- [ ] Add the observed branch-role RED as a failing contract.
- [ ] Implement manifest-backed recognition rather than a branch-prefix allowlist.
- [ ] Run permanent WP0, OSS-1A, provenance, protocol, secret scan and sealed Ubuntu/Windows export checks.
- [ ] Confirm the reviewed-candidate PR has no RED checks before any merge action.
