# 言策（Yance）总实施方案与开源移植最高指令

> **状态：V2.1 最高指令冻结；Relationship Intelligence Enhancement 已并入 V2.1，跨聊天持续有效。**
>
> 本文件是 Yance 的**唯一稳定架构与实施指令**。除实时远端事实、已生效治理凭据、精确授权 Head 与正式安全/许可证约束外，任何旧聊天、旧设计快照、旧实施方案、旧 UI 计划或旧工作包说明与本文件冲突时，**以本文件为准**。
>
> 本次更新是 **V2.1 的严格超集增强，不是 V2.2，也不是推倒重做**。已经完成、已授权或正在实施的 V2.1 工作包继续按原 exact-Head、scope、receipt、workflow 与 merge gate 收口；不得因为本次产品语义校正而重写历史、扩大当前工作包 scope 或重新制造已经成立的 RED。

---

## 0. 产品定位：交友 / 情感 / 长期关系沟通副驾

Yance 的产品定位固定为：

> **面向个人真实人际关系、交友与情感沟通的 AI 助手。**

Yance 的目标不是 CRM、营销自动化、销售漏斗、lead scoring、成交预测或客服工单系统。任何后续 OSS 选型和功能设计都必须优先回答：

- 是否更理解“我是谁、我怎么说话”；
- 是否更理解“对方是谁、我们发生过什么”；
- 是否增强长期关系连续性；
- 是否增强情绪与语境理解；
- 是否让表达更自然、更像用户本人；
- 是否增强多语言、语音、图片、视频等真实沟通能力；
- 是否能帮助用户表达真实意图并自然推进关系，而不是操控对方；
- 是否能通过成熟 OSS 更快、更稳定地落地。

### 0.1 Relationship-first 语义

后续产品词汇优先使用：

- Person / Contact；
- Relationship；
- Relationship Profile；
- Relationship Memory；
- Conversation Goal / Intention；
- Relationship Journey；
- Important Moment；
- Relationship Timeline；
- Communication Preference；
- Persona / Style；
- Emotion Context；
- Reply Candidate。

不得再把 sales funnel、lead、qualification、close、deal pipeline、conversion 等商业销售概念作为 Yance 核心产品模型。

### 0.2 能力不回退规则

本次增强不得删除或弱化 V2.1 已确认能力，除非出现正式安全、许可证、上游废弃或真实技术冲突，并通过新的替代决策。

必须继续保留并增强：

- Matrix / Synapse / Element / mautrix 多平台通信；
- WhatsApp、Telegram、Signal、Facebook、Instagram、Google Messages 等平台目标；
- 单一 Yance 产品界面；
- Letta 长期 Agent / Memory；
- Graphiti 时间关系记忆；
- Parlant Goal / Journey；
- LiteLLM + RouteLLM；
- Langfuse + DSPy + Promptfoo；
- CosyVoice VoiceProfile；
- Immich real-first 素材库；
- ComfyUI 身份一致内容生成；
- LiveKit / CyberVerse / Avatar backend 实时 Presence；
- MCP / tools；
- OCR / 文档 / PII / 备份 / 可观测性 / SBOM；
- Windows / Electron / 安装 / 更新 / UAT；
- 所有既有安全、授权、治理、exact-Head、RED/GREEN 与 merge gate。

---

## 1. 最高执行原则：成熟 OSS 接管，禁止重复自研

Yance 的最高执行指标是：**以最短路径形成真实可运行、功能尽可能强、稳定、可维护的个人开源产品。**

固定条件：

- 个人使用；
- 开源 Yance；
- 接受并履行 GPL、AGPL、LGPL、Apache、MIT、BSD、Boost 等实际采用组件对应的许可证义务；
- 不以未来闭源商业化作为规避成熟 copyleft OSS 的默认理由；
- 成熟上游已有生产级完整能力时，优先让上游成为真实运行内核，而不是参考后由 Yance 重写一遍。

### 1.1 OSS 采用顺序

```text
完整成熟开源产品
        ↓
完整成熟开源服务 / Sidecar
        ↓
完整成熟源码能力模块
        ↓
官方 SDK / 固定版本依赖
        ↓
极薄 Adapter / Branding / Configuration
        ↓
只有证明没有成熟 OSS 可满足时才允许最小自研
```

### 1.2 OSS-fit 自研准入硬门禁

任何计划新增 Yance 自研基础设施前，必须提供：

1. 已检索和评估的成熟 OSS 候选；
2. 每个候选的仓库、维护活跃度、许可证、运行方式与依赖闭包；
3. 候选不能满足需求的具体行为缺口；
4. 为什么不能通过完整产品、Sidecar、源码模块、官方 SDK 或极薄适配解决；
5. 最小自研范围；
6. 对应 failure-first 测试与回滚方案。

默认准入规则：

> **存在成熟 OSS 可满足约 80% 以上核心需求时，原则上禁止重新自研等价基础设施；优先移植/封装成熟上游，再用最薄适配补齐剩余差异。**

### 1.3 “移植”定义

“移植开源项目源码模块”不等于机械复制整个仓库。优先级为：

- 官方公开 API / SDK；
- 官方 sidecar/server；
- 可独立运行的成熟模块；
- 精确 vendoring 可维护源码；
- 最后才是 Yance 独立实现。

禁止“参考上游后用 Yance 重写一遍”冒充 OSS 移植。

### 1.4 速度规则

速度通过删除重复工程获得，不通过临时绕过获得。永久禁止：

- 弱化或关闭 guard；
- 跳过测试；
- 吞错；
- 强推；
- amend/rebase 改写已发布历史；
- 扩大无边界重试；
- 伪造成功状态；
- 用临时 patch、CSS 遮挡、假数据或旁路长期代替底层修复。

---

## 2. 最终产品形态：一个 Yance，多个成熟 OSS 发动机

用户最终只能看到一个 Yance。

Yance 固定拥有：

- 单一产品身份与 Branding；
- 单一用户设置与通知体验；
- 单一统一工作区；
- 用户确认、权限与最终发送决策；
- 各成熟 OSS 能力的统一产品投影。

底层事实状态允许由最合适的成熟 OSS 持有，例如 Synapse、mautrix、Letta、Parlant、Immich、LiveKit 等；禁止为了“Yance 自己拥有数据”而再复制第二套同类状态机或数据库。

```text
                                      YANCE
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ↓                             ↓                             ↓
 Communication Core          Relationship Intelligence        Personal Presence
 Matrix / Element         Persona / Letta / Graphiti /       Voice / Photo / Avatar
 mautrix / native OSS          Parlant / Emotion                     │
          │                             │                    CosyVoice / Immich
          │                             │                    ComfyUI / LiveKit
          └───────────────┬─────────────┴───────────────┬────────────┘
                          ↓                             ↓
                    Model Brain                  Knowledge / Tools
                RouteLLM + LiteLLM        Docling / MCP / Retrieval
                          ↓                             ↓
                     Learning Brain                Tool execution
              Langfuse + OTel + DSPy              mature OSS
                    + Promptfoo
                          ↓
                   Yance Integration
                          ↓
                  一个统一 Yance 工作区
```

---

## 3. V2.1 核心开源母体矩阵

所有上游实施前仍必须由独立 OSS-fit / OSS-A 工作包固定精确仓库、40 位 commit/tag、许可证、来源路径、构建方式、目标路径、上游测试、修改说明、SBOM 与回滚。

| 能力 | 首选成熟 OSS / 来源 | 默认采用方式 |
|---|---|---|
| 统一通信底座 | Matrix + Synapse | 完整服务 |
| 多平台桥接 | mautrix bridge 生态 | 完整 Sidecar / bridge |
| 统一聊天 UI | Element Web / Element 相关成熟客户端能力 | 产品壳源码/运行时 |
| WhatsApp | mautrix-whatsapp；Baileys 作为原生深度能力补充 | bridge 优先，必要时 native runtime |
| Telegram | mautrix-telegram / TDLib | bridge / Sidecar |
| Signal | mautrix-signal / signal-cli | Sidecar |
| Facebook Page 官方路线 | Chatwoot OSS Facebook Channel 可移植核心 + Meta 官方 API/SDK/schema | OSS core / Sidecar / 极薄 bridge |
| Facebook Personal / Page Session 候选 | facebook-chat-api 家族及 2026 仍维护的 FCA-compatible forks | **仅在真实账号/Page probe 通过后准入** |
| Instagram | mautrix-meta + 官方 API；个人 DM 另走经 OSS-fit 证明的 native/session runtime | bridge / API / native fallback |
| Google Messages | mautrix-gmessages | bridge |
| 长期 Agent / Memory / Context | Letta | 完整服务 / SDK |
| 时间关系记忆 | Graphiti | Sidecar |
| Persona / Character / Lorebook / Prompt 行为来源 | SillyTavern 经过许可证与边界审查的模块/思想 | 精选源码模块，不引入第二产品 UI |
| 目标导向关系对话 | Parlant | 完整 Journey/Guideline 运行时 |
| 非对话长流程 | LangGraph 或 Temporal（按 durable 需求） | 依赖/Sidecar，避免重复 |
| 模型统一网关 | LiteLLM | Sidecar |
| 智能模型路由 | RouteLLM | 路由模块 |
| 前端 AI streaming/tool UI | Vercel AI SDK 等成熟 SDK | 固定依赖 |
| AI trace / dataset / eval | Langfuse | 完整服务；enterprise 路径单独排除/审计 |
| Telemetry 标准 | OpenTelemetry | 固定依赖 / Collector |
| Prompt/program 优化 | DSPy | Sidecar |
| AI 回归/红队 | Promptfoo | CI/评测工具 |
| 人工反馈数据集 | Argilla（需要时） | Sidecar |
| 语音理解 / 情绪识别 | SenseVoice / FunASR | Sidecar；模型权重许可证单独审查 |
| STT 备选 | faster-whisper / whisper.cpp | Sidecar / native |
| 本人声音克隆 | CosyVoice 3 | 本地 GPU / Sidecar |
| 多语言声音备选 | Chatterbox Multilingual / GPT-SoVITS | benchmark 后固定 |
| Voice conversion 回退 | OpenVoice V2 | Sidecar |
| 实时语音 Agent | LiveKit Agents / Pipecat | Sidecar / 服务 |
| 实时语音 pipeline 模块参考 | Open-LLM-VTuber **仅许可合适的精确版本/模块** | 精选模块；不盲追 main |
| 个人真实照片/视频库 | Immich | 完整服务 |
| 图像工作流 | ComfyUI | 完整 Sidecar |
| 身份一致人像 | PhotoMaker / InstantID / PuLID | ComfyUI workflow 模块 |
| 图像条件控制 | IP-Adapter / ControlNet | ComfyUI 模块 |
| 图像修复/超分 | Real-ESRGAN / GFPGAN / CodeFormer | 模块 |
| 文档解析 | Docling 优先；Apache Tika 作为覆盖/兼容备选 | Sidecar |
| OCR | PaddleOCR | Sidecar |
| 公共知识检索 | pgvector / Qdrant 按规模选型 | Sidecar / PostgreSQL extension |
| Tool protocol | MCP 官方 SDK 稳定发布线 | 固定依赖；实现时 pin stable revision |
| 实时数字人视频通话母体 | CyberVerse | 完整源码母体 / 独立服务 |
| WebRTC 音视频 | LiveKit | 完整服务 / SFU |
| talking-head / lip-sync | Ditto / MuseTalk / LivePortrait / SoulX-FlashHead / LiveAct | benchmark 后固定 backend |
| 第三方虚拟摄像头 | OBS Studio Virtual Camera | 独立桌面运行时 |
| 高质量离线视频消息 | HunyuanVideo-Avatar 等候选 | 独立 benchmark/许可证工作包 |
| PII 脱敏 | Microsoft Presidio | Sidecar |
| 备份 | restic | Sidecar |
| SBOM / 漏洞 | CycloneDX / OSV-Scanner | CI/发布工具 |

### 3.1 Copyleft / open-core / 模型资产

- GPL/AGPL 不因未来商业化假设自动排除；
- Chatwoot 只允许采用根 MIT 范围内代码，`enterprise/` 必须明确排除或单独授权；
- Langfuse、LiteLLM 等 open-core 项目必须做精确 path-level license audit；
- SillyTavern AGPL 等义务正常履行，不以许可证为由默认重写；
- Open-LLM-VTuber 必须冻结许可证合适的精确 backend/module；不能假设后续 main 仍为 permissive；
- SenseVoice、Avatar、图片、音频模型必须把**代码许可证与模型权重许可证分开冻结**；
- 所有 vendoring / fork 修改必须可重建、可追溯、可重新基于上游验证。

---

## 4. 多平台：Matrix/mautrix 主统一层 + Native OSS Escape Hatch

首选运行链：

```text
WhatsApp / Telegram / Signal / Meta / Google Messages / 其他成熟桥
                                ↓
                         mautrix bridges
                                ↓
                              Matrix
                                ↓
                        Element / Yance UI
```

规则：

1. 有成熟 Matrix bridge：优先完整采用；
2. bridge 缺平台特有能力：允许成熟 native OSS runtime 直达；
3. 没有 bridge 但有官方/成熟完整客户端：Sidecar；
4. 只有设备本机能力：Companion Host；
5. 没有成熟来源：先形成 OSS-fit 缺口证据，再批准最小自研。

### 4.1 平台范围

P0 / P1 目标继续包含：

- WhatsApp；
- Telegram；
- Signal；
- Facebook Page / Messenger；
- Facebook Personal / Messenger（独立能力线）；
- Instagram Professional / Personal DM；
- Google Messages / RCS / SMS；
- LINE；
- KakaoTalk；
- iMessage；
- 其他有成熟 OSS bridge / native client / Companion 能力的平台。

平台的 Business/Page identity 与 Personal identity 必须在 capability model 中明确分离；不得因为官方 API 只覆盖其中一种身份，就静默把另一种从产品目标删除。

---

## 5. Facebook Page / Personal：双引擎现代化，不继续扩大 Yance 自研 Facebook 基础设施

现有 Facebook Page 链已证明会受到 OAuth scope、redirect URI、App Domain、Business Login Configuration、Page token、Webhook、历史对账、Echo、PSID、头像、Graph API 差异等复杂度影响。

因此后续 Facebook 不再采用“继续给 `facebookAdapter` / worker / gateway 无限补洞”的默认策略。

### 5.1 Official Page Engine

官方 Page 路线继续存在，目标是长期官方兼容与政策稳定：

```text
Facebook Page
   ↓
Meta official API / SDK / schema
   +
Chatwoot OSS Facebook Channel 可移植核心
   ↓
Yance Facebook Bridge
   ↓
Yance unified workspace / final send decision
```

优先从成熟 OSS 吸收：

- Page OAuth lifecycle；
- Page token lifecycle；
- webhook subscription / verification；
- event normalization；
- sender / recipient / PSID mapping；
- Meta MID/source-id dedupe；
- echo；
- delivery/read；
- attachments；
- profile/contact acquisition；
- Graph pagination/retry/error classification；
- webhook concurrency locking；
- subscription and permission diagnostics。

不得把 Chatwoot 整个 CRM/UI 变成第二产品；只采用 MIT OSS 范围内的 Facebook Channel 能力或最小 Sidecar。

### 5.2 Optional Session Engine：账号/session 登录路线

Yance 同时保留独立 Facebook Session OSS-fit 线路，目标是评估：

```text
Facebook account login / browser session
        ↓
2FA / checkpoint（如需要）
        ↓
encrypted appState/session
        ↓
Messenger realtime session / MQTT 等上游机制
        ↓
Personal identity
        +
用户管理的 Page identity（仅真实验证成立时）
        ↓
Yance Facebook Bridge
```

候选来源包括历史 `facebook-chat-api` 架构与仍维护的 FCA-compatible forks，但**不得仅凭 README 或旧版本支持 `pageID` 就宣称 2026 可用于 Page**。

必须真实证明：

1. 账号登录；
2. 2FA；
3. appState/session 重启恢复；
4. 长连接与重连；
5. Personal Messenger 收/发；
6. media / attachments；
7. echo/self message；
8. read/delivery；
9. history/thread；
10. session 失效恢复；
11. Page identity discovery/switch；
12. Page 收消息；
13. Page 发消息；
14. Business Suite/Page 后台发出的消息是否进入 session；
15. Windows/Electron 可运行；
16. 不依赖现有 Meta App OAuth；
17. 账号风险、checkpoint、平台条款与失败语义明确显示。

只有全部核心行为通过真实账号 + 真实 Page probe 后，Session Engine 才可成为 Page/Personal 的正式 native escape hatch。

### 5.3 Credential 规则

- 不长期保存明文 Facebook 密码；
- 密码只允许在建立 session 的最小生命周期内使用；
- 成功后只持有加密 session/appState；
- session key / cookie / token 必须进入受保护存储；
- logout/revoke 必须真正清除凭据；
- 不允许把账号登录风险伪装成“官方 API 同等稳定”。

### 5.4 Facebook 实施顺序

Facebook modernization 是**独立 work package**，不得污染当前 Letta #119 或其它 exact-scope 工作线。

推荐：

1. 先冻结现有真实故障 regression suite；
2. Chatwoot OSS Facebook Core / Meta official SDK 做 Official Engine OSS-fit；
3. FCA-compatible forks 做 Session Engine OSS-fit；
4. 两条路线用同一真实账号/Page capability matrix 比较；
5. Yance 只保留最薄 bridge 与统一产品投影；
6. 无成熟实现的剩余缺口再单独申请最小自研。

---

## 6. 统一产品界面：Element + 单一 Yance Workspace

用户层面固定只有一个 Yance：

```text
Yance 统一产品界面
├── 左侧全局导航 / 账号与平台筛选
├── 统一会话列表
├── 统一消息时间线
├── 统一输入与发送区
└── 右侧 Relationship / AI / Contact / Presence 工作区
```

平台身份只通过图标、账号、筛选、来源和 capability 差异呈现；不得为 WhatsApp、Telegram、Signal、Facebook、Instagram 等重新建立产品级独立 UI。

固定 UX：

- 左导航、会话列表、右侧 workspace 均可展开/收起/完全隐藏/拖拽宽度；
- 状态重启恢复；
- 隐藏必须有明确恢复入口；
- 窄窗口使用成熟 Sheet/Drawer；
- 隐藏/折叠只改变展示，不得停止同步、Journey、AI 或后台任务；
- 主题、提示音、通知、翻译、字体/密度和用户设置继续零回归。

UI 组件仍优先 shadcn-vue、Reka UI、VueUse、Tiptap OSS Core、TanStack、Cytoscape.js、Storybook、Playwright、axe-core、MSW 等成熟 OSS。

---

## 7. Relationship Intelligence：Persona + Relationship Profile + Letta + Graphiti

### 7.1 Persona：理解“我”

用户 Persona / Style 不建立新的 Yance 基础框架。

优先组合：

```text
SillyTavern Persona / Prompt Manager 可移植行为
        +
Letta structured memory/profile
        +
Graphiti context
        +
DSPy learning
```

至少支持：

- 常用语言；
- 句子长短；
- 表情/emoji 使用习惯；
- 称呼；
- 幽默度；
- 主动程度；
- 正式/随意程度；
- 用户明确禁止的说法；
- 对不同关系采用不同表达方式；
- 用户修改/拒绝 AI 回复形成可证据化学习。

### 7.2 Relationship Profile：理解“对方”和“两个人”

借鉴成熟 Character Card / Lorebook / World Info 的数据组织，但联系人是真实人物，因此必须分离：

```text
confirmed fact
user-provided fact
AI inference
```

AI inference 永远不能静默升级成 confirmed fact。

Relationship Profile 可包含：

- 昵称/语言/兴趣/生活信息；
- 对方明确表达的偏好；
- 沟通节奏；
- 常见表情/表达；
- 双方如何认识；
- 共同兴趣；
- 重要事件；
- 承诺/约定；
- 容易展开的话题；
- 曾发生的误会；
- 用户明确维护的关系状态。

每条关键事实应尽量带来源、时间、confidence/provenance。

### 7.3 Letta：Relationship Memory Authority

Letta 继续负责：

- persistent agent state；
- working/persistent memory；
- context management；
- compaction；
- conversation continuity；
- 长期互动记忆；
- agent/tool state persistence。

当前 Letta P0 仍按既有授权 scope 收口，不因本增强扩大 #119。

### 7.4 Graphiti：时间关系演化

Graphiti 继续负责：

- 人物/主题/事件关系；
- episode provenance；
- 时间有效性；
- 新事实替换旧事实；
- 重要互动与关系召回；
- Relationship Timeline 的图谱来源。

### 7.5 Important Moments / Relationship Timeline

新增产品投影：

- 第一次认识；
- 重要约会/见面；
- 生日/节日/纪念日；
- 曾经的冲突与修复；
- 共同活动；
- 对方主动分享的重要生活事件；
- 用户明确标记的“重要时刻”。

这些投影优先来自 Letta / Graphiti / Immich，不再建立第二套独立关系数据库。

---

## 8. Conversation Goal / Relationship Journey：Parlant 主运行时

Yance 支持用户为当前联系人/会话设置**可选聊天意图**。

示例：

- 自然重新打开话题；
- 让聊天轻松一些；
- 多了解对方最近的生活；
- 表达关心；
- 分享自己的感受；
- 昨天发生误会，今天希望缓和；
- 刚认识，不要表现得太着急；
- 自然邀请见面；
- 延续昨天的话题；
- 不设置目标，只自然聊天。

底层优先 Parlant Journey / Guidelines：

```text
Conversation Goal
        ↓
Activation conditions
        ↓
Journey state / guideline
        ↓
当前关系与情绪上下文
        ↓
下一步沟通意图
        ↓
自然回复候选
```

必须支持：

- 对方跑题后先自然回应，不机械拉回；
- backtracking；
- conditional transition；
- 一次回答多个信息时跳过已完成步骤；
- 目标完成后停止推动；
- 用户随时暂停/修改/删除；
- 目标约束“自己的表达”，不得设计成诱导、胁迫或欺骗对方完成动作。

SalesGPT/销售阶段不再是 V2.1 核心 Journey 模板来源。

---

## 9. Reply Candidates：不是只给一个“标准答案”

同一条消息允许生成多方向候选，例如：

- 自然；
- 温柔；
- 幽默；
- 更主动；
- 更克制。

候选必须共享同一事实/关系上下文，但可以有不同表达策略。

可借鉴 SillyTavern swipe/branch、prompt composition 等成熟交互思想或可移植模块；不得因此把 SillyTavern 变成第二套 Yance UI。

Yance 最终发送前保持用户可选择、修改和接管。

---

## 10. Emotion Context：语音和文本情绪是上下文，不是事实判决

### 10.1 SenseVoice 优先增强输入

语音理解优先评估 SenseVoice / FunASR：

```text
voice
 ↓
ASR text
 + language ID
 + speech emotion signal
 + audio event signal
 + speaker diarization（适用时）
```

SenseVoice 模型权重许可证必须独立于代码许可证冻结。

### 10.2 Emotion inference 规则

情绪识别输出属于 inference：

- 必须有 confidence；
- 不能写成“对方一定生气”；
- 不允许长期永久固化一次瞬时情绪；
- 文本语义、语音信号和长期关系历史发生冲突时，必须保持不确定性。

### 10.3 STT fallback

faster-whisper / whisper.cpp 继续作为成熟稳定 STT fallback/benchmark。

---

## 11. Model Brain：RouteLLM + LiteLLM

```text
Relationship context / task
   ↓
RouteLLM
   ↓
LiteLLM
   ↓
OpenAI / Anthropic / Gemini / OpenRouter / Ollama / llama.cpp / 其他 provider
```

Yance 不重复实现 provider adapter、stream normalization、基础 retry/fallback、token/cost normalization、provider health/load balancing。

路由依据至少包括：

- conversation complexity；
- emotional/relationship sensitivity；
- language；
- vision/audio/video/tool；
- context length；
- latency；
- budget；
- local/cloud privacy；
- 历史真实质量数据。

LiteLLM/open-core 路径必须做 license boundary audit。

---

## 12. Learning Brain：越来越像用户，不直接“训练出另一个人格”

闭环：

```text
AI candidate / Journey / route / Presence output
        ↓
Langfuse trace + OpenTelemetry
        ↓
用户选择 / 修改 / 拒绝 / 最终发送
        ↓
Letta/Graphiti relationship evidence
        ↓
Argilla（需要人工整理时）
        ↓
DSPy candidate optimization
        ↓
Promptfoo + Langfuse experiment
        ↓
Shadow / Benchmark / Regression
        ↓
晋级或回滚
```

必须记录：

- AI 推荐文本 vs 用户最终发送文本；
- 修改距离；
- 语气变化；
- 长短变化；
- 常用词；
- 候选接受/拒绝；
- Journey 是否自然推进；
- 用户是否主动取消目标；
- Voice/Visual/Avatar 是否采用；
- latency / failure / user takeover。

单次行为不得直接覆盖长期 Persona 或 Relationship Profile。

版本化至少包括：

- Persona/Profile Version；
- Relationship Policy Version；
- Prompt/Program Version；
- Journey Template Version；
- Routing Policy Version；
- Voice Style Profile Version；
- Visual Workflow Version；
- Avatar Runtime/Profile Version。

---

## 13. Voice Brain：SenseVoice 输入 + CosyVoice 输出

### 13.1 VoiceProfile

用户可以上传/录制自己明确授权的声音，形成 VoiceProfile；Yance 以后生成接近本人音色的目标语言语音，不要求每次重新录音。

首选：

- CosyVoice 3：zero-shot / cross-lingual voice cloning；
- Chatterbox / GPT-SoVITS：benchmark 备选；
- OpenVoice：voice conversion fallback；
- SenseVoice/faster-whisper/whisper.cpp：输入理解；
- LiveKit Agents/Pipecat：实时 voice pipeline。

### 13.2 情感语音输出

Voice output 不只是 `text -> speech`，而是：

```text
reply text
 + intended tone
 + pace
 + energy
 + formality
 + language/locale
        ↓
CosyVoice / selected backend
        ↓
FFmpeg/Opus mature encoding
        ↓
platform audio message / realtime avatar
```

必须通过真实授权声音样本测试 speaker similarity、多语言自然度、情绪自然度、latency、长文本稳定性、GPU/CPU 与平台编码兼容。

---

## 14. Realtime Voice：不自研 WebRTC/VAD/STT/TTS orchestration

普通语音消息优先：

```text
SenseVoice/faster-whisper
  → Relationship Intelligence
  → CosyVoice
```

实时语音/电话优先 LiveKit Agents / Pipecat；可评估 Open-LLM-VTuber 中许可证合适的成熟 backend/module，例如 interruption、proactive speaking、ASR/LLM/TTS modular pipeline，但不得直接跟随许可证已经变化的主线代码。

Yance 不自研：

- WebRTC SFU；
- VAD 基础模型；
- realtime media transport；
- 通用 turn-taking framework；
- 第二套 STT/TTS orchestration framework。

---

## 15. Visual / Relationship Media Memory：Immich real-first

Immich 继续负责个人真实照片/视频：

- timeline；
- albums；
- face/person；
- place；
- semantic search；
- memories；
- metadata；
- 原始文件。

在 Relationship Intelligence 中，Immich 额外承担**Relationship Media Memory** 来源，例如：

- 共同旅行/活动照片；
- 对方曾发送的重要图片；
- 时间/地点/人物关联；
- Relationship Timeline 的媒体证据。

真实素材优先级固定：

```text
真实照片高匹配
   ↓
真实照片轻量裁切/增强
   ↓
基于本人授权素材的 AI 个性化生成
```

ComfyUI + PhotoMaker/InstantID/PuLID + IP-Adapter/ControlNet 用于个性化生成；Real-ESRGAN/GFPGAN/CodeFormer 用于修复增强。

合成素材必须保留 provenance，不得冒充实时现场事实。

---

## 16. Personal Video Avatar：CyberVerse + LiveKit

目标仍是本人授权形象/声音的低延迟 AI Avatar communication。

首选：

- CyberVerse：完整数字人 Agent / realtime runtime；
- LiveKit：WebRTC/SFU/TURN/client SDK；
- Ditto / MuseTalk / LivePortrait / SoulX-FlashHead / LiveAct：统一 benchmark backend；
- OBS Virtual Camera：第三方桌面客户端正式支持时的成熟输出路径；
- HunyuanVideo-Avatar 等：离线高质量 Video Message。

必须支持 listening/speaking、打断、idle motion、音画同步、网络恢复、用户随时接管真实麦克风/摄像头、backend 失败降级到语音/文字。

不得以“无法被对方识别为 AI/合成”作为验收指标。

---

## 17. Document / Knowledge Intelligence：Docling + Retrieval，不重复造解析器

Yance 允许用户导入与个人沟通相关的资料，例如 PDF、Word、PPT、Excel、网页、聊天导出、旅行计划、活动资料等。

文档解析优先 Docling；Apache Tika 作为覆盖/兼容备选；PaddleOCR 用于 OCR。

```text
file
 ↓
Docling / Tika / PaddleOCR
 ↓
structured document
 ↓
knowledge ingestion
 ↓
pgvector / Qdrant（按规模）
 ↓
Relationship / Conversation context
```

Knowledge Base 与 Letta personal/relationship memory 必须分离：

- Letta = 人与长期互动记忆；
- Graphiti = 时间关系事实；
- Retrieval = 可查询外部资料/知识。

不得再引入第二套个人长期记忆系统与 Letta 竞争。

---

## 18. MCP：工具生态标准接口

Yance 的 AI 工具连接优先采用 MCP 官方 SDK 的**实施时稳定发布线**，用于：

- tools；
- resources；
- prompts；
- stdio / Streamable HTTP；
- auth helpers；
- external integrations。

禁止为 Gmail、Calendar、Drive、数据库、浏览器等每个工具重新设计一套 Yance 私有 tool protocol。

MCP SDK 仍需 exact version/commit pin 和 protocol compatibility tests；不得直接依赖未冻结的 `main`。

---

## 19. Durable Execution：需要时用成熟 workflow engine

通信状态优先由 Matrix/bridge/native upstream 持有；Agent state 优先 Letta；Journey state 优先 Parlant；realtime session 优先 LiveKit/CyberVerse。

真正出现跨小时/跨天、需要 crash-recovery 的长流程时，优先评估 Temporal 等成熟 durable workflow engine，例如：

- 稍后提醒用户回复某个联系人；
- 等某个外部条件变化后继续；
- 多步工具流程；
- 长时间媒体/导入任务。

不再默认自研通用 DurableTask/Outbox framework。

---

## 20. Dating Companion Mode

Dating Companion 是 Relationship Intelligence 的产品模式，而不是另一个 AI 大脑。

```text
文本 / 截图 / profile / 当前聊天 / 语音 / 图片
        ↓
OCR / SenseVoice / VLM / structured parsing
        ↓
Persona + Relationship Profile
        ↓
Letta + Graphiti
        ↓
Parlant Conversation Goal
        ↓
RouteLLM + LiteLLM
        ↓
多方向 reply candidates
        ↓
text / cloned voice / real photo / generated media / avatar
        ↓
用户选择 / 修改 / 发送
        ↓
Learning Brain
```

不同交友平台模板只负责 UI 识别、文化/语言配置和 Relationship Journey Pack，不建立平台专属回复大脑。

---

## 21. 固定质量门禁

所有 OSS 产品/模块至少必须满足：

- 精确上游 repo + 40 位 commit/tag；
- license/path/model assets 精确记录；
- THIRD_PARTY_NOTICES / SBOM / Release 义务；
- 上游关键测试保留或等效覆盖；
- Windows 真实数据与真实账号验证；
- offline / disconnect / crash / restart / duplicate / late event；
- 不吞错、不伪造成功；
- upgrade / rollback 可执行；
- patch 小、可重放、可重新基于上游验证；
- UI loading/empty/offline/error/recovery/permission-denied；
- 100/125/150/200% DPI 与键盘基本可用；
- route/prompt/Journey/Persona/Voice/Visual/Avatar 全部版本化。

### 21.1 Relationship Intelligence

必须验证：

- confirmed fact / user fact / AI inference 不混淆；
- inference 有来源/confidence；
- 不把一次情绪判断永久写成事实；
- Persona 变化有证据、版本和回滚；
- Relationship Timeline 的重要事实可追溯；
- Goal 控制自己的沟通策略，不构建欺骗/胁迫式对方控制；
- 用户可随时停用 Goal / AI / Voice / Avatar。

### 21.2 Communication

- capability matrix；
- history/backfill；
- edit/delete/reaction/read receipt；
- reconnect；
- media；
- multi-account；
- 平台特有能力不静默丢失。

### 21.3 Facebook 专项

Official Engine：

- OAuth/token/subscription/webhook；
- unknown contact first message；
- Business Suite / external echo；
- Meta MID dedupe；
- delivery/read；
- attachment/media；
- history/reconciliation；
- permission-limited state 必须真实显示。

Session Engine：

- login/2FA/session recovery；
- no plaintext password persistence；
- Personal send/receive；
- Page identity discovery/switch；
- Page send/receive；
- Business Suite echo；
- long connection/reconnect；
- checkpoint/account-risk visibility；
- Windows/Electron real-account UAT。

### 21.4 Voice / Emotion

- speaker similarity；
- ASR accuracy；
- emotion signal accuracy/uncertainty；
- 多语言；
- latency；
- audio codec/platform compatibility；
- failure fallback。

### 21.5 Learning / Routing

- shadow comparison；
- prompt/Journey/routing regression；
- acceptance/modification distance；
- latency/cost/quality；
- failure rollback。

### 21.6 Visual / Avatar

继续保留 V2.1 的 real-first、provenance、identity consistency、lip-sync、turn interruption、WebRTC recovery、user takeover、synthetic-content truthfulness 等门禁。

---

## 22. V2.1 实施顺序

### 22.1 已完成 / 当前工作不得重做

- Communications P0（Matrix/Synapse + Element + mautrix-whatsapp）已经按既有工作包收口后，不重新打底；
- 当前 Letta P0 v2 继续按现有 #119 精确授权与 RED/GREEN 周期实施；
- 本次 Relationship Enhancement **不得扩大 #119 scope**。

### 22.2 AI / Relationship 主线

当前 Letta P0 收口后：

1. Parlant Relationship Goal/Journey；
2. LiteLLM + RouteLLM；
3. Langfuse + OpenTelemetry；
4. SenseVoice + CosyVoice Voice Brain；
5. Immich Relationship Media Memory；
6. Graphiti 深度 Relationship Timeline；
7. SillyTavern Persona/Character/Lorebook/Prompt 可移植模块 OSS-fit；
8. Docling + Retrieval；
9. MCP tool ecosystem；
10. ComfyUI identity visual；
11. Live voice；
12. CyberVerse + LiveKit realtime Avatar；
13. Temporal/durable workflow 仅在真实需求出现时。

### 22.3 Facebook reliability 独立并行线

Facebook Page 当前已有真实缺陷历史，因此在不污染 Letta/AI exact-scope 的前提下，启动独立：

```text
Facebook current regression freeze
        ↓
Chatwoot OSS Facebook Core + Meta official engine OSS-fit
        ↓
FCA Session Engine real-account/Page OSS-fit
        ↓
同一 capability/UAT matrix
        ↓
选择 default + fallback/escape hatch
        ↓
逐步淘汰 Yance 重复自研 Facebook transport logic
```

这条线与 AI Relationship 主线并行，不要求等待所有 AI 模块完成。

---

## 23. 旧计划清理与冲突处理

V2.1 当前明确废止/纠正：

- 把 Yance 定位为 CRM / sales / marketing system；
- SalesGPT/销售漏斗作为 Goal Brain 的核心模板；
- 为每个平台建立独立产品 UI；
- 为成熟 OSS 已有能力建立第二套 Yance message/memory/journey/model/photo/voice/WebRTC infrastructure；
- Facebook Page 默认继续通过扩大 Yance 自研 connector 修补；
- AI inference 静默变成真人事实；
- 生成声音/图片/Avatar 冒充实时事实证据。

历史提交不改写；旧语义通过后继普通提交逐步迁移。

---

## 24. 计划维护协议

- 固定稳定/状态分支：`project-state/active-handoff`；
- 唯一稳定架构文件：`YANCE_IMPLEMENTATION_MASTER_PLAN.md`；
- `START_HERE.md` 只作为入口与最高原则摘要；
- `PROJECT_CONTINUATION.md` 只记录当前动态事实，不得覆盖本文件；
- 总范围调整只允许普通后继提交，不 amend/rebase/force push；
- 每个真正落地的 OSS 模块仍需要独立来源 pin、scope、failure-first RED、GREEN、review、receipt、exact-Head merge approval；
- 当前已授权工作包不因为总计划增强而自动获得新增路径授权。

---

## 25. 当前立即行动

1. 继续收口当前 Letta P0 v2 #119，不改 scope；
2. Letta GREEN 后按 Relationship 主线进入 Parlant；
3. 独立建立 Facebook modernization OSS-fit，不再继续零散修补现有 Facebook transport；
4. Facebook Session Engine 必须先做真实账号 + Page 能力证明，再决定是否成为正式 native engine；
5. 把 SillyTavern、SenseVoice、Docling、MCP、pgvector/Qdrant、Open-LLM-VTuber 可许可模块纳入后续来源矩阵；
6. 对每个新增 OSS 固定 repo/commit/license/model-license/build/runtime/Windows UAT；
7. 所有功能继续只进入一个 Yance 产品工作区；
8. 所有 Relation/Emotion inference 必须保留不确定性和 provenance；
9. 继续执行成熟 OSS 优先、failure-first、底层修复、不强推、不改写历史、不弱化门禁；
10. 最终 merge 始终停在 owner exact-Head 明确批准边界。
