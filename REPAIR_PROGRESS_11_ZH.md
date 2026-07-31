# 言策 f25fe2e 修复进度 11｜真实 Windows 后端握手超时

## 1. 真实复现

本机一键测试已完成 npm ci、Express Persona 集成测试及正式源码门禁，但 Electron 启动阶段出现：

- `BACKEND_STARTUP_FAILED`
- `DESKTOP_BACKEND_READY_TIMEOUT`
- 用户可见提示：`Timed out waiting for backend handshake`

这属于真实 Windows 启动阻断，不是用户操作错误。

## 2. 根因

桌面主协调器允许后端启动等待 60 秒，但 `BackendProcessHost` 内部握手等待仍使用独立默认值 30 秒。复制真实数据后的 SQLite、恢复、迁移及运行框架初始化可能超过 30 秒，内部握手会先于外层监督器错误终止后端。

因此同一次启动存在两个冲突的超时权威：

- 外层监督器：默认 60 秒；
- 子进程 `backend:ready` 握手：默认 30 秒。

## 3. 修复

- `BackendProcessHost` 现在优先使用显式 `readyTimeoutMs`，其次读取 `YANCE_BACKEND_STARTUP_TIMEOUT_MS`；
- 超时上限统一限制为 180 秒；
- Electron 主协调器将同一个 `backendStartupTimeoutMs()` 同时传给握手与启动契约；
- 源码 UAT 默认设置 `YANCE_BACKEND_STARTUP_TIMEOUT_MS=180000`，用于真实数据隔离副本的首次启动；
- 保留失败关闭：超过 180 秒仍未完成握手，继续判定为真实启动失败，不伪装成功。

## 4. 修复身份

- Commit：`1f0a72b321e5ddc4d9404654e024575bea877bf3`
- Tree：`9e633b3b754953523554343ac7cda804060acc95`
- Parent：`6e5045191980250efced8a28994cdaf91511eea1`
- `formalRelease=false`
- `readyForPromotion=false`

## 5. 验证

- Batch 11 专项：3/3 PASS；
- 后端启动顺序、运行契约、凭据握手：12/12 PASS；
- 桌面修复、UAT、前端安全：255/255 PASS；
- 后端回归已完成前两分段：464/464 PASS；后续全量仍由 FIX2 本机 `npm ci` 环境正式执行；
- JavaScript 语法检查：PASS；
- `git diff --check`：PASS；
- 工作树：clean。

## 6. 下一步

使用 FIX2 一键包重新执行。FIX2 会使用新源码身份、180 秒统一握手超时，并在任何启动失败后自动收集 `desktop.jsonl`、`server.jsonl`、启动标准输出/错误和进程端口信息，生成失败证据 ZIP。
