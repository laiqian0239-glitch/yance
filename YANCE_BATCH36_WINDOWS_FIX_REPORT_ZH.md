# 言策 Batch 36｜Batch 31–35 完整合并与复验交接

## 身份

- Branch：`development/windows-uat-batch36-consolidated-full-candidate`
- ImplementationCommit：`bdc0c9de8bdd604161117c1648595bba3649651d`
- ImplementationTree：`ba631ae63e15cc3f5d1d32737bf9b18d9894b316`
- ParentPackageCommit：`740e1168e50bf540b924d41856fd5ea32bb6bd85`

## 本轮合并

Batch 36 将 Batch 31–35 的增量 Hotfix 统一并入一个完整源码身份，包括：FD5 hydration、退役环境权威清理、早期启动安全诊断、rejected-owner 并发退出恢复、SQLite ownership 分类与重试、WP4 Windows 短路径，以及 targeted evidence 的 `NOT_RUN/PARTIAL` 语义。

## 已有 Windows 证据

Batch 35 证据 `42f90768360cb9c83762ba5770ef53f754aff9eb08ea0bacc467d4e794d7cb0e`：短路径契约 6/6、A12/A14/A20/A21 4/4、WP5 source-closure 11/11 全部通过。该证据证明历史四个 Windows 阻断已关闭，但不替代 Batch 36 完整包的重新验证。

## 当前自动化

- V3：2/2 PASS
- Source UAT：33/33 PASS
- Round 12：79/79 PASS
- Round 13：24/24 PASS
- UAT diagnostics：142/142 PASS
- WP5 base：58/58 PASS
- WP5 source-closure：11/11 PASS
- 完整后端递归发现：176 文件，1099/1099 PASS
- WP4 evidence semantics：3/3 PASS

## 环境未执行

当前 Linux 依赖目录缺少 `express`，因此完整 WP3/WP4 的真实后端子进程用例不能在此环境完成。所有此类用例明确登记为环境未执行，不登记为 PASS，也不登记为源码缺陷。

## 下一门禁

Batch 36 完整 PackageCommit 必须在真实 Windows 执行 clean npm ci、完整 WP3/WP4/WP5、完整后端、Electron、真实三平台和 OpenRouter；在此之前保持 `WINDOWS_UAT_BLOCKED`。
