# 言策 Batch 37｜真实 Windows 全量复验清单

1. 校验完整交接包、Git Bundle、PackageCommit 和 PackageTree；
2. clean `npm ci` 与 `npm ls --depth=0`；
3. Batch 37 证据工具链专项测试；
4. 完整 WP3，并确认 evidence 输出位于外部证据目录；
5. 完整 WP4，并确认 required tests 不再出现 `C:\Program`；
6. WP5 前执行 `git status --porcelain`，必须为空；
7. 完整 WP5 连续流水线；
8. Round 12、Round 13、UAT diagnostics；
9. 完整 176 文件后端；
10. 隔离 Electron；
11. 真实平台与 OpenRouter 仍单独验收。

任何失败均保持 `WINDOWS_UAT_BLOCKED`。
