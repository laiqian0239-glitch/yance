# Yance OSS-1A Baileys 生命周期底层整合实施计划

> **执行要求：** 使用 `superpowers:test-driven-development`、`superpowers:systematic-debugging`、`superpowers:verification-before-completion` 逐任务执行。任何测试放宽、错误吞没、重试次数调大、门禁降级或双写长期共存都不构成修复。

## 目标

在不改变 Yance 现有产品入口、账号身份、会话主键、消息存储、回复链路和发送队列合同的前提下，把 WhatsApp Web 运行时从“Baileys 示例级多文件认证 + 分散事件监听 + 粗粒度重连”重构为：

1. 由 Yance 唯一主 SQLite Store 持久化的 Baileys 认证状态；
2. 认证凭据、Signal keys、socket generation 和账号 lifecycle 之间存在可证明的单一写入权；
3. 同一 Baileys event batch 按固定次序处理，旧 socket 的迟到事件不能产生任何写入或副作用；
4. 对 `DisconnectReason` 做完整分类，明确区分可重连、必须重建 socket、会话失效、连接被替换、设备模式不匹配、禁止访问和服务暂不可用；
5. `getMessage` 与消息重试计数使用可索引、可恢复、跨 socket generation 的持久合同；
6. 用户主动登出后，旧认证目录和启动恢复不能重新激活该会话；
7. Linux、Windows、进程重启、崩溃点和旧目录迁移均有 RED→GREEN 证据。

## 当前基线

- Yance 精确基线 Head：`3b03df415cdb75770d4942648deca8bed202f1ef`
- 计划分支：`plan/oss-1a-baileys-lifecycle`
- 运行时实施分支：尚未授权、尚未创建
- Baileys 依赖：`@whiskeysockets/baileys@7.0.0-rc13`
- 上游登记提交：`8053b086ecc97ec3f78299561de11959bab05d39`
- OSS-0 PR：#20，保持 Draft，未授权合并
- WP-B PR：#17，保持冻结，不接收本工作包提交
- 本计划只读审计现有代码；本分支不得包含产品运行时代码修改

## 不可违反的约束

- Yance 已能启动、登录、收取消息、生成 AI 回复并发送；本工作包是稳定性底层重构，不是从零实现。
- 不引入第二个 WhatsApp 协议引擎。
- 不新建第二个常驻 SQLite Store。
- 不以 `useMultiFileAuthState` 继续作为生产认证权威。
- 不长期保留数据库与认证目录双写。
- 不使用分支通配符、文件路径通配符或自授权工作包。
- 不修改 PR #17，不启动其 Milestone 3。
- 不自动合并 PR #19、#20 或本工作包 PR。
- 不通过提高 timeout、增加 retry、忽略异常或把失败改为 warning 来关闭问题。
- 不把账号 `error`、`recovering`、`manual_review` 或认证不确定状态映射成可发送。
- 不删除既有真实功能来获得测试通过。

## 上游合同基准

以 Baileys 精确提交 `8053b086ecc97ec3f78299561de11959bab05d39` 为唯一实现对照：

- 上游 `useMultiFileAuthState` 源码明确声明不推荐生产使用，建议使用 SQL/NoSQL 认证状态。
- Signal key store 的 `get`/`set` 必须正确保存每次消息导致的 key 更新。
- 上游示例把 `msgRetryCounterCache` 放在 socket 外，避免 socket 重启后重试循环重新开始。
- 上游示例使用 `sock.ev.process()` 批量处理同一轮事件。
- `getMessage` 是消息重试与 poll update 的存储合同。
- 精确 `DisconnectReason` 包括：
  - `loggedOut = 401`
  - `multideviceMismatch = 411`
  - `connectionLost/timedOut = 408`
  - `connectionClosed = 428`
  - `connectionReplaced = 440`
  - `badSession = 500`
  - `unavailableService = 503`
  - `restartRequired = 515`
  - `forbidden = 403`

## 当前代码审计结论

### A. 认证状态仍是示例级多文件权威

`backend/services/whatsappAdapter.js` 直接调用 `baileys.useMultiFileAuthState(authDirectory)`，并把返回的 `state` 直接传给 socket。上游对该工具的定位是示例/机器人级文件存储，而不是生产权威。

后果：

- 单文件 mutex 不能提供跨 `creds.json` 与多个 Signal key 文件的事务提交；
- 进程崩溃可能留下不同代际的 creds/keys 组合；
- 目录复制恢复只能检查 `me.id/me.lid`，无法证明 key 集合完整；
- Yance 主 SQLite 所有权、账号 lifecycle saga 与认证状态更新不在同一事务边界。

### B. `creds.update` 存在写后代际校验

现有处理顺序：

```js
onSocket('creds.update', async update => {
  await saveCreds(update);
  socketGuard.assertCurrent(...);
  this.invalidateCredentialState(reference);
});
```

旧 socket 在异步处理期间被替换时，`saveCreds()` 已经写入认证目录，之后的 `assertCurrent()` 只能阻止缓存失效，不能撤销凭据污染。

这是 OSS-1A 首个必须以 RED 测试证明并修复的根缺陷。

### C. 事件监听有入口 fence，但没有 batch 提交合同

`createSocketGenerationGuard.wrap()` 能在 handler 开始前检查 socket，并能吞掉 handler 完成后的 `SOCKET_GENERATION_STALE`，但：

- 每个事件通过独立 `.on()` 注册；
- 同一 Baileys event batch 内 `creds.update`、`connection.update`、`messages.upsert`、`messages.update` 的顺序没有 Yance 层合同；
- handler 内第一个外部写入之前不一定再次检查 generation；
- `wrap()` 在旧 handler 已执行写入后只能忽略异常，无法回滚副作用。

### D. 关闭原因只区分 `loggedOut` 与“其他”

现有 `connection.update` 只判断：

```js
const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
```

其他所有原因进入同一种指数重连。这样会混淆：

- `restartRequired`：应立即重建 socket，但保留认证状态；
- `connectionReplaced`：本实例失去会话所有权，应隔离并等待显式接管；
- `badSession`：认证状态损坏，不应无限复用；
- `multideviceMismatch`：需要人工/受控重配；
- `forbidden`：不可自动重连；
- `unavailableService`：可延迟重连；
- `connectionLost/timedOut/connectionClosed`：可受 lifecycle 门禁重连。

### E. 没有 socket 外部消息重试计数权威

Yance 未向 socket 提供 `msgRetryCounterCache`。上游要求重试计数放在 socket 外，避免 socket 重建后循环重新计数。

### F. `getMessage` 是 O(n) 扫描并缺少精确索引合同

现有实现对候选会话分别执行 `listMessages(..., { limit: 5000 })` 再线性查找 `externalMessageId/id`。这不能证明：

- 大会话中的目标消息一定仍在 5000 条窗口内；
- companion/LID/PN 路由变化后仍命中同一远端消息；
- 进程重启后重试所需原始 Baileys message 一定存在；
- 远端 message key 与存储行是一对一索引。

### G. 主动登出仍保留可被恢复逻辑识别的目录

`stop(accountId, true)` 调用 `socket.logout()`，但没有删除或吊销 WhatsApp 认证状态。`readCredentialState()` 只要 `creds.me.id/me.lid` 存在就判定 `usable=true`；`credentialRecoveryService` 之后可把该目录作为可恢复凭据重新创建或恢复账号。

主动登出必须形成持久 tombstone/epoch，旧目录不得重新成为认证权威。

### H. 目录迁移缺少与活跃写入者的共同快照合同

`copyDirectoryAtomically()` 对目标替换是原子的，但复制源目录时没有与 Baileys 文件写锁共享同一互斥量，不能证明复制的是同一代际快照。迁移必须发生在 socket 建立前，并以一次性导入事务结束文件权威。

## 目标架构

```text
AccountManager / lifecycle saga
          │
          ▼
WhatsAppAdapter ── one authoritative account runtime row
          │
          ├── SocketGenerationLease
          │      generation + socket identity + auth epoch
          │
          ├── BaileysEventProcessor
          │      sock.ev.process(batch)
          │      deterministic phase ordering
          │
          ├── WhatsAppAuthStateStore
          │      AuthenticationState adapter
          │      BufferJSON serialization
          │      generation-fenced transaction
          │
          ├── WhatsAppDisconnectPolicy
          │      exact DisconnectReason disposition
          │
          ├── WhatsAppMessageRetryStore
          │      CacheStore contract, outside socket
          │
          └── WhatsAppMessageLookupRepository
                 indexed getMessage(key)

All writes
   ↓
Repository layer
   ↓
Single primary R32SqliteStore
   ↓
AuthorityWriteHost + SQLite ownership + transaction coordinator
```

## 数据合同

### `whatsapp_auth_accounts`

每个稳定 WhatsApp auth key 一行：

```text
account_key TEXT PRIMARY KEY
account_id TEXT NOT NULL
current_epoch INTEGER NOT NULL CHECK(current_epoch >= 1)
state TEXT NOT NULL CHECK(state IN ('ACTIVE','LOGGED_OUT','QUARANTINED','IMPORT_PENDING'))
creds_json TEXT NOT NULL
creds_sha256 TEXT NOT NULL CHECK(length(creds_sha256)=64)
registered INTEGER NOT NULL CHECK(registered IN (0,1))
identity_jid TEXT NOT NULL DEFAULT ''
writer_generation INTEGER NOT NULL CHECK(writer_generation >= 0)
writer_socket_token TEXT NOT NULL DEFAULT ''
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
logged_out_at TEXT NOT NULL DEFAULT ''
quarantine_reason TEXT NOT NULL DEFAULT ''
```

### `whatsapp_auth_keys`

```text
account_key TEXT NOT NULL
category TEXT NOT NULL
key_id TEXT NOT NULL
value_json TEXT
value_sha256 TEXT NOT NULL
epoch INTEGER NOT NULL
updated_at TEXT NOT NULL
PRIMARY KEY(account_key, category, key_id)
FOREIGN KEY(account_key) REFERENCES whatsapp_auth_accounts(account_key) ON DELETE CASCADE
```

`value_json IS NULL` 表示删除；删除与更新必须在同一 `keys.set()` 事务内完成。

### `whatsapp_auth_import_receipts`

记录旧目录一次性导入：源目录哈希、文件清单哈希、目标 epoch、导入状态、失败原因、完成时间。成功后文件目录只作为加密/隔离备份，不再参与运行时读取。

### `whatsapp_message_retry_counters`

实现 Baileys `CacheStore`：

```text
account_key TEXT NOT NULL
cache_key TEXT NOT NULL
value_json TEXT NOT NULL
expires_at TEXT NOT NULL
updated_at TEXT NOT NULL
PRIMARY KEY(account_key, cache_key)
```

该表只服务 Baileys retry counter，不替代 Yance Outbox。

### `whatsapp_message_key_index`

```text
account_id TEXT NOT NULL
remote_jid TEXT NOT NULL
message_id TEXT NOT NULL
participant TEXT NOT NULL DEFAULT ''
from_me INTEGER NOT NULL CHECK(from_me IN (0,1))
conversation_id TEXT NOT NULL
local_message_id TEXT NOT NULL
raw_message_json TEXT NOT NULL
raw_message_sha256 TEXT NOT NULL
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
PRIMARY KEY(account_id, remote_jid, message_id, participant, from_me)
```

该索引只负责 Baileys `getMessage`，不成为第二个消息权威；外键/一致性检查必须绑定现有 canonical message 行。

## Event batch 固定顺序

同一 `sock.ev.process(events)` 回调按以下阶段执行：

1. 在任何写入前验证 socket lease、generation、auth epoch；
2. `creds.update` 和 Signal key 已由 `AuthenticationState.keys.set()` 在调用时事务提交；`creds.update` 再提交 creds，提交条件包含同一 generation/epoch；
3. `connection.update`；
4. `messaging-history.set`；
5. `messages.upsert`；
6. `messages.update` / receipts / reactions；
7. contacts/chats/presence/lid mapping；
8. 在每个异步边界后的首个写入前再次验证 lease；
9. 任一阶段失败必须返回结构化错误并留下可重放/可诊断状态，不能继续执行依赖该阶段的后续写入。

不要把整个 batch 包进一个长期 SQLite 事务；网络、媒体和头像 I/O 必须在事务外。每个数据库提交使用短事务和 generation 条件更新。

## Disconnect disposition 合同

| Baileys 原因 | Yance disposition | 自动重连 | 认证处理 |
|---|---|---:|---|
| `restartRequired` | `REBUILD_SOCKET` | 立即、单次受控 | 保留 epoch |
| `connectionLost` / `timedOut` / `connectionClosed` | `RETRYABLE_TRANSPORT` | lifecycle 允许时退避 | 保留 epoch |
| `unavailableService` | `RETRYABLE_SERVICE` | 较长退避 | 保留 epoch |
| `connectionReplaced` | `OWNERSHIP_LOST` | 否 | quarantine，要求显式接管 |
| `loggedOut` | `LOGGED_OUT` | 否 | epoch tombstone，清除 keys |
| `badSession` | `BAD_SESSION` | 否 | quarantine，禁止旧状态重用 |
| `multideviceMismatch` | `DEVICE_MODE_MISMATCH` | 否 | quarantine，显式重新授权 |
| `forbidden` | `FORBIDDEN` | 否 | quarantine，保留诊断证据 |
| 未知 | `UNKNOWN_CLOSE` | 否，先进入不确定态 | 不修改 auth，冻结发送 |

## 工作包授权前置任务

### Task 0：建立 OSS-1A 精确授权链

**文件：**

- Create: `governance/open-source-acceleration/oss-1a-implementation-authorization.json`
- Create: `governance/open-source-acceleration/oss-1a-authorization-receipt.json`
- Modify: `shared/release/openSourceWorkPackagePolicy.js`
- Modify: `tools/wp0/work-package-scope-gate.js`
- Modify: `tests/wp0/open-source-work-package-authorization.test.js`
- Create: `tests/wp0/open-source-work-package-oss1a-authorization.test.js`

**步骤 1：先写 RED 测试**

证明当前硬编码 OSS-0 authority 不能授权 OSS-1A，并证明下列危险方案必须失败：

- `oss/*` 分支通配；
- `backend/services/whatsapp*.js` 路径通配；
- authorization 与 implementation 同一提交；
- receipt 不绑定 authorization blob；
- authorization commit 不是 implementation Head 的祖先；
- 自动授权下一个工作包；
- `readyForPromotion=true`；
- 修改 PR #17 路径；
- 未列明 schema migration、tests、workflow 的扩展路径。

运行：

```bash
node --test --test-concurrency=1 \
  tests/wp0/open-source-work-package-authorization.test.js \
  tests/wp0/open-source-work-package-oss1a-authorization.test.js
```

期望：OSS-1A 合法样例在当前实现失败；全部恶意样例保持失败。

**步骤 2：把 authority 从“硬编码单个 OSS-0”重构为封印记录集合**

要求：

- 每个工作包仍是精确 branch + 精确 path set；
- authority 文件必须由父计划分支先提交；
- receipt 绑定 authorization commit/blob/file hash；
- gate 按 exact branch 选择唯一 authority；
- 多个 authority 不能同时匹配；
- 历史 OSS-0 字节与行为保持不变；
- 不允许目录扫描后“自动信任”任意新 JSON；仅允许受治理 registry 中列明的 authority 文件。

**步骤 3：GREEN 与 mutation**

运行：

```bash
npm run test:wp0
node --test --test-concurrency=1 tests/wp0/*.test.js
```

**步骤 4：提交**

```bash
git commit -m "governance(oss1a): seal exact Baileys lifecycle scope"
```

未完成 Task 0 前，不创建运行时实施分支。

## 运行时实施任务

### Task 1：新增 Schema 23 认证状态合同

**文件：**

- Create: `backend/migrations/oss1aWhatsappAuthState.js`
- Modify: `backend/lib/r32SqliteStore.js`
- Create: `backend/tests/oss1aWhatsappAuthSchema.test.js`
- Create: `backend/tests/oss1aWhatsappAuthMigrationFaultMatrix.test.js`

**RED 测试：**

1. Schema 22 打开后不存在认证表；
2. migration 中任一点抛错，schema version 不得前移；
3. 重放 migration 幂等；
4. checksum 不一致 fail closed；
5. 表列、PK、FK、CHECK、索引必须精确匹配；
6. `account_key` 删除必须级联 keys/retry/index；
7. 旧二进制打开 Schema 23 必须拒绝降级；
8. 非 AuthorityWriteHost 不能写入。

**实现：**

- `MIGRATION_ID = '023_oss1a_whatsapp_auth_state'`
- `TARGET_SCHEMA_VERSION = 23`
- 使用现有 `r32_schema_migrations`、checksum、schema backup/rollback 合同；
- 不修改 Schema 22 的冻结定义；
- 迁移必须由 `R32SqliteStore.ensureSchema()` 统一调用；
- 所有表为 `STRICT`；
- 所有时间为 ISO；
- 为 auth account state/epoch、retry expiry 和 message key lookup 建索引。

**验证：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappAuthSchema.test.js \
  backend/tests/oss1aWhatsappAuthMigrationFaultMatrix.test.js \
  backend/tests/accountRepositoryConcurrency.test.js
```

**提交：**

```bash
git commit -m "feat(oss1a): add transactional WhatsApp auth schema"
```

### Task 2：实现 repository 层原子认证状态

**文件：**

- Create: `backend/repositories/whatsappAuthStateRepository.js`
- Create: `backend/tests/oss1aWhatsappAuthRepository.test.js`
- Create: `backend/tests/oss1aWhatsappAuthRepositoryCrashMatrix.test.js`

**接口：**

```js
loadAccount(accountKey)
initializeAccount(input)
commitCreds(input)
getKeys(accountKey, epoch, category, ids)
setKeys(input)
markLoggedOut(input)
quarantine(input)
assertWriter(input)
importLegacySnapshot(input)
```

每个写接口必须包含：

```text
accountKey
expectedEpoch
expectedWriterGeneration
expectedSocketToken
```

条件不匹配返回 `WHATSAPP_AUTH_GENERATION_STALE`，且 `changes=0`。

**RED 测试：**

- socket A 读 epoch 3，socket B 晋升 generation 后，A 的 creds/keys 写入全部被拒绝；
- `keys.set()` 中多个 category/id 同一事务提交；
- 中途异常后所有 key 保持旧值；
- delete 与 set 原子；
- creds SHA 与内容不一致拒绝；
- logged-out epoch 不允许重新 `ACTIVE`，除非显式创建新 epoch；
- quarantine 不允许发送就绪；
- 两个并发 writer 只有一个 generation 获胜；
- ownership heartbeat 丢失后写入 fail closed。

**实现注意：**

- repository 只能通过 `backend/repositories/storeProvider.js` 获得主 Store capability；
- 不缓存 raw `DatabaseSync`；
- 不把 auth JSON 写入日志；
- 使用 Baileys `BufferJSON` 兼容序列化后再做 canonical hash；
- 写事务短小，不包含网络 I/O。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappAuthRepository.test.js \
  backend/tests/oss1aWhatsappAuthRepositoryCrashMatrix.test.js

git commit -m "feat(oss1a): add generation-fenced auth repository"
```

### Task 3：实现 Baileys `AuthenticationState` 适配器

**文件：**

- Create: `backend/services/whatsappAuthStateStore.js`
- Create: `backend/tests/oss1aWhatsappAuthStateStore.test.js`
- Modify: `third_party/provenance.json`
- Modify: `THIRD_PARTY_NOTICES.md`

**接口：**

```js
open({ accountId, accountKey, generation, socketToken })
// => { state: { creds, keys }, saveCreds, close, epoch }
```

**RED 测试：**

- 空账号使用 `initAuthCreds()` 初始化；
- `app-state-sync-key` 读出时恢复为 `proto.Message.AppStateSyncKeyData`；
- Buffer/Uint8Array 经 `BufferJSON` round trip；
- `keys.get()` 按请求 ids 返回；
- `keys.set()` 同一调用原子提交；
- stale generation 在第一次数据库写之前失败；
- `saveCreds()` stale generation 零写入；
- `close()` 后所有写入失败；
- auth 内容不得出现在错误 message/log metadata。

**实现：**

- 不复制上游整文件；只按 MIT 合同实现 Yance repository adapter；
- provenance 记录精确上游源路径：`src/Utils/use-multi-file-auth-state.ts`、`src/Types/Auth.ts`；
- `state.keys` 直接调用 repository；
- `saveCreds()` 只接收当前内存 creds 的快照，不依赖事件 payload；
- 所有 repository 调用前验证 local lease，repository 内再次条件更新。

**验证与提交：**

```bash
node --test --test-concurrency=1 backend/tests/oss1aWhatsappAuthStateStore.test.js
node tools/third-party/verify-provenance.js

git commit -m "feat(oss1a): replace file auth with primary-store adapter"
```

### Task 4：旧认证目录一次性导入与登出 tombstone

**文件：**

- Modify: `backend/services/whatsappAuthResolver.js`
- Modify: `backend/services/credentialRecoveryService.js`
- Create: `backend/services/whatsappLegacyAuthImporter.js`
- Create: `backend/tests/oss1aWhatsappLegacyAuthImport.test.js`
- Modify: `backend/tests/whatsappOrphanAccountReconciliation.test.js`

**RED 测试：**

- 仅有 `me.id` 但缺少关键 Signal 状态的目录不能直接判定为 active；
- 同一源目录只能产生一个成功 receipt；
- 导入发生在 socket 建立前；
- 文件清单/内容在导入过程中变化时，导入失败并保留 `IMPORT_PENDING`；
- 数据库提交成功、目录归档失败时，数据库仍是唯一权威，状态进入 cleanup-required，不回退双写；
- 主动 logout 后旧目录扫描不得恢复账号；
- `badSession` quarantine 后旧目录不得自动复用；
- Windows rename/文件锁失败产生明确恢复状态。

**实现：**

1. 连接前关闭该 account 的文件写入入口；
2. 读取并稳定两次计算目录 manifest hash；
3. 通过 Baileys `BufferJSON` 解析 creds/keys；
4. 单事务写入新 epoch + import receipt；
5. 再次比较 manifest hash；变化则回滚；
6. 成功后把目录重命名到 `legacy-auth-imported/<receipt-id>`；
7. `resolveAuthLocation()` 只负责发现/诊断，不再返回生产运行时 auth state；
8. logout 写入 `LOGGED_OUT` tombstone 并清除 keys/retry counters；
9. 自动恢复查询 tombstone，禁止旧目录 resurrection。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappLegacyAuthImport.test.js \
  backend/tests/whatsappOrphanAccountReconciliation.test.js

git commit -m "feat(oss1a): make legacy auth import one-way and tombstoned"
```

### Task 5：socket lease 与认证写入前 fence

**文件：**

- Modify: `backend/services/sessionGenerationFence.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/tests/batch39WhatsappSessionFence.test.js`
- Create: `backend/tests/oss1aWhatsappCredentialGeneration.test.js`

**首个必须 RED 的真实缺陷：**

构造 socket A：

1. A 收到 `creds.update`；
2. handler 在第一次写入前等待；
3. socket B 替换 A 并获得更高 generation；
4. 恢复 A handler；
5. 断言 repository 写调用次数为 0，数据库仍为 B 的 epoch/generation。

当前代码会在 guard 再检查前执行 `saveCreds()`，该测试必须失败。

**实现：**

- `SessionGenerationFence` 增加不可变 `generation/epoch/socketToken` 详情；
- 提供 `guard.runWrite(details, writer)`：调用 writer 前 assert，writer 的 repository 条件仍再次验证；
- `creds.update` 改为先 guard、再 `saveCreds()`；
- 所有 event handler 的首次副作用前使用同一 primitive；
- 不通过 catch 后静默忽略非 stale 错误；
- stale 事件返回结构化 quarantine 结果并计数，但不得写日志中的 auth 数据。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/batch39WhatsappSessionFence.test.js \
  backend/tests/oss1aWhatsappCredentialGeneration.test.js

git commit -m "fix(oss1a): fence credentials before every persistent write"
```

### Task 6：单一 Baileys event batch processor

**文件：**

- Create: `backend/services/whatsappBaileysEventProcessor.js`
- Modify: `backend/services/whatsappAdapter.js`
- Create: `backend/tests/oss1aWhatsappEventBatch.test.js`
- Modify: `backend/tests/whatsappReceiptRecoveryRegression.test.js`

**RED 测试：**

- 同一 batch 同时含 creds、connection open、history、message，处理顺序固定；
- creds 提交失败时，不执行依赖新认证状态的 connection/message 副作用；
- history 单条失败不丢失整批可重放标识；
- socket 替换发生在 batch 阶段之间时，后续阶段零副作用；
- `messages.upsert` 每条消息仍独立 receipt/idempotency；
- handler 拒绝时没有 unhandled rejection；
- 同一 batch 只创建一个上下文/trace/generation 记录。

**实现：**

- 使用 `socket.ev.process(async events => ...)`，删除同一事件的独立 `.on()` 注册；
- processor 接收依赖注入的 handlers，不把 2000 行 adapter 整体复制；
- 每个阶段返回 `{ ok, committed, replayRequired, reasonCode }`；
- 保留现有 normalize、receipt、messageStore、media recovery 行为；
- 事件顺序和失败策略写成冻结常量并测试。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappEventBatch.test.js \
  backend/tests/whatsappReceiptRecoveryRegression.test.js \
  backend/tests/batch39WhatsappSessionFence.test.js

git commit -m "refactor(oss1a): process Baileys events through one generation batch"
```

### Task 7：完整 DisconnectReason 状态机

**文件：**

- Create: `backend/services/whatsappDisconnectPolicy.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/services/platformDriverRegistry.js`
- Modify: `backend/services/accountManager.js`
- Create: `backend/tests/oss1aWhatsappDisconnectPolicy.test.js`
- Create: `backend/tests/oss1aWhatsappReconnectOwnership.test.js`
- Modify: `backend/tests/accountLifecycleRegression.test.js`

**RED 测试：**

对所有精确状态码做表驱动断言：

- disposition；
- 是否自动重连；
- 是否保留/递增/吊销 auth epoch；
- account public state；
- `canAttemptSend/canReceive`；
- 是否需要 manual review；
- reconnect timer 数量最多一个；
- `connectionReplaced` 不得自动夺回；
- `restartRequired` 只能重建一次，并沿用同一 epoch；
- 未知关闭原因冻结发送，不按普通网络错误重连。

**实现：**

- 纯函数 `classifyDisconnect({ statusCode, error, stopping, startupTimedOut })`；
- `WhatsAppAdapter` 只执行 policy disposition；
- reconnect timer 包含 expected generation/epoch，触发时双重校验；
- `AccountManager` 不把不确定态映射成可发送；
- `platformDriverRegistry.mapWhatsAppState` 增加明确状态，不再把所有 offline 映射为 error 后丢失 reason。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappDisconnectPolicy.test.js \
  backend/tests/oss1aWhatsappReconnectOwnership.test.js \
  backend/tests/accountLifecycleRegression.test.js

git commit -m "fix(oss1a): classify every Baileys disconnect outcome"
```

### Task 8：持久 retry counter 与精确 `getMessage`

**文件：**

- Create: `backend/repositories/whatsappMessageRetryRepository.js`
- Create: `backend/services/whatsappMessageRetryStore.js`
- Create: `backend/repositories/whatsappMessageKeyIndexRepository.js`
- Modify: `backend/services/whatsappAdapter.js`
- Modify: `backend/repositories/messageRepository.js`
- Create: `backend/tests/oss1aWhatsappRetryStore.test.js`
- Create: `backend/tests/oss1aWhatsappGetMessage.test.js`
- Modify: `backend/tests/messageIdentityEvidenceOrdering.test.js`

**RED 测试：**

- CacheStore `get/set/del/flushAll/close` 精确合同；
- socket 重建后 retry count 仍存在；
- TTL 到期清理；
- account A 不能读取 B 的 counter；
- `getMessage` 通过完整 remote key 精确命中；
- 相同 message id、不同 chat 不冲突；
- LID/PN alias 归一后命中 canonical message；
- 大于 5000 条消息时仍命中；
- raw message hash 不匹配时拒绝返回；
- revoke/删除后返回 undefined；
- lookup 索引与 canonical message 写入同一事务或有可证明 repair receipt。

**实现：**

- 传入 socket：`msgRetryCounterCache`；
- `getMessage` 只调用精确索引 repository，不再扫描 5000 行；
- message ingest 时同步维护 key index；
- local persistence repair 同时修复 key index；
- retry store 不成为 Outbox，不决定业务重发。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappRetryStore.test.js \
  backend/tests/oss1aWhatsappGetMessage.test.js \
  backend/tests/messageIdentityEvidenceOrdering.test.js

git commit -m "feat(oss1a): persist Baileys retry and message lookup contracts"
```

### Task 9：整合 socket 创建与缓存

**文件：**

- Modify: `backend/services/whatsappAdapter.js`
- Create: `backend/services/whatsappSocketFactory.js`
- Create: `backend/tests/oss1aWhatsappSocketFactory.test.js`
- Modify: `backend/tests/whatsappQrChallenge.test.js`
- Modify: `backend/tests/platformProductionReadinessAuthority.test.js`

**实现要求：**

`whatsappSocketFactory` 负责且只负责组装：

```js
{
  auth: {
    creds: authState.creds,
    keys: makeCacheableSignalKeyStore(authState.keys, redactedLogger)
  },
  msgRetryCounterCache,
  getMessage,
  version,
  browser,
  syncFullHistory,
  shouldSyncHistoryMessage,
  generateHighQualityLinkPreview,
  markOnlineOnConnect: false
}
```

- logger 必须脱敏；
- 不记录 JID、auth key 内容或 message payload；
- socket factory 不拥有 reconnect；
- adapter 是唯一 socket row owner；
- socket 创建失败关闭 auth lease；
- `fetchLatestBaileysVersion()` 失败时使用已封印兼容版本并记录可诊断原因，不能静默换版本；
- profile-picture patch 仍绑定精确 rc13 provenance，不随意取消。

**验证与提交：**

```bash
node --test --test-concurrency=1 \
  backend/tests/oss1aWhatsappSocketFactory.test.js \
  backend/tests/whatsappQrChallenge.test.js \
  backend/tests/platformProductionReadinessAuthority.test.js

git commit -m "refactor(oss1a): isolate authoritative Baileys socket construction"
```

### Task 10：进程崩溃、Windows 和恢复矩阵

**文件：**

- Create: `tools/oss1a/whatsapp-auth-crash-matrix.js`
- Create: `tools/oss1a/whatsapp-generation-concurrency-matrix.js`
- Create: `tests/oss1a/whatsapp-auth-crash-matrix.test.js`
- Create: `tests/oss1a/whatsapp-generation-concurrency-matrix.test.js`
- Create: `.github/workflows/oss1a-whatsapp-lifecycle.yml`
- Modify: `package.json`

**故障注入点：**

1. auth account row 插入后、keys 前；
2. keys 批量写中间；
3. creds 更新后、commit 前；
4. legacy import DB commit 前；
5. legacy import DB commit 后、目录 rename 前；
6. logout tombstone 写入前/后；
7. socket A creds handler 等待期间 socket B 接管；
8. reconnect timer 触发前 generation 改变；
9. retry counter 写入后进程退出；
10. message row 写入后 key index 失败；
11. SQLite ownership heartbeat 丢失；
12. Windows 文件锁阻止旧目录归档。

每个点验证：

- 数据库一致性；
- 无两个 active writer；
- 不自动发送；
- 不复活 logged-out 账号；
- 下一次启动得到确定状态；
- repair 是持久、幂等、可审计的；
- 无 warning-only 成功。

**脚本：**

```json
{
  "test:oss1a": "node --test --test-concurrency=1 backend/tests/oss1a*.test.js tests/oss1a/*.test.js",
  "test:oss1a:crash": "node tools/oss1a/whatsapp-auth-crash-matrix.js",
  "test:oss1a:concurrency": "node tools/oss1a/whatsapp-generation-concurrency-matrix.js",
  "verify:oss1a": "npm run test:oss1a && npm run test:oss1a:crash && npm run test:oss1a:concurrency && npm run verify:wp0"
}
```

Workflow 必须运行 Ubuntu 与 Windows；任何平台失败均阻断。

**提交：**

```bash
git commit -m "test(oss1a): add cross-platform auth lifecycle fault gates"
```

### Task 11：相关既有回归与 Source UAT

**必须运行：**

```bash
npm run verify:oss1a
node --test --test-concurrency=1 \
  backend/tests/batch39WhatsappSessionFence.test.js \
  backend/tests/batch40ChannelAbortPropagation.test.js \
  backend/tests/whatsappReceiptRecoveryRegression.test.js \
  backend/tests/whatsappQrChallenge.test.js \
  backend/tests/whatsappCanonicalGuardRegression.test.js \
  backend/tests/whatsappMediaRecoveryClosure.test.js \
  backend/tests/whatsappOrphanAccountReconciliation.test.js \
  backend/tests/accountLifecycleRegression.test.js \
  backend/tests/platformProductionReadinessAuthority.test.js
npm run preflight:source-uat:p0
npm run test:source-uat-delivery
npm run test:uat-diagnostics
node tools/third-party/verify-provenance.js
```

**Source UAT 保护项：**

- 已有账号无需重新扫码完成自动登录；
- 新账号 QR 正常生成；
- 收取文本、媒体、reaction、revoke；
- AI 回复链正常；
- 文本/媒体发送正常；
- 发送后的本地持久化修复仍工作；
- 手动断网恢复；
- `restartRequired` 恢复；
- 用户 logout 后重启不复活；
- Windows 退出后数据库与认证状态无锁残留；
- 旧 auth 目录只导入一次。

真实 WhatsApp/Windows UAT 只有在可访问真实账号和 Windows runner 时执行。环境不可访问时必须明确标为未验证，不得用模拟测试替代真实结论。

### Task 12：独立审查与封印证据

**文件：**

- Create: `governance/open-source-acceleration/oss-1a-implementation-evidence.json`
- Create: `governance/open-source-acceleration/oss-1a-review-receipt.json`

证据必须绑定：

- exact base SHA；
- exact head SHA；
- exact sorted file set SHA-256；
- schema migration checksum；
- Baileys upstream commit；
- Linux/Windows run IDs 和 job IDs；
- RED commit 与失败断言；
- GREEN commit；
- CodeRabbit/独立审查线程处置；
- 真实 Windows/WhatsApp UAT 状态；
- `runtimeBehaviorChanged=true`；
- `productionUseAuthorized=false`；
- `mergeIntoMainAuthorized=false`；
- `formalRelease=false`；
- `publish=false`；
- `temporaryBypassAllowed=false`；
- `warningOnlyClosureAllowed=false`。

**审查重点：**

- stale socket 是否能在任何路径写 creds/keys；
- auth epoch 是否能被旧目录复活；
- logout/badSession/connectionReplaced 是否 fail closed；
- migration 崩溃是否可恢复；
- key index 是否可能与 message authority 漂移；
- retry cache 是否会触发业务重复发送；
- 是否引入第二 Store、第二 socket owner 或长期双写；
- 是否泄露 auth/JID/message 到日志或证据。

没有独立审查结论，不标记 ready for review；没有明确用户授权，不合并。

## 首个实施批次边界

授权后第一批仅执行 Task 1–5：

1. Schema 23；
2. auth repository；
3. AuthenticationState adapter；
4. legacy import/logout tombstone；
5. pre-write generation fence。

该批次关闭“认证状态与 socket generation 不一致”根问题。Task 6–10 在第一批审查通过后继续，避免在一个未验证提交中同时改认证、事件、重连和消息恢复。

## 明确不采用的方案

- 继续调用 `useMultiFileAuthState`，只在外面再加 mutex；
- `creds.update` 写完后再检查 generation；
- stale 事件 catch 后不报错但允许写入；
- 把认证目录定时备份当持久化；
- 提高 reconnect delay 或 max retry 作为修复；
- 对全部非 401 关闭统一自动重连；
- logout 只改账号 UI 状态但保留可恢复认证；
- 新建独立 SQLite auth DB；
- 在 PR #17 上实现；
- 为了减少变更而保留长期文件/数据库双写；
- 直接复制整个 Baileys 示例或第三方 WhatsApp server。

## 完成定义

OSS-1A 只有同时满足以下条件才可称为技术完成：

- 所有认证写入在首次副作用前通过 generation/epoch fence；
- `useMultiFileAuthState` 从生产运行路径移除；
- 单一主 SQLite Store 是认证权威；
- 旧目录一次性导入且不能 resurrection；
- 全部 DisconnectReason 有确定 disposition；
- batch event processor 有固定顺序；
- retry counter 位于 socket 外并可恢复；
- `getMessage` 使用精确索引；
- Linux/Windows 永久门禁通过；
- 相关既有回归通过；
- 真实 UAT 状态如实记录；
- 独立审查无未解决实质线程；
- PR 保持 Draft，直到用户明确授权下一治理动作。
