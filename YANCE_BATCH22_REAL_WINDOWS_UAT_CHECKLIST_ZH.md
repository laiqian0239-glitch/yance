# 言策 f25fe2e｜Batch 22 真实 Windows UAT 与根因证据清单

> 自动测试不能代替真实 Windows Electron、真实平台或真实 OpenRouter。

## A. 制品与启动身份

- [ ] 校验源码 ZIP、交接 ZIP、Git bundle、sidecar 和 SHA256SUMS；
- [ ] 从 ZIP 除 `YANCE_PACKAGE_IDENTITY.json` 外重建 Git Tree，必须等于 sidecar `packageTree`；
- [ ] Git bundle 必须可恢复 sidecar `packageCommit`；
- [ ] UI/诊断显示 Batch 22，不显示 Batch 19/20/21 旧身份；
- [ ] 记录 Windows、Electron、Node、DPI、窗口尺寸、DataRoot；
- [ ] 冷启动、退出、重启后身份和 DataRoot 不变。

## B. 状态权威与 ACK

- [ ] connected 且无 ACK：`canAttemptSend=true`，`sendVerified=false`；
- [ ] 账号中心、会话中心、系统中心、Outbox 和 Adapter 状态一致；
- [ ] text ACK 后才更新 `sendVerified=true`；
- [ ] emoji-only 失败不阻断已验证 text；
- [ ] 平台接受但本地证据失败时结果不确定并禁止自动重发；
- [ ] ACK 失败/过期后不再显示 verified。

## C. 身份、消息与路由

对 WhatsApp、Facebook、Telegram分别执行：

- [ ] 新入站生成 PlatformAccount、ExternalIdentity、IdentityLink、ConversationBinding、Message；
- [ ] 账号、平台、外部身份、Person、会话一致；
- [ ] 失败注入后事务整体回滚，不留空会话或无主消息；
- [ ] OutboxRoute 与 SendQueue 同事务；
- [ ] 错账号、错平台、错目标、缺账号均失败关闭；
- [ ] 重启后绑定和路由不丢失。

## D. 实时、历史、Echo 与 UI hydration

- [ ] 新入站落 SQLite 后当前会话自动可见；
- [ ] translation/media 事件只触发 SQLite reload，不重复插入；
- [ ] Facebook Business Suite Echo 只出现一次；
- [ ] 历史同步与实时事件去重、顺序稳定；
- [ ] 重启后正文、摘要、翻译和媒体状态一致。

## E. 认证与异步生命周期

- [ ] QR/验证码等待时 operation=RUNNING；
- [ ] 真正登录后同一 operation=SUCCEEDED；
- [ ] 拒绝/超时=FAILED，取消=CANCELLED；
- [ ] 新任务 supersede 旧任务，旧回写被拒绝；
- [ ] 重启后不存在无法解释的永久 RUNNING；
- [ ] AI、翻译、同步、reconcile、OpenRouter 冒烟同样记录 operationId/generation/fingerprint。

## F. 真实平台发送矩阵

每项保存 commandId、outboxId、routeId、idempotencyKey、providerRequestId、platformMessageId、ACK/错误、截图和日志。

- [ ] Facebook：文字、单 emoji、图像、GIF、语音/音频、文件；
- [ ] WhatsApp：文字、单 emoji、图像、GIF/贴纸、语音、文件、引用；
- [ ] Telegram：文字、单 emoji、图像、GIF/贴纸、语音、文件。

## G. OpenRouter 与 AI 闭环

- [ ] Key 安全存储且不回显；
- [ ] 两个不同模型分别保存真实 request ID、returned model、HTTP、latency、tokens；
- [ ] 2/2 前路由 blocked/pending；
- [ ] 2/2 后最多 conditional-ready，不冒充 formally-qualified；
- [ ] `你好`、`Hallo`、`Hi`、单 emoji、Kurt 样本生成 3–5 条不同方向候选；
- [ ] 仅真实 ACK 后学习，失败/未发送不学习；
- [ ] 重启后事实、关系和学习仍生效。

## H. Windows UI 与设计系统

在 100%、125%、150% DPI；标准/舒适/大字；紧凑/舒适；29 套主题执行：

- [ ] 会话、账号、系统、设置、联系人、档案、时间线、洞察、AI 工作台无标题遮挡和底部裁切；
- [ ] 3–5 条候选、微调、证据、错误和重试完整可见；
- [ ] 长文本自然撑高，主页面滚动权威唯一；
- [ ] 对比度、focus、状态胶囊和账号名可读。

## I. 自动与独立审核

- [ ] clean `npm ci`；
- [ ] 162 个 backend test 文件逐文件隔离复跑，956/956；
- [ ] Batch 22、Round 12、Round 13、平台、UAT、Source UAT、可读性、Final Review 全通过；
- [ ] 独立审核核对截图、录屏、SQLite、ACK、OpenRouter、重启和制品身份；
- [ ] 任一真实门禁失败则保持 `WINDOWS_UAT_BLOCKED`。
