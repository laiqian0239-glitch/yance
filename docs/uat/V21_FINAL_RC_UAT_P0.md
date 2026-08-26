# V21 Fresh Final RC/UAT P0 Candidate

Status: `VALIDATION_CANDIDATE_ONLY`

This document is the single authorized evidence marker for the fresh Final RC/UAT candidate. It is not a release receipt and does not authorize release, promotion, or publish.

## Exact lineage

- Repository: `laiqian0239-glitch/yance`
- Authorization: PR #853
- Effective authorization merge / original candidate base: `245a053da6a2f05d0b45031ce028d79c6922c5b5`
- Original marker head preserved in ancestry: `f38e0a421e72eae9e80865e270312cad8e7f5bf0`
- Layered-route prerequisite authorization / implementation: PR #855 / PR #856
- Trusted-main Layered-route prerequisite merge: `7c0a2f85ce74be6b2290cc35a0531f5d0391756e`
- Forward reconciliation merge: `6580b14b2dd6da051f5b16437318ffd940ba88a7` with parents `f38e0a421e72eae9e80865e270312cad8e7f5bf0` + `7c0a2f85ce74be6b2290cc35a0531f5d0391756e`
- Exact candidate branch: `release/v21-final-rc-uat-p0`
- Authorized candidate change set relative to current trusted main: exactly this file only
- Candidate source/runtime mutation: forbidden
- Historical PR #538: historical evidence only; its branch, artifacts, and receipts are not final-RC evidence

The final candidate identity is the current immutable PR head after this recorded forward-only lineage. The document intentionally does not self-embed that head SHA because this marker commit itself advances the candidate. Final Delta, CI, Product Final artifacts, packaged launch receipt, review, and merge evidence must all bind to the repository-reported exact PR head. Any later candidate-byte or ancestry change invalidates prior final evidence and requires a fresh exact-head pass.

## Mandatory Final Delta

The formal Final Delta must extend from historical audit baseline `bdc556faa7da70bb6f0ae026e87fa1ab14d5e8b0` through this exact RC head. Existing pre-RC Delta evidence may be mechanically chained only when its endpoint and the continuation to this exact head are both verified. Completion requires:

- `unknownBlockers=0`
- unclassified Delta P0 = 0
- unclassified Delta P1 = 0
- any fresh executable P0/P1 freezes this exact RC head and returns to a separately authorized failure-first causal prerequisite

No Delta completion claim is embedded in this marker; the exact-head PR evidence is authoritative.

## Mandatory fresh RC/UAT execution

The existing `V21 Product Experience Shell P0 Final Validation` workflow must execute on this exact branch and must not be treated as GREEN if skipped. All three actual existing jobs must PASS on the same exact candidate head:

1. `frozen-element-reproducibility`
2. `materialized-desktop-uat`
3. `materialized-matrix-uat`

The Windows Desktop job must materialize the reviewed package, launch the exact packaged Yance against the exact pinned Element ModuleLoader path, and produce a fresh PASS receipt. Linux Matrix materialization and frozen Element reproducibility remain mandatory. Artifacts and receipts must be bound to the exact candidate head; stale or historical receipts are forbidden.

Stage, Layered, and every routed ACV2/Model gate must also satisfy the exact-head policy. Independent review requires P0=0, P1=0, and zero unresolved threads.

## Fail-closed release boundary

This candidate does not set or authorize any of the following:

- `releaseLedgerClosed`
- `releaseReady`
- `formalReleaseAuthorized`
- `publishAuthorized`

The 27 P0 + 7 P1 real-defect Known Finding packaged obligations remain subject to fresh packaged RC evidence. Only a separate downstream authorization may consume successful exact-head Final Delta + fresh packaged RC/UAT evidence into the Release Closure Ledger and subsequent release/publish state.
