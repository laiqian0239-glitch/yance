# V21 Release Closure Ledger

Status: ACTIVE / RELEASE NOT AUTHORIZED

Initial document authorization merge: `916c93d41feb72fa622cd40e2c8c20cabf4e7d91` (#656)

Release-ledger reconciliation authorization merge: `63684da2dee8e15ba1d6d75d016467e172f2ef50` (#770)

Reconciled trusted main: `2faa2a92d476a45bc08b58d33c877b6930e08897` (#769 ordinary merge)

Lane C audit authorization / exact audit base: `760c45a9a03305882249ffd3673a64baa6c29fa0` (#772 ordinary two-parent merge)

Post-Facebook audit authorization / exact implementation base: `26f95a2290c17e95fca01f3305dfca071b01f591` (#778 ordinary two-parent merge)

Post-Facebook audited trusted main: `f8d0a73603e4e4ff3f6207db80bcc9b60c7f15b7` (#777 ordinary two-parent merge)

Post-backend-startup audit authorization / exact implementation base: `a5be524b623a5554ccf719054e454012e51337a9` (#784 ordinary two-parent merge)

Post-backend-startup audited trusted main: `944474ab3e04913e55019526640ee76afe1ada73` (#783 ordinary two-parent merge)

Post-KF-P0-12 audit authorization / exact implementation base: `2ff6def7a406bb9e93dedbb8b00f2df1d184fe78` (#791 ordinary two-parent merge)

Post-KF-P0-12 audited trusted main: `06b1cb20452ec928b0316733bf5d1533cee37f23` (#790 ordinary two-parent merge)

Post-KF-P0-11 audit authorization / exact implementation base: `b026a8aca9a712a407e182dcf428b4f78f868762` (#797 ordinary two-parent merge)

Post-KF-P0-11 audited trusted main: `28f394e8be6d4f8dc9208dafe60373827c5e5f27` (#796 ordinary two-parent merge)

Post-KF-P0-19 audit authorization / exact implementation base: `9efdfa58a5a08fa3c2216c5e171710369df1f28e` (#803 ordinary two-parent merge)

Post-KF-P0-19 audited trusted main: `682cdce54d0e9fac919f57fb0354992a1770d48e` (#802 ordinary two-parent merge)

Post-KF-P0-22 audit authorization / exact implementation base: `36beef49e1a1135cf982b8d79035063e4dfc29d2` (#809 ordinary two-parent merge)

Post-KF-P0-22 audited trusted main: `0a5f0f5fefa7f851eb130927a12e18d3214993db` (#808 ordinary two-parent merge)

Post-KF-P0-20 audit authorization / exact implementation base: `e61deb5539ecb778140d4fac81fe9bd4da9cd8df` (#815 ordinary two-parent merge)

Post-KF-P0-20 audited trusted main: `e498acafabc3804302e3e1149441e5d81c96f596` (#814 ordinary two-parent merge)

Post-KF-P0-24 evidence-batch authorization / exact implementation base: `6e53bfef4e3340879a04194fd3bd9130e8ca3728` (#821 ordinary two-parent merge)

Post-KF-P0-24 audited trusted main: `b53745a3c52429464e1f7498b70d4548594563ac` (#820 ordinary two-parent merge)

Fresh-main Audit V2 authorization / successor implementation base: `3865bb079b29f49553dc265ac5340b8e58c27ec9` (#823 ordinary two-parent merge)

Fresh-main Audit V2 exact audited target: `fefd92e33954e392bb9a437b3e67237148b62f73` (#822 ordinary two-parent merge)

Delta Regression historical baseline: `bdc556faa7da70bb6f0ae026e87fa1ab14d5e8b0` (`docs(audit): deliver comprehensive status audit report 2026-08-20`).

Known Findings source: 2026-08-20 comprehensive feature review (historical audit baseline).

This ledger intentionally distinguishes source/gate closure from final packaged-RC closure. Because a new fresh-main final RC has not yet passed, **no Known Finding is finally `CLOSED` yet**.

## 1. Status vocabulary

- `OPEN` — no complete source-level closure chain has yet been reconciled for this finding.
- `CAUSAL_RED` — fresh failure-first evidence exists; root fix not yet fully closed.
- `EVIDENCE_RECONCILIATION` — related historical source work exists, but this exact finding's RED → fix → executed-gate chain still needs mechanical mapping.
- `SOURCE_GATE_CLOSED_RC_PENDING` — production/source fix is merged and exact-head mandatory gate evidence has been verified; final fresh-main packaged RC evidence is still mandatory.
- `PACKAGED_RC_PASS` — fresh final RC evidence passes for this finding, but final ledger audit is not yet complete.
- `CLOSED` — full finding → causal RED → root fix → executed mandatory test → exact-head GREEN → packaged/UAT chain is complete, or packaged evidence is explicitly proven non-applicable.

Any status other than `CLOSED` counts as unresolved for final release authorization.

### 2026-08-25 post-Facebook mechanical reconciliation checkpoint

The trusted-main reconciliation advances only rows with an exact finding-specific causal chain. In particular:

- Electron supported-runtime advisory: #720 causal RED → amendment chain → #733 exact-head GREEN → ordinary merge `9e510b66a8fa4e103ca6466bab081fb4a02e8f6c`.
- Letta/sharp and remaining production High advisories: #759 prerequisite plus #769 causal RED/root fix → exact-head GREEN → ordinary merge `2faa2a92d476a45bc08b58d33c877b6930e08897`.
- Baileys reproducibility: #741 causal RED → frozen/successor prerequisite chain → #753 exact-head GREEN → ordinary merge `5e394ae19410f04d42661e12e40ae0b3d04f8969`.
- Typing contact/self authority: #737 causal RED/root fix → exact-head GREEN → ordinary merge `7802e99d759edb7c2210d49bf8a09142da9217c6`.
- Persona compile authority: #739 causal RED/root fix → exact-head GREEN → ordinary merge `3ba8940952b4788746deb18bf4dd683be9f46ecb`.
- AI_AUTO deterministic retry storm: #682 causal RED/root fix → exact-head GREEN → ordinary merge `f01bb27d3460dbb7efcb226c5b0a1316f0c8ffb0`.
- Electron async owner identity + bounded concurrent shutdown: immutable RED `1a42dca5e7a349fec80d581bcd056d44b76d342d`, Stage RED `32555589257`, `unknownBlockers=0`; #628 binds both causal roots, #643 exact head `b44a1670a7f308ff89f8fd8d262993075d2eac89` passes Stage `32568828398`, ACV2 `32568828409`, WP-A `32568828392`, WP-B Validation `32568828407`, WP-B M2 `32568828473`, and Model `32568828379`, then ordinary-merges as `384eb133e8e0871873b271a13bd94f999c6abeb6`. This mechanically advances KF-P0-02 and KF-P1-02 only.
- Facebook durable media authority: frozen tests-only #775 head `6ac2e4683ef3e73cac8e9f219ab6eeb621c8d707`, Stage RED `32794003597` / job `97641436911`, 673 tests / 671 pass / exactly two causal failures, `unknownBlockers=0`; final #777 exact head `2df6bbb586c5f81a9e420571d4a32fe59d5684e7` passes all routed exact-head gates, including Stage `32805044852`, and ordinary-merges as `f8d0a73603e4e4ff3f6207db80bcc9b60c7f15b7`. This mechanically advances KF-P0-25, DELTA-P1-001 and their two recorded coverage gaps at source/gate level only.

Rows not explicitly advanced above were rechecked and remain `OPEN` or `EVIDENCE_RECONCILIATION` where the exact finding-specific causal chain is not mechanically complete. Current source shape, a related merge, or broad historical work-package evidence is not treated as closure.

### 2026-08-25 post-backend-startup mechanical reconciliation checkpoint

- KF-P0-01 now has a complete finding-specific source/gate chain. Frozen tests-only #781 exact head `9148d0638e8daaa4901e2f48252a2f0704ab32e8` produced Stage RED `32808640878` / job `97683665924`: 678 mandatory WP0 tests, 676 pass and exactly two failures — a concurrent contender physically forked before startup admission completed, and a losing pre-claim child exit could mark the winning durable backend owner record exited. All unrelated WP0 tests passed, so `unknownBlockers=0`.
- #782 authorization head `864a50b7fca8d243e101a393b22bfea9ee7ed213` ordinary-merged as `a580a4d772dc2166f73237d8d3b852ef38428021` with strict parents `d7e488336a931893abc44b9311a3e64715ef75c6` + `864a50b7fca8d243e101a393b22bfea9ee7ed213`, authorizing only `electron/desktopHost/BackendOwnerRegistry.js`, `electron/desktopHost/BackendProcessHost.js` plus the inherited immutable RED test.
- #783 exact head `cf271aa5a458729fd8cdcb9b12711b4e0c4e1a7e` preserves the exact immutable RED test blob `eeae851be411baa8aae376a00d7f55116a047c7e`; Stage `32810320965` / job `97688349946` executed the mandatory WP0 suite successfully, and all routed exact-head gates passed before #783 ordinary-merged as `944474ab3e04913e55019526640ee76afe1ada73`. This mechanically advances KF-P0-01 only.
- KF-P0-03 remains `EVIDENCE_RECONCILIATION`: reuse of `proper-lockfile` in the KF-P0-01 root fix does not substitute for KF-P0-03's own historical register-level cross-process-lock failure-first/executed-test chain or packaged multi-instance evidence.

All other previously unresolved V1/A2/Delta/coverage rows remain fail-closed unless their own finding-specific evidence is independently complete. This checkpoint does not authorize or claim a packaged Windows RC.

### 2026-08-25 post-KF-P0-12 mechanical reconciliation checkpoint

- KF-P0-12 now has a complete finding-specific source/gate chain. Frozen tests-only #788 exact head `50e7368b2dd257cc17d14d7030f42abef48cc1ae` produced Stage RED `32816626246` / `wp0-product` job `97706179103`: 680 mandatory WP0 tests, 678 pass and exactly two failures — release preflight accepted a D1 floor instead of exact permission-authority schema v6, and Desktop Worker clients allowed non-`FACEBOOK_*` remote codes to escape. All unrelated WP0 tests and sealed-export checks passed, so `unknownBlockers=0`.
- #789 production authorization ordinary-merged as `c6f335f17d0692a8f3cbf654a32e741cc14bedca`. The successor continuation preserved the frozen RED ancestry, and final #790 exact head `39103fd91aac0f6736f758a579a1c8fbda1673cb` remained inside exactly four authorized paths.
- #790 exact head passed Stage `32818897944` (`wp0-product` job `97712758362`, `Run WP0 required tests` SUCCESS), Layered `32818898132`, ACV2 `32818897926`, WP-A `32818897971`, and Model Windows `32818897945`; Product Final `32818897930` was correctly route-skipped and is not counted as GREEN. #790 then ordinary-merged as `06b1cb20452ec928b0316733bf5d1533cee37f23` with strict parents `c6f335f17d0692a8f3cbf654a32e741cc14bedca` + `39103fd91aac0f6736f758a579a1c8fbda1673cb`.
- This mechanically advances KF-P0-12 to source/gate closed RC pending. It does not advance KF-P0-11: exact-main inspection still shows the default `platformAdapterPorts` singleton wiring auth/reconcile without an explicit Facebook physical egress handler, while the generic authorizer makes the public binding appear present; that separate finding still requires its own fresh causal package.

All other previously unresolved V1/A2/Delta/coverage rows remain fail-closed unless their own finding-specific evidence is independently complete. No final packaged Windows RC exists, so Fresh-main Audit V2, global mandatory executed-test coverage, final Delta audit, packaged RC and release/publish flags remain false.

### 2026-08-25 post-KF-P0-11 mechanical reconciliation checkpoint

- KF-P0-11 now has a complete finding-specific source/gate chain. Frozen tests-only #794 exact head `a60eee882e0b286d94f505de0faf737c90c664f0` produced Stage RED `32822680009` / `wp0-product` job `97724027664`: 682 mandatory WP0 tests, 681 pass and exactly one failure — the default Facebook adapter exposed egress capability through the persisted Outbox authorizer while lacking an explicit physical `egressHandler`. The paired Chatwoot Matrix preserve test and every unrelated WP0 file passed, so `unknownBlockers=0`.
- #795 production authorization ordinary-merged as `929eb2130253b28b1a128d97f95836de060b5b88`. Its successor preserves the frozen RED with ordinary two-parent continuation `5bc9a77cb1276d5f74ca4ce10fcb54183f7b287f` and keeps the final diff to `backend/services/platformAdapterPorts.js` plus the inherited immutable RED test.
- #796 exact head `ca9bd368d66908dfcc521f677cb0b75e6b269b03` passes mandatory Stage `32826900610` (`wp0-product` job `97736872956`, `Run WP0 required tests` SUCCESS), Layered `32826900957`, ACV2 `32826900617`, WP-A `32826900578`, and Model Windows `32826900714`; Product Final `32826900583` is correctly route-skipped and is not counted as GREEN. #796 ordinary-merges as `28f394e8be6d4f8dc9208dafe60373827c5e5f27` with strict parents `929eb2130253b28b1a128d97f95836de060b5b88` + `ca9bd368d66908dfcc521f677cb0b75e6b269b03`.
- The root fix binds the existing canonical `sendMessageService` physical dispatch as the explicit default Facebook `egressHandler` while preserving persisted Outbox authorization, frozen persisted-attempt context, deadlines/delivery evidence and `facebook-page-official` Chatwoot Matrix driver authority. `platformDriverRegistry` is untouched. This mechanically advances KF-P0-11 only.

All other previously unresolved V1/A2/Delta/coverage rows remain fail-closed unless their own finding-specific evidence is independently complete. No final packaged Windows RC exists, so Fresh-main Audit V2, global mandatory executed-test coverage, final Delta audit, packaged RC and release/publish flags remain false.

### 2026-08-25 post-KF-P0-19 mechanical reconciliation checkpoint

- KF-P0-19 now has a complete finding-specific source/gate chain. Frozen tests-only #800 exact head `d8833aad6f3a098ddde1ba231e30782536b70130` preserved test blob `c5e8adb2759ca845e5a44eebc377948bbef4a953` and produced Stage RED `32833803435` / `wp0-product` job `97758162718`: 685 mandatory WP0 tests, 683 pass and exactly two failures — the session-generation fence exposed no in-flight drain boundary, and WhatsApp stop/restart did not await already-started guarded async handlers before old-row retirement / replacement. All unrelated WP0 tests passed, so `unknownBlockers=0`.
- #801 production authorization ordinary-merged as `626d5e206c46d0a9ca8813819751e6b763172ab6`. Successor continuation `3d9e38d57e163a93caf4baac0b6ab52c1ff9e488` has the authorization merge as first parent and frozen RED head as second parent, preserving failure-first evidence without history rewrite.
- #802 final exact head `1c72ee9854b2a9290fc2b834b5688921897c11fc` retains the immutable test blob `c5e8adb2759ca845e5a44eebc377948bbef4a953`; Stage `32845544408` / `wp0-product` job `97794318087` completes mandatory WP0 successfully, Layered `32845544838`, ACV2 `32845544340`, WP-A `32845544513`, and Model Windows `32845544394` pass, while Product Final `32845544301` is correctly route-skipped. Autonomous exact-head review closed the residual drain-timeout row reuse/egress boundary and four Promise-custody escapes, then reached P0=0/P1=0.
- #802 ordinary-merges as `682cdce54d0e9fac919f57fb0354992a1770d48e` with strict parents `626d5e206c46d0a9ca8813819751e6b763172ab6` + `1c72ee9854b2a9290fc2b834b5688921897c11fc`. The root fix extends the existing session-generation fence with bounded in-flight custody/drain, quarantines the retiring WhatsApp row before drain, and prevents replacement generation creation after a failed drain. This mechanically advances KF-P0-19 only.

All other previously unresolved V1/A2/Delta/coverage rows remain fail-closed unless their own finding-specific evidence is independently complete. No final packaged Windows RC exists, so Fresh-main Audit V2, global mandatory executed-test coverage, final Delta audit, packaged RC and release/publish flags remain false.

### 2026-08-25 post-KF-P0-22 mechanical reconciliation checkpoint

- KF-P0-22 now has a complete finding-specific source/gate chain. Frozen tests-only #806 exact head `622692023b2c50ae988398b3822dd7d2e044e3ed` preserved immutable test blob `d3d5994fab8a801fc9f2533fb358fc1c93360dc5` and produced Stage RED `32850513145` / `wp0-product` job `97810153689`: 692 mandatory WP0 tests, 689 pass and exactly three same-root detached-generation-custody failures. All unrelated tests passed, so `unknownBlockers=0`.
- #807 production authorization ordinary-merged as `0fe404bc272b6c33082d0592d42796c9a51956a0`; ordinary continuation `f086baa4f2b3788580f0af221394235dbffba674` preserves the frozen RED ancestry.
- #808 exact head `3fbabb2d57454586f003548941288db69738f891` retains the identical frozen test blob. Stage `32854806433` / `wp0-product` `97824125452` explicitly executes `ok 107 - v21-whatsapp-messages-upsert-detached-custody-kf-p0-22.test`; Layered `32854806883`, ACV2 `32854806280`, WP-A `32854806556`, Model Windows `32854807829` pass; Product Final `32854807457` is correctly route-skipped. Autonomous exact-head review is P0=0/P1=0.
- #808 ordinary-merges as `0a5f0f5fefa7f851eb130927a12e18d3214993db` with strict parents `0fe404bc272b6c33082d0592d42796c9a51956a0` + `3fbabb2d57454586f003548941288db69738f891`. The fix places detached connection/history/messages/presence async continuations under socket-generation drain custody and joins nested identity-avatar work. This mechanically advances KF-P0-22 only.

All other unresolved V1/A2/Delta/coverage rows remain fail-closed. No final fresh-main packaged Windows RC exists; Fresh-main Audit V2, global mandatory executed-test coverage, final Delta audit, RC, release and publish flags remain false.

### 2026-08-26 post-KF-P0-20 mechanical reconciliation checkpoint

- KF-P0-20 now has a complete finding-specific source/gate chain. Frozen tests-only #812 exact head `d03a37347966d9931224e4681a0233efd0696277` preserves immutable test blob `78d5a3f996a22e87227fe7d987a09f69c402ba22` and produced Stage RED `32869936201` / `wp0-product` job `97874553963`: 695 mandatory WP0 tests, 694 pass and exactly one finding-specific durable WhatsApp local-repair custody failure; the dedicated file reports 3 subtests / 2 pass / 1 fail and `unknownBlockers=0`.
- #813 production authorization ordinary-merged as `a19ff971e0dcf3d1ed38a52ab2521639628549ea`. #814 final exact head `fe57672d3e23e339af487017d47f7b2f91be4df5` remains finding-specific and passes mandatory Stage `32871718250` / `wp0-product` `97880159827`, together with all routed exact-head gates; autonomous exact-head review is P0=0/P1=0.
- Mandatory execution is mechanically proven even though the aggregate owner log does not print the KF-P0-20 title: `Run WP0 required tests` executes `npm run test:wp0` → `tools/wp0/run-tests.js`; that runner enumerates every `tests/wp0/*.test.js` in sorted order, executes every file in isolation, and exits nonzero if any isolated file fails. The immutable KF-P0-20 file exists at #814 exact head and the owner step succeeds, therefore that exact file executed and passed.
- #814 ordinary-merges as `e498acafabc3804302e3e1149441e5d81c96f596` with strict parents `a19ff971e0dcf3d1ed38a52ab2521639628549ea` + `fe57672d3e23e339af487017d47f7b2f91be4df5`. This mechanically advances KF-P0-20 only; final fresh packaged WhatsApp local-repair evidence remains mandatory.

Every other unresolved V1/A2/Delta/coverage row remains fail-closed. No final fresh-main packaged Windows RC exists; Fresh-main Audit V2, global mandatory executed-test coverage, final Delta audit, RC, release and publish flags remain false.

### 2026-08-26 post-KF-P0-24 evidence-batch mechanical reconciliation checkpoint

- KF-P0-24 now has a complete finding-specific source/gate chain. Frozen tests-only #818 exact head `74e4c41bcb224bf31df0905ecf5296303414bf90` preserves immutable test blob `9234cb97630bb9683d9dd669ea941530617e0473` and produced Stage `32880426330` / `wp0-product` job `97908412835`: 698 mandatory WP0 tests, 697 pass and exactly one Telegram media repair custody failure; the dedicated file reports 3 subtests / 2 pass / 1 fail and `unknownBlockers=0`.
- #819 production authorization ordinary-merged as `bc56bcc237b30c0853d1bb0a7c9dec909fc5de19`. #820 exact head `d17a0aa89c72f787f3af70fb8911339708a5db69` is the required ordinary two-parent continuation from the authorization merge plus frozen RED head and retains the immutable RED test.
- #820 normalizes Telegram root-level `sourceFile` / `expectedSha256` into the canonical durable local-repair source representation and takes byte custody before durable enqueue returns, preserving the one-provider-send invariant. Its mandatory `wp0-product` job `97913443279` and all routed exact-head gates pass; autonomous exact-head review is P0=0/P1=0.
- #820 ordinary-merges as `b53745a3c52429464e1f7498b70d4548594563ac` with strict parents `bc56bcc237b30c0853d1bb0a7c9dec909fc5de19` + `d17a0aa89c72f787f3af70fb8911339708a5db69`. This mechanically advances KF-P0-24 only; final fresh packaged Telegram restart/local-repair custody evidence remains mandatory.
- The remaining evidence-only rows are not upgraded by source shape or broad historical packages. Store truth #544/#545/#547 has final exact-head GREEN evidence but no mechanically recovered finding-specific historical RED for KF-P0-04/17/18. Historical M2 #17 corroborates Durable Execution but does not individually close KF-P0-26/27/28. #682 exactly closes A2-P1-001's deterministic AI_AUTO retry-storm subset, but broad KF-P1-07 still includes unmapped general/deep-latency semantics. KF-P0-03, KF-P1-01, KF-P0-23, KF-P1-06 and KF-P0-29/30/31 likewise remain fail-closed on their own exact lineage or packaged obligations.

No fresh source scan found another executable production root in this evidence batch. This is not permission to fabricate historical RED evidence. Fresh-main Audit V2, global mandatory executed-test coverage, final Delta audit, packaged RC, release and publish flags remain false.

## 2. Known Findings V1 — 31 P0 rows

| ID | Bucket | Finding | Current state | Evidence / next closure action |
|---|---|---|---|---|
| KF-P0-01 | Frontend / Electron | 后端启动竞态可能导致多后端子进程或重启循环 | SOURCE_GATE_CLOSED_RC_PENDING | Frozen tests-only #781 exact head `9148d0638e8daaa4901e2f48252a2f0704ab32e8` produced Stage RED `32808640878` / job `97683665924`: 678 mandatory WP0 tests, 676 pass, exactly the pre-fork contender and loser-exit owner-clobber failures, `unknownBlockers=0`. #782 authorization head `864a50b7fca8d243e101a393b22bfea9ee7ed213` ordinary-merged as `a580a4d772dc2166f73237d8d3b852ef38428021`, authorizing only the two production root paths plus the inherited immutable RED test. #783 exact head `cf271aa5a458729fd8cdcb9b12711b4e0c4e1a7e` retains that RED test at identical blob `eeae851be411baa8aae376a00d7f55116a047c7e`; Stage `32810320965` / job `97688349946` executes the mandatory WP0 suite successfully and all routed exact-head gates pass, then #783 ordinary-merges as `944474ab3e04913e55019526640ee76afe1ada73`. Final fresh packaged start/restart/stop and multi-instance evidence remains mandatory. |
| KF-P0-02 | Frontend / Electron | BackendOwnerRegistry 同步 PowerShell / `Atomics.wait` 阻塞 Electron 主线程 | SOURCE_GATE_CLOSED_RC_PENDING | Immutable failure-first RED `1a42dca5…`, Stage `32555589257`, `unknownBlockers=0`, directly requires removal of production `execFileSync` / `Atomics.wait` owner-identity blocking while preserving proper-lockfile custody. #628 binds the causal root; #643 exact head `b44a1670…` passes Stage `32568828398`, ACV2 `32568828409`, WP-A `32568828392`, WP-B Validation `32568828407`, WP-B M2 `32568828473`, and Model `32568828379`, and ordinary-merges as `384eb133…`. Final packaged responsiveness evidence remains mandatory. |
| KF-P0-03 | Frontend / Electron | BackendOwnerRegistry 缺乏跨进程独占锁 | EVIDENCE_RECONCILIATION | #546/#643 contain related cross-process owner-lock and lifecycle work, but this row still lacks a mechanically bound finding-specific failure-first → mandatory exact-head execution chain plus final packaged multi-instance evidence. The KF-P0-01 #781→#783 startup-admission closure reuses `proper-lockfile` but does not independently close this historical register-level lock finding. |
| KF-P0-04 | Frontend / Electron | StoreClient / ActiveContactStore / ConversationCenterV3 多份活跃会话与自动化模式真相源 | EVIDENCE_RECONCILIATION | #544/#545/#547 and #615 are relevant merged source evidence, but the exact historical finding still lacks one finding-specific failure-first → mandatory executed-test mapping across all named authority surfaces. Do not infer closure from current source shape. |
| KF-P0-05 | Dependency security / reproducibility | `electron@39.8.5` 高严重代码签名伪造风险 | SOURCE_GATE_CLOSED_RC_PENDING | #720 established the supported-runtime causal RED; Stage `32662426611` reported 648 / 642 pass / 6 expected Electron identity failures with `unknownBlockers=0`. Final successor #733 head `91a14bed…` migrated active authority to Electron 43.4.1 and passed Stage `32686449711`, Layered `32686449844`, ACV2 `32686449706`, WP-B `32686449698`, WP-A `32686449830`, Model `32686449749`, Product Final `32686449712`; merged as `9e510b66…`. Fresh final RC identity/UAT still required. |
| KF-P0-06 | Dependency security / reproducibility | `@letta-ai/letta-agent-sdk` / `letta-code` 高严重依赖告警 | SOURCE_GATE_CLOSED_RC_PENDING | #759 closed the independent Letta sharp-lock prerequisite. #769 fresh RED head `2abc1fe3…`, Stage `32782570846`, isolated sharp/ip-address/js-yaml High-advisory failures with `unknownBlockers=0`; production head `95c60e64…` passed Stage `32784038864`, Layered `32784039105`, ACV2 `32784039019`, WP-B `32784038850`, WP-A `32784038834`, Model `32784038868` and merged as `2faa2a92…`. Final packaged dependency/runtime identity remains required. |
| KF-P0-07 | Dependency security / reproducibility | Baileys postinstall 源码 patch 破坏可复现与可审计性 | SOURCE_GATE_CLOSED_RC_PENDING | #741 first tests-only head `04dd8ca9…` produced Stage RED `32695056263` for the active rc13/postinstall mutation authority. After narrow trusted-seed/receipt prerequisites, #753 exact head `bbfb4943…` passed Stage `32722313094`, Layered `32722313281`, ACV2 `32722313170`, WP-B `32722313109`, WP-A `32722313220`, Model `32722313090` and merged as `5e394ae1…`; immutable upstream rc14 runtime authority replaces the postinstall patch path. Final packaged WhatsApp runtime evidence remains required. |
| KF-P0-08 | SecurityGuard | 调用方可伪造 actor 通过 `requireInternal` | SOURCE_GATE_CLOSED_RC_PENDING | #541 merged as `2b8e648f…`; source exact head `f5c09b10…`; Stage `32379500018`, ACV2 `32379500208`, WP-A `32379500226`, Model `32379500114` GREEN. Final packaged security regression still required. |
| KF-P0-09 | SecurityGuard | Safe Mode 对 `recovery.*` 使用宽前缀白名单 | SOURCE_GATE_CLOSED_RC_PENDING | #541 replaces prefix matching with exact command set; same exact-head GREEN evidence as KF-P0-08. Final packaged safe-mode write-path evidence required. |
| KF-P0-10 | SecurityGuard | `context.write=true` 可篡改 command-owned 写分类 | SOURCE_GATE_CLOSED_RC_PENDING | #543 merged as `9a2a696a…`; source head `ced882e1…`; Stage `32385443466`, ACV2 `32385443458`, WP-A `32385443619`, Model `32385443480` GREEN. Final packaged regression required. |
| KF-P0-11 | Adapter Ports / Facebook Worker | `platformAdapterPorts` 默认 registry 未显式闭合 Facebook egress handler | SOURCE_GATE_CLOSED_RC_PENDING | Frozen #794 exact head `a60eee882e0b286d94f505de0faf737c90c664f0`, Stage `32822680009` / job `97724027664`, ran 682 mandatory WP0 tests with 681 pass and exactly the missing explicit default Facebook physical-egress handler failure; paired Chatwoot Matrix preservation and all unrelated tests passed, `unknownBlockers=0`. #795 ordinary-merged production authorization as `929eb213…`. #796 exact head `ca9bd368…` explicitly binds the existing canonical `sendMessageService` physical dispatch as the default Facebook `egressHandler` without mutating `platformDriverRegistry`; Stage `32826900610` / job `97736872956`, Layered `32826900957`, ACV2 `32826900617`, WP-A `32826900578`, Model `32826900714` all pass, Product Final is correctly skipped, and #796 ordinary-merges as `28f394e8…`. Final packaged Facebook egress evidence remains mandatory. |
| KF-P0-12 | Adapter Ports / Facebook Worker | Desktop 与 Worker oauth/avatar/D1 契约版本及 `FACEBOOK_*` 错误码未强制对齐 | SOURCE_GATE_CLOSED_RC_PENDING | Frozen tests-only #788 exact head `50e7368b2dd257cc17d14d7030f42abef48cc1ae`, Stage `32816626246` / job `97706179103`, ran 680 mandatory WP0 tests with 678 pass and exactly the D1 exact-contract plus Worker error-family failures; `unknownBlockers=0`. #789 ordinary-merged production authority as `c6f335f1…`. Final #790 head `39103fd9…` requires exact D1 v6 / `0006_permission_authority.sql` / permission-authority columns and normalizes remote Worker codes fail-closed to the `FACEBOOK_*` family; Stage `32818897944` / job `97712758362`, Layered `32818898132`, ACV2 `32818897926`, WP-A `32818897971`, Model `32818897945` all pass, Product Final is correctly skipped, and #790 ordinary-merges as `06b1cb20…`. Final packaged Facebook contract/UAT evidence remains mandatory. |
| KF-P0-13 | Adapter Ports / Facebook Worker | `pullEvents` 一次性 lease 无续约导致长事件处理重复投递/状态延迟 | SOURCE_GATE_CLOSED_RC_PENDING | #639 merged as `347097a6…`; frozen RED `b4bab02a…`, Stage RED `32564194421`, `unknownBlockers=0`; source head `eedb4e09…` exact Stage/Layered/ACV2/WP-A/Model GREEN. Root fix adds bounded event lease renewal. Final packaged evidence pending. |
| KF-P0-14 | Identity / Person Context | Identity detach 后 `person_contact_bindings` 未同步失效 | SOURCE_GATE_CLOSED_RC_PENDING | #542 merged as `f978a4dc…`; source head `0173cba4…` adds last-usable-link contact binding detach and audited rollback. Packaged identity flow pending. |
| KF-P0-15 | Identity / Person Context | 再次 `observe` 可静默重新激活已 detached scope binding | SOURCE_GATE_CLOSED_RC_PENDING | #542 explicitly rejects detached-link silent re-observe and adds regression coverage. Final packaged flow pending. |
| KF-P0-16 | Identity / Person Context | `PersonContextAuthority` 读端不校验 identity_link detached/disputed 状态 | SOURCE_GATE_CLOSED_RC_PENDING | #542 requires usable identity-link status and exact conversation-binding match before context reads. Final packaged flow pending. |
| KF-P0-17 | Store truth source | Backend `customers.currentId` 与前端 active contact 双轨无显式同步 | EVIDENCE_RECONCILIATION | #544/#545/#547 establish canonical exact-session renderer selection and an ephemeral Store mirror with command-owned writers, but no finding-specific failure-first chain is mechanically bound to this historical row. Wrong-target packaged egress proof remains required. |
| KF-P0-18 | Store truth source | `SYNC_CUSTOMER_CONTEXT` 对 `conversations.byContactId` 只 push 不去重 | EVIDENCE_RECONCILIATION | Fresh source inspection proves the literal duplicate-push shape is absent and #547 preserves dedupe behavior, but the finding-specific failure-first commit, mandatory executed test and exact-head GREEN chain remain unbound. |
| KF-P0-19 | WhatsApp | `stop()` 后旧 socket 事件仍可能进入 handler，代际隔离不完整 | SOURCE_GATE_CLOSED_RC_PENDING | Frozen #800 exact head `d8833aad6f3a098ddde1ba231e30782536b70130` and immutable blob `c5e8adb2759ca845e5a44eebc377948bbef4a953` produced Stage `32833803435` / job `97758162718`, 685 mandatory WP0 tests / 683 pass / exactly two custody failures, `unknownBlockers=0`. #801 ordinary-merged production authorization as `626d5e20…`; continuation `3d9e38d5…` preserves the frozen RED. #802 exact head `1c72ee98…` keeps the same RED blob and passes Stage `32845544408` / job `97794318087`, Layered `32845544838`, ACV2 `32845544340`, WP-A `32845544513`, Model `32845544394`; Product Final is correctly skipped. Autonomous exact-head review is P0=0/P1=0, and #802 ordinary-merges as `682cdce5…`. Final packaged WhatsApp stop/restart/credential-persistence evidence remains mandatory. |
| KF-P0-20 | WhatsApp | 平台接受后本地持久化失败仅返回 `localPersistenceRepair`，修复消费链未闭环 | SOURCE_GATE_CLOSED_RC_PENDING | Frozen #812 head `d03a37347966d9931224e4681a0233efd0696277`, immutable blob `78d5a3f996a22e87227fe7d987a09f69c402ba22`, Stage `32869936201` / job `97874553963`: 695 mandatory WP0 / 694 pass / exactly one finding-specific failure, dedicated file 3 subtests / 2 pass / 1 fail, `unknownBlockers=0`. #813 production authorization ordinary-merges as `a19ff971…`. #814 exact head `fe57672d…` retains the immutable finding-specific contract and passes mandatory Stage `32871718250` / `wp0-product` `97880159827`; `Run WP0 required tests` executes `npm run test:wp0` → `tools/wp0/run-tests.js`, whose exhaustive isolated enumeration makes the successful owner step exact execution/PASS proof. Autonomous exact-head review is P0=0/P1=0, and #814 ordinary-merges as `e498acaf…`. Final fresh packaged WhatsApp local-repair evidence remains mandatory. |
| KF-P0-21 | WhatsApp | 物理 egress 错误码/HTTP status 不统一 | SOURCE_GATE_CLOSED_RC_PENDING | #647 immutable RED `c6cd39ca…`, Stage RED `32570813989`, `unknownBlockers=0`; #649 source head `f10a2785…` merged as `c6e1e7d8…`, structures disconnected/local/provider egress errors. Final packaged egress evidence pending. |
| KF-P0-22 | WhatsApp | `messages.upsert` 长 await 边界前后 socket generation/fence 校验不足 | SOURCE_GATE_CLOSED_RC_PENDING | Frozen #806 head `62269202…`, immutable blob `d3d5994f…`, Stage `32850513145` / job `97810153689`: 692 mandatory WP0 / 689 pass / exactly three finding-specific failures, `unknownBlockers=0`. #807 authorization ordinary-merged as `0fe404bc…`; continuation `f086baa4…` preserves RED. #808 exact head `3fbabb2d…` retains the same blob; Stage `32854806433` / job `97824125452` explicitly reports `ok 107 - v21-whatsapp-messages-upsert-detached-custody-kf-p0-22.test`; Layered/ACV2/WP-A/Model pass, Product Final correctly skips, autonomous review P0=0/P1=0, then ordinary merge `0a5f0f5f…`. Final packaged WhatsApp generation-custody evidence remains mandatory. |
| KF-P0-23 | Telegram / Facebook | 跨平台 egress 公共接口签名/能力不统一 | EVIDENCE_RECONCILIATION | #653 proves a Telegram provider-error subset and later Facebook/adapter work exists, but the broad cross-platform public-interface finding still lacks one exact failure-first/executed contract. |
| KF-P0-24 | Telegram / Facebook | `localPersistencePending` / `localPersistenceRepair` 有契约但无自动幂等修复闭环 | SOURCE_GATE_CLOSED_RC_PENDING | Frozen #818 head `74e4c41bcb224bf31df0905ecf5296303414bf90`, immutable blob `9234cb97630bb9683d9dd669ea941530617e0473`, Stage `32880426330` / job `97908412835`: 698 mandatory WP0 / 697 pass / exactly one finding-specific Telegram media repair failure, dedicated file 3/2/1, `unknownBlockers=0`. #819 production authorization ordinary-merges as `bc56bcc2…`; #820 exact head `d17a0aa8…` preserves the frozen contract and normalizes/custodies Telegram media before durable enqueue. Mandatory `wp0-product` `97913443279` and all routed exact-head gates pass, autonomous review P0=0/P1=0, and #820 ordinary-merges as `b53745a3…`. Final fresh packaged Telegram restart/local-repair evidence remains mandatory. |
| KF-P0-25 | Telegram / Facebook | Facebook `worker_media` 缺失时缺少传统媒体 URL fallback | SOURCE_GATE_CLOSED_RC_PENDING | Historical wording is retained as the immutable 8/20 finding, but the supported closure intentionally does **not** restore direct desktop Meta-CDN URL fetching. #775 exact tests-only head `6ac2e468…` produced Stage RED `32794003597` with exactly the missing delegated durable `MEDIA_TRANSFER` consumer and missing physical `media-transfer` dispatch, `unknownBlockers=0`. #777 exact head `2df6bbb5…` closes those roots, keeps URL-only legacy media fail-closed/unavailable, materializes only Worker-custodied pending/remote media through persisted-attempt signed Worker/R2 authority, passes mandatory Stage `32805044852` and all routed exact-head gates, then ordinary-merges as `f8d0a736…`. Final packaged Facebook media evidence remains required. |
| KF-P0-26 | Durable Execution | M2 heartbeat/succeed/fail/waitRemote/cancel/retry/deadLetter 等关键操作未实现 | EVIDENCE_RECONCILIATION | Historical #17 records a broad credible M2 RED and later exact dual-platform seals, but this historical row still requires per-operation finding-specific ordinary-merged lineage rather than treating the whole 190-path work package as one finding closure. |
| KF-P0-27 | Durable Execution | `appendV2Event MAX(sequence)+1` 再 INSERT 存在并发 sequence 完整性风险 | EVIDENCE_RECONCILIATION | Current transaction/fencing infrastructure is stronger than the audit baseline, but no exact finding-specific concurrency sequence RED/root-fix/gate chain has yet been bound. |
| KF-P0-28 | Durable Execution | 长任务无 heartbeat 导致 lease 过期后终态操作被拒 | EVIDENCE_RECONCILIATION | Trusted main has canonical heartbeat lease extension and retry lifecycle coverage, but the exact long-running production-operation finding-to-causal-RED lineage remains to be mechanically bound. |
| KF-P0-29 | AI Core | `aiGateway.submit` 在 `authority.start` 前失败可能让 durable operation 滞留 SCHEDULED | EVIDENCE_RECONCILIATION | Current `aiGateway.submit` persists before queue admission and terminalizes a still-SCHEDULED operation on queue failure by start+cancel, but this row still lacks an exact finding-specific failure-first and executed regression chain. |
| KF-P0-30 | AI Core | `aiBrainOrchestrator` cancel 与 succeed 存在终态竞态，缺 generation/fencing 一致性 | EVIDENCE_RECONCILIATION | Current canonical analysis terminal paths carry generation + object fingerprint and use Schema-23 fencing, but the exact cancel-vs-succeed race finding still needs a dedicated mechanically bound RED/executed contract. |
| KF-P0-31 | AI Core | `contextAwareReplyBrain` / `aiGateway` / turn coordinator stale/superseded 语义不对齐 | EVIDENCE_RECONCILIATION | Current AI_AUTO and translation contracts include stale/superseded rejection, including restart-safe stale-result prevention, but all three named layers still need one exact finding-specific chain before this row advances. |

### P0 accounting

- imported P0 rows: **31**
- `SOURCE_GATE_CLOSED_RC_PENDING`: **20**
- finally `CLOSED`: **0**
- unresolved for final release: **31**

This count is intentionally strict: `SOURCE_GATE_CLOSED_RC_PENDING` is still unresolved until the fresh final RC closes the packaged evidence layer.

## 3. Known Findings V1 — 8 explicit P1 rows

| ID | Bucket | Finding | Current state | Evidence / next closure action |
|---|---|---|---|---|
| KF-P1-01 | Frontend / Electron | Safe Mode 主要停留在 UI banner，需证明后端所有写入口真实 fail-closed | EVIDENCE_RECONCILIATION | #541/#543 strengthen backend SecurityGuard, but the all-write-entrypoint packaged audit remains incomplete. |
| KF-P1-02 | Frontend / Electron | `stopApplicationOwnedRuntimes` 串行等待，单 runtime hang 可阻塞整体退出 | SOURCE_GATE_CLOSED_RC_PENDING | The same immutable lifecycle RED `1a42dca5…`, Stage `32555589257`, `unknownBlockers=0`, directly requires removal of serial application-owned runtime stop barriers. #628 binds concurrent Presence/Letta/Parlant/Graphiti/backend stop initiation with independent deadlines and `Promise.allSettled`; #643 exact head `b44a1670…` passes the final gate set and ordinary-merges as `384eb133…`. Final packaged shutdown/hang evidence remains mandatory. |
| KF-P1-03 | Dependency security / reproducibility | `@letta-ai/letta-code` 依赖 `sharp <0.35.0` 的漏洞链 | SOURCE_GATE_CLOSED_RC_PENDING | #759 reconciled the Letta sharp-lock prerequisite; #769 RED Stage `32782570846` directly required scoped/root sharp 0.35.3 and no unsafe nested sharp, with `unknownBlockers=0`. #769 production head `95c60e64…` passed the exact-head gate set listed under KF-P0-06 and merged as `2faa2a92…`. Fresh packaged runtime identity remains required. |
| KF-P1-04 | Adapter Ports / Facebook Worker | WP-B execution/fencing identity 暴露在 Worker URL query | SOURCE_GATE_CLOSED_RC_PENDING | #639 removes persisted WP-B identity from URL query and moves it to signed `x-yance-wpb-*` metadata; source head `eedb4e09…` exact gates GREEN. Final packaged/log-leak evidence pending. |
| KF-P1-05 | Store truth source | `UPDATE_SELF_TYPING_STATE` 顶层 conversation/account/platform 字段可能覆盖 contact 侧最新会话 | SOURCE_GATE_CLOSED_RC_PENDING | #737 first tests-only head `58fcc598…` produced Stage RED `32690111693` for the two KF-P1-05 collisions. Production head `a20285f0…` passed Stage `32690592676`, Layered `32690592902`, ACV2 `32690592696`, WP-A `32690592688`, Model `32690592737` and merged as `7802e99d…`. Final packaged typing/targeting regression remains required. |
| KF-P1-06 | Telegram / Facebook | Facebook 本地适配器退化为 Worker/Durable Authority 投影，闭环能力弱于 Telegram | EVIDENCE_RECONCILIATION | #777 intentionally strengthens the Worker/Durable projection and retires duplicate direct-CDN authority; that does not by itself establish the broad historical capability-intent finding. A finding-specific supported-capability contract is still required. |
| KF-P1-07 | AI Core | reply generation 链过长，任一环失败导致整体失败与 deep latency 风险 | EVIDENCE_RECONCILIATION | #682 exact RED `2b0e2a19ceb7e90f18b692428da8665420f5e168`, Stage `32613800942`, final head `3231ba426c8e3976afd302cb2e2eaa160c957c1a`, Stage `32613979019` and ordinary merge `f01bb27d3460dbb7efcb226c5b0a1316f0c8ffb0` mechanically close the deterministic AI_AUTO retry-storm subset. The broader historical row also covers general failure-family and deep-latency/bounded-behavior semantics, so it remains fail-closed until those semantics are finding-specifically mapped. |
| KF-P1-08 | AI Core | `personaBrain` 多个 `compile*` 入口并存，调用方可能混用语义 | SOURCE_GATE_CLOSED_RC_PENDING | #739 first tests-only head `e480e555…` produced Stage RED `32691739045` for facade/route/reply-brain compile authority split. Production head `561d931a…` passed Stage `32692383958`, Layered `32692384194`, ACV2 `32692383967`, WP-A `32692383978`, Model `32692383893` and merged as `3ba89409…`. Final packaged Persona/reply path evidence remains required. |

### P1 accounting

- imported explicit P1 rows: **8**
- `SOURCE_GATE_CLOSED_RC_PENDING`: **5**
- finally `CLOSED`: **0**
- unresolved for final release: **8**

## 4. Fresh-main Release Audit V2 findings

These rows are independent of Known Findings V1. Do not renumber or rewrite the 8/20 baseline when new findings appear.

| ID | Severity | Finding | State | Evidence / next action |
|---|---|---|---|---|
| A2-P1-001 | P1 | AI_AUTO deterministic reply-generation failures historically re-entered the 20-attempt durable analysis retry loop (issue #533) | SOURCE_GATE_CLOSED_RC_PENDING | After the WP0 coverage prerequisite, #682 V4 first head `2b0e2a19…` produced fresh Stage RED `32613800942` for the remaining `SOCIAL_CONTEXT_NOT_READY`, `STALE_CONVERSATION_CONTEXT`, `STALE_PERSONA_PROFILE` classification gap with `unknownBlockers=0`. Final head `3231ba42…` passed Stage `32613979019`, ACV2 `32613978971`, WP-A `32613978900`, Model `32613978924` and merged as `f01bb27d…`; these deterministic generation errors now terminate the canonical analysis non-retryably. Fresh final RC remains required. |

No new A2-P0/A2-P1 row is added by the `760c45a9… → f8d0a736…` source segment: it consists of the Lane C ledger checkpoint and the already-accounted Facebook causal closure. The subsequent #781→#783 backend startup-admission closure is reconciled into KF-P0-01 rather than duplicated as a new A2 row. The #788→#790 contract-alignment closure is reconciled into KF-P0-12 rather than duplicated as a new A2 row. The #794→#796 default-Facebook-egress closure is reconciled into KF-P0-11 rather than duplicated as a new A2 row. The #800→#802 stale-socket in-flight-custody closure is reconciled into KF-P0-19 rather than duplicated as a new A2 row. The #806→#808 detached generation-custody closure is reconciled into KF-P0-22 rather than duplicated as a new A2 row. The #812→#814 durable WhatsApp local-repair closure is reconciled into KF-P0-20 rather than duplicated as a new A2 row. The #818→#820 Telegram media local-repair closure is reconciled into KF-P0-24 rather than duplicated as a new A2 row. The Fresh-main Audit V2 checkpoint below completes the exact-main audit without promoting any unresolved historical evidence row.

### 4.1 Post-KF-P0-12 exact-main surface accounting — `06b1cb20452ec928b0316733bf5d1533cee37f23`

| Audit surface | Exact-main inspection result | Ledger disposition |
|---|---|---|
| Renderer/UI authority and reachable controls | Product system/settings and active-selection work are present; #544/#545/#547 provide strong exact-session/single-writer source evidence, but KF-P0-04/KF-P0-17 still lack finding-specific failure-first mappings. | No duplicate A2 row; existing Known Finding rows remain blockers. |
| Electron/backend ownership, startup, shutdown and process identity | The #620→#628→#643 causal chain mechanically closes the synchronous owner-identity and serial-shutdown source defects. The later #781→#783 causal chain independently closes the KF-P0-01 startup-admission race at source/gate level with the same immutable RED test executing GREEN; the historical register-level cross-process-lock row remains unmapped. | KF-P0-01, KF-P0-02 and KF-P1-02 are source-gate closed RC pending; KF-P0-03 remains evidence reconciliation; packaged start/restart/stop and multi-instance evidence remains pending. |
| Credential/security boundaries | SecurityGuard exact-command/internal/write-classification source closures are merged, while all-write-entrypoint packaged proof remains outstanding. | KF-P0-08..10 retain source-gate-closed-RC-pending; KF-P1-01 remains evidence reconciliation. |
| Store/identity/conversation truth | `SYNC_CUSTOMER_CONTEXT` dedupe and active-session single-writer source shapes are present, but no new finding-specific causal RED was reconstructed for KF-P0-04/17/18. | Keep KF-P0-04/17/18 fail-closed at evidence reconciliation; do not infer closure from source shape. |
| Physical adapters and durable repair | #775/#777 closes supported Facebook media through persisted durable `MEDIA_TRANSFER` + signed Worker/R2 custody. #788/#790 now closes exact D1 permission-authority preflight and Desktop Worker `FACEBOOK_*` error-family alignment. Exact-main inspection separately confirms the KF-P0-11 default-registry physical-egress wiring gap remains a live candidate root. | KF-P0-12 and KF-P0-25 are source-gate closed RC pending; DELTA-P1-001 remains source-gate closed RC pending; KF-P0-11/20/23/24 and KF-P1-06 remain unresolved on their own evidence requirements. |
| Durable Execution | Schema-23 operations, heartbeat and retry/fencing paths exist and historical #17 contains broad M2 evidence, but per-finding ordinary-merged causal lineage was not reconstructed for the three historical rows. | KF-P0-26..28 remain `EVIDENCE_RECONCILIATION`. |
| AI Core cancellation/stale/retry/authority/persistence | AI_AUTO retry-storm subset is mechanically closed at source/gate level; broader scheduled/cancel-vs-succeed/stale-layer/deep-latency rows remain unmapped. | A2-P1-001 remains source-gate closed RC pending; KF-P0-29..31 and KF-P1-07 remain unresolved. |
| Dependency / supply chain | Electron 43.4.1, Baileys rc14, Letta sharp reconciliation and High-advisory closure remain on exact main; the post-backend-startup/KF-P0-12 segment introduces no dependency, lockfile or runtime-downloader change. | KF-P0-05..07 / KF-P1-03 retain source-gate-closed-RC-pending; no new Delta dependency P0/P1. |
| Release packaging / sealed runtime / real Windows launch | No new final fresh-main packaged Windows RC exists after #790. | UAT-001/UAT-002 remain blocking; `freshPackagedWindowsRcPass=false`. |

### 4.2 Post-KF-P0-11 exact-main surface accounting — `28f394e8be6d4f8dc9208dafe60373827c5e5f27`

| Audit surface | Exact-main inspection result | Ledger disposition |
|---|---|---|
| Renderer/UI authority and reachable controls | No Product/UI authority path changed in the `06b1cb20… → 28f394e8…` segment; historical Store/session evidence gaps remain unchanged. | KF-P0-04/17/18 remain evidence reconciliation; no duplicate A2 row. |
| Electron/backend ownership, startup, shutdown and process identity | No Electron/backend lifecycle source path changed in this segment; prior source-gate closures and historical register-level evidence gap remain unchanged. | KF-P0-01/02 and KF-P1-02 remain source-gate closed RC pending; KF-P0-03 remains evidence reconciliation. |
| Credential/security boundaries | No SecurityGuard or credential authority path changed in this segment. | Existing KF-P0-08..10 / KF-P1-01 dispositions remain unchanged. |
| Store/identity/conversation truth | No Store/identity authority path changed in this segment. | KF-P0-04/17/18 remain fail-closed at evidence reconciliation. |
| Physical adapters and durable repair | #794→#796 now mechanically closes the default Facebook physical-egress ownership split by explicitly binding the existing `sendMessageService` dispatch into the default Facebook adapter while preserving Chatwoot Matrix and persisted-attempt authority. KF-P0-12 and durable media closures remain intact. | KF-P0-11, KF-P0-12 and KF-P0-25 are source-gate closed RC pending; KF-P0-20/23/24 and KF-P1-06 remain unresolved on their own evidence requirements. |
| Durable Execution | No Durable Execution source path changed in this segment. | KF-P0-26..28 remain `EVIDENCE_RECONCILIATION`. |
| AI Core cancellation/stale/retry/authority/persistence | No AI Core source path changed in this segment. | A2-P1-001 remains source-gate closed RC pending; KF-P0-29..31 and KF-P1-07 remain unresolved. |
| Dependency / supply chain | No dependency, package-lock or runtime-downloader path changed in this segment. | KF-P0-05..07 / KF-P1-03 retain source-gate-closed-RC-pending; no new Delta dependency P0/P1. |
| Release packaging / sealed runtime / real Windows launch | No new final fresh-main packaged Windows RC exists after #796. | UAT-001/UAT-002 remain blocking; `freshPackagedWindowsRcPass=false`. |

### 4.3 Post-KF-P0-19 exact-main surface accounting — `682cdce54d0e9fac919f57fb0354992a1770d48e`

Mechanical compare `29ce90a772be28cbddc925459721045b086f8104` → `682cdce54d0e9fac919f57fb0354992a1770d48e` is `status=ahead`, `ahead_by=13`, `behind_by=0`, and changes exactly five KF-P0-19 paths: two governance authorizations, `backend/services/sessionGenerationFence.js`, `backend/services/whatsappAdapter.js`, and the immutable finding-specific WP0 test.

| Audit surface | Exact-main inspection result | Ledger disposition |
|---|---|---|
| Renderer/UI authority and reachable controls | No Product/UI authority path changed in the 13-commit segment. | KF-P0-04/17/18 remain evidence reconciliation; no duplicate A2 row. |
| Electron/backend ownership, startup, shutdown and process identity | No Electron/backend lifecycle path changed in this segment. | KF-P0-01/02 and KF-P1-02 remain source-gate closed RC pending; KF-P0-03 remains evidence reconciliation. |
| Credential/security boundaries | No SecurityGuard or credential-boundary path changed. | Existing KF-P0-08..10 / KF-P1-01 dispositions remain unchanged. |
| Store/identity/conversation truth | No Store/identity authority path changed. | KF-P0-04/17/18 remain fail-closed at evidence reconciliation. |
| Physical adapters and durable repair | The segment closes only WhatsApp stale-socket in-flight generation custody. It does not claim WhatsApp local-repair, long-await `messages.upsert`, cross-platform egress or repair-consumer rows. | KF-P0-19 is source-gate closed RC pending; KF-P0-20/22/23/24 and KF-P1-06 remain unresolved independently. |
| Durable Execution | No Durable Execution source path changed. | KF-P0-26..28 remain `EVIDENCE_RECONCILIATION`. |
| AI Core cancellation/stale/retry/authority/persistence | No AI Core source path changed. | A2-P1-001 remains source-gate closed RC pending; KF-P0-29..31 and KF-P1-07 remain unresolved. |
| Dependency / supply chain | No dependency, package-lock or runtime-downloader path changed. | KF-P0-05..07 / KF-P1-03 retain source-gate-closed-RC-pending; no new Delta dependency P0/P1. |
| Release packaging / sealed runtime / real Windows launch | No final fresh-main packaged Windows RC exists after #802. | UAT-001/UAT-002 remain blocking; `freshPackagedWindowsRcPass=false`. |

This is an exact-main **surface scan checkpoint**, not release completion. Existing V1/A2 blockers are not duplicated merely to make the Audit V2 list longer. `freshMainAuditV2Complete=false` remains fail-closed while unresolved source/evidence P0/P1 rows remain.

### 4.4 Post-KF-P0-22 exact-main surface accounting — `0a5f0f5fefa7f851eb130927a12e18d3214993db`

Mechanical compare `4d8c7c33af673edd20ff170e47a71632cecbfcb5` → `0a5f0f5fefa7f851eb130927a12e18d3214993db` is `status=ahead`, `ahead_by=9`, `behind_by=0`, changing exactly the two KF-P0-22 governance authorizations, `backend/services/whatsappAdapter.js`, and the immutable KF-P0-22 WP0 test. No dependency, lockfile, workflow, routing, release-binary, Electron/backend lifecycle, Durable Execution, AI or unrelated Product surface changed.

This segment closes only KF-P0-22. KF-P0-20/23/24, KF-P1-06, Durable Execution, AI and Store evidence rows remain independently fail-closed. No new A2-P0/A2-P1 row is discovered and no fresh packaged Windows RC exists.

### 4.5 Post-KF-P0-20 exact-main surface accounting — `e498acafabc3804302e3e1149441e5d81c96f596`

Mechanical compare `18db4b0442fb8aeee6b42161aba5337049e8efd6` → `e498acafabc3804302e3e1149441e5d81c96f596` is `status=ahead`, `ahead_by=9`, `behind_by=0`, changing exactly four KF-P0-20 paths: `backend/services/durableOperations/outboundMessageSendOperation.js`, the two KF-P0-20 governance authorizations, and `tests/wp0/v21-whatsapp-local-persistence-repair-kf-p0-20.test.js`. No dependency, package-lock, workflow, routing-policy, release-binary, Electron/backend lifecycle, AI, or unrelated Product surface changed.

| Audit surface | Exact-main inspection result | Ledger disposition |
|---|---|---|
| Renderer/UI authority and reachable controls | No Product/UI authority path changed in the 9-commit segment. | KF-P0-04/17/18 remain evidence reconciliation; no duplicate A2 row. |
| Electron/backend ownership, startup, shutdown and process identity | No Electron/backend lifecycle path changed in this segment. | KF-P0-01/02 and KF-P1-02 remain source-gate closed RC pending; KF-P0-03 remains evidence reconciliation. |
| Credential/security boundaries | No SecurityGuard or credential-boundary path changed. | Existing KF-P0-08..10 / KF-P1-01 dispositions remain unchanged. |
| Store/identity/conversation truth | No Store/identity authority path changed. | KF-P0-04/17/18 remain fail-closed at evidence reconciliation. |
| Physical adapters and durable repair | #812→#814 mechanically closes only WhatsApp durable local-repair custody at source/gate level, including restart/idempotent repair consumption under the canonical outbound durable operation. | KF-P0-20 is source-gate closed RC pending; KF-P0-23/24 and KF-P1-06 remain independently fail-closed on their broader cross-platform contracts. |
| Durable Execution | The only durable-operation source path changed is the KF-P0-20 outbound-message repair-consumer root; no broad KF-P0-26..28 closure is inferred from that localized change. | KF-P0-26..28 remain `EVIDENCE_RECONCILIATION`. |
| AI Core cancellation/stale/retry/authority/persistence | No AI Core path changed. | A2-P1-001 remains source-gate closed RC pending; KF-P0-29..31 and KF-P1-07 remain unresolved. |
| Dependency / supply chain | No dependency, lockfile or runtime-downloader path changed. | KF-P0-05..07 / KF-P1-03 retain source-gate-closed-RC-pending; no new Delta dependency P0/P1. |
| Release packaging / sealed runtime / real Windows launch | No new final fresh-main packaged Windows RC exists after #814. | UAT-001/UAT-002 remain blocking; `freshPackagedWindowsRcPass=false`. |

No new A2-P0/A2-P1 row is discovered by this finding-specific segment. `freshMainAuditV2Complete=false` remains fail-closed because unresolved source/evidence P0/P1 rows remain.

### 4.6 Post-KF-P0-24 exact-main surface accounting — `b53745a3c52429464e1f7498b70d4548594563ac`

Mechanical compare `e498acafabc3804302e3e1149441e5d81c96f596` → `b53745a3c52429464e1f7498b70d4548594563ac` is `status=ahead`, `ahead_by=12`, `behind_by=0`, changing exactly six paths: `backend/services/durableOperations/outboundMessageSendOperation.js`, the prior post-KF-P0-20 ledger, three KF-P0-24 governance authorizations, and `tests/wp0/v21-telegram-media-local-persistence-repair-kf-p0-24.test.js`. No dependency, package-lock, workflow, routing-policy, release-binary, Electron/backend lifecycle, AI or unrelated Product source changed.

This segment mechanically closes only KF-P0-24 at source/gate level. The 14 evidence-only historical rows remain independently fail-closed unless their own exact lineage is mechanically recoverable. No new A2-P0/A2-P1 finding is discovered, and no final fresh packaged Windows RC exists.

### 4.7 Fresh-main Audit V2 exact-main checkpoint — `fefd92e33954e392bb9a437b3e67237148b62f73`

Authorization #823 ordinary-merged as `3865bb079b29f49553dc265ac5340b8e58c27ec9` with strict parents `fefd92e33954e392bb9a437b3e67237148b62f73` + `b9d4036a04dcc709a461f29687db51d0c670ffe6`. The exact audit target is the immediately preceding trusted main `fefd92e33954e392bb9a437b3e67237148b62f73`; #822 itself ordinary-merged with strict parents `6e53bfef4e3340879a04194fd3bd9130e8ca3728` + `3f9cd57e8cd2325dd679bdd0baf4a50d4e9fd862`.

Mechanical compare `b53745a3c52429464e1f7498b70d4548594563ac` → `fefd92e33954e392bb9a437b3e67237148b62f73` is `status=ahead`, `ahead_by=4`, `behind_by=0`, changing only `docs/uat/V21_RELEASE_CLOSURE_LEDGER.md` and `governance/layered-ci/v21-release-closure-post-kf-p0-24-evidence-batch-p0-authorization.json`. Therefore no production, test, workflow, routing, dependency, manifest, lockfile, packaging or release-binary authority drift exists between the last audited production head and the Fresh-main Audit V2 target.

| Audit dimension | Exact-main result | Classification |
|---|---|---|
| 1. Exact ancestry / candidate identity | `fefd92e3…` is the verified ordinary #822 merge above; the audit is bound to that exact commit, not a moving branch tip. | COMPLETE |
| 2. Known Finding closure matrix | 31 P0 rows remain 20 source-gate-closed / 11 evidence-reconciliation; 8 P1 rows remain 5 source-gate-closed / 3 evidence-reconciliation. The 14 historical evidence-only rows are unchanged and no row is promoted from source shape. | COMPLETE; no new A2 row |
| 3. Electron/backend ownership and lifecycle | Exact-main source still contains `BackendOwnerRegistry` / `BackendProcessHost`, proper-lockfile-backed ownership and the already-merged async owner identity, startup admission and bounded concurrent shutdown closures. No Electron/backend production path changed after #820. KF-P0-03 remains historical evidence reconciliation; packaged multi-instance/lifecycle proof remains RC-layer work. | NO NEW EXECUTABLE ROOT |
| 4. Store / identity / conversation truth | Exact-main still contains the active-selection runtime mirror, `SYNC_CUSTOMER_CONTEXT` projection/command seams, exact-session selection and dedupe source shape. KF-P0-04/17/18 remain fail-closed because their historical finding-specific RED/execution lineage is incomplete; KF-P1-05 remains source-gate closed. | NO NEW EXECUTABLE ROOT |
| 5. WhatsApp / Telegram / Facebook egress and durable repair | Exact-main contains default Facebook `egressHandler`, canonical outbound durable operation, Telegram/WhatsApp local-repair custody and frozen mandatory contracts, plus Facebook Worker/R2 durable media authority. KF-P0-23 and KF-P1-06 remain evidence reconciliation because the broad historical cross-platform capability contracts are not mechanically complete. | NO NEW EXECUTABLE ROOT |
| 6. Durable Execution transaction / CAS / lease authority | Exact-main contains `durableExecutionAuthority`, `appendV2Event`, the repository write-transaction coordinator using `BEGIN IMMEDIATE`, heartbeat/lease and retry/dead-letter authority. Current source does not demonstrate the historical KF-P0-27 race as a fresh executable defect under the root write transaction. KF-P0-26/27/28 nevertheless remain evidence reconciliation because their own historical finding-specific ordinary-merged causal lineage is incomplete. | NO NEW EXECUTABLE ROOT |
| 7. AI scheduled terminalization / fencing / stale semantics | Exact-main contains `aiGateway` scheduled admission/terminalization, orchestrator generation/object-fingerprint fencing and stale/superseded guards; A2-P1-001's deterministic AI_AUTO retry subset is already source-gate closed. KF-P0-29/30/31 and broad KF-P1-07 retain evidence-reconciliation status because exact finding-specific historical chains remain incomplete. | NO NEW EXECUTABLE ROOT |
| 8. Security / credential boundaries | SecurityGuard exact internal actor, exact Safe Mode command set and command-owned write classification closures remain present; no boundary path changed after #820. KF-P1-01 remains evidence reconciliation / packaged all-write-entrypoint obligation rather than a newly observed source defect. | NO NEW EXECUTABLE ROOT |
| 9. Dependency / supported runtime / reproducibility | Exact target still carries Baileys `7.0.0-rc14`, proper-lockfile `4.1.2`, protected npm build/package/release commands and Electron 43.4.1 distribution-trust identity. No package, lockfile, downloader or native-runtime path changed in the `b53745a3… → fefd92e3…` window. | NO NEW DELTA P0/P1 |
| 10. Release packaging / sealed-runtime source surface | Protected build/package/release routing, source-UAT/preflight tooling and sealed-runtime checks remain present. No fresh final Windows package was created by this audit; historical #538 cannot satisfy candidate identity. | UAT-001/UAT-002 remain blocking; `freshPackagedWindowsRcPass=false` |
| 11. Historical evidence / mandatory-execution mapping | All ledger mappings already claimed for KF-P0-01/02/05/06/07/11/12/19/20/22/24, KF-P1-02/03/05/08, A2-P1-001 and the Facebook coverage gaps remain present. The remaining evidence-only rows are explicitly preserved; no RED/blob/run/merge identity is fabricated. | COMPLETE; global coverage still false |
| 12. Unknown blocker classification | Every observed residual is classified as `SOURCE_GATE_CLOSED_RC_PENDING`, `EVIDENCE_RECONCILIATION`, Delta source-gate pending, or UAT/RC obligation. The audit found no unclassified or fresh executable P0/P1 root. | `unknownBlockers=0` |

This checkpoint asserts `freshMainAuditV2Complete=true` as a **classification/audit gate only**. It becomes effective only when this ledger-only successor itself passes all routed exact-head gates, autonomous independent exact-head review reaches P0=0/P1=0, and the successor ordinary-merges. It does not close any Known Finding, does not make mandatory executed-test coverage complete, does not finalize the Delta window, and does not authorize a packaged RC, release, promotion or publish.

## 5. Release/UAT obligations not equivalent to new source defects

| ID | Severity | Obligation | State | Required evidence |
|---|---|---|---|---|
| UAT-001 | Release blocker | Historical issue #1 — model worker SQLite-isolation source work is complete but issue explicitly requires real Windows product UAT | PACKAGED_RC_PENDING | Fold into the fresh final RC matrix: real packaged worker execution, provider request IDs, SQLite ownership/fencing, concurrent receipt integrity, classified termination paths, secret-leak scan and independent review. Do not create a duplicate source repair unless fresh RC proves a new defect. |
| UAT-002 | Release blocker | PR #538 is historical UAT only | ENFORCED | Final candidate must be recreated from fresh main in a new RC/UAT PR. No #538 artifact may satisfy final RC identity. |

## 6. Historical Product system/settings checkpoint — PR #615

PR #615 is no longer an active unmerged line. Its final source head is ordinary-merged as `b89d7390df69b9100311644b9d934e6ce443e2ac` and remains valid source evidence for the Product system/settings reachability work package.

Its failure-first chain includes immutable RED `d25d3a2941a69bed16f99e7e08012a3a134a0839`, Stage RED `32542547372`, and `unknownBlockers=0`; the final implementation remained inside the exact eight-path authorization.

This does **not** make #615 a final release candidate. Historical Product Final/package evidence from #615 and older candidate #538 cannot satisfy the required new fresh-main Windows RC after later source merges.

## 7. Mandatory Executed-Test Coverage register

Presence of a test file is not sufficient. The following rows are mechanically bound to exact executed workflow evidence during this reconciliation:

| Coverage ID | Test/contract | Runner | Workflow/job | Exact head | Executed? | PASS? | Status |
|---|---|---|---|---|---|---|---|
| COV-KF-P0-02/P1-02 | `tests/wp4/evidence-platform-identity-and-windows-collector.test.js` + `tests/wp2/desktop-host-process-lifecycle.test.js` | Stage WP0 required external tests, installed through #622/#623 | RED Stage `32555589257`; final Stage `32568828398` | `b44a1670a7f308ff89f8fd8d262993075d2eac89` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-05 | `tests/wp0/v21-electron-supported-runtime-p0.test.js` | Stage WP0 | RED `32662426611`; final Stage `32686449711` | `91a14bed0fb242b5fcf5b85c166735c757c4f46b` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-06/P1-03 | `tests/wp0/v21-production-dependency-high-advisory-p0.test.js` | Stage WP0 | RED `32782570846`; final Stage `32784038864` | `95c60e647a0551e9780c611a0151d196449f84af` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-07 | `tests/wp0/v21-baileys-reproducible-runtime-p0.test.js` | Stage WP0 | first RED `32695056263`; final Stage `32722313094` | `bbfb49438b0fc65738d540df56620b128592102b` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-11 | `tests/wp0/v21-facebook-default-egress-handler-kf-p0-11.test.js` explicit default Facebook physical-egress handler + Chatwoot Matrix preserve contracts | Stage WP0: `package.json` `test:wp0` → `tools/wp0/run-tests.js` enumerates every `tests/wp0/*.test.js` | RED Stage `32822680009` / job `97724027664`; final Stage `32826900610` / `wp0-product` job `97736872956`, `Run WP0 required tests` SUCCESS | `ca9bd368d66908dfcc521f677cb0b75e6b269b03` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-12 | `tests/wp0/v21-facebook-page-chatwoot-integration-p0.test.js` exact D1 permission-authority and Worker error-family contracts | Stage WP0: `package.json` `test:wp0` → `tools/wp0/run-tests.js` enumerates every `tests/wp0/*.test.js` | RED Stage `32816626246` / job `97706179103`; final Stage `32818897944` / `wp0-product` job `97712758362`, `Run WP0 required tests` SUCCESS | `39103fd91aac0f6736f758a579a1c8fbda1673cb` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-19 | `tests/wp0/v21-whatsapp-stale-socket-inflight-custody-kf-p0-19.test.js` in-flight drain + WhatsApp stop/restart custody + batch39 stale-entry preservation contracts | Stage WP0: `package.json` `test:wp0` → `tools/wp0/run-tests.js` enumerates every `tests/wp0/*.test.js` | RED Stage `32833803435` / job `97758162718`; final Stage `32845544408` / `wp0-product` job `97794318087`, `Run WP0 required tests` SUCCESS | `1c72ee9854b2a9290fc2b834b5688921897c11fc` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-20 | `tests/wp0/v21-whatsapp-local-persistence-repair-kf-p0-20.test.js` durable repair-consumer/restart/idempotency contract | Stage WP0: `package.json` `test:wp0` → `tools/wp0/run-tests.js` exhaustively enumerates and isolates every `tests/wp0/*.test.js` | RED Stage `32869936201` / job `97874553963`; final Stage `32871718250` / `wp0-product` job `97880159827`, `Run WP0 required tests` SUCCESS | `fe57672d3e23e339af487017d47f7b2f91be4df5` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-24 | `tests/wp0/v21-telegram-media-local-persistence-repair-kf-p0-24.test.js` provider-accepted Telegram media durable restart/custody + no-second-send contract, immutable blob `9234cb97630bb9683d9dd669ea941530617e0473` | Stage WP0: `package.json` `test:wp0` → `tools/wp0/run-tests.js` exhaustively enumerates and isolates every `tests/wp0/*.test.js` | RED Stage `32880426330` / job `97908412835`; final #820 `wp0-product` job `97913443279`, `Run WP0 required tests` SUCCESS | `d17a0aa89c72f787f3af70fb8911339708a5db69` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-22 | `tests/wp0/v21-whatsapp-messages-upsert-detached-custody-kf-p0-22.test.js` | Stage WP0 mandatory runner | RED Stage `32850513145` / job `97810153689`; final Stage `32854806433` / job `97824125452`, explicit `ok 107 - v21-whatsapp-messages-upsert-detached-custody-kf-p0-22.test` | `3fbabb2d57454586f003548941288db69738f891` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P1-05 | `tests/wp0/v21-typing-state-contact-self-authority.test.js` | Stage WP0 | RED `32690111693`; final Stage `32690592676` | `a20285f0d8db3f6841450c07f35d112f4b9a0917` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P1-08 | `tests/wp0/v21-persona-compile-authority-p1.test.js` | Stage WP0 | RED `32691739045`; final Stage `32692383958` | `561d931aeaed89667dfaedbb985c58f99a3ee762` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-A2-P1-001 | `backend/tests/v21ProductAiAutoRetryStorm.test.js` | Stage WP0 required-test runner | RED `32613800942`; final Stage `32613979019` | `3231ba426c8e3976afd302cb2e2eaa160c957c1a` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-GAP-KF-P0-25 | `tests/wp0/v21-facebook-media-authority-release-closure-p0.test.js` production-consumer / dispatch / legacy-URL fail-closed contracts | Stage WP0: `package.json` `test:wp0` → `tools/wp0/run-tests.js` enumerates every `tests/wp0/*.test.js` | RED Stage `32794003597`; final Stage `32805044852`, job `97673481882`, step `Run WP0 required tests` SUCCESS | `2df6bbb586c5f81a9e420571d4a32fe59d5684e7` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING — historical gap repaired by #775/#777 |
| COV-GAP-DELTA-P1-001 | `services/facebook-worker/tests/media-r2-retention.test.js` persisted-attempt/no-local-retry regression | Mandatory Stage transitively through `tests/wp0/v21-facebook-media-authority-release-closure-p0.test.js`, which synchronously spawns this exact Worker test and requires exit status 0 | RED Stage `32794003597`; final Stage `32805044852`, job `97673481882`, required-test step SUCCESS | `2df6bbb586c5f81a9e420571d4a32fe59d5684e7` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING — historical gap repaired by #775/#777 |

The Facebook execution binding is mechanical rather than inferred from file presence: exact-head Stage job `97673481882` completed `Run WP0 required tests` successfully; `package.json :: test:wp0` invokes `tools/wp0/run-tests.js`; that runner unconditionally enumerates every `tests/wp0/*.test.js`; the Facebook WP0 contract itself synchronously executes `services/facebook-worker/tests/media-r2-retention.test.js` and fails unless the subprocess exits 0.

KF-P0-12 is also mechanically bound: the same Stage WP0 runner executes `tests/wp0/v21-facebook-page-chatwoot-integration-p0.test.js` at frozen RED head #788 and final exact head #790; final `wp0-product` job `97712758362` completed `Run WP0 required tests` successfully. The exact final test therefore executes and passes rather than merely existing in the tree.

KF-P0-11 is mechanically bound the same way: frozen #794 and final #796 preserve the finding-specific WP0 contract; #794 Stage owner job `97724027664` executes it RED with exactly one expected failure, while #796 exact-head Stage owner job `97736872956` completes `Run WP0 required tests` successfully. The paired Chatwoot Matrix preservation assertion is in the same mandatory test file and also passes.

KF-P0-19 is mechanically bound the same way: frozen #800 and final #802 contain the exact same test blob `c5e8adb2759ca845e5a44eebc377948bbef4a953`; #800 Stage job `97758162718` executes it RED with exactly the two generation-custody failures, while #802 exact-head Stage job `97794318087` completes `Run WP0 required tests` successfully. The final exact-head test therefore executes and passes rather than merely existing in the tree.

KF-P0-20 is mechanically bound by the mandatory runner contract: frozen #812 exact head `d03a37347966d9931224e4681a0233efd0696277` and final #814 exact head `fe57672d3e23e339af487017d47f7b2f91be4df5` preserve the finding-specific immutable blob `78d5a3f996a22e87227fe7d987a09f69c402ba22`; #812 Stage job `97874553963` executes it RED with exactly one expected failure, while #814 exact-head Stage job `97880159827` completes `Run WP0 required tests` successfully. Because `tools/wp0/run-tests.js` exhaustively enumerates and isolates every `tests/wp0/*.test.js`, the final exact file executes and passes even though its title is not printed by the aggregate owner log.

KF-P0-24 is mechanically bound the same way: frozen #818 exact head `74e4c41bcb224bf31df0905ecf5296303414bf90` and final #820 exact head `d17a0aa89c72f787f3af70fb8911339708a5db69` preserve immutable blob `9234cb97630bb9683d9dd669ea941530617e0473`; #818 Stage job `97908412835` executes it RED with exactly one expected failure and `unknownBlockers=0`, while #820 exact-head `wp0-product` job `97913443279` completes `Run WP0 required tests` successfully. The canonical runner exhaustively enumerates the exact file, so this is executed GREEN evidence rather than file-presence inference.

KF-P0-22 is mechanically bound with filename-level execution proof: frozen #806 and final #808 preserve identical blob `d3d5994fab8a801fc9f2533fb358fc1c93360dc5`; #806 executes the three causal RED failures with `unknownBlockers=0`, while #808 Stage job `97824125452` explicitly emits `ok 107 - v21-whatsapp-messages-upsert-detached-custody-kf-p0-22.test`.

KF-P0-01 is likewise mechanically bound without inventing a new historical coverage-gap identifier: frozen #781 and final #783 contain the exact same test blob `eeae851be411baa8aae376a00d7f55116a047c7e`; #781 Stage executes it RED with exactly the two startup-admission failures, while #783 exact-head Stage job `97688349946` executes the mandatory WP0 suite successfully. `mandatoryExecutedTestCoverageComplete=false` remains fail-closed because many other release-critical `EVIDENCE_RECONCILIATION` rows still lack equivalent bindings.

Every remaining release-critical contract must eventually receive the same mechanical binding. Rules:

1. test file present != coverage;
2. test selected but skipped != PASS unless skip is the contractually correct route and documented;
3. workflow GREEN != target test executed;
4. ancestor execution != exact-head execution;
5. platform-specific behavior requires the applicable platform job to execute;
6. final RC packaging/launch assertions require the fresh RC source/package identity, not a historical candidate.

The two historical Facebook media coverage gaps are repaired, KF-P0-01, KF-P0-11, KF-P0-12, KF-P0-19, KF-P0-20, KF-P0-22 and KF-P0-24 now have exact executed-test bindings, but `mandatoryExecutedTestCoverageComplete=false` remains fail-closed because many remaining `EVIDENCE_RECONCILIATION` release-critical findings have not yet received equivalent finding-specific exact executable bindings.

## 8. Delta Regression register

All changes after the 2026-08-20 audit through final RC must be independently scanned. Add immutable `DELTA-P0-*` / `DELTA-P1-*` rows here when discovered.

| ID | Severity | Delta finding | State | Exact evidence / next action |
|---|---|---|---|---|
| DELTA-P1-001 | P1 | Facebook Worker media regression suite is stale against the current persisted-attempt media authority | SOURCE_GATE_CLOSED_RC_PENDING | The old `760c45a9…` suite imported retired `retryPendingMedia` / eager-fetch semantics and lacked mandatory Stage execution. #775 rewrites the suite around metadata-only ingest, persisted-attempt physical materialization/cleanup and no local retry, and binds it into mandatory WP0. The frozen #775 Stage RED `32794003597` isolates only the two production media-authority roots with the Worker subprocess already passing. #777 exact head `2df6bbb5…` then passes Stage `32805044852` and all routed gates and ordinary-merges as `f8d0a736…`. Final packaged Facebook media evidence remains required. |

### 8.1 Historical baseline → Lane C checkpoint

Mechanical compare baseline `bdc556faa7da70bb6f0ae026e87fa1ab14d5e8b0` → exact Lane C base `760c45a9a03305882249ffd3673a64baa6c29fa0` reports `ahead_by=546`, `behind_by=0`. The Lane C scan covered workflow, security, Electron, Store, adapters, Durable Execution, AI, dependency, Product and sealed-runtime surfaces and exposed `DELTA-P1-001` without suppressing it behind narrative text.

### 8.2 Lane C checkpoint → post-Facebook audited main

Mechanical compare `760c45a9a03305882249ffd3673a64baa6c29fa0` → `f8d0a73603e4e4ff3f6207db80bcc9b60c7f15b7` reports:

- status: `ahead`; old checkpoint is an ancestor;
- `ahead_by=21`, `behind_by=0`;
- exact changed paths are the Lane C ledger, two Facebook governance authorizations, four Facebook production authority paths, `services/facebook-worker/tests/media-r2-retention.test.js`, and `tests/wp0/v21-facebook-media-authority-release-closure-p0.test.js`;
- no dependency, package-lock, workflow, routing-policy, release-binary, or unrelated Product surface is introduced by this segment;
- the only previously recorded delta blocker in this segment is `DELTA-P1-001`, now source/gate closed by #775/#777; no additional `DELTA-P0-*` / `DELTA-P1-*` row is discovered from the 21-commit segment.

### 8.3 Post-Facebook audited main → post-backend-startup audited main

Mechanical reconciliation of `f8d0a73603e4e4ff3f6207db80bcc9b60c7f15b7` through #783 audited main `944474ab3e04913e55019526640ee76afe1ada73` identifies the backend startup-admission causal bucket as the only newly advanced historical finding in this audit batch: KF-P0-01. The #781→#783 scope is limited to the dedicated WP0 test, the two backend startup/owner production roots and governance authorization evidence. No new dependency, package-lock, release binary, Facebook driver authority, scheduler/retry engine or unrelated Product surface is introduced, and no new `DELTA-P0-*` / `DELTA-P1-*` row is discovered from this reconciliation.

### 8.4 Post-backend-startup audited main → post-KF-P0-12 audited main

Mechanical compare `944474ab3e04913e55019526640ee76afe1ada73` → `06b1cb20452ec928b0316733bf5d1533cee37f23` reports `status=ahead`, `ahead_by=17`, `behind_by=0`. Exact changed paths are the prior ledger/audit authorization, two KF-P0-12 governance authorizations, `backend/services/facebookOAuthService.js`, `backend/services/facebookRelayClient.js`, `tests/wp0/v21-facebook-page-chatwoot-integration-p0.test.js`, and `tools/uat/sourceUatP0Preflight.js`. The segment introduces no dependency, package-lock, workflow, routing-policy, schema migration, release binary, `platformDriverRegistry`, scheduler/retry engine, or unrelated Product mutation. The source changes are the already-accounted KF-P0-12 causal closure; no additional `DELTA-P0-*` / `DELTA-P1-*` row is discovered from this 17-commit segment.

### 8.5 Post-KF-P0-12 audited main → post-KF-P0-11 audited main

Mechanical compare `06b1cb20452ec928b0316733bf5d1533cee37f23` → `28f394e8be6d4f8dc9208dafe60373827c5e5f27` reports `status=ahead`, `ahead_by=13`, `behind_by=0`. Exact changed paths are the previous post-KF-P0-12 ledger/audit authorization evidence, the two KF-P0-11 governance authorizations, `backend/services/platformAdapterPorts.js`, and `tests/wp0/v21-facebook-default-egress-handler-kf-p0-11.test.js`. The segment introduces no dependency, package-lock, workflow, routing-policy, schema migration, release binary, `platformDriverRegistry`, scheduler/retry engine, or unrelated Product mutation. The only new production source surface is the already-accounted KF-P0-11 causal closure; no additional `DELTA-P0-*` / `DELTA-P1-*` row is discovered from this 13-commit segment.

### 8.6 Post-KF-P0-11 audited ledger → post-KF-P0-19 audited main

Mechanical compare `29ce90a772be28cbddc925459721045b086f8104` → `682cdce54d0e9fac919f57fb0354992a1770d48e` reports `status=ahead`, `ahead_by=13`, `behind_by=0`. Exact changed paths are only the two KF-P0-19 governance authorizations, `backend/services/sessionGenerationFence.js`, `backend/services/whatsappAdapter.js`, and `tests/wp0/v21-whatsapp-stale-socket-inflight-custody-kf-p0-19.test.js`. There is no dependency, package-lock, workflow, routing-policy, schema migration, release binary, scheduler/retry engine or unrelated Product mutation. The source changes are the already-accounted KF-P0-19 causal closure; no additional `DELTA-P0-*` / `DELTA-P1-*` row is discovered from this 13-commit segment.

### 8.7 Post-KF-P0-19 audited ledger → post-KF-P0-22 audited main

Mechanical compare `4d8c7c33af673edd20ff170e47a71632cecbfcb5` → `0a5f0f5fefa7f851eb130927a12e18d3214993db` reports `status=ahead`, `ahead_by=9`, `behind_by=0`. Exact changed paths are the two KF-P0-22 governance authorizations, `backend/services/whatsappAdapter.js`, and the finding-specific WP0 test. No additional `DELTA-P0-*` / `DELTA-P1-*` finding is discovered in this segment.

### 8.8 Post-KF-P0-22 audited ledger → post-KF-P0-20 audited main

Mechanical compare `18db4b0442fb8aeee6b42161aba5337049e8efd6` → `e498acafabc3804302e3e1149441e5d81c96f596` reports `status=ahead`, `ahead_by=9`, `behind_by=0`. Exact changed paths are `backend/services/durableOperations/outboundMessageSendOperation.js`, the two KF-P0-20 governance authorizations, and `tests/wp0/v21-whatsapp-local-persistence-repair-kf-p0-20.test.js`. There is no dependency, package-lock, workflow, routing-policy, release-binary, Electron/backend lifecycle, AI or unrelated Product mutation. The source change is the already-accounted KF-P0-20 causal closure; no additional `DELTA-P0-*` / `DELTA-P1-*` finding is discovered in this segment.

### 8.9 Post-KF-P0-20 audited ledger → post-KF-P0-24 audited main

Mechanical compare `e498acafabc3804302e3e1149441e5d81c96f596` → `b53745a3c52429464e1f7498b70d4548594563ac` reports `status=ahead`, `ahead_by=12`, `behind_by=0`. Exact changed paths are `backend/services/durableOperations/outboundMessageSendOperation.js`, the prior release ledger, `governance/layered-ci/v21-release-closure-post-kf-p0-20-audit-p0-authorization.json`, `governance/layered-ci/v21-telegram-media-local-repair-kf-p0-24-diagnostic-p0-authorization.json`, `governance/layered-ci/v21-telegram-media-local-repair-kf-p0-24-production-amendment-1-authorization.json`, and `tests/wp0/v21-telegram-media-local-persistence-repair-kf-p0-24.test.js`. The only new production source is the already-accounted KF-P0-24 durable outbound repair-custody seam; no dependency, lockfile, workflow, routing-policy, release-binary, Electron/backend lifecycle, AI or unrelated Product production surface changes. No additional `DELTA-P0-*` / `DELTA-P1-*` finding is discovered in this interim window.

`deltaRegressionAuditComplete=false` remains required because the formal Delta audit window extends through the future final RC; that RC does not exist yet. No Delta finding is declared finally `CLOSED` merely because its source repair merged.

## 9. Final release counters

Current strict counters after the Fresh-main Audit V2 exact target `fefd92e33954e392bb9a437b3e67237148b62f73`:

```text
knownFindingsP0Total=31
knownFindingsP0SourceGateClosedRcPending=20
knownFindingsP1Total=8
knownFindingsP1SourceGateClosedRcPending=5
knownFindingsFinalClosed=0
freshMainAuditV2KnownRowsSourceGateClosedRcPending=1
deltaRegressionKnownP1=1
deltaRegressionKnownP1SourceGateClosedRcPending=1
freshMainAuditV2Complete=true
mandatoryExecutedTestCoverageComplete=false
deltaRegressionAuditComplete=false
freshPackagedWindowsRcPass=false
releaseLedgerClosed=false
releaseReady=false
formalReleaseAuthorized=false
publishAuthorized=false
```

Fresh-main Audit V2 is complete as an exact-head classification/surface audit with `unknownBlockers=0`; it does not erase unresolved finding-specific evidence mappings. Those mappings remain across the historical Electron register-level lock row, Store truth, cross-platform adapters, Durable Execution, SecurityGuard all-write-entrypoint proof and broader AI contracts. They keep `mandatoryExecutedTestCoverageComplete=false` and, together with the still-open final Delta and packaged-UAT layers, prevent RC freeze and all release/publish authority. Any newly proven executable defect still requires a separate authorized failure-first causal work package. This documentation batch does not authorize production repair, the final Windows RC, release, promotion or publish.