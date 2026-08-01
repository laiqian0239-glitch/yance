# 言策 Yance Batch40 FIX6E Champion Brain 底层重构报告

## 1. 交付身份

- 输入基线：FIX6D Runtime Authority V1 独立派生修复 R2
- 本轮身份：`FIX6E_CHAMPION_BRAIN_DERIVED_V1`
- 交付性质：独立派生源码包，不冒充官方 Git 提交或正式安装候选包
- 修复约束：全部改动位于公共权威、路由、注册表和网关层，无调用方临时绕过

固定发布门禁：

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

## 2. 已实施能力

### 2.1 任务冠军回复大脑

新增 `ReplyChampionAuthority`。`quick_reply`、`deep_reply`、`director` 只从具有当前正式任务资格收据的模型中产生冠军和亚军。排序依据为任务专项分、完整回复基准、真实运行证据、当前失败状态和测试时间，不再以模型名称、参数量或云端身份作为正式质量结论。

人工指定的弱模型不能替换正式冠军。只有在完全不存在正式冠军且路由明确开启 `allowConditional=true` 时，系统才允许进入 conditional 试运行；该路径强制人工确认，不属于正式自动回复，也不得进入长期学习。

### 2.2 分层工作大脑

新增 `AIWorkloadPlacementAuthority`：

- 正式回复：冠军 → 分差不超过 8 分的独立亚军；
- 最终发送翻译：正式翻译质量冠军优先；
- 历史/理解型翻译：本地模型 → OpenRouter 免费模型 → 付费云模型；
- 联系人关系、理解、事实/记忆提取、摘要：本地隐私模型 → 免费云模型 → 付费云模型；
- 未提供可靠价格元数据的云模型按付费模型处理，禁止误判为免费模型。

### 2.3 15 美金额度保护

新增 `AIBudgetAuthority`，默认：

- 总额度：15 美元；
- 冠军与质量关键任务保留：5 美元；
- 本地和免费模型不受付费准入限制；
- 后台付费任务在剩余额度进入保留区后 fail-closed；
- 正式冠军回复及最终发送翻译可以使用质量保留额，不能被预算策略静默降级；
- 云模型成功调用后，使用服务商回执成本或目录定价估算，原子累加到统一额度账本，并明确记录成本来源。

### 2.4 路由与诊断 API

- `GET /models/brain-routing`：输出任务冠军、亚军、后台执行层、拒绝原因和预算状态；
- `PATCH /models/budget-policy`：受控更新总额度、保留额度及后台付费开关；
- 无效配置，例如保留额度大于总额度，返回 `AI_BUDGET_POLICY_INVALID`；
- `AiGateway` 路由回执新增 champion、placement 和 budget 决策；
- 排队任务完整保留 `background` 和 `translationProfile`，历史翻译不会在进入队列后被改成正式发送路径。

## 3. RED→GREEN 与缺陷闭环

1. 三个新权威模块不存在：RED；实现后权威单测 GREEN。
2. 弱模型可作为正式手动回复：RED；冠军一致性门禁后 GREEN。
3. 后台付费任务可侵占冠军保留额：RED；预算准入后 GREEN。
4. 未知价格云模型被误判免费：RED；未知价格统一按付费云模型后 GREEN。
5. 额度账本不随成功调用增长：RED；注册表事务内原子累计后 GREEN。
6. 排队任务丢失后台翻译 profile：RED；提交和执行两阶段统一携带路由上下文后 GREEN。
7. 最终发送翻译被后台预算规则阻断：RED；质量保留路径后 GREEN。
8. 冠军收口误伤旧 conditional 人工试运行：全量回归发现 2 条失败；在统一路由权威恢复“无冠军才允许 conditional”，最终 GREEN。

## 4. Fresh 验证结果

| 验证层 | 结果 |
|---|---:|
| 修改 JS 文件语法检查 | 14/14 PASS |
| 最终聚焦回归 | 78/78 PASS |
| Round13 AI 质量 | 24/24 PASS |
| WP5 状态权威 | 68/68 PASS |
| 源码 UAT 交付门禁 | 41/41 PASS |
| 后端逐文件隔离 | 199/199 文件 PASS |
| 后端逐文件测试 | 1169/1169 PASS |
| 后端失败/缺失/取消 | 0/0/0 |

测试造成的 `data/database/yance-r32.db` 运行污染已恢复为输入基线字节：

`7ea2c4ea67963ca820712d83821cfd3180ff357eff3185406164f8d38427f0f7`

## 5. 外部工具与真实链路边界

- StubEngine：组织列表为 `[]`，未创建 endpoint，未把模拟结果作为 OpenRouter 证据。
- SonarQube：当前会话没有 Sonar MCP、`sonar` CLI 或 Docker/Podman/Nerdctl，无法产生真实 SonarQube 扫描结论；不可用状态已留证。
- 本轮没有真实 OpenRouter 调用、真实 Windows 三档缩放、真实三渠道或本地 Ollama 性能实测，不能据此提升发布门禁。

## 6. Windows / 真实服务续验重点

1. 在真实 OpenRouter 账号中验证冠军、亚军和免费模型目录事实；
2. 验证 15 美元账本与 OpenRouter 实际成本回执一致；
3. 验证免费模型额度耗尽后按本地/免费/付费顺序切换；
4. 验证最终发送德语翻译仍由正式翻译冠军处理；
5. 验证联系人关系分析默认只在本地运行，除非本地模型不合格；
6. 验证无正式冠军时 conditional 结果必须人工确认且不进入长期学习；
7. Windows 100%/125%/150% 下检查新增诊断数据对应界面（若后续接入 UI）。
