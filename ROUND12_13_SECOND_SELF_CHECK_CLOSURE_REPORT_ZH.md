# 言策 Round 12 / Round 13｜第二次独立自检与门禁闭环报告

## 一、结论

前一修正版交付 `029237f3171cb76876cae7f18037db527a5de6f4` **再次驳回，不再作为后续可信基线**。

第二次自检没有沿用上一轮报告结论，而是用独立临时 Git 仓库构造反向攻击场景。确认上一版源码预检虽然验证了“实现提交是当前 HEAD 的祖先”，但没有证明后继提交真的只修改交付元数据，也没有检查 Git 工作区是否干净。

这会允许功能代码在冻结实现之后被修改，却仍被标记为 `metadataOnlyDelivery=true` 并通过 `source-baseline`。该问题已经关闭。

当前仍是**源码与自动化检查点**，不是 Windows UAT、真实三平台或真实 OpenRouter 质量通过。

## 二、新功能实现身份

- Branch：`architecture/system-round12-platform-core-unification-20260726`
- Implementation Commit：`cf0e483075332ef7d225b941195289717d9a20d3`
- Implementation Tree：`8982cf4a79559cd9607d8e4cd9b35bb4c302647a`
- Implementation Parent：`029237f3171cb76876cae7f18037db527a5de6f4`
- Implementation Tag：`architecture-round12-round13-selfcheck-v3-implementation-20260726`

## 三、第二次自检发现的两个阻断缺陷

### 1. 任意后继提交可冒充“元数据交付”

旧逻辑仅检查：

- checkpoint Commit 的 Tree 正确；
- checkpoint Commit 是当前 HEAD 的祖先；
- Branch 兼容。

它没有比较 `implementationCommit..HEAD` 的实际变更文件。实测在冻结实现后修改 `backend/core.js` 并提交，旧预检仍返回：

```text
metadataOnlyDelivery=true
baselineContained=true
```

**修复：**

- 使用 `git diff --no-renames --name-only` 枚举实现提交到交付 HEAD 的所有变化；
- 只允许根目录、硬编码命名规则下的 checkpoint、交付状态和报告文件；
- 任何 `backend/`、`frontend/`、`electron/`、`tools/`、`tests/`、`package.json` 等功能或执行文件变化都会阻断；
- 记录 `deliveryChangedPaths / metadataOnlyPaths / functionalChangedPaths`，证据可直接审计。

### 2. 脏工作区修改不影响门禁

旧逻辑只读取 HEAD Commit/Tree，不读取 `git status`。因此已提交身份合法时，即使本地跟踪文件被未提交修改，仍可能通过预检并启动被篡改的源码。

**修复：**

- 预检读取 `git status --porcelain=v1 --untracked-files=all`；
- Git 工作区必须完全干净；
- 脏文件清单进入证据；
- `baselineContained` 现在同时要求 `workingTreeClean=true`。

## 四、新增反向门禁

- 合法的元数据后继提交：允许；
- checkpoint Tree 与实现提交不一致：阻断；
- 实现后修改功能源码：阻断；
- 将功能文件重命名成“报告文件”试图隐藏：阻断；
- HEAD 合法但工作区存在未提交修改：阻断。

## 五、验证状态

- Round 12 平台核心：`26/26 PASS`；
- Round 13 AI 质量：`24/24 PASS`；
- 顶层后端：`768/768 PASS`；
- UAT 诊断：`112/112 PASS`；
- 源码 UAT 交付专项：`26/26 PASS`；
- Round 11 UI 源码契约：`6/6 PASS`；
- 主题颜色审计：`PASS`，固定颜色债务 `0`；
- 第二次自检修改 JavaScript 语法：`2/2 PASS`；
- `candidateBinding.test.js`：当前容器缺少 `express`，未计为通过。

## 六、仍未完成

- Windows 真实安装、启动、渲染、缩放和主题；
- Facebook、WhatsApp、Telegram 真实账号；
- 真实 OpenRouter 高能力主备和商业盲测；
- 所有出站操作统一持久 Outbox；
- Adapter 内部 Auth/Reconcile 全量迁移；
- `domain_event` 权威投影切换；
- 自动跨平台身份合并；
- 自动 L2/L3 学习综合；
- 超时前上下文缩减；
- Kurt 正向与反向完整证据链。

## 七、结论

后续开发只能从本报告的新实现提交，或包含该实现且通过“元数据差异白名单 + 干净工作区”门禁的交付提交继续。`029237f` 及其材料停止作为有效交付基线。
