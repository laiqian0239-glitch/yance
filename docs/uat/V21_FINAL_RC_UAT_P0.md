# V21 Fresh Final RC/UAT P0 Successor-v14 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v14 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Repository: `laiqian0239-glitch/yance`.
- Current product baseline: PR #986 exact head `c86a740ee96499c6ad9e55fc0f09f9e055db982c`, ordinary merge `19e5d588c6731de3880369c71f36e7a42d8bd46a`. Historical RED/UAT heads remain immutable and their artifacts/receipts are not reusable for this candidate.
- Successor-v14 route probe: PR #987 exact head `6347c260b71056761a94b9658462e81cbe90411f` / Stage `33389306901`, frozen RED and never rerun.
- First route authorization attempt: PR #988 exact head `5510fe46e532614c17d2c35941fcbb7152f9f3a5`, frozen RED and never rerun.
- Route delegated authorization GREEN: PR #989 exact head `bc8d27aa301e5946fb9a9240ac7d65c7c39d3956`, ordinary merge `985a20bec0023c7e3598878213398233244c4542`.
- Route implementation GREEN exact head: PR #990 `ffc3da464c73a00fe390064246a86959ace1cc30`; Stage `33393504271`, Layered CI `33393504507`, ACV2 `33393504205`, Model Brain Windows `33393504226` all GREEN; Product Final correctly skipped on the `ci/` route branch; ordinary merge `f3ac55ac0114c1c6c96a8850449ad9f5c9eec77d`.
- Fresh successor-v14 candidate authorization: PR #991 exact head `f74eba4f5b11763a6be454334fa4cf8d2f2005fa`; Stage `33395153195`, Layered CI `33395153453`, ACV2 `33395153182`, Model Brain Windows `33395153205` all GREEN; Product Final correctly skipped on the governance branch; ordinary merge `cd624ccb2975f84a86627df672d47e8582624f56`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v14`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. This marker intentionally does not self-embed that candidate head because this commit itself advances the candidate. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact successor-v14 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

1. `frozen-element-reproducibility`
2. `materialized-desktop-uat`
3. `materialized-matrix-uat`

The Windows Desktop job must perform exactly one full application build and a real packaged post-install launch. The startup capsule must be a same-job projection of that exact full application and must prove the populated disposable R32 startup chain through:

- server import
- `startup.migrate`
- backend ready
- Element ModuleLoader
- post-install

The startup-capsule manifest must be `status=PASS` and `byteIdentity=VERIFIED`. The Matrix materialization must pass its trusted Compose parse/config gate before sealing/upload, preserving image-only `--no-build` semantics. Product Final artifacts, packaged launch receipt, startup-capsule evidence, Final Delta, review, and downstream UAT must all bind to this exact candidate head. Historical artifacts or receipts are invalid for this candidate.

Stage, Layered CI, and every routed ACV2 / Model Brain / WP gate must satisfy exact-head policy. Independent exact-head review requires P0=0, P1=0, and zero unresolved review threads.

## Mandatory Final Delta and fail-closed boundary

Formal Final Delta must cover through this exact RC head with `unknownBlockers=0`, unclassified Delta P0=0, and unclassified Delta P1=0. No historical Final Delta may substitute for this exact-head continuation.

If any Product Final job, startup-capsule checkpoint, Matrix Compose parse/config gate, Final Delta check, packaged launch, or UAT P0/P1 fails, this exact candidate head is frozen. Same-head rerun is forbidden; the next action must be a separately authorized causal fix/new exact head with `unknownBlockers=0`.

Full Windows RC/UAT download is forbidden until this exact-head Product Final and same-build startup capsule are GREEN. When that boundary is reached, the package must be downloaded from a fresh GitHub signed artifact URL and used as the exact UAT bytes; Motrix is the default large-file downloader.

This candidate does not set or authorize `releaseLedgerClosed`, `releaseReady`, `formalReleaseAuthorized`, or `publishAuthorized`.
