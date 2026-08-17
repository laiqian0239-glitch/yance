# Yance Fast Landing Execution Mode V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make batch causal closure the durable repository-default execution mode so Yance work packages stop serializing one importer or physical boundary into one full CI cycle unless a real governance or causal boundary requires it.

**Architecture:** Reuse the existing repository-level `AGENTS.md` execution authority and the existing WP0 test discovery. Add one focused contract that prevents the fast-landing policy from silently disappearing, then strengthen `AGENTS.md` with stable policy markers and explicit batching, validation-tier, parallel-bucket, and split-exception rules. No new runtime, scheduler, workflow engine, or Yance-built infrastructure is introduced.

**Tech Stack:** Markdown repository policy, Node.js `node:test`, existing `tools/wp0/run-tests.js` discovery.

## Global Constraints

- No temporary bypasses or validation weakening.
- Failure-first and exact authorization remain mandatory.
- Mature OSS remains preferred over new Yance-built infrastructure.
- Exact branch-scoped/base-owned governance overrides this general protocol when it is more specific.
- Full final gates, independent review, and merge authorization are never skipped for speed.

---

### Task 1: Lock the durable fast-landing contract

**Files:**
- Create: `tests/wp0/agent-fast-landing-protocol.test.js`

**Interfaces:**
- Consumes: repository root `AGENTS.md`.
- Produces: WP0-discovered assertions for mandatory policy markers and preserved failure-first/authorization boundaries.

- [x] **Step 1: Write the failing test**

The test requires the mandatory heading, five stable policy markers, same-root source-graph exhaustion, same-head causal RED evidence, `unknownBlockers = 0`, authorization-boundary handling, and an explicit statement that fast landing never skips failure-first/final gates.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/wp0/agent-fast-landing-protocol.test.js`

Observed: 2 tests, 0 pass, 2 fail on the pre-change protocol because the mandatory fast-landing section and markers were absent.

- [x] **Step 3: Commit the tests-only RED contract**

Commit: `d14234cba713af1f722b544e3f7f35bbc405a988`.

---

### Task 2: Strengthen the existing repository execution authority

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: existing `Fast Closure V2`, multi-RED diagnostic window, Closure Matrix, focused-to-final validation, and precedence rules.
- Produces: mandatory batch-causal-closure default without changing implementation/merge authority.

- [x] **Step 1: Add stable policy markers**

Added exactly:

```text
FAST_LANDING_DEFAULT=batch_causal_closure
MICRO_SCOPE_SERIALIZATION=forbidden_by_default
FULL_GATE_CADENCE=stable_batch_only
INDEPENDENT_BUCKETS=parallel_by_default
FINAL_CLOSURE_PREP=parallel_by_default
```

- [x] **Step 2: Define batch causal closure**

Requires one same-root source graph and Closure Matrix across writers, importers, transitive consumers, fallbacks, retry/recovery/timer owners, platform bridges, and physical I/O boundaries. Once `unknownBlockers = 0`, speculative diagnostic expansion stops and the cohesive root fix proceeds as one production batch.

- [x] **Step 3: Forbid default micro-scope serialization**

The protocol forbids `one importer -> one scope -> one full CI cycle` when several same-root paths are already discoverable inside current authorization. Splitting is limited to real authorization/scope, immutable topology, file/authority collision, causal dependency, external resource, independent review, or final merge boundaries.

- [x] **Step 4: Define validation tiers and parallel buckets**

The protocol separates diagnostic/focused, work-package focused, and full routed final gates, and makes independent closure/final-preparation buckets parallel by default when they do not share mutable authority/files/topology/dependencies.

- [x] **Step 5: Preserve safety invariants**

The protocol explicitly states that fast landing never means skipping failure-first, scope authorization, independent review, final full gates, OSS admission, or merge authorization.

Implementation commit: `b814d31030092cee90b194044cfed78eac2619d8`.

---

### Task 3: Verify and publish the governance change

**Files:**
- Test: `tests/wp0/agent-fast-landing-protocol.test.js`
- Verify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 1 contract and Task 2 policy.
- Produces: a reviewable governance PR based on fresh main.

- [ ] **Step 1: Run focused GREEN verification**

Run: `node --test --test-concurrency=1 tests/wp0/agent-fast-landing-protocol.test.js`

Expected: 2 tests, 2 pass, 0 fail.

- [ ] **Step 2: Run repository WP0 discovery on exact GitHub PR head**

Run through the repository's routed CI / `npm run test:wp0`. `tools/wp0/run-tests.js` automatically discovers the new `tests/wp0/*.test.js` contract.

- [ ] **Step 3: Fresh-verify main and branch diff**

Confirm branch base remains trusted main `54b508adccb9ce07c9b4fd750f198a37b52f2076` and changed paths are limited to this plan, `AGENTS.md`, and the focused contract.

- [ ] **Step 4: Open a PR and stop at the final merge boundary**

Use an ordinary merge when repository governance authorizes merge. Do not squash/rebase if ordinary/two-parent merge is required.
