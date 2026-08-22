# V21 Release Closure Program

Status: mandatory release-closure operating model for V21

Baseline when introduced: `main@928a6b36a63b87563001f8d27b61394b8d628489`

This program extends the repository-level `AGENTS.md` Fast Landing / batch causal closure protocol for final release closure. It does not weaken any branch-scoped authorization, failure-first, exact-head, review, merge, or immutable-topology requirement.

## 1. Release objective

The release objective is not "finish the 2026-08-20 audit list". The objective is to produce one fresh-main release candidate for which all of the following are true:

1. every known P0/P1 finding is closed end-to-end;
2. a new independent fresh-main audit has no open P0/P1;
3. critical requirements have mandatory executed-test proof, not merely test-file presence;
4. the production delta since the 2026-08-20 audit has been independently reviewed for regressions;
5. all applicable exact-head routed gates are GREEN, with intentional skips reported as skips rather than GREEN;
6. a newly materialized packaged Windows release candidate passes release-level UAT;
7. review P0=0, P1=0, unresolved threads=0, and fresh-main anti-drift is clean immediately before release sealing.

No audit, test suite, or review is treated as a mathematical proof of zero bugs. Release confidence comes from independent, overlapping discovery and validation layers.

## 2. The 2026-08-20 audit is Known Findings V1, not the universe of bugs

The 2026-08-20 audit remains a required ledger source and all of its P0/P1 findings must be accounted for. It is not treated as an exhaustive list.

A finding is not CLOSED merely because a PR merged. The minimum closure chain is:

`finding -> causal RED -> root cause -> authorized production fix -> mandatory executed test -> exact-head GREEN -> packaged/UAT evidence when applicable -> CLOSED`

If any link is missing, the finding remains OPEN, PARTIAL, or NO_COVERAGE.

## 3. Fast Landing release lanes

Independent work is parallel by default. Do not serialize unrelated buckets behind one another merely because one CI matrix is still running.

### Lane A — current release blockers

Close the current open P0/P1 product/runtime blockers using normal Fast Landing causal closure. Keep scope root-cause based and batch all already-discoverable same-root boundaries.

At program introduction:

- PR #653 Telegram structured physical egress has already ordinary-merged into the baseline main.
- PR #615 Product system settings reachability remains a release blocker until Product Final and all other applicable final gates are genuinely closed.
- PR #538 is not a current release candidate; see Section 8.

### Lane B — Fresh-main Release Audit V2

Run an independent audit from the current fresh main without using the 2026-08-20 findings as the search checklist. The audit must inspect the active product and production authority graph, including at least:

- active Product UI reachability: feature exists but no entry point, button without behavior, behavior without UI, misleading state, disabled/loading/error/cancel states;
- Chinese UI consistency, native title/tooltips, truncation/wrapping, scaling/DPI/narrow-window behavior;
- renderer -> preload -> IPC -> bridge -> backend -> provider authority paths;
- SQLite / D1 / remote authority / local cache truth ownership and stale-shadow risks;
- startup, restart, shutdown, crash, kill, timeout, cancellation and recovery;
- duplicate action, concurrent request, late result, generation/fencing and idempotency behavior;
- Telegram, WhatsApp, Facebook, Matrix and other physical egress/provider boundaries;
- AI provider administration, durable execution, retries, cancellation and provider ownership;
- Media, Voice, Presence, Learning and Personal Access authority boundaries;
- OWNER / TESTER / entitlement / secret custody and fail-closed behavior;
- backup, restore, import, export, retention and destructive-operation staging;
- URL/query/header/log secret exposure, authentication, signature and replay boundaries;
- dependencies, licenses, SBOM, provenance and packaged artifact identity;
- packaged Windows behavior where source/runtime surrogates are insufficient.

New P0/P1 findings are not deferred merely because they were absent from the 2026-08-20 audit. They enter the same Release Closure Ledger and are burned down by severity and causal dependency.

### Lane C — release preparation

Prepare in parallel, without fabricating final evidence:

- mandatory test coverage inventory;
- final closure ledger reconciliation;
- NOTICE/license/SBOM/provenance inputs;
- packaged Windows UAT scenario matrix;
- release candidate materialization checklist;
- independent-review inputs.

Final hashes, exact heads, artifacts and pass/fail evidence may only be bound after the candidate head is stable.

## 4. Mandatory executed-test coverage proof

Test-file existence is not coverage.

For every critical release requirement, the ledger must be able to prove the chain:

`requirement -> test file -> runner -> workflow/gate -> exact head -> actually executed -> PASS`

A requirement is `NO_COVERAGE` if any link is missing, including when:

- a test file exists but the mandatory runner never enumerates it;
- a workflow routes GREEN without executing the relevant contract;
- a required gate is skipped and no other mandatory gate executes the contract;
- only a local/manual test ran without exact-head CI or packaged evidence where required.

The repository has already seen real examples where diagnostic files existed but Stage did not execute them. The release program therefore requires executed-test proof as a first-class closure field.

## 5. Same-root batching and new findings

For every new finding:

1. discover the complete currently observable same-root source/authority graph before production implementation;
2. batch already-discoverable same-root boundaries into one diagnostic window and Closure Matrix;
3. obtain any exact-path authorization/scope amendment required by trusted policy;
4. close the diagnostic window only when all known boundaries are explained and `unknownBlockers=0`;
5. implement one cohesive root fix, not one symptom per CI cycle;
6. run focused validation first, then all applicable exact-head final routed gates on the stable batch.

Independent buckets run in parallel when they do not share mutable authority, files, topology, or causal prerequisites.

## 6. Delta Regression Audit

Before release-candidate freeze, perform a dedicated audit of the production delta from the 2026-08-20 audited baseline to the final candidate main.

This audit is separate from Fresh-main Release Audit V2. It asks whether fixes and new production work introduced regressions, including:

- a second truth source or hidden authority;
- new fallback or retry paths bypassing canonical durable authority;
- async/lifecycle race conditions;
- widened bridge/API privilege;
- error normalization that suppresses actionable truth;
- weakened fencing/idempotency/cancellation semantics;
- UI integration covering only happy paths;
- over-broad routing/risk policy changes;
- cross-platform behavior regressions;
- supply-chain/provenance drift.

Open P0/P1 findings from this audit block RC freeze.

## 7. Release-candidate freeze

When the Known Findings ledger, Fresh-main Audit V2, Coverage Audit and Delta Audit have zero open P0/P1 blockers, freeze a fresh trusted main for release-candidate generation.

After RC freeze, feature expansion is forbidden by default. Only the following may move the release candidate:

- RC P0/P1 causal repairs;
- release evidence/provenance corrections required for truthfulness;
- UAT causal repairs;
- owner-authorized release mechanics.

Every repair that changes candidate bytes requires a new exact candidate head and revalidation of affected release evidence.

## 8. PR #538 is historical UAT evidence, not the current RC

PR #538 (`[UAT] Regenerate materialized Product Experience candidate on latest main`) remains useful as historical UAT/provenance evidence for its old lineage. It must not be treated as the current or final release candidate.

Its branch/head must not become the base for current production development. The preferred disposition is to preserve its history and close/mark it superseded once the release-closure program is effective.

The final V21 release candidate must be a newly materialized candidate from the final fresh-main RC freeze point.

## 9. Packaged Windows release-level UAT

The final candidate must validate the actual packaged Windows product rather than relying only on source/browser/runtime surrogates.

The UAT matrix must cover representative normal flows:

- install / first start / initialization;
- authentication and account/entitlement readiness;
- core messaging and conversation flows;
- AI routing and provider administration;
- Telegram / WhatsApp / Facebook / Matrix paths applicable to production;
- Media / Voice / Presence / Learning;
- Personal Access OWNER/TESTER flows;
- Product system settings;
- backup / restore / import / export / retention paths that are release-scoped;
- restart / shutdown / reopen / upgrade or re-materialization behavior.

It must also cover fault paths appropriate to the feature:

- offline/network loss;
- provider rejection/5xx;
- timeout and cancellation;
- duplicate clicks/concurrent actions;
- backend/provider crash or process kill;
- stale/expired permission or entitlement;
- bad path/disk/file failure;
- restart during an in-flight operation;
- recovery after interrupted durable operations.

UI acceptance includes Chinese consistency, visible non-truncated text, tooltip/title behavior, loading/disabled/error/cancel truth and reasonable scaling/narrow-window behavior.

Any UAT P0/P1 returns to Fast Landing causal closure. After the fix, a new exact RC must be materialized; stale RC evidence cannot be reused as final evidence.

## 10. Final release seal

Release/publish is forbidden until all of the following are true on the final candidate lineage:

- Known Findings V1: zero open P0/P1;
- Fresh-main Release Audit V2: zero open P0/P1;
- Mandatory Coverage Audit: no critical `NO_COVERAGE` rows;
- Delta Regression Audit: zero open P0/P1;
- all applicable exact-head final gates GREEN; intentional skips recorded as skips;
- independent review P0=0/P1=0;
- unresolved review threads=0;
- packaged Windows RC UAT PASS;
- release artifacts/provenance/SBOM/license evidence bound to the exact RC;
- fresh-main anti-drift clean immediately before final seal;
- explicit owner authorization for the final release boundary.

## 11. Operational SSOT

`docs/uat/V21_RELEASE_CLOSURE_LEDGER.md` is the operational release-closure ledger for this program.

The ledger must be updated as findings change state. Chat summaries and individual PR descriptions are supporting evidence, not the global release-closure truth source.
