# Yance Batch40 FIX6L 真实 Windows UAT 清单

## 前置条件

- 使用 FIX6L 一键启动包的隔离数据入口；
- 不点击“运行 OpenRouter 正式专项评估”；
- 不连接真实社交平台账号，避免任何外发风险；
- 保留 OpenRouter 当前已接入 Key；
- 完整关闭旧版言策进程后再启动。

## A. 版本和边界

1. 系统中心确认构建包含 `FIX6L_CANDIDATE_PRODUCTION_AUTHORITY` 派生身份。
2. OpenRouter 页面应显示“接入候选 A/B”，不得显示为正式冠军或正式备用。
3. 正式专项评估状态仍应显示未运行或 pending。

## B. 条件候选执行

分别对快速回复、深度回复和 AI 导演执行“测试当前配置”：

1. 点击后界面立即显示 `routeTestId`；
2. 条件模型达到 selectable 时，不得再提示“未通过质量能力门禁”；
3. 成功时应返回候选文本或导演结构结果；
4. 结果必须标记需要人工确认；
5. `deliveryEligible=false`；
6. `learningEligible=false`；
7. `formalReceiptEligible=false`。

## C. 追踪证据

导出脱敏诊断，检查同一 `routeTestId` 至少包含：

- `route-test-started`
- `route-draft-validated`
- `gateway-route-resolved`
- `worker-started`
- `provider-result` 或明确失败原因
- `route-test-completed` 或 `route-test-failed`

成功调用时应存在非空 provider request ID。诊断不得包含聊天正文或 API Key。

## D. 生产隔离

1. 不连接任何社交账号时，候选测试不得生成待发送任务；
2. 候选测试后消息数据库仍为 0 条外发；
3. 全局 AI 自动化状态不得被一键接入或候选测试改变；
4. 重启后正式资格仍为 pending，候选结果不得被提升为正式资格。

## E. 诊断真实性

1. 打开“言策工作区与系统诊断”；
2. 当 AI 回复大脑、翻译路由或 OpenRouter 正式评估尚未完成时，弹窗不得显示 0 warning / 0 fail 的假全绿；
3. 弹窗汇总应与导出的后端诊断 warning/fail/skipped 一致；
4. 最近候选路由失败应显示为可追踪的 warning，而不是永久等待。

## 关闭条件

只有以下全部满足才可关闭 FIX6L：

- 三个候选任务可真实执行；
- 正式资格仍保持 pending；
- 没有自动发送；
- 没有学习写入；
- 诊断不再假全绿；
- 重启后状态不漂移；
- 截图和脱敏诊断包含同一 `routeTestId`。
