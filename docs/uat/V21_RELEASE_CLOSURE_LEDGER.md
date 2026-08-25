# V21 Release Closure Ledger

Status: ACTIVE / RELEASE NOT AUTHORIZED

Initial document authorization merge: `916c93d41feb72fa622cd40e2c8c20cabf4e7d91` (#656)

Release-ledger reconciliation authorization merge: `63684da2dee8e15ba1d6d75d016467e172f2ef50` (#770)

Reconciled trusted main: `2faa2a92d476a45bc08b58d33c877b6930e08897` (#769 ordinary merge)

Lane C audit authorization / exact audit base: `760c45a9a03305882249ffd3673a64baa6c29fa0` (#772 ordinary two-parent merge)

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

### 2026-08-25 mechanical reconciliation checkpoint

The trusted-main reconciliation advanced only rows with an exact causal chain. In particular:

- Electron supported-runtime advisory: #720 causal RED → amendment chain → #733 exact-head GREEN → ordinary merge `9e510b66a8fa4e103ca6466bab081fb4a02e8f6c`.
- Letta/sharp and remaining production High advisories: #759 prerequisite plus #769 causal RED/root fix → exact-head GREEN → ordinary merge `2faa2a92d476a45bc08b58d33c877b6930e08897`.
- Baileys reproducibility: #741 causal RED → frozen/successor prerequisite chain → #753 exact-head GREEN → ordinary merge `5e394ae19410f04d42661e12e40ae0b3d04f8969`.
- Typing contact/self authority: #737 causal RED/root fix → exact-head GREEN → ordinary merge `7802e99d759edb7c2210d49bf8a09142da9217c6`.
- Persona compile authority: #739 causal RED/root fix → exact-head GREEN → ordinary merge `3ba8940952b4788746deb18bf4dd683be9f46ecb`.
- AI_AUTO deterministic retry storm: #682 causal RED/root fix → exact-head GREEN → ordinary merge `f01bb27d3460dbb7efcb226c5b0a1316f0c8ffb0`.

Rows not listed above were still rechecked. They remain `OPEN` or `EVIDENCE_RECONCILIATION` where the exact finding-specific causal chain is not yet mechanically complete; current source shape or a related merge alone is not treated as closure.

## 2. Known Findings V1 — 31 P0 rows

| ID | Bucket | Finding | Current state | Evidence / next closure action |
|---|---|---|---|---|
| KF-P0-01 | Frontend / Electron | 后端启动竞态可能导致多后端子进程或重启循环 | EVIDENCE_RECONCILIATION | Electron lifecycle closure #643 is merged at `384eb133…`; exact head `b44a1670…` has Stage `32568828398`, ACV2 `32568828409`, WP-A `32568828392`, Model `32568828379` GREEN. Exact finding-specific failure-first startup-serialization mapping still needs binding; final RC start/restart/stop evidence remains mandatory. |
| KF-P0-02 | Frontend / Electron | BackendOwnerRegistry 同步 PowerShell / `Atomics.wait` 阻塞 Electron 主线程 | EVIDENCE_RECONCILIATION | #643 carries the async Windows owner-identity source closure and exact-head gates above, but the exact finding-to-causal-RED mapping is not yet mechanically bound. Final packaged responsiveness evidence remains mandatory. |
| KF-P0-03 | Frontend / Electron | BackendOwnerRegistry 缺乏跨进程独占锁 | EVIDENCE_RECONCILIATION | #643 is merged and exact-head GREEN; cross-process owner-lock behavior still needs exact finding-specific RED/test mapping plus final packaged multi-instance evidence. |
| KF-P0-04 | Frontend / Electron | StoreClient / ActiveContactStore / ConversationCenterV3 多份活跃会话与自动化模式真相源 | EVIDENCE_RECONCILIATION | #615 is now ordinary-merged as `b89d7390…` after its own failure-first chain, so related Product/Store authority work exists. Exact mapping across all three named active-conversation/mode surfaces remains incomplete; fresh-main Audit V2 must still prove one authority and no ambiguous fallback. |
| KF-P0-05 | Dependency security / reproducibility | `electron@39.8.5` 高严重代码签名伪造风险 | SOURCE_GATE_CLOSED_RC_PENDING | #720 established the supported-runtime causal RED; Stage `32662426611` reported 648 / 642 pass / 6 expected Electron identity failures with `unknownBlockers=0`. Final successor #733 head `91a14bed…` migrated active authority to Electron 43.4.1 and passed Stage `32686449711`, Layered `32686449844`, ACV2 `32686449706`, WP-B `32686449698`, WP-A `32686449830`, Model `32686449749`, Product Final `32686449712`; merged as `9e510b66…`. Fresh final RC identity/UAT still required. |
| KF-P0-06 | Dependency security / reproducibility | `@letta-ai/letta-agent-sdk` / `letta-code` 高严重依赖告警 | SOURCE_GATE_CLOSED_RC_PENDING | #759 closed the independent Letta sharp-lock prerequisite. #769 fresh RED head `2abc1fe3…`, Stage `32782570846`, isolated sharp/ip-address/js-yaml High-advisory failures with `unknownBlockers=0`; production head `95c60e64…` passed Stage `32784038864`, Layered `32784039105`, ACV2 `32784039019`, WP-B `32784038850`, WP-A `32784038834`, Model `32784038868` and merged as `2faa2a92…`. Final packaged dependency/runtime identity remains required. |
| KF-P0-07 | Dependency security / reproducibility | Baileys postinstall 源码 patch 破坏可复现与可审计性 | SOURCE_GATE_CLOSED_RC_PENDING | #741 first tests-only head `04dd8ca9…` produced Stage RED `32695056263` for the active rc13/postinstall mutation authority. After narrow trusted-seed/receipt prerequisites, #753 exact head `bbfb4943…` passed Stage `32722313094`, Layered `32722313281`, ACV2 `32722313170`, WP-B `32722313109`, WP-A `32722313220`, Model `32722313090` and merged as `5e394ae1…`; immutable upstream rc14 runtime authority replaces the postinstall patch path. Final packaged WhatsApp runtime evidence remains required. |
| KF-P0-08 | SecurityGuard | 调用方可伪造 actor 通过 `requireInternal` | SOURCE_GATE_CLOSED_RC_PENDING | #541 merged as `2b8e648f…`; source exact head `f5c09b10…`; Stage `32379500018`, ACV2 `32379500208`, WP-A `32379500226`, Model `32379500114` GREEN. Final packaged security regression still required. |
| KF-P0-09 | SecurityGuard | Safe Mode 对 `recovery.*` 使用宽前缀白名单 | SOURCE_GATE_CLOSED_RC_PENDING | #541 replaces prefix matching with exact command set; same exact-head GREEN evidence as KF-P0-08. Final packaged safe-mode write-path evidence required. |
| KF-P0-10 | SecurityGuard | `context.write=true` 可篡改 command-owned 写分类 | SOURCE_GATE_CLOSED_RC_PENDING | #543 merged as `9a2a696a…`; source head `ced882e1…`; Stage `32385443466`, ACV2 `32385443458`, WP-A `32385443619`, Model `32385443480` GREEN. Final packaged regression required. |
| KF-P0-11 | Adapter Ports / Facebook Worker | `platformAdapterPorts` 默认 registry 未显式闭合 Facebook egress handler | EVIDENCE_RECONCILIATION | Facebook Worker production closures are merged, including #639, but this exact default-registry/handler finding still lacks a mechanically bound finding-specific RED → exact-head test chain. Do not infer closure from interface presence. |
| KF-P0-12 | Adapter Ports / Facebook Worker | Desktop 与 Worker oauth/avatar/D1 契约版本及 `FACEBOOK_*` 错误码未强制对齐 | EVIDENCE_RECONCILIATION | Later Facebook contract work exists; exact oauth/avatar/D1 version and `FACEBOOK_*` error-family conformance still needs a finding-specific executed contract mapping. |
| KF-P0-13 | Adapter Ports / Facebook Worker | `pullEvents` 一次性 lease 无续约导致长事件处理重复投递/状态延迟 | SOURCE_GATE_CLOSED_RC_PENDING | #639 merged as `347097a6…`; frozen RED `b4bab02a…`, Stage RED `32564194421`, `unknownBlockers=0`; source head `eedb4e09…` exact Stage/Layered/ACV2/WP-A/Model GREEN. Root fix adds bounded event lease renewal. Final packaged evidence pending. |
| KF-P0-14 | Identity / Person Context | Identity detach 后 `person_contact_bindings` 未同步失效 | SOURCE_GATE_CLOSED_RC_PENDING | #542 merged as `f978a4dc…`; source head `0173cba4…` adds last-usable-link contact binding detach and audited rollback. Packaged identity flow pending. |
| KF-P0-15 | Identity / Person Context | 再次 `observe` 可静默重新激活已 detached scope binding | SOURCE_GATE_CLOSED_RC_PENDING | #542 explicitly rejects detached-link silent re-observe and adds regression coverage. Final packaged flow pending. |
| KF-P0-16 | Identity / Person Context | `PersonContextAuthority` 读端不校验 identity_link detached/disputed 状态 | SOURCE_GATE_CLOSED_RC_PENDING | #542 requires usable identity-link status and exact conversation-binding match before context reads. Final packaged flow pending. |
| KF-P0-17 | Store truth source | Backend `customers.currentId` 与前端 active contact 双轨无显式同步 | EVIDENCE_RECONCILIATION | #615 is now merged and is relevant Product system/settings reachability authority evidence, but the exact backend `customers.currentId` ↔ frontend active-contact single-truth contract has not been mechanically tied to its RED/test chain. Wrong-target egress proof remains required. |
| KF-P0-18 | Store truth source | `SYNC_CUSTOMER_CONTEXT` 对 `conversations.byContactId` 只 push 不去重 | EVIDENCE_RECONCILIATION | Fresh exact-base inspection at `760c45a9…` proves the literal duplicate-push shape is no longer present: `SYNC_CUSTOMER_CONTEXT` initializes `byContactId[contactId]` and pushes only when `includes(conversationId)` is false. The finding-specific failure-first commit, mandatory executed test and exact-head GREEN chain are still not mechanically bound, so source-gate closure is not claimed. |
| KF-P0-19 | WhatsApp | `stop()` 后旧 socket 事件仍可能进入 handler，代际隔离不完整 | EVIDENCE_RECONCILIATION | Later WhatsApp generation/fencing work exists; exact stale-socket RED/fix/test execution remains to be mechanically bound before advancing. |
| KF-P0-20 | WhatsApp | 平台接受后本地持久化失败仅返回 `localPersistenceRepair`，修复消费链未闭环 | EVIDENCE_RECONCILIATION | Durable platform-accepted local repair successor work is merged in the WP-B lineage, but exact WhatsApp repair-consumer/restart/idempotency finding mapping remains to be bound. |
| KF-P0-21 | WhatsApp | 物理 egress 错误码/HTTP status 不统一 | SOURCE_GATE_CLOSED_RC_PENDING | #647 immutable RED `c6cd39ca…`, Stage RED `32570813989`, `unknownBlockers=0`; #649 source head `f10a2785…` merged as `c6e1e7d8…`, structures disconnected/local/provider egress errors. Final packaged egress evidence pending. |
| KF-P0-22 | WhatsApp | `messages.upsert` 长 await 边界前后 socket generation/fence 校验不足 | EVIDENCE_RECONCILIATION | Current WhatsApp/WP-B code contains generation/fencing mechanisms, but the exact `messages.upsert` long-await boundary finding still lacks a mechanically bound RED → fix → executed-gate chain. |
| KF-P0-23 | Telegram / Facebook | 跨平台 egress 公共接口签名/能力不统一 | EVIDENCE_RECONCILIATION | #653 Telegram plus later Facebook/adapter work are candidate evidence; current canonical adapter-port contract still needs an exact cross-platform finding-specific execution mapping. |
| KF-P0-24 | Telegram / Facebook | `localPersistencePending` / `localPersistenceRepair` 有契约但无自动幂等修复闭环 | EVIDENCE_RECONCILIATION | WP-B durable local-repair authority exists, but Telegram and Facebook must each be mechanically mapped to terminal/restart/idempotency executed tests before this row advances. |
| KF-P0-25 | Telegram / Facebook | Facebook `worker_media` 缺失时缺少传统媒体 URL fallback | OPEN | Fresh exact-base inspection confirms this remains a real closure blocker rather than a ledger-only stale row. `handleWebhook` recognizes both `payload.worker_media` and legacy `payload.url`, but only emits `facebook:webhook-media-delegated`; repository search found no separate consumer for that event, while `fetchAttachmentUrl(...)` validates the legacy URL and then deliberately fails because direct CDN fetch is retired. The regression suite contains a legacy fallback URL safety test, but no mandatory exact-head workflow execution is bound to the missing-worker-media fallback behavior. Product intent + causal RED + supported repair path remain required. |
| KF-P0-26 | Durable Execution | M2 heartbeat/succeed/fail/waitRemote/cancel/retry/deadLetter 等关键操作未实现 | EVIDENCE_RECONCILIATION | Trusted main now contains Schema-23 durable execution/internal-operation implementations for heartbeat, terminalization, retry scheduling and dead-letter behavior, plus executed WP-B contracts in later merges. Historical Draft #17 itself remains non-merge evidence; reconstruct the exact ordinary-merged implementation lineage per operation before advancing. |
| KF-P0-27 | Durable Execution | `appendV2Event MAX(sequence)+1` 再 INSERT 存在并发 sequence 完整性风险 | EVIDENCE_RECONCILIATION | Current transaction/fencing infrastructure is stronger than the audit baseline, but no exact finding-specific concurrency sequence RED/root-fix/gate chain has yet been bound. |
| KF-P0-28 | Durable Execution | 长任务无 heartbeat 导致 lease 过期后终态操作被拒 | EVIDENCE_RECONCILIATION | Trusted main has canonical heartbeat lease extension and retry lifecycle coverage (including M3-SC-DIAG-011), but the exact long-running production-operation finding-to-causal-RED lineage remains to be mechanically bound. |
| KF-P0-29 | AI Core | `aiGateway.submit` 在 `authority.start` 前失败可能让 durable operation 滞留 SCHEDULED | EVIDENCE_RECONCILIATION | Current `aiGateway.submit` persists before queue admission and terminalizes a still-SCHEDULED operation on queue failure by start+cancel, but this audit row still needs the exact failure-first and executed regression chain before source closure can be claimed. |
| KF-P0-30 | AI Core | `aiBrainOrchestrator` cancel 与 succeed 存在终态竞态，缺 generation/fencing 一致性 | EVIDENCE_RECONCILIATION | Current canonical analysis terminal paths carry generation + object fingerprint and use Schema-23 fencing, but the exact cancel-vs-succeed race finding still needs a dedicated mechanically bound RED/executed contract. |
| KF-P0-31 | AI Core | `contextAwareReplyBrain` / `aiGateway` / turn coordinator stale/superseded 语义不对齐 | EVIDENCE_RECONCILIATION | Current AI_AUTO and translation contracts include stale/superseded rejection, including restart-safe stale-result prevention, but all three named layers still need one exact finding-specific chain before this row advances. |

### P0 accounting

- imported P0 rows: **31**
- `SOURCE_GATE_CLOSED_RC_PENDING`: **11**
- finally `CLOSED`: **0**
- unresolved for final release: **31**

This count is intentionally strict: `SOURCE_GATE_CLOSED_RC_PENDING` is still unresolved until the fresh final RC closes the packaged evidence layer.

## 3. Known Findings V1 — 8 explicit P1 rows

| ID | Bucket | Finding | Current state | Evidence / next closure action |
|---|---|---|---|---|
| KF-P1-01 | Frontend / Electron | Safe Mode 主要停留在 UI banner，需证明后端所有写入口真实 fail-closed | EVIDENCE_RECONCILIATION | #541/#543 strengthen backend SecurityGuard, but the all-write-entrypoint packaged audit remains incomplete. |
| KF-P1-02 | Frontend / Electron | `stopApplicationOwnedRuntimes` 串行等待，单 runtime hang 可阻塞整体退出 | EVIDENCE_RECONCILIATION | Trusted main now uses independent `stopRuntimeWithDeadline(...)` wrappers and `Promise.allSettled(...)` across presence/Letta/Parlant/Graphiti/backend instead of serial stop waits. The exact finding-specific causal RED/test lineage is not yet mechanically bound, so source closure is not claimed. |
| KF-P1-03 | Dependency security / reproducibility | `@letta-ai/letta-code` 依赖 `sharp <0.35.0` 的漏洞链 | SOURCE_GATE_CLOSED_RC_PENDING | #759 reconciled the Letta sharp-lock prerequisite; #769 RED Stage `32782570846` directly required scoped/root sharp 0.35.3 and no unsafe nested sharp, with `unknownBlockers=0`. #769 production head `95c60e64…` passed the exact-head gate set listed under KF-P0-06 and merged as `2faa2a92…`. Fresh packaged runtime identity remains required. |
| KF-P1-04 | Adapter Ports / Facebook Worker | WP-B execution/fencing identity 暴露在 Worker URL query | SOURCE_GATE_CLOSED_RC_PENDING | #639 removes persisted WP-B identity from URL query and moves it to signed `x-yance-wpb-*` metadata; source head `eedb4e09…` exact gates GREEN. Final packaged/log-leak evidence pending. |
| KF-P1-05 | Store truth source | `UPDATE_SELF_TYPING_STATE` 顶层 conversation/account/platform 字段可能覆盖 contact 侧最新会话 | SOURCE_GATE_CLOSED_RC_PENDING | #737 first tests-only head `58fcc598…` produced Stage RED `32690111693` for the two KF-P1-05 collisions. Production head `a20285f0…` passed Stage `32690592676`, Layered `32690592902`, ACV2 `32690592696`, WP-A `32690592688`, Model `32690592737` and merged as `7802e99d…`. Final packaged typing/targeting regression remains required. |
| KF-P1-06 | Telegram / Facebook | Facebook 本地适配器退化为 Worker/Durable Authority 投影，闭环能力弱于 Telegram | EVIDENCE_RECONCILIATION | Later Facebook authority work intentionally retires duplicate paths in places; supported capability intent and the exact missing-behavior contract must be established before advancing. |
| KF-P1-07 | AI Core | reply generation 链过长，任一环失败导致整体失败与 deep latency 风险 | EVIDENCE_RECONCILIATION | #682 closes the deterministic AI_AUTO retry-storm subset, but this broader finding also covers general failure-family and deep-latency/bounded-behavior semantics. Keep under reconciliation until those remaining semantics are executed and mapped. |
| KF-P1-08 | AI Core | `personaBrain` 多个 `compile*` 入口并存，调用方可能混用语义 | SOURCE_GATE_CLOSED_RC_PENDING | #739 first tests-only head `e480e555…` produced Stage RED `32691739045` for facade/route/reply-brain compile authority split. Production head `561d931a…` passed Stage `32692383958`, Layered `32692384194`, ACV2 `32692383967`, WP-A `32692383978`, Model `32692383893` and merged as `3ba89409…`. Final packaged Persona/reply path evidence remains required. |

### P1 accounting

- imported explicit P1 rows: **8**
- `SOURCE_GATE_CLOSED_RC_PENDING`: **4**
- finally `CLOSED`: **0**
- unresolved for final release: **8**

## 4. Fresh-main Release Audit V2 findings

These rows are independent of Known Findings V1. Do not renumber or rewrite the 8/20 baseline when new findings appear.

| ID | Severity | Finding | State | Evidence / next action |
|---|---|---|---|---|
| A2-P1-001 | P1 | AI_AUTO deterministic reply-generation failures historically re-entered the 20-attempt durable analysis retry loop (issue #533) | SOURCE_GATE_CLOSED_RC_PENDING | After the WP0 coverage prerequisite, #682 V4 first head `2b0e2a19…` produced fresh Stage RED `32613800942` for the remaining `SOCIAL_CONTEXT_NOT_READY`, `STALE_CONVERSATION_CONTEXT`, `STALE_PERSONA_PROFILE` classification gap with `unknownBlockers=0`. Final head `3231ba42…` passed Stage `32613979019`, ACV2 `32613978971`, WP-A `32613978900`, Model `32613978924` and merged as `f01bb27d…`; these deterministic generation errors now terminate the canonical analysis non-retryably. Fresh final RC remains required. |

Additional Audit V2 findings must be appended here with immutable IDs. Completion of A2-P1-001 source closure does **not** mean the independent Fresh-main Release Audit V2 is complete.

### 4.1 Lane C exact-base surface accounting — `760c45a9a03305882249ffd3673a64baa6c29fa0`

| Audit surface | Exact-base inspection result | Ledger disposition |
|---|---|---|
| Renderer/UI authority and reachable controls | Product system/settings and active-selection work are present on fresh main; historical #615 remains source evidence only and the active-conversation authority mappings in KF-P0-04/KF-P0-17 are not yet mechanically complete. | No duplicate A2 row; existing Known Finding rows remain blockers. |
| Electron/backend ownership, startup, shutdown and process identity | Current main contains the async owner/process lifecycle lineage and Electron 43.4.1 closure; packaged start/restart/stop evidence is still absent. | KF-P0-01..03 and UAT obligations remain unresolved; no false packaged claim. |
| Credential/security boundaries | SecurityGuard exact-command/internal/write-classification source closures are merged, while all-write-entrypoint packaged proof remains outstanding. | KF-P0-08..10 / KF-P1-01 remain authoritative rows. |
| Store/identity/conversation truth | Fresh source inspection verified `SYNC_CUSTOMER_CONTEXT` deduplicates `conversations.byContactId`; active selection and typing authority code is also present. Exact finding-specific execution mapping is incomplete. | KF-P0-18 advances only to `EVIDENCE_RECONCILIATION`; KF-P0-04/17 and KF-P1-05 retain their stricter states. |
| Physical adapters and durable repair | WhatsApp/Telegram/Facebook durable repair and fencing work is present, but Facebook missing-`worker_media` legacy URL fallback remains unresolved on the current source path. Facebook Worker's own media regression suite is stale against the current attempt-authority API. | KF-P0-25 remains `OPEN`; `DELTA-P1-001` records the independent stale-test delta. |
| Durable Execution | Schema-23 operations, heartbeat and retry/fencing paths exist on fresh main; exact finding-specific lineage remains incomplete for the broad historical rows. | KF-P0-26..28 remain `EVIDENCE_RECONCILIATION`. |
| AI Core cancellation/stale/retry/authority/persistence | AI_AUTO retry-storm subset is mechanically closed at source/gate level; broader scheduled/cancel-vs-succeed/stale-layer rows remain unmapped. | A2-P1-001 remains source-gate closed RC pending; KF-P0-29..31 and KF-P1-07 remain unresolved. |
| Dependency / supply chain | Electron 43.4.1, Baileys rc14, Letta sharp reconciliation and High-advisory closure are present; adaptive local runtime materialization is local-file-only, explicit-consent and SHA-256 checked rather than an implicit runtime downloader. | KF-P0-05..07 / KF-P1-03 retain source-gate-closed-RC-pending; no new Delta P0/P1 from this inspected materialization path. |
| Release packaging / sealed runtime / real Windows launch | No new final fresh-main packaged Windows RC exists after the later source merges. | UAT-001/UAT-002 remain blocking; `freshPackagedWindowsRcPass=false`. |

This is an exact-base **surface scan checkpoint**, not release completion. Existing V1/A2 blockers are not duplicated merely to make the Audit V2 list longer. Fresh-main Audit V2 cannot become complete while A2-P1-001 still lacks its future packaged RC evidence, `DELTA-P1-001` is unresolved, and the release program still has unresolved P0/P1 obligations.

## 5. Release/UAT obligations not equivalent to new source defects

| ID | Severity | Obligation | State | Required evidence |
|---|---|---|---|---|
| UAT-001 | Release blocker | Historical issue #1 — model worker SQLite-isolation source work is complete but issue explicitly requires real Windows product UAT | PACKAGED_RC_PENDING | Fold into the fresh final RC matrix: real packaged worker execution, provider request IDs, SQLite ownership/fencing, concurrent receipt integrity, classified termination paths, secret-leak scan and independent review. Do not create a duplicate source repair unless fresh RC proves a new defect. |
| UAT-002 | Release blocker | PR #538 is historical UAT only | ENFORCED | Final candidate must be recreated from fresh main in a new RC/UAT PR. No #538 artifact may satisfy final RC identity. |

## 6. Historical Product system/settings checkpoint — PR #615

PR #615 is no longer an active unmerged line. Its final source head is ordinary-merged as `b89d7390df69b9100311644b9d934e6ce443e2ac` and remains valid source evidence for the Product system/settings reachability work package.

Its failure-first chain includes immutable RED `d25d3a2941a69bed16f99e7e08012a3a134a0839`, Stage RED `32542547372`, and `unknownBlockers=0`; the final implementation remained inside the exact eight-path authorization.

This does **not** make #615 a final release candidate. Historical Product Final/package evidence from #615 and older candidate #538 cannot satisfy the required new fresh-main Windows RC after the later Electron/Baileys/Letta/dependency and other source merges.

## 7. Mandatory Executed-Test Coverage register

Presence of a test file is not sufficient. The following rows are mechanically bound to exact executed workflow evidence during this reconciliation:

| Coverage ID | Test/contract | Runner | Workflow/job | Exact head | Executed? | PASS? | Status |
|---|---|---|---|---|---|---|---|
| COV-KF-P0-05 | `tests/wp0/v21-electron-supported-runtime-p0.test.js` | Stage WP0 | RED `32662426611`; final Stage `32686449711` | `91a14bed0fb242b5fcf5b85c166735c757c4f46b` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-06/P1-03 | `tests/wp0/v21-production-dependency-high-advisory-p0.test.js` | Stage WP0 | RED `32782570846`; final Stage `32784038864` | `95c60e647a0551e9780c611a0151d196449f84af` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P0-07 | `tests/wp0/v21-baileys-reproducible-runtime-p0.test.js` | Stage WP0 | first RED `32695056263`; final Stage `32722313094` | `bbfb49438b0fc65738d540df56620b128592102b` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P1-05 | `tests/wp0/v21-typing-state-contact-self-authority.test.js` | Stage WP0 | RED `32690111693`; final Stage `32690592676` | `a20285f0d8db3f6841450c07f35d112f4b9a0917` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-KF-P1-08 | `tests/wp0/v21-persona-compile-authority-p1.test.js` | Stage WP0 | RED `32691739045`; final Stage `32692383958` | `561d931aeaed89667dfaedbb985c58f99a3ee762` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-A2-P1-001 | `backend/tests/v21ProductAiAutoRetryStorm.test.js` | Stage WP0 required-test runner | RED `32613800942`; final Stage `32613979019` | `3231ba426c8e3976afd302cb2e2eaa160c957c1a` | yes | yes | SOURCE_GATE_CLOSED_RC_PENDING |
| COV-GAP-KF-P0-25 | `backend/tests/facebookProductionReadinessRegression.test.js` legacy-media/fallback coverage | Present in `package.json` scripts, but absent from `tools/wp0/run-tests.js` WP0 glob/external required list | Repository search found no mandatory workflow invocation of `test:facebook-contracts` / `test:platform-production-readiness` | `760c45a9a03305882249ffd3673a64baa6c29fa0` | no mandatory exact-head execution bound | no | BLOCKED — separate coverage/repair causal package required |
| COV-GAP-DELTA-P1-001 | `services/facebook-worker/tests/media-r2-retention.test.js` | Facebook Worker package-local `node --test tests/*.test.js`; not Stage WP0 | No mandatory exact-head workflow invocation found | `760c45a9a03305882249ffd3673a64baa6c29fa0` | no mandatory exact-head execution bound | no | BLOCKED — stale contract must be repaired and routed/proven |

`tools/wp0/run-tests.js` mechanically executes every `tests/wp0/*.test.js` plus exactly four external tests: desktop-host lifecycle, Windows owner evidence, main-window activation, and `backend/tests/v21ProductAiAutoRetryStorm.test.js`. Therefore a backend/Worker regression test is **not** mandatory Stage coverage merely because a package script names it. KF-P0-25 and DELTA-P1-001 demonstrate this blind spot.

Every remaining release-critical contract must eventually receive the same mechanical binding. Rules:

1. test file present != coverage;
2. test selected but skipped != PASS unless skip is the contractually correct route and documented;
3. workflow GREEN != target test executed;
4. ancestor execution != exact-head execution;
5. platform-specific behavior requires the applicable platform job to execute;
6. final RC packaging/launch assertions require the fresh RC source/package identity, not a historical candidate.

Because `COV-GAP-KF-P0-25` and `COV-GAP-DELTA-P1-001` are unresolved, `mandatoryExecutedTestCoverageComplete=false` remains fail-closed.

## 8. Delta Regression register

All changes after the 2026-08-20 audit through final RC must be independently scanned. Add immutable `DELTA-P0-*` / `DELTA-P1-*` rows here when discovered.

| ID | Severity | Delta finding | State | Exact evidence / next action |
|---|---|---|---|---|
| DELTA-P1-001 | P1 | Facebook Worker media regression suite is stale against the current persisted-attempt media authority | OPEN | On exact base `760c45a9…`, `services/facebook-worker/tests/media-r2-retention.test.js` imports `retryPendingMedia` and asserts the pre-migration eager `cacheEventMedia(...)` result, while current `services/facebook-worker/src/media.js` no longer exports `retryPendingMedia` and a call without persisted attempt identity intentionally records metadata-only references. `services/facebook-worker/package.json` still includes this file in `node --test tests/*.test.js`, but repository search found no mandatory exact-head workflow execution. Repair test semantics against the persisted-attempt Worker authority and bind mandatory exact-head execution in a separate failure-first causal batch. |

### 8.1 Exact current-main checkpoint

Mechanical compare baseline `bdc556faa7da70bb6f0ae026e87fa1ab14d5e8b0` → exact Lane C base `760c45a9a03305882249ffd3673a64baa6c29fa0` reports:

- status: `ahead`; baseline is an ancestor;
- `ahead_by=546`, `behind_by=0`;
- changed surfaces include Stage/Layered/Product/WP-B workflows; SecurityGuard; Electron owner/process/main/preload/store bridge; Store active-selection/runtime-state commands; WhatsApp/Telegram/Facebook adapter paths; Durable Execution and AI orchestration/gateway/reply paths; dependency policy/package lock/release binding; renderer/Product surfaces; tests; and sealed/vendor runtime inputs;
- focused checks of changed supply-chain/runtime materialization found no implicit adaptive-runtime download: materialization requires an already-local file, explicit consent and an expected SHA-256 match;
- focused Store inspection reclassified KF-P0-18 to evidence reconciliation rather than inventing a Delta row;
- focused Facebook inspection confirmed KF-P0-25 remains the existing V1 source blocker and exposed the executed-test coverage gap above;
- direct Worker media source/test comparison exposed `DELTA-P1-001`, so the audit does not suppress the stale-test regression behind a generic narrative statement.

No additional `DELTA-P0-*` / `DELTA-P1-*` row is declared from this current-main checkpoint beyond `DELTA-P1-001`. This is not a claim that the final Delta audit is complete: the required audit window ends at the future final RC, which does not exist yet.

No Delta finding is declared CLOSED merely because its introducing PR was reviewed.

## 9. Final release counters

Current strict counters after the Lane C exact-base checkpoint:

```text
knownFindingsP0Total=31
knownFindingsP0SourceGateClosedRcPending=11
knownFindingsP1Total=8
knownFindingsP1SourceGateClosedRcPending=4
knownFindingsFinalClosed=0
freshMainAuditV2KnownRowsSourceGateClosedRcPending=1
deltaRegressionKnownP1=1
freshMainAuditV2Complete=false
mandatoryExecutedTestCoverageComplete=false
deltaRegressionAuditComplete=false
freshPackagedWindowsRcPass=false
releaseLedgerClosed=false
releaseReady=false
formalReleaseAuthorized=false
publishAuthorized=false
```

These values may only advance from fresh, exact, mechanically verified evidence. The next source action exposed by this audit is **not** authorized by this documentation batch: KF-P0-25 + DELTA-P1-001 + their coverage gaps form one Facebook media-authority causal bucket and require an independent failure-first authorization and repair package.