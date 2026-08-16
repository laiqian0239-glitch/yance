# Yance Agent Execution Protocol

This file is durable, repository-level execution guidance for AI/coding agents working on Yance. It exists so a new chat/session can recover the project operating mode from the repository instead of relying on conversational memory.

## Precedence

1. Trusted repository policy/code and merged governance authorizations are authoritative.
2. Exact branch-scoped authorization and base-owned policy contracts override this document when they are more specific.
3. This document never grants implementation or merge authority by itself.

## Default execution mode

- Work in complete work packages and continue through dependent tasks without stopping for approval at every small Task.
- Stop only at a real causal RED requiring diagnosis, an authorization boundary, an external permission/resource boundary, or a final merge boundary that requires owner authorization.
- Do not use temporary bypasses, validation weakening, placeholder evidence, permissive fallbacks, renamed fallbacks, or ancestry tricks. Root-fix the underlying contract or implementation.
- Prefer mature OSS as a whole over new Yance-built infrastructure. Any new Yance infrastructure must first satisfy the repository's V2.1 OSS-fit admission requirements.
- Use GitHub connector/API operations for repository work whenever possible. Ask for local-machine commands only when the connector cannot perform the required operation; keep local commands minimal and avoid disturbing unrelated local staged/working-tree changes.

## Fast Closure V2

Fast Closure V2 is the default governed implementation shape when a work package is failure-first and the root cause may span more than one boundary.

### Multi-RED diagnostic window

- Production implementation is forbidden until the diagnostic window is closed.
- The first implementation commit remains tests-only and must satisfy the exact merged authorization.
- After the first fresh causal RED, additional tests-only diagnostic commits are allowed before production implementation when each new RED proves another boundary of the same root cause.
- Every diagnostic commit must contain no production implementation change, stay inside the currently authorized diagnostic/test scope, and obtain its own fresh causal RED on that exact head.
- A RED that proves a new path is required does not authorize using that path. If the path is outside the merged authorization, merge a same-work-package governance scope amendment first; do not restart the implementation under a renamed V2/V3 branch merely because the same root cause expanded.
- Stop adding REDs when the closure audit demonstrates the same-root authority boundary is exhausted and unknown blockers are zero. Do not create speculative tests after that point.

### Closure Matrix gate

Before the first production implementation commit, perform a same-root closure audit and record a Closure Matrix covering every known authority writer, fallback, source, projection, consumer, executable governance proof, and preservation contract that can participate in the defect.

The matrix must classify each boundary as one of: `ROOT_IMPLEMENTATION`, `PRESERVE`, `NEGATIVE_PROOF`, or `OUT_OF_ROOT_CAUSE_WITH_EVIDENCE`.

The production gate is closed unless all of the following are true:

- every known same-root boundary is represented in the matrix;
- every newly discovered boundary has fresh causal evidence;
- no authorized production path remains unexplained;
- no same-root required path remains outside scope without a merged scope amendment;
- `unknownBlockers = 0`;
- the planned implementation is one root fix rather than multiple symptom fixes.

### Focused to final validation

- During diagnosis, use the narrowest focused tests that prove the causal boundary.
- After root implementation, run the complete authorized focused set first.
- Once the exact implementation head is stable, close independent final gates in parallel where routing permits: Stage/WP0, ACV2, Layered CI, Model/sealed-runtime validation, Graphiti/Product validation when routed, and independent review.
- A skipped job is not GREEN; report it as skipped when routing intentionally excludes it.

## Mandatory immutable/topology preflight

Before creating any commit whose position or metadata becomes immutable under governance (failure-first commit, any additional diagnostic RED commit when policy binds its evidence, first post-diagnostic production commit, authorization commit, or other policy-defined topology-sensitive commit), verify against the fresh trusted base:

1. Fresh `main`, target branch head, PR head/base, and unresolved review-thread state.
2. The exact merged authorization JSON governing the branch, including any merged same-work-package scope amendment.
3. The base-owned trusted parser/policy implementation that will evaluate the commit; do not infer exact fields from summaries or prior versions.
4. Exact branch name, allowed path set, path-set digest, parent/topology constraints, first-commit semantics, diagnostic-window semantics, and first-production-commit semantics.
5. Exact commit-trailer keys, count, spelling, values, and validation rules.
6. Exact causal RED head/run/conclusion evidence required by the trusted parser.
7. Closure Matrix status and `unknownBlockers = 0` before production implementation.
8. Independent-review and merge-method requirements.

If any exact contract item is uncertain, resolve it from trusted repository code before creating the immutable commit. Do not create the commit and rely on Stage to discover a parser/topology mismatch later.

## Failure-first / TDD sequence

For governed implementation branches that require failure-first evidence, use this order:

1. Start only from the effective authorization merge commit on fresh trusted main.
2. Run immutable/topology preflight before the first tests-only commit.
3. Create the authorized tests-only first commit with no production implementation changes.
4. Obtain a fresh causal RED on that exact head and capture the exact failing run evidence.
5. Continue the tests-only multi-RED diagnostic window only while fresh evidence discovers another boundary of the same root cause.
6. Complete the Closure Matrix and prove `unknownBlockers = 0`.
7. Re-run immutable/topology preflight against the trusted parser using the final exact RED evidence and effective authorization/scope.
8. Create the first production implementation commit once, with the exact required trailers and only authorized implementation paths.
9. Never move production implementation before the diagnostic window is closed.

## Root-cause amendment discipline

- A same-root scope amendment is a continuation of the same work package, not permission to bypass authorization.
- Scope may expand only from fresh causal evidence obtained before production implementation uses the added path.
- The amendment must preserve failure-first evidence, ordinary-merge discipline, exact-path scope, and all existing quality gates.
- Do not use a scope amendment to smuggle unrelated cleanup, refactors, dependencies, workflows, renderers, infrastructure, or speculative paths into the package.

## Immutable topology failure

If a published commit violates an immutable first-commit/first-production/topology contract:

- Do not amend, force-push, rebase, fabricate evidence, or add a descendant workaround when the trusted policy evaluates the earlier immutable commit.
- Freeze the poisoned ancestry, preserve its evidence, and use the repository's successor/restart authorization mechanism from a fresh trusted base.
- Reuse already-proven implementation content only when content equivalence is verified against the fresh base; do not reuse poisoned ancestry.

## Merge discipline

- Use ordinary merge commits when governance requires ordinary/two-parent merge.
- Do not substitute squash or rebase merges for an ordinary merge requirement.
- Fresh-verify `main`, exact PR head/base, CI/check conclusions, review state, and mergeability immediately before merge.
- Do not cross an explicit owner-authorization merge boundary without the required owner authorization.

## Session re-entry / handoff

At the start of a new chat/session, do not continue from remembered status alone. Recover the relevant branch/PR/authorization from GitHub, then fresh-verify:

- trusted `main` SHA;
- exact PR/branch head and base SHA;
- changed-path scope and commit topology when material;
- current CI/workflow conclusions and exact run IDs;
- unresolved review threads/reviews;
- effective authorization plus any same-work-package amendment;
- Closure Matrix state when the implementation has entered a diagnostic window;
- the current real boundary and next authorized action.

A work-package handoff should record exact SHAs, run/job IDs, path/digest facts, RED evidence, closure-matrix unknown count, failed policy reason codes, and the next true boundary. Ephemeral chat summaries are secondary to fresh repository state.

## Local repository safety

The usual local checkout is `C:\GitHub\yance-pr299-product-experience`. Connector-first execution is preferred specifically to avoid branch switches or commands that can overwrite unrelated local staged changes. Never discard, reset, clean, stash, or rewrite unrelated local work unless the owner explicitly directs it.
