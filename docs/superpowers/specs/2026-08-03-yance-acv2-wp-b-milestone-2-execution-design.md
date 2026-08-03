# Yance ACV2 WP-B Milestone 2 Execution Design

- Document status: `APPROVED_BY_PROJECT_OWNER_FOR_SPECIFICATION`
- Approval source: explicit project-owner confirmation in the 独立软件工程审计 conversation
- Approval timestamp: `2026-08-03T23:07:00+07:00`
- Repository: `laiqian0239-glitch/yance`
- Pull request: `#17`
- Implementation branch: `acv2/wp-b-durable-execution-outbox`
- Milestone 1 Seal Head: `1e3d600f0647af35e737ff92a200c67e69224c82`
- Reviewed Milestone 1 implementation Head: `1488ce7aa594f5abb915da64f21a83dc6e4dd5c3`
- Baseline Head: `e53bf933a8f4e3273e515587d917433df24d6feb`
- Selected execution topology: `SAME_DRAFT_PR_PHASED_EXACT_AUTHORIZATION`
- Temporary bypass allowed: `false`
- Merge authorized: `false`
- Production use authorized: `false`
- WP-C authorized: `false`
- Formal release: `false`
- Publish: `false`

## 1. Decision

Milestone 2 continues on the existing Draft PR #17 and the existing branch. The Milestone 1 seal remains immutable evidence. Milestone 2 starts only after a machine-readable authorization receipt and verifier bind the authorization to the exact Milestone 1 Seal Head and to an exact set of permitted governance, test, implementation, runtime, and workflow paths.

The execution order is fixed:

1. create and validate the Milestone 2 authorization receipt;
2. write the complete Milestone 2 RED contracts;
3. record credible Ubuntu and Windows RED evidence against the exact RED Head;
4. migrate the six mandatory operation kinds in fixed order;
5. implement restart recovery and the complete process-fault matrix;
6. run focused and inherited regressions on Ubuntu and Windows;
7. perform an independent source checkpoint review;
8. remediate blocker and high findings through root refactoring;
9. seal Milestone 2 without authorizing Milestone 3, merge, production use, WP-C, release, or publish.

No production file may be changed before steps 1–3 establish the authorization and RED-precedence chain.

## 2. Why the existing Draft PR is retained

The existing PR contains the complete Milestone 1 design, RED evidence, Schema 23 implementation, independent review remediation, and seal. Continuing on the same branch preserves one ancestry chain from the frozen baseline through the reviewed implementation and the seal.

A new PR would require a second baseline and a cross-PR evidence-binding protocol. One PR per operation kind would fragment recovery and process-fault verification across dependent heads. The selected topology therefore minimizes governance ambiguity while retaining strict commit and review boundaries inside Milestone 2.

## 3. Authorization boundary

The Milestone 2 authorization receipt must bind all of the following:

- repository and branch;
- parent Seal Head `1e3d600f0647af35e737ff92a200c67e69224c82`;
- PR #17 remaining Draft, open, and unmerged;
- the six exact operation kinds and their fixed order;
- exact authorization, verifier, RED-test, implementation, runtime-composition, process-matrix, inventory, and workflow paths;
- `temporaryBypassAllowed=false`;
- `warningOnlyClosureAllowed=false`;
- `mergeAuthorized=false`;
- `productionUseAuthorized=false`;
- `wpCAuthorized=false`;
- `formalRelease=false`;
- `publish=false`.

The verifier must reject an altered parent Head, reordered operation list, additional operation kind, widened wildcard, downstream authorization, or any attempt to treat a warning as closure.

## 4. Mandatory operation migration order

The migration order is immutable:

1. `AI_PROVIDER_EXECUTION`;
2. `OUTBOUND_MESSAGE_SEND`;
3. `DELIVERY_RECEIPT_RECONCILIATION`;
4. `MEDIA_TRANSFER`;
5. `HISTORY_SYNCHRONIZATION`;
6. `SESSION_RESTORE`.

Each operation must expose one immutable Adapter implementing:

```text
perform(attemptEnvelope) -> Promise<ExternalObservation>
reconcile(reconciliationEnvelope) -> Promise<ReconciliationObservation>
```

Adapter envelopes contain references, IDs, hashes, deadlines, claim identity, generation, host generation, and fencing token. They must not contain credentials, session secrets, message bodies, prompt bodies, binary payloads, cookies, OAuth tokens, or API keys.

Unknown operation kinds fail closed with `WP_B_OPERATION_ADAPTER_NOT_REGISTERED`.

## 5. Architecture and ownership

### 5.1 Durable operation registry

One Yance-owned registry contains the six exact operation kinds and recursively frozen Adapter registrations. It performs no database or external I/O. Registration is complete before runtime readiness. Duplicate or unknown registration fails closed.

### 5.2 Physical-call ownership

Only `ExternalActionDispatcher` may invoke an operation Adapter physical call. A call is legal only after:

1. the execution and immutable external-action intent are committed;
2. the dispatcher owns a current database CAS claim;
3. an exact attempt row is persisted for the intent and claim;
4. the attempt, intent, generation, claim, host generation, fencing token, and unexpired lease match.

No compatibility facade, startup routine, timer, retry helper, provider host, communication service, or channel runtime may retain an independently callable physical-write path.

### 5.3 Model execution

Candidate and production model executions remain semantically distinct, but both use the same Schema 23 durable execution and outbox substrate. The worker process reports observations only. Process exit after provider acceptance but before a trusted result becomes `UNCERTAIN_REMOTE_OUTCOME`, never ordinary retryable failure.

### 5.4 Communication operations

Outbound send, receipt reconciliation, media transfer, and history synchronization are created as durable executions and intents. Existing communication and channel components become request/delegation boundaries. They cannot issue a second business write or call a platform SDK without an exact persisted attempt envelope.

### 5.5 Session restoration

Startup may request a durable session restoration. It cannot directly invoke platform SDK restoration. Restoration uses a stable account-scoped idempotency key, explicit deadline, session probe receipt, and reconciliation when the remote or platform result is uncertain.

### 5.6 Recovery authority

One recovery authority runs only after the AuthorityWriteHost and transaction coordinator are active and Schema 23 is open. It reads nonterminal executions and issues commands through existing authorities. It performs no direct state updates.

Recovery decisions are exactly:

- `REQUEUE_SAFE`;
- `RECONCILE_REQUIRED`;
- `CANCEL_CONFIRMATION_REQUIRED`;
- `DEADLINE_EXPIRED`;
- `NO_ACTION`.

A persisted attempt always prevents blind retry. `RUNNING` with an attempt maps to `RECONCILE_REQUIRED` even when the lifecycle state alone would otherwise appear requeueable.

## 6. Data flow

```text
business request
  -> create durable execution with versioned command hash
  -> create immutable external-action intent
  -> commit ledger event and command receipt
  -> dispatcher CAS claim
  -> persist exact attempt
  -> resolve secret references at custody boundary
  -> Adapter physical call outside transaction
  -> certain receipt OR uncertain-outcome fact
  -> reconciliation observation persisted before decision
  -> terminal CAS transition or continued nonterminal reconciliation state
  -> restart recovery reissues commands, never direct writes
```

Every state-changing database operation remains a single authoritative SQL CAS. Application prechecks may improve diagnostics but do not establish authority.

## 7. Required RED contract groups

Before production migration, tests must fail for the absence of each capability below:

1. exact six-kind registry and immutable Adapter contracts;
2. physical-call rejection without a persisted attempt;
3. model execution delegation to durable execution and outbox;
4. communication send, receipt, media, and history delegation;
5. session-restore startup delegation;
6. restart decision table for every nonterminal state;
7. persisted-attempt override to `RECONCILE_REQUIRED`;
8. duplicate dispatcher and lease-takeover rejection;
9. stale owner, generation, host generation, claim, and fencing rejection;
10. deadline and cancellation race separation;
11. uncertain remote outcome blocks retry until absence is proven;
12. remote success reconciliation creates one receipt and one terminal transition;
13. receipt-before-terminal restart completes without a second physical call;
14. secret and business-content exclusion from records, logs, evidence, and artifacts;
15. legacy direct-call and startup-recovery paths remain callable until structurally removed or delegated.

RED evidence is credible only when Ubuntu and Windows execute the same tests against the same exact Head and fail for the intended missing production behavior. Checkout failure, runner startup failure, dependency outage, or unrelated regression is not accepted as RED evidence.

## 8. Fault-injection matrix

The process matrix launches at least two dispatcher/backend processes against one temporary SQLite database and an instrumented persistent fake remote endpoint. It covers:

1. kill before the physical call;
2. kill after attempt persistence but before the call;
3. kill during the call;
4. remote success followed by kill before receipt;
5. receipt committed followed by kill before terminal transition;
6. duplicate dispatcher claims;
7. lease expiry and takeover;
8. stale owner, execution generation, host generation, and fencing token;
9. heartbeat loss;
10. wall-clock rollback and forward jump;
11. deadline before claim, during execution, and while waiting remote;
12. cancellation before call, during call, and after remote acceptance;
13. retryable and permanent provider/platform failure;
14. reconciliation proves success;
15. reconciliation proves absence;
16. reconciliation remains unknown and requires manual resolution;
17. checkpoint and history rolling for long-running sync or polling;
18. restart from every nonterminal state.

Every row records process IDs, execution ID, intent ID, attempt ID, claim ID, generation, host generation, fencing token, attempt count, physical-side-effect count, receipt count, reconciliation count, and final state. Evidence stores no business content or secret material.

The matrix must prove no duplicate charge, provider execution, message send, media transfer, receipt, history mutation, or session restoration.

## 9. Error handling

Errors use stable WP-B codes. The implementation must distinguish at least:

- unauthorized Milestone 2 scope;
- missing or invalid Adapter registration;
- missing persisted attempt;
- stale claim or expired lease;
- stale execution generation;
- stale host generation or fencing token;
- deadline expiry;
- cancellation requested before call;
- cancellation requiring remote confirmation;
- certain retryable remote failure;
- certain permanent remote failure;
- uncertain remote outcome;
- reconciliation required;
- manual resolution required;
- idempotency hash conflict;
- secret or business-content leakage violation.

Unknown remote outcome is not converted into a generic error and is never automatically retried.

## 10. Exact source-scope policy

The implementation plan may authorize exact files or narrowly bounded directories required by the six operation Adapters, the registry, recovery authority, existing model/communication/channel/runtime composition points, WP-B tests, process-matrix tooling, governance receipts, and WP-B workflows.

Global production wildcards are forbidden. `.github/workflows/**`, `backend/**`, `electron/**`, and repository-wide catch-all patterns are not valid authorization. When an existing file is discovered outside the planned exact scope, the authorization receipt must be amended and revalidated before that file changes.

No temporary feature flag, disabled-but-callable fallback, dual writer, warning-only scanner, test exclusion, retry inflation, or timeout inflation is accepted.

## 11. Commit and review topology

Milestone 2 uses reviewable commits in this order:

1. authorization receipt, verifier, and governance tests;
2. complete Milestone 2 RED contracts and evidence capture;
3. six-kind registry and AI provider migration;
4. outbound message migration;
5. delivery receipt reconciliation migration;
6. media transfer migration;
7. history synchronization migration;
8. session restoration migration;
9. recovery authority and runtime composition;
10. process-fault matrix and inherited regressions;
11. independent-review remediation;
12. Milestone 2 seal receipt and verifier.

Each production commit must be preceded by its failing contract and followed by focused GREEN plus inherited WP-A/WP0 regressions. Closely coupled fixes may be combined only when they share one authoritative invariant and one meaningful reviewer gate.

## 12. Validation gates

The exact Milestone 2 candidate Head must pass:

- complete WP-B Milestone 1 regression suite;
- complete Milestone 2 operation and recovery contracts;
- real SQLite process-fault matrix;
- Ubuntu matrix;
- Windows matrix;
- WP-A architecture and post-merge regressions;
- WP0 scope, packaging, product, ownership, and evidence gates;
- source-scope and legacy-callability scan;
- secret and business-content leak scan;
- dependency and lockfile integrity checks;
- clean-worktree and generated-artifact checks.

A successful job against another Head is not transferable evidence.

## 13. Independent Review Gate 2

The independent reviewer examines the exact candidate Head and verifies:

- all six mandatory operations use one durable/outbox substrate;
- every physical call has one persisted attempt;
- uncertain outcomes cannot enter blind retry;
- restart decisions are based on persisted facts rather than lifecycle labels alone;
- duplicate dispatchers, expired leases, and stale fencing tokens fail closed;
- deadline and cancellation semantics remain distinct;
- legacy physical-call and recovery paths are deleted or structurally delegated;
- evidence contains no secrets or business content;
- the changed-file set remains inside the exact authorization.

Any blocker or high finding prevents sealing. Remediation must modify the underlying schema, authority, ownership, or call boundary; it cannot weaken tests or gates.

## 14. Milestone 2 seal boundary

The Milestone 2 seal records:

- parent Milestone 1 Seal Head;
- RED Head and Ubuntu/Windows RED run and job IDs;
- reviewed implementation Head;
- ordered changed-file count and SHA-256;
- key reviewed Git blob SHAs;
- all formal GREEN run and job IDs;
- independent review identity, mode, findings, and resolutions;
- exact seal-only delta;
- `milestone2=SEALED`;
- `milestone3Authorized=false`;
- `mergeAuthorized=false`;
- `productionUseAuthorized=false`;
- `wpCAuthorized=false`;
- `formalRelease=false`;
- `publish=false`;
- `temporaryBypassAllowed=false`.

Milestone 2 sealing cannot alter the Milestone 1 review receipt.

## 15. Success criteria

Milestone 2 is complete only when all of the following are true:

```text
milestone1SealPreserved=true
milestone2AuthorizationValid=true
credibleUbuntuRed=true
credibleWindowsRed=true
mandatoryOperationKindCount=6
mandatoryOperationMigrationCount=6
physicalCallWithoutPersistedAttemptCount=0
uncertainOutcomeBlindRetryCount=0
duplicateExternalSideEffectCount=0
legacyWpBCallablePathCount=0
ubuntuMilestone2Green=true
windowsMilestone2Green=true
wpARegressionGreen=true
wp0RegressionGreen=true
secretLeakCount=0
businessContentLeakCount=0
independentReviewGate2=APPROVED
milestone2=SEALED
milestone3Authorized=false
mergeAuthorized=false
productionUseAuthorized=false
wpCAuthorized=false
formalRelease=false
publish=false
temporaryBypassAllowed=false
```

## 16. Non-goals

Milestone 2 does not:

- merge PR #17;
- mark PR #17 ready for review;
- authorize production use;
- authorize Milestone 3;
- authorize WP-C;
- publish packages or artifacts;
- introduce Temporal Server or a second runtime service;
- replace SQLite;
- add a second durable execution truth;
- preserve callable legacy paths behind flags.
