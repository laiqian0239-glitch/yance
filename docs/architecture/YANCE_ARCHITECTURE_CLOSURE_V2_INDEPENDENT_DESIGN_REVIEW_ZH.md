# Yance Architecture Closure V2 独立设计审查报告

- 审查类型：`INDEPENDENT_DESIGN_REVIEW`
- 审查日期：2026-08-02
- 仓库：`laiqian0239-glitch/yance`
- PR：#4
- 初审 Head：`205292b2baa0a83222a19fc2dd1ba1de133bb78f`
- 修订后 Head：`d6e6ea8b66e7404c9ea5889d7e3097b0ee3153fb`
- PR 状态：`DRAFT`
- 生产代码修改：`false`
- 最终设计结论：`APPROVED_AFTER_NORMATIVE_AMENDMENT`
- Gate 1：`NOT_AUTHORIZED`

## 1. 审查范围

本轮只审查并冻结 Architecture Closure V2 的架构设计、根因迁移矩阵和治理门禁，不审查尚未编写的实现代码，也不把 WP0 CI 成功解释为业务架构已闭环。

审查对象：

- `docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-design.md`
- `docs/architecture/YANCE_ARCHITECTURE_CLOSURE_V2_ROOT_CAUSE_MIGRATION_MATRIX_ZH.md`
- `governance/yance-architecture-closure-v2-freeze.json`
- FIX6M/FIX6L/FIX6N 现有公共权威和生产组合入口
- 现有 SQLite broker、进程角色、凭据托管、Evidence、Durable Execution、Communication Core
- SQLite、Electron、Temporal 官方资料所证明的并发与恢复不变量

## 2. 当前源码事实

### 2.1 FIX6M 仍是影子公共层

FIX6M 报告已明确新权威尚未切换生产读取，真实三平台和真实 Windows UAT 未完成。`AppRuntimeComposition` 当前仍组合 `accountManager`、`messageStore`、`sendQueueService`、`platformMessagingService`、旧 recovery/projection 等生产参与者，而不是将所有命令统一路由到 FIX6M 权威。

### 2.2 SQLite 已有 broker，但尚未形成跨进程架构合同

当前 `SqliteConnectionBroker` 能拒绝同一进程内第二 broker，并由 desktop-hosted backend 启动时创建；`runtimeRoleGuard` 禁止 model worker 访问主 SQLite。这是正确基础。

但进程内 singleton 不能证明另一个 backend/utility process 不会持有第二个 broker。Architecture Closure V2 必须把“唯一逻辑权威”进一步落实为“唯一物理写宿主、持久 host generation 和 fencing”。

### 2.3 当前 DurableExecutionAuthority 尚未实现数据库级 CAS

现有实现先读取 execution row，再执行按 `execution_id` 的 UPDATE；generation/owner 校验发生在应用层。V2 设计要求改为单条带 generation、owner、state 条件的 CAS，这是必要的底层重构，不是参数修正。

### 2.4 凭据已有专用 custody 边界

`secureBridge` 通过 credential custody client、generation 和 prepare/commit/rollback 协议管理秘密材料。模型生命周期不应再次拥有 API Key、refresh token、Cookie 或 session secret，只能引用 credential binding。

## 3. 外部参考不变量核验

### SQLite

SQLite 官方 WAL 文档说明：WAL 支持并发读，但同一时刻只有一个 writer 追加 WAL；锁冲突可返回 `SQLITE_BUSY`。因此 Yance 不能把 busy timeout 当作多进程协调机制，必须冻结单写宿主和短事务边界。

官方来源：

- https://sqlite.org/wal.html
- https://sqlite.org/walformat.html
- https://sqlite.org/rescode.html
- https://sqlite.org/c3ref/busy_timeout.html

### Electron

Electron 官方进程模型包含 main、renderer 和可选 utility processes。结合 SQLite 单 writer 约束，主库写入必须集中到一个 authority process，其他进程通过 IPC 调用。

官方来源：

- https://www.electronjs.org/docs/latest/tutorial/process-model

### Temporal

Temporal 官方资料说明：

- Event History 是 workflow execution 的完整持久日志；
- Workflow 发出 Command，由服务记录 Event，而不是依赖原 worker 内存；
- Activity 采用 at-least-once 执行模型，worker 在外部动作成功后、确认前崩溃可能导致重试；
- Activity 应使用稳定 idempotency key；
- Activity cancellation 依赖 heartbeat/cancellation delivery，不等于远端副作用自动撤销；
- Continue-As-New 用于以新 history 继续长期执行，控制历史增长。

官方来源：

- https://docs.temporal.io/encyclopedia/event-history
- https://docs.temporal.io/activity-definition
- https://docs.temporal.io/develop/python/best-practices/error-handling
- https://docs.temporal.io/develop/python/workflows/cancellation
- https://docs.temporal.io/workflow-execution/continue-as-new

这些模式只用于提取不变量。Yance 不引入 Temporal Server，也不复制其运行时。

## 4. 初审发现

| ID | 级别 | 初审缺口 | 风险 | 处理结果 |
|---|---|---|---|---|
| DR-P0-01 | P0 | 未冻结 SQLite 跨进程唯一写宿主 | 第二 backend/utility process 可形成物理并行写 owner | 新增 `AuthorityWriteHost`、host generation、fencing、未授权 writer 禁令 |
| DR-P0-02 | P0 | 外部副作用缺少统一事务外持久边界 | 远端已成功但本地未知，盲重试导致重复发送/调用 | 新增 `ExternalActionOutboxAuthority`、intent/attempt/receipt/uncertain reconciliation |
| DR-P0-03 | P0 | ledger payload 与 Evidence 脱敏边界不清 | 过度脱敏导致不可重放，过度记录导致聊天/秘密泄漏 | 新增数据分类、`CanonicalEventHeader + AuthorityPayloadStore` |
| DR-P0-04 | P0 | cutover receipt 同时要求未来 deletion commit | 切换授权和删除闭环时序自相矛盾 | 拆为 `ReadCutoverAuthorizationReceipt` 和 `LegacyRemovalClosureReceipt` |
| DR-P0-05 | P0 | Evidence 与领域收据签发边界不清 | Evidence 可能成为第二业务真值权威 | 固定 receipt issuer registry；Evidence 只引用收据 |
| DR-P0-06 | P0 | ModelLifecycle 可能持有 Provider secret | 与 credential custody 形成第二秘密写入者 | 改为 `ProviderCredentialBinding`，秘密只在 CredentialCustodyAuthority |
| DR-P1-01 | P1 | event schema 演进和 replay 规则不足 | 历史事件升级后不可确定性重放 | 新增 EventTypeRegistry、upcaster、canonicalization version |
| DR-P1-02 | P1 | append-only history 无增长治理 | 长时间运行导致 SQLite history 膨胀 | 新增 segment/snapshot/hash-chain archive 和 execution checkpoint |
| DR-P1-03 | P1 | reply approval 与 memory approval 混用 | 已批准发送被误解释为已批准长期记忆 | 拆为 ReplyApprovalReceipt 和 MemoryApprovalReceipt |
| DR-P1-04 | P1 | shadow hash 缺少确定性规范 | 临时 mask 字段可隐藏真实 mismatch | 固定 semantic schema、排序、排除字段和 canonicalization version |
| DR-P1-05 | P1 | lease expiration 可能被时钟跳变误用 | 旧 owner 在时钟异常后继续提交 | 明确 expiry 只允许发起 takeover，提交权只由 generation/fencing/CAS 决定 |

## 5. 设计修订证据

已提交规范性修订：

1. `docs/superpowers/specs/2026-08-02-yance-architecture-closure-v2-independent-review-amendment.md`  
   Commit：`15d4962d969c43a7b6377be14282299b5223682f`

2. `docs/architecture/YANCE_ARCHITECTURE_CLOSURE_V2_ROOT_CAUSE_MIGRATION_MATRIX_AMENDMENT_1_ZH.md`  
   Commit：`d6e6ea8b66e7404c9ea5889d7e3097b0ee3153fb`

修订文件与原总体设计冲突时具有优先效力。基础设计和基础矩阵保留为初始冻结基线，修订文件记录独立审查后新增的不变量和迁移合同。

## 6. 修订后独立复核

### 6.1 单一权威

通过。设计现在同时定义：

- 逻辑 authority owner；
- 唯一 ledger command 入口；
- 唯一物理 SQLite write host；
- 领域 receipt issuer；
- secret custody issuer；
- cutover governance issuer。

### 6.2 事务与外部副作用

通过。数据库事务不包含网络和 SDK 等待；外部动作通过 COMMIT 后 outbox dispatcher 执行。远端结果未知时进入持久 reconciliation，不允许盲重试。

### 6.3 可恢复性与晚到结果

通过。operation 和 host 两层均使用 generation/fencing/CAS。deadline、cancellation 和 lease 不再依赖调用方自律。时钟异常只能触发接管资格，不能赋予旧 token 提交权。

### 6.4 可重放性与数据治理

通过。业务 payload、secret reference、binary reference 和 Evidence 已分层；event schema、upcaster、canonical hash、projection checkpoint 和 archive 具有明确合同。

### 6.5 切换与旧实现删除

通过。读取切换与旧权威删除拆成两个独立不可变收据。模块只有在第二收据签发后才能标记 `CLOSED`。

### 6.6 工作包顺序

通过，保持 WP-A → WP-H 不变，并补充：

- WP-A：单写宿主、payload store、schema registry；
- WP-B：external action outbox、uncertain outcome；
- WP-D：credential binding；
- WP-E：Evidence 非领域 issuer；
- WP-F：双审批；
- WP-G：两阶段 cutover/closure。

## 7. 最终结论

```text
independentDesignReview=APPROVED_AFTER_NORMATIVE_AMENDMENT
architectureDesignClosed=true
implementationPlanAllowed=false
productionCodeChangesAllowed=false
wpAImplementationAllowed=false
gate1MayStart=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

设计层已经达到可执行、可审计和不可长期双权威的要求。

但以下 Gate 0 阻断仍为 OPEN：

```text
GATE0-SEALED-EXPORT-CANONICAL-PATH
```

必须先完成：

- root lstat + canonical realpath；
- 拒绝根 symlink 和 Windows junction/reparse point；
- canonical root 统一用于扫描、Git 探测和哈希；
- 清洗影响仓库发现的继承 `GIT_*` 环境；
- Linux symlink、Windows junction、Git 环境矩阵测试；
- 独立源码复审。

在该阻断关闭前，不得编写 WP-A 实现代码，也不得进入 Gate 1。

## 8. 下一阶段边界

下一阶段只能是 `GATE0-SEALED-EXPORT-CANONICAL-PATH` 的底层公共治理修复与独立复审。该修复通过后，才可授权生成 Architecture Closure V2 的实施计划。