# OSS-1A 独立审查闭合修订

## 绑定关系

本文件是 PR #21 的绑定修订，专门关闭独立审查提出的两个 Major 问题。

当本文件与以下文档发生冲突时，本文件对相应条款具有更高优先级：

- `2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md`
- `2026-08-04-yance-oss-1a-credential-encryption-amendment.md`
- `2026-08-04-yance-oss-1a-credential-custody-callgraph.md`

本修订不授权运行时代码实施，不扩大到 PR #17，也不授权合并、发布或生产使用。

## 修订一：首批必须完成真实 socket 认证权威切换

### 根因

主计划的 Task 3 定义了 SQLite-backed `whatsappAuthStateStore.open()`，但原首批 Tasks 1–5 没有明确要求把生产 socket 从 `useMultiFileAuthState(authDirectory)` 切换到该状态。

若只完成 repository、adapter 和 generation fence，而 socket 创建仍读取文件目录，则：

- SQLite 不是生产运行时认证权威；
- Signal key 写入仍发生在文件层；
- generation fence 无法保护文件认证写入；
- “移除生产 `useMultiFileAuthState`”只能停留在未接线代码，而不是产品事实。

因此首个运行时批次从原 Tasks 1–5 修订为 **Tasks 1–5A**。Task 5A 是首批不可拆除的完成条件。

### Task 5A：接入 repository-backed AuthenticationState

**修改：**

```text
backend/services/whatsappAdapter.js
```

**新增测试：**

```text
backend/tests/oss1aWhatsappProductionAuthIntegration.test.js
backend/tests/oss1aWhatsappAuthLeaseLifecycle.test.js
```

若实现中把 socket 组装下沉到独立 factory，可同时创建：

```text
backend/services/whatsappSocketFactory.js
backend/tests/oss1aWhatsappSocketFactoryAuthIntegration.test.js
```

但该 factory 只负责 socket 参数组装，不拥有 reconnect、账号 lifecycle、SQLite Store 或认证状态。

### RED 合同

在现有生产代码上先证明：

1. `WhatsAppAdapter.connect()` 仍调用 `useMultiFileAuthState()`；
2. `whatsappAuthStateStore.open()` 未在 `makeWASocket()` 前调用；
3. socket 未接收 repository-backed `creds` 与 `keys`；
4. socket 创建失败时没有 auth lease 可关闭；
5. adapter stop、socket replacement 和 terminal close 没有统一关闭 auth lease；
6. 完成原 Tasks 1–5 而不接线时，生产仍可继续走文件认证。

### GREEN 实现顺序

生产 socket 创建必须按以下顺序执行：

```text
1. 获取当前 account lifecycle writer generation
2. 创建不可复用 socketToken
3. whatsappAuthStateStore.open({ accountId, accountKey, generation, socketToken })
4. 得到 { state: { creds, keys }, saveCreds, epoch, close }
5. 在任何 socket 副作用前再次验证 generation/epoch/socketToken
6. makeWASocket({ auth: { creds, keys }, ... })
7. 只把该 lease 绑定到该 socket row
8. 事件处理通过同一 lease/saveCreds/repository 条件写入
```

生产路径必须删除或不可达以下调用：

```text
useMultiFileAuthState(authDirectory)
```

不允许以下回退：

- SQLite/Vault 不可用时继续使用认证目录；
- repository open 失败时创建匿名或半初始化 socket；
- 同一个 auth lease 绑定两个 socket generation；
- 新旧 socket 同时拥有认证写权。

### lease 关闭合同

`close()` 必须幂等，并在下列每条路径执行且最多生效一次：

- `makeWASocket()` 或后续 socket 初始化抛错；
- `connect()` 在 socket row 发布前失败；
- socket A 被 socket B 替换；
- `stop(accountId, ...)`；
- 用户主动 logout；
- `loggedOut`、`badSession`、`connectionReplaced`、`multideviceMismatch`、`forbidden` 等 terminal disposition；
- adapter shutdown；
- 账号删除；
- 进程有序停止。

transport retry、`restartRequired` 等需要重建 socket 的路径必须先关闭旧 lease，再为新 generation/token 打开新 lease；不能沿用旧 socketToken。

### GREEN 断言

- socket 创建前 `open()` 恰好一次；
- `makeWASocket.auth.creds/keys` 与该 lease 返回对象一致；
- 生产 `useMultiFileAuthState` 调用次数为零；
- socket 创建失败后 lease 关闭且数据库无额外写入；
- stop/replacement/terminal close 后旧 lease 的任何 creds/keys 写入均以 `WHATSAPP_AUTH_GENERATION_STALE` 或 `WHATSAPP_AUTH_LEASE_CLOSED` 拒绝；
- 同一 lease 重复关闭无副作用；
- 既有二维码、自动登录、收发消息、receipt recovery 和媒体恢复测试继续通过。

### 首批完成定义修订

首批只有同时满足以下条件才完成：

- Schema 23 已落地；
- CredentialVault-backed DEK/cipher 已落地；
- auth repository 与 Baileys AuthenticationState adapter 已落地；
- legacy import/logout tombstone 已落地；
- pre-write generation fence 已落地；
- **生产 socket 已切换到 repository-backed AuthenticationState；**
- **生产路径已不再调用 `useMultiFileAuthState`；**
- **所有 socket 生命周期路径已关闭对应 auth lease。**

Task 9 后续只保留 socket factory 的进一步职责隔离、缓存配置与非认证参数整理；不得再次推迟认证权威切换。

## 修订二：legacy auth import 改为持久化两阶段协议

### 被废止的原步骤

主计划 Task 4 中“先事务写入新 epoch + receipt，随后再次比较 manifest，变化则回滚”的描述作废。

SQLite 事务一旦提交，不能通过后续 rollback 撤销。任何把“提交后回滚”写进恢复协议的实现都必须被测试拒绝。

### 状态机

导入 receipt 至少包含以下持久状态：

```text
IMPORT_PENDING
STAGED
ACTIVATED
CLEANUP_REQUIRED
COMPLETED
FAILED
```

状态只能按冻结转换前进：

```text
IMPORT_PENDING -> STAGED -> ACTIVATED -> COMPLETED
                                  \-> CLEANUP_REQUIRED -> COMPLETED
IMPORT_PENDING -> FAILED
STAGED        -> FAILED
```

`ACTIVATED` 之后不得转换回 `IMPORT_PENDING`、`STAGED` 或文件权威。

### 持久化两阶段流程

#### Phase A：独占、发现与 staging

1. 在读取任何文件前取得 account-level writer exclusivity；该 exclusivity 覆盖整个 manifest 读取、staging 和激活前验证窗口。
2. 证明没有活跃 Baileys 文件 writer、socket lease 或并行 importer。
3. 计算 `manifestA`：相对路径、Git/文件类型约束、长度、内容 SHA-256 和排序文件集哈希。
4. 用短事务创建 `IMPORT_PENDING` receipt 和唯一 `stagedEpoch`；此时不得把账号状态设为 `ACTIVE`。
5. 读取、解析并按加密修订加密 creds/Signal keys，写入仅由 `receiptId + stagedEpoch` 可见的 staging rows。
6. 计算 `manifestB`。若 `manifestB != manifestA`：
   - 用短事务把 receipt 标记为 `FAILED`，记录结构化原因；
   - 删除或吊销 staging rows；
   - 保持旧目录为诊断输入而不是生产权威；
   - 不创建 socket，不激活 epoch。
7. 若 staging 完整且 `manifestB == manifestA`，用短事务把 receipt 从 `IMPORT_PENDING` 推进到 `STAGED`。

Phase A 的任何提交都只表示“导入尝试与 staging 已持久化”，不表示认证状态已经激活。

#### Phase B：最终验证与原子激活

1. 保持同一 writer exclusivity，激活前重新计算 `manifestC`。
2. 要求：

```text
manifestA == manifestB == manifestC
receipt.state == STAGED
stagedEpoch 尚未激活
账号没有更高 epoch
没有活跃 socket lease
```

3. 在一个短 SQLite 事务中完成：
   - 再次验证 receipt、epoch 和 writer fence；
   - 把 staged creds/keys 投影为新的 active epoch；
   - 写入 account auth state；
   - 把 receipt 推进为 `ACTIVATED`；
   - 写入激活审计/完整性哈希；
   - 使旧文件目录永久失去运行时读取资格。
4. 该激活事务失败时整体不提交，receipt 保持 `STAGED`，由确定性恢复逻辑重新验证后继续或标记 `FAILED`。
5. 该激活事务成功后，SQLite 是唯一认证权威；不得尝试“回滚到目录”。

### 激活后的目录清理

目录 rename/archive/delete 只在 `ACTIVATED` 提交后执行：

```text
legacy-auth-imported/<receipt-id>/
```

- 清理成功：receipt `ACTIVATED -> COMPLETED`；
- Windows 文件锁、权限或 rename 失败：receipt `ACTIVATED -> CLEANUP_REQUIRED`；
- cleanup retry 成功：`CLEANUP_REQUIRED -> COMPLETED`；
- cleanup retry 失败：保持 `CLEANUP_REQUIRED` 并暴露诊断，不影响 SQLite 继续作为唯一权威。

`credentialRecoveryService` 和 `whatsappAuthResolver` 必须先读取 activated receipt、logout tombstone 和 auth epoch，再决定是否扫描目录。存在 `ACTIVATED`、`CLEANUP_REQUIRED`、`COMPLETED`、`LOGGED_OUT` 或 quarantine 记录时，旧目录不得恢复账号。

### 崩溃恢复矩阵

必须覆盖：

- 创建 `IMPORT_PENDING` 后崩溃；
- staging 部分写入后崩溃；
- `STAGED` 提交后、manifestC 前崩溃；
- manifestC 后、激活事务前崩溃；
- 激活事务中崩溃；
- `ACTIVATED` 后、rename 前崩溃；
- rename 期间 Windows 文件锁；
- `CLEANUP_REQUIRED` 重启恢复；
- 同一目录并发启动两个 importer；
- 用户 logout 与 importer 竞争；
- 新 socket 启动与 importer 竞争。

每个故障点必须证明：

- 最多一个 active epoch；
- 最多一个 active auth writer；
- 未激活 staging 不可被 socket 读取；
- `ACTIVATED` 后目录不能复活；
- 无提交后回滚；
- 无文件/SQLite 长期双写；
- 不确定状态冻结发送。

## 修订后的首批路径要求

OSS-1A 首批精确授权在原计划与加密/调用图修订基础上，必须纳入以下真实接线路径和测试：

```text
backend/services/whatsappAdapter.js
backend/tests/oss1aWhatsappProductionAuthIntegration.test.js
backend/tests/oss1aWhatsappAuthLeaseLifecycle.test.js
backend/tests/oss1aWhatsappLegacyAuthImport.test.js
```

如创建 socket factory，则其精确路径也必须在授权文件中显式列出，不得用通配符补授权。

## 验证命令

计划中的运行时命令在获得精确授权后执行。至少包括：

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappProductionAuthIntegration.test.js \
  backend/tests/oss1aWhatsappAuthLeaseLifecycle.test.js \
  backend/tests/oss1aWhatsappLegacyAuthImport.test.js \
  backend/tests/oss1aWhatsappCredentialGeneration.test.js \
  backend/tests/batch39WhatsappSessionFence.test.js \
  backend/tests/whatsappQrChallenge.test.js \
  backend/tests/whatsappReceiptRecoveryRegression.test.js
```

## 治理真值

```text
runtimeBehaviorChanged=false
implementationAuthorized=false
executionAuthorized=false
buildAuthorized=false
productionUseAuthorized=false
mergeIntoMainAuthorized=false
formalRelease=false
publish=false
readyForPromotion=false
automaticNextWorkPackageAuthorization=false
temporaryBypassAllowed=false
warningOnlyClosureAllowed=false
```
