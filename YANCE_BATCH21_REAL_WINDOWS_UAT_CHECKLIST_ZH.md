# 言策 f25fe2e｜Batch 21 真实 Windows UAT 与根因证据清单

> 本清单用于真实 Windows Electron、真实平台与真实 OpenRouter。自动测试、Chromium 模板或 DOM 存在性不能代替本清单。

## A. 启动与身份

- [ ] 从 Batch 21 源码包一键启动，不使用旧安装目录或旧运行制品；
- [ ] 记录源码 ZIP SHA256、ImplementationCommit/Tree、PackageCommit/Tree；
- [ ] 记录 Electron/Node/Windows 版本、DPI、窗口尺寸和 DataRoot；
- [ ] 确认 UI/诊断中显示 Batch 21 身份，不得显示 Batch 19/20 旧描述符；
- [ ] 重启一次，身份与 DataRoot 不变。

## B. RC-01 状态权威

对每个账号记录：credentialReady、runtime state、canAttemptSend、sendVerified、sendReadiness、最近 ACK 时间和 reasonCode。

- [ ] connected 且无真实 ACK：允许首次尝试，但不得显示“真实可发送”；
- [ ] text ACK 成功：text capability 与 sendVerified 更新；
- [ ] ACK 过期/失败：不得继续显示 verified；
- [ ] 账号中心、会话头、输入区、系统中心和发件箱状态一致；
- [ ] 不出现 `OUTBOX_REVERIFY_REQUIRED` 与 UI “可发送”互相矛盾。

## C. RC-02/03 身份、消息与 UI hydration

### WhatsApp

- [ ] 既有联系人/历史可见；
- [ ] 新联系人发一条文字：Message、Conversation、Person、IdentityLink、ConversationBinding 同时存在；
- [ ] 入站正文立即或同步完成后可见，不只出现空会话壳；
- [ ] LID/JID/账号实例与 OutboxRoute 一致；
- [ ] 重复 webhook/历史事件不重复消息；
- [ ] 重启后会话、正文、绑定和摘要一致。

### Facebook

- [ ] webhook 入站、Business Suite 外部发送 Echo、历史补偿均只生成一个消息；
- [ ] 消息顺序按平台时间/持久化顺序稳定；
- [ ] 翻译完成后由 SQLite reload 更新，不重复新增消息；
- [ ] 左侧摘要保持 1–2 行且与显示模式一致。

### Telegram

- [ ] 登录完成后历史/会话进入同一 SQLite 投影；
- [ ] 重启后身份与会话绑定不丢失。

## D. RC-04 异步生命周期

为每类任务保存 operationId、generation、fingerprint、开始/结束时间和最终状态：

- [ ] AI 3–5 条候选；
- [ ] 翻译；
- [ ] WhatsApp/Telegram 扫码或登录；
- [ ] Facebook OAuth；
- [ ] 历史同步/reconcile；
- [ ] OpenRouter 双模型冒烟。

反向验证：

- [ ] 新消息到达后旧 AI operation 变 SUPERSEDED，旧结果不能回写；
- [ ] 取消登录/翻译后为 CANCELLED；
- [ ] 失败为 FAILED 且保留 reasonCode；
- [ ] 重启后不存在无法解释的永久 RUNNING。

## E. RC-05 真实平台 ACK 能力矩阵

每次发送保存：commandId、outboxId、idempotencyKey、payload class、provider request ID、platform message ID、ACK/错误和截图。

### Facebook

- [ ] 普通文字；
- [ ] 单个 emoji；
- [ ] 图像；
- [ ] GIF；
- [ ] 音频/语音；
- [ ] 文件。

### WhatsApp

- [ ] 普通文字；
- [ ] 单个 emoji；
- [ ] 图像；
- [ ] GIF/贴纸；
- [ ] 语音；
- [ ] 文件；
- [ ] 引用回复。

### Telegram

- [ ] 普通文字；
- [ ] 单个 emoji；
- [ ] 图像；
- [ ] GIF/贴纸；
- [ ] 语音；
- [ ] 文件。

反向验证：

- [ ] 一个 payload 失败不会把其他已验证 capability 清零；
- [ ] 平台接受但本地 ACK 证据失败时，不自动重发；
- [ ] success 无 platform message ID 不得记成功。

## F. RC-06 OpenRouter

- [ ] Key 仅在安全存储中，界面不回显；
- [ ] 鉴权与模型目录成功；
- [ ] 主模型和备用模型是两个不同 slug；
- [ ] 模型 1：真实请求 ID、returned model、HTTP、latency、tokens、结果；
- [ ] 模型 2：真实请求 ID、returned model、HTTP、latency、tokens、结果；
- [ ] 2/2 前 routeStatus=blocked/pending；
- [ ] 2/2 后只能 conditional-ready/human-review-required；
- [ ] 正式商业专项未完成时不得显示 formally-qualified；
- [ ] 额度不足、429、超时、供应商错误分别可诊断且不会伪装为成功。

## G. AI 回复与学习闭环

固定样本：`你好`、`Hallo`、`Hi`、单个 emoji、Kurt 事实样本。

- [ ] 理解完成后自动生成 3–5 条方向不同候选；
- [ ] 候选与微调在右侧 AI 回复大脑；
- [ ] 新入站使旧候选失效；
- [ ] 失败/未发送不学习；
- [ ] 只有真实平台 ACK 后学习；
- [ ] 下一轮体现学习；
- [ ] 重启后学习仍生效；
- [ ] 事实写回与证据一致，不虚构低信息事实。

## H. RC-07 Windows UI 与布局

分别在 100%、125%、150% DPI；标准/舒适/大字；标准/增强对比；紧凑/舒适密度下执行：

- [ ] 会话中心输入区底部完整；
- [ ] 右侧 AI 字号真实变化；
- [ ] 3–5 条候选、微调、证据与重试无裁切；
- [ ] 账号中心、系统中心、设置、联系人、档案、时间线、洞察、AI 工作台全部可读；
- [ ] 主要生产页面只有页面主滚动，不出现底部模块初始不可见；
- [ ] 长文本自然撑高；
- [ ] 状态胶囊、账号名和工具栏不截断；
- [ ] Windows 主题切换后对比度与 focus 可见。

## I. 自动与包门禁

- [ ] `npm run test:batch21-root-cause`
- [ ] `npm run test:round12-platform-core`
- [ ] `npm run test:round13-ai-quality`
- [ ] `npm run test:platform-production-readiness`
- [ ] `npm run test:uat-diagnostics`
- [ ] `npm run test:source-uat-delivery`
- [ ] `npm run test:component-readability`
- [ ] 完整 `node --test --test-concurrency=1 backend/tests/*.test.js`
- [ ] ZIP CRC、条目唯一性、包内 SHA256、Descriptor/Checkpoint 与源码一致；
- [ ] 导出截图、录屏、SQLite 查询、日志、operation/ACK/OpenRouter 回执和重启后证据。

## J. 审批

- [ ] 执行方不自行批准；
- [ ] 独立审核逐项复核；
- [ ] 任一真实平台、OpenRouter、Windows 布局或数据一致性阻断仍存在时：`WINDOWS_UAT_BLOCKED`；
- [ ] 只有独立审核明确授权后，才可改变 promotion 状态。
