# 言策 Yance Batch40 FIX6L 候选/生产执行权威修复报告

## 1. 修复目标

FIX6L 针对 FIX6K Windows 实机截图与脱敏诊断暴露的根因进行架构级修复：条件模型虽然已达到 `conditional-ready`，但“测试当前配置”仍被正式质量门禁拦截；工作区局部诊断又可能覆盖后端真实 warning/fail，形成假全绿。

本轮不通过放宽正式资格、伪造正式评估收据、修改错误提示或自动启用全局 AI 来绕过问题。修复保持以下边界：

- OpenRouter 正式专项评估仍为独立人工操作，本轮未运行；
- 未正式合格的模型不能进入生产自动发送；
- 条件模型只允许候选生成，强制人工确认；
- 候选结果不能作为学习、正式资格或发布收据；
- 真实 Windows UAT 必须由用户在 Windows 环境重新执行。

## 2. 根因

FIX6K 仍然让条件试运行与生产执行共用同一条执行语义，只在路由草稿中携带 `allowConditional`。后续质量规划或 Gateway 按生产资格重新判定时，条件语义可能被丢弃。因此，继续补充布尔字段无法消除根因。

同时，主工作区“系统诊断”只执行工作区局部检查，没有合并 `/api/r32/system/diagnostics` 的真实存储、AI、账号、备份和安全探针，导致局部 9/9 通过时错误显示全绿。

## 3. 底层重构

### 3.1 执行模式权威

新增 `backend/services/aiExecutionModeAuthority.js`，定义两个互斥模式：

- `candidate-only`
- `production`

未声明模式时默认按 `production` 严格处理。候选模式固定具有：

- `humanReviewRequired=true`
- `deliveryEligible=false`
- `learningEligible=false`
- `formalReceiptEligible=false`

### 3.2 候选执行器与生产执行器分离

新增：

- `CandidateExecutionService`
- `ProductionExecutionService`

`/routes/:task/test` 只能进入候选执行器。普通 `/execute`、后台任务和现有业务调用默认进入生产执行器。生产执行器会覆盖客户端伪造的 `candidate-only`，避免用请求参数绕过正式门禁。

### 3.3 全链路 routeTestId

新增 `AIExecutionTraceAuthority`。每次“测试当前配置”生成一个 `routeTestId`，贯穿：

1. 前端路由草稿；
2. HTTP 请求；
3. 候选执行器；
4. Gateway 路由解析；
5. worker 启动；
6. provider 请求；
7. 完成或失败收据。

追踪只保存白名单字段，不保存聊天正文、提示词、API Key 或凭据。

### 3.4 质量路由模式化

`aiQualityRouteAuthority.routePlan()` 现在显式接收执行模式：

- 候选模式可使用已由回复大脑权威标记为 selectable 的条件模型；
- 生产模式忽略陈旧的 `allowConditional`，继续要求正式质量资格；
- 候选质量收据默认不能通过正式收据校验。

### 3.5 诊断权威统一

新增 `frontend/js/r32-diagnostic-summary-authority.js`，将工作区检查与后端真实诊断合并。诊断弹窗更名为“言策工作区与系统诊断”。只要后端存在 warning、fail 或 skipped，工作区全绿不能覆盖该状态。

后端诊断新增最近候选路由追踪，只显示安全的追踪号、任务、模型、供应商请求号和原因码。

### 3.6 推荐语义纠正

OpenRouter 一键接入页面不再把静态 onboarding 选择展示为“正式主模型/正式备用模型”，改为：

- 接入候选 A
- 接入候选 B

并明确说明：它们只用于最小 smoke 与条件试运行，不代表言策正式冠军、正式备用或德国市场最佳模型。模型正式适用性仍必须由独立专项评估决定。

## 4. 安全不变量

FIX6L 必须始终满足：

1. 条件候选可以执行人工路由测试；
2. 条件候选不能自动发送到 Facebook、Telegram 或 WhatsApp；
3. 条件候选不能写入学习闭环；
4. 条件候选不能产生正式资格收据；
5. 生产路径默认严格，客户端不能伪造候选模式；
6. 正式专项评估 pending 状态保持不变；
7. 诊断不能将后端真实失败显示为全绿；
8. 每次候选测试都有可追踪的 `routeTestId`。

## 5. 验证范围

本轮执行：

- 后端逐文件测试；
- UI/UAT 逐文件测试；
- 源码交付与派生身份门禁；
- JavaScript 语法检查；
- 候选/生产调用点静态扫描；
- ZIP CRC、重复条目和路径安全校验；
- 打包后重新解压并验证派生源码身份。

本轮未执行：

- OpenRouter 正式专项评估；
- 真实 Windows UI 自动化；
- Facebook、Telegram、WhatsApp 真实账号发送；
- 德国/欧洲正式模型排名与数据驻留验收。

## 6. 发布判断

FIX6L 仅可作为 Windows 源码 UAT 候选。只有用户在真实 Windows 中完成候选路由测试、取得同一 `routeTestId` 的 worker/provider 证据，并确认无自动发送后，才能关闭本轮缺陷。

当前发布门禁保持：

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```
