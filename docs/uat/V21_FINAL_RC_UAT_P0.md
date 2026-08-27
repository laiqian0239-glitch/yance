# V21 Fresh Final RC/UAT P0 Successor-v5 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This file is the single authorized marker for the fresh successor-v5 Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, ledger closure, or publish.

## Exact causal lineage

- Frozen predecessor: PR #898 exact head `3bf0102a2054846f386cbeda1d198c19e98da5ad`; Product Final run `33062994777` / Windows job `98486121099` completed the one full packaged application build and real packaged launch, then the same-build startup capsule failed with `STARTUP_CAPSULE_POST_INSTALL_TIMEOUT`. That head remains frozen and must not be rerun or mutated.
- Focused owner/claim-state repair: PR #899 authorization; PR #900 ordinary merge `da848fb662af50dc156f5cba1a6b416f3b33d60c`.
- Successor-v5 Product Final route authorization: PR #901 ordinary merge `34419bb5276409d9afb0119a373d0c502f7777a0`.
- Fresh route RED: `f4cf2d775f0c6ee95fa9d12b66ea03c087d91410` / Stage `33069678092`, `unknownBlockers=0`.
- Route GREEN exact head: `d5db507807f13012d1f0f12030cfe05dfb06c801`; Stage `33070961807`, Layered `33070961923`, ACV2 and Model Brain all GREEN; PR #902 ordinary merge `1cdd6d1c1721a2e7a99280ce5a5f7d6207515684`.
- Fresh successor-v5 candidate authorization: PR #903 ordinary merge `73598b434f1e4647be483d4f687f7704c2ac3db8`.
- Candidate branch: `release/v21-final-rc-uat-p0-successor-v5`.
- Authorized candidate delta relative to the authorization merge: exactly `docs/uat/V21_FINAL_RC_UAT_P0.md`.
- Source/runtime/test/workflow/routing/dependency/package/lockfile/database mutation: forbidden.

The candidate identity is the repository-reported immutable PR head produced by this marker revision. The marker does not self-embed that head because the marker commit itself advances it. Any later candidate-byte or ancestry change invalidates all prior exact-head evidence.

## Mandatory exact-head Product Final

`V21 Product Experience Shell P0 Final Validation` must run on the exact successor-v5 candidate head and must not be treated as GREEN if skipped. These three existing jobs must all PASS on that same exact head:

1. `frozen-element-reproducibility`
2. `materialized-desktop-uat`
3. `materialized-matrix-uat`

The Windows job must perform exactly one full application build. The startup capsule must be a same-job projection of that full application and must prove:

- server import
- `startup.migrate`
- backend ready
- Element ModuleLoader
- post-install

The startup-capsule manifest must be `status=PASS` and `byteIdentity=VERIFIED`. Artifacts and receipts must be bound to the exact candidate head. Historical artifacts or receipts are invalid for this candidate.

Stage, Layered CI, and every routed ACV2 / Model Brain gate must satisfy exact-head policy. Independent exact-head review requires P0=0, P1=0, and zero unresolved review threads.

## Fail-closed boundary

If any Product Final job, startup-capsule checkpoint, Final Delta check, packaged launch, or UAT P0/P1 fails, this exact candidate head is frozen. Same-head rerun is forbidden; the next action must be a separately authorized failure-first causal prerequisite with `unknownBlockers=0`.

Full Windows RC/UAT download is forbidden until this exact-head Product Final and same-build startup capsule are GREEN.

This candidate does not set or authorize `releaseLedgerClosed`, `releaseReady`, `formalReleaseAuthorized`, or `publishAuthorized`.
