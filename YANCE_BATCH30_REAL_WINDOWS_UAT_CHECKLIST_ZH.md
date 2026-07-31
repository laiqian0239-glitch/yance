# 言策 Batch 30｜真实 Windows 短路复验清单

## 身份

- Branch：`development/windows-uat-batch30-wp3-wp4-wp5-root-fix`
- ImplementationCommit：`4ef7a2b4182400e0ca7b4603dea6ba962ecb9bac`
- ImplementationTree：`52401514689468b2cd4b7e49e3ad6e107aa38d5e`
- 最终 PackageCommit/Tree：由交接包 sidecar 与 Git bundle 校验，不写入 tracked tree。

## 第一阶段：快速阻断门禁

1. 交接包 SHA256、内部清单、Git bundle、PackageCommit/Tree；
2. clean `npm ci --no-audit --no-fund`；
3. `npm ls --depth=0`；
4. `node tools/wp3/generate-evidence.js`，必须完成真实后端两次启动与 Token 轮换；
5. WP4 启动失败取消定向测试，必须确认 `lastStartCancellation` 在 1 秒内记录；
6. 运行 Desktop Credential Application 矩阵，重点核对 A12、A14、A20、A21；
7. `node tools/wp5/source-closure-scan.js`，11/11 PASS；
8. `npm run verify:wp5`，24/24 KILLED 且后续所有阶段 PASS。

任一项失败立即生成证据并停止，不进入长时间完整回归。

## 第二阶段：完整回归

仅在第一阶段全部通过后执行：

- WP3 全套；
- WP4 全套；
- WP5 全套；
- 完整后端发现与执行；
- Round 12、Round 13、UAT diagnostics、Source UAT；
- 隔离数据的真实 Electron 启动、退出、重启、双实例和崩溃恢复。

## 第三阶段：仍需人工/真实服务证据

- WhatsApp、Telegram、Facebook 真实操作与 late ACK；
- OpenRouter 两 Provider 超时、取消和物理终止；
- 完全独立审核批准。

## 当前治理

`WINDOWS_UAT_BLOCKED`，不得晋升。
