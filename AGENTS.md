# Yance Agent Execution Protocol

This file is durable, repository-level execution guidance for AI/coding agents working on Yance. It exists so a new chat/session can recover the project operating mode from the repository instead of relying on conversational memory.

## Precedence

1. Trusted repository policy/code and merged governance authorizations are authoritative.
2. Exact branch-scoped authorization and base-owned policy contracts override this document when they are more specific about scope, evidence, topology, safety, or merge authority.
3. The execution-method invariants in **First execution principle — shortest path to Release** are repository-global defaults and MUST NOT be weakened by issue/controller comments, chat/session summaries, ad-hoc scripts, temporary helper instructions, work-package handoffs, or lower-level process documents. Relaxing one of those execution-method invariants requires an explicit merged change to this file authorized by the owner; a later comment or helper cannot silently override it.
4. This document never grants implementation or merge authority by itself.

## First execution principle — shortest path to Release (mandatory)

This is the highest-priority default execution rule in this repository. Apply it before every action, in every new chat/session, and again whenever a work package has accumulated multiple diagnostic or harness steps. It never overrides a more-specific trusted authorization or safety/policy contract; within those boundaries, it decides which allowed action is worth doing next.

Stable policy markers:

```text
FIRST_EXECUTION_RULE=mature_authority_then_thin_integration_then_direct_product_diff
RELEASE_PROGRESS_UNIT=production_diff_to_local_closure_to_exact_head_to_ci_to_merge_to_rc_to_windows_uat_to_release
ONE_ROOT_ONE_BATCH_ONE_HEAD=mandatory
LOCAL_FIRST=mandatory
EVIDENCE_REUSE=mandatory
CI_ROLE=validator_not_debugger
UAT_ROLE=final_proof_not_debugger
HARNESS_ROLE=validator_not_product
HELPER_INFRASTRUCTURE_DRIFT=forbidden
REOPEN_CONSUMED_GREEN=forbidden
CONTROLLER_VERSION_GROWTH_IS_PROGRESS=false
EXACT_SOURCE_BEFORE_PRODUCT_MUTATION=mandatory
SPECULATIVE_LOCAL_PATCH_LOOP=forbidden
USER_MACHINE_ROLE=deterministic_apply_or_required_windows_proof
SAME_PURPOSE_HELPER_RED_RETRY=forbidden
PRELAUNCH_HELPER_RED_IS_PRODUCT_REGRESSION=false
```

Before executing any action, answer all of the following:

1. Does this action directly shorten the causal path to Release?
2. Is the current root cause already bounded tightly enough to produce or validate the real production diff?
3. Has the relevant mature upstream or existing repository authority been read completely enough to avoid reimplementing its behavior?
4. Can the risk be proved locally without creating a new SHA, CI run, RC, artifact, or user-operated debugging loop?
5. Is the evidence already available from GitHub, an existing local proof, source/diff inspection, or a previously consumed GREEN/RED?
6. Is this action creating a second authority, helper framework, proof framework, workspace emulator, build-system emulator, package-manager emulator, runtime supervisor, route registry, translation engine, state machine, or other general-purpose infrastructure that the mature owner already provides?
7. If the mutation depends on local worktree bytes, do I have the exact current bytes? If not, stop and obtain the exact file bytes once instead of testing formatting/path/source-shape guesses on the user's machine.
8. Is any requested local command deterministic and pre-reviewed against its exact inputs, or is it merely discovering the next assumption? If it is exploratory, do not send it to the user.

If an action does not directly advance the current production causal batch, close a real authorization boundary, or produce a required promotion proof, do not do it.

### Mature authority first / no self-reinvention

- Read the pinned upstream and repository's existing production authority before designing a replacement, helper, or workaround.
- Reuse the mature authority as a whole where practical. Prefer the existing public seam plus the thinnest Product projection/adapter.
- Do not manually emulate package-manager/workspace resolution, Element/Matrix runtime behavior, process supervision, readiness/state machines, IPC, locking, transactions, persistence, migration, retry/recovery, routing, translation, Electron native integration, or other mature infrastructure merely to make a local proof convenient.
- If the public seam genuinely does not exist, add only the narrowest additive seam required by the current root cause, within explicit authorization.
- A validation convenience is never sufficient justification for new production or proof infrastructure.

### Harness and helper containment

- A harness validates the Product; it must not become another product, build system, dependency manager, workspace implementation, runtime authority, or long-lived helper framework.
- When a harness/helper fails because of its own environment, materialization, path assumption, source-shape assumption, or operator flow, classify that as harness/helper RED, freeze the evidence, and return to the shortest mature-authority path. Do not start a chain of helper-on-helper repairs unless the helper itself is a required trusted production authority.
- Do not rebuild a mature upstream distribution when the affected Product contract is a thin module/projection seam and the mature runtime can be reused.
- Do not use CI or Windows UAT to discover bugs that source inspection, focused local tests, fixtures, or Local Release Harness can prove first.

### Exact-source and user-operator containment (non-waivable execution invariant)

These rules exist specifically to prevent repeated local trial-and-error from replacing engineering work:

- When the current local worktree bytes are the mutation authority, obtain those exact bytes before designing the mutation. Connector-visible `main`, screenshots, console excerpts, remembered line shapes, and partial source snippets are not substitutes for the exact local file.
- If exact local bytes are not directly accessible to the agent, ask for the relevant file(s) to be uploaded once. Do not ask the user to run successive `Get-Content`, regex, matcher, path-discovery, or source-shape scripts merely to reconstruct a file indirectly.
- Never send a speculative patch/matcher to the user's machine to discover whether a source shape happens to match. Build and inspect the exact patch against exact input bytes first; only then may a local command apply that pre-reviewed deterministic patch.
- A local mutation command must have fixed authorized paths, fixed expected input identity or exact uploaded bytes, deterministic transformation semantics, and explicit postconditions before it is sent. If those conditions are not known, the command is not ready.
- A helper/matcher/script RED caused by source formatting, path assumptions, shell/PowerShell binding, staging topology, or helper logic is **not Product RED**. Freeze it as helper evidence and do not rerun or replace it with another same-purpose speculative helper. Re-anchor on exact source/authority before any further local action.
- After one same-purpose helper RED, the next user-operated action for that root cause must be either (a) application of an exact pre-reviewed production patch, or (b) a required real Windows/runtime proof. Another exploratory helper iteration is forbidden.
- A pre-launch helper failure cannot reclassify a previously proven login/startup/runtime capability as regressed. A Product regression requires Product/runtime evidence at the affected authority, not a failed mutation helper.
- The user's Windows machine is a final local executor and real-Windows proof surface, not a debugger for agent assumptions. Remote/source/GitHub/upstream reasoning must be exhausted first.
- Repeated local command loops without a production diff or promotion-state advance are a controller failure. Stop the loop and redesign the execution path instead of asking for another retry.

### Release velocity correction — mandatory operating direction

The main causes of slow release closure are execution drift, not lack of activity. Treat these as stop-signs:

- repeated controller-state/comment growth without a corresponding production diff or promotion-state advance;
- repeated re-reading or rerunning of consumed evidence;
- turning the user into a shell executor for hypotheses that can be settled by GitHub/source/upstream inspection first;
- more than one user-operated helper attempt for the same production mutation without producing the intended production diff;
- serial helper/harness iterations that each expose another setup problem instead of the Product root cause;
- classifying a pre-launch helper or patch-program failure as a Product/login/runtime regression without runtime evidence;
- manually simulating a mature upstream workspace/build/runtime contract without first reading the complete owner contract;
- broad rebuilds, package acquisition, environment repair, or capability census when the current root cause has already narrowed to a small Product seam;
- creating additional prerequisite, governance, helper, proof, or framework work that does not close a real authorization boundary or shorten the Release path.

The default optimal release path is therefore:

```text
fresh controller/main evidence
-> lock one root cause
-> exhaust same-root risk from existing authority/source evidence
-> select mature upstream/repository authority
-> obtain exact mutation source bytes when local bytes are authoritative
-> make and review one cohesive authorized production causal batch
-> focused local proof + affected-risk Local Release Harness
-> one Exact Head
-> one CI event
-> GREEN => ordinary merge immediately
-> one RC
-> one real Windows UAT
-> GREEN => Release immediately
```

Operational consequences:

- Controller State versions are bookkeeping, not progress. Progress is measured only by production causal closure and promotion state.
- Once the root cause is sufficiently proven, stop diagnostic expansion and produce the production diff.
- When exact local bytes are needed, obtain them directly or by one file upload before mutation; never substitute repeated operator-run discovery scripts.
- Before any user-operated mutation command, the patch must already be exact, reviewed against exact bytes, and limited to authorized paths. The user's machine applies/proves; it does not discover the patch.
- Once local closure is GREEN, do not add “one more” helper, census, rebuild, or speculative proof before Exact Head.
- One Exact Head should receive one equivalent validation event. Never rerun the same CI merely for reassurance.
- One production candidate should produce one RC and one final Windows UAT unless a genuine new Product bug invalidates candidate bytes.
- If UAT discovers a bug, close the Product root cause locally and improve the existing regression/harness seam that should have caught it; do not normalize UAT as the debugger.
- Ask the user for Windows-local execution only when the required proof truly needs the user's machine. First settle all source, GitHub, upstream, diff, workflow, log, and authority questions that can be settled remotely, then provide one complete self-contained fail-fast script rather than an interactive sequence of exploratory commands.

## Default execution mode

- Work in complete work packages and continue through dependent tasks without stopping for approval at every small Task.
- Stop only at a real causal RED requiring diagnosis, an authorization boundary, an external permission/resource boundary, or a final merge boundary that requires owner authorization.
- Do not use temporary bypasses, validation weakening, placeholder evidence, permissive fallbacks, renamed fallbacks, or ancestry tricks. Root-fix the underlying contract or implementation.
- Prefer mature OSS as a whole over new Yance-built infrastructure. Any new Yance infrastructure must first satisfy the repository's V2.1 OSS-fit admission requirements.
- Use GitHub connector/API operations for repository work whenever possible. Ask for local-machine commands only when the connector cannot perform the required operation; keep local commands minimal and avoid disturbing unrelated local staged/working-tree changes.
- When the connector cannot see the exact dirty/local mutation bytes, prefer one direct file upload over an operator-driven series of shell probes. Do not reconstruct exact source through trial-and-error commands.

## Fast Landing Execution Mode (mandatory)

Fast Landing is the repository-default execution cadence for governed Yance work. It changes batching and validation cadence, not quality or authorization requirements.

Stable policy markers:

```text
FAST_LANDING_DEFAULT=batch_causal_closure
MICRO_SCOPE_SERIALIZATION=forbidden_by_default
FULL_GATE_CADENCE=stable_batch_only
INDEPENDENT_BUCKETS=parallel_by_default
FINAL_CLOSURE_PREP=parallel_by_default
```

### Batch causal closure is the default

- For one root cause, source-closure family, or authority cutover, discover the complete currently observable same-root source graph before the first production root-fix batch. The graph must cover known authority writers, importers, transitive consumers, fallbacks, retry/recovery/timer owners, platform bridges, and physical I/O boundaries that can participate in the defect.
- Convert the discovered same-root paths into one Closure Matrix and one diagnostic batch. Each newly proven boundary still requires its own same-head causal RED evidence where governance requires failure-first proof, but several already-discoverable same-root boundaries should be locked in the same diagnostic window instead of being serialized into one work package per importer.
- A discovered path outside the effective authorization remains an authorization boundary: record the causal evidence, obtain the exact same-work-package scope amendment, and do not touch the path before that amendment is effective.
- Close the diagnostic window when the same-root source graph is exhausted, the Closure Matrix explains every known boundary, and `unknownBlockers = 0`. After that point, stop speculative RED expansion and implement the cohesive root fix as one production batch.

### Micro-scope serialization is forbidden by default

Do not use the pattern `one importer -> one scope -> one full CI cycle` when multiple same-root paths are already discoverable and authorized. Split a batch only when at least one real boundary exists:

- an authorization or exact-path scope amendment is required;
- immutable commit/topology policy requires a dedicated head or commit boundary;
- two buckets mutate the same authoritative file/state and cannot be safely isolated;
- a true causal dependency requires one fix to exist before another can be validated;
- an external permission, secret, platform, artifact, or owner resource boundary blocks continuation;
- an independent-review boundary requires a stable reviewed head;
- the final merge boundary requires owner authorization.

Convenience, habit, or CI latency alone is not a valid reason to serialize same-root work into micro-scopes.

### Validation cadence

- Tier 1 — diagnostic/focused: during source-graph discovery and implementation, run the narrowest scanner, contract, and behavior tests that prove the currently edited causal boundaries.
- Tier 2 — work-package focused: when the root-fix batch stabilizes, run the complete authorized focused suite for the affected work package and exact implementation head.
- Tier 3 — full routed gates: run Stage/WP0, ACV2, cross-platform, sealed-runtime/model/product gates, independent review, and other routed final gates on the stable batch before review/seal/merge. Do not repeat the entire full-gate matrix after every individual importer unless a more-specific trusted authorization or base-owned policy explicitly requires that exact-head cadence.
- A skipped job is never GREEN. Preserve existing exact-head, cross-platform, immutable evidence, and final-gate semantics.

### Parallel closure buckets

- Independent closure buckets are parallel by default when they do not share mutable authority, files, immutable topology, or a causal dependency. Typical independent buckets include lifecycle/retry closure, outbound physical-boundary closure, media/history recovery closure, and OSS provenance/evidence preparation.
- Final-closure preparation is parallel by default: matrix harnesses, NOTICE/license/SBOM/provenance inputs, post-merge validation contracts, and independent-review inputs may be prepared while source closure continues, provided their final hashes/heads are bound only after the implementation head stabilizes.
- Parallel preparation must not fabricate final evidence, freeze stale digests, or claim GREEN before the exact final head is verified.

### Safety invariants

Fast Landing never means skipping failure-first, scope authorization, independent review, or final full gates. It also never permits temporary bypasses, contract weakening, fake evidence, unreviewed OSS admission, blind retry, hidden parallel authority, or crossing an explicit merge boundary without authorization. Speed comes from larger same-root batches, early complete discovery, validation layering, and safe parallelism—not from reducing correctness.

## Fast Closure V2

Fast Closure V2 is the default governed implementation shape when a work package is failure-first and the root cause may span more than one boundary.

Fast Closure V2 is effective only when the merged authorization and base-owned trusted parser/policy can enforce the required diagnostic-window and first-production-commit semantics. If the trusted parser still binds RED evidence to a fixed commit ordinal instead of the first production commit, do not begin governed implementation; close that parser-policy gap first rather than simulating Fast Closure V2 in process or commit-message convention.

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

## V21 Release Closure Program (mandatory)

For V21 final release closure, `docs/uat/V21_RELEASE_CLOSURE_PROGRAM.md` and `docs/uat/V21_RELEASE_CLOSURE_LEDGER.md` are mandatory operating inputs in addition to this protocol.

- The 2026-08-20 audit is `Known Findings V1`, not an exhaustive bug universe. All of its P0/P1 findings must be reconciled, but release work must also perform a new independent fresh-main audit.
- A finding is not closed merely because a PR merged. Closure must reach the relevant chain: `finding -> causal RED -> root cause -> authorized fix -> mandatory executed test -> exact-head GREEN -> packaged/UAT evidence when applicable`.
- Test-file presence is not coverage. Critical release requirements require proof that the test is actually enumerated by a runner, invoked by a mandatory gate on the exact head, executed, and PASS. Missing links are `NO_COVERAGE` release blockers.
- Run three independent release-discovery views before RC freeze: Known Findings V1 reconciliation, Fresh-main Release Audit V2, and a production Delta Regression Audit from the 2026-08-20 audited baseline to the final candidate main.
- Independent P0/P1 buckets and release-preparation work remain parallel by default under Fast Landing. Do not serialize unrelated buckets behind CI latency.
- PR #538 is historical UAT/provenance evidence only and must not be treated as the current or final V21 release candidate. Preserve its history; generate the final release candidate from a new fresh-main RC freeze point.
- The final release candidate must be validated as the actual packaged Windows product. Source/browser/runtime surrogates are supporting evidence, not a substitute for release-level packaged UAT.
- Any packaged-UAT P0/P1 returns to Fast Landing causal closure. If candidate bytes change, stale final-RC evidence must not be reused.
- Formal release/publish remains blocked until the Release Closure Ledger has zero open P0/P1, zero critical `NO_COVERAGE`, applicable exact-head gates are GREEN, independent review is P0=0/P1=0 with zero unresolved threads, packaged Windows RC UAT passes, provenance is bound to the exact RC, fresh-main anti-drift is clean, and the owner authorizes the final release boundary.

The Release Closure Ledger is the global operational SSOT for final release readiness. Individual PR descriptions and chat/session summaries are evidence inputs, not substitutes for the ledger.

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
