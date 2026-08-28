# V21 Fresh Final RC/UAT P0 Successor-v7 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v7 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Repository: `laiqian0239-glitch/yance`.
- Frozen predecessor: PR #910 exact head `1918d9ae18edf20ea585f27948983c1c6ffacd32`; Product Final run `33090872542` / Windows job `98583039820` completed the one full packaged application build and real packaged post-install launch, then the same-build startup capsule failed with `STARTUP_CAPSULE_POST_INSTALL_TIMEOUT`. That head remains frozen and must not be rerun, mutated, merged, or reused.
- Boot-critical canonical authority repair: PR #920 ordinary merge `3e4a2299d7a7a5e2c989fd72159f7ba9f2de9197`.
- Boot-critical closure: PR #921 exact head `15f2a9fb1d1b2bfbf367e446fe7abfe09e07e025`, ordinary merge `5df0edc8471f536c9ba97029c3b56b824e86a824`.
- Successor-v7 Product Final route authorization: PR #922 ordinary merge `d3cbe386c447ab663cb330be303420eb7cbacdca`.
- Fresh route RED: exact head `3d83d1aaa4556de7d62f9c64c4f616390caa6fe4` / Stage `33141188550`, frozen and never rerun, `unknownBlockers=0`.
- Route GREEN exact head: `0e151bc5de9b770c7931096fadbd151ff4002a5d`; Stage `33141571641`, Layered CI `33141571833`, ACV2 `33141571638`, Model Brain Windows `33141571868` all GREEN; Product Final correctly skipped on the repair branch; PR #923 ordinary merge `0081bb4eb851d69a96ad46fc93cdf41e71cb24a2`.
- Fresh successor-v7 candidate authorization: PR #924 exact head `5007a47bf15b396c607de9c44b5e48b91f667a5b`, ordinary merge `1bf5e960af867bf2f70be922d941dd319ed5bff8`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v7`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. This marker intentionally does not self-embed that candidate head because this commit itself advances the candidate. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact successor-v7 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

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
