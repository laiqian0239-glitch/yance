# 言策 f25fe2e｜Batch 21 源码变更清单

## 新增公共权威

- `backend/services/platformDeliveryAuthority.js`
  - 真实平台 ACK 持久化；
  - text / emoji-only / media / reaction / revoke 分能力；
  - ACK 时效、失败原因、provider request/message ID；
  - 账号发送验证投影。

- `backend/services/asyncOperationLifecycleAuthority.js`
  - CREATED/RUNNING/SUCCEEDED/FAILED/CANCELLED/SUPERSEDED；
  - operationId、scope、fingerprint、generation；
  - stale completion 拒绝；
  - SQLite 持久化与系统中心读取。

## 状态与发送链

- `accountManager`：拆分 `canAttemptSend`、`sendVerified` 与严格 `canSend`；
- `platformAdapterPorts`：所有发送成功/失败写入 ACK 权威；平台已接受但证据落库失败时阻断自动重试；auth/reconcile 接入统一 operation；
- `sendQueueService`：增加 platform-accepted/outcome-uncertain 状态；
- `sendPolicyAuthority` 与 capability/readiness：无 ACK 只能 degraded/uat-required；
- 前端账号中心、会话路由与系统中心显示统一权威状态。

## 身份、会话与消息链

- `IdentityLinkAuthority` 增加事务内观察与提交后事件完成；
- `messageRepository` 将联系人、Person、IdentityLink、ConversationBinding、Message、Conversation 同事务提交；
- `accountRepository` 以 SQLite 会话和 binding 为路由权威，拒绝不存在会话和跨账号冲突；
- UI 实时消息/媒体/翻译事件只触发 SQLite reload，不再直接拼接消息数组。

## AI、OpenRouter 与翻译任务

- AI 候选 runtime 接入持久化 operation；
- 新消息/新对象使旧候选 operation superseded；
- 翻译任务接入统一生命周期并保留旧测试假存储兼容边界；
- OpenRouter 双模型冒烟只有 2/2 后才能写条件路由；
- 系统中心输出 active/recent/failed operation。

## 全局设计系统

- 新增 Batch 21 全局语义字号、控制高度、密度间距与组件 padding 变量；
- 生产 panel/card/control/actions/body 统一继承；
- 大字自然增高、增强对比 focus、根节点 display authority 版本与事件；
- 保留单页滚动/自然高度公共布局权威。

## 测试预言机

- connected 不再等于 ready；
- Adapter 用例使用隔离 SQLite；
- 新增 Batch 21 根因、身份回滚、ACK 拆分、OpenRouter 2/2、SQLite hydration 与设计系统测试；
- 新增 npm 脚本 `test:batch21-root-cause`。
