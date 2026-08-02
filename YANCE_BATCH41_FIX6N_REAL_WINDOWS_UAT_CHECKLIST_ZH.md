# Batch41 FIX6N 真实 Windows 模型路由 UAT 清单

## 基线

1. 校验交付 ZIP SHA-256。
2. 完整解压到短英文路径。
3. 使用隔离数据入口启动。
4. 不点击 OpenRouter 正式专项评估，先验证条件候选链。
5. 导出脱敏诊断并记录构建号、源码身份和数据根。

## A. 接入与候选路由

- OpenRouter 鉴权成功；
- 目录同步完成；
- 两个不同供应商模型最小真实 smoke 成功；
- quick_reply、deep_reply、director、translation 都显示条件主备；
- 主备 failureDomain 不同；
- 正式资格仍显示 pending；
- 全局自动化状态没有被接入动作修改。

## B. 单任务候选执行

分别点击：

- 快速回复测试当前配置；
- 深度回复测试当前配置；
- AI 导演测试当前配置；
- 翻译测试当前配置。

每次必须取得：

```text
routeTestId
executionId
attemptId
workerStarted=true
resolvedPrimary
resolvedFallback
providerRequestId
candidateGenerated=true
humanReviewRequired=true
deliveryEligible=false
formalReceiptEligible=false
```

不得出现“请先选择主模型”或“条件模型未通过正式门禁”一类错误阻断。

## C. 故障注入

### 主模型 429

- receipt 显示 retryAfterMs/nextRetryAt；
- 当前请求切换到独立备用；
- 冷却期间下一请求跳过主模型；
- 重启后冷却仍有效。

### 主模型超时/5xx/网络失败

- 只在总预算剩余时切换备用；
- 备用 timeoutMs 小于等于剩余预算；
- 总等待不超过任务总预算加固定框架余量。

### 普通 400/认证错误

- 不调用备用；
- 返回明确 failureCode；
- 不把配置错误伪装成供应商临时故障。

### 空内容/格式失败

- 空内容不能作为成功候选；
- 可切换独立备用；
- attempt receipt 明确记录 MODEL_EMPTY_RESPONSE 或质量失败。

## D. 取消和晚到结果

- 发起深度回复；
- workerStarted 后立即取消；
- 状态进入 cancelled；
- 远端晚到内容不得进入候选、发送或学习；
- 诊断记录 terminationClass 和 generation fencing。

## E. 重启持久性

- requested/resolved 主备不漂移；
- 429 冷却仍存在；
- 已完成 attempt 收据可查询；
- 未完成任务按持久执行策略恢复或终止；
- 不出现永久等待。

## 关闭条件

只有所有项目具有截图、脱敏诊断、providerRequestId 和同一 trace 链，才能把 `realWindowsUat` 改为 true。正式专项未运行时不得把候选模型标记为生产冠军。
