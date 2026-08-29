# V21 Fresh Final RC/UAT P0 Successor-v12 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v12 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Repository: `laiqian0239-glitch/yance`.
- Frozen predecessor: PR #950 exact head `ca2e8ba3cc900c24111476ea459650cec45991a8`; Stage `33221931041`; Product Final run `33221931040` / Windows job `99017599826`. The unique full packaged build and first real packaged/post-install launch passed; the second fresh packaged process in the same-build startup capsule failed at `WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED`. That exact head remains frozen and must not be rerun, mutated, merged, or reused.
- Fresh-process credential readability closure authorization: PR #952 ordinary merge `3d9bdff051bc9cfef1c5f4ca122944e9c7c14c68`.
- Fresh-process credential readability closure implementation: PR #953 exact head `e22db6a9c237ab47c25daa10ce44a88f562b8e1f`, ordinary merge `f08c81a00b324363d1340d50ed2285a26590ebbe`.
- Successor-v12 Product Final route authorization: PR #954 ordinary merge `6046c8c39454ec2ec409aa004733e146321f06dc`.
- Fresh route RED: exact head `3b7ef40b32b42cc3b1d037e3c9ea5e3a027d5aa2` / Stage `33227440709`, frozen and never rerun, `unknownBlockers=0`.
- Route GREEN exact head: `b8a9ed2eb7da49b631f55805184366df1b7ce708`; Stage `33227555470`, Layered CI `33227555571`, ACV2 `33227555522`, Model Brain Windows `33227555436` all GREEN; Product Final correctly skipped on the route branch; PR #955 ordinary merge `06e09f28adc7d9114d19ee597bf12768a6b214cd`.
- Fresh successor-v12 candidate authorization: PR #956 exact head `fe15c3dd889a6f11fdb582c0043a508b79cc3bd0`, ordinary merge `d8286204b061711aade15cfaf0af79d268852883` after Stage `33228307780`, Layered CI `33228307929`, ACV2 `33228307745`, and Model Brain Windows `33228307736` all GREEN; Product Final correctly skipped on the authorization branch; independent exact-head review P0=0/P1=0; `unknownBlockers=0`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v12`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. This marker intentionally does not self-embed that candidate head because this commit itself advances the candidate. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact successor-v12 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

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
