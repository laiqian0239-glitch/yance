# 言策冠军回复大脑与分层工作模型设计

## 目标

在不降低 FIX6D 收据、隔离和原子状态门禁的前提下，把正式回复路由改为“每个回复任务必须使用当前有证据证明最强的冠军模型”，同时将免费 OpenRouter 模型和本地模型用于翻译理解、联系人关系分析、摘要、事实提取等后台工作，以保护 15 美元付费额度。

## 已确认产品原则

1. `quick_reply`、`deep_reply`、`director` 的正式输出只能来自对应任务的冠军模型；备用模型必须是同任务亚军且与冠军的任务分差不超过 8 分。
2. 人工指定不能绕过冠军资格。需要试用较弱模型时，只能进入已有 conditional + 人工确认路径，不能作为正式自动回复。
3. `translation` 分为两个用途：`outbound` 最终发送翻译走正式翻译冠军；`realtime/history/offline` 理解型翻译优先本地模型，其次免费云模型，最后才允许付费云模型。
4. `relationship`、`understanding`、`fact_extraction`、`memory_extraction`、`summary` 优先本地隐私大脑，其次免费云端工作大脑；付费模型只在策略明确允许且预算未进入保护区时使用。
5. 预算保护只减少后台付费工作，不能把正式回复静默降级为弱模型。
6. 所有选择必须返回可审计决策：任务、执行层、冠军/亚军、分数、预算状态、拒绝原因和模型来源。

## 架构

### ReplyChampionAuthority

从已通过正式任务资格收据的模型中，按 `ReplyBrainModelAuthority.taskQualification(model, task).score` 排序。分数相同时，使用完整回复基准总分、最近真实成功调用、稳定性事实和模型 ID 做确定性排序。权威返回冠军、合格亚军、候选排名和拒绝原因。

### AIWorkloadPlacementAuthority

把任务映射为三条执行层：

- `champion-paid-or-best`：正式回复与最终发送翻译。
- `local-private-first`：关系分析、理解、事实/记忆提取、摘要和历史翻译。
- `free-cloud-first`：本地模型缺失或不合格时使用 OpenRouter 免费模型。

模型来源由 provider、OpenRouter 目录 `free/pricing` 元数据和正式资格共同判定；不通过任务资格的模型永不进入候选池。

### AIBudgetAuthority

读取模型注册表中的 `aiBudgetPolicy` 和 `aiBudgetUsage`。默认总额度 15 美元、冠军回复保留 5 美元、后台付费调用在可用余额低于保留额时被拒绝。免费模型和本地模型不消耗付费预算。该权威只做准入决策，不根据估算值虚构实际花费。

### 集成点

- `ModelRoutingIntegrityService`：自动路由改为调用冠军权威或工作负载分层权威，不再使用模型名称和参数量作为正式回复决定因素。
- `AIQualityRouteAuthority`：正式回复路由增加冠军一致性与亚军分差门禁。
- `AiGateway`：根据任务和翻译 profile 解析权威执行计划，并把 placement/budget/champion 决策写入路由回执。
- `models` API：新增只读 `/models/brain-routing`，输出冠军、分层和预算状态；新增受控 `/models/budget-policy` 更新策略，不允许通过该接口降低正式回复质量门禁。

## 失败处理

- 无冠军：正式回复阻断，返回 `AI_REPLY_CHAMPION_UNAVAILABLE`。
- 冠军不可用且亚军超过分差：阻断，不静默降级。
- 后台任务无本地/免费模型且预算受保护：返回可恢复的 `AI_BACKGROUND_PAID_BUDGET_PROTECTED`。
- 本地模型失败：可切换到免费云模型；只有策略允许时才切换付费工作模型。
- 预算状态不可读：后台付费 fail-closed；正式冠军回复仍按已配置质量路由执行并明确记录预算状态未知。

## 测试

新增独立 RED→GREEN 测试覆盖：冠军选择、人工弱模型绕过、亚军分差、最终回复不受预算降级、理解型翻译本地优先、免费云回退、关系分析隐私优先、预算保护阻断后台付费、最终发送翻译冠军门禁、决策回执可审计。回归运行原 FIX6D、AI 路由、商业模型基准、模型注册表、WP5 和源码交付门禁。
