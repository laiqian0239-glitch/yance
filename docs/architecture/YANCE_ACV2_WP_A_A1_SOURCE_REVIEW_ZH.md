# Yance Architecture Closure V2 — WP-A Task A1 独立源码复审

## 1. 最终复审结论

**结论：APPROVED（经治理 Head 复验重开并再次闭环）**

- 工作包：WP-A
- 任务：A1 `INTRODUCE_SCHEMA_21_AND_PERSISTENT_AUTHORITY_WRITE_HOST_LEASE`
- 最终代码验证 Head：`22485f03bc52739b79bf3a5e354c2f7ffc67cf9d`
- 证据文件：`governance/architecture-closure-v2/wp-a-a1-evidence.json`
- 最终验证工作流：`ACV2 WP-A Architecture Gates` Run `30736290546`
- Ubuntu Job：`91465563418`，SUCCESS
- Windows Job：`91465563426`，SUCCESS
- 本复审只批准 A1，并只允许后续 A2 先提交失败测试；不批准 A3 及以后任务，不批准 WP-B 至 WP-H，不批准 Gate 1、候选包或发布。

## 2. 复审过程与重新打开记录

A1 首轮候选 Head `46fb99bdd81f62402e8157e3fa098d3fca2ab7e2` 在 Run `30736058708` 的 Ubuntu/Windows 均通过。随后，包含证据、复审文档和治理状态的 Head `c800dec2dcbe4ae905cfae5dc87cc4575a3d6f47` 触发最终复验 Run `30736147115`，其中 Windows Job `91465192517` 在旧 WP3 stale-fencing 回归进入 Outbox 断言前报错：

- `BOOT_RUNTIME_MUTEX_UNAVAILABLE`
- `Timed out acquiring Windows runtime mutex`
- AuthorityWriteHost/Schema 合同仍为 7/7 通过；
- 真实双进程矩阵仍为 2/2 通过；
- 历史回归为 21/22，通过失败发生在 Windows named mutex helper 握手阶段，而非 SQLite fencing 断言。

因此原批准被主动撤回，A1 治理状态重新打开，A2 授权被撤销。没有以候选 Head 的旧绿色结果覆盖最终治理 Head 的失败。

## 3. 最终复审范围

### 新增

- `backend/migrations/architectureClosureV2WpA.js`
- `backend/services/authorityWriteHost.js`
- `backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js`
- `backend/tests/architectureClosureV2/wpA/authorityWriteHostProcessMatrix.test.js`
- `backend/tests/architectureClosureV2/wpA/windowsRuntimeMutexPowerShell.test.js`
- `.github/workflows/acv2-wp-a.yml`

### 修改

- `backend/lib/r32SqliteStore.js`
- `backend/lib/sqliteConnectionBroker.js`
- `backend/lib/runtimeRoleGuard.js`
- `backend/runtime/AppRuntimeFactory.js`
- `backend/runtime/NamedRuntimeMutex.js`
- `tests/wp5/m5-sqlite-ownership.test.js`

`sqliteOwnership.js` 的既有进程级引用计数与 PID 身份机制被保留。本轮没有通过放宽超时、降低活性判定、跳过 Windows 回归或允许多写入者规避冲突。

## 4. TDD 与证据核验

### 4.1 A1 主体 RED

A1 主体测试在生产代码之前提交。RED Head `3ece409ddcabab43ea1c21fee1a2395a85d54855`、Run `30735524098` 同时暴露：

- Schema 21 缺失；
- AuthorityWriteHost 服务缺失；
- 主库进程角色边界缺失；
- 不可伪造 capability 边界缺失；
- 数据库 generation/fencing 缺失；
- 真实第二进程拒绝与强杀接管缺失。

失败来自目标功能未实现，不是语法、路径或测试启动错误。

### 4.2 Windows mutex helper RED

最终治理 Head 暴露 Windows helper 阻断后，先提交 `windowsRuntimeMutexPowerShell.test.js`。RED Head `2443b327bd4e5a4c112a6fa4cac6e0d5a4f63bc9`、Run `30736259095` 因 `resolveWindowsPowerShellExecutable` 不存在而失败，证明测试严格先于修复。

### 4.3 最终 GREEN

最终代码 Head `22485f03bc52739b79bf3a5e354c2f7ffc67cf9d` 的 Run `30736290546` 在 Ubuntu 与 Windows 均通过，每个平台包括：

- Windows PowerShell helper 选择合同：3/3；
- AuthorityWriteHost/Schema 合同：7/7；
- 真实进程竞争与 SIGKILL 接管：2/2；
- 旧 SQLite 所有权、Windows 路径和 stale-fencing 回归：22/22。

## 5. 架构核验

### 5.1 两层所有权模型

- sidecar 只负责启动排他与崩溃检测；
- `authority_write_host_lease` 的 `host_generation` 与 `fencing_token` 是数据库提交权威；
- Host 获取在 `BEGIN IMMEDIATE` 内以旧 generation/token 为条件执行 CAS；
- Store 事务入口在事务内部再次校验当前 Host token；
- `busy_timeout` 仅是 SQLite 等待参数，没有被当作串行化证明。

结论：PASS。

### 5.2 Schema 21

迁移 `021_architecture_closure_v2_wp_a` 为 forward-only、幂等、checksum-pinned，并覆盖 fresh bootstrap 与 Schema 20 upgrade。八个计划对象均存在，bootstrap metadata checksum 异常和迁移 checksum 异常均 fail closed。

结论：PASS。

### 5.3 能力与角色边界

- Host capability 使用 WeakSet 品牌，调用方不能伪造；
- Broker 在旧调用方尚未显式传递 capability 时，内部先取得真实 AuthorityWriteHost，而不是创建无权 Store；
- capability 与数据库路径必须完全一致；
- worker、channel、media、UAT、utility、renderer、secondary backend 与未知角色均不能取得主库 Host；
- AppRuntimeFactory 对带主库 Store 的运行时强制要求有效 Host capability/token。

结论：PASS。

### 5.4 进程竞争、强杀与时钟跳变

- 实际第二个 Node 后端在首 Host 存活时被拒绝；
- 首进程 SIGKILL 后，新 Host 可接管且 generation/token 严格递增；
- 老 Store 的迟到事务在 `BEGIN IMMEDIATE` 内被 `AUTHORITY_WRITE_HOST_FENCED` 拒绝；
- 时钟前跳和后跳均不能恢复旧 token；
- 单纯墙钟过期不能偷取仍存活 PID，只有死亡证据或可比进程身份确认 PID 复用才允许接管。

结论：PASS。

### 5.5 Windows named mutex helper

根因不是互斥超时策略不足，而是实现固定启动 legacy `powershell.exe`，在更新后的 Windows runner 镜像上偶发无法在既有 5 秒策略内完成 helper 握手，即使 PowerShell 7 已安装。

底层修复：

1. 显式配置 `YANCE_RUNTIME_POWERSHELL_EXE` 时必须验证文件真实存在，否则 fail closed；
2. 优先探测 `ProgramW6432` 与 `ProgramFiles` 下的 `PowerShell\\7\\pwsh.exe`；
3. 未安装 PowerShell 7 时保留 Windows PowerShell 5.1 `powershell.exe` 回退；
4. mutex acquire timeout 仍为 5000ms；
5. WP3 stale-fencing 测试未跳过，Windows 最终 22/22 通过。

结论：PASS。

## 6. 复审期间发现并闭环的问题

### A1-DOUBLE-ATTACH-SIDECAR-REFERENCE-LOSS

同一 Store 由 Store 构造和 Broker 各调用一次 `attachStore`。第二次调用曾错误释放最后一个进程级 sidecar 引用，使锁文件被删除，导致活着的第二进程可进入。

修复：同一 Store 的重复绑定严格幂等，仅重复校验数据库 token；不同 Store 仍 fail closed。

### A1-LEGACY-STALE-TAKEOVER-TEST-SEMANTICS

旧测试仅按墙钟超时接管，和“活 PID 不因时钟跳变被偷取”的安全规则冲突。

修复：测试明确提供 owner PID 已死亡的证据；没有改变生产活性算法，没有跳过测试。

### A1-WINDOWS-RUNTIME-MUTEX-HELPER-STARTUP

固定使用 Windows PowerShell 5.1 在新版 runner 上导致 helper 握手超时。

修复：优先真实存在的 PowerShell 7，保留显式校验路径和 5.1 回退；未增加超时，未禁用 mutex，未跳过 stale-fencing 回归。

## 7. 残余边界

A1 只建立物理写 Host、Schema 21 基础对象、fencing 与可靠的 Windows mutex helper。下列能力尚未由 A1 实现，也不得据此宣称 WP-A 完成：

- A2 canonical serialization、data classification、event type/upcaster registry；
- A3 AuthorityTransactionCoordinator 与 command protocol；
- A4 单一 CanonicalEventLedger append path；
- A5 IdentityAuthority；
- A6 全运行时启动顺序与 recovery command 化；
- A7 replay、snapshot、segment 与损坏处理；
- A8 WP-A 全量关闭与独立总复审。

全局 A0 source-closure 门禁在这些任务完成前继续保持 RED，是预期治理状态，不是 A1 回归失败。

## 8. 最终授权决定

- `A1=CLOSED`
- 仅授权下一任务：`A2_VERSIONED_CANONICAL_SERIALIZATION_AND_DATA_CLASSIFICATION`
- A2 必须先提交失败测试，再实现生产代码；本复审未批准 A2 生产实现立即开始。
- PR #5 必须保持 Draft。
- A3 至 A8、WP-B 至 WP-H、Gate 1、候选包和发布继续锁定。
