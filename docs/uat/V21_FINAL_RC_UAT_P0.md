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
- First forward reconciliation merge: `6580b14b2dd6da051f5b16437318ffd940ba88a7` with parents `f38e0a421e72eae9e80865e270312cad8e7f5bf0` + `7c0a2f85ce74be6b2290cc35a0531f5d0391756e`
- Prior exact RC head `375b99f7eb22c9631a804d793822345a4a0338ad` is historical-only after fresh real-Windows existing-data UAT reached `startup.migrate` and exposed `BOOT_SERVER_IMPORT_FAILED`; every Final Delta, CI, Product Final artifact/receipt, downloaded package and review bound to that head is stale for final closure.
- Existing-data startup causal diagnostic authorization: PR #859 ordinary merge `3ed00f4c3ee533e7c29649fa921dab2f11c57ffb`
- Frozen causal RED: PR #860 head `0dc374d38377875b65ca8266a677beec9e1286fc`, Stage `32979363837`, 717 mandatory tests / 714 PASS / exactly 3 causal RED, `unknownBlockers=0`
- Production-scope amendment: PR #861 ordinary merge `114da197d73141a11ec6305f4f0bfc0f6cc850fe`
- Root-fix exact production head: PR #862 head `0ded6ed2ab5c4269735030feadc06be422a65a51`, independent exact-head review P0=0/P1=0, zero unresolved threads, all applicable routed gates complete without failure
- Root-fix trusted-main ordinary merge: `6cf9d0101ece1aca4dea55935bc3a2e7c605e448`, strict parents `114da197d73141a11ec6305f4f0bfc0f6cc850fe` + `0ded6ed2ab5c4269735030feadc06be422a65a51`
- Second forward reconciliation: PR #863 ordinary merge `1b21e817b02293da7b9db744fc0c00f974e432f8`, strict parents `375b99f7eb22c9631a804d793822345a4a0338ad` + `6cf9d0101ece1aca4dea55935bc3a2e7c605e448`
- Historical scheduler-recovery RC head `04c0d5d584491ca0d9e771ae2d71e436acc4ab1a` is stale/frozen after real-Windows UAT exposed the later post-boot migration family; all artifacts, receipts and downloads bound to it are forbidden for current closure.
- Post-boot migration root closure ordinary merge: PR #873 → `d9c88514a630928873eaf2e3d18617eff32129ed`; exact implementation head `c7e75bb0c3e2f20468b6fde5cab9191f306ffece` passed its exact-head causal closure before merge.
- Historical predecessor authorization nodes #874 and #880 form an invalid supersession graph and are evidence only; no current authority may reuse or supersede through that graph.
- Frozen successor-v2 candidate evidence: PR #881 exact head `d73c880912c4310a0fee433e7be321236735811b`; Stage run `33040613226` rejected its delegated authority while Product Final run `33040613281` independently proved the full packaged launch and then failed the same-build populated-R32 startup-capsule step. This exact head must not be rerun or mutated.
- Product Final successor-v3 route closure is ordinary-merged through PR #886 at trusted main `2f53b26732dead09683f152aacda80a753963b81`; all three existing Product Final jobs admit the exact branch `release/v21-final-rc-uat-p0-successor-v3` by equality.
- Startup-capsule durable failure telemetry closure: PR #887 authorization + PR #888 implementation ordinary merge `7f73b95b12a906d87513e7ea222c3fb51fa54311`. The helper now preserves the structured `STARTUP_CAPSULE_*` failure record at `startup-capsule/diagnostics/startup-capsule-failure.json` before nonzero exit whenever the output diagnostics seam exists.
- Clean successor-v3 authorization: PR #889 ordinary merge `e304f310d8466289da3928f052ea7d3cb70f6778`, strict parents `7f73b95b12a906d87513e7ea222c3fb51fa54311` + `d6a8016e49a18722d34692ffb98fb3efa82b5eb1`.
- This marker commit is the direct child of authorization merge `e304f310d8466289da3928f052ea7d3cb70f6778`; the authorization intentionally contains no `supersedes` edge to #874, #880, #881, or any implementation branch in that invalid graph.
- Exact candidate branch: `release/v21-final-rc-uat-p0-successor-v3`
- Authorized candidate change set relative to authorization merge: exactly this file only
- Candidate source/runtime mutation: forbidden
- Historical PR #538: historical evidence only; its branch, artifacts, and receipts are not final-RC evidence

The final candidate identity is the current immutable PR head after this marker-only successor commit. The document intentionally does not self-embed that head SHA because this marker commit itself advances the candidate. Final Delta, CI, Product Final artifacts, startup-capsule evidence, packaged launch receipt, review, and merge evidence must all bind to the repository-reported exact PR head. Any later candidate-byte or ancestry change invalidates prior final evidence and requires a fresh exact-head pass.

## Mandatory Final Delta

The formal Final Delta must extend from historical audit baseline `bdc556faa7da70bb6f0ae026e87fa1ab14d5e8b0` through this exact RC head. Existing pre-RC Delta evidence may be mechanically chained only when its endpoint and the continuation to this exact head are both verified. Completion requires:

- `unknownBlockers=0`
- unclassified Delta P0 = 0
- unclassified Delta P1 = 0
- the post-`375b99f7...` production continuation is explicitly classified, including the PersonalAccess startup repair, post-boot migration closure, successor-v3 Product Final route, and startup-capsule failure-telemetry closure
- any fresh executable or packaged P0/P1 freezes this exact RC head and returns to a separately authorized failure-first causal prerequisite

No Delta completion claim is embedded in this marker; the exact-head PR evidence is authoritative.

## Mandatory fresh RC/UAT execution

The existing `V21 Product Experience Shell P0 Final Validation` workflow must execute on this exact branch and must not be treated as GREEN if skipped. All three actual existing jobs must PASS on the same exact candidate head:

1. `frozen-element-reproducibility`
2. `materialized-desktop-uat`
3. `materialized-matrix-uat`

The Windows Desktop job must perform exactly one real full packaged application build. From that same Windows job and the same full-build bytes it must project the startup capsule; a second application build is forbidden. The capsule must have an independently named exact-head-bound artifact, manifest status PASS, and mechanical byte identity `VERIFIED` for every application-origin startup file against the full RC output.

Before any full-RC Windows UAT download, the startup capsule must pass the populated disposable R32 startup chain: `server import` → `startup.migrate` → `backend ready` → `Element ModuleLoader` → fresh `post-install` receipt. If the capsule fails, the exact structured reason must be preserved in the exact-head diagnostics artifact; that RED freezes this candidate and becomes the evidence for one separately authorized causal repair. No same-head rerun is allowed.

The full materialized Windows Desktop job must still launch the exact packaged Yance against the exact pinned Element ModuleLoader path and produce a fresh PASS receipt. Linux Matrix materialization and frozen Element reproducibility remain mandatory. Artifacts and receipts must be bound to the exact candidate head; stale or historical receipts are forbidden.

Stage, Layered, and every routed ACV2/WP-A/WP-B/Model gate must also satisfy the exact-head policy. Independent review requires P0=0, P1=0, and zero unresolved threads.

Only after fresh exact-head Product Final and startup-capsule validation pass may the complete 500+ MB RC be downloaded for UAT-001 / issue #1 on real Windows. That UAT still requires real-Windows real-provider model-worker acceptance on these exact new packaged bytes. The old `375b99f7...`, `04c0d5d5...`, `6ef44bd2...`, and frozen `d73c8809...` packages cannot satisfy that boundary. Real AppData/DB remains untouched until the exact new package is downloaded and the explicit UAT execution step is reached.

## Fail-closed release boundary

This candidate does not set or authorize any of the following:

- `releaseLedgerClosed`
- `releaseReady`
- `formalReleaseAuthorized`
- `publishAuthorized`

All remaining real-defect Known Finding packaged obligations remain subject to fresh exact-head packaged RC evidence. Only a separate downstream authorization may consume successful exact-head Final Delta + fresh packaged RC/UAT evidence into the Release Closure Ledger and subsequent release/publish state.

## CI registration provenance

This clean successor is marker-only and begins from ordinary-merged authorization `e304f310d8466289da3928f052ea7d3cb70f6778`. It changes no product/runtime/test/runner/workflow/routing/dependency/package/lockfile/database bytes. All Final Delta, CI, Product Final artifacts, startup-capsule evidence, packaged receipts, review, and downstream UAT evidence must bind to the resulting repository-reported exact head; every precursor exact-head result remains stale.
