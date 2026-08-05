# 言策（Yance）总实施方案与开源移植主计划

> **状态：V1 范围冻结，跨聊天持续有效。**
>
> 本文件记录已经确认的产品范围、开源移植方案、阶段顺序、统一界面原则与验收口径。它是实施计划，不替代具体工作包的正式授权、来源凭据、RED/GREEN 证据和精确 Head 门禁。

## 0. 最高指标

言策项目的最高执行指标是：**尽快形成真实可运行、稳定、功能完整且统一的个人产品。**

所有决策按以下顺序优化：

1. 复用成熟开源项目的完整能力模块；
2. 固定版本依赖或受控 Sidecar；
3. 仅在必须掌握权威边界时精选源码移植；
4. 只有没有成熟来源时才自研。

速度不能通过临时绕过获得：禁止弱化门禁、跳过测试、吞错、强推、扩大重试或保留脆弱补丁。固定原则是：

> **架构一步到位，代码分阶段落地；成熟能力优先移植，言策保持唯一产品与数据权威。**

## 1. 最终产品形态

言策不是多个聊天软件界面的拼接，也不是多个开源产品的集合。最终始终只有一个统一桌面产品：

```text
言策
├── 统一会话中心
├── 统一联系人与关系
├── 统一 AI 回复工作室
├── 统一搜索与附件
├── 统一账号中心
├── 统一模型与路由中心
├── 统一学习与成长中心
├── 统一系统健康与恢复
└── 统一设置、隐私与诊断
```

各渠道只提供认证、协议、同步、媒体、事件、发送与恢复能力；不得移植或创建各平台专属聊天页面、联系人权威、任务调度权威或独立业务数据库。

## 2. 总工作包

- **OSS-A**：持久执行、来源治理、许可证与供应链基础。
- **OSS-B**：多平台 Social & Dating Channel Fabric。
- **OSS-C**：联系人、身份合并与时间关系图。
- **OSS-D**：Persona、Style Genome 与回复推理。
- **OSS-E**：统一模型网关、任务分类与模型路由。
- **OSS-F**：学习、评测、反馈与可回滚成长闭环。
- **OSS-G**：设置、隐私、诊断、语音、文件与多模态。

正确实施顺序：

```text
完成当前 OSS-1A Task 11
        ↓
PR #19 总设计最终审阅并合入 main
        ↓
OSS-A 来源/许可证/供应链底座
        ↓
从 PR #17 提取 WP-B 持久执行核心
        ↓
Baileys 生命周期完整修复与移植
        ↓
OSS-B 统一 Channel Fabric 与第一批连接器
        ↓
AI SDK + LiteLLM + LangGraph 执行链
        ↓
联系人/时间关系图
        ↓
Style Genome/回复大脑
        ↓
学习/成长闭环
        ↓
其余平台、语音、文件与多模态
```

## 3. PR 与历史成果处理

### PR #17

冻结但不删除，不整体合并约 170 文件分支。保留并按小工作包重新提取：

- Durable Task；
- Outbox；
- external call 前持久化 Attempt；
- lease/fencing；
- late-result rejection；
- uncertain outcome reconciliation；
- crash/restart recovery。

禁止把 PR #17 的整套 UI、未来平台、AI 学习或其他未授权范围直接带入。

### PR #19

作为总设计权威完成最终审阅，确保只冻结设计、信息架构、权威边界、工作包顺序、Product Shell 与 UI 合同，不提前改变当前运行时行为。通过后合入 `main`。

## 4. 开源移植采用规则

“完整移植模块”是指把一个平台成熟的可运行能力切片完整保留，而不是只复制几个函数。每个模块至少覆盖：

```text
认证与凭据
设备/会话生命周期
历史同步与分页
实时事件、排序与批处理
消息去重与迟到事件拒绝
联系人、群组、成员与身份
文本、图片、视频、语音、文件
回复、引用、反应、编辑、删除
已读、送达、输入与在线状态
上传、下载与断点恢复
限流、断线重连、崩溃重启恢复
上游关键测试与真实故障场景
```

按项目特性选择：

1. **精选源码移植**：与言策技术栈兼容、且必须掌握底层控制权；
2. **固定版本依赖**：成熟库已有稳定 API，不维护无必要分叉；
3. **受控 Sidecar**：Python、Go、C/C++、原生客户端或重型服务；
4. **行为合同重构**：技术栈冲突、只需领域规则或不能形成第二权威。

最小来源记录自动完成：上游仓库、精确 40 位 commit、来源路径、目标路径、采用方式、修改说明、测试与回滚。治理不得成为无限人工审批，但也不得允许无法追溯的源码进入产品。

## 5. OSS-B：统一多平台 Channel Fabric

### 5.1 唯一 ChannelDriver

```text
ChannelDriver
├── authenticate()
├── connect()
├── disconnect()
├── syncHistory()
├── subscribeEvents()
├── sendMessage()
├── editMessage()
├── deleteMessage()
├── sendReaction()
├── markRead()
├── setTyping()
├── uploadAttachment()
├── downloadAttachment()
├── resolveContact()
├── resolveConversation()
└── reconcileDelivery()
```

### 5.2 唯一 Canonical 模型

```text
CanonicalAccount
CanonicalIdentity
CanonicalContact
CanonicalConversation
CanonicalMessage
CanonicalAttachment
CanonicalReaction
CanonicalDeliveryReceipt
CanonicalPresence
```

连接器只能提交标准事件和执行外部调用，不能直接修改 canonical、ledger、Outbox、联系人或关系事实权威。

### 5.3 平台能力清单

统一界面通过 `PlatformCapabilityManifest` 决定按钮，不为平台重做工具栏：

```text
supportsReply
supportsEdit
supportsDelete
supportsReaction
supportsThread
supportsReadReceipt
supportsTyping
supportsVoice
supportsVideo
supportsHistorySync
supportsMultiAccount
supportsGroup
supportsGroupAdmin
supportsRichCard
```

### 5.4 第一批完整连接器

#### WhatsApp

以 Baileys 成熟实现为来源，完整覆盖：auth state、Signal Key Store、`creds.update`、Socket 生命周期、事件批处理、history sync、`getMessage`、retry cache、消息去重、群组/媒体、DisconnectReason、单账号单 Socket、断线与重启恢复。

#### Telegram

采用 TDLib 完整客户端运行时作为受控 Sidecar，保留登录、设备验证、本地会话数据库、更新顺序、历史、群组、频道、主题、媒体、编辑/删除/反应、离线与网络恢复。禁止重新实现 Telegram 协议客户端。

#### Signal

采用 libsignal 与成熟 Signal 桥接运行时，隔离为 Sidecar，覆盖设备链接、密钥、加密会话、私聊、群聊、附件、回执、消失消息、断线与重启恢复。

#### Meta

必须拆成四个账号入口，但全部进入同一个言策会话中心：

```text
Facebook 公共主页
Facebook 个人 Messenger
Instagram 专业账号
Instagram 个人 DM
```

公共账号使用正式 Page/Professional 授权通道；个人 Messenger 与 Instagram DM 使用成熟 Meta 桥接运行时作为隔离 Sidecar。四种账号的凭据、发送身份、生命周期和恢复状态必须隔离，canonical 展示统一。

### 5.5 手机与 macOS Companion Host

- **手机 Companion Host**：Android/iOS 分享、截图、通知/文本转入、Google Messages、交友应用辅助。
- **macOS Companion Host**：iMessage、本机通知、分享、剪贴板和受控消息辅助。

Companion Host 是无独立产品权威的连接节点；Windows 言策仍是主控制中心。

### 5.6 日韩与设备消息平台

固定范围：

- LINE；
- KakaoTalk；
- iMessage；
- Google Messages / RCS / SMS。

有成熟完整客户端能力时直接采用；平台只提供有限接口时由 Companion Host 和用户确认流程补齐，不伪装成不存在的完整同步能力。

### 5.7 通用 Dating Companion Mode

一次开发统一引擎，所有封闭交友平台共享：

```text
文本 / 截图 / 资料页
        ↓
OCR 与结构解析
        ↓
识别平台、对象、语言与关系阶段
        ↓
Persona + Style Genome + Audience Context
        ↓
生成多个回复候选
        ↓
用户选择、修改、复制或分享回原平台
        ↓
记录可审计反馈并离线学习
```

第一版模板范围：

- 欧美：Tinder、Bumble、Hinge、Badoo、OkCupid、Match、Plenty of Fish、Grindr、HER；
- 日本：Pairs、with、Omiai、Tapple；
- 韩国：Amanda、Noondate、Wippy、GLAM。

模板只提供截图布局、资料字段、平台图标、语言文化和平台提示；不得形成平台专属聊天界面或独立回复大脑。

### 5.8 OSS-B 冻结范围

```text
统一 ChannelDriver 与 Canonical 模型
        ↓
并行移植 WhatsApp / Telegram / Signal / Meta
        ↓
建立手机与 macOS Companion Host
        ↓
LINE / KakaoTalk / iMessage / Google Messages
        ↓
一次开发通用 Dating Companion Mode
        ↓
为欧美、日本、韩国交友平台增加识别配置和统一界面模板
```

当前不加入国内社交平台、企业办公平台、独立 CRM、无关社区平台、功能重复桥接框架或“未来可能有用”的平台。

## 6. WP-B 持久执行核心

从 PR #17 重新提取为可审计的小 PR：

```text
DurableTask
OutboxRecord
ExternalAttempt
LeaseFence
ReconciliationCase
```

固定调用链：

```text
用户/AI 产生发送意图
        ↓
持久化 Durable Task / Outbox
        ↓
外部调用前持久化 Attempt
        ↓
获得 lease/fence 后调用连接器
        ↓
接纳确定结果 / 拒绝迟到结果
        ↓
不确定结果进入 reconciliation
        ↓
崩溃、断网、重启后恢复
```

所有渠道和模型调用共用同一持久执行权威，不允许连接器自建第二套重试和发送事实库。

## 7. AI 执行、关系与成长开源栈

### 7.1 模型执行

```text
言策任务分类、权限与发送权威
        ↓
Vercel AI SDK
        ↓
LiteLLM Sidecar
        ↓
OpenRouter / OpenAI / Anthropic / Gemini / Ollama / llama.cpp
        ↓
LangGraph.js 回复工作流
```

言策始终保留：任务分类、模型能力要求、超时/取消、late-result 接纳、发送许可、成本与审计权威。

### 7.2 联系人与时间关系

- Chatwoot：联系人、会话、收件箱、未读与消息状态规则；
- Monica：重要日期、互动、共同经历与关系事件模型；
- Graphiti：时间事实、来源、事实失效、关系图与召回 Sidecar；
- ConvoKit：互动节奏、语言协调与对话分析；
- Cytoscape.js：统一关系图展示。

`CanonicalContact`、身份合并、关系事实数据库仍是言策唯一权威；AI 推断与用户确认事实必须显式分离。

### 7.3 回复大脑

- SillyTavern：Persona、World Info、Prompt Manager 和上下文装配的行为合同；
- LangGraph.js：理解、召回、规划、候选、人工确认与 checkpoint；
- Graphiti：时间关系上下文；
- Style Genome：言策自有统一风格模型。

回复结果由以下共同决定：

```text
PersonaStance
StyleGenome
DialogueMovePlan
AudienceContext
ResponseShape
```

### 7.4 学习与成长

- Langfuse：回复 trace、generation、dataset 与评测证据；
- Promptfoo：Prompt、模型、Persona 与安全回归；
- Argilla：选择、修改、拒绝和人工反馈；
- DSPy：离线生成候选 Prompt 与示例。

禁止模型直接永久修改 Persona 或关系事实；任何晋级必须有证据、评测、用户同意和回滚。

## 8. 产品壳层与统一 UI

UI/UX 是 OSS-A～G 的横切交付层，不允许等到最后补。

建议采用：

- shadcn/ui + Radix UI：统一组件源码和无障碍基础；
- TanStack Query/Table/Virtual：数据、表格和大列表；
- XState：登录、同步、发送与恢复状态机；
- Tiptap OSS Core：Prompt、Persona、Style 与回复编辑器；
- i18next、Lucide、ECharts、Cytoscape.js；
- Storybook、Playwright、axe-core、MSW：组件、E2E、无障碍和故障模拟。

每个开源能力必须完成以下产品映射：

```text
能力
→ 用户任务
→ 页面入口
→ 触发动作
→ 成功反馈
→ 失败/离线/权限状态
→ 撤销或回滚
→ Windows/DPI/键盘验收
```

内部实现不能简单暴露成大量原始按钮。使用渐进披露：常用动作直接展示；低频动作进入侧栏/设置；专业控制进入高级模式；基础设施只提供状态和受控操作。

## 9. 文件、多模态、隐私与供应链

- whisper.cpp：离线转写；
- LiveKit Agents：实时语音；
- Apache Tika：Office、PDF、邮件等内容提取；
- PaddleOCR：截图、扫描件和文档 OCR；
- Microsoft Presidio：日志、导出与评测数据脱敏；
- restic：加密、增量、去重备份与恢复；
- OpenTelemetry JS：统一 trace、metric、log；
- CycloneDX Node npm：SBOM；
- OSV-Scanner：依赖漏洞与许可证自动扫描。

这些组件不得直接修改 canonical、ledger、Outbox 或关系事实，只能通过受控端口提交解析结果、诊断或备份操作。

## 10. 并行实施线路

在共同接口冻结后并行推进：

```text
线路 A：ChannelDriver + Canonical + Capability Manifest
线路 B：WhatsApp / Telegram / Signal / Meta 完整运行时
线路 C：WP-B Durable Task / Outbox / Attempt / Lease / Recovery
线路 D：手机与 macOS Companion Host、LINE/Kakao/iMessage/Google Messages
线路 E：AI SDK / LiteLLM / LangGraph 模型执行链
线路 F：统一账号中心、会话中心、AI 回复区与系统状态 UI
线路 G：Dating Companion 引擎及欧美日韩模板
线路 H：Windows、断网、崩溃、重启、重复事件与 DPI UAT
```

不再按“一个平台全部完成后再开始下一个平台”的串行方式推进。

## 11. 第一个真实产品闭环

第一条必须尽快达到真实可用的闭环：

```text
WhatsApp 收到真实消息
        ↓
Baileys 完整生命周期
        ↓
CanonicalMessage
        ↓
Durable Task / Outbox
        ↓
AI SDK + LiteLLM + LangGraph
        ↓
统一回复区显示多个候选
        ↓
用户选择或修改
        ↓
可靠发送
        ↓
断网、崩溃、重启仍可恢复和对账
```

该闭环完成后，Telegram、Signal、Meta、联系人图、Style Genome 和其他平台在同一底座上并行扩展，不再重新打基础。

## 12. 固定质量门禁

每个阶段必须满足：

- 精确上游 commit 与来源记录；
- 不形成第二事实权威；
- 数据可迁移、可回滚；
- 不破坏现有功能和风格；
- RED → GREEN；
- Windows 现有真实数据验证；
- 离线、断网、崩溃、重启、重复事件和迟到结果测试；
- 不吞错、不扩大重试、不关闭 guard；
- 外部组件不得直接修改 ledger、Outbox 或 canonical；
- UI 具有 loading、empty、offline、error、recovery、permission-denied 状态；
- 关键动作有确认、撤销或回滚；
- 100%、125%、150%、200% DPI、键盘操作和基础无障碍；
- 不允许界面伪造成功。

## 13. 计划维护协议

- 固定分支：`project-state/active-handoff`；
- 固定文件：`YANCE_IMPLEMENTATION_MASTER_PLAN.md`；
- `PROJECT_CONTINUATION.md` 记录当前精确状态与下一步；本文件记录稳定总方案；
- 总范围调整必须在本文件形成普通新提交，不 amend、不 rebase、不 force push；
- 具体工作包仍需各自正式授权、路径清单、receipt、RED/GREEN 与精确 Head 证据。

## 14. 当前立即行动

1. 不扩大范围，先完成 OSS-1A Task 11 候选发布链根修复和 Windows/正式门禁；
2. 最终审阅并完成 PR #19；
3. 建立 OSS-A 来源与供应链基础；
4. 从 PR #17 小步提取 WP-B；
5. 同时冻结 ChannelDriver、Canonical、Capability Manifest 和统一 UI 合同；
6. 启动 Baileys 完整运行时与第一个产品闭环；
7. 接口稳定后并行启动 Telegram、Signal、Meta 和 Companion Host。
