# Yance Architecture Closure V2 根因迁移矩阵修订 1

- 文档类型：`NORMATIVE_MATRIX_AMENDMENT`
- 修订编号：`ACV2-MA-001`
- 基础矩阵：`docs/architecture/YANCE_ARCHITECTURE_CLOSURE_V2_ROOT_CAUSE_MIGRATION_MATRIX_ZH.md`
- 对应设计修订：`docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-independent-review-amendment.md`
- 审查基线 Head：`205292b2baa0a83222a19fc2dd1ba1de133bb78f`
- 状态：`APPROVED_NORMATIVE_AMENDMENT`

## 使用规则

本文件新增的矩阵行是基础矩阵的强制组成部分。任何工作包未关闭本修订对应行，不得签发 cutover 或 closure 收据。

## A. 单写宿主、账本 payload 与 schema 演进

| ID | 业务事实/边界 | 当前根因 | 目标公共层 | 迁移路径 | 强制失败测试 | 删除/关闭条件 |
|---|---|---|---|---|---|---|
| A-11 | 主 SQLite 物理写宿主 | `SqliteConnectionBroker` 仅保证单进程 singleton；第二 backend/utility process 仍可能成为另一个写 owner | `AuthorityWriteHost` | desktop-hosted backend 取得持久 host generation/fencing；其他进程通过 command IPC | 双 backend 并发启动、owner 强杀、旧 owner 晚到提交、renderer/worker 直接开库 | 主库可写连接只来自当前 host generation；未授权 writer 静态和运行时清零 |
| A-12 | SQLite 写事务规则 | 网络调用或长操作若进入事务，会扩大 WAL 写锁和 `SQLITE_BUSY` 风险 | `AuthorityTransactionCoordinator` | 事务只做 event、同步 projection、checkpoint、receipt；外部动作移出事务 | 注入慢 Provider/SDK 时数据库写事务时长不增长；busy 不被吞掉 | 所有 command handler 无网络/文件等待；事务时长与 busy 指标可观测 |
| A-13 | 业务 event payload | 全量脱敏可能破坏重放；聊天全文进入 Evidence 又会越权复制 | `CanonicalEventHeader` + `AuthorityPayloadStore` | 同事务保存 header、payloadRef、hash 和分类化 payload | 删除投影后从 ledger/payload 全量重放；Evidence 不含正文/秘密 | payload 与 header hash 一致；无第二业务写入口；分类/加密/保留门禁通过 |
| A-14 | 数据分类 | 消息、secret、binary、metadata 边界未统一 | `DataClassificationRegistry` | 每个 event schema 声明 PUBLIC_METADATA/BUSINESS_CONTENT/SECRET_REFERENCE/BINARY_REFERENCE | secret 扫描、正文 Evidence 泄漏、binary 内嵌、未分类字段 | 未分类字段 fail-closed；凭据和二进制不进入 ledger/Evidence 正文 |
| A-15 | Event schema 演进 | 历史事件不可安全升级，projection 可能依赖当前代码隐式解析 | `EventTypeRegistry` + deterministic upcasters | 注册 eventType/schema/canonicalization/upcaster/projection compatibility | 使用旧 schema 数据在新版本重放；upcaster 随机/时间/网络依赖被拒绝 | 所有历史 event 可确定性读取；无原地 UPDATE 历史事件 |
| A-16 | Ledger 历史增长 | append-only history 无界增长，可能拖垮桌面 SQLite | `LedgerSegmentArchive` + verified snapshots | 不可变 segment、hash chain、snapshot、归档索引 | 长时间运行、断电归档、snapshot 损坏、跨版本重放 | 当前重放需求不丢失；archive hash 可验证；损坏 fail-closed |

## B. 外部动作、unknown 与 durable history

| ID | 异步事实/边界 | 当前根因 | 目标公共层 | 迁移路径 | 强制失败测试 | 关闭条件 |
|---|---|---|---|---|---|---|
| B-13 | 外部动作 intent | 本地事务与远端副作用无法同一事务，崩溃窗口未统一 | `ExternalActionOutboxAuthority` | command transaction 同时创建 operation 和 intent；COMMIT 后 dispatcher claim | intent 提交后进程强杀；未提交事务不得发出远端动作 | 无“远端已调用但本地无 intent”；dispatcher 只消费已提交 intent |
| B-14 | 外部动作 attempt | 每个服务自行调用 Provider/平台并补写日志 | `ExternalActionAttempt` | CAS claim、ATTEMPT_STARTED、稳定 localRequestId/idempotencyKey、结果事务 | worker 在调用前/调用中/调用后各强杀一次 | 每次物理调用有唯一 attempt；旧 owner/duplicate dispatcher 被拒绝 |
| B-15 | 不确定远端结果 | 远端可能成功而本地未收到/未持久化响应，盲重试会重复发送 | `UNCERTAIN_REMOTE_OUTCOME` + reconciliation | queryReceipt、远端幂等查询或人工决策后收敛 | 发送成功后在 receipt commit 前强杀；Provider 超时但远端完成 | 未确认 absent 前不得自动重发；最终有 terminal/reconciliation receipt |
| B-16 | 外部动作收据 | HTTP 成功、provider accepted、delivered/read 被混用 | 领域 `ExternalActionReceipt` | 领域权威按能力分层签发 accepted/delivered/read/failure | 200 无平台 ID、晚到失败、重复 callback、逆序 receipt | UI/学习/后续动作引用真实领域 receipt；状态单调收敛 |
| B-17 | Durable history 滚动 | operation history 长期增长且没有版本化 checkpoint | `ExecutionCheckpoint` / continue-as-new 等价机制 | terminal segment 或安全 checkpoint 后建立新 generation/run | 超长同步、长期 polling、checkpoint 崩溃恢复 | 新 run 能从验证过的 checkpoint 继续；旧 history hash 可追溯 |
| B-18 | Lease 与时钟跳变 | `leaseExpiresAt` 可能因时钟前后跳误判 owner | generation/fencing-first lease | expiry 只允许发起 takeover；提交权由 generation/token/CAS 决定 | 时钟前跳、后跳、休眠恢复、双 owner 并发提交 | 至多一个 token 可提交；clock anomaly 有诊断和 Evidence |

## D. 凭据与模型生命周期

| ID | 生命周期事实 | 当前根因 | 目标公共层 | 迁移路径 | 强制失败测试 | 关闭条件 |
|---|---|---|---|---|---|---|
| D-11 | Provider credential secret | `ProviderCredential` 若由 ModelLifecycle 持有会形成第二秘密权威 | `CredentialCustodyAuthority` | secret 继续留在 vault/custody；模型侧只保存 binding/reference | API Key、refresh token、cookie、session secret 泄漏扫描 | 模型表、ledger payload、Evidence 均无秘密材料 |
| D-12 | ProviderCredentialBinding | credential ref、scope、generation、验证结果未形成独立生命周期 | `ModelLifecycleAuthority` | 保存 ref/scope/vault generation/verification receipt/revocation state | vault generation 变化、credential revoke、旧 binding 调用 | 旧 generation fail-closed；连接验证只通过受控 secret capability |

## E. Evidence 与领域收据

| ID | 证据事实 | 当前根因 | 目标公共层 | 迁移路径 | 强制失败测试 | 关闭条件 |
|---|---|---|---|---|---|---|
| E-11 | 领域成功收据签发 | Evidence 若能签发或重解释领域成功，会成为并行权威 | 领域 authority issuer registry | 每种 receipt 固定 issuer；Evidence 只保存 receipt reference/hash | 伪造 Evidence observation 试图把失败改成功 | 业务终态只读取领域 receipt；Evidence 无覆盖接口 |
| E-12 | 业务正文隔离 | trace 方便查询可能诱导复制聊天全文或 prompt | Evidence redaction/classification gate | 只保存 ID、状态、reason、hash、计数和批准摘要 | 全链路 secret/PII/content leakage test | Evidence 查询不返回聊天全文、API Key、QR、Cookie、二进制 |

## F. Memory 与人工审批

| ID | 学习事实 | 当前根因 | 目标公共层 | 迁移路径 | 强制失败测试 | 关闭条件 |
|---|---|---|---|---|---|---|
| F-11 | 回复人工审核 | 批准发送文本与批准长期记忆语义混用 | `ReplyApprovalReceipt` | 候选冻结后单独批准真实发送 | 未批准候选发送、批准后文本被修改 | 发送 attempt 引用冻结文本 hash 和 ReplyApprovalReceipt |
| F-12 | 记忆人工审批 | PendingMemory 的 memory governance approval 不明确 | `MemoryApprovalReceipt` | 平台成功 receipt 后创建 pending；再由 memory review 进入 shadow | 回复批准但记忆未批准、发送失败、unknown receipt | 只有 MemoryApprovalReceipt 可进入 Shadow；两类审批不可互换 |

## G. 两阶段切换与删除

| ID | 切换/关闭事实 | 当前根因 | 目标公共层 | 迁移路径 | 强制失败测试 | 关闭条件 |
|---|---|---|---|---|---|---|
| G-11 | 读取切换授权 | 原收据要求尚未发生的删除 commit，时序矛盾 | `ReadCutoverAuthorizationReceipt` | shadow/replay/failure/restart/coverage 全通过后签发并授权 read switch | 缺样本、mask mismatch、未覆盖故障、projection lag 超限 | 只有有效授权收据可切换；不宣称 legacy 已删除 |
| G-12 | 旧权威删除闭环 | 切换成功可能长期保留 writer/recovery/fallback | `LegacyRemovalClosureReceipt` | 稳定窗口后删除旧路径，附删除 commit 和运行时探针 | 隐藏 fallback、反射调用、旧恢复定时器、feature flag 复活 | writer/recovery/fallback inventory=0；第二收据签发后才 CLOSED |
| G-13 | 回滚策略 | 回滚读取可能误恢复双写或复活旧 writer | Cutover rollback policy | 删除前仅切换 projection；删除后只允许 ledger roll-forward | 切换后故障、删除后故障、旧 schema 客户端 | 任何回滚不产生双写；旧 writer 删除后不可重新启用 |

## H. 真实环境新增验收

| ID | 场景 | 验证目标 | 通过条件 |
|---|---|---|---|
| H-11 | 双 backend authority process | 跨进程单写宿主与接管 | 有效 owner 存在时第二实例 fail-closed；接管后旧 token 全部拒绝 |
| H-12 | SQLite WAL writer contention | 不以 busy timeout 替代架构串行 | 正常业务写只有 AuthorityWriteHost；意外竞争产生明确 fail/diagnostic |
| H-13 | 外部动作成功后本地强杀 | uncertain outcome 收敛 | 不重复发送/扣费；通过 receipt query 或人工 reconciliation 终结 |
| H-14 | Ledger/payload 全量重放 | 业务内容边界与 schema 演进 | 新空库从 ledger+payload 恢复一致 projection hash |
| H-15 | 长期 history/archive | 历史增长控制与损坏恢复 | segment/snapshot hash 可验；损坏阻断，不静默跳过 |

## 最终修订门禁

以下任一为 false，Architecture Closure V2 不得进入 bounded-context cutover：

```text
authorityWriteHostExclusive
externalActionOutboxComplete
uncertainOutcomeReconciliationComplete
ledgerPayloadReplayable
credentialCustodySingleWriter
receiptIssuerUnique
eventSchemaEvolutionVerified
shadowCanonicalizationVersioned
readCutoverAuthorizationReceiptValid
legacyRemovalClosureReceiptValid
```
