# V21 Fresh Final RC/UAT P0 Successor-v8 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v8 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Repository: `laiqian0239-glitch/yance`.
- Frozen predecessor: PR #925 exact head `36a84aab6fe0380bfa903c96e2861418ae5b6c26`; Product Final run `33142379372` / Windows job `98755831790` passed frozen Element reproducibility, Matrix UAT, and the unique full packaged build, then the real packaged/post-install launch failed with `WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED` before the same-build startup capsule could execute. That head remains frozen and must not be rerun, mutated, merged, or reused.
- Packaged WP4 owner-recovery closure: PR #927 ordinary merge `08e7efefe56d5a30e7c5f868b2bab1db383eccd6`.
- Successor-v8 Product Final route authorization: PR #928 ordinary merge `c4ba88e3c5d4098bf1fea4c344aceef7cb1c75da`.
- Fresh route RED: exact head `df185df5666f72da697d2e1b6eba31de69377ac9` / Stage `33147563947`, frozen and never rerun, `unknownBlockers=0`.
- Route GREEN exact head: `e59cd06a7b8291106935b18034f6713ed2af66ec`; Stage `33148009038`, Layered CI `33148009258`, ACV2 `33148009034`, Model Brain Windows `33148009035` all GREEN; Product Final correctly skipped on the route branch; PR #929 ordinary merge `1781688fab2d6b5d11bf8ca4878273e21a20326f`.
- Fresh successor-v8 candidate authorization: PR #930 exact head `93aae08de4c73af6a4e0ed5c73ecad138825b556`, ordinary merge `5f7e15fdd73c5c1e46a6b7af50b2422e4e261024` after Stage `33148481361`, Layered CI `33148481594`, ACV2 `33148481377`, and Model Brain Windows `33148481402` all GREEN; Product Final correctly skipped on the authorization branch; independent exact-head review P0=0/P1=0; `unknownBlockers=0`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v8`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. This marker intentionally does not self-embed that candidate head because this commit itself advances the candidate. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact successor-v8 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

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

Full Windows RC/UAT download is forbidden until this exact-head Product Final and same-build startup capsule are GREEN. When that boundary is reached, the package must be downloaded from a fresh GitHub signed artifact URL and used as the exact UAT bytes; Motrix is the default large-file downloader.

This candidate does not set or authorize `releaseLedgerClosed`, `releaseReady`, `formalReleaseAuthorized`, or `publishAuthorized`.
