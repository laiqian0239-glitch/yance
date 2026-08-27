# V21 Fresh Final RC/UAT P0 Successor-v6 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v6 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Frozen predecessor: PR #904 exact head `7e46cbcf28bc372ac512360b9161aa8e4cf4192a`; Product Final run `33072250632` / Windows job `98517215926` completed the one full packaged application build and real packaged post-install launch, then the same-build startup capsule failed with `STARTUP_CAPSULE_POST_INSTALL_TIMEOUT`. That head remains frozen and must not be rerun, mutated, merged, or reused.
- Focused native-governance event-loop repair authorization / implementation: PR #905 / PR #906; root repair ordinary merge `08ba10383014d0b8186ffb4902b3025391b40683`.
- Successor-v6 Product Final route authorization: PR #907 ordinary merge `4a6117810d9d0a03a901ba047e4d85fc4684addd`.
- Fresh route RED: exact head `048fe32fecf8e88ae2b500dfa62e17a9dc12c25c` / Stage `33086211129`, `unknownBlockers=0`.
- Route GREEN exact head: `bd5faf010c12dcb46e991776e51c97d1bcab106b`; Stage `33089071008`, Layered `33089071333`, ACV2 `33089071023`, Model Brain Windows `33089070990` all GREEN; PR #908 ordinary merge `a65e534cefda525f56c73d2e41578f0eb2813cfc`.
- Fresh successor-v6 candidate authorization: PR #909 ordinary merge `d5a5e8ff1f41352a2f400ed37138ea14ef820484`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v6`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. The marker intentionally does not self-embed that head because this commit itself advances the candidate. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact successor-v6 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

1. `frozen-element-reproducibility`
2. `materialized-desktop-uat`
3. `materialized-matrix-uat`

The Windows Desktop job must perform exactly one full application build and a real packaged post-install launch. The startup capsule must be a same-job projection of that exact full application and must prove the populated disposable R32 startup chain through:

- server import
- `startup.migrate`
- backend ready
- Element ModuleLoader
- post-install

The startup-capsule manifest must be `status=PASS` and `byteIdentity=VERIFIED`. Product Final artifacts, packaged launch receipt, startup-capsule evidence, Final Delta, review, and downstream UAT must all bind to this exact candidate head. Historical artifacts or receipts are invalid for this candidate.

Stage, Layered CI, and every routed ACV2 / Model Brain / WP gate must satisfy exact-head policy. Independent exact-head review requires P0=0, P1=0, and zero unresolved review threads.

## Mandatory Final Delta and fail-closed boundary

Formal Final Delta must cover through this exact RC head with `unknownBlockers=0`, unclassified Delta P0=0, and unclassified Delta P1=0. No historical Final Delta may substitute for this exact-head continuation.

If any Product Final job, startup-capsule checkpoint, Final Delta check, packaged launch, or UAT P0/P1 fails, this exact candidate head is frozen. Same-head rerun is forbidden; the next action must be a separately authorized failure-first causal prerequisite with `unknownBlockers=0`.

Full Windows RC/UAT download is forbidden until this exact-head Product Final and same-build startup capsule are GREEN. When that boundary is reached, the package must be downloaded from a fresh GitHub signed artifact URL and used as the exact UAT bytes.

This candidate does not set or authorize `releaseLedgerClosed`, `releaseReady`, `formalReleaseAuthorized`, or `publishAuthorized`.
