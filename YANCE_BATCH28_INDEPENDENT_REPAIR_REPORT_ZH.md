# 言策 Batch 28｜真实 Windows UAT 独立根因修复报告

## 1. 结论

Batch 28 以 Batch 27 PackageCommit `3ff188cf1fe6f3e06bdbe1523da9326b529e57a2` 为唯一直接父基线，针对独立源码复核发现的遗漏路径实施公共层修复。

当前结论是：**源码修复与当前 Linux 自动化回归已完成；真实 Windows、真实 WhatsApp/Telegram/Facebook、真实 OpenRouter、修复后 clean npm ci 及外部独立批准尚未完成。**

因此继续保持：

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
windowsUatAuthorized=false
```

## 2. 实现身份

- Branch：`development/windows-uat-f25fe2e-repair-batch27-developer-handoff-v2`
- ImplementationCommit：`4ac6ddfc89adda08f0f51a697cd87c7a3ec72c16`
- ImplementationTree：`10fbb3fff5361e4385d8d06c1223609ab462f181`
- Parent PackageCommit：`3ff188cf1fe6f3e06bdbe1523da9326b529e57a2`
- Parent PackageTree：`03434938073f2d52707bebee89ff90e626630f0b`

## 3. 已关闭的公共根因

### 3.1 SQLite Owner、fencing 与路径权威

- 同进程多个 SQLite 打开句柄采用引用计数，任一单独关闭不再提前撤销 Owner。
- heartbeat 可由所有合法引用续租；最后一个引用关闭后才释放。
- PID、进程创建身份、heartbeat 联合 fencing；活进程不能仅因壁钟跳变被接管。
- PID 复用、进程死亡与显式强制接管分别处理。
- `RuntimeOwnership` 直接实例不再忽略声明的 `dataRoot/dbPath` 使用全局 SQLite 单例。
- 释放时关闭私有 Broker 并移除退出监听器，避免重启周期资源泄漏。

### 3.2 Telegram enrichment 与历史双游标

- 恢复仅处理本账号、本任务类型、真实失联或旧进程代际任务。
- 使用不可变 `created_at + job_id` 游标，严格尊重 `next_retry_at`。
- poison 记录进入 retry/DLQ，不阻断后续任务。
- 历史同步使用持久 backfill cursor；新增突发使用 forward catch-up cursor。
- 缺口完成前不推进 committed high-water，重启后继续 `catchupOffsetId`。
- 每页网络请求及本地提交前检查取消信号。

### 3.3 `send_outcome_unknown` 总账收敛

- Queue 阻断、状态页和恢复扫描改用 SQL 精确总账，不再被 1000 条列表截断。
- Late ACK 和 Journal 验证 platform、account、operation、session、target、route、routeVersion、executionGeneration。
- 冲突、损坏、孤儿和终态日志进入隔离或清理，不能回写错误代次。
- 本地投影修复 enqueue 保持幂等，不把 RUNNING 任务降回 PENDING。
- 修复平台 deadline 回调缺失 `eventBus` 导入导致 late ACK 无法进入收敛的问题。

### 3.4 平台 deadline、generation、Auth/Reconcile

- 普通调用方传入 AbortSignal 不再绕过本地硬期限；只有持久化 Outbox 明确拥有权威期限时避免重复计时。
- WhatsApp、Telegram、Facebook 的发送、媒体、reaction、revoke、presence、read、connect、disconnect、sync 与 OAuth 路径贯通 signal/generation。
- 超时或取消后 SDK 的迟到成功只进入 quarantine，不能成为当前代次成功。
- AccountManager、PlatformDriverRegistry、平台 Adapter 与 Facebook OAuth 在持久状态写入前再次检查代次和取消。
- Telegram 登录步骤、Facebook OAuth、注销及同步不会在端口已经超时后继续写成成功。

### 3.5 AI Provider 物理 zombie

- `hardTerminate() === true` 后立即幂等释放物理槽位，不等待可能永不 settle 的原 Promise。
- 不可终止 zombie 继续计入 Provider 上限，避免无限补充物理任务。
- 外部取消和超时后的迟到结果不得写入业务副作用。

### 3.6 学习、候选与翻译事务 CAS

- source/projection 分别记录 ready、active、retry due、retry deferred、unresolved、DLQ、total unfinished 及最老时间。
- 延期重试不再误报为当前可执行积压。
- Candidate 最终写入复核 runtime generation、conversation revision、Persona version/hash。
- 翻译强制重试先取消旧代次；pending、结果和生命周期终态在同一 SQLite 事务 CAS。
- 重启遗留的 CREATED/RUNNING 翻译任务可恢复，不再永久 pending。

### 3.7 Telegram 真实凭据递归缺陷

原 `persistCredentials()` 递归调用自身。mock 测试隐藏了该问题；真实登录成功或注销清理可能触发栈溢出。现改为调用安全凭据存储 authority，并加入不依赖 mock 的反向测试。

## 4. 自动化验证

- 完整后端发现：170 个文件，1044/1044 PASS，0 fail，0 skipped，拆分为 9 个确定性分组执行。
- Batch 28 独立根因：16/16 PASS。
- Auth/Reconcile 专项：96/96 PASS。
- Round 12 平台核心：79/79 PASS。
- Round 13 AI 质量：24/24 PASS。
- UAT Diagnostics：142/142 PASS。
- Source UAT Delivery：33/33 PASS。
- WP5 Runtime Ownership/Migration：58/58 PASS。
- 变更 JavaScript：34/34 syntax PASS。
- `git diff --check`：PASS。

这些是当前 Linux 源码自动化证据，不替代真实环境证据。

## 5. 未完成与环境阻断

### 5.1 当前 Linux 依赖环境

当前工作目录的 `node_modules` 不完整，`npm ls --depth=0` 失败；容器无法从网络恢复 lockfile 依赖。因此：

- WP3：25 PASS；16 项在测试夹具加载前因缺少 `express` 失败；1 SKIP。
- WP4：Electron 依赖不可用，应用矩阵未形成产品断言闭环。
- 未取得修复后 clean `npm ci`。

这些结果不能标记为产品 PASS，也不能用 Batch 27 的旧 Windows clean npm 证据替代。

### 5.2 必须在外部完成的门禁

- 修复后 PackageCommit 身份的 clean `npm ci` Windows。
- 真实 Windows Electron 冷启动、退出、重启、双实例、强关、睡眠/唤醒和系统时间跳变。
- 真实 WhatsApp、Telegram、Facebook 全操作类型、timeout、late ACK、重启 reconciliation。
- 真实 OpenRouter 两个 Provider/模型的 timeout、cancel、限流、切换和物理终止。
- 大规模学习积压与资源曲线。
- 完全独立审核和发布批准。

## 6. 晋升判定

Batch 28 只能作为**阻断状态修复交接包**，不得标记为 Windows UAT 候选已授权，不得转正式发布。
