# 言策 Windows 内测验证最终闭环

本闭环用于停止“发现一个问题、修改本地副本、再发现下一个问题”的无效循环。它不把非 Windows 结果冒充为 Windows 验收，也不放宽任何正式门禁。

## 固定执行顺序

1. 从权威 Bundle 创建候选 fresh clone。
2. 使用 `verify:wp7:diagnostic` 做一次 Windows 预演；独立且安全的后续步骤在前序失败后继续执行，一次收集全部问题。
3. 修复必须进入正式 Git Commit、Tree、Bundle 和 Runner。禁止修改验证 clone。
4. 候选预演完整通过后冻结源码和 Runner。
5. 分别使用 Round 1、Round 2 独立 fresh clone 执行严格模式。
6. 使用 `create:windows-preacceptance` 从两份机器生成的严格 PASS 结果创建 Preacceptance。
7. Final Builder 重新验证两轮结果、Preacceptance、Bundle、Runner、Node 和 npm 绑定后才允许构建。

## 环境前置检查

正式耗时步骤之前必须确认 Node 22.16.0、npm 10.9.2、npm 脚本的实际 `process.execPath`、Git 身份、CLEAN、隐藏索引标志、磁盘空间和 Windows 短路径能力。验证盘不具备 8.3 短路径能力时，Runner 自动选择独立且兼容的系统临时目录，不修改整个磁盘卷配置。

## 禁止事项

禁止在 fresh clone 内修改 `verify.js`、Runner 或测试；禁止 `assume-unchanged`、`skip-worktree`、人工补写 `ROUND_RESULT.json`、复用上一轮 `node_modules`、npm cache、TEMP、SQLite、Electron 用户数据或构建输出。

## 正式停止条件

当前版本仅在以下条件全部满足后结束本地内测阻塞：Windows 预演 PASS、Round 1 PASS、Round 2 PASS、Final Builder PASS、新版 `Yance.exe` 和安装器 PASS、安装/升级/回滚/卸载 PASS、Electron UAT PASS、品牌实机验收 PASS、账号和 Ollama UAT PASS、完整结果 ZIP 齐全。

代码签名、在线更新服务器、公网服务器、商业字体、付费素材、云服务和公网发布继续为 `DEFERRED`，不阻塞本地内测。
