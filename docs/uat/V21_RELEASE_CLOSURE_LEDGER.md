# V21 Release Closure Ledger

Status: ACTIVE / RELEASE NOT AUTHORIZED

Authorization merge: `916c93d41feb72fa622cd40e2c8c20cabf4e7d91` (#656)

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

## 2. Known Findings V1 — 31 P0 rows

| ID | Bucket | Finding | Current state | Evidence / next closure action |
|---|---|---|---|---|
| KF-P0-01 | Frontend / Electron | 后端启动竞态可能导致多后端子进程或重启循环 | EVIDENCE_RECONCILIATION | Electron lifecycle closure #643 is related and merged; map exact causal test and startup-serialization semantics, then require final RC start/restart/stop evidence. |
| KF-P0-02 | Frontend / Electron | BackendOwnerRegistry 同步 PowerShell / `Atomics.wait` 阻塞 Electron 主线程 | EVIDENCE_RECONCILIATION | #643 changes `BackendOwnerRegistry` Windows identity collection from blocking `execFileSync` to async execution; exact finding-to-RED mapping and packaged responsiveness evidence remain to be bound. |
| KF-P0-03 | Frontend / Electron | BackendOwnerRegistry 缺乏跨进程独占锁 | EVIDENCE_RECONCILIATION | #643 is candidate Electron lifecycle evidence; prove the exact cross-process owner-lock contract and final packaged multi-instance behavior before closure. |
| KF-P0-04 | Frontend / Electron | StoreClient / ActiveContactStore / ConversationCenterV3 多份活跃会话与自动化模式真相源 | OPEN | Reconcile with later Product/Store authority work; fresh-main Audit V2 must prove one current authoritative conversation/contact/mode source and no ambiguous fallback. |
| KF-P0-05 | Dependency security / reproducibility | `electron@39.8.5` 高严重代码签名伪造风险 | OPEN | Run current fresh-main dependency/security audit; bind exact current Electron version/advisory disposition and packaged runtime identity. |
| KF-P0-06 | Dependency security / reproducibility | `@letta-ai/letta-agent-sdk` / `letta-code` 高严重依赖告警 | OPEN | Run current `npm audit`/provenance review; require patched dependency or explicit accepted-risk evidence compatible with release policy. |
| KF-P0-07 | Dependency security / reproducibility | Baileys postinstall 源码 patch 破坏可复现与可审计性 | OPEN | Inspect fresh-main package scripts and Baileys integration; prove patch removal/replacement and reproducible dependency materialization. |
| KF-P0-08 | SecurityGuard | 调用方可伪造 actor 通过 `requireInternal` | SOURCE_GATE_CLOSED_RC_PENDING | #541 merged as `2b8e648f…`; source exact head `f5c09b10…`; Stage `32379500018`, ACV2 `32379500208`, WP-A `32379500226`, Model `32379500114` GREEN. Final packaged security regression still required. |
| KF-P0-09 | SecurityGuard | Safe Mode 对 `recovery.*` 使用宽前缀白名单 | SOURCE_GATE_CLOSED_RC_PENDING | #541 replaces prefix matching with exact command set; same exact-head GREEN evidence as KF-P0-08. Final packaged safe-mode write-path evidence required. |
| KF-P0-10 | SecurityGuard | `context.write=true` 可篡改 command-owned 写分类 | SOURCE_GATE_CLOSED_RC_PENDING | #543 merged as `9a2a696a…`; source head `ced882e1…`; Stage `32385443466`, ACV2 `32385443458`, WP-A `32385443619`, Model `32385443480` GREEN. Final packaged regression required. |
| KF-P0-11 | Adapter Ports / Facebook Worker | `platformAdapterPorts` 默认 registry 未显式闭合 Facebook egress handler | EVIDENCE_RECONCILIATION | Later Facebook Worker production closures exist; mechanically prove current physical Facebook egress ownership and registry/driver binding on fresh main. |
| KF-P0-12 | Adapter Ports / Facebook Worker | Desktop 与 Worker oauth/avatar/D1 契约版本及 `FACEBOOK_*` 错误码未强制对齐 | EVIDENCE_RECONCILIATION | Reconcile Facebook Worker contract PRs and current static/runtime contract tests; no closure from interface existence alone. |
| KF-P0-13 | Adapter Ports / Facebook Worker | `pullEvents` 一次性 lease 无续约导致长事件处理重复投递/状态延迟 | SOURCE_GATE_CLOSED_RC_PENDING | #639 merged as `347097a6…`; frozen RED `b4bab02a…`, Stage RED `32564194421`, `unknownBlockers=0`; source head `eedb4e09…` exact Stage/Layered/ACV2/WP-A/Model GREEN. Root fix adds bounded event lease renewal. Final packaged evidence pending. |
| KF-P0-14 | Identity / Person Context | Identity detach 后 `person_contact_bindings` 未同步失效 | SOURCE_GATE_CLOSED_RC_PENDING | #542 merged as `f978a4dc…`; source head `0173cba4…` adds last-usable-link contact binding detach and audited rollback. Exact executed gates must remain mapped in final ledger; packaged identity flow pending. |
| KF-P0-15 | Identity / Person Context | 再次 `observe` 可静默重新激活已 detached scope binding | SOURCE_GATE_CLOSED_RC_PENDING | #542 explicitly rejects detached-link silent re-observe and adds regression coverage. Final packaged flow pending. |
| KF-P0-16 | Identity / Person Context | `PersonContextAuthority` 读端不校验 identity_link detached/disputed 状态 | SOURCE_GATE_CLOSED_RC_PENDING | #542 requires usable identity-link status and exact conversation-binding match before context reads. Final packaged flow pending. |
| KF-P0-17 | Store truth source | Backend `customers.currentId` 与前端 active contact 双轨无显式同步 | OPEN | Must be proven closed by current authoritative Store/Product path; final audit must reject ambiguous current-contact authority and wrong-target egress. |
| KF-P0-18 | Store truth source | `SYNC_CUSTOMER_CONTEXT` 对 `conversations.byContactId` 只 push 不去重 | OPEN | Add/find causal regression and exact source closure; executed workflow evidence required. |
| KF-P0-19 | WhatsApp | `stop()` 后旧 socket 事件仍可能进入 handler，代际隔离不完整 | EVIDENCE_RECONCILIATION | Later WhatsApp generation/fencing work exists; bind exact stale-socket RED/fix/test execution before status can advance. |
| KF-P0-20 | WhatsApp | 平台接受后本地持久化失败仅返回 `localPersistenceRepair`，修复消费链未闭环 | EVIDENCE_RECONCILIATION | Later durable local-persistence-repair work is referenced by WhatsApp closures; mechanically map the repair consumer and restart/idempotency tests. |
| KF-P0-21 | WhatsApp | 物理 egress 错误码/HTTP status 不统一 | SOURCE_GATE_CLOSED_RC_PENDING | #647 immutable RED `c6cd39ca…`, Stage RED `32570813989`, `unknownBlockers=0`; #649 source head `f10a2785…` merged as `c6e1e7d8…`, structures disconnected/local/provider egress errors. Final packaged egress evidence pending. |
| KF-P0-22 | WhatsApp | `messages.upsert` 长 await 边界前后 socket generation/fence 校验不足 | EVIDENCE_RECONCILIATION | Reconcile later WhatsApp socket/execution generation fencing contracts and exact workflow execution; final real-message packaged path required. |
| KF-P0-23 | Telegram / Facebook | 跨平台 egress 公共接口签名/能力不统一 | EVIDENCE_RECONCILIATION | #653 Telegram and later Facebook/adapter work are candidate evidence; prove current canonical adapter-port contract across platforms. |
| KF-P0-24 | Telegram / Facebook | `localPersistencePending` / `localPersistenceRepair` 有契约但无自动幂等修复闭环 | EVIDENCE_RECONCILIATION | Map durable repair ownership for Telegram and Facebook separately; require terminal/restart/idempotency executed tests. |
| KF-P0-25 | Telegram / Facebook | Facebook `worker_media` 缺失时缺少传统媒体 URL fallback | OPEN | Verify current Worker/media contract on fresh main; establish causal RED if legacy/fallback path is still required by supported product behavior. |
| KF-P0-26 | Durable Execution | M2 heartbeat/succeed/fail/waitRemote/cancel/retry/deadLetter 等关键操作未实现 | EVIDENCE_RECONCILIATION | Large later WP-B/M2 work exists, but historical Draft #17 is not itself merge authority. Reconstruct the actual trusted-main implementation lineage and exact executed M2 gates before advancing. |
| KF-P0-27 | Durable Execution | `appendV2Event MAX(sequence)+1` 再 INSERT 存在并发 sequence 完整性风险 | EVIDENCE_RECONCILIATION | Inspect current schema/migrations and concurrency tests; require uniqueness/atomicity evidence on fresh main. |
| KF-P0-28 | Durable Execution | 长任务无 heartbeat 导致 lease 过期后终态操作被拒 | EVIDENCE_RECONCILIATION | Reconcile current heartbeat/renewal and long-task tests with WP-B M2 trusted-main lineage. |
| KF-P0-29 | AI Core | `aiGateway.submit` 在 `authority.start` 前失败可能让 durable operation 滞留 SCHEDULED | EVIDENCE_RECONCILIATION | Audit current terminalization paths and executed tests; every pre-start/post-acquire failure must become a durable terminal or explicitly recoverable state. |
| KF-P0-30 | AI Core | `aiBrainOrchestrator` cancel 与 succeed 存在终态竞态，缺 generation/fencing 一致性 | EVIDENCE_RECONCILIATION | Reconcile current durable analysis fencing/cancellation contracts and exact workflow execution; final restart/cancel packaged evidence required. |
| KF-P0-31 | AI Core | `contextAwareReplyBrain` / `aiGateway` / turn coordinator stale/superseded 语义不对齐 | EVIDENCE_RECONCILIATION | Audit all stale-result layers together; require new-inbound supersession test that proves stale candidate cannot persist/send. |

### P0 accounting

- imported P0 rows: **31**
- finally CLOSED: **0**
- unresolved for final release: **31**

This count is intentionally strict: `SOURCE_GATE_CLOSED_RC_PENDING` is still unresolved until the fresh final RC closes the packaged evidence layer.

## 3. Known Findings V1 — 8 explicit P1 rows

| ID | Bucket | Finding | Current state | Evidence / next closure action |
|---|---|---|---|---|
| KF-P1-01 | Frontend / Electron | Safe Mode 主要停留在 UI banner，需证明后端所有写入口真实 fail-closed | EVIDENCE_RECONCILIATION | #541/#543 strengthen backend SecurityGuard, but audit all write entrypoints and final packaged behavior before closure. |
| KF-P1-02 | Frontend / Electron | `stopApplicationOwnedRuntimes` 串行等待，单 runtime hang 可阻塞整体退出 | OPEN | Fresh-main shutdown audit and bounded per-runtime timeout test required. |
| KF-P1-03 | Dependency security / reproducibility | `@letta-ai/letta-code` 依赖 `sharp <0.35.0` 的漏洞链 | OPEN | Current dependency graph/advisory disposition required; no release with unresolved high-risk chain absent formal accepted-risk authority. |
| KF-P1-04 | Adapter Ports / Facebook Worker | WP-B execution/fencing identity 暴露在 Worker URL query | SOURCE_GATE_CLOSED_RC_PENDING | #639 removes persisted WP-B identity from URL query and moves it to signed `x-yance-wpb-*` metadata; source head `eedb4e09…` exact gates GREEN. Final packaged/log-leak evidence pending. |
| KF-P1-05 | Store truth source | `UPDATE_SELF_TYPING_STATE` 顶层 conversation/account/platform 字段可能覆盖 contact 侧最新会话 | OPEN | Establish exact state-authority regression and close in Store owning layer. |
| KF-P1-06 | Telegram / Facebook | Facebook 本地适配器退化为 Worker/Durable Authority 投影，闭环能力弱于 Telegram | EVIDENCE_RECONCILIATION | Determine intended supported authority model first; close only missing supported product behavior, not deliberately retired duplicate Graph authority. |
| KF-P1-07 | AI Core | reply generation 链过长，任一环失败导致整体失败与 deep latency 风险 | EVIDENCE_RECONCILIATION | Fresh main now has a deterministic `automatic-reply-generation-failed` branch with durable `retryable:false`; issue #533 remains open because full error-family semantics and bounded behavior need proof. |
| KF-P1-08 | AI Core | `personaBrain` 多个 `compile*` 入口并存，调用方可能混用语义 | OPEN | Fresh-main callgraph audit; converge or prove one canonical public authority plus compatibility wrappers. |

### P1 accounting

- imported explicit P1 rows: **8**
- finally CLOSED: **0**
- unresolved for final release: **8**

## 4. Fresh-main Release Audit V2 findings

These rows are independent of Known Findings V1. Do not renumber or rewrite the 8/20 baseline when new findings appear.

| ID | Severity | Finding | State | Evidence / next action |
|---|---|---|---|---|
| A2-P1-001 | P1 | AI_AUTO deterministic reply-generation failures historically re-entered the 20-attempt durable analysis retry loop (issue #533) | EVIDENCE_RECONCILIATION | Current `aiBrainOrchestrator.js` includes `automatic-reply-generation-failed` and `retryable:false` for a deterministic code set. Verify the entire issue error family, especially social-context and stale-context/profile cases, add/locate executed regression coverage, then close or create a successor causal batch. |

Additional Audit V2 findings must be appended here with immutable IDs.

## 5. Release/UAT obligations not equivalent to new source defects

| ID | Severity | Obligation | State | Required evidence |
|---|---|---|---|---|
| UAT-001 | Release blocker | Historical issue #1 — model worker SQLite-isolation source work is complete but issue explicitly requires real Windows product UAT | PACKAGED_RC_PENDING | Fold into the fresh final RC matrix: real packaged worker execution, provider request IDs, SQLite ownership/fencing, concurrent receipt integrity, classified termination paths, secret-leak scan and independent review. Do not create a duplicate source repair unless fresh RC proves a new defect. |
| UAT-002 | Release blocker | PR #538 is historical UAT only | ENFORCED | Final candidate must be recreated from fresh main in a new RC/UAT PR. No #538 artifact may satisfy final RC identity. |

## 6. Current active product line — PR #615

Last verified source head before #656 main advance: `8bf31a7480d98ddabec8b60575cdbe97940b45a6`.

At that head:

- Stage GREEN;
- Layered GREEN;
- ACV2 GREEN;
- WP-A GREEN;
- Presence / Parlant GREEN;
- Product Final frozen-element reproducibility GREEN;
- Product Final materialized Matrix UAT GREEN;
- Product Final Windows desktop job had built the trusted package and was executing the real packaged `Yance.exe` launch step.

Fresh main then advanced to #656 merge `916c93d41feb72fa622cd40e2c8c20cabf4e7d91`. Therefore #615 is **not merge-eligible without another ordinary forward-reconcile to fresh main and fresh exact-head validation** even if the prior packaged launch eventually passes.

The older Product Final failure on head `7c78dbae…`, run `32586226966`, Windows job `97062886738`, remains historical causal evidence and must not be erased.

## 7. Mandatory Executed-Test Coverage register

Every release-critical contract must eventually receive a row of this form:

| Coverage ID | Test/contract | Runner | Workflow/job | Exact head | Executed? | PASS? | Status |
|---|---|---|---|---|---|---|---|
| COV-TEMPLATE | `<test path or contract>` | `<runner invocation>` | `<workflow/job>` | `<SHA>` | yes/no | yes/no | OPEN/CLOSED |

Rules:

1. test file present != coverage;
2. test selected but skipped != PASS unless skip is the contractually correct route and documented;
3. workflow GREEN != target test executed;
4. ancestor execution != exact-head execution;
5. platform-specific behavior requires the applicable platform job to execute;
6. final RC packaging/launch assertions require the fresh RC source/package identity, not a historical candidate.

## 8. Delta Regression register

All changes after the 2026-08-20 audit through final RC must be independently scanned. Add immutable `DELTA-P0-*` / `DELTA-P1-*` rows here when discovered.

No Delta finding is currently declared CLOSED merely because its introducing PR was reviewed.

## 9. Final release counters

Current strict counters:

```text
knownFindingsP0Total=31
knownFindingsP1Total=8
knownFindingsFinalClosed=0
freshMainAuditV2Complete=false
mandatoryExecutedTestCoverageComplete=false
deltaRegressionAuditComplete=false
freshPackagedWindowsRcPass=false
releaseLedgerClosed=false
releaseReady=false
formalReleaseAuthorized=false
publishAuthorized=false
```

These values may only advance from fresh, exact, mechanically verified evidence.