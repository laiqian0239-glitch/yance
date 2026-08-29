# V21 Fresh Final RC/UAT P0 Successor-v13 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v13 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Repository: `laiqian0239-glitch/yance`.
- Frozen predecessor: PR #957 exact head `0f3fe1b3927aeca421bb4fee759fdbc14bd20f3c`; Stage `33228563059`; Layered CI `33228563200`; ACV2 `33228562961`; Model Brain Windows `33228563015`; Product Final `33228563221`. All exact-head CI was GREEN, but real Windows UAT exposed the unique deterministic boundary `MATERIALIZED_MATRIX_COMPOSE_YAML_PARSE_INVALID` before Matrix startup. That exact RC head and all of its artifacts/receipts remain frozen and must not be rerun, mutated, locally patched, or reused.
- Real Windows UAT causal record: issue #960. The sealed successor-v12 bytes verified and all four images loaded, but the first `docker compose up -d --no-build` failed because the materialized Compose YAML contained an unquoted `${YANCE_UAT_CANDIDATE_SHA}` image scalar inside a flow mapping.
- Materialized Matrix Compose parser/config closure: PR #972 ordinary merge `7d56ea742f407647492bb88676216da2d40afd2b`.
- Successor-v13 Product Final route authorization: PR #973 ordinary merge `b0d7ea2f11aa504b51846fe153a781768ded4192`.
- Fresh route failure-first RED: exact head `43f3af517e57f8e15c67eb163d3055a590dd223e` / Stage `33252842020`, frozen and never rerun; unique causal equality failure `actual=0 expected=3`; `unknownBlockers=0`.
- Forward-continuation authorization: PR #976 ordinary merge `a20b0467680dcede94092042a3dec8c050b38819`.
- Route GREEN exact head: `8079d2116e001e488bc3bce8d18a6f4756089e8d`; Stage `33254567786`, Layered CI `33254567919`, ACV2 `33254567717`, Model Brain Windows `33254567818` all GREEN; Product Final correctly skipped on the `ci/` route branch; PR #977 ordinary merge `aa6a0b7c2f6d104910b7fda960b52926a68cd942`.
- Fresh successor-v13 candidate authorization: PR #978 exact head `c22a9c19417efd84c3aac661d3cbccdd7e9d1f90`, ordinary merge `bd16ebb4a9d6e9007fb235caf487dbd3bab0b810` after Stage `33254940098`, Layered CI `33254940276`, ACV2 `33254940105`, and Model Brain Windows `33254940145` all GREEN; Product Final correctly skipped on the authorization branch; independent exact-head review P0=0/P1=0; `unknownBlockers=0`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v13`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database/ledger mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. This marker intentionally does not self-embed that candidate head because this commit itself advances the candidate. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must execute on this exact successor-v13 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

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

If any Product Final job, startup-capsule checkpoint, Matrix Compose parse/config gate, Final Delta check, packaged launch, or UAT P0/P1 fails, this exact candidate head is frozen. Same-head rerun is forbidden; the next action must be a separately authorized failure-first causal prerequisite with `unknownBlockers=0`.

Full Windows RC/UAT download is forbidden until this exact-head Product Final and same-build startup capsule are GREEN. When that boundary is reached, the package must be downloaded from a fresh GitHub signed artifact URL and used as the exact UAT bytes; Motrix is the default large-file downloader.

This candidate does not set or authorize `releaseLedgerClosed`, `releaseReady`, `formalReleaseAuthorized`, or `publishAuthorized`.
