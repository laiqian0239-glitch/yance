# Gate 0 密封导出 Canonical Path 修复独立源码复审

- 项目：Yance Architecture Closure V2
- PR：#4
- 分支：`rebuild/windows-release-closure-20260802-gate0-wp0-fix`
- 复审结论：`APPROVED`
- 阻断项：`GATE0-SEALED-EXPORT-CANONICAL-PATH=CLOSED`
- 代码复审 Head：`94ed2d31be2ded82724d07c83a5b30c00141a424`
- PR 状态要求：继续保持 `Draft`
- `gate1MayStart=false`
- `productionCodeChangesAllowed=false`
- `wpAImplementationAllowed=false`

## 1. 审查范围

本轮只审查密封导出公共治理层的物理路径权威，不审查或授权 WP-A 至 WP-H 业务重构。核验目标：

1. 根路径先 `lstat`，拒绝根符号链接和 Windows junction/reparse 类型入口；
2. 解析唯一物理 `realpath`，所有 Git 探测、祖先扫描、子树扫描、遍历、哈希和身份文件写入使用同一 canonical root；
3. Git 子进程不继承任何大小写形式的 `GIT_*` 环境变量；
4. API 与 CLI 继续使用同一 `assertSealedExportRoot()` 权威；
5. Linux 符号链接、Windows 真实 junction、Git 环境污染和原始绕过组合均有可执行回归；
6. 不存在调用方豁免、警告后继续、allowlist 或跳过 Windows 的临时方案。

## 2. TDD 失败证据

RED 提交：`59464d2f3b8c19322846d57bcd9aa368c7eb5860`

GitHub Actions：

- Run：`30733603063`
- Job：`91458106277`
- 结果：`EXPECTED_FAIL`
- 测试：18 项中 14 项通过、4 项失败

四项失败准确捕获：

1. 继承的 `GIT_DIR/GIT_WORK_TREE/GIT_COMMON_DIR/GIT_CEILING_DIRECTORIES` 能污染 Git 探测；
2. 根符号链接/Windows junction 未在变更前拒绝；
3. 根链接指向 Git worktree 子树并注入 `GIT_CEILING_DIRECTORIES` 时，旧实现可错误接受或错误分类；
4. 经链接父目录进入普通导出目录时，旧实现返回逻辑路径而非物理 canonical root。

该 RED 运行中其余既有治理测试通过，证明失败集中于本轮根因而不是无关基础设施。

## 3. 底层公共层修复

权威修复提交：`a660c2b94b508d1739f21311c00c2d04f37b8462`

修改：`tools/runtime-delivery/sealed-export-authority.js`

### 3.1 根路径权威

`canonicalizeSealedExportRoot()` 执行：

```text
path.resolve
→ fs.lstatSync
→ reject root symbolic link / junction
→ fs.realpathSync.native
→ fs.statSync canonical target
→ return logicalRoot + canonicalRoot
```

根链接拒绝码固定为：

```text
SOURCE_UAT_DERIVED_IDENTITY_ROOT_LINK_FORBIDDEN
relation=ROOT_SYMBOLIC_LINK_OR_REPARSE_POINT
```

### 3.2 Git 环境隔离

`sanitizeGitEnvironment()` 大小写不敏感删除所有匹配 `/^GIT_/iu` 的键，并固定 `LC_ALL=C`、`LANG=C`。Git 探测不再受调用进程的 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_COMMON_DIR`、`GIT_CEILING_DIRECTORIES`、`GIT_DISCOVERY_ACROSS_FILESYSTEM`、`GIT_INDEX_FILE` 等影响。

### 3.3 Canonical root 贯通

`assertSealedExportRoot()` 只将 canonical root 传给：

- 祖先 `.git` 元数据扫描；
- `git rev-parse --absolute-git-dir`；
- `git rev-parse --show-toplevel`；
- 导出树嵌套 `.git` 扫描。

调用方 `createDerivedSourceIdentity()` 使用该返回值作为后续 descriptor、identity、payload 遍历和 SHA-256 计算根目录。因此逻辑路径、Git 探测路径、扫描路径、写入路径和哈希路径不再分裂。

### 3.4 Fail-closed 保持

只有 Git 返回状态 128 且 stderr 明确包含 `not a git repository` 才视为“无仓库”。其他异常继续以 `SOURCE_UAT_DERIVED_IDENTITY_GIT_PROBE_FAILED` 拒绝；发现物理祖先 Git 元数据时继续以 `SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN` 拒绝。

## 4. GREEN 与跨平台证据

### 4.1 公共权威首次 GREEN

- Head：`a660c2b94b508d1739f21311c00c2d04f37b8462`
- Run：`30733659575`
- Job：`91458259088`
- 结论：`SUCCESS`

通过范围：WP0 必需测试、staged-secret scanner、18 项 source identity/Electron 回归、协议描述符校验和可执行本地等价门禁。

### 4.2 Linux/Windows 矩阵

矩阵提交：`3fa616f46d7f9a06fbd0aaba45d40dcfcda89a42`

首次矩阵 Run `30733719770` 中 Ubuntu 成功；Windows 的真实 junction、环境污染和原始绕过用例已经通过，只有两个旧断言把 Windows 临时目录逻辑别名与 canonical 物理路径做字符串比较而失败。

跨平台断言修正提交：`94ed2d31be2ded82724d07c83a5b30c00141a424`。该修正使用 `fs.realpathSync.native()` 比较物理路径等价性，没有降低任何拒绝条件。

最终 Run：`30733768375`

| Job | 平台/范围 | 结论 |
|---|---|---|
| `91458559041` | 完整 WP0 主作业 | `SUCCESS` |
| `91458559053` | Ubuntu sealed-export matrix | `SUCCESS` |
| `91458559065` | Windows sealed-export matrix | `SUCCESS` |

Windows 矩阵 12/12 通过，实际执行了 Node `junction` 创建和拒绝；不是 mock、条件跳过或 Linux 结果替代。

## 5. 独立源码复审检查表

| 检查项 | 结论 |
|---|---|
| 根路径在任何导出写入前执行 `lstat` | PASS |
| 根 symlink / Windows junction fail-closed | PASS |
| `realpathSync.native` 建立唯一物理根 | PASS |
| 祖先 Git、Git CLI、嵌套 Git 扫描统一使用 canonical root | PASS |
| descriptor、identity、payload walk、hash 消费共享权威返回值 | PASS |
| 所有大小写形式 `GIT_*` 从 Git 子进程环境移除 | PASS |
| Git 探测异常保持 fail-closed | PASS |
| API 与 CLI 无第二套判定逻辑 | PASS |
| Linux 和 Windows 运行同一公共 API/CLI 回归 | PASS |
| 原始 symlink/junction + Git subtree + poisoned ceiling 绕过已阻断 | PASS |
| 未新增 allowlist、warning-only、test skip、caller bypass | PASS |

## 6. 结论与下一门禁

`GATE0-SEALED-EXPORT-CANONICAL-PATH` 已在公共治理层完成根因修复，TDD RED、Linux/Windows GREEN 和独立源码复审证据完整，结论为：

```text
blockerStatus=CLOSED
independentSourceReview=APPROVED
```

该结论只关闭 Architecture Closure V2 的实现前治理阻断，不代表业务架构实现完成，不代表 Gate 1、Windows 全量 UAT、三平台实机、候选包、推广或正式发布获准。

下一阶段仅授权：

```text
编写 Architecture Closure V2 实施计划
→ 独立实施计划审查
```

在实施计划获得独立批准前：

```text
productionCodeChangesAllowed=false
wpAImplementationAllowed=false
gate1MayStart=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```
