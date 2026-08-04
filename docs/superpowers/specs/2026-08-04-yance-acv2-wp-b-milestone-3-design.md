# Yance Architecture Closure V2 — WP-B Milestone 3 Design

- Document status: `APPROVED_FOR_IMPLEMENTATION_PLANNING`
- Work package: `WP-B — Durable Execution and External Action Outbox`
- Milestone: `3 — Source Closure and Final Gates`
- Repository: `laiqian0239-glitch/yance`
- Branch: `acv2/wp-b-durable-execution-outbox`
- Pull request: `#17`
- Authorization anchor Head: `9f82377119e16f8e02d3b83f0795b452e36f769e`
- Milestone 2 Seal Head: `5f08a5a75aeae4d3baeb5a1d34a470f21ac0180d`
- Milestone 2 reviewed implementation Head: `3e5d71f68afccb64d0f61a776170d815fed77747`
- Baseline Head: `e53bf933a8f4e3273e515587d917433df24d6feb`
- User authorization: confirmed in project conversation on `2026-08-04` local time
- PR state requirement: `DRAFT_OPEN_UNMERGED`
- WP-C authorization: `false`
- Merge authorization: `false`
- Production-use authorization: `false`
- Formal release: `false`
- Publish: `false`
- Temporary bypass: `forbidden`
- Warning-only closure: `forbidden`

## 1. Decision

Milestone 3 will use an authorization-first, inventory-driven source-closure process.

The work proceeds in four ordered layers:

1. machine-readable Milestone 3 authorization bound to the sealed Milestone 2 evidence;
2. generalized source-closure authority and behavior-level RED contracts;
3. removal or permanent delegation of every superseded WP-B writer, recovery path, retry loop, timer, fallback, and direct physical call;
4. provenance, SBOM, independent Review Gate 3, closure receipt, and permanent main post-merge validation.

No production source change may precede a valid M3 authorization receipt and verifier. No scanner exclusion, feature flag, warning, timeout increase, duplicate writer, or callable compatibility fallback may be used to obtain GREEN.

## 2. Existing Truth and Problem Statement

Milestone 2 is sealed and its exact-six durable operation graph, persisted fencing identity, attempt-before-call ordering, recovery authority, and eighteen-scenario fault matrix are GREEN on Ubuntu and Windows.

Milestone 3 remains necessary because passing behavior contracts does not prove source closure. The current repository still has these open obligations:

- the source-closure scanner accepts `--wp B` but its baseline and discovery configuration are still structurally centered on WP-A;
- the WP-B operation inventory remains a discovery document with many `OPEN` entries;
- old schedulers, timers, direct platform/provider clients, compatibility cores, recovery services, and queue paths may remain callable even when the preferred path is durable;
- the open-source adoption registry still lacks final NOTICE, SBOM, provenance, and independent-review closure;
- no permanent WP-B main post-merge validation workflow exists;
- no final WP-B closure receipt binds the exact reviewed file set, workflow evidence, source-review result, and closed downstream authorities.

Milestone 3 closes those source and governance gaps without expanding into WP-C, product release, or production acceptance.

## 3. Non-Negotiable Invariants

### 3.1 Authorization precedence

The first M3 implementation commit class must create a machine-readable authorization receipt, strict verifier, immutable contracts, and permanent authorization workflow. The receipt binds:

- authorization anchor Head `9f82377119e16f8e02d3b83f0795b452e36f769e`;
- Milestone 2 Seal Head `5f08a5a75aeae4d3baeb5a1d34a470f21ac0180d`;
- Milestone 2 reviewed Head `3e5d71f68afccb64d0f61a776170d815fed77747`;
- PR `#17`, branch, repository, and Draft/open/unmerged requirements;
- exact M3 allowed path classes;
- explicit closed flags for merge, WP-C, production use, release, and publish.

Production changes are invalid if their ancestry does not contain the valid authorization Head.

### 3.2 One generalized scanner

`source-closure-scan.js` remains the single source-closure implementation. It is refactored behind an immutable work-package configuration map rather than copied into a WP-B-specific scanner.

WP-A output semantics and existing contracts must remain unchanged. WP-B receives its own baseline, operation inventory, discovery roots, excludes, capability rules, and terminal-state validation.

### 3.3 Inventory is authority

Every discovered WP-B source path must have one exact inventory row before remediation. Wildcards are forbidden.

Production inventory rows may finish only as:

- `DELETED`;
- `DELEGATES_TO_WP_B_AUTHORITY`;
- `READ_ONLY_PROJECTION`.

Non-production evidence tools may finish as `REGISTERED_NON_PRODUCTION` when they are not imported by runtime code and own no business authority.

The following are invalid terminal states:

- `OPEN`;
- `DISABLED_BY_FLAG`;
- `WARNING_ONLY`;
- `LEGACY_FALLBACK_AVAILABLE`;
- any state that leaves a second writer, retry authority, recovery authority, or physical-call bypass callable.

### 3.4 Command and physical boundaries stay sealed

Milestone 3 may remove old paths but must not weaken Milestone 2 boundaries:

- canonical command bytes remain separate from persisted attempt/fencing context;
- physical calls require a valid persisted attempt;
- credentials remain ephemeral and reference-resolved;
- uncertain remote outcomes never become blind retries;
- process supervision cannot decide business retry;
- only AuthorityWriteHost may commit primary database state.

## 4. Architecture

### 4.1 Milestone 3 Authorization Authority

New governance assets provide one fail-closed authorization decision.

The verifier checks local Git ancestry, receipt schema, exact heads, exact allowed path classes, PR state, and downstream closed flags. The authenticated workflow additionally verifies repository and PR facts through GitHub Actions.

Authorization permits Task 8 and Task 9 work only. It does not permit merge, readiness promotion, WP-C, production use, formal release, or publish.

### 4.2 Work-package source-closure configuration

The scanner uses:

```js
const WORK_PACKAGE_CONFIG = Object.freeze({
  A: Object.freeze({
    baselinePath: 'governance/architecture-closure-v2/wp-a-baseline.json',
    registryPath: 'governance/architecture-closure-v2/authority-registry.json',
    mode: 'AUTHORITY_SOURCE_CLOSURE'
  }),
  B: Object.freeze({
    baselinePath: 'governance/architecture-closure-v2/wp-b-baseline.json',
    registryPath: 'governance/architecture-closure-v2/wp-b-operation-inventory.json',
    mode: 'DURABLE_OPERATION_SOURCE_CLOSURE'
  })
});
```

The exact shape may evolve during TDD, but configuration selection, validation, and report production remain shared.

WP-B reporting includes at least:

- `violationCount`;
- `legacyCallablePathCount`;
- `directExternalCallOutsideAdapterCount`;
- `blindRetryPathCount`;
- `legacyWriterPathCount`;
- `legacyRecoveryPathCount`;
- `timerOrReconnectAuthorityPathCount`;
- `unregisteredSourcePathCount`;
- classified violation records with exact paths and reason codes.

### 4.3 Capability detection

The existing primary-database capability authority remains valid for WP-A. WP-B extends detection through explicit, separately tested capability classes such as:

- durable business mutation;
- provider/platform physical call;
- retry scheduling;
- recovery entrypoint;
- reconnect/session-restore timer;
- process supervision;
- compatibility facade delegation;
- direct queue/checkpoint mutation;
- non-production harness execution.

Detection is based on source facts and verified against exact inventory declarations. A declared capability that is unused or a detected capability that is undeclared is a violation.

### 4.4 Legacy remediation

Remediation follows the frozen inventory row by row.

Preferred closure order:

1. recovery, retry, reconnect, and timer authorities;
2. direct queue/checkpoint writers;
3. provider/platform physical-call entrypoints outside durable Adapters;
4. compatibility cores and old lifecycle/job authorities;
5. process supervisors and startup composition boundaries;
6. non-production harness import isolation.

A compatibility facade may remain only when it performs validation and delegates exactly once to the current WP-B authority. It must not contain legacy SQL, independent retry scheduling, direct SDK calls, or alternate recovery writes.

## 5. Data and Control Flow

The final production flow remains:

```text
request
→ versioned durable command
→ AuthorityWriteHost / transaction coordinator
→ DurableExecutionAuthority + outbox intent
→ persisted claim and attempt
→ registered operation Adapter
→ physical provider/platform call
→ receipt or uncertain outcome
→ reconciliation / durable recovery
→ terminal receipt
```

Milestone 3 removes every production path that can bypass this sequence.

Source-closure flow is:

```text
frozen inventory
→ shared scanner discovery
→ exact capability classification
→ behavior-level RED
→ delete or delegate root cause
→ zero-violation scan
→ isolated file regressions
→ cross-platform full gates
→ independent source review
→ closure receipt
```

## 6. Error Handling and Fail-Closed Behavior

The authorization verifier fails on missing or moved heads, widened path scope, non-Draft PR state, missing M2 seal ancestry, or any opened downstream flag.

The scanner fails on:

- unknown work package;
- missing baseline or inventory;
- duplicate IDs or paths;
- wildcard paths;
- missing source files without a `DELETED` terminal record;
- invalid terminal states;
- capability declaration mismatch;
- unregistered source facts;
- callable fallback or bypass markers.

The closure verifier fails on:

- dirty worktree;
- changed-file count or digest mismatch;
- reviewed blob mismatch;
- missing workflow/job/artifact evidence;
- nonzero violation, leak, blind-retry, or legacy-callable counts;
- incomplete provenance or SBOM;
- PR no longer Draft/open/unmerged;
- any WP-C, merge, production, release, or publish authority becoming true.

Failures are machine-readable with stable codes. No error may be downgraded to warning for closure.

## 7. TDD and Verification Strategy

### 7.1 Authorization RED/GREEN

Write contracts that reject absent authorization, wrong M2 heads, widened path scope, false human approval, and opened downstream governance. Then add the minimal receipt/verifier/workflow to GREEN.

### 7.2 Source-closure RED/GREEN

Add WP-B behavior contracts before scanner production changes. The first credible RED must identify real open inventory paths and return nonzero classified counts without infrastructure failure.

Refactor the scanner while preserving all WP-A outputs. Then remediate each source class at the underlying authority boundary until WP-A and WP-B both report zero violations.

### 7.3 Isolated and regression execution

Run every modified backend test file independently where shared module cache, singleton runtime composition, SQLite ownership, timers, or child processes could hide order dependence.

Required inherited verification includes:

- complete WP-B contracts and eighteen-scenario process matrix;
- WP-A source closure, architecture, replay, migration, ownership, fencing, and post-merge suites;
- Schema 1–23 upgrade, reopen, checksum, and future-schema rejection;
- Ubuntu and Windows matrices;
- source UAT delivery and platform-core regressions;
- secret and business-content leak scans;
- protocol validation;
- clean worktree and `git diff --check`.

### 7.4 Provenance closure

Generate a deterministic SPDX or CycloneDX SBOM from the exact lockfile. Bind the artifact hash to the closure receipt.

XState closure records exact package version, integrity, upstream commit/tag, MIT license/NOTICE, upstream tests, Yance Adapter boundary, vulnerability result, and zero restricted-source imports.

Temporal remains reference-only and records zero package imports, zero source imports, selected reference commit/version, license review, and the exact semantic references used by tests/design. No Temporal runtime or service is introduced.

## 8. Review Gate 3 and Closure Receipt

The independent reviewer examines the exact final source diff and verifies:

- authorization precedence;
- immutable M1 and M2 seal ancestry;
- complete inventory and zero unregistered paths;
- no legacy writer/recovery/retry/timer/direct-call bypass;
- Milestone 2 behavior remains intact;
- Ubuntu/Windows and isolated-test evidence;
- Schema 23 integrity;
- secret/content scans;
- license, NOTICE, SBOM, provenance, and vulnerability evidence;
- permanent post-merge validation;
- exact changed-file set and reviewed blob identities.

The final machine-readable receipt has status:

`CLOSED_PENDING_MAIN_POST_MERGE_VALIDATION`

and must state:

```text
wpBFocusedGreen=true
wpARegressionGreen=true
ubuntuMatrixGreen=true
windowsMatrixGreen=true
sourceClosureViolationCount=0
legacyWpBCallablePathCount=0
uncertainOutcomeBlindRetryCount=0
secretLeakCount=0
businessContentLeakCount=0
openSourceAdoptionGate=APPROVED
independentSourceReview=APPROVED
postMergeValidationRequired=true
readyForPromotion=false
wpCAuthorized=false
mergeAuthorized=false
productionUseAuthorized=false
formalRelease=false
publish=false
```

A later promotion authorization is a separate governance event.

## 9. Permanent WP-B Post-Merge Validation

The permanent workflow is modeled on the WP-A main validation topology:

- exact checkout of `github.sha`;
- pinned action SHAs;
- Ubuntu and Windows jobs;
- full WP-B contracts and fault matrix;
- WP-A inherited regressions;
- WP-A and WP-B source closure;
- provenance/license/security/SBOM verification;
- Schema upgrade/reopen checks;
- clean-worktree enforcement;
- an aggregate gate with no `continue-on-error`.

The workflow runs on pull requests to main and pushes to main for all relevant backend, Electron, governance, package, lockfile, tests, and architecture-closure paths.

Its summary keeps downstream authority closed. A successful post-merge run proves validation only; it does not itself authorize release or WP-C.

## 10. Commit and Evidence Topology

Expected commit classes:

1. approved M3 design document;
2. M3 authorization RED and machine authorization GREEN;
3. WP-B source-closure credible RED;
4. generalized scanner implementation;
5. inventory-driven legacy removal/delegation commits by responsibility class;
6. provenance, NOTICE, SBOM, and deterministic verification assets;
7. permanent post-merge workflow;
8. independent Review Gate 3 remediation, if findings exist;
9. reviewed closure receipt and seal-only evidence commits.

Production remediation commits may not be mixed with authorization or final receipt commits. Final review evidence binds one fixed reviewed implementation Head and one fixed closure/seal Head.

## 11. Acceptance Criteria

Milestone 3 is complete only when all of the following are proven on exact heads:

- valid M3 authorization predates production M3 changes;
- WP-A source-closure behavior is preserved;
- WP-B scanner reports zero violations;
- every inventory production row has a valid terminal state;
- `legacyWpBCallablePathCount=0`;
- `directExternalCallOutsideAdapterCount=0`;
- `blindRetryPathCount=0`;
- all six operation kinds remain executable only through the durable registry;
- M2 contracts remain fully GREEN;
- Ubuntu/Windows, process-fault, Schema, WP-A, security, and protocol matrices are GREEN;
- secret and business-content leak counts are zero;
- XState and Temporal records pass final provenance review;
- deterministic SBOM and NOTICE evidence exist;
- independent Review Gate 3 is approved;
- permanent WP-B post-merge validation is required;
- PR remains Draft, open, and unmerged;
- WP-C, merge, production use, formal release, and publish remain unauthorized.

## 12. Non-Goals

Milestone 3 does not:

- implement WP-C communication-domain redesign;
- authorize main merge or mark the PR ready for review;
- authorize production use or real-platform acceptance;
- create a release candidate, installer release, formal release, or publish action;
- introduce Temporal Server, Redis, PostgreSQL, Docker, or another runtime authority;
- delete historical migrations or perform WP-G read-cutover work;
- weaken or replace the sealed Milestone 1 or Milestone 2 evidence.

## 13. Approval Boundary

The user approved this design and authorized the full Milestone 3 process. Under the project workflow, this document authorizes creation of the detailed implementation plan. Implementation begins only after that plan is written, self-reviewed, and accepted. All work remains subject to exact-head verification and the prohibition on temporary bypasses.