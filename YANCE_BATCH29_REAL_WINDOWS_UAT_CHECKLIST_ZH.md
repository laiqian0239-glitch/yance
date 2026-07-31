# 言策 Batch 29｜真实 Windows UAT 复验清单

## A. 身份与依赖

- [ ] 校验交接 ZIP、源码 ZIP、Git bundle 与 `SHA256SUMS.txt`。
- [ ] 从 Git bundle 恢复并验证最终 PackageCommit/Tree。
- [ ] 在全新目录执行 `npm ci`，ExitCode=0。
- [ ] 执行 `npm ls --depth=0`，ExitCode=0。

## B. WP3

- [ ] 完整 WP3 全部通过。
- [ ] 两个 stale-fencing-token 测试结束后无 EPERM。
- [ ] 临时 SQLite、WAL、SHM 与目录均能在有界时间删除。
- [ ] stale owner 关闭私有 Broker 时不撤销 current owner 的 fencing lease。

## C. WP4

- [ ] 完整 WP4 全部通过。
- [ ] A12、A14、A20、A21 不再出现 `CREDENTIAL_IPC_WRITE_TIMEOUT`。
- [ ] 后端报告 `backend:startup-failed` 后，FD5 写入立即收到同一权威失败原因。
- [ ] child error/exit、stop、restart 均取消当前启动代次。
- [ ] 测试结束后无 `Backend startup failed` unhandledRejection。
- [ ] 凭据 apply、hydration、FD6 commit、FD5 write、READY 与 application restart 顺序可审计。

## D. WP5

- [ ] 基础套件 58/58 PASS。
- [ ] fault matrix 与 concurrency/crash matrix PASS。
- [ ] 一次连续执行 24 个 mutant。
- [ ] mutation 结果必须为 killed=24、survived=0、harnessError=0、timeout=0。
- [ ] 窗口实时显示每个 mutant 的 start、classification 与 duration。
- [ ] 每个 mutant 有单独日志、退出码与 SHA256。

## E. Electron 与外部系统

- [ ] 前置自动化全 PASS 后启动隔离数据 Electron。
- [ ] 冷启动、正常退出、托盘退出、强制结束、重启、双实例、睡眠/唤醒、时间跳变。
- [ ] 真实 WhatsApp、Telegram、Facebook operation matrix。
- [ ] 真实 OpenRouter 正常、超时、取消、限流与物理终止。

## F. 治理

- [ ] 所有证据绑定 Batch 29 最终 PackageCommit/Tree。
- [ ] 完全独立角色复核。
- [ ] 上述完成前保持 `WINDOWS_UAT_BLOCKED`。
