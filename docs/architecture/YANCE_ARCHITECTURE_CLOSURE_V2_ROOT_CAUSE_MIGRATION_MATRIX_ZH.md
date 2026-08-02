# Yance Architecture Closure V2 根因迁移矩阵

- 状态：`FROZEN_FOR_INDEPENDENT_REVIEW`
- 对应设计：`docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-design.md`
- 初始代码基线：`15e538a6c26817b3cb8422fa3739f01256ec109e`
- 设计冻结提交：`b63f1cd73295432fce5f6506a49220481e4aaf73`
- 实现许可：`false`

## 使用规则

本矩阵不是任务愿望清单，而是迁移和删除合同。每一行必须在实现阶段补齐：

- 实际调用点清单；
- 失败测试；
- ledger event schema；
- projection comparison schema；
- cutover receipt；
- 删除提交；
- 真实环境证据。

任何行只新增新服务、但未移除旧 writer/recovery/fallback，状态均为 `NOT_CLOSED`。

## A. 领域身份与唯一事件账本

| ID | 业务事实 | 当前旧权威/重复写入者 | 根因 | 目标公共层 | 参考不变量 | 迁移路径 | 删除/切换条件 |
|---|---|---|---|---|---|---|---|
| A-01 | 平台账号身份 | `accountManager`、`accountRepository`、`accountStore`、`accountMigrationService`、`canonicalIdentityService`、平台 Adapter 局部账号对象 | 登录状态、配置状态、平台外部身份和生产就绪混在不同对象 | `IdentityAuthority` + `CommunicationAuthority` | Chatwoot 的 account/inbox scope；一个外部账号身份必须有稳定内部 ID | 账号命令进入 ledger；旧账号表和新投影从同一事件生成 | 所有账号创建/更新入口经 authority；旧账号直接写方法删除；重启重放一致 |
| A-02 | 外部联系人身份 | `platformCoreRepository.identity_links`、FIX6M `contact_external_identities`、平台联系人缓存、显示名/手机号推断 | 同一外部身份可生成多个内部对象，显示名被误作合并键 | `IdentityAuthority` + `ContactRelationshipAuthority` | `platform + sourceAccountId + externalId` 是最小唯一作用域 | 将观察到的身份写成 ledger event；新旧联系人模型均投影 | 跨平台同名测试不合并；旧 identity link writer 删除；人工绑定/撤销可重放 |
| A-03 | Canonical contact | `persons`、`person_contact_bindings`、`contact_aggregates`、客户画像/联系人服务 | person/contact/profile 概念并行，合并和拆分缺少唯一收据 | `ContactRelationshipAuthority` | 联系人聚合只能由证据和人工确认改变 | 用 bind/merge/split/revoke events 驱动两个投影 | 旧 person/contact 合并入口删除；所有变更有 receipt 和 rollback |
| A-04 | 会话身份 | `messageStore`、`conversation_bindings`、平台专用会话 ID、UI 会话缓存 | 历史同步和实时事件可能落到不同会话对象 | `CommunicationAuthority` | account-scoped conversation binding；同一外部会话映射唯一 | 会话观察事件进入 ledger，生成 canonical conversation | 三平台历史/实时重放零重复；旧 conversation upsert writer 删除 |
| A-05 | 消息身份 | `messageStore`、`domainEventLogService`、平台 handler、FIX6M `communication_canonical_messages` | 外部事件、历史消息、实时消息和发送回显使用不同幂等规则 | `CommunicationAuthority` | `platform+account+conversation+externalMessageId`；raw/normalized/render 分离 | 先写 canonical event，再生成旧 UI 消息和新 canonical message 投影 | 重复/乱序/重连测试收敛；旧 message insert/upsert 入口删除 |
| A-06 | Operation 身份 | `backgroundJobAuthority`、`jobQueue`、`syncCheckpointService`、AI task registry、`DurableExecutionAuthority` | 同一长操作可能有多个 job/task/execution ID | `IdentityAuthority` + `DurableExecutionAuthority` | operation ID、attempt ID、idempotency key 分离 | 所有长操作由 ledger command 创建唯一 operation | 旧 job 创建入口删除；所有生产 operation 可按 trace 查询 |
| A-07 | Trace 身份 | `AIExecutionTraceAuthority`、`modelExecutionEvidenceStore`、diagnostics correlation、`EvidenceAuthority` | `routeTestId`、executionId、providerRequestId 和平台 receipt 分散 | `EvidenceAuthority` | 一次用户意图只有一个 trace，物理尝试有独立 attempt | 兼容旧 ID 为 alias，所有新 observation 写 EvidenceAuthority | 旧内存 trace writer 删除；跨 AI/发送/学习链完整 |
| A-08 | 幂等键 | 各服务自行拼接或缺省 | 作用域不一致、同键不同内容未统一拒绝 | `IdentityAuthority` + `CanonicalEventLedgerAuthority` | 同键不同 payload hash 必须 fail-closed | 建立版本化 idempotency key registry | 所有 command/event 使用 registry；静态扫描无私有拼接旁路 |
| A-09 | 事实入口 | `domainEventLogService` 之外仍有大量 repository 直接写入 | 事件日志存在但不是唯一事实入口 | 原地升级 `DomainEventLogAuthority` 为 `CanonicalEventLedgerAuthority` | Event History 是恢复事实；投影可重建 | 包装 repository，只允许 transaction coordinator 写事实和同步投影 | 直接业务表写入清零；trigger/测试阻断未授权 writer |
| A-10 | 事务边界 | 服务各自 transaction，常见“先写业务表再补证据” | 崩溃可产生事实和证据不一致 | `AuthorityTransactionCoordinator` | command 验证、event append、同步投影、receipt 同事务 | 为每个 command handler 建立统一事务模板 | 故障注入任意断点均原子回滚或完整提交 |

## B. Durable Execution

| ID | 异步操作 | 当前旧权威/重复生命周期 | 根因 | 目标公共层 | 迁移路径 | 关闭条件 |
|---|---|---|---|---|---|---|
| B-01 | 登录/OAuth/扫码 | `accountManager`、Facebook OAuth 服务、Telegram/WhatsApp session handler、Timer/Promise | 半程退出后无法证明继续点；UI 可先于真实状态更新 | `DurableExecutionAuthority` | 每个 auth flow 建 operation、challenge、remote request 和 terminal receipt | 强杀/重启可恢复；旧登录状态机删除；成功仅由平台身份收据签发 |
| B-02 | 会话恢复 | 各平台 `restoreSession`、startup recovery、account lifecycle saga | 平台各自定义恢复和 owner | `DurableExecutionAuthority` + Adapter | restore command 经统一状态机，Adapter 只执行协议动作 | 多实例接管、旧 owner 回调和过期 session 均有确定结果 |
| B-03 | 历史同步 | Telegram history、WhatsApp reconciliation、Facebook reconciliation、`syncCheckpointService` | checkpoint、分页、gap 和重试语义不一致 | `DurableExecutionAuthority` + `CommunicationAuthority` | page attempt 写 operation history；消息提交后推进 gap checkpoint | 断网/重启/重复页不跳过不重复；旧 sync recovery 删除 |
| B-04 | 媒体下载 | 头像/GIF/贴纸/语音/附件各自下载和缓存 | 下载失败变空白；缓存与业务状态脱节 | `DurableExecutionAuthority` + `MediaAsset` lifecycle | remote discovered 后创建 fetch operation；结果写 receipt | 各媒体类型均有明确失败态、重试和可见 fallback；旧 downloader 状态删除 |
| B-05 | AI Provider 调用 | `aiGateway`、model executor/worker、candidate/production services、task registry | 总预算、单 attempt、取消和远端晚到语义分散 | `DurableExecutionAuthority` + `ModelLifecycleAuthority` | 每次物理调用为 attempt；Provider request ID 持久化 | 超时/429/5xx/取消/晚到均可证明；旧 generation 提交被 CAS 拒绝 |
| B-06 | 消息发送 | `sendQueueService`、`platformMessagingService`、`aiReplyOutboxService`、平台 Adapter send | 本地 queued/sent 与平台 accepted/delivered 混用 | `DurableExecutionAuthority` + `CommunicationAuthority` | outbox command 创建 operation、attempt、receipt reconciliation | 没有平台 ID/accepted receipt 不得成功；旧 send queue writer 删除 |
| B-07 | 平台回执核对 | 平台 callback、轮询、WhatsApp receipt recovery、各自 unknown 修复 | unknown 可永久存在；回执可能逆序覆盖 | `DurableExecutionAuthority` + `DeliveryReceipt` | unknown 自动创建 queryReceipt operation；状态单调合并 | unknown 在 SLA 内收敛或 dead-letter；晚到失败不覆盖 delivered/read |
| B-08 | owner/lease/fencing | `runtimeRoleGuard`、job queue fencing、FIX6M generation/owner | 多套 fencing token，部分 UPDATE 先读后写 | `DurableExecutionAuthority V2` | 数据库 CAS + leaseExpiresAt + fencingToken | 多进程竞争测试只允许一个 owner；旧 owner 所有提交被拒绝 |
| B-09 | heartbeat/时钟跳变 | heartbeat runner、wall-clock lease、SQLite owner state | 系统时钟变化可能误判 owner | `DurableExecutionAuthority V2` | lease sequence 为主，wall clock 只用于超时窗口；记录 clock anomaly | 前后跳时钟测试不产生双 owner；异常进入诊断 |
| B-10 | 取消 | AbortController/Promise、AI task cancel、平台本地标记 | 取消请求不等于远端已取消 | `DurableExecutionAuthority V2` | `CANCEL_REQUESTED` + cancellation receipt + late result fencing | 每种 operation 明确 cancel ack；未确认进入 reconcile/dead-letter |
| B-11 | deadline | 各调用方 timeout 参数 | timeout 结束后远端可能继续成功 | `DurableExecutionAuthority V2` | 持久 deadline 和终止分类；晚到结果只作为 observation | deadline 后不能改变业务终态；平台真实成功则进入人工 reconciliation |
| B-12 | DLQ/人工恢复 | background job DLQ、消息 DLQ、AI failure 各自定义 | 无统一 reopen/abandon 收据 | `DurableExecutionAuthority V2` | dead-letter event、operator decision、replay generation | 所有 DLQ 可查询、可重放、可放弃且保留证据 |

## C. Communication Core 与 Adapter

| ID | 事实/边界 | 当前问题 | 目标公共层 | 参考项目 | 迁移路径 | 删除条件 |
|---|---|---|---|---|---|---|
| C-01 | 平台事件入口 | webhook、polling、SDK callback、历史回填分别写业务对象 | `ChannelAdapterRuntime` → ledger | Activepieces typed trigger；Chatwoot webhook/inbox scope | 所有输入先 normalize 为 versioned plain-data event | Adapter 内无 repository import；静态/运行时门禁通过 |
| C-02 | Adapter 生命周期 | 三平台方法名和错误/能力表达不一致 | `ChannelAdapterContract V2` | Activepieces auth/action/trigger/version | 统一 authenticate/restore/discover/backfill/subscribe/normalize/fetch/send/query/disconnect | 三平台真实 Adapter 全部通过同一 contract suite |
| C-03 | Adapter 数据安全 | SDK 对象、Buffer、Error、函数可能越界 | `ChannelAdapterContract V2` | 插件边界只传可序列化数据 | 扩展 plain-data validator、size/schema/version 限制 | 模糊测试拒绝 getter、cycle、prototype pollution、binary |
| C-04 | 账号业务状态 | Adapter 或 UI 可直接决定 connected/ready | `CommunicationAuthority` | account/inbox separation | Adapter 只返回 protocol receipt；authority 计算业务状态 | UI/Adapter 不再写 production readiness |
| C-05 | 联系人发现 | 各平台联系人列表直接 upsert | `CommunicationAuthority` + `ContactRelationshipAuthority` | ContactInbox/Contact boundary | 观察 external identity，默认不自动跨平台合并 | 同名/改名/头像变化不改变 canonical contact |
| C-06 | 会话发现 | 平台 channel/thread/chat 直接映射 UI | `CommunicationAuthority` | Conversation scoped to account/inbox | canonical conversation binding event | 历史和实时会话 hash 一致；旧 mapping writer 删除 |
| C-07 | Unsupported message | 未识别类型变空文本/空白气泡 | `CanonicalMessage.contentKind=unsupported` | 显式 message content type | normalize 时保留 platform type 和安全摘要 | 三平台未知类型 UAT 显示可解释 fallback |
| C-08 | MediaAsset | 原始引用、下载、缓存、渲染混在一起 | `CommunicationAuthority` | Message/Attachment separation | remote ref、fetch state、local asset、render projection 分离 | 缓存丢失可重建；失败不再静默为空 |
| C-09 | 发送 attempt | 重试可能复用/覆盖同一发送记录 | `DeliveryAttempt` | Activity attempt/receipt | 每次物理发送独立 attempt，业务 message 不变 | 重试和 duplicate callback 均可追溯 |
| C-10 | 发送 receipt | local success、provider accepted、delivered/read 混用 | `DeliveryReceipt` | append-only external action receipt | 每次平台状态写追加式 receipt，投影单调收敛 | 所有成功 UI 引用 receipt ID |
| C-11 | SyncCheckpoint | 各平台 cursor/high-watermark/gap 定义不一致 | `CommunicationAuthority` | durable trigger store | 统一 checkpoint schema 与 committed gap | 重启、分页重复、乱序、空页测试通过 |
| C-12 | 实时/历史统一 | 同一消息可经两个入口重复落库 | ledger idempotency + canonical identity | Chatwoot canonical message边界 | 两入口只产生同一 command key | 双入口并发测试只生成一条 canonical message |

## D. Provider 与模型生命周期

| ID | 生命周期事实 | 当前旧权威/并行来源 | 根因 | 目标公共层 | 迁移路径 | 删除/切换条件 |
|---|---|---|---|---|---|---|
| D-01 | Provider credential | model registry、platform auth/config、OpenRouter auto config、UI 状态 | 凭据存在被误作连接或模型可用 | `ModelLifecycleAuthority` | credential metadata 事件化，秘密仍在安全存储 | UI 只读投影；无客户端伪造 connected |
| D-02 | Provider connection | onboarding smoke、connection test、runtime health 混用 | 一次请求成功被提升为长期可用 | `ProviderConnection` | 独立 connect receipt，有有效期和错误分类 | smoke/qualification 不再读取临时绿色状态 |
| D-03 | 模型发现 | `modelRegistry`、provider catalog、OpenRouter list、本地扫描 | discovered 与 enabled/qualified 混用 | `DiscoveredModel` | 发现快照版本化，保留来源和时间 | 目录变化不自动改变生产路由 |
| D-04 | 能力快照 | `modelCapabilityAuthority`、静态元数据、调用推断 | 能力声明缺少版本和证据 | `CapabilitySnapshot` | Provider 声明+探测结果分开记录 | 过期能力自动失效但不删除历史 |
| D-05 | Smoke | onboarding smoke、测试当前配置、候选执行 | smoke 被误当角色或正式资格 | `SmokeQualification` | smoke receipt 明确 scope、版本、到期时间 | 所有生产 gate 拒绝仅 smoke 证据 |
| D-06 | Benchmark | commercial benchmark、brain benchmark、专项评估 | 多类评估结果无法统一比较和撤销 | `BenchmarkQualification` | 数据集、版本、评分、失败原因事件化 | 评估可重放；数据集变更触发重新资格 |
| D-07 | Role qualification | `aiBrainRoleLifecycleAuthority`、`aiRoleQualificationReceiptAuthority`、task readiness | 角色资格与模型基础资格互相代替 | `RoleQualificationReceipt` | 每个 task/role 明确 prerequisite | 无 receipt 的生产任务 fail-closed |
| D-08 | Champion assignment | `replyChampionAuthority`、brain registry、UI 推荐 | 推荐、候选、冠军和生产主模型混合 | `ChampionAssignment` | 通过人工/治理 command 创建版本化 assignment | champion 变化不自动发送，需 route binding |
| D-09 | Production route | `modelRoutingIntegrityService`、`aiQualityRouteAuthority`、`modelServiceTaskRoutingAuthority`、路由草稿 | 多服务拼接状态，`allowConditional` 容易泄漏 | `ProductionRouteBinding` | 单一版本化 route snapshot，引用全部资格 receipt | 路由解析只读一个 authority snapshot；旧 route writer 删除 |
| D-10 | Runtime health | worker health、provider error、UI green、diagnostics | 短期运行健康覆盖正式资格，或反之 | `RuntimeHealth` | attempt 事件聚合为短期健康，不修改资格事实 | route 同时检查资格和健康但不互相覆盖 |
| D-11 | Cooldown | FIX6N cooldown、调用方 backoff、provider-specific timers | 冷却状态可能只在内存 | `CooldownState` | 429/Retry-After 和故障域写持久事件 | 重启保持冷却；人工解除有 receipt |
| D-12 | Failure domain | provider/model fallback 自行选择 | 主备同供应商或同故障域 | `ModelLifecycleAuthority` | failureDomain 成为 route invariant | 生产 fallback 必须跨故障域，违规不可保存 |

## E. Evidence Graph

| ID | 证据事实 | 当前并行来源 | 根因 | 目标公共层 | 迁移路径 | 关闭条件 |
|---|---|---|---|---|---|---|
| E-01 | UserActionTrace | `AIExecutionTraceAuthority`、routeTestId、domain correlation、EvidenceAuthority | trace 可能只覆盖 AI，不覆盖发送和学习 | `EvidenceAuthority V2` | trace 从用户/平台意图开始，贯穿所有 receipt | 任一最终失败可反查路由、模型、attempt、平台 receipt |
| E-02 | Provider observation | model execution evidence store、worker logs、diagnostics | 日志不是稳定业务证据 | `ProviderExecutionObservation` | attempt 完成同事务写 evidence reference | 关闭旧 evidence store 独立 writer |
| E-03 | Delivery observation | send queue、message row、平台 callback | 发送链证据散落 | `DeliveryAttempt/ReceiptObservation` | Communication receipt 自动关联 trace | UI 和学习引用同一 receipt ID |
| E-04 | Learning observation | feedback/learning 表、AIReplyLearningAuthority | 学习来源无法证明真实送达 | `LearningReceiptObservation` | pending memory 创建时强制引用 delivery receipt | 无 receipt 的 learning insert 被数据库/authority 拒绝 |
| E-05 | Diagnostics truth | production diagnostics、页面局部 checks、authority tables | 局部全绿覆盖真实 warning/fail | Evidence/Authority projections | 诊断只聚合权威记录，页面检查仅作 observation | UI 无独立成功计算；skipped/unknown 可见 |
| E-06 | 脱敏 | 各日志和 evidence 白名单不同 | 某入口可能保存聊天全文或凭据 | `EvidenceRedactionPolicy` | 单一 redaction library + schema allowlist | secret scanner、property-based 测试、真实脱敏样本通过 |
| E-07 | retention | 各表永久增长或自行清理 | 删除证据可能破坏可证明性 | `EvidenceRetentionAuthority` | 事件保留、payload 摘要、合规清理分层 | 清理操作本身有 receipt，核心关联不丢失 |

## F. Contact Relationship、Memory 与 Learning

| ID | 事实 | 当前旧权威/并行来源 | 根因 | 目标公共层 | 迁移路径 | 删除/切换条件 |
|---|---|---|---|---|---|---|
| F-01 | 关系断言 | customer profile evidence、relationship assertions、FIX6M v2 | 同一关系事实可能多处更新 | `ContactRelationshipAuthority` | 所有 assertion 从 canonical message/event 生成 | 旧 assertion writer 删除；approve/revoke 可重放 |
| F-02 | Context snapshot | 运行时动态拼装、contact context、FIX6M snapshots | AI 实际使用的上下文版本不可证明 | `ContactContextSnapshot` | 候选执行前冻结版本化 snapshot | 每个 AI trace 引用 exact snapshot ID |
| F-03 | ObservedFact | 入站消息、抽取服务、feedback | 观察事实可能直接进入长期学习 | `AIReplyLearningAuthority` | 观察只创建候选事实，不自动 active | 所有自动提升路径删除 |
| F-04 | PendingMemory | 候选生成或审核后直接写 learning profile | 未等平台成功回执 | `PendingMemory` | 仅在 reviewed+delivered+non-emergency 条件满足时创建 | 发送失败/unknown/取消测试均不创建 pending |
| F-05 | Human approval | feedback、outbox、learning 审核分散 | 审核文本和实际发送文本可能不同 | `HumanReviewReceipt` | 审核冻结 outbound payload hash | 发送 attempt 必须引用同一 hash |
| F-06 | Shadow/Active | learning profiles、AIReplyLearningAuthority events | active 状态可能由多个入口设置 | `AIReplyLearningAuthority` | 生命周期只通过事件转换 | 旧 profile activation writer 删除 |
| F-07 | Memory scope | user/contact/conversation/agent/run 未统一 | 跨联系人或跨任务污染 | `MemoryScopeAuthority` | 每条 memory 固定 scope tuple | 检索必须显式 scope；越界请求 fail-closed |
| F-08 | Retrieval receipt | 现有检索可能只返回内容 | 无法证明实际用了哪个版本 | `MemoryRetrievalReceipt` | 检索结果和选择原因写 receipt | 每个生成 trace 可列出 exact memory IDs/versions |
| F-09 | Supersede/revoke | 更新可能覆盖旧事实 | 历史和来源丢失 | append-only memory version events | 新版本 supersede，旧版本不可修改 | 回滚/撤销后重放结果一致 |

## G. Shadow、切换与旧权威删除

| ID | 门禁 | 当前不足 | V2 要求 | 证据 | 失败处理 |
|---|---|---|---|---|---|
| G-01 | 样本充分性 | `ArchitectureShadowGate` 默认按条数 | 按 bounded context、平台、操作类型、失败类型分层阈值 | sample manifest | 任一分层不足即阻断 |
| G-02 | 连续窗口 | 最近 N 条可能跨越很长时间 | 同时满足事件数量和连续运行时长 | window receipt | 窗口中任一 mismatch 重新计时 |
| G-03 | 场景覆盖 | 仅 hash 比较 | 正常、重复、乱序、延迟、取消、重启、接管、断网、磁盘错误 | scenario coverage matrix | 缺场景即阻断 |
| G-04 | 结构化 mismatch | 只记录两个 hash | 字段级 diff、source event、projector version、severity、resolution | mismatch receipt | 不允许通过忽略字段放宽 |
| G-05 | Projection lag | 未作为 gate | 每个 projector durable checkpoint 和 lag SLA | checkpoint receipt | 超阈值阻断切换 |
| G-06 | Replay proof | 未要求从零重建 | 空数据库从 ledger 重放并比较最终 hash | replay manifest | 失败必须修复 projector/ledger，不可手工补库 |
| G-07 | Failure injection | 未内置 | SQLite busy、进程强杀、断网、超时、磁盘满、时钟跳变 | injection evidence | 任一失败不收敛即阻断 |
| G-08 | Restart recovery | 单元测试不能替代真实重启 | 多次强杀/重启和 owner 接管 | recovery receipt | 旧 owner 可提交则阻断 |
| G-09 | Read cutover | 可能通过配置开关切换 | 只能由 `CutoverAuthority` 签发不可变 receipt | cutover receipt | 无 receipt 的配置切换启动失败 |
| G-10 | Old writer removal | 旧 API/facade 可长期保留 | 删除直接写入、导出和路由 | deletion manifest + static scan | 任一写入口残留即 NOT_CLOSED |
| G-11 | Old recovery removal | 新旧恢复并行可互相覆盖 | 删除旧 startup recovery、timer 和 retry loop | recovery deletion manifest | 发现旧 loop 即阻断 |
| G-12 | Old fallback removal | 长期 fallback 形成双权威 | 切换稳定后删除 fallback，仅保留基于 ledger 的回滚 | fallback deletion manifest | fallback 指向旧 writer 即阻断 |
| G-13 | Rollback | 直接切回旧 writer | 回滚只改变读投影版本，不恢复旧事实写入者 | rollback receipt | 不能用回滚理由保留双写 |
| G-14 | Schema migration | 新表存在即视为完成 | schema、backfill、replay、cutover、delete 分别签收 | migration receipts | 任一阶段失败不提升 schema closure 状态 |

## H. 真实环境与发布边界

| ID | 验收领域 | 必须覆盖 | 成功证据 | 禁止替代 |
|---|---|---|---|---|
| H-01 | Windows 生命周期 | 安装、启动、休眠、唤醒、强杀、升级、恢复 | 原始日志、operation history、trace/receipt | Linux/macOS 等价测试 |
| H-02 | WhatsApp | 扫码、重启恢复、历史/实时、媒体、发送、回执、重连 | 真实账号与平台 ID | mock Adapter |
| H-03 | Telegram | 登录、联系人/历史、贴纸/媒体、发送、回执、限流 | 真实账号与平台 ID | 单元测试 |
| H-04 | Facebook | OAuth、Page 选择、Webhook/Relay、媒体、发送、回执 | 真实 Page 和平台 ID | 本地 fake webhook |
| H-05 | SQLite 多进程 | owner 竞争、busy、强杀、迁移接管 | 单 owner、无损恢复、replay hash | 单进程测试 |
| H-06 | 时钟跳变 | 前跳、后跳、休眠恢复 | 无双 owner、deadline 可解释 | 调大 timeout |
| H-07 | 存储故障 | 磁盘满、写失败、断电模拟、损坏检测 | fail-closed、可恢复、证据完整 | 捕获异常后继续 |
| H-08 | Provider 故障 | 认证失败、400、429、5xx、超时、空内容、部分成功、晚到 | attempt history、cooldown、fencing receipt | 无条件 fallback |
| H-09 | UI/DPI | 100/125/150%、多显示器、主题、长列表 | Windows 截图/自动化证据 | CSS 单测 |
| H-10 | 长时间与压力 | 高频消息、同步+AI+发送并发、长期运行 | lag、内存、DB、DLQ、unknown 指标 | 短时 smoke |

## I. Gate 0 治理前置项

| ID | 缺陷 | 当前风险 | 底层修复要求 | 关闭条件 |
|---|---|---|---|---|
| I-01 | sealed-export 根链接/物理路径 | 根目录为 symlink/junction 时词法祖先扫描可能漏掉真实 Git 工作树 | root lstat、realpath canonicalization、拒绝 reparse point、所有扫描使用 canonical root | Linux symlink 与 Windows junction 攻击测试通过 |
| I-02 | Git 仓库发现环境 | 继承 `GIT_CEILING_DIRECTORIES` 等变量可改变 `git rev-parse` 结果 | 清洗影响仓库发现/工作树定位的 `GIT_*` 环境，显式传入安全 env | 环境矩阵下工作树均 fail-closed |
| I-03 | PR/设计门禁 | 扩大架构范围可能掩盖现有审查阻断 | PR 保持 Draft；治理修复和 V2 设计分别审查 | 两者均批准前 `gate1MayStart=false` |

## J. 关闭状态定义

每一行只能使用以下状态：

- `NOT_STARTED`
- `DESIGN_APPROVED`
- `RED_TEST_PROVEN`
- `AUTHORITY_IMPLEMENTED`
- `SHADOW_RUNNING`
- `SHADOW_BLOCKED`
- `CUTOVER_APPROVED`
- `OLD_WRITER_REMOVED`
- `REAL_UAT_PASSED`
- `CLOSED`

`CLOSED` 必须同时满足：

```text
design approved
+ red test proves old failure
+ single authority implemented
+ ledger/projection replay pass
+ shadow sample sufficient
+ scenario coverage complete
+ continuous mismatch = 0
+ failure injection pass
+ restart recovery pass
+ read cutover receipt issued
+ old writer removed
+ old recovery removed
+ old fallback removed
+ real environment evidence accepted
```

测试数量、代码覆盖率、UI 绿色或单次 smoke 均不能单独提升为 `CLOSED`。