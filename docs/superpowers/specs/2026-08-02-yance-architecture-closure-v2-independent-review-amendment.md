# Yance Architecture Closure V2 独立审查修订案

- 文档类型：`NORMATIVE_DESIGN_AMENDMENT`
- 修订编号：`ACV2-IRA-001`
- 对应总体设计：`docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-design.md`
- 审查基线 Head：`205292b2baa0a83222a19fc2dd1ba1de133bb78f`
- 修订日期：2026-08-02
- 状态：`APPROVED_NORMATIVE_AMENDMENT`
- 生产代码修改：`false`

## 1. 效力与优先级

本修订案关闭独立设计审查发现的公共层缺口。与原总体设计冲突时，本修订案优先；未被修改的原设计条款继续有效。

本修订案不授权 WP-A 编码。此前 sealed-export canonical path/Git 环境绕过仍是实现前 Gate 0 阻断。

## 2. 独立审查阻断与结论

初审发现以下设计级阻断：

1. 只定义了逻辑唯一权威，没有冻结 SQLite 的物理单写宿主和跨进程写入拓扑。
2. 没有完整定义外部发送、Provider 调用等不可回滚副作用与本地事务之间的崩溃窗口。
3. 业务事件账本、聊天业务内容、凭据秘密和脱敏 Evidence 的存储边界不够明确，可能导致不可重放或敏感数据越权复制。
4. 原 `CutoverAuthority` 收据同时要求“切换授权”和“旧代码删除提交”，但删除发生在切换之后，存在时序矛盾。
5. `EvidenceAuthority` 与领域权威的成功收据签发职责需要明确分离。
6. `ModelLifecycleAuthority` 的 `ProviderCredential` 命名可能与既有凭据托管权威形成第二秘密写入者。
7. 事件 schema 演进、历史增长、投影确定性和影子哈希规范尚未冻结。
8. 回复人工审核与记忆人工审批语义混在同一“HumanApproved”概念中。

以下条款为上述问题的底层设计闭环。

## 3. AuthorityWriteHost：唯一物理写宿主

### 3.1 唯一写宿主

新增架构角色 `AuthorityWriteHost`。在桌面生产形态中，它固定为 desktop-hosted backend authority process。

只有 `AuthorityWriteHost` 可以：

- 以可写模式打开主 SQLite；
- 创建或持有 `SqliteConnectionBroker`；
- 执行 `AuthorityTransactionCoordinator`；
- 追加 ledger event；
- 更新同步权威投影；
- 签发持久领域收据。

以下进程不得打开主 SQLite 可写连接：

- Electron renderer；
- model execution worker；
- channel protocol worker；
- media worker；
- UAT probe 子进程；
- 第二 backend authority process。

它们必须通过版本化 command IPC/loopback protocol 调用 `AuthorityWriteHost`。

### 3.2 跨进程所有权

进程内 singleton 不等于跨进程唯一写入者。启动时必须取得持久 authority-host ownership：

```text
authorityHostId
hostGeneration
fencingToken
ownerPid
startupNonce
acquiredAt
heartbeatAt
leaseExpiresAt
```

第二实例只能：

- 在当前 owner 有效时 fail-closed；或
- 在 lease 符合接管条件时，通过单条数据库 CAS 原子增加 `hostGeneration` 和 `fencingToken` 后接管。

旧 host 的任何后续提交必须因 generation/fencing 不匹配被拒绝。

### 3.3 SQLite 事务规则

- 网络、Provider、平台 SDK、文件下载和用户等待不得发生在 SQLite 写事务内。
- 写事务必须短小，只包含命令校验、事件追加、同步投影、checkpoint 和收据。
- `SQLITE_BUSY` 不能被解释为业务成功或自动无限重试；必须形成可诊断基础设施失败。
- WAL checkpoint、恢复和关闭只能由 `AuthorityWriteHost` 协调。
- 只读消费者优先读取 API/版本化快照；确需 SQLite 只读连接时必须登记并验证不会越过 authority boundary。

SQLite 官方文档明确 WAL 同一时刻只有一个 writer；本项目采用单写宿主，不依赖 busy timeout 充当并发控制。

## 4. ExternalActionOutbox：外部副作用的持久边界

所有不可回滚外部动作统一进入 `ExternalActionOutboxAuthority`，作为 `DurableExecutionAuthority` 的公共子边界，不允许每个调用方自行实现“先调用再补日志”。

适用范围：

- Facebook/Telegram/WhatsApp 发送；
- 平台回执查询和会话恢复动作；
- AI Provider 请求；
- OAuth/token exchange；
- 远端媒体下载或上传；
- 任何可能在本地崩溃后仍于远端完成的动作。

### 4.1 持久对象

```text
ExternalActionIntent
ExternalActionAttempt
ExternalActionReceipt
ExternalOutcomeReconciliation
```

`ExternalActionIntent` 至少包含：

```text
actionId
operationId
actionKind
traceId
localRequestId
idempotencyKey
targetAuthority
targetIdentityRef
payloadRef
payloadSha256
state
createdAt
deadlineAt
```

### 4.2 执行顺序

1. 在单一 ledger 事务内提交业务命令、operation、outbox intent 和本地 `localRequestId`。
2. COMMIT 后 dispatcher 才能用 CAS claim intent，并追加 `ATTEMPT_STARTED`。
3. 对支持幂等键的平台/Provider，必须传递稳定 `idempotencyKey`。
4. 外部响应返回后，在新事务中追加 attempt result、`remoteRequestId`、平台 message ID 和领域 receipt。
5. 如果外部动作可能已成功、但本地未持久化响应，则进入 `UNCERTAIN_REMOTE_OUTCOME`，不得盲目重发。
6. `UNCERTAIN_REMOTE_OUTCOME` 必须执行 `queryReceipt`、远端幂等查询或人工 reconciliation，最终收敛到成功、失败、取消或 dead-letter。

### 4.3 禁止事项

- 禁止把“HTTP 200 已收到”自动等同于业务 delivered/read。
- 禁止在外部调用前只写内存状态。
- 禁止在结果未知时通过扩大重试次数解决。
- 禁止没有稳定幂等键或收据查询能力时自动重复执行高风险动作。

Temporal 官方资料确认 Activity 采用 at-least-once 模型：worker 在外部动作成功后、通知服务前崩溃会导致重试。因此 Yance 必须将 intent、attempt、receipt 和 uncertain reconciliation 显式持久化。

## 5. 账本、业务内容、秘密与 Evidence 的数据边界

### 5.1 四类数据

所有 command/event 字段必须声明数据分类：

```text
PUBLIC_METADATA
BUSINESS_CONTENT
SECRET_REFERENCE
BINARY_REFERENCE
```

- `PUBLIC_METADATA`：ID、状态、时间、reason code、版本、hash。
- `BUSINESS_CONTENT`：消息文本、人工批准的发送文本、结构化联系人事实；允许进入业务权威存储，但不得复制到治理 Evidence。
- `SECRET_REFERENCE`：只保存凭据引用、generation、vault receipt；不得保存 API Key、Cookie、Token、QR 或会话秘密。
- `BINARY_REFERENCE`：只保存受管文件引用、hash、大小、mime 和生命周期，不在 ledger/Evidence 内嵌二进制。

### 5.2 CanonicalEventHeader 与 AuthorityPayloadStore

单一业务事实由同一事务中的两部分组成：

```text
CanonicalEventHeader
AuthorityPayloadStore row
```

`CanonicalEventHeader` 保存可审计、可索引、追加式元数据和 `payloadRef/payloadSha256`。

`AuthorityPayloadStore` 保存重放所需的最小业务 payload：

- 与 event 一一绑定；
- 同一 SQLite 事务提交；
- 按字段分类和保留策略加密；
- 不允许独立业务写入；
- UPDATE/DELETE 仅能通过版本化保留/归档协议；
- payload hash 必须与 header 一致。

该拆分不是第二事实权威，而是单一 ledger event 的受管 payload segment。

### 5.3 EvidenceAuthority 的边界

`EvidenceAuthority` 只记录：

- trace/observation 关联；
- receipt ID；
- authority、版本、状态、reason code；
- hash、计数和脱敏摘要。

它不得复制业务消息全文，也不得签发通信、模型、发送、联系人或学习的领域成功收据。

## 6. 收据签发者唯一化

收据由拥有该事实的领域权威签发：

| 收据 | 唯一签发者 |
|---|---|
| AccountIdentityReceipt | CommunicationAuthority |
| DeliveryReceipt | CommunicationAuthority |
| OperationTerminalReceipt | DurableExecutionAuthority |
| ModelQualificationReceipt | ModelLifecycleAuthority |
| RelationshipDecisionReceipt | ContactRelationshipAuthority |
| MemoryLifecycleReceipt | AIReplyLearningAuthority |
| CredentialMutationReceipt | CredentialCustodyAuthority |
| ReadCutoverAuthorizationReceipt | CutoverAuthority |
| LegacyRemovalClosureReceipt | CutoverAuthority |

`EvidenceAuthority` 只能引用这些收据，不得重新解释或覆盖其终态。

## 7. 凭据托管与 ModelLifecycle 的边界

既有 credential custody/secure bridge 是秘密材料的唯一托管边界。V2 将原 `ProviderCredential` 改名为：

```text
ProviderCredentialBinding
```

`ModelLifecycleAuthority` 只拥有：

- credentialRef；
- provider/account scope；
- vault generation；
- credential capability metadata；
- last verification receipt；
- revoked/active binding state。

API Key、OAuth refresh token、Cookie、session secret 和二维码材料只能由 `CredentialCustodyAuthority` 持有和变更。

模型连接验证通过受控 capability 调用读取秘密，不把秘密复制到模型注册表、ledger payload 或 Evidence。

## 8. 两阶段 Cutover 与旧权威删除

原单一 cutover receipt 拆为两个不可变收据。

### 8.1 ReadCutoverAuthorizationReceipt

在生产读取切换前签发，必须包含：

- bounded context；
- ledger range；
- 样本和场景覆盖；
- 连续零 mismatch 窗口；
- replay hash；
- failure injection；
- restart/takeover；
- projection lag；
- 旧 writer/recovery/fallback 完整 inventory；
- reviewer approvals；
- 可执行 rollback window。

该收据只授权读取切换，不宣布旧权威已删除。

### 8.2 LegacyRemovalClosureReceipt

读取切换后经过稳定窗口，完成以下条件才可签发：

- 旧 writer 删除提交；
- 旧 recovery 删除提交；
- 旧 fallback 删除提交；
- 静态扫描和运行时探针证明无旁路；
- 从 ledger 全量重放一致；
- 切换后故障注入和重启恢复通过；
- 独立复审批准。

只有第二收据签发后，该 bounded context 才能标记 `CLOSED`。

切换前/稳定窗口内允许回退读取投影，但不得恢复双写；旧权威删除后只允许从 ledger roll-forward，不得复活旧 writer。

## 9. Event Schema、重放和历史增长

WP-A 必须建立 `EventTypeRegistry`：

```text
eventType
schemaVersion
aggregateType
payloadSchema
classificationSchema
canonicalizationVersion
upcasterChain
projectionCompatibility
retentionClass
```

强制规则：

- 已提交事件不可原地改写。
- 新 projection 必须能通过注册的 upcaster 读取历史事件。
- upcaster 必须纯函数、确定性、无网络和当前时间依赖。
- 所有 hash 使用版本化 canonical serialization；对象键序、空值、时间、数字和集合排序规则固定。
- projection checkpoint 记录 ledger sequence、projector version 和 output hash。
- shadow comparison 排除明确登记的非语义字段，禁止临时忽略 mismatch。

为控制长期历史增长：

- durable execution 支持版本化 checkpoint/continue-as-new 等价机制；
- ledger 支持不可变 segment、snapshot 和 hash-chain archive；
- 归档不能破坏审计链和重放证明；
- 当前生产重放所需事件在生成并验证 snapshot 前不得删除或降级。

## 10. Lease、时钟跳变与 fencing

`leaseExpiresAt` 只决定“是否允许发起接管”，不证明 owner 仍有提交权。

真正的提交权只由以下组合决定：

```text
hostGeneration / operationGeneration
+ fencingToken
+ ownerId
+ expectedState
```

接管必须单条 CAS 增加 generation/token。即使系统时钟前跳导致提前接管，旧 owner 也必须被新 token 拒绝；时钟后跳不得延长旧 token 的提交资格。

所有 clock anomaly 形成 Evidence observation 和诊断状态。

## 11. 回复审核与记忆审批分离

学习链存在两个不同人工动作：

1. `ReplyApprovalReceipt`：批准具体候选文本用于真实平台发送。
2. `MemoryApprovalReceipt`：批准已满足发送回执条件的 PendingMemory 进入 Shadow。

修订后的状态：

```text
ObservedFact
  → PendingMemory
  → MemoryApproved
  → Shadow
  → Active
  → Revoked / Superseded
```

创建 `PendingMemory` 的前置“人工审核通过”专指 `ReplyApprovalReceipt`，不等同于 `MemoryApprovalReceipt`。

## 12. ShadowComparator 的确定性规范

每个 bounded context 必须登记：

- semantic projection schema；
- canonicalization version；
- excluded non-semantic fields；
- ordering rules；
- scenario bucket；
- expected cardinality；
- ledger sequence range；
- legacy/new projection hash；
- mismatch reason code。

时间戳、随机 ID、局部缓存路径等字段只有经过设计登记才可排除。测试临时 mask 字段视为门禁违规。

## 13. 工作包修订

### WP-A 新增

- `AuthorityWriteHost` 与跨进程 ownership/fencing；
- `AuthorityPayloadStore` 和数据分类；
- `EventTypeRegistry`、upcaster、canonical serialization；
- 未授权 SQLite writer 静态与运行时阻断。

### WP-B 新增

- `ExternalActionOutboxAuthority`；
- `UNCERTAIN_REMOTE_OUTCOME` reconciliation；
- durable history checkpoint/continue-as-new 等价机制。

### WP-D 修订

- `ProviderCredentialBinding` 只引用 `CredentialCustodyAuthority`，不持有秘密。

### WP-E 修订

- Evidence 只索引领域收据，不签发领域事实。

### WP-F 修订

- Reply approval 与 Memory approval 分离。

### WP-G 修订

- 使用 `ReadCutoverAuthorizationReceipt` 和 `LegacyRemovalClosureReceipt` 两阶段闭环。

## 14. 修订后设计审查结论

上述条款关闭初审设计阻断。Architecture Closure V2 在设计层可进入“独立审查批准”状态，但仍受以下实现前阻断约束：

```text
GATE0-SEALED-EXPORT-CANONICAL-PATH = OPEN
productionCodeChangesAllowed = false
wpAImplementationAllowed = false
```

在该 Gate 0 缺陷完成公共治理层修复并通过独立复审前，不得开始 WP-A 生产代码实现。