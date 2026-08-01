# FIX6J 隔离模型 Worker 去 SQLite 化设计

## 1. 状态与源码基线

- 设计版本：FIX6J
- 唯一源码基线：`YANCE_FIX6I_SOURCE.zip`
- 基线 ZIP SHA256：`850f9ea4e068235cdc1451f93346e67dc9a30d7f0c50397f10cec6936a79d4da`
- 随附 `.sha256` 校验结果：匹配
- FIX6I 派生版本：`FIX6I_MODEL_PROJECTION_LAYOUT_DIAGNOSTIC_AUTHORITY_V1`
- FIX6I `baseCommit`：`91096c2eb1a9e289b1a68b351a326166cf9c379d`
- 禁止用 GitHub `main` 或其他源码树覆盖、回退或替换本基线。
- 本基线是无 `.git` 元数据的源码交付包；FIX6J 的源码身份必须从上述 ZIP 哈希派生，而不是从工作区 Git 历史推断。

## 2. 问题陈述与证据

Windows 诊断 `Yance-Diagnostics-2026-08-01T04-19-18-479Z.json` 显示，隔离模型执行连续以 `worker-nonzero-exit` 和 `WORKER_EXIT_CODE_1` 终止，且 `workerStarted: false`。`stderrTail` 的根因是 `SQLITE_OWNERSHIP_CONFLICT`：主 Yance 进程已合法持有 `yance-r32.db`，隔离 Worker 在应用协议就绪前又尝试创建 `R32SqliteStore`。

FIX6I 源码中的加载链为：

`modelExecutionWorker -> modelExecutor -> securityGuardSingleton -> systemPolicy -> SqliteDocumentStore -> R32SqliteStore`

主进程持有 SQLite 是正确行为。缺陷是隔离 Worker 为了解析模型凭据而加载了主进程安全与存储权威。

## 3. 目标

1. 隔离 Worker 的完整运行时依赖闭包不得打开、读取、写入或声明拥有 SQLite。
2. 主进程在 fork 前从现有安全权威解析凭据，向 Worker 发送一次性最小执行快照。
3. 保持现有隔离执行协议、队列、路由、回退、取消、超时和执行证据语义兼容。
4. 防止 API key 进入日志、诊断、执行 receipt、错误 details、stdout 或 stderr。
5. 用 Windows 真实进程所有权状态证明修复，而不把自动化测试等同于实机 UAT。

## 4. 非目标与冻结范围

FIX6J 不修改：

- SQLite 主进程单所有者模型或 Named Mutex/租约语义；
- 模型注册表、模型投影、资格判定、路由和 fallback 策略；
- AI 队列优先级、并发、物理容量与僵尸进程策略；
- Facebook、Telegram、WhatsApp 或其他 connector；
- 前端主题、布局及 FIX6I 已修复的投影和诊断能力；
- 凭据持久化格式、迁移或 secure storage 实现；
- 发布状态。真实 Windows UAT 完成前仍须保持 `readyForPromotion=false`、`formalRelease=false`。

## 5. 方案选择

### 5.1 采用方案：专用无状态 Worker 执行器

主进程解析凭据并构造不可变执行快照；Worker 加载专用纯执行模块，并直接调用网络客户端。

选择原因：该方案建立可静态验证的依赖边界，Worker 不需要通过条件分支或延迟加载来规避 SQLite，后续回归也能被依赖闭包门禁捕获。

### 5.2 未采用：扩展现有 `modelExecutor`

给 `modelExecutor` 增加凭据注入参数改动较小，但该模块当前顶层加载 `securityGuardSingleton`。即使改为延迟加载，Worker 的边界仍依赖调用顺序，容易重新引入存储依赖。

### 5.3 未采用：Worker 向主进程按需请求凭据

双向凭据请求可避免凭据出现在初始消息中，但会增加 IPC 状态、超时、取消和错误恢复复杂度。单次模型执行不需要这一额外协议。

## 6. 组件与职责

### 6.1 `AiGateway`

- 继续负责模型选择、任务路由、fallback、队列和物理执行绑定。
- 不解析或持久化凭据。
- 保持 `startModelExecution` 的现有调用语义。

### 6.2 主进程凭据快照解析器

- 仅在主进程运行。
- 通过现有 `SecurityGuard.credentials.get` 读取 `credentialRef`。
- 为云模型生成最小快照：provider、endpoint、provider model name、API key、非敏感模型标识。
- 为 Ollama 生成不含凭据的快照：provider、endpoint、model name、非敏感模型标识。
- 输出对象在构造后冻结。
- 缺失云模型凭据时抛出 `MODEL_CREDENTIAL_MISSING`，不得 fork Worker。
- 不把完整 credential 对象或无关字段传入 Worker。

### 6.3 `modelExecutionHost`

- 在调用 `fork` 前构造执行快照，从而保证配置错误不会创建无意义子进程。
- `execute` IPC 消息携带执行快照、messages 和去除回调函数后的 options。
- 发送后不将凭据快照写入实例字段、receipt、日志或诊断。
- 继续负责 `spawned`、`started`、`result`、`exit` promise，token 转发、取消、软/硬终止和执行证据写入。

### 6.4 `modelExecutionWorker`

- 不再加载 `modelExecutor`。
- 加载新的纯隔离执行器。
- 保持 `started`、`token`、`provider-request`、`result`、`error`、`terminate` 消息协议。
- 收到首个合法 `execute` 消息后冻结执行快照，并只处理一个 execution。
- 不打印或回传执行快照。

### 6.5 纯隔离执行器

- 接受已解析执行快照、messages、options 和 AbortSignal。
- 云 provider 直接调用 `openAiCompatibleClient.chat`。
- Ollama provider 直接调用 `ollamaClient.streamChat`。
- 不读取环境中的凭据，不解析 `credentialRef`，不加载安全权威或任何 repository/store。
- 不支持的 provider 抛出 `UNSUPPORTED_MODEL_PROVIDER`。

## 7. 数据流

1. `AiGateway` 选择模型并调用 `startModelExecution`。
2. 主进程解析器读取一次凭据并产生最小执行快照。
3. `modelExecutionHost` fork Worker，建立 IPC 后发送 `execute` envelope。
4. Worker 校验 envelope，设置 execution/correlation ID，发出 `started`。
5. 纯隔离执行器调用对应网络客户端。
6. Worker 发出 token、provider request ID 和最终 result，或发出已脱敏 error。
7. Worker 退出。
8. Host 根据协议消息和真实退出状态结算 result/exit，并由主进程证据存储写 receipt。

## 8. 安全契约

- API key 只允许存在于主进程 secure storage 返回值、短生命周期执行快照、IPC 序列化缓冲区和 Worker 网络请求构造过程。
- API key、完整凭据快照及 authorization header 不得进入 receipt、日志、诊断、错误 details、stdout、stderr 或 provider request ID。
- Worker 不得把执行快照附加到异常。
- Host 的 stdout/stderr tail 捕获保持启用，但测试必须证明已知 API key 不会出现其中。
- `credentialRef` 可保留在主进程模型记录中，但 Worker 不得使用它解析凭据。
- 本轮不声称 IPC 对同一用户权限下的恶意本机进程提供保密性；FIX6J 的安全目标是最小传输、短生命周期和零持久化/零遥测泄漏。

## 9. 错误处理

- 缺失或空云凭据：`MODEL_CREDENTIAL_MISSING`，fork 前失败。
- 不支持 provider：`UNSUPPORTED_MODEL_PROVIDER`。
- IPC 发送失败、spawn 失败、协议就绪前退出、结果帧丢失、非零退出和信号退出：保持 Host 当前分类语义。
- 云认证、HTTP、DNS、TLS、网络和超时错误：保持网络客户端现有标准化语义。
- Ollama 超时、取消、空输出和请求失败：保持现有语义。
- 调用方取消或队列超时：继续通过 `terminate` envelope、AbortController、SIGTERM/SIGKILL 兜底完成物理退出。
- 错误序列化只允许 code、message、status、stack、脱敏 details 和 provider request ID；测试必须对秘密值执行负向断言。

## 10. TDD 与自动化测试

实施遵循 RED-GREEN-REFACTOR：

1. 先建立可复现测试，证明正式 Worker 在主进程持有 SQLite 时于 `started` 前因所有权冲突退出。
2. 新增 Worker 依赖闭包测试，递归检查生产入口，禁止出现：
   - `node:sqlite`
   - `SqliteDocumentStore`
   - `r32StoreSingleton`
   - `securityGuardSingleton`
   - `systemPolicy`
   - `repositories/storeProvider`
3. 新增云执行快照测试，证明 Worker 使用显式 endpoint、model 和 API key 调用纯客户端。
4. 新增 Ollama 测试，证明其执行快照无需凭据。
5. 新增缺失凭据测试，证明 Host 在 fork 前失败。
6. 新增秘密泄漏测试，用唯一 canary API key 检查 receipt、序列化错误、stdout 和 stderr。
7. 回归 `started/result/error/token/provider-request/terminate` 协议。
8. 回归超时、调用方取消、强制终止、退出 receipt 和物理容量释放。
9. 先运行 FIX6J 聚焦测试，再运行相关 Batch39/FIX6G 测试，最后运行完整 backend suite。

每项验证保存原始日志、命令、开始/结束时间和最终退出码。聚焦测试通过不得替代完整 backend suite。

## 11. Windows 实机 UAT

在 Yance 主进程真实持有 `yance-r32.db` 时执行：

1. 至少一次云模型真实调用；诊断须显示 `workerStarted: true`。
2. 成功调用须保留 provider request ID 或等价非敏感回执。
3. 诊断与 stderr 不得包含 `SQLITE_OWNERSHIP_CONFLICT` 或由该冲突导致的 `WORKER_EXIT_CODE_1`。
4. 执行一次取消或超时场景，证明子进程退出且物理容量释放。
5. 导出新的 Windows 诊断 JSON，并对秘密 canary 做零命中检查。

若真实 provider、账号或用户交互不可用，Windows UAT 状态必须明确保持 pending；自动化测试、构建成功或模拟 provider 不构成发布批准。

## 12. 完成与发布门禁

FIX6J 源码完成要求：

- 聚焦、相关回归和完整 backend suite 均有最终 exit code 0；
- Worker 生产依赖闭包门禁通过；
- 秘密泄漏负向测试通过；
- 变更范围审计确认冻结能力未被修改；
- 交付物包含源码身份、变更清单、原始日志、哈希和验证摘要。

发布状态要求：

- 只有新的真实 Windows UAT 同时证明模型成功执行、无 SQLite 冲突、取消/超时物理退出和零秘密泄漏后，才可单独评估 promotion。
- FIX6J 实现本身不得自动把 `readyForPromotion` 或 `formalRelease` 改为 `true`。
