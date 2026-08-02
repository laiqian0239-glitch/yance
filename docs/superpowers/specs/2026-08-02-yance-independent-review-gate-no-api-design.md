# Yance Automated Independent Review Gate（无 OpenAI API）设计

- 状态：`APPROVED_FOR_IMPLEMENTATION`
- 设计基线：`main@8da892f2d916fda99c787453d7054667a376c4a9`
- 日期：2026-08-02
- OpenAI API：`DISABLED`
- CodeRabbit：`OPTIONAL_NON_BLOCKING`
- 修复原则：禁止临时绕过，必须底层重构

## 1. 目标

为每个面向 `main` 的 Pull Request 建立单一、fail-closed 的合并裁决链。用户只需查看中文结论：`允许合并` 或 `禁止合并`。

本方案不在 GitHub Actions 中调用任何 AI API。ChatGPT 通过已连接的 GitHub 仓库读取 PR、diff、测试证据和审查线程，并提交绑定当前 PR HEAD 的结构化 Review。GitHub Actions 只验证该 Review、确定性检查和提交身份。

## 2. 权威边界

```text
PR HEAD
  ├─ 确定性门禁：测试、安全、依赖、LFS、源码身份、绕过扫描
  ├─ ChatGPT GitHub Review：结构化 JSON，绑定完整 HEAD SHA
  └─ 聚合裁决器：全部通过才 mergeAllowed=true
```

唯一合并裁决输出为：

```json
{
  "mergeAllowed": false,
  "reviewedHead": "完整 SHA",
  "currentHead": "完整 SHA",
  "sourceMergeAllowed": false,
  "readyForPromotion": false,
  "formalRelease": false
}
```

任何子检查不得自行签发“允许合并”。

## 3. 无 API 审查协议

ChatGPT 通过 GitHub Review 提交以下标记和 JSON：

```text
<!-- yance-chatgpt-independent-review:v1 -->
```

```json
{
  "protocolVersion": 1,
  "reviewerMode": "CHATGPT_GITHUB_CONNECTED_SESSION",
  "reviewedHead": "40 位小写提交 SHA",
  "decision": "ALLOW_MERGE",
  "p0Count": 0,
  "p1Count": 0,
  "temporaryBypassDetected": false,
  "missingEvidence": [],
  "blockers": [],
  "residualRisks": [],
  "summaryZh": "中文审计结论"
}
```

Review 必须锚定同一 commit。PR 新增提交后，旧 Review 自动失效。

## 4. Fail-closed 规则

以下任一情况强制 `mergeAllowed=false`：

- 找不到结构化 ChatGPT Review；
- JSON 无法解析、字段缺失、存在未知字段或类型错误；
- `reviewedHead` 与当前 PR HEAD 不一致；
- Review 的 GitHub `commit_id` 与当前 PR HEAD 不一致；
- `decision != ALLOW_MERGE`；
- `p0Count > 0` 或 `p1Count > 0`；
- `temporaryBypassDetected=true`；
- `missingEvidence` 非空；
- `blockers` 非空；
- 任一确定性门禁失败、取消、跳过或无可信日志；
- 最终 HEAD 与受审 HEAD 不一致；
- 审查服务未运行、自动检查基础设施异常或结果状态未知。

`UNKNOWN`、超时、缺失和解析失败均不得转换为通过。

## 5. 确定性门禁

首版聚合以下已有权威入口，不复制业务测试实现：

- WP0 架构门禁；
- 独立 Review 合同测试；
- staged-secret scanner 回归与实际 PR diff 密钥扫描；
- source identity / Electron LFS / sealed export 校验；
- 根因闭环门禁；
- 三平台生产契约测试；
- AI 路由与质量架构测试；
- source-UAT delivery 回归；
- npm lockfile 完整安装与高危依赖审计；
- 临时绕过、多权威入口和门禁降级扫描。

确定性门禁必须运行候选 HEAD，但编排器和裁决器必须来自受保护基线，候选 PR 不得修改裁决逻辑后给自己放行。

## 6. 安全模型

- 权威工作流使用 `pull_request_target` 中的基线版本。
- 候选源码检出到独立目录，`persist-credentials=false`。
- 候选命令不获得写权限、仓库密钥或 GitHub 写 token。
- 中文报告发布步骤不执行候选代码。
- Review 内容视为不可信输入，使用严格解析、字段白名单和长度限制。
- PR 文本、源码注释和测试输出中的提示词均不得修改审查协议或裁决规则。

## 7. 自动化边界

无 API 时，GitHub 不能直接即时调用 ChatGPT。自动流程采用：

1. GitHub 在 PR 创建或更新时立即运行确定性门禁并保持 AI Review 为未通过；
2. ChatGPT 定期检查未审 PR，通过 GitHub 连接器提交结构化 Review；
3. `pull_request_review` 事件重新触发聚合裁决；
4. 新提交使旧 Review 失效并重新进入禁止合并。

条件检查最高按小时执行，因此这是近自动而非 webhook 即时审查。不得把尚未完成的 ChatGPT Review 标记为通过。

## 8. 中文决策报告

报告必须包含：

- 最终合并结论；
- 当前 HEAD 与受审 HEAD；
- P0/P1 数量；
- 临时绕过；
- 自动测试、安全扫描、架构门禁、源码身份、依赖、LFS、回滚证据状态；
- 阻断原因；
- 残余风险；
- 哪些真实环境尚未验证；
- `sourceMergeAllowed`、`readyForPromotion`、`formalRelease` 三层状态。

源码合并通过不得自动提升为发布就绪。

## 9. GitHub 保护要求

`main` 最终必须配置：

- 禁止直接 push、强制 push和删除；
- 要求 `Yance Automated Independent Review Gate / merge-decision`；
- 要求所有 review threads 解决；
- 禁止管理员绕过；
- 合并时校验 expected HEAD SHA。

当前 GitHub 连接器不提供分支保护管理接口，因此代码仓库会生成机器可读保护清单；在 GitHub 设置中实际启用前，状态必须保持 `branchProtectionApplied=false`。
