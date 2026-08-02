# 言策 FIX6O Gate 0 Windows 运行监督器 V5E 修复报告

## 一、实机证据

Windows 实机已证明以下阶段成功：

- 307 个锁文件绑定 npm tarball 校验通过；
- `npm ci` 完成；
- Electron 39.8.5 Windows ZIP SHA256 校验及解压通过；
- 8/8 直接依赖完整；
- Electron 主窗口与本地后端实际启动。

实机随后输出 Chromium 诊断：`Network service crashed, restarting service.`。该消息表明 Chromium 网络服务进程已崩溃并触发内建重启；它写入 stderr，但 Electron 主进程和应用窗口仍在运行。

## 二、根因

V5D 启动监督链仍存在两个错误耦合：

1. Electron 使用 `stdio: inherit`，将 Chromium 子进程诊断直接写入 Node/PowerShell 的 stderr；
2. PowerShell 使用原生命令管道接收混合输出，导致 stderr 诊断被包装成 `NativeCommandError`，把已启动应用误判为 Gate 0 失败。

该问题不能通过屏蔽警告、清空 stderr、`--no-sandbox` 或放宽退出码解决。

## 三、V5E 底层重构

- 新增 `source-uat-runtime-supervisor.js`，独立负责 Electron 进程生命周期、日志隔离和 readiness 观察；
- Electron 使用 detached 进程边界，stdout/stderr 分别写入受检日志文件；
- 启动成功只由 token-exempt 本地 `/api/health` 中的 `readiness.ready=true` 且 `phase=ready` 判定；
- Electron 在 readiness 前退出、启动失败或超时均 fail-closed；
- `source-uat-launch.json` 在可信 readiness 形成后写入 `RUNTIME_READY`、平台、架构、Electron/Backend PID、Electron 可执行文件 SHA256 和日志路径；
- PowerShell 使用 `Start-Process`、独立 stdout/stderr 重定向和真实 `ExitCode`，不再把文本流当作进程状态；
- 不使用 `--no-sandbox`，不忽略 Chromium 诊断，不更改生产网络服务策略。

## 四、边界

V5E 解决的是 Gate 0 监督器误判。实机出现过一次 Chromium 网络服务重启，因此后续 Gate 1/真实平台 UAT 仍须核验：

- 网络服务是否持续稳定；
- WhatsApp、Telegram、Facebook 连接与收发是否受影响；
- 网络服务反复崩溃时是否正确降级并留下可观测证据。

在取得 V5E 的 `RUNTIME_READY` 绑定收据前，项目状态仍为 `PARTIAL`，不得晋级或正式发布。
