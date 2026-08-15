# Yance Agent Execution Protocol

This file is durable, repository-level execution guidance for AI/coding agents working on Yance. It exists so a new chat/session can recover the project operating mode from the repository instead of relying on conversational memory.

## Precedence

1. Trusted repository policy/code and merged governance authorizations are authoritative.
2. Exact branch-scoped authorization and base-owned policy contracts override this document when they are more specific.
3. This document never grants implementation or merge authority by itself.

## Default execution mode

- Work in complete work packages and continue through dependent tasks without stopping for approval at every small Task.
- Stop only at a real causal RED requiring diagnosis, an authorization boundary, an external permission/resource boundary, or a final merge boundary that requires owner authorization.
- Do not use temporary bypasses, validation weakening, placeholder evidence, permissive fallbacks, or ancestry tricks. Root-fix the underlying contract or implementation.
- Prefer mature OSS as a whole over new Yance-built infrastructure. Any new Yance infrastructure must first satisfy the repository's V2.1 OSS-fit admission requirements.
- Use GitHub connector/API operations for repository work whenever possible. Ask for local-machine commands only when the connector cannot perform the required operation; keep local commands minimal and avoid disturbing unrelated local staged/working-tree changes.

## Mandatory immutable/topology preflight

Before creating any commit whose position or metadata becomes immutable under governance (failure-first commit, first post-RED implementation commit, authorization commit, or other policy-defined topology-sensitive commit), verify against the fresh trusted base:

1. Fresh `main`, target branch head, PR head/base, and unresolved review-thread state.
2. The exact merged authorization JSON governing the branch.
3. The base-owned parser/policy implementation that will evaluate the commit; do not infer exact fields from summaries or prior versions.
4. Exact branch name, allowed path set, path-set digest, parent/topology constraints, first-commit and first-post-RED semantics, and evidence requirements.
5. Exact commit-trailer keys, count, spelling, values, and validation rules.
6. Exact RED head/run/conclusion evidence required by the trusted parser.
7. Independent-review and merge-method requirements.

If any exact contract item is uncertain, resolve it from trusted repository code before creating the immutable commit.

## Failure-first / TDD sequence

For governed implementation branches that require failure-first evidence, use this order:

1. Start only from the authorized trusted base/authorization merge.
2. Create the authorized corrected tests-only first commit, with no production implementation changes.
3. Obtain a fresh causal RED on that exact head and capture the exact failing run evidence.
4. Re-run the immutable/topology preflight against the trusted parser using that exact RED evidence.
5. Create the first post-RED implementation commit once, with the exact required trailers and only authorized implementation paths.
6. Never move production implementation before the required causal RED.

## Parallel closure

Once an exact head exists, start independent gates as early and in parallel as repository routing permits: Stage/WP0, ACV2, Layered CI, Model/sealed-runtime validation, Product Final when routed, and independent review. Do not serialize independent gates merely for convenience.

A skipped job is not GREEN; report it as skipped when routing intentionally excludes it.

## Immutable topology failure

If a published commit violates an immutable first-commit/first-post-RED/topology contract:

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
- the current real boundary and next authorized action.

A work-package handoff should record exact SHAs, run/job IDs, path/digest facts, failed policy reason codes, and the next true boundary. Ephemeral chat summaries are secondary to fresh repository state.

## Local repository safety

The usual local checkout is `C:\GitHub\yance-pr299-product-experience`. Connector-first execution is preferred specifically to avoid branch switches or commands that can overwrite unrelated local staged changes. Never discard, reset, clean, stash, or rewrite unrelated local work unless the owner explicitly directs it.
