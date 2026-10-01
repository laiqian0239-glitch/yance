# Release Controller Failure Prevention — Owner-Mandated Additive Guardrail

Status: RELEASE-BLOCKING. Apply together with root `AGENTS.md`. This document only adds stricter execution rules; it never weakens repository policy or mature-owner authority.

## Errors observed in final release closure

1. **Source closure was treated as Product closure.** Focused source tests were GREEN before the exact Windows candidate had proved startup, invite/access, login/session/security, real Yance primary shell, timeline/composer/send, logout/relogin/session restore, and final Windows materialized identity.
2. **PR governance admission was left to CI.** Current-main route/risk/branch rules could have rejected the diff statically before CI.
3. **Helpers invented false authority.** Hard branch equality, detached-HEAD rejection, newline assumptions, template interpolation bugs, and global string-index assumptions caused repeated helper/local-closure REDs.
4. **Caller/callee release contracts drifted.** WP7 Builder required a sealed Matrix runtime plus candidate identity, while Product Final still invoked it without those inputs.
5. **Artifact transport was not closed end-to-end.** Producer, seal, upload, dependency order, download, verify, and consumer invocation were not audited as one boundary.
6. **Remote/local sync was discussed using commit SHA alone.** Ordinary merge can change commit identity while preserving an identical tree.
7. **READY_FOR_RC was declared too early.** Final Builder/materialization and the real Windows Product Golden Journey were not yet fully proved.
8. **CI/Final Builder exposed preventable blockers.** These were Controller execution failures because source/workflow/static inspection could have caught them earlier.

## Mandatory prevention rules

```text
SOURCE_CLOSURE_IS_PRODUCT_CLOSURE=false
LOCAL_WINDOWS_PRODUCT_SEAL_REQUIRED_BEFORE_RC=true
PROMOTION_ADMISSION_STATIC_PREFLIGHT=mandatory
CALLER_CALLEE_CONTRACT_AUDIT=mandatory
ARTIFACT_PRODUCER_TRANSPORT_CONSUMER_AUDIT=mandatory
HELPER_SELF_VALIDATION_BEFORE_USER_EXECUTION=mandatory
USER_MACHINE_ASSUMPTION_DISCOVERY=forbidden
REMOTE_LOCAL_TREE_IDENTITY_REQUIRED=true
PREVENTABLE_LATE_RED=CONTROLLER_EXECUTION_FAILURE
FULL_GOLDEN_JOURNEY_REQUIRED_BEFORE_READY_FOR_RC=true
```

### Product closure

`SOURCE_LOCAL_CLOSURE_GREEN` and `LOCAL_WINDOWS_PRODUCT_SEAL_GREEN` are separate states. Never set `PROMOTION_UNKNOWN_BLOCKERS_ZERO`, `READY_FOR_RC`, or `READY_FOR_UAT` from source tests alone.

Before RC, when applicable, the exact final materialized Windows candidate must prove: startup; invite/entitlement/access; login; Matrix/Element session and security; Yance-owned primary Product shell; navigation; timeline/composer/send; logout/relogin/session restore; executable/installer/shortcut/Start Menu/Apps&Features/tray/window/title/config/runtime identity.

A login page, raw Element Home/Auth/CompleteSecurity, source harness, or browser surrogate is not proof of the final Yance production interface.

### PR and promotion admission

Before opening a Product PR, statically evaluate the entire changed-path set against current-main routing, risk classification, implementation-branch policy, authorization, immutable topology, and review contracts. CI must not be the first evaluator of known base-owned admission rules.

Any required governance prerequisite lands first while Product bytes stay frozen.

### Helper admission

A helper may hard-gate only trusted production invariants: exact head/tree/prehash, clean state when required, allowed path set, exact transformation, postconditions, staged path set, parent/subject, and push topology.

Do not turn branch attachment, detached state, newline style, source formatting, or path convenience into authority unless trusted repository policy requires it.

Before giving a helper to the user, self-validate: syntax; template/string interpolation; exact preimage; all replacements; mutation order; fail-closed error reporting; changed paths; and focused postimage behavior whenever off-machine proof is possible.

A failure before first production write is `HELPER_RED`, never Product RED. Never rerun an unchanged failed helper. Remove false authority instead of adding compatibility layers.

### Caller/callee and Final Builder contract

Whenever a required CLI argument, environment input, sealed artifact, manifest field, or runtime changes, audit **every production caller** before promotion.

For Final Builder maintain an end-to-end contract:

```text
required input
-> mature producer
-> materialize/seal
-> artifact identity
-> transport
-> post-download verify
-> consumer invocation
-> focused regression
```

Builder unit tests alone are insufficient if the release workflow caller is not simultaneously validated.

Mature owners remain owners. Example: Matrix build/seal stays with Docker/Compose and the existing Matrix materializer; WP7 consumes the sealed result. Never repair transport drift by building a second Matrix lifecycle on Windows.

### Artifact transport

Audit artifact name, producer job, dependency order, run/head/tree binding, upload timing, download seam, verification, and consumer path as one boundary. Reuse existing mature GitHub artifact seams; do not invent a second downloader/state authority.

### Remote/local identity

Content synchronization is proven by exact Git tree identity and relevant materialized hashes, not commit SHA alone. After ordinary merge, use a fresh worktree from exact current main and prove `LOCAL_TREE == REMOTE_MAIN_TREE`; never reset/clean a historical dirty worktree merely to synchronize it.

### READY_FOR_RC admission

`READY_FOR_RC=YES` requires all of the following:

1. current-main governance admission closed;
2. affected source Local Closure GREEN;
3. caller/callee workflow/build/packaging contracts reconciled;
4. final materialized output audited;
5. exact Windows Local Product Seal / Golden Journey GREEN when in release boundary;
6. `unknownBlockers=0` across the complete affected boundary;
7. no known shadow/retired authority in the production chain.

Missing any item means `READY_FOR_RC=NO`.

## Hard checklists

Before Exact Head / CI:

```text
[ ] current main/base/head/tree exact
[ ] complete changed-path set classified by trusted-main governance
[ ] mature owner topology reviewed; no second owner
[ ] all changed public seams reconciled with all production callers
[ ] artifact producer->seal->transport->verify->consumer closed
[ ] full affected focused suite GREEN, not only a new test
[ ] helper/executor self-tested off-user-machine where possible
[ ] user command has no exploratory assumption
[ ] unknownBlockers=0 for this boundary
```

Before RC:

```text
[ ] exact-head CI validators GREEN; skipped != GREEN
[ ] ordinary merge and merge tree audited
[ ] fresh current main established
[ ] Final Builder required inputs reconciled end-to-end
[ ] final materialized Windows output audited
[ ] fresh local exact-main tree identity proven
[ ] startup + invite/access + login + session/security + Yance primary shell GREEN
[ ] timeline/composer/send + logout/relogin/session restore GREEN when applicable
[ ] Windows executable/installer/native identity GREEN
[ ] unknownBlockers=0
```

## Enforcement

A preventable CI/Final Builder/RC/UAT RED is also `CONTROLLER_EXECUTION_FAILURE`. Freeze evidence, repair the earliest admission mechanism that should have caught it, re-audit the whole same-owner/same-contract boundary, and only then create one successor Exact Head. Serial blocker peeling and user-machine debugging loops are forbidden.
