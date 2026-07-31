# 言策 Round 12/13｜产品治理与内部收束源码闭环报告

## 一、阶段结论

本轮以 `6a95ac5ec4cd2c3b87701291a7a103a09093d829` 为基线，继续关闭此前明确遗漏的五项：

| 项目 | 当前源码状态 | 仍需外部证据 |
|---|---|---|
| 通用 UI Capability 迁移 | 通用在线状态、Typing、Presence、历史同步等决策统一查询能力权威；平台专属登录、授权与专项诊断保留显式平台流程 | Windows 中逐平台按钮露出、灰化、reasonCode 和局部降级 |
| Adapter 内部收束 | 具体 Facebook、WhatsApp、Telegram Adapter 只允许由 `platformDriverRegistry.js` 导入；生命周期、消息执行、媒体重试、Webhook 等经注册表分发 | 三平台真实 Auth / Ingress / Egress / Reconcile |
| IdentityLink 产品治理 | 已提供 Person/IdentityLink 总览、强证据建议、人工确认、争议、解除、合并与审计回滚入口；显示名自动合并继续禁止 | 真实客户多平台链接、错误链接解除和合并回滚 |
| 事件投影运维闭环 | 支持全量分页审计、阻断收据列表、单事件修复、批量重放和修复后重新收敛；不再只扫描固定 5000 条 | 真实数据库全量扫描且 `blocking=0` |
| L2/L3 产品治理 | 自动综合状态、失败 reasonCode、L3 待审提案、批准/拒绝、版本回滚、忘记和审计已接入正式产品入口 | 真实反馈样本下的综合质量和人工审核结果 |

## 二、实现身份

- Branch：`architecture/system-round12-13-product-governance-closure-20260727`
- Implementation Commit：`9efce5d3503f3557937cc8efd4e92620df791629`
- Implementation Tree：`2ed2f8438a70df1bd8641c2c99d88be9e193d09d`
- Parent：`6447cb775c138398ea741fceb3b1c333fe60cc9e`
- Tag：`architecture-round12-round13-product-governance-implementation-v2-20260727`

## 三、关键安全边界

- 通用业务能力只问 Capability Authority，不以平台名称猜测；平台专属认证协议和诊断仍可显式分支。
- 具体平台 Adapter 只有一个组合根；路由、Runtime、AccountManager 和消息执行层不得直接导入具体 Adapter。
- IdentityLink 只能基于账号范围身份和证据治理；显示名、头像、城市等弱相似信息不能自动合并。
- L3 只自动形成提案，不能自动激活；批准、拒绝、回滚和忘记都必须留下审计。
- 事件修复要求操作者和原因，写入后必须再次验证投影一致性。
- 当前仍不宣称真实 Windows、真实三平台、真实数据库投影收敛或真实 OpenRouter 质量通过。

## 四、自动验证

- Round 12 平台核心：53/53 PASS
- Round 13 AI 质量：24/24 PASS
- 最终综合专项：34/34 PASS
- 后端全量：144/144 文件，874/874 测试 PASS
- CandidateBinding：3/3 PASS
- UAT 诊断：112/112 PASS
- Source UAT：33/33 PASS
- Round 11 UI 契约：6/6 PASS
- Windows 包契约：7/7 PASS
- 主题颜色审计：PASS，固定颜色债务 0
- 修改 JavaScript：25/25 syntax PASS
- Git diff：PASS
- 完整依赖 Persona API：当前容器缺少 `express`，未计为通过；综合 Windows 安装器完成 `npm ci` 后将其作为强制预启动门禁

## 五、Windows 证据合同

综合 UAT 检查清单已明确覆盖：IdentityLink 的确认/争议/解除/合并/回滚；event-first 投影的全量分页审计、阻断收据、修复重放及 `blocking=0`；L2/L3 调度健康、提案批准/拒绝、回滚和忘记。

## 六、阶段判定

当前可生成新的综合 Windows UAT 候选，但仍不是正式发布版。Windows UAT 必须验证真实运行身份、真实数据根、完整事件投影收敛、三平台真实能力与局部降级、IdentityLink 人工治理、L2/L3 审核流程、OpenRouter 高能力同档主备和 Round 11 界面。
