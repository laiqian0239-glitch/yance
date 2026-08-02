# Reviewed Candidate 与分层 CI 治理设计

## 目标

在不修改 PR #5 分支、Head、83 文件集合及冻结摘要的前提下，建立独立治理能力：

1. 允许 `reviewedHead` 与授权分支 `branchTip` 分离，但必须证明二者处于同一可信祖先链；
2. 对 `reviewedHead..branchTip` 仅接受精确冻结的后审查证据提交和精确路径；
3. 使用新的可信候选门禁重新验证 A6 的 WP0 身份和范围；
4. 从 A7/下一工作包开始实施 `L0 → L1 → L2 → L3` 分层 CI；
5. 将独立复审放在正式关闭之前，消除把 provisional green 误记为 closed 后再 reopen 的治理噪声。

## 不可变边界

- PR #5 必须保持 Draft、未合并、`readyForPromotion=false`。
- PR #5 Head 固定为 `e877aec9e16663296e632c224a1da3b7892f1f2b`。
- 已复审代码 Head 固定为 `3684dbd840faec8d6e732b0b68eae25f1ad9b2b3`。
- 治理父 Head 固定为 `d81599d8a3f3de891da369b6f1ddbd01e264c78d`。
- `governanceBase..reviewedHead` 的排序 changed-file 数量必须为 83。
- 排序 changed-file 集合 SHA-256 必须为 `d2cac11bd6864b02e09fa68015dbdba5c41bb2777bf79e821f00a846b651702a`。
- `reviewedHead..branchTip` 只允许提交 `e877aec9e16663296e632c224a1da3b7892f1f2b`，分类为 `EVIDENCE_ONLY`，只允许路径 `governance/architecture-closure-v2/wp-a-a6-review-red-evidence.json`。
- 新治理 PR 不得移动、重写、合并或更新 PR #5 分支。

## 可信候选身份模型

机器可读清单保存为 `governance/layered-ci/reviewed-candidate-a6.json`。清单必须包含：

- repository、pullRequest、authorizedBranch；
- governanceBase、reviewedHead、branchTip；
- reviewed changed-file 数量和集合摘要；
- 精确的 `allowedPostReviewCommits`；
- 精确的 `allowedPostReviewPaths`；
- `readyForPromotion=false`。

验证器必须 fail closed，并证明：

1. 所有 Git SHA 都是 40 位小写十六进制；
2. 所有提交对象真实存在；
3. `governanceBase` 是 `reviewedHead` 的祖先；
4. `reviewedHead` 是 `branchTip` 的祖先；
5. `origin/<authorizedBranch>` 当前尖端等于清单中的 `branchTip`；
6. `governanceBase..reviewedHead` 的文件数量和摘要等于冻结值；
7. `reviewedHead..branchTip` 的提交列表与清单完全相同；
8. `reviewedHead..branchTip` 的 changed-file 集合与精确允许路径完全相同；
9. 不接受通配符、未知分类、额外提交、额外路径或分支漂移。

候选门禁通过只证明候选身份和范围可信，不自动关闭 A6，不改变 source-closure 在 A8 前保持开放的治理事实。

## Task 生命周期

从 A7/下一工作包开始，Task 状态固定为：

`SPEC_DRAFT → SPEC_REVIEWED → RED_LOCKED → IMPLEMENTING → GREEN_PROVISIONAL → INDEPENDENT_REVIEW → CLOSED`

约束：

- `GREEN_PROVISIONAL` 不是 closed；
- 独立复审在 `CLOSED` 之前；
- 正式关闭后发现新攻击面，创建 amendment 或 post-closure defect，不修改历史关闭证据；
- 只有关闭证据不真实、验证 SHA 错误或测试结果被污染时，才允许真正 `REOPENED_INVALID_EVIDENCE`。

## 分层 CI

### L0 Fast

每次 push / PR 执行：

- 治理 JSON 和生命周期合同；
- reviewed-candidate 单元测试；
- 风险分类器单元测试；
- 与 changed paths 对应的轻量合同；
- 目标耗时 3–8 分钟。

### L1 Task

冻结 Task candidate 后执行：

- Ubuntu 上的 Task 全部合同；
- 相关 legacy 回归；
- 仅对平台敏感路径执行 Windows 定向测试；
- 不运行整个 Work Package 的发布级矩阵。

### L2 Work Package

Task 准备正式关闭或高风险路径发生变化时执行：

- Ubuntu/Windows 完整工作包矩阵；
- WP0、Legacy SQLite、Identity 和范围门禁；
- 独立复审输入绑定冻结 candidate SHA。

### L3 Promotion

仅通过显式 `workflow_dispatch` 执行：

- 完整发布候选、打包、故障注入、证据归档和发布门禁；
- L3 不由普通微小提交自动触发；
- L3 通过也不自动发布。

## 风险升级规则

下列路径至少升级到 L2：

- `backend/lib/sqlite*`、`backend/runtime/**`；
- authority、migration、backup、recovery、fencing、process lifecycle；
- `tools/wp0/**`、`shared/release/**`；
- `.github/workflows/**`；
- `package.json`、`package-lock.json`、Electron/打包工具链。

仅文档、测试说明和非语义治理元数据可保持 L0；测试语义、门禁规则或授权范围的变化不能因文件位于 tests/governance 而降级。

## 工作流布局

- `layered-ci-fast.yml`：PR/push 的 L0 快速反馈和风险分类；
- `reviewed-candidate-a6.yml`：验证 A6 候选身份并在 reviewed Head 上执行可信 WP0 子门禁；
- `layered-ci-task.yml`：显式候选的 L1/L2 执行入口；
- `layered-ci-promotion.yml`：显式 L3 入口，默认仅验证，不发布。

## 错误模型

所有工具输出结构化 JSON，至少包含：

- `pass`；
- `reasonCode`；
- 验证对象 SHA；
- 各子条件布尔值；
- `readyForPromotion=false`。

未知输入、Git 对象缺失、远端漂移、摘要不符、通配符授权、工作区不干净或未识别风险必须失败，不允许降级为 warning。

## 成功标准

- 新治理分支和 Draft PR 与 PR #5 完全隔离；
- reviewed-candidate 对抗测试先 RED 后 GREEN；
- 风险分类和生命周期合同测试通过；
- 新 PR 的 L0 Actions 真实运行；
- A6 candidate workflow 能证明 runner、checkout、候选身份和 WP0 子门禁真实执行；
- 未经完整 L2/独立复审，任何 Task 不得标记 CLOSED；
- `readyForPromotion` 始终保持 false。