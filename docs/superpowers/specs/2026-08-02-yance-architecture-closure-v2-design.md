# Yance Architecture Closure V2 总体设计

- 文档状态：`FROZEN_FOR_INDEPENDENT_REVIEW`
- 设计基线：PR #4
- 基线分支：`rebuild/windows-release-closure-20260802-gate0-wp0-fix`
- 基线 Head：`15e538a6c26817b3cb8422fa3739f01256ec109e`
- 设计日期：2026-08-02
- 允许开始实现：`false`
- `gate1MayStart=false`
- `readyForPromotion=false`
- `formalRelease=false`

## 1. 决策摘要

Yance Architecture Closure V2 不继续围绕单个失败点增加补丁、参数、布尔开关或调用方自律。目标是把长期存在的多权威、双写、进程内状态、晚到结果、unknown 不收敛和证据断链问题统一收口到公共层。

本设计冻结以下核心决策：

1. 一个业务事实只能由一个公共权威接受命令并签发领域事件。
2. 外部事件和用户命令只进入一次 `CanonicalEventLedgerAuthority`；旧模型和新模型只能作为该账本的投影，不得各自写一份事实。
3. 现有 `DomainEventLogAuthority` 是唯一事件账本的重构起点，不新建并行第二账本。
4. `eventBus` 只能发送提交后的通知，不得成为事实来源、恢复依据或 exactly-once 保证。
5. 所有长操作必须进入 `DurableExecutionAuthority`，包含完整持久生命周期、generation、owner、lease、heartbeat、deadline、远端请求、取消收据和追加式历史。
6. Adapter 只处理认证和协议转换，不能直接写联系人、会话、消息、AI、重试、学习或 UI 状态。
7. 模型“可连接、可发现、具备能力、smoke 通过、正式合格、角色合格、冠军、生产绑定、运行健康”是不同事实，分别由 `ModelLifecycleAuthority` 管理。
8. `EvidenceAuthority` 只记录脱敏关联信息和不可变收据，不复制聊天正文、提示词、API Key、Cookie、QR、Token 或二进制。
9. 学习候选只能在人工审核通过且真实平台成功回执确认后创建；检索必须记录所用记忆 ID、版本和作用域。
10. 影子阶段必须有足够样本、场景覆盖、连续窗口零不一致、故障注入、重启恢复和旧写入者删除证据；不能仅凭测试数量或“没有发现问题”切换。
11. 旧权威迁移完成后必须删除写入口、恢复逻辑和 fallback；禁止长期双权威。
12. 真实 Windows 和三平台 UAT 完成前，不得宣布生产闭环。

## 2. 当前根因

FIX6M 已建立 `CommunicationAuthority`、`DurableExecutionAuthority`、`EvidenceAuthority`、`ChannelAdapterContract`、`ContactRelationshipAuthority`、`AIReplyLearningAuthority` 及 Schema 19 表，但当前仍处于影子阶段：

- 新权威没有成为 `AppRuntimeComposition` 的统一生产入口；
- `accountManager`、`accountRepository`、`messageStore`、`platformMessagingService`、`sendQueueService`、`syncCheckpointService`、`backgroundJobAuthority`、`platformCoreRepository` 等仍保留业务写入和恢复能力；
- 旧设计包含“dual-write”描述，可能将迁移误实现为两个事实写入者；
- `ArchitectureShadowGate` 当前主要依据样本数和哈希相等，未强制场景覆盖、连续时间窗口、失败注入、重启恢复、读取切换收据及旧写入者删除；
- `DurableExecutionAuthority` 已有 generation/owner/history，但缺少统一的 lease 到期接管、deadline、remoteRequestId、cancellationReceipt 和所有生产长操作的强制接入；
- `CommunicationAuthority` 已建立消息、媒体、发送 attempt/receipt、sync checkpoint，但账号、外部身份、联系人、会话和真实三平台生产读写仍未完全收口；
- 模型领域仍由多个服务分别维护目录、能力、smoke、资格、角色、冠军、路由和运行时健康；
- `AIExecutionTraceAuthority`、`modelExecutionEvidenceStore`、诊断日志和 `EvidenceAuthority` 仍有并行证据来源；
- 联系人、关系、旧 learning profile 与 FIX6M 新表仍存在并行投影和更新入口。

因此，FIX6M 是公共结构雏形，不是生产权威切换完成。

## 3. 设计原则

### 3.1 单一事实写入

任何业务事实必须在权威注册表中明确：

- authority owner；
- command entrypoint；
- transaction boundary；
- event type；
- idempotency key；
- aggregate/version；
- success receipt issuer；
- read model；
- legacy writer removal condition。

未登记的直接表写入一律视为架构违规。

### 3.2 事件是事实，投影可重建

```text
平台事件 / 用户命令 / 远端回调
        ↓
CanonicalCommandEnvelope
        ↓
AuthorityTransactionCoordinator
        ↓
CanonicalEventLedgerAuthority（唯一追加）
        ↓
权威同步投影 + 旧 UI 兼容投影 + 影子比较
```

- 账本事件为不可变事实。
- 权威同步投影可在同一 SQLite 事务内更新，用于立即一致读取。
- 旧 UI 投影和分析投影可异步更新，但必须有 durable checkpoint。
- 投影失败不得反向修改账本。
- 投影可从账本重放并校验最终哈希。

### 3.3 失败恢复优先于重试

重试只是持久状态机中的一个状态，不得替代恢复设计。任何 operation 都必须明确：

- 进程退出后从哪里恢复；
- 谁能接管；
- 旧 owner 如何被 fencing；
- 远端已执行、本地未知时如何查询收据并收敛；
- 取消请求如何得到远端或本地确认；
- deadline 到期如何进入失败、取消或死信；
- 是否允许再次执行以及幂等键是什么。

### 3.4 真实状态优先于 UI 状态

UI 只能展示公共权威投影。UI 不能签发：

- 登录成功；
- 模型合格；
- 消息发送成功；
- 学习激活；
- 恢复完成；
- 发布就绪。

## 4. 核心组件

### 4.1 IdentityAuthority

负责生成和验证所有稳定身份，不负责业务合并。

核心身份：

- `accountIdentityId`
- `externalContactIdentityId`
- `canonicalContactId`
- `canonicalConversationId`
- `canonicalMessageId`
- `mediaAssetId`
- `operationId`
- `attemptId`
- `traceId`
- `receiptId`
- `memoryId`
- `idempotencyKey`

身份必须包含必要作用域。平台外部 ID 的最小作用域为：

```text
platform + sourceAccountId + externalId
```

显示名、头像 URL、格式化电话号码或用户名不得单独形成联系人合并依据。

### 4.2 CanonicalEventLedgerAuthority

由现有 `DomainEventLogAuthority` 原地升级，不建立第二事件账本。

每条事件至少包含：

- `eventId`
- `eventType`
- `aggregateType`
- `aggregateId`
- `aggregateVersion`
- `commandId`
- `idempotencyKey`
- `traceId`
- `correlationId`
- `causationId`
- `platform`
- `sourceAccountId`
- `generation`
- `occurredAt`
- `receivedAt`
- `payloadSha256`
- `redactionVersion`
- `schemaVersion`
- `writerAuthority`

强制不变量：

- 同一 aggregate 的 version 单调递增；
- 同一 idempotency key 对应不同内容时 fail-closed；
- event payload 在持久化前脱敏并限制大小；
- UPDATE/DELETE 由 SQLite trigger 阻断；
- 事件提交与同步权威投影在同一事务完成；
- 提交成功后才允许发布进程内通知。

### 4.3 AuthorityTransactionCoordinator

所有 command handler 通过同一协调器执行：

1. 验证 command schema、scope、actor、expectedVersion；
2. 查重 idempotency key；
3. 获取 aggregate 当前版本；
4. 调用唯一 authority 决策；
5. 追加事件；
6. 更新权威同步投影；
7. 更新 projection checkpoint；
8. 签发 command receipt；
9. COMMIT 后发布通知。

禁止业务服务自行 `BEGIN/COMMIT` 后再补写事件。

### 4.4 DurableExecutionAuthority V2

统一状态机：

```text
CREATED
  → SCHEDULED
  → CLAIMED
  → RUNNING
  → WAITING_REMOTE
  → RETRY_SCHEDULED
  → CANCEL_REQUESTED
  → SUCCEEDED / FAILED / CANCELLED / DEAD_LETTERED
```

每个 operation 必须具备：

- `operationId`
- `operationKind`
- `traceId`
- `idempotencyKey`
- `generation`
- `ownerId`
- `fencingToken`
- `leaseSequence`
- `leaseExpiresAt`
- `heartbeatAt`
- `attempt`
- `maxAttempts`
- `deadlineAt`
- `remoteRequestId`
- `cancellationReceiptId`
- `nextAttemptAt`
- `failureClass`
- append-only history

所有状态转换必须使用数据库 CAS 条件：

```text
WHERE operation_id=? AND generation=? AND owner_id=? AND state IN (...)
```

不能先读后无条件 UPDATE。旧 generation、旧 owner、过期 fencing token 和晚到回调统一拒绝并记录 `LateResultRejectedReceipt`。

首批强制迁移：

- 登录与会话恢复；
- 历史同步；
- 媒体下载；
- AI Provider 调用；
- 消息发送；
- 平台回执核对。

### 4.5 CommunicationAuthority V2

唯一拥有：

- `ExternalAccountIdentity`
- `ExternalContactIdentity`
- `CanonicalContact`
- `CanonicalConversation`
- `CanonicalMessage`
- `MediaAsset`
- `DeliveryAttempt`
- `DeliveryReceipt`
- `SyncCheckpoint`

核心不变量：

- 历史同步、实时事件和回执必须进入同一 canonical message identity；
- account scope 是所有外部身份、会话和消息 idempotency key 的组成部分；
- 不支持的消息类型显式保存为 `unsupported`；
- raw event reference、normalized content、render projection 分离；
- 发送成功必须有平台 message ID 或明确 accepted receipt；
- `UNKNOWN` 必须触发 receipt reconciliation，不能永久停留；
- receipt 状态按平台能力单调收敛，晚到失败不能覆盖已确认 delivered/read；
- sync checkpoint 仅在一个完整 gap 的所有事件提交后推进；
- 联系人合并必须由 `ContactRelationshipAuthority` 的明确收据授权。

### 4.6 ChannelAdapterContract V2

统一接口：

```text
authenticate()
restoreSession()
resolveAccountIdentity()
discoverContacts()
backfillConversations()
backfillMessages()
subscribeEvents()
normalizeEvent()
fetchMedia()
sendMessage()
queryReceipt()
disconnect()
```

Adapter 输出必须是版本化 plain data envelope，并包含：

- platform；
- adapterVersion；
- sourceAccountIdentity；
- externalEventId；
- occurredAt；
- capability flags；
- payload hash；
- redaction metadata。

Adapter 禁止：

- 直接写业务表；
- 决定联系人合并；
- 自行持久化业务重试；
- 决定 AI 是否发送或学习；
- 写 UI 状态或系统安全模式；
- 将 SDK callback 对象、Buffer、Error、Map、函数或循环引用穿越边界。

### 4.7 ModelLifecycleAuthority

唯一管理以下互不替代的事实：

- `ProviderCredential`
- `ProviderConnection`
- `DiscoveredModel`
- `CapabilitySnapshot`
- `SmokeQualification`
- `BenchmarkQualification`
- `RoleQualificationReceipt`
- `ChampionAssignment`
- `ProductionRouteBinding`
- `RuntimeHealth`
- `CooldownState`

强制规则：

```text
连接成功 ≠ 模型合格
模型存在 ≠ 能完成目标任务
smoke 通过 ≠ 正式资格
候选模型 ≠ 生产模型
角色合格 ≠ 冠军
冠军 ≠ 已绑定生产路由
UI 绿色 ≠ RuntimeHealth 可用
allowConditional ≠ 绕过生产资格
```

路由解析只能读取 `ModelLifecycleAuthority` 的版本化快照，不能从多个服务拼接隐式状态。

### 4.8 EvidenceAuthority V2

统一链路：

```text
UserActionTrace
  ├── RouteResolutionObservation
  ├── ModelQualificationObservation
  ├── ProviderExecutionObservation
  ├── CandidateGenerationObservation
  ├── HumanReviewObservation
  ├── DeliveryAttemptObservation
  ├── PlatformReceiptObservation
  └── LearningReceiptObservation
```

证据规则：

- append-only；
- 结构化；
- 默认脱敏；
- 不保存凭据和聊天全文；
- 每个 observation 记录 writer authority、schema version 和关联 receipt；
- 终态 trace 不允许静默追加冲突终态；
- `AIExecutionTraceAuthority`、`modelExecutionEvidenceStore` 和诊断事件逐步变为兼容 facade，最终删除独立写入。

### 4.9 ContactRelationshipAuthority V2

唯一管理：

- 外部身份与 canonical contact 的绑定；
- 人工确认、拆分、合并、撤销；
- 关系断言及其版本；
- 联系人上下文快照。

每个关系事实必须引用 canonical message/event/trace receipt，不得只引用自由文本或显示名。

### 4.10 AIReplyLearningAuthority V2

状态机：

```text
ObservedFact
  → PendingMemory
  → HumanApproved
  → Shadow
  → Active
  → Revoked / Superseded
```

创建 `PendingMemory` 的必要条件：

```text
真实候选已生成
+ 人工审核通过
+ 真实平台发送成功
+ 平台回执已确认
+ 非紧急降级路径
+ 来源联系人身份明确
```

每次检索必须生成 `MemoryRetrievalReceipt`，记录：

- memory ID；
- memory version；
- user/contact/conversation/agent/run scope；
- retrieval purpose；
- ranking/selection result；
- requesting trace；
- decision outcome。

### 4.11 ProjectionAuthority 与 CutoverAuthority

新旧模型在迁移期只能作为账本投影：

- `LegacyCompatibilityProjector`
- `AuthorityReadModelProjector`
- `ShadowComparator`
- `CutoverAuthority`

`CutoverAuthority` 是唯一能签发读路径切换收据的组件。切换收据至少包含：

- authority；
- bounded context；
- ledger sequence range；
- sample count；
- scenario coverage；
- zero-mismatch continuous window；
- failure-injection result；
- restart-recovery result；
- UAT evidence IDs；
- old writer inventory；
- deletion commit；
- rollback policy；
- reviewer approval。

没有切换收据，生产读取不得指向新模型；切换后旧写入者必须删除，而不是保留永久 fallback。

## 5. 迁移策略

### 5.1 禁止双写

禁止：

```text
旧服务写旧表
新服务再写新表
```

允许：

```text
外部事件/命令
  → 唯一账本事务
  → 旧兼容投影
  → 新权威投影
```

两个投影均不是第二个事实写入者。

### 5.2 迁移阶段

1. 盘点所有直接写表入口和恢复入口。
2. 为每个事实登记唯一 authority owner。
3. 建立 command envelope 与 ledger event schema。
4. 将原写入入口改为 authority command facade。
5. 从同一 ledger 生成旧、新投影。
6. 记录结构化 mismatch、缺样本和投影错误。
7. 完成连续窗口零不一致与故障恢复验证。
8. 由 `CutoverAuthority` 签发读取切换收据。
9. 切换生产读取。
10. 删除旧 writer、旧 recovery 和旧 fallback。
11. 重放账本验证可重建性。
12. 真实 UAT 完成后才允许进入发布判断。

### 5.3 Shadow Gate V2

每个 bounded context 必须同时满足：

- 样本量达到该领域风险分层阈值；
- 正常、重复、乱序、延迟、断网、取消、重启、接管、磁盘错误等场景覆盖完成；
- 连续时间窗口 mismatch = 0；
- 投影 lag 在阈值内；
- 重放最终 hash 一致；
- failure injection 通过；
- restart recovery 通过；
- old writer inventory 清零；
- old fallback inventory 清零；
- 独立审查批准。

仅有 `N` 条哈希相等记录不能通过。

## 6. 工作包与顺序

顺序不可颠倒。

### WP-A：领域身份与事件账本

- 冻结 identity schema；
- 升级 `DomainEventLogAuthority` 为唯一 `CanonicalEventLedgerAuthority`；
- 建立 authority registry、command envelope、aggregate version、transaction coordinator；
- 禁止直接 repository 写入。

### WP-B：Durable Execution

依次迁移登录/恢复、历史同步、媒体、AI 调用、发送、回执核对。完成 lease 接管、deadline、cancel receipt、remoteRequestId 和 stale callback 拒绝。

### WP-C：Communication Core

迁移账号、外部身份、联系人、会话、消息、媒体、checkpoint、attempt 和 receipt；三平台 Adapter 只输出 canonical commands/events。

### WP-D：Provider 与模型生命周期

统一 Provider/模型/能力/smoke/benchmark/role/champion/route/health/cooldown，并删除隐式转换。

### WP-E：统一 Evidence Graph

统一 trace/observation/generation/receipt；迁移旧 trace/evidence/diagnostics 写入口。

### WP-F：Memory 与 Learning

统一作用域、版本、人工审批、发送回执前置条件和 retrieval receipt。

### WP-G：影子迁移与旧权威删除

每个模块必须满足：

```text
shadow sample sufficient
scenario coverage complete
continuous mismatch = 0
failure injection pass
restart recovery pass
read cutover receipt issued
old writer removed
old recovery removed
old fallback removed
```

### WP-H：真实环境验收

覆盖：

- Windows 真机；
- Facebook、Telegram、WhatsApp 真实账号；
- 断网、重连、休眠、强杀；
- SQLite 多进程争用；
- 时钟跳变；
- 磁盘满、断电恢复；
- Provider 超时、限流、部分成功、晚到结果；
- 多显示器 DPI；
- 长时间运行与压力测试。

## 7. 验收问题

每个 bounded context 必须明确回答：

1. 唯一权威是谁？
2. 唯一命令入口在哪里？
3. 唯一事实账本在哪里？
4. 事务边界在哪里？
5. aggregate version 如何并发控制？
6. 重复事件如何幂等？
7. 晚到结果如何拒绝？
8. unknown 如何收敛？
9. 失败后如何恢复和接管？
10. 谁能签发成功收据？
11. 投影如何重放和验证？
12. 旧 writer 是否删除？
13. 旧 recovery 是否删除？
14. 旧 fallback 是否删除？
15. 真实环境证据在哪里？

任一问题回答不清楚，该模块不得标记闭环。

## 8. 参考项目边界

只吸收公开项目已验证的边界和不变量：

- Chatwoot：Account/Inbox/ContactInbox/Contact/Conversation/Message/Attachment 的领域分离；
- Temporal：持久 Event History、Activity attempt、retry、heartbeat、cancellation、idempotency 和恢复；
- Activepieces：版本化 typed connector、认证、action/trigger 与持久 trigger state；
- Dify：Provider、模型能力、工作流历史、资格与运行日志分离；
- Open WebUI：标准协议优先、Provider/工具边界；
- AnythingLLM：本地优先、云/本地 Provider 共存和作用域化记忆；
- Langfuse：trace/span/generation/evaluation 的关联模型；
- Mem0：user/session/agent/run 作用域、版本、历史和检索。

明确不采用：

- 不 fork 完整运行时；
- 不复制 UI、品牌或受限目录代码；
- 不把参考数据库 schema 原样搬入 Yance；
- 不引入新的远程服务作为本地桌面核心事实来源；
- 不因许可证宽松而跳过供应链、SBOM、网络出口和数据驻留审查。

参考源：

- https://github.com/chatwoot/chatwoot
- https://docs.temporal.io/
- https://www.activepieces.com/docs/
- https://github.com/langgenius/dify
- https://github.com/open-webui/open-webui
- https://github.com/Mintplex-Labs/anything-llm
- https://github.com/langfuse/langfuse
- https://github.com/mem0ai/mem0

## 9. 前置治理门禁

PR #4 当前保持 Draft。此前独立复审发现的 sealed-export 根符号链接/物理路径和继承 Git 环境绕过风险不得豁免，也不得因本设计扩大范围而消失。该问题必须在实现开始前的 Gate 0 中通过公共治理层修复：

- root `lstat` 与 canonical `realpath`；
- 拒绝根符号链接和 Windows junction/reparse point；
- 所有扫描、Git 探测和哈希统一使用 canonical root；
- 清洗影响仓库发现的继承 `GIT_*` 环境；
- 补齐 Linux symlink、Windows junction 和 Git 环境矩阵回归。

该治理修复与 Architecture Closure V2 的业务重构分别验收，任何一项失败都禁止进入 Gate 1。

## 10. 本设计的审查状态

本文件已冻结为独立审查候选，但尚未批准实现。

审查必须确认：

- 是否真正消除了双写而非改名；
- 是否遗漏现有旧 writer/recovery/fallback；
- 账本、同步投影和异步投影的事务语义是否明确；
- SQLite 多进程和崩溃恢复是否可实现；
- Durable Execution 是否能拒绝旧 owner 和晚到回调；
- Model Lifecycle 是否覆盖全部隐式转换；
- Evidence/Memory 脱敏和作用域是否足够；
- cutover/delete 门禁是否可执行且不可绕过；
- WP-A 至 WP-H 是否顺序正确。

独立审查批准前，禁止编写实现计划或修改生产代码。