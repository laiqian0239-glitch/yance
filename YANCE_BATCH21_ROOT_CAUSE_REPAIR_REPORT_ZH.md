# 言策 f25fe2e｜Batch 21 根因公共层修复报告

## 1. 治理结论

本批次从 Batch 20 唯一源码包继续，不回退旧版本，不删除账号、不重新扫码、不清空真实数据，也不以隐藏错误码、修改提示文案或单页 CSS 代替修复。

当前治理状态保持：

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
```

本报告中的“源码已修复”仅表示公共层代码和自动回归已完成。以下证据尚未在本构建环境中获得，因此所有 RC-01～RC-08 均不得标记 CLOSED：

- 真实 Windows Electron 主窗口、DPI 100% / 125% / 150% 与重启持久化；
- 真实 WhatsApp、Facebook、Telegram 入站、历史同步、Echo 与发送 ACK；
- 真实 OpenRouter Key、两个不同云模型的 2/2 调用、模型回执、请求 ID、额度/限流/超时证据；
- 真实平台发送后 Outbox、Message、学习回写与重启后效果证据。

## 2. 源码身份

### 原始权威基线

- Commit: `f25fe2e2b4f065d2c09de034eddb67857eeb83bb`
- Tree: `015f7969a2363952071bf11f4da3eb2adaf7edbf`

### Batch 20 逻辑父级

- Branch: `development/windows-uat-f25fe2e-repair-batch20-ai-ux-readability`
- ImplementationCommit: `2ea0b43cc6cff09b88a889ac60284c14a7f7a660`
- ImplementationTree: `f31522bbfcab7fd4fe63ee1e232c68b17f029f66`
- PackageCommit: `63a6cb3a6b8b98f7135ca0f83183540f434c67ed`
- PackageTree: `e4a03816b7923aea9a1f8e27d32db143a20ca295`
- Source ZIP SHA256: `eccc2817a0c9c8c905594d342210d093013b4291a3829f5e237234f75eebada6`

### Batch 21 实现身份

- Branch: `development/windows-uat-f25fe2e-repair-batch21-root-authority`
- ImplementationCommit: `7b06376a68b269aefaac99c3822f3a70f68e04d6`
- ImplementationTree: `ade20b77b6b3e042c4e83ef975eceeefebe0a4c7`

源码包未包含 `.git`。本批次先把 Batch 20 包导入隔离 Git 仓库；导入树精确等于 Batch 20 PackageTree `e4a03816...`，再从该树建立 Batch 21 分支。

## 3. 根因树与公共层修复

### RC-01｜状态权威分裂与“可发送”假阳性

**可重复复现**

账号运行态为 `connected/limited` 时，旧逻辑会直接推导 `canSend=true`，而发件箱、Adapter、真实平台 ACK 与 UI 可能给出不同结论。

**源码定位**

- `backend/services/accountManager.js`
- `backend/services/platformProductionReadinessAuthority.js`
- `backend/services/sendPolicyAuthority.js`
- `frontend/js/r32-conversation-route-authority.js`
- `frontend/r32-account-center.js`

**公共层修复**

- 新增 `canAttemptSend`：只表示凭据、连接与运行态满足“允许进入持久化发件箱”的前置条件；
- 新增 `sendVerified`：只由有效期内的真实 text ACK 决定；
- `canSend` 改为 `sendVerified` 的严格兼容字段，不再由 `connected/limited` 推导；
- UI 明确区分“允许尝试”“等待真实 ACK”“真实 ACK 已验证”“最近真实发送失败”；
- 生产就绪权威把无 ACK 的已连接账号标记为 `uat-required/degraded`，而不是 ready。

**自动证据**

- 正向：真实 ACK 记录后 text capability 为 ready；
- 反向：仅 connected、仅静态能力或 ACK 过期时不得显示 send verified。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_UAT_PENDING`

### RC-02｜PlatformAccount、身份、ConversationBinding、Message 与 OutboxRoute 契约不一致

**可重复复现**

旧链路可先写入消息/会话，后补 `IdentityLink` 与 `ConversationBinding`；身份写入失败时会留下无主消息、空会话壳或路由绑定延迟。

**源码定位**

- `backend/services/identityLinkAuthority.js`
- `backend/repositories/messageRepository.js`
- `backend/repositories/accountRepository.js`

**公共层修复**

- 新增 `observeWithinTransaction` 与 `finalizeObservation`；
- 入站联系人、Person、IdentityLink、ConversationBinding、Message 与会话摘要在同一 SQLite 事务内提交；
- 任一身份/绑定校验失败时整体回滚；
- `accountRepository` 以 `r32_conversations` 和 `conversation_bindings` 为权威，旧 settings binding 只保留兼容投影；
- 禁止给不存在的会话建立发送路由；
- 已存在会话的 account/platform 冲突会失败关闭，不静默切换来源账号。

**自动证据**

- 正向：成功入站后 Message、Conversation、Person、IdentityLink、ConversationBinding 使用同一 person/account；
- 反向：强制身份失败后五类记录均为 0；不存在会话的绑定被拒绝。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_UAT_PENDING`

### RC-03｜实时事件、SQLite 持久化与 UI hydration 双权威

**可重复复现**

旧前端收到翻译/媒体事件时会直接修改或向当前历史数组 `push` payload，同时后台查询又从 SQLite 载入，形成重复、乱序或事件先于落库的空壳风险。

**源码定位**

- `backend/repositories/messageRepository.js`
- `frontend/js/r32-ui-runtime.js`

**公共层修复**

- 入站标准化、身份绑定、Message、Conversation 统一原子提交；
- 实时 message/media/translation 事件只作为“SQLite 投影已失效”的通知；
- 当前会话与摘要统一重新读取 SQLite，不再把实时 payload 当第二份消息权威；
- 新消息事件仍可立即使旧 AI 候选失效，但不能直接构造可见消息。

**自动证据**

- 源码反向门禁禁止 `rows.push(translated)`；
- 媒体与翻译事件必须调度 SQLite reload；
- 身份事务失败不会留下会话壳。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_UAT_PENDING`

### RC-04｜异步任务缺少统一生命周期与完成回写

**可重复复现**

AI 候选、翻译、登录/扫码、历史同步和 OpenRouter 冒烟此前分别维护内存状态；旧请求可能覆盖新对象，重启后无法判断永久等待、失败或已完成。

**源码定位**

- 新增 `backend/services/asyncOperationLifecycleAuthority.js`
- `backend/services/aiTaskRuntimeRegistry.js`
- `backend/services/contextAwareReplyBrain.js`
- `backend/services/messageTranslationService.js`
- `backend/services/platformAdapterPorts.js`
- `backend/services/openRouterOnboardingSmokeService.js`
- `backend/services/systemCenterService.js`

**公共层修复**

统一持久化状态机：

```text
CREATED → RUNNING → SUCCEEDED / FAILED / CANCELLED / SUPERSEDED
```

每个任务具备：

- `operationId`
- `operationType`
- `scopeKey`
- `objectFingerprint`
- `generation`
- progress、result、errorCode、errorMessage
- created/start/finish/update 时间
- 新代次 supersede 旧任务与旧完成回写拒绝

生产 R32 SQLite 强制持久化。仅测试使用的非 SQLite 假存储会明确标记 `lifecyclePersisted=false`，不会冒充生产持久化。

**自动证据**

- 新代次建立后旧任务变为 SUPERSEDED；
- 旧代次完成回写返回 `stale-completion`；
- AI、翻译、auth/reconcile 和 OpenRouter 冒烟接入同一权威；
- 系统中心可读取 active/recent/failed 操作。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_UAT_PENDING`

### RC-05｜Adapter 静态能力与真实 text/emoji/media ACK 脱节

**可重复复现**

Adapter 声明支持发送或返回 success，旧逻辑只检查一个消息 ID，无法区分普通文本、emoji-only 与媒体；能力矩阵可能在 Facebook 文字通过但单表情失败时仍显示统一可发送。

**源码定位**

- 新增 `backend/services/platformDeliveryAuthority.js`
- `backend/services/platformAdapterPorts.js`
- `backend/services/platformCapabilityAuthority.js`
- `backend/repositories/platformCoreRepository.js`
- `backend/services/sendQueueService.js`

**公共层修复**

- 真实 ACK 按 payload capability 拆分：
  - `message.text.send`
  - `message.emoji.send`
  - image/video/gif/sticker/voice/file/reaction/revoke 等；
- 普通文本与 emoji-only 使用 Unicode 语义检测，不再把单个表情误判为空；
- 成功 ACK 记录 platformMessageId、providerRequestId、acceptedAt、command/outbox/idempotency 身份；
- 失败 ACK 记录 capability 级 reasonCode，不把一个 payload 失败扩大为平台整体断线；
- 平台已接受但 ACK 证据落库失败时，发件箱进入“结果不确定、禁止自动重发”，防止重复消息；
- ACK 有 24 小时有效期，过期后重新要求真实验证。

**自动证据**

- Facebook text ready、emoji blocked、image ready 可同时存在；
- success 无 platform message ID 被拒绝；
- 结构化 `success=false` 不会被误判为平台已接受；
- Adapter 测试事件与能力证据使用隔离 SQLite，避免测试污染全局生产库。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_UAT_PENDING`

### RC-06｜OpenRouter Key、冒烟、资格、任务分配和生产路由状态分裂

**可重复复现**

Key/目录可用时，旧 UI 可能显示已接入，但双模型真实调用、模型资格与生产路由尚未完成。

**源码定位**

- `backend/services/openRouterOnboardingSmokeService.js`
- `backend/services/asyncOperationLifecycleAuthority.js`
- `backend/services/systemCenterService.js`

**公共层修复**

- 双模型冒烟作为单一持久 operation；
- 必须选择两个不同模型；
- 每个模型分别验证严格 JSON、德语候选、中文译文、3 条方向差异和低信息事实边界；
- 只有 2/2 均通过后才调用 `applyOpenRouterConditionalRoutes`；
- 条件路由仍要求人工确认，正式商业资格继续保持 pending；
- 失败时保留 operationId、代次、模型级结果和错误，不能显示成功。

**自动证据**

- fake executor 的两个独立模型 2/2 后只写入一次路由；
- lifecycle 结果记录 passed=2/total=2；
- Round 13 AI 质量 24/24 PASS。

**真实状态约束**

本环境没有使用用户真实 OpenRouter Key，因此不改变交接中的 `0/2` 真实证据状态；Windows 实测前仍为 blocked/pending。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_OPENROUTER_PENDING`

### RC-07｜全局字号、密度、对比度和布局令牌未覆盖生产组件

**可重复复现**

大字/舒适/增强设置曾只影响部分页面；右侧 AI、微调标签、输入区和部分生产卡片仍使用局部硬编码尺寸或固定高度。

**源码定位**

- `frontend/r32-global-reading.css`
- `frontend/r32-flat-document-flow.css`
- `frontend/js/r32-ui-runtime.js`

**公共层修复**

- 建立 Batch 21 语义变量：page/section/card/body/supporting/meta/control/gap/padding；
- 生产 panel/card/control/actions/body 统一继承语义字号、密度与可扩展高度；
- 大字模式下控件允许自然增高和文本换行；
- 增强对比模式使用主题语义色并统一 focus-visible；
- display authority 写入根节点版本并广播统一变更事件；
- 保留 Batch 19 平面文档流：主要业务模块自然撑高，页面滚动为唯一主滚动权威。

**自动证据**

- 设计系统根因测试验证 CSS 加载顺序、语义变量、生产选择器、large/contrast 行为；
- 组件可读性 6/6 PASS；
- Batch 20 AI/UX 11/11 PASS；
- 真实 Windows DPI/字体渲染仍待证据。

**状态**

`SOURCE_FIXED_AUTOMATED_VERIFIED_REAL_WINDOWS_RENDER_PENDING`

### RC-08｜自动测试预言机与真实 Windows/平台行为不一致

**可重复复现**

旧测试把 connected 当 ready、静态 capability 当真实发送、测试平台事件写入全局库，导致自动全绿但 Windows 仍失败。

**源码定位与修复**

- Round 12 预言机改为：connected 仅 `canAttemptSend`，无真实 ACK 必须 degraded；
- Adapter 测试使用隔离 SQLite event log 与 delivery authority；
- 新增 Batch 21 根因正向/反向测试；
- 新增设计系统公共层测试；
- 继续明确 automated != Windows/platform/OpenRouter evidence。

**本批次自动回归**

- Batch 21 根因与设计系统：8/8 PASS
- Round 12 平台核心：79/79 PASS
- Round 13 AI 质量：24/24 PASS
- 平台生产就绪：58/58 PASS
- UAT 诊断：142/142 PASS
- Source UAT Delivery：33/33 PASS
- 组件可读性：6/6 PASS
- Batch 20 AI/UX：11/11 PASS
- 翻译/引用发送兼容专项：16/16 PASS

全 backend 单命令在当前执行环境的单次 300 秒上限内未跑完；两次运行分别在 637 和 614 个通过用例处被外部超时终止，终止前未出现新的失败。该事实不能替代完整 938/938 复跑，Windows 构建机仍须执行完整后端套件。

**状态**

`SOURCE_ORACLE_REPAIRED_COMPLETE_BACKEND_AND_REAL_UAT_PENDING`

## 4. 不允许被解释为已关闭的真实症状

以下症状必须在真实 Windows/平台中重新验证，源码修复不能自动改写其结果：

- WhatsApp：历史/联系人、入站正文、文字 ACK、发件箱 reverify、Echo 与重启恢复；
- Facebook：普通文本 ACK、emoji-only、媒体、重复/乱序、翻译完成；
- Telegram：二维码可识别、验证码/phone_code_hash/FloodWait、登录完成回写、同步与发送；
- OpenRouter：真实 Key 鉴权、目录、两个不同模型 2/2、独立备用、任务路由与正式资格；
- UI：Windows 100/125/150%、大字/舒适/增强、底部输入区、快捷微调、全部生产页面自然高度。

## 5. 晋升门禁

只有同时满足以下条件，才允许由独立审核方考虑关闭根因或晋升：

1. 使用 Batch 21 包身份启动真实 Windows Electron；
2. 采集运行时 Commit/Tree/DataRoot/ReleaseId 与截图/录屏；
3. 三平台逐 payload 采集真实 ACK 或明确失败证据；
4. 入站、历史、Echo、SQLite、UI 与重启后数据一致；
5. OpenRouter 两个不同模型 2/2，保留请求 ID、returned model、HTTP/供应商错误、token/latency；
6. AI 候选、翻译、登录/扫码、同步 operation 最终回写，不存在永久 RUNNING；
7. 发送成功后学习，失败/未发送不学习，重启后仍生效；
8. 真实 Windows 100/125/150% 通过页面与组件可读性矩阵；
9. 完整后端、UAT、Source Delivery 与包反向校验全部通过；
10. 执行方不得自行批准。

## 8. 补充根因门禁

- `npm run test:root-cause-closure`：`2/2 PASS`；
- `npm run audit:root-cause-closure`：`DESIGN_BASELINE_READY`；审计输出同时明确 Windows render、端到端任务和用户确认仍待执行；
- 该门禁只证明已登记公共根因具备机器可检查的源码检查点，不代表真实 Windows、真实平台或真实 OpenRouter 通过。
