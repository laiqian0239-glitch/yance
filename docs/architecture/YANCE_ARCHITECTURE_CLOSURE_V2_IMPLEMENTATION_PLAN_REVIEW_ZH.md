# Yance Architecture Closure V2 独立实施计划审查报告

- 审查类型：`INDEPENDENT_IMPLEMENTATION_PLAN_REVIEW`
- 审查日期：2026-08-02
- 仓库：`laiqian0239-glitch/yance`
- PR：#4
- PR 状态要求：`DRAFT`
- 审查基线 Head：`cc086cdc4b6a52fc960eb2cd5fa9f741918d2a09`
- 总体实施计划提交：`8345527df1567d692ebf26ab1344cbac53475cc8`
- 规范性计划修订提交：`c2883ee8b2f2e71a88f62ec5c2ea0edbd037e3f3`
- 生产代码修改：`false`
- 最终结论：`APPROVED_AFTER_NORMATIVE_AMENDMENT`
- 获准实施范围：`WP-A_ONLY`
- Gate 1：`NOT_AUTHORIZED`

## 1. 审查范围

本轮只审查 Architecture Closure V2 的实施计划是否可以在不依赖实现人员临场架构决策的前提下执行。审查不把计划文档、WP0 成功或已有 FIX6M 测试解释为业务重构已经完成。

审查对象：

- `docs/superpowers/plans/2026-08-02-yance-architecture-closure-v2-implementation.md`
- `docs/superpowers/plans/2026-08-02-yance-architecture-closure-v2-implementation-amendment-1.md`
- 已批准总体设计与根因迁移矩阵
- 当前生产组合、SQLite broker/ownership、事件、Durable Execution、Communication、Shadow Gate 源码
- 当前 Schema 19/20 迁移和测试入口
- SQLite 与 Temporal 官方资料中的并发、事务、历史、重放和外部动作不变量

## 2. 当前源码事实复核

### 2.1 生产入口仍是旧组合

`backend/runtime/AppRuntimeComposition.js` 仍直接组合 `accountManager`、`messageStore`、`sendQueueService`、`platformMessagingService`、旧 recovery/projection 等。`backend/server.js` 在统一写宿主和事务协调器成为生产入口前，仍执行 interrupted sync/background job recovery、账号 canonicalization、send queue、AI outbox 等旧路径。

因此计划必须先建立 WP-A 的物理写宿主、账本和命令事务边界，再允许 WP-B/C 迁移外部动作和通信；不能反向先包一层 adapter 或 dual-write。

### 2.2 SQLite 当前只有部分所有权基础

`SqliteConnectionBroker` 的 singleton 只限制单进程第二 broker。`sqliteOwnership` 已有跨进程 sidecar、PID identity、heartbeat、stale takeover 等基础，但尚未把数据库 host generation/fencing 绑定到每个业务事务。计划将 sidecar 定位为启动排他/崩溃检测，把数据库 lease/generation/token 定位为提交权，方向正确。

### 2.3 当前事件服务不是统一事务入口

`domainEventLogService.js` 直接通过 repository 查询和追加，schema 固定为 1，payload 直接脱敏存储，且事件、权威 projection、checkpoint、command receipt 没有统一 coordinator 事务。计划明确升级为唯一 `CanonicalEventLedgerAuthority`，旧模块只保留无持久逻辑的兼容 facade，符合“原地升级、禁止第二账本”。

### 2.4 Durable Execution 当前不是数据库 CAS

`durableExecutionAuthority.js` 先读 row，在应用层校验 state/generation/owner，然后按 `execution_id` 无条件更新。计划要求 WP-B 使用 execution ID + generation + owner + fencing token + allowed state 的单条 SQL CAS，并把 external action intent/attempt/receipt/reconciliation 纳入公共层，关闭了核心竞争窗口。

### 2.5 Communication 和 Shadow 仍未达到切换合同

`communicationAuthority.js` 当前直接写 FIX6M 表，尚未由 coordinator/ledger 驱动，也未成为三平台唯一生产入口。`architectureShadowGate.js` 主要检查样本数和 hash mismatch。计划将兼容表限定为 ledger projector，并在 WP-G 强制 scenario、连续窗口、lag、failure injection、restart/takeover、read cutover receipt 和 legacy deletion receipt，符合批准设计。

## 3. 外部参考核验

### SQLite

官方事务和 WAL 文档证明：事务边界必须明确；WAL 允许并发读取但同一时刻仍只有一个 writer；busy 处理不能提供业务层 owner/fencing。计划采用一个物理写宿主、短事务、数据库 generation/token 和 fail-closed busy 诊断，不依赖 `busy_timeout` 作为串行化。

官方来源：

- https://sqlite.org/lang_transaction.html
- https://sqlite.org/wal.html
- https://sqlite.org/backup.html

### Temporal

官方 Event History、Activity、safe deployment/versioning 资料证明：持久历史和确定性重放、稳定 idempotency、heartbeat/async completion、版本化变更是 durable execution 的关键不变量。计划只提取这些模式并在 Yance SQLite 公共层实现，不引入 Temporal 服务或复制其运行时。

官方来源：

- https://docs.temporal.io/encyclopedia/event-history
- https://docs.temporal.io/activity-definition
- https://docs.temporal.io/develop/safe-deployments

其他参考项目不作为未经官方资料证明的运行时事实来源；Yance 冻结设计和失败测试是实现权威。

## 4. 初审发现与处理

| ID | 级别 | 初审问题 | 风险 | 处理结果 |
|---|---|---|---|---|
| IPR-P0-01 | P0 | Schema 21 host lease 与“先取得 host 再迁移”存在 bootstrap 顺序空白 | 第二进程或部分初始化进程可能在 lease 权威建立前进入正常迁移/恢复 | 修订固定 sidecar → restricted DB bootstrap → lease CAS → normal migrations → recovery/readiness 顺序 |
| IPR-P0-02 | P0 | 只禁止非 Host 可写 broker，未完全禁止 live primary DB 的 read-only 直连 | worker/utility 仍可接触 WAL/SHM 或绕过 API/投影合同 | 修订要求非 Host 不得打开 live primary DB；只读通过 host API 或 verified immutable snapshot |
| IPR-P1-01 | P1 | “事务内禁止外部 I/O”缺少运行时机制 | 调用方可无意把 provider/platform/file wait 放入写事务 | 修订增加 AsyncLocalStorage transaction context、外部边界 guard、静态扫描和 adversarial tests |
| IPR-P1-02 | P1 | 单 WP 授权和 predecessor Head 只在文字中描述 | 分支可能从错误 Head 创建或一次解锁多个 WP | 修订要求 machine-readable authorization manifest、单 WP scope、base/parent 校验 |
| IPR-P1-03 | P1 | 兼容 projector 的 checkpoint/CAS/lag/backpressure 不完整 | 可能跳序、重复或以 legacy writer 追平 | 修订增加 projector lease/generation/CAS、连续 lag gate、禁止 fallback writer |
| IPR-P1-04 | P1 | Schema 21 验证矩阵不完整 | clean install 可过而升级/中断/降级损坏 | 修订增加 clean、20→21、idempotency、checksum、crash、backup、downgrade、replay 全矩阵 |

全部发现已通过 `ACV2-IPA-001` 关闭。

## 5. 修订后独立复核

### 5.1 任务可执行性

通过。WP-A 每项任务包含具体文件、RED 不变量、实现边界、命令和退出证据。WP-B 至 WP-H 具有明确入口/退出门禁和不可越序依赖，不要求实现人员自行选择第二权威、双写或 fallback 策略。

### 5.2 单写宿主与启动顺序

通过。计划现在区分：

- sidecar：启动排他与崩溃检测；
- restricted bootstrap capability：只建立/验证 host lease 并执行注册迁移；
- DB host generation/fencing：唯一提交权；
- broker/coordinator：承载后续业务事务。

业务恢复、projector、route、worker 和 readiness 均在 host capability 与迁移成功后启动。

### 5.3 主库访问边界

通过。非 Host 进程既不能写，也不能直接读取 live primary WAL 数据库。查询通过版本化 API；离线用途使用带 ledger sequence/hash/expiry 的 immutable snapshot。这避免把“只读连接”变成未登记的数据库权威或 SHM/WAL 耦合。

### 5.4 事务与外部动作

通过。WP-A 建立可执行的 transaction context/guard；WP-B 建立 intent/attempt/receipt/reconciliation。网络、SDK、文件传输和用户等待不在 SQLite 写事务中。不确定远端结果禁止盲重试。

### 5.5 无双写迁移

通过。计划规定：先禁用 bounded context 的直接 legacy writer，再启用 canonical command；旧表只能由 committed ledger compatibility projector 更新。Projector 有 sequence/version/generation/fencing/CAS，不能被调用方 dual-write 或失败时回退到旧 writer。

### 5.6 分支和审查隔离

通过。PR #4 保持 Draft 治理锚点；每个 WP 使用 stacked Draft PR，仅显示当前 bounded work package diff。单 WP authorization manifest 防止自动解锁 WP-B-H。

`approvedParentHead` 记录最后一个不含生产实现的批准治理 Head。授权记录提交本身是该 Head 的直接后继；WP-A 分支必须从包含有效授权记录的当前治理 Head 创建，并验证其父提交等于 `approvedParentHead`。该规则避免自引用 commit SHA，同时保持父 Head 和授权文件均可验证。

### 5.7 真实环境边界

通过。Source review、mock、测试数量和 UI green 不能替代 WP-H real Windows、WhatsApp、Telegram、Facebook 和真实 provider evidence。WP-H 完成后仍需单独发布治理授权。

## 6. 工作包覆盖核验

| 设计不变量 | 计划归属 | 结论 |
|---|---|---|
| 一个物理 SQLite 写宿主 | WP-A A1/A6 + 修订 3/4 | COVERED |
| 一个 command/ledger transaction | WP-A A3/A4 | COVERED |
| payload/classification/schema/replay/archive | WP-A A2/A4/A7 | COVERED |
| durable CAS/lease/deadline/cancel | WP-B B1/B5 | COVERED |
| external intent/attempt/receipt/reconciliation | WP-B B2/B3/B4 | COVERED |
| canonical communication/three adapters | WP-C C1–C6 | COVERED |
| credential custody/model lifecycle separation | WP-D D1–D4 | COVERED |
| evidence non-domain issuer | WP-E E1–E4 | COVERED |
| reply approval/memory approval separation | WP-F F2–F4 | COVERED |
| read cutover vs legacy removal receipts | WP-G G1–G5 | COVERED |
| delete writer/recovery/fallback | WP-G G4–G6 | COVERED |
| real Windows/three platforms/providers | WP-H H1–H4 | COVERED |

## 7. Final Conclusion

```text
implementationPlanReview=APPROVED_AFTER_NORMATIVE_AMENDMENT
implementationPlanClosed=true
currentAuthorizedWorkPackage=WP-A
productionCodeChangesAllowed=WP_A_ONLY
wpAImplementationAllowed=true
wpBThroughWpHImplementationAllowed=false
gate1MayStart=false
pr4MustRemainDraft=true
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

The approval authorizes only:

```text
create WP-A stacked Draft branch
→ add WP-A RED tests and writer inventory
→ implement WP-A task-by-task after RED evidence
→ run WP-A Windows/Ubuntu matrices
→ independent WP-A source review
```

It does not authorize WP-B, Gate 1, candidate packaging, PR #4 readiness/merge, promotion, or release.

## 8. First Authorized WP-A Action

The first implementation action must be Task A0, not `AuthorityWriteHost` production code:

1. create the authorized WP-A branch from the governance Head containing the authorization manifest;
2. freeze writer/read/recovery/fallback inventory;
3. add failing source-closure tests;
4. obtain a RED workflow run;
5. only then begin Task A1 production refactoring.
