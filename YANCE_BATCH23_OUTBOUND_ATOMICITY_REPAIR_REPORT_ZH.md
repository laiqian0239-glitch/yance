# 言策 f25fe2e Batch 23 出站原子事务专项修复报告

## 修复基线
- Batch 22 PackageCommit: `14a6e6162fdc8eef81a752fa73ba4219816e3512`
- Batch 22 PackageTree: `d166bfe7214941819d0b32fde40d695e54ba1c69`

## 已确认根因
原出站创建链分为多个独立提交：OutboxRoute/ExternalIdentity、send_queue、r32_messages 与会话摘要。消息投影失败后，调用方收到失败但队列已存在，后台仍可能发送，形成隐藏发送与 UI 永久缺消息。

## 公共层修复
新增 `backend/repositories/outboundCommandRepository.js`，在同一个 SQLite 事务内完成：
1. PlatformAccount 与会话路由校验；
2. ExternalIdentity 与 OutboxRoute 创建/复用；
3. send_queue 入队及 route 绑定；
4. outbound message projection；
5. conversation summary 更新。

任一步失败全部回滚。事务提交后才发布 `message:inserted` 与 `send-queue:enqueued`。

覆盖范围：
- text；
- media；
- Telegram native_expression；
- reaction/revoke 的 route + queue 原子创建（不创建消息投影）。

## 故障注入
- 消息投影失败：route=0、queue=0、message=0；
- 队列写入失败：route=0、externalIdentity=0；
- 正向提交：route、queue、message、conversation summary 同时存在。

## 自动验证
- Batch 22 根因专项 + Batch 23 原子事务专项：13/13 PASS。
- JavaScript syntax: PASS。
- `git diff --check`: PASS。

## 未关闭项
- 完整 162 文件/956 项后端回归尚未在本轮重新执行；
- clean npm ci 尚未执行；
- 真实 Windows Electron、真实平台 ACK、真实 OpenRouter 2/2 未执行；
- Account connection runtime rehydration 与 rollback timeout 仍属后续 P1/P2。

## 治理状态
`REPAIR_ATTEMPT_IN_PROGRESS`
`WINDOWS_UAT_BLOCKED`
`formalRelease=false`
`readyForPromotion=false`
