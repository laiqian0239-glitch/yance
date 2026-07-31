# 言策 Batch 29｜Windows WP3 / WP4 / WP5 阻断修复报告

## 1. 结论

Batch 29 以 Batch 28 PackageCommit `a400cf21ae9c39c03b4a9d78f0f355a92a0a63bd` 为唯一直接父基线，修复真实 Windows 证据暴露的三个阻断域：WP3 SQLite 私有句柄清理、WP4 凭据应用启动时序、WP5 mutation 结果分类与进度可见性。

当前源码修复与定向回归已完成，但 Batch 29 最终 PackageCommit 尚须重新在真实 Windows 执行 clean `npm ci`、完整 WP3/WP4/WP5 和 Electron。治理状态保持：

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
windowsUatAuthorized=false
```

## 2. 实现身份

- Branch：`development/windows-uat-batch29-wp3-wp4-wp5-fix`
- ImplementationCommit：`0c1b2377a36703296eee48cb2a427742ac45d3a7`
- ImplementationTree：`ddd9f71faa81d82319737478c721bc647d35a16f`
- Parent PackageCommit：`a400cf21ae9c39c03b4a9d78f0f355a92a0a63bd`
- Parent PackageTree：`81a24c6cb3d3eb2718f37ed81a76d280ac0a3fa3`

## 3. 输入 Windows 证据

- 文件：`YANCE_BATCH28_WINDOWS_EVIDENCE_20260729-134647.zip`
- SHA256：`315a6cf445cc21cca75c685785da0cc9d70a04cf0ac6153e730e91174990dfe2`

该证据已确认 Batch 28 的制品身份、clean `npm ci`、`npm ls`、核心门禁与完整后端 1099/1099 通过；同时可靠暴露：

- WP3：41/43，两个 fencing 断言完成后因 Windows EPERM 无法删除临时目录；
- WP4：194/195，四个凭据应用矩阵场景出现 `CREDENTIAL_IPC_WRITE_TIMEOUT`，并有三项测试结束后的 `Backend startup failed` 未处理拒绝；
- WP5：24 个 mutant 中 5 个 KILLED、19 个 HARNESS_ERROR，但 0 个 SURVIVED。

## 4. 修复内容

### 4.1 WP3 私有 SQLite Broker 生命周期

旧测试只释放 stale owner 的命名互斥量，随后调用并不拥有数据库连接的 `RuntimeStateStore.close()`。直接 `RuntimeOwnership` 创建的私有 SQLite Broker 仍持有 Windows 文件句柄，导致临时目录删除报 EPERM。

修复后：

- current owner 正常 release；
- stale owner调用 `release({ releaseLease: false })`，只关闭其私有 Broker，不撤销新 owner 的 fencing lease；
- Windows 删除采用有界重试；
- try/finally 保证断言失败时仍关闭两个 owner。

定向验证：双 Owner 私有 Broker 关闭及目录删除 1/1 PASS。

### 4.2 WP4 FD5 凭据写入与启动代次统一取消

`BackendProcessHost` 过去在后端已发送 `backend:startup-failed`、子进程退出或用户 stop/restart 后，仍可能等待 FD5 凭据写入自己的 5 秒 deadline，最终把真实启动失败覆盖成 `CREDENTIAL_IPC_WRITE_TIMEOUT`。同时 hydration、READY 和 handshake Promise 的迟到拒绝可能在测试结束后成为 unhandled rejection。

修复后：

- 每次启动建立独立 `AbortController`；
- `backend:startup-failed`、child error、child exit、stop、restart 和启动 catch 均取消当前代次；
- `CredentialIpcHost.sendSnapshot()` 接收 signal，并传播权威启动失败 Error；
- FD5、hydration、READY 和 handshake 使用同一取消链；
- settle 时移除监听器，并为并行 Promise 安装终态 catch，避免迟到未处理拒绝。

定向验证：启动失败与 stop 均在 2 秒内中止阻塞 FD5 写入，专项 4/4 PASS。

### 4.3 WP5 mutation 分类与实时进度

Windows Node 24 默认 reporter 使用 `✖ test name`、`fail N`、`failing tests:`。旧分类器只识别 TAP `not ok` 或 JSON `"status":"FAIL"`，因此把真实“测试杀死 mutant”的非零退出误报为 HARNESS_ERROR。

修复后：

- node:test mutation 命令显式使用 `--test-reporter=tap`；
- 同时兼容 TAP、spec 与 JSON 失败标记；
- 每个 mutant 保存命令、退出码、分类、耗时、独立日志和 SHA256；
- 支持 `WP5_MUTATION_IDS` 定向执行；
- 实时输出 `start → KILLED/状态 → durationMs`，避免长时间无进度。

定向验证：24 个 mutant 分别在独立进程执行，24/24 KILLED，0 SURVIVED、0 HARNESS_ERROR。

## 5. 当前自动化证据

- WP3 私有 Broker 关闭：1/1 PASS；
- WP4 启动失败/stop 取消：4/4 PASS；
- WP4 更广 BackendProcessHost 回归：76/77，其中唯一失败为当前 Linux 缺少 `express`，真实后端子进程无法加载；
- WP5 基础套件：58/58 PASS；
- WP5 mutation：24/24 独立 KILLED，0 survived，0 harness error；
- 变更 JavaScript `node --check`：PASS；
- `git diff --check`：PASS。

当前容器依赖不完整，因此不能把 WP3/WP4 完整矩阵标记为 Batch 29 PASS，也不能用 Batch 28 的 Windows clean npm 证据替代新的 PackageCommit。

## 6. 必须重新执行的 Windows 门禁

- Batch 29 PackageCommit 的 clean `npm ci` 与 `npm ls --depth=0`；
- WP3 完整套件，确认全部通过且无 EPERM；
- WP4 完整套件，确认凭据生命周期矩阵通过且无测试结束后的异步拒绝；
- WP5 一次连续完整 24-mutant matrix，要求 24 KILLED、0 SURVIVED、0 HARNESS_ERROR，并可见逐项进度；
- 所有自动化通过后才启动隔离数据的真实 Electron；
- 真实 WhatsApp、Telegram、Facebook 与 OpenRouter 仍单独验证。

## 7. 晋升判定

Batch 29 当前只能作为**阻断状态修复交接包**。真实 Windows 与外部系统证据完成前不得授权 UAT 或发布。
