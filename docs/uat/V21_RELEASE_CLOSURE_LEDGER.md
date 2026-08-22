# V21 Release Closure Ledger

Operational SSOT for `docs/uat/V21_RELEASE_CLOSURE_PROGRAM.md`.

Program baseline: `main@928a6b36a63b87563001f8d27b61394b8d628489`

This ledger tracks release closure globally. Individual PR descriptions, audit reports and chat/session summaries are evidence inputs; they do not replace this ledger.

## Status vocabulary

- `OPEN` — known unresolved release blocker or required audit work not yet closed.
- `IN_PROGRESS` — active causal closure or audit in progress.
- `PARTIAL` — some closure evidence exists but one or more mandatory links are missing.
- `NO_COVERAGE` — a critical requirement lacks proof that its test is actually executed by a mandatory gate.
- `CLOSED` — full closure chain is evidenced.
- `HISTORICAL` — preserved evidence from an obsolete candidate/lineage; not a current release blocker or RC.
- `PENDING_RC` — production closure is complete but packaged final-RC evidence is still required.

A finding may only be marked `CLOSED` when the relevant closure chain is complete:

`finding -> causal RED -> root cause -> authorized fix -> mandatory executed test -> exact-head GREEN -> packaged/UAT evidence when applicable`

## A. Current release blocker ledger

| ID | Bucket | Severity | Current state | Evidence / current boundary | Next action |
|---|---|---:|---|---|---|
| REL-001 | Telegram structured physical egress | P0 | CLOSED | PR #653 ordinary-merged into `main@928a6b36a63b87563001f8d27b61394b8d628489`; production successor head `c9f29d7c499f82c9c48000bcd59b88e12cef2936`; Stage/Layered/ACV2/WP-A/Model Brain Windows GREEN; Product Final intentionally skipped for backend bucket | Keep in final delta audit and packaged integration smoke where applicable |
| REL-002 | Product system settings reachability | P1 | OPEN | PR #615 remains open; current known head lineage has Stage/Layered/ACV2 and routed Windows gates GREEN, but Product Final has failed | Read exact Product Final causal failure; batch-close the real root or prerequisite; do not restart broad diagnosis |
| REL-003 | Old Product UAT candidate #538 | — | HISTORICAL | PR #538 is validation-only historical evidence on old lineage; `formalRelease=false`; it is not the current V21 RC | Preserve history and mark/close as superseded after this program becomes effective; never build current production work on it |

## B. Recently closed production/audit buckets that remain in final release reconciliation

These rows are not automatically final-release CLOSED merely because their PRs merged. They remain subject to mandatory coverage proof, delta audit, and packaged RC validation where applicable.

| ID | Bucket | Latest closure evidence | Ledger state | Final-release obligation |
|---|---|---|---|---|
| REL-010 | Product UI authority consistency WP3 | PR #604 merged after prerequisite #606 | PENDING_RC | Reconcile mandatory executed tests; verify active packaged Product UI, Personal Access, Chinese tooltip/text wrapping on final RC |
| REL-011 | Electron lifecycle closure | final successor PR #643 merged | PENDING_RC | Reconcile mandatory executed lifecycle tests and validate packaged startup/restart/shutdown/crash behavior |
| REL-012 | Ollama pull durable provider ownership | PR #637 merged | PENDING_RC | Verify mandatory executed durable-ownership contracts and final-RC provider-admin behavior |
| REL-013 | Facebook Worker lease / WP-B identity transport | production #639 plus M2 contract reconciliation #642 merged | PENDING_RC | Verify signed-header/lease/fencing contracts remain executed and final integration behavior is intact |
| REL-014 | WhatsApp structured physical egress errors | PR #649 merged | PENDING_RC | Verify mandatory executed physical-egress contract and packaged/integration fault handling |
| REL-015 | Telegram structured physical egress errors | PR #653 merged | PENDING_RC | Verify final delta audit and packaged/integration fault handling |

## C. 2026-08-20 Known Findings V1 reconciliation

The 2026-08-20 audit is a required source, not an exhaustive bug universe.

The complete finding-by-finding import from that audit must be reconciled into this section. A merged PR may be linked to multiple audit findings when one root fix closes several findings. Do not create duplicate symptom work packages if the same root is already closed.

Current state: `IN_PROGRESS` — the audit findings have not yet been fully mapped one-by-one into this global ledger.

Required columns for every imported finding:

| Audit finding ID | Severity | Finding | Root cause | Causal RED | Production merge | Mandatory executed-test proof | Packaged/UAT proof | State |
|---|---:|---|---|---|---|---|---|---|
| to-import | P0/P1 | pending full reconciliation | — | — | — | — | — | OPEN |

Release seal is blocked until all P0/P1 audit findings are explicitly accounted for as `CLOSED`, `PENDING_RC`, or otherwise dispositioned with evidence; no row may silently disappear.

## D. Fresh-main Release Audit V2

State: `OPEN`

This is a new independent audit from fresh main and must not merely replay the 2026-08-20 checklist.

Required audit domains:

1. Product UI reachability, active surfaces, Chinese UI, tooltip/title, truncation/wrapping, scaling and error/loading/cancel truth.
2. Renderer/preload/IPC/bridge/backend/provider authority graph.
3. SQLite/D1/remote/cache truth ownership and stale-shadow behavior.
4. Startup/restart/shutdown/crash/kill/timeout/cancel/recovery.
5. Concurrency, duplicate actions, late results, generation/fencing/idempotency.
6. Telegram/WhatsApp/Facebook/Matrix physical egress and provider faults.
7. AI provider administration and durable execution ownership.
8. Media/Voice/Presence/Learning/Personal Access boundaries.
9. OWNER/TESTER entitlement and secret custody.
10. Backup/restore/import/export/retention and destructive staging.
11. Security, URL/query/header/log secrets, signatures and replay.
12. Dependencies/licenses/SBOM/provenance/artifact identity.
13. Packaged Windows-only behavior that source surrogates cannot prove.

Audit output rules:

- P0/P1 findings enter this ledger immediately.
- Same-root findings are grouped into one Closure Matrix and one causal batch.
- `unknownBlockers=0` is required before first production implementation.
- New findings absent from the 2026-08-20 audit are still release blockers by severity.

## E. Mandatory Coverage Audit

State: `OPEN`

Critical closure proof must use this chain:

`requirement -> test file -> runner -> workflow/gate -> exact head -> executed -> PASS`

Initial known historical coverage failures that justify this audit:

| Coverage lesson | Historical symptom | Required prevention |
|---|---|---|
| Electron lifecycle diagnostics | diagnostic files existed but Stage runner did not execute the external wp2/wp4 tests | prove runner enumeration and exact-head execution |
| Ollama durable ownership diagnostic | WP-B M2 contract existed but Stage did not execute it | ensure a mandatory Stage-routed contract or explicitly bound mandatory equivalent |
| Facebook Worker diagnostics | initial diagnostic paths existed outside the required Stage route | prove mandatory runner/workflow execution before claiming coverage |

Coverage status fields for every critical requirement:

| Requirement | Test | Runner | Mandatory gate | Exact-head run | Executed? | Result | State |
|---|---|---|---|---|---|---|---|
| to-audit | — | — | — | — | NO | — | NO_COVERAGE |

Release seal requires zero critical `NO_COVERAGE` rows.

## F. Delta Regression Audit

State: `OPEN`

Audit range: 2026-08-20 audited baseline -> final fresh-main RC freeze commit.

The exact baseline SHA must be bound from the original audit evidence before this audit is sealed. The audit must inspect all production changes since that baseline for:

- second truth sources / hidden authorities;
- fallback/retry paths bypassing canonical authority;
- new async/lifecycle races;
- widened bridge/API privilege;
- error-normalization truth loss;
- weakened fencing/idempotency/cancellation;
- happy-path-only UI integration;
- over-broad routing/risk policy changes;
- cross-platform regressions;
- supply-chain/provenance drift.

Open P0/P1 findings block RC freeze.

## G. Release Candidate / packaged Windows UAT

State: `OPEN`

### Historical candidate

PR #538 is `HISTORICAL`, not the current RC. Its old evidence remains preserved, but its branch/head is not reused for final V21 production development or final release proof.

### Required new candidate

A new RC must be materialized from the final fresh-main freeze after Sections C-F have zero blocking P0/P1/NO_COVERAGE items.

The final packaged Windows UAT matrix must include normal and fault flows for the release-scoped features, including:

- install / first start / initialization;
- authentication / entitlement readiness;
- core messaging;
- AI routing/provider administration;
- production communication providers;
- Media/Voice/Presence/Learning;
- Personal Access;
- Product system settings;
- data protection paths that are in release scope;
- restart/shutdown/reopen;
- offline/provider rejection/timeout/cancel/duplicate action/process kill/expired permission/file-disk failure/interrupted durable operation recovery;
- Chinese UI, visible non-truncated text, tooltip/title, loading/disabled/error/cancel truth and scaling/narrow-window behavior.

Any P0/P1 found in packaged UAT returns to Fast Landing causal closure and invalidates stale final-RC evidence after candidate bytes change.

## H. Final release seal checklist

All items must be true simultaneously:

- [ ] 2026-08-20 Known Findings V1: zero open P0/P1.
- [ ] Fresh-main Release Audit V2: zero open P0/P1.
- [ ] Mandatory Coverage Audit: zero critical `NO_COVERAGE`.
- [ ] Delta Regression Audit: zero open P0/P1.
- [ ] Current release blockers including #615: closed.
- [ ] New fresh-main RC materialized; #538 not used as final candidate.
- [ ] All applicable exact-head final gates GREEN; skipped jobs explicitly recorded as skipped.
- [ ] Independent review P0=0/P1=0 and unresolved threads=0.
- [ ] Packaged Windows RC UAT PASS.
- [ ] Final artifact identity, SBOM, licenses and provenance bound to exact RC.
- [ ] Fresh-main anti-drift clean immediately before final seal.
- [ ] Explicit owner authorization for final release/publish boundary.

Until every checkbox is satisfied, V21 remains in release closure rather than formal release.
