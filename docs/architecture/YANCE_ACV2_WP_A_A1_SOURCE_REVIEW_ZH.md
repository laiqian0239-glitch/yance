# Yance Architecture Closure V2 — WP-A Task A1 独立源码复审

## 1. 复审结论

**结论：APPROVED**

- 工作包：WP-A
- 任务：A1 `INTRODUCE_SCHEMA_21_AND_PERSISTENT_AUTHORITY_WRITE_HOST_LEASE`
- 代码候选 Head：`46fb99bdd81f62402e8157e3fa098d3fca2ab7e2`
- 证据文件：`governance/architecture-closure-v2/wp-a-a1-evidence.json`
- 验证工作流：`ACV2 WP-A Architecture Gates` Run `30736058708`
- Ubuntu Job：`91464957869`，SUCCESS
- Windows Job：`91464957871`，SUCCESS
- 本复审仅批准 A1；不批准 A3 及以后任务，不批准 WP-B 至 WP-H，不批准 Gate 1、候选包或发布。

## 2. 复审范围

### 新增

- `backend/migrations/architectureClosureV2WpA.js`
- `backend/services/authorityWriteHost.js`
- `backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js`
- `backend/tests/architectureClosureV2/wpA/authorityWriteHostProcessMatrix.test.js`
- `.github/workflows/acv2-wp-a.yml`

### 修改

- `backend/lib/r32SqliteStore.js`
- `backend/lib/sqliteConnectionBroker.js`
- `backend/lib/runtimeRoleGuard.js`
- `backend/runtime/AppRuntimeFactory.js`
- `tests/wp5/m5-sqlite-ownership.test.js`

`sqliteOwnership.js` 的既有进程级引用计数与 PID 身份机制被保留；本轮没有通过降低活性判定、缩短超时或允许多写入者规避冲突。

## 3. TDD 与证据核验

A1 测试在生产代码之前提交。RED Head `3ece409ddcabab43ea1c21fee1a2395a85d54855` 的 Run `30735524098` 同时暴露：Schema 21 缺失、Host 服务缺失、角色边界缺失、能力令牌缺失、数据库 generation/fencing 缺失及真实进程矩阵失败。失败来自目标功能未实现，不是语法、路径或测试启动错误。

最终候选 Head `46fb99bdd81f62402e8157e3fa098d3fca2ab7e2` 在 Ubuntu 和 Windows 均通过：

- AuthorityWriteHost/Schema 合同：7/7
- 真实进程竞争与强杀接管：2/2
- 旧 SQLite 所有权、Windows 路径和 stale-fencing 回归：22/22

## 4. 架构核验

### 4.1 两层所有权模型

- sidecar 继续只负责启动排他与崩溃检测；
- `authority_write_host_lease` 的 `host_generation` 与 `fencing_token` 成为数据库提交权威；
- Host 获取在 `BEGIN IMMEDIATE` 内以旧 generation/token 为条件执行 CAS；
- Store 的事务入口在事务内部再次校验当前 Host token；
- `busy_timeout` 仅是 SQLite 等待参数，没有被当作串行化证明。

结论：PASS。

### 4.2 Schema 21

迁移 `021_architecture_closure_v2_wp_a` 是 forward-only、幂等、checksum-pinned，并覆盖 fresh bootstrap 与 Schema 20 upgrade。八个计划对象均存在，bootstrap metadata checksum 异常和迁移 checksum 异常均 fail closed。

结论：PASS。

### 4.3 能力与角色边界

- Host capability 使用不可伪造的 WeakSet 品牌；
- Broker 在旧调用方尚未显式传递 capability 时，内部先取得真实 AuthorityWriteHost，而不是创建无权 Store；
- capability 与数据库路径必须完全一致；
- worker、channel、media、UAT、utility、renderer、secondary backend 与未知角色均不能取得主库 Host；
- AppRuntimeFactory 对带主库 Store 的运行时强制要求有效 Host capability。

结论：PASS。

### 4.4 进程竞争、强杀与时钟跳变

- 实际第二个 Node 后端在首 Host 存活时被拒绝；
- 首进程 SIGKILL 后，新 Host 可接管且 generation/token 严格递增；
- 老 Store 的迟到事务在 `BEGIN IMMEDIATE` 内被 `AUTHORITY_WRITE_HOST_FENCED` 拒绝；
- 时钟前跳和后跳均不能恢复旧 token；
- 单纯墙钟过期不能偷取仍存活 PID，只有死亡证据或可比进程身份确认 PID 复用才允许接管。

结论：PASS。

## 5. 复审期间发现并闭环的问题

### A1-DOUBLE-ATTACH-SIDECAR-REFERENCE-LOSS

首次实现中，同一 Store 由 Store 构造和 Broker 各调用一次 `attachStore`。第二次调用错误释放最后一个进程级 sidecar 引用，使锁文件被删除，导致活着的第二进程可进入。

修复：同一 Store 的重复绑定严格幂等，仅重复校验数据库 token；不同 Store 仍 fail closed。Ubuntu/Windows 真实进程矩阵已证明闭环。

### A1-LEGACY-STALE-TAKEOVER-TEST-SEMANTICS

旧测试仅按墙钟超时接管，和现行“活 PID 不因时钟跳变被偷取”的安全规则冲突。

修复：测试改为明确提供 owner PID 已死亡的证据；没有改变生产活性算法，没有跳过该测试。

## 6. 残余边界

A1 只建立物理写 Host、Schema 21 基础对象和 fencing。下列能力尚未由 A1 实现，也不得据此宣称 WP-A 完成：

- A2 canonical serialization、data classification、event type/upcaster registry；
- A3 AuthorityTransactionCoordinator 与 command protocol；
- A4 单一 CanonicalEventLedger append path；
- A5 IdentityAuthority；
- A6 全运行时启动顺序与 recovery command 化；
- A7 replay、snapshot、segment 与损坏处理；
- A8 WP-A 全量关闭与独立总复审。

全局 A0 source-closure 门禁在这些任务完成前继续保持 RED，是预期治理状态，不是 A1 回归失败。

## 7. 授权决定

- `A1=CLOSED`
- 仅授权下一任务：`A2_VERSIONED_CANONICAL_SERIALIZATION_AND_DATA_CLASSIFICATION`
- A2 必须继续先提交失败测试，再实现生产代码。
- PR #5 必须保持 Draft。
- WP-B 至 WP-H、Gate 1、候选包和发布继续锁定。
