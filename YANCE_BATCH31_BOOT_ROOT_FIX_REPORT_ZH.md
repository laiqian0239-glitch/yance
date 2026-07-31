# 言策 Batch 31｜真实 Windows 公共启动根因修复

## 来源

基于 Batch 30 Windows 证据 `YANCE_BATCH30_WINDOWS_EVIDENCE_20260729-171024.zip`：

- 制品、npm ci、npm ls、V3、WP3 静态门禁、WP4 取消链、WP5 source-closure 均通过；
- WP3 真实生产后端与 WP4 A12/A14/A20/A21 均在真实子进程启动阶段失败；
- 旧证据仅输出 `BOOT_DESKTOP_STARTUP_FAILED`，无法区分早期阶段。

## 已确认根因

WP3 `production-api-v2-runtime.js` 直接调用 `BackendProcessHost`，但没有声明 `credentialFrameRequired=true`。`desktopHostedEntry.js` 始终以 `requireCredentialHydration=true` 初始化生产 Runtime，因此父进程未发送 FD5 初始 hydration frame，子进程最终超时失败。

## 公共层修复

1. WP3 真实生产探针显式发送 mandatory FD5 hydration frame；
2. BackendProcessHost 在 fork 前删除继承或显式传入的退役 `YANCE_SAFE_MODE` 精确键；
3. 保留 `YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD` 等无关安全调优键；
4. 早期启动拆分为固定安全阶段：
   - `BOOT_PHASE_0_RESTORE_FAILED`
   - `BOOT_SQLITE_BROKER_FAILED`
   - `BOOT_RUNTIME_INITIALIZATION_FAILED`
   - `BOOT_SERVER_IMPORT_FAILED`
5. Parent lifecycle 仍只传固定文本、phase、stackHash 和 PID，不泄露原始异常、凭据或数据库内容；
6. WP4 快速矩阵保留 phase、stackHash 和安全进程诊断。

## 本地验证

- WP3/环境/阶段诊断：3/3 PASS；
- WP4 相关状态机与 containment：33/33 PASS；
- Parent lifecycle 与 FD5 取消：13/13 PASS；
- WP5 source-closure：11/11 PASS；
- V3 协议：2/2 PASS；
- `git diff --check`：PASS。

## 治理

真实 Windows 快速门禁完成前：

- `WINDOWS_UAT_BLOCKED`
- `windowsUatAuthorized=false`
- `readyForPromotion=false`
- `formalRelease=false`
