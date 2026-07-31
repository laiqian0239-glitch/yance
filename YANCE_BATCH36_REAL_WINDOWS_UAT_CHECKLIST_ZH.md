# 言策 Batch 36｜真实 Windows 完整复验清单

1. 严格校验交接包、Git Bundle、PackageCommit 与 PackageTree。
2. clean `npm ci --no-audit --no-fund` 和 `npm ls --depth=0`。
3. 快速门禁：V3、Source UAT、WP4 短路径、targeted containment evidence semantics、Batch35 四场景。
4. 完整 WP3：测试与生产 evidence。
5. 完整 WP4：全部测试、mutation、fault/containment/application convergence 与 evidence。
6. 完整 WP5：基础、fault、concurrency、24 mutants、source-closure、evidence。
7. Round 12、Round 13、UAT diagnostics。
8. 后端递归发现全部 176 文件，不得只扫描顶层 170 文件。
9. 隔离 Electron：启动、退出、重启、双实例、Owner fencing、强杀、时间跳变。
10. 真实 WhatsApp、Telegram、Facebook 操作期限、generation、late ACK 与 reconciliation。
11. 真实 OpenRouter 两 Provider：超时、取消、物理终止、槽位回收和重启恢复。
12. 生成脱敏证据后由独立角色复核；执行方不得自行批准。
