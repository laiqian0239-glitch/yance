# FIX6N 模型服务任务路由权威设计

日期：2026-08-01  
范围：言策模型服务任务路由、候选/生产边界、主备故障域、重试、超时、冷却、取消与执行收据。

## 1. 根因

FIX6M 建立了证据和持久执行底座，但生产 AI 请求仍由旧网关按分散规则判断。主要缺口：

1. 任务资格、模型能力和路由选择由多个模块重复推断；
2. 候选执行与正式生产的模型资格边界不统一；
3. 备用模型可能处于相同供应商故障域；
4. 400、认证失败、429、5xx、超时、空回复可能采用相同 fallback 行为；
5. 每次重试可能重新获得完整超时，导致总等待不可控；
6. Retry-After 只存在于当前进程，重启后失效；
7. OpenRouter 接入 smoke 验证了翻译能力，却没有建立 translation 候选路由。

## 2. 参考模式

仅吸收架构模式，不复制第三方业务源码：

- LiteLLM Router：统一供应商调用、异常分类、独立部署 fallback、冷却和调用观测；
- Dify：Provider 配置、模型目录、连接验证、任务能力与正式资格分离；
- Temporal：一次任务共享执行预算、持久 attempt、取消和晚到结果 fencing；
- LangGraph：候选生成、人工审核、正式发送之间的状态边界；
- Langfuse：Trace、Generation、attempt 和 provider request receipt 层级。

言策继续使用 Node/CommonJS、SQLite 和现有 Electron 运行形态，不新增 Python 路由服务或外部工作流服务器。

## 3. 唯一路由链

```text
TaskRequest
  -> TaskRoutePolicy
  -> ModelRoutingIntegrityService
  -> AiQualityRouteAuthority
  -> ModelServiceTaskRoutingAuthority
  -> AiGateway
  -> Durable Model Attempt
  -> Normalized Result / Failure Receipt
```

### 候选模式

- 可使用明确通过 onboarding smoke 的条件模型；
- translation 必须在模型 `allowedTasks` 中明确声明；
- 强制 `humanReviewRequired=true`；
- `deliveryEligible=false`；
- `formalReceiptEligible=false`；
- 不得写入正式学习。

### 生产模式

- 快速回复、深度回复、导演继续要求任务级正式资格收据；
- 翻译生产路由继续要求正式 translation 资格；
- 不因 smoke、目录存在或路由分数高而放宽生产门禁。

## 4. 故障恢复策略

| 故障 | 同模型重试 | 独立备用 | 冷却/熔断 |
|---|---:|---:|---:|
| 取消、generation 过期 | 否 | 否 | 否 |
| 认证/凭据失败 | 否 | 否 | 否 |
| 普通 4xx/请求结构错误 | 否 | 否 | 否 |
| 模型不存在/下线 | 否 | 是 | 是 |
| 429 | 否 | 是 | 按 Retry-After 持久冷却 |
| 超时 | 可受控缩减上下文一次 | 是 | 是 |
| 网络/5xx | 否 | 是 | 是 |
| 空内容/格式/质量失败 | 否 | 是 | 计入质量失败 |
| 未分类异常 | 否 | 否 | 否 |

备用模型必须位于不同供应商故障域。同一供应商的两个模型不能被描述为高可用主备。

## 5. 总超时预算

所有 attempt 共享一次请求总预算：

```text
totalBudgetMs
  = primary attempt
  + optional reduced-context retry
  + fallback attempt
  + framework overhead
```

后续 attempt 只能获得剩余预算，不允许每次重新获得完整超时。

## 6. Retry-After 持久化

429 的 `Retry-After` 被归一化为：

- `retryAfterMs`
- `nextRetryAt`
- 模型注册表 `circuitOpenedAt`
- 模型注册表 `circuitOpenedUntil`

新网关实例启动时读取该时间，冷却未结束前跳过模型。

## 7. OpenRouter translation 候选

最小真实 smoke 已同时检查中文翻译。FIX6N 将 `translation` 加入 smoke 的条件任务声明，并建立：

```text
translation.primary
translation.fallback
allowConditional=true
humanReviewRequired=true
```

这只使翻译候选测试可执行，不授予正式翻译资格。

## 8. 收据字段

每次 attempt 至少记录：

```text
routeTestId / traceId
executionId
attemptId
task
executionMode
modelId
provider
failureDomain
role
providerRequestId
httpStatus
timeoutMs
remainingBudgetMs
latencyMs
fallbackAllowed
retrySameModel
retryAfterMs
nextRetryAt
outcomeUnknown
terminationClass
```

## 9. 发布边界

源码测试通过不等于真实模型路由完成验收。关闭 FIX6N 仍需 Windows 实机取得：

- quick_reply、deep_reply、director、translation 候选生成；
- 主模型 429/超时/5xx 后独立备用真实成功；
- 非重试错误不调用备用；
- 取消后晚到结果不提交；
- 重启后冷却与 requested/resolved 路由不漂移；
- 每次真实调用具有 providerRequestId。
