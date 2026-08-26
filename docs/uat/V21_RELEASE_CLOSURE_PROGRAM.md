# V21 Release Closure Program

Status: ACTIVE / RELEASE NOT AUTHORIZED

Authorization merge: `916c93d41feb72fa622cd40e2c8c20cabf4e7d91` (#656)

Root protocol merge: `67c68279a4c10416bb22a3ee267a82cdf8a5b5ad` (#655)

This document is an operational release-closure program only. It grants no production, promotion, formal-release, publication, dependency, workflow, routing-policy, binary, signing, or publish authority.

## 1. Release objective

The V21 release is eligible to move to release/publish authorization only when all of the following are simultaneously true on fresh trusted `main`:

- no unresolved P0 or P1 remains in the Release Closure Ledger;
- every 2026-08-20 Known Finding P0/P1 has an explicit disposition and complete evidence chain;
- Fresh-main Release Audit V2 has no unresolved P0/P1;
- Mandatory Executed-Test Coverage Audit has no blind spot for release-critical contracts;
- Aug-20 → final RC Delta Regression Audit has no unresolved P0/P1;
- every applicable exact-head gate is GREEN on the exact source candidate being promoted;
- a new Release Candidate UAT PR is created from fresh `main`, not from historical PR #538;
- the fresh packaged Windows candidate passes the full release/UAT matrix;
- every ledger row that requires packaged evidence points to the fresh final RC evidence;
- final release/publish authority is obtained separately after all above conditions are met.

PR #538 is historical UAT evidence only and must never be relabeled as the current Release Candidate.

## 2. Governing execution model

All release closure work follows repository `AGENTS.md` Fast Landing / batch causal closure:

- batch same-root findings into one causal work package;
- independent P0/P1 buckets progress in parallel;
- serialize only true prerequisite, authorization, immutable-topology, or external-authority boundaries;
- establish failure-first causal evidence before production repair when the repository protocol requires it;
- exhaust the Closure Matrix to `unknownBlockers=0` before production closure;
- preserve immutable RED topology and evidence;
- exact-head gates only; stale ancestor GREEN is historical evidence, never promotion evidence;
- ordinary two-parent merge only;
- no squash, rebase, amend, force-push, history rewrite, temporary bypass, warning-only closure, assertion weakening, or test skipping;
- prefer existing repository seams and mature OSS over new Yance general-purpose infrastructure;
- do not download large release bundles merely for diagnosis when GitHub-hosted machine evidence is sufficient.

## 3. Closure state machine

For a P0/P1 finding with a mechanically established defect/root, the normal closure chain is:

`OPEN → CAUSAL_RED → ROOT_FIX → EXECUTED_GATE_GREEN → SOURCE_GATE_CLOSED_RC_PENDING → PACKAGED_RC_PASS → CLOSED`

`EVIDENCE_RECONCILIATION` may be used when a historical merge plausibly addresses a finding but the finding-to-test-to-workflow-to-exact-head chain has not yet been reconstructed.

`VERIFIED_NON_DEFECT` is a separate terminal disposition for an immutable Known Findings V1 row only when exhaustive evidence proves that the imported finding does not correspond to a remaining actionable defect. It is **not** a source fix, causal RED, risk acceptance, or substitute for packaged evidence on a real defect. A row may enter `VERIFIED_NON_DEFECT` only when all of the following are mechanically bound:

- the immutable 2026-08-20 finding ID and finding text remain unchanged as historical audit input;
- exact imported/audit-baseline source plus exhaustive Git/PR history either contradict the stated defect premise or, after complete historical reconciliation, do not yield an actionable finding-specific pre-fix/RED/root;
- selected mandatory exact-head execution proves the concrete claimed safety seam or all decomposed risk subsets;
- Fresh-main Audit V2 and the current Delta audit window find no executable P0/P1 root consistent with the finding;
- `unknownBlockers=0` and no contradictory source, workflow, package, or historical evidence remains unclassified;
- independent exact-head review confirms the disposition is not bypassing a real source or packaged blocker;
- the ledger records why per-finding packaged evidence is non-applicable.

Any exact historical source/RED that mechanically exhibits an unresolved defect, any fresh executable defect, incomplete mandatory execution, an unclassified applicable Delta P0/P1, or `unknownBlockers != 0` disqualifies `VERIFIED_NON_DEFECT`. The row must remain fail-closed or return to a separately authorized failure-first source prerequisite. Current source shape or test PASS alone is never enough.

A valid `VERIFIED_NON_DEFECT` row counts as an explicit Known Findings V1 disposition and as source-level resolved; it does not count as final-open P0/P1, `SOURCE_GATE_CLOSED_RC_PENDING`, a production fix, or a causal RED. It grants no RC/UAT, release, promotion, or publish authority. Global final RC/UAT and Delta obligations remain mandatory for the release as a whole.

No finding may be marked `CLOSED` from any of the following alone:

- a PR is merged;
- a test file exists;
- a test passed locally;
- a workflow exists but the target test did not execute;
- an ancestor commit is GREEN;
- a source-only fix is present without required packaged/UAT evidence;
- historical #538 UAT passed.

The default complete closure chain for a real defect is:

`Finding → causal RED → root cause → authorized production fix → mandatory test actually executes → exact-head GREEN → fresh packaged/UAT evidence → CLOSED`

If a finding is inherently non-packaged (for example a pure governance/documentation-only control or a strictly verified non-defect historical row), the ledger must explicitly explain why packaged evidence is not applicable rather than silently omitting it.

## 4. Four mandatory audits

### 4.1 Known Findings Ledger V1

Source: the 2026-08-20 comprehensive audit. Its 31 P0 and 8 explicitly enumerated P1 findings are imported individually into `V21_RELEASE_CLOSURE_LEDGER.md`.

Known Findings V1 is a fixed historical baseline. Later discoveries do not mutate or renumber those rows; they are added under Audit V2 or Delta Audit. A `VERIFIED_NON_DEFECT` disposition preserves the immutable finding ID/text and records the evidence-backed disposition rather than rewriting history.

### 4.2 Fresh-main Release Audit V2

Audit the current fresh `main` independently rather than assuming the Aug-20 list is complete. At minimum cover:

- renderer/UI authority and reachable product controls;
- Electron/backend ownership, startup, shutdown and process identity;
- credential/security boundaries;
- Store/identity/conversation truth sources;
- all physical adapter boundaries and durable repair paths;
- Durable Execution terminalization, fencing, recovery and lease behavior;
- AI Core cancellation, stale-result, retry, authority and persistence semantics;
- dependency/supply-chain state;
- release packaging, sealed runtimes and real Windows launch.

Every new P0/P1 becomes a separately identified `A2-*` row in the Ledger.

### 4.3 Mandatory Executed-Test Coverage Audit

For every release-critical test/contract, prove the full execution chain:

`test path → runner invocation → workflow/job → exact commit SHA → executed result → PASS`

A test file being present in the repository is not coverage. A workflow that does not route or invoke the test is not coverage. A skipped applicable test is a blocker unless the skip is itself the contractually correct route and documented as such.

Coverage audit must include Linux/Windows/platform-specific variants where the product contract depends on platform behavior.

### 4.4 Aug-20 → final RC Delta Regression Audit

Review all changes introduced after the Aug-20 audit through the final RC source head. The audit must search for:

- regressions in previously closed or otherwise terminally dispositioned Known Findings;
- newly introduced authority duplication or state divergence;
- contract drift between product code, tests, workflows and release packaging;
- new dependencies, postinstall behavior, dynamic downloads or unsealed runtime inputs;
- UI controls that are unreachable, dead, duplicated, truncated or inconsistent;
- stale historical tests that pass without exercising current production surfaces.

Every P0/P1 becomes a `DELTA-*` ledger row and follows the same closure chain.

## 5. Mandatory lanes

### Lane A — current product blocker

PR #615 (`Product system settings reachability`) remains a current product line until ordinary merged or formally superseded. On every fresh-main advance:

1. verify current Product Final outcome;
2. if the branch is behind fresh main, forward-reconcile without Product content rewrite;
3. prove net diff remains the authorized Product path set;
4. rerun all applicable exact-head gates;
5. independently review exact head, require P0=0/P1=0 and threads=0;
6. ordinary two-parent merge only.

A prior packaged Product Final failure is retained as causal evidence and may not be erased by reconciliation.

### Lane B — release-program governance

The root protocol is merged by #655 and this document/ledger package is authorized by #656. The implementation scope is exactly:

- `docs/uat/V21_RELEASE_CLOSURE_PROGRAM.md`
- `docs/uat/V21_RELEASE_CLOSURE_LEDGER.md`

No other path is part of this work package.

### Lane C — global audit and closure

Run Known Findings reconciliation, Fresh-main Audit V2, Executed-Test Coverage Audit and Delta Regression Audit in parallel. Same-root blockers may batch; unrelated blockers must not be serialized behind each other.

### Lane D — final fresh-main Release Candidate

Only after source-level P0/P1 closure and mandatory gate coverage are satisfied. For Known Findings V1, source-level closure means every real defect row has reached at least `SOURCE_GATE_CLOSED_RC_PENDING` and every strictly proven historical non-defect row has reached `VERIFIED_NON_DEFECT`; no `OPEN`, `CAUSAL_RED`, `ROOT_FIX`, `EXECUTED_GATE_GREEN`, or `EVIDENCE_RECONCILIATION` P0/P1 may remain.

Then:

1. lock fresh `main` SHA;
2. create a new RC/UAT PR from that exact fresh main;
3. materialize the current dependency/runtime closure from trusted inputs;
4. build the Windows candidate;
5. perform real packaged `Yance.exe` launch and Element ModuleLoader validation;
6. run the release UAT matrix, including historical obligations that explicitly require real Windows evidence;
7. bind receipts/artifacts to exact source SHA, tree, package identity and workflow runs;
8. perform final Delta Regression and independent review;
9. update every `SOURCE_GATE_CLOSED_RC_PENDING` ledger row with fresh packaged evidence; `VERIFIED_NON_DEFECT` rows retain their explicit per-finding packaged-N/A evidence and are not converted into fabricated package tests;
10. close the ledger only when no P0/P1 remains.

## 6. Windows RC/UAT minimum matrix

The final fresh-main packaged candidate must prove, where applicable:

- application starts from the packaged executable, not a browser-only surrogate;
- Element/current renderer surfaces load and Product controls are reachable;
- system settings and font/UI authority behave on the current renderer;
- one authoritative backend owner exists across start/restart/stop sequences;
- credential and SecurityGuard boundaries remain fail-closed;
- WhatsApp, Telegram and Facebook product projections can exercise their supported current paths without stale-generation or duplicate-delivery violations;
- Durable Execution terminal/recovery semantics survive restart and fault scenarios;
- AI provider/model workers preserve SQLite ownership isolation and return bounded, correctly classified outcomes;
- no secrets, bearer tokens, credential values or restricted fencing identities leak into artifacts/logs/URLs;
- application shutdown is bounded and does not leave owned runtimes/processes behind;
- package identity, sealed runtime identity and evidence receipts match the exact RC source head.

Open issue #1's real-Windows model-worker acceptance obligations must be reconciled into this final matrix rather than handled by a duplicate source repair.

## 7. Release decision rule

`releaseReady=true` is permitted only when:

- Ledger `openP0=0` and `openP1=0`; valid `VERIFIED_NON_DEFECT` rows are terminally dispositioned and therefore are not counted as open;
- Known Findings V1 complete;
- Audit V2 complete;
- Executed-Test Coverage complete;
- Delta Regression complete;
- all applicable exact-head gates GREEN;
- fresh packaged Windows RC/UAT PASS;
- independent final review P0=0/P1=0 and unresolved threads=0;
- fresh-main anti-drift check passes at the release authorization boundary.

Even then, this program does not itself authorize formal release or publication. Release/publish remains a separate explicit authority boundary.
