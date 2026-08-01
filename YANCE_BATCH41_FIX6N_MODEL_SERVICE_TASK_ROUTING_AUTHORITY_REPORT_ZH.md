# 言策 Batch41 FIX6N 模型服务任务路由权威修复报告

## 结论

FIX6N 不是界面绕过修复，而是对实际 `ModelRoutingIntegrityService → AiQualityRouteAuthority → AiGateway → ModelExecutor` 生产链进行底层重构。

本轮完成：

- 候选与生产任务资格在同一公共策略下决策；
- OpenRouter onboarding smoke 成功模型可用于人工 translation 候选；
- 正式回复与翻译生产资格继续严格阻断；
- 主备必须跨供应商故障域；
- 非重试 4xx、认证和配置错误停止执行；
- 429 按 Retry-After 冷却并持久化；
- 超时、5xx、网络、空内容和质量失败才允许受控独立 fallback；
- 所有 attempt 共享一个总超时预算；
- attempt 收据包含 providerRequestId、failureDomain、剩余预算和恢复决策；
- 取消和 generation supersession 后的远端晚到结果继续被 fencing。

## 开源参考吸收

| 项目 | 吸收模式 | 未直接引入内容 |
|---|---|---|
| LiteLLM | Provider 错误归一化、fallback、冷却、调用收据 | Python Proxy/Server |
| Dify | Provider、目录、连接、任务资格、生产路由分层 | 插件运行时和受限前端源码 |
| Temporal | 总执行预算、持久 attempt、取消和恢复语义 | Temporal Server |
| LangGraph | 候选、人工确认、生产发送状态边界 | Agent 图运行时 |
| Langfuse | Trace/Generation/attempt 证据层级 | 外部可观测服务依赖 |

## 关键行为

### 条件 translation

OpenRouter 最小真实接入同时验证中文翻译后，会建立 translation 主备候选路由。该路由：

- 允许“测试当前配置”；
- 必须人工确认；
- 不允许自动发送；
- 不生成正式资格收据；
- 不代表德国/欧洲市场正式合格。

### 生产门禁

生产 quick_reply、deep_reply、director 仍要求任务级 role qualification receipt。生产 translation 仍要求正式 translation 资格。系统不会把 smoke 通过等同于正式商业专项通过。

### 失败恢复

路由只在错误分类明确允许时 fallback。普通 400、认证失败和未分类错误不再盲目调用备用模型。429、超时、5xx、网络和质量失败只能切换到独立供应商故障域。

## 未完成边界

本环境没有运行：

- OpenRouter 正式专项评估；
- 真实 Windows UI/UAT；
- 真实供应商故障注入；
- 三平台 AI 自动回复生产发送。

因此交付状态保持：

```text
realWindowsUat=false
formalOpenRouterEvaluation=false
readyForPromotion=false
formalRelease=false
```
