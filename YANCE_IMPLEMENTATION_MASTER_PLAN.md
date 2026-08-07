# 言策（Yance）总实施方案与开源移植最高指令

> **状态：V2.1 最高指令冻结，跨聊天持续有效。**
>
> 本文件是 Yance 的最高稳定架构与实施指令。除实时远端事实、已生效治理凭据、精确授权 Head 与正式安全/许可证约束外，任何旧聊天、旧设计快照、旧实施方案、旧 UI 计划或旧工作包说明与本文件冲突时，**以本文件为准**。
>
> V2.1 将此前确认的多平台、AI 回复大脑、长期记忆、目标导向聊天、模型路由、学习成长、本人声音克隆、个人照片素材与实时本人 AI Avatar 视频通话合并为一套单一架构。禁止后续再次拆成互相竞争的平行产品底座。
>
> 当前已经授权并正在收口的精确 Head、PR、workflow、receipt 与门禁不因本次架构升级而被改写或绕过；它们按原授权完成。V2.1 通过新的普通提交、独立工作包、精确上游 pin、RED/GREEN 证据和可回滚迁移逐步落地。

## 0. 最高指令：成熟 OSS 接管，禁止重复自研

Yance 的最高执行指标是：**以最短路径形成真实可运行、功能尽可能强、稳定、可维护的个人开源产品。**

项目定位固定为：

- 个人使用；
- 开源 Yance；
- 接受并履行 GPL、AGPL、LGPL、Apache、MIT、BSD、Boost 等所采用组件对应的许可证义务；
- 不再要求 Yance 自己拥有产品身份、通信事实权威、联系人事实权威、关系事实权威、Agent 状态权威、媒体事实权威或任务调度权威；
- 只要成熟上游已经提供生产级完整能力，优先让成熟上游成为真实运行内核，而不是“参考后由 Yance 重写一遍”。

采用顺序固定为：

```text
完整成熟开源产品
        ↓
完整成熟开源服务 / Sidecar
        ↓
完整成熟源码能力模块
        ↓
固定版本依赖
        ↓
极薄 Adapter / Branding / Configuration
        ↓
只有证明没有成熟 OSS 可满足时才允许自研
```

### 0.1 自研准入硬门禁

任何计划新增 Yance 自研基础设施前，必须提供：

1. 已检索和评估的成熟 OSS 候选；
2. 候选不能满足需求的具体行为缺口；
3. 为什么不能通过完整产品、Sidecar、源码模块、依赖或极薄适配解决；
4. 最小自研范围；
5. 对应失败测试和回滚方案。

没有这份证据，**不得批准自研等价能力**。

### 0.2 速度规则

速度通过删除重复工程获得，不通过临时绕过获得。继续永久禁止：

- 弱化或关闭 guard；
- 跳过测试；
- 吞错；
- 强推；
- amend/rebase 改写已发布历史；
- 扩大无边界重试；
- 伪造成功状态；
- 用临时 patch、CSS 遮挡、假数据或旁路长期代替底层修复。

固定原则：

> **成熟 OSS 是默认实现；Yance 只做必要整合。底层重构优先通过替换为成熟上游完成，而不是重新造轮子。**

## 1. 最终产品形态：Yance 开源整合发行版

Yance 最终仍提供一个统一桌面体验，但底层允许多个成熟 OSS 各自拥有其最擅长的真实运行状态。

```text
                                      YANCE
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ↓                             ↓                             ↓
 Communication Core                 AI Brain                  Personal Presence
 Matrix / Element                    Letta                  Voice / Photo / Avatar
          │                             │                             │
 mautrix bridges                    Graphiti           CosyVoice / Immich / CyberVerse
          │                             │                             │
 Native OSS fallback                Parlant       ComfyUI / LiveKit / Avatar Backends
          │                             │                             │
          └─────────────────────────────┼─────────────────────────────┘
                                        ↓
                                  Model Brain
                              RouteLLM + LiteLLM
                                        ↓
                                  Learning Brain
                         Langfuse + DSPy + Promptfoo
                                        ↓
                                Yance Integration
                    Branding / AI Panel / Goal / Presence / UX
```

Yance 自身默认只维护：

```text
branding/
integration/
ai-panel/
goal-ui/
presence-ui/
installer/
config/
upstream-patches/
compatibility-tests/
```

除非工作包证明没有成熟 OSS 可用，否则不新增第二套通信数据库、第二套消息状态机、第二套 Agent memory、第二套 Journey runtime、第二套模型网关、第二套照片管理系统、第二套图像工作流引擎、第二套 TTS 引擎或第二套实时数字人/WebRTC 框架。

## 2. V2.1 核心开源母体矩阵

下列项目是首选上游母体；实施前仍必须由 OSS-A 固定精确仓库、40 位 commit/tag、许可证、来源路径、构建方式、目标路径、上游测试、修改说明、SBOM 与回滚。

| 能力 | 首选成熟 OSS | 默认采用方式 |
|---|---|---|
| 统一通信底座 | Matrix + Synapse | 完整服务 |
| 多平台桥接 | mautrix bridge 生态 | 完整 Sidecar / bridge |
| 统一聊天 UI | Element Web / Element 相关成熟客户端能力 | 产品壳源码/运行时 |
| WhatsApp 原生深度能力 | mautrix-whatsapp；Baileys 作为原生能力补充/回退候选 | bridge 优先，必要时 native runtime |
| Telegram | mautrix-telegram / TDLib | bridge 或完整 Sidecar |
| Signal | mautrix-signal / signal-cli 等成熟桥 | 隔离 Sidecar |
| Messenger / Instagram | mautrix-meta + 官方 Meta API | bridge/API |
| Google Messages | mautrix-gmessages | bridge |
| 长期 Agent / Memory / Context | Letta | 完整服务 / SDK |
| 时间关系记忆 | Graphiti | Sidecar |
| 目标导向对话 | Parlant | 完整对话控制运行时 |
| 销售/客户 Journey 模板 | SalesGPT 等成熟领域实现 | 行为模板/模块 |
| 非对话长流程 | LangGraph | 固定依赖/Sidecar，避免与 Parlant 重复 |
| 模型统一网关 | LiteLLM | Sidecar |
| 智能模型路由 | RouteLLM | 路由模块 |
| 前端 AI streaming/tool UI | Vercel AI SDK | 固定依赖 |
| AI trace / dataset / eval | Langfuse | 完整服务 |
| Prompt/program 优化 | DSPy | Sidecar |
| AI 回归/红队 | Promptfoo | CI/评测工具 |
| 人工反馈数据集 | Argilla（需要时） | Sidecar |
| 本人声音克隆 | CosyVoice 3 | 本地 GPU/Sidecar |
| 多语言声音备选 | Chatterbox Multilingual / GPT-SoVITS 候选 | benchmark 后固定 |
| Voice conversion 回退 | OpenVoice V2 | Sidecar |
| 实时语音 Agent | LiveKit Agents / Pipecat | Sidecar/服务 |
| 本地 STT | whisper.cpp / FunASR 候选 | Native Sidecar |
| 个人真实照片库 | Immich | 完整服务 |
| 图像工作流 | ComfyUI | 完整 Sidecar |
| 身份一致人像 | PhotoMaker / InstantID / PuLID 候选 | ComfyUI 工作流模块 |
| 图像条件控制 | IP-Adapter / ControlNet | ComfyUI 模块 |
| 图像修复/超分 | Real-ESRGAN / GFPGAN / CodeFormer | 模块 |
| 实时数字人视频通话母体 | CyberVerse | 完整源码母体 / 独立服务 |
| 实时 talking-head 后端 | Ditto TalkingHead | Avatar backend / Sidecar |
| 实时 lip-sync 后端 | MuseTalk 1.5 | Avatar backend / Sidecar |
| 头部/表情驱动 | LivePortrait | Avatar backend；模型资产单独审查 |
| CyberVerse 原生头像后端 | SoulX-FlashHead / LiveAct | benchmark 后按模型许可证固定 |
| WebRTC 音视频通话 | LiveKit | 完整服务 / SFU |
| 第三方客户端虚拟摄像头输出 | OBS Studio Virtual Camera | 独立桌面运行时 |
| 高质量离线视频消息 | HunyuanVideo-Avatar 等候选 | 独立 benchmark/许可证工作包 |
| OCR | PaddleOCR | Sidecar |
| 文档解析 | Apache Tika | Sidecar |
| PII 脱敏 | Microsoft Presidio | Sidecar |
| 备份 | restic | Sidecar |
| 可观测性 | OpenTelemetry | 固定依赖/Collector |
| SBOM/漏洞 | CycloneDX / OSV-Scanner | CI/发布工具 |

### 2.1 Copyleft 与模型资产规则

GPL/AGPL 不再因为未来闭源商业化而被排除。采用时必须：

- 保留许可证与版权声明；
- 满足源码提供、修改披露、网络交互等对应义务；
- 在 `THIRD_PARTY_NOTICES`、SBOM 与 Release 资产中记录；
- 对分叉修改保持可重建与可追溯；
- 不把许可证义务当作绕开成熟上游、重新自研的默认理由。

模型权重、测试素材、第三方 detector/embedding、人物身份模型与代码许可证必须分别核验。代码 permissive 不代表模型资产自动 permissive。

## 3. 多平台：Matrix/mautrix 优先替代 Yance 自建 Channel Fabric

V1 的“唯一 Yance ChannelDriver + 唯一 Canonical 模型”不再是最高架构要求。与本节冲突处，V1 条款废止。

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

### 3.1 平台接入规则

1. 有成熟 Matrix bridge：优先完整采用 bridge；
2. bridge 缺平台特有能力：允许调用成熟 native OSS runtime，不强迫压缩成 Matrix 最小公分母；
3. 没有成熟 bridge 但有官方/成熟完整客户端：直接 Sidecar；
4. 只有设备本机能力：使用 Android/iOS/macOS Companion Host；
5. 没有成熟来源：先证明缺口，再决定是否做最小自研。

### 3.2 平台范围

首批优先：

- WhatsApp；
- Telegram；
- Signal；
- Facebook Page / Messenger；
- Instagram Professional / Personal DM；
- Google Messages / RCS / SMS。

后续保持：

- LINE；
- KakaoTalk；
- iMessage；
- 其他有成熟开源桥或 Companion 能力的平台。

不得伪装成平台不存在的完整同步或通话能力；能力缺失必须明确显示。

### 3.3 Native capability escape hatch

Matrix 是主统一层，不是强制最小公分母。以下场景允许通过成熟原生 runtime 直达：

- bridge 尚未暴露但上游原生客户端已成熟支持的功能；
- 特殊媒体/群管理/设备生命周期；
- 平台特有编辑、反应、回执、线程、同步、语音或视频能力；
- 需要更深故障诊断时。

Yance 只维护极薄能力映射，不重写协议。

## 4. 聊天产品壳：Element 优先，Chatwoot 降为可选能力来源

V1/UI V1 中“Chatwoot OSS 是唯一产品壳”的条款在与本节冲突处被取代。

首选：

```text
Element Web / 成熟 Matrix 客户端能力
        ↓
保留成熟会话列表、timeline、thread、reply、edit、reaction、media、search、notification、settings
        ↓
加入 Yance 品牌、AI 右侧栏、目标栏、语音/照片/视频 Avatar 入口
```

Chatwoot 仍可作为联系人/收件箱/消息交互规则和组件参考或精选源码来源，但不再要求 Yance 复制其完整会话产品壳。

自定义 Yance 面板优先使用：

- shadcn-vue；
- Reka UI；
- VueUse；
- Tiptap OSS Core；
- TanStack；
- Cytoscape.js；
- Storybook / Playwright / axe-core / MSW。

现有主题、提示音、通知规则、用户设置和翻译体验原则继续保留，除非后续专门迁移工作包以零回归证据替换其实现。

## 5. AI Reply Brain：Letta + Graphiti + Parlant

Yance 不自研完整 Cognitive Runtime。

### 5.1 Letta：长期 Agent 核心

Letta 默认负责：

- persistent agent state；
- working/persistent memory；
- context window management；
- compaction；
- conversation continuity；
- tool/state persistence；
- 长期 Agent 运行生命周期。

Yance 不再自己写一套等价 Agent State / Memory Runtime。

### 5.2 Graphiti：时间关系与事实演化

Graphiti 默认负责：

- 人物/组织/主题关系；
- episode provenance；
- 时间有效性；
- 新事实替换旧事实；
- 关系召回；
- 历史互动关联。

具体 graph backend 在独立来源/许可证工作包中固定，不在总计划里假定某个已弃用或许可证不合适的后端。

### 5.3 Persona / Style

用户 Persona、表达偏好、语言习惯和 Style Genome 仍然是产品能力，但不再要求自研一个独立框架。

优先实现为：

```text
Letta memory / structured profile
        +
Graphiti relationship context
        +
成熟 prompt/persona 模块行为
        +
DSPy 优化
```

Yance 只保留用户可见编辑、版本历史、回滚和呈现体验。

## 6. Goal Brain：聊天必须有可选目标，Parlant 作为主运行时

“会回复”不是最终目标。Yance 必须支持每个联系人/会话设置当前沟通目标，并让 AI 在不生硬、不机械、不重复的前提下逐步推进。

### 6.1 用户输入

每个联系人/会话可设置：

```text
今日聊天目标
成功条件
推进强度：非常自然 / 自然推进 / 主动推进
期限（可选）
禁止触碰的话题（可选）
```

示例：

- 获取某项客户需求信息；
- 安排下一次会议；
- 处理异议并完成报价；
- 恢复联系；
- 自然邀请见面；
- 售后确认问题已解决。

### 6.2 Parlant Journey

目标转换为成熟 Journey/Guideline 运行时：

```text
Goal
 ↓
Activation Conditions
 ↓
Journey States / Transitions
 ↓
当前聊天上下文
 ↓
下一步沟通意图
 ↓
自然回复候选
```

必须支持：

- 对方跑题后自然回答，再回到目标；
- backtracking；
- conditional transition；
- 一次回答多个信息时跳过已完成步骤；
- 明确完成条件；
- 目标完成后停止继续推动；
- 用户随时暂停、改目标或删除 Journey。

SalesGPT 等成熟项目的客户开发、qualification、needs analysis、objection handling、close 等阶段模型可作为 Journey Pack 来源，不重写一个新的销售状态机。

### 6.3 Reply Brain 最终输出

```text
对方消息 / 语音 / 视频通话实时输入
   ↓
Letta：长期状态与上下文
   ↓
Graphiti：人物/关系/时间事实
   ↓
Parlant：目标/Journey/下一步策略
   ↓
Persona / Style Context
   ↓
RouteLLM：模型选择
   ↓
LiteLLM：provider / fallback / budget
   ↓
候选生成 + Critic / Eval / Ranking
   ↓
文字 / 本人克隆语音 / 真实或生成照片 / 实时 Avatar 发言
```

## 7. Model Brain：RouteLLM + LiteLLM，不自研 provider 层

模型执行固定分工：

```text
任务/上下文
   ↓
RouteLLM 或同级成熟路由模块
   ↓
LiteLLM
   ↓
OpenAI / Anthropic / Gemini / OpenRouter / Ollama / llama.cpp / 其他 provider
```

Yance 不重复实现：

- provider adapter；
- streaming protocol normalization；
- 基础 retry/fallback；
- token/cost normalization；
- provider health/load balancing。

路由输入至少包括：

- 任务类型；
- reasoning 难度；
- social/relationship sensitivity；
- 语言；
- vision/audio/video/tool 要求；
- context length；
- 延迟目标；
- 成本预算；
- local/cloud 隐私偏好；
- 历史真实质量数据。

路由结果通过 Langfuse/评测数据持续校准，而不是写死“某模型永远最好”。

## 8. Learning Brain：从记录反馈升级为可证据化成长

学习闭环优先采用成熟 OSS：

```text
生产回复 / Journey / 模型调用 / Presence 输出
        ↓
Langfuse trace + score + dataset
        ↓
用户选择 / 修改 / 拒绝 / 目标是否达成
        ↓
Argilla（需要人工整理时）
        ↓
DSPy 生成 Prompt / Program / Example 候选
        ↓
Promptfoo + Langfuse experiment
        ↓
Shadow / Benchmark / Regression
        ↓
晋级或回滚
```

### 8.1 Shadow Learning

必须记录：

```text
AI 推荐文本
vs
用户最终发送文本
```

并记录：

- 修改距离；
- 语气变化；
- 长短变化；
- 正式程度；
- 常用词/语气词；
- 是否接受候选；
- Journey 是否推进；
- 最终目标是否达成；
- Voice/Visual/Avatar 是否被采用；
- 实时语音/视频中的打断、延迟、失败和用户接管情况。

这些数据先成为学习证据，不允许单次行为直接永久覆盖 Persona、Journey、Routing 或 Presence Profile。

### 8.2 版本化成长

至少版本化：

```text
Persona/Profile Version
Style Version
Prompt/Program Version
Journey Template Version
Routing Policy Version
Voice Style Profile Version
Visual Workflow Version
Avatar Runtime/Profile Version
```

每次晋级都必须可比较、可回滚。

## 9. Personal Presence：本人声音 + 个人照片 + 实时 AI Avatar

Voice、Visual、Video 不再作为互不相关的附件功能，而是统一为 `PersonalPresenceProfile`。

```text
PersonalPresenceProfile
├── VoiceProfile
├── VisualIdentityProfile
├── AvatarProfile
├── Scene/Style Preferences
├── Provenance / Authorization
└── Runtime / Model Versions
```

所有身份素材默认只允许来自用户本人或已明确获得授权的素材。Yance 必须保存来源与授权状态，不允许把不同人的声音、人脸或素材静默混成同一个 Profile。

### 9.1 Voice Brain：跨语言本人声音克隆

Yance 支持用户创建自己的 `VoiceProfile`，以后 AI 回复可直接生成接近本人音色的目标语言语音，不要求用户每次重新录音。

首选引擎：

- CosyVoice 3：主零样本/跨语言声音克隆引擎；
- Chatterbox Multilingual 或 GPT-SoVITS：第二引擎，经过同一 benchmark 后固定；
- OpenVoice V2：voice conversion / fallback；
- whisper.cpp / FunASR：STT；
- LiveKit Agents / Pipecat：实时 voice agent。

实施时必须用真实授权声音样本测试：

- speaker similarity；
- 中文/英文/日文/韩文及用户目标语言；
- 情绪自然度；
- latency；
- GPU/CPU 占用；
- 长文本稳定性；
- 音频编码后平台兼容性。

发送链：

```text
AI 最终回复文本
       ↓
目标语言 / locale
       ↓
Voice Router
       ↓
本人 VoiceProfile
       ↓
CosyVoice / 备选引擎
       ↓
情绪 / pace / formality
       ↓
WAV/PCM
       ↓
FFmpeg / Opus 等成熟编码
       ↓
Matrix / native platform audio message / Avatar runtime
```

Voice Style 可按联系人/场景学习 pace、pause、energy、formality、emotion 和常见语气，但必须通过证据、评测和版本晋级。

### 9.2 Visual Brain：真实照片优先，AI 个性化素材补足

个人照片素材库不自研照片管理或图像生成基础设施。

Immich 默认负责：

- 照片/视频导入；
- 时间线；
- 相册；
- 人脸/人物；
- 地点；
- 语义搜索；
- 原图保存与元数据。

Yance 聊天时首先检索真实照片，而不是首先生成图片。

真实库没有合适素材时：

```text
聊天上下文 + 当前 Journey 目标
        ↓
用户授权的季节 / 时间 / 地点上下文
        ↓
ComfyUI
        ↓
PhotoMaker / InstantID / PuLID
        +
IP-Adapter / ControlNet
        ↓
Real-ESRGAN / GFPGAN / CodeFormer（需要时）
        ↓
多张候选
        ↓
用户选择后发送
```

素材推荐顺序固定为：

```text
真实照片高匹配
   ↓
真实照片可轻量裁切/增强
   ↓
基于本人已授权照片的 AI 个性化生成
```

AI 生成素材在 Yance 内部必须保留 provenance，不能与原始真实照片混淆。涉及“我现在就在这里”“实时现场证明”等依赖真实性的语境时，默认只推荐真实素材；不得把合成图自动当作实时事实证据。

### 9.3 Video Avatar Brain：照片驱动的实时本人 AI 视频通话

目标是：**高拟真、低延迟、本人授权形象、本人授权声音、自然听说与表情的 Personal AI Avatar Call**。不得把“无法被对方识别为 AI/合成内容”作为质量指标，也不得把合成 Avatar 当作现实现场证明。

首选完整母体：

- **CyberVerse**：优先整块采用其数字人 Agent、实时 WebRTC 通话、Avatar plugin、实时打断、会话管理和音视频流能力；
- **LiveKit**：需要可扩展 SFU、TURN、客户端 SDK、E2EE 和生产级音视频网络时直接采用；
- **Ditto TalkingHead**：实时 audio-driven talking-head 后端候选；
- **MuseTalk 1.5**：实时高质量 lip-sync 后端候选；
- **LivePortrait**：头部姿态、表情与 portrait animation 能力来源；
- **SoulX-FlashHead / LiveAct**：作为 CyberVerse 已支持的实时头像后端进入统一 benchmark；
- **OBS Studio Virtual Camera**：第三方桌面客户端允许虚拟摄像头时，作为成熟输出路径；
- **HunyuanVideo-Avatar 等**：仅作为高质量离线视频消息候选，不阻塞实时通话。

Yance 不自研 WebRTC SFU、不自研 talking-head 基础网络、不自研 lip-sync 模型、不自研虚拟摄像头驱动。

#### 9.3.1 Yance 原生实时 Avatar 通话

```text
对方实时语音/视频输入
        ↓
LiveKit / WebRTC
        ↓
STT / VAD / turn-taking
        ↓
Letta + Graphiti
        ↓
Parlant 当前 Goal/Journey
        ↓
RouteLLM + LiteLLM
        ↓
AI 回复文本
        ↓
CosyVoice VoiceProfile
        ↓
CyberVerse Avatar Runtime
        ↓
Ditto / MuseTalk / LivePortrait / FlashHead / LiveAct
        ↓
实时表情 / 嘴型 / 头部动作 / idle listening
        ↓
LiveKit / WebRTC 输出
```

必须支持：

- speaking / listening 两种自然状态；
- 对方打断 AI 时立即停止当前语音/视频发言；
- idle breathing、自然眨眼、轻微头部运动等不说话状态；
- 音频与口型同步；
- 网络抖动后的恢复；
- 用户随时一键接管真实摄像头/麦克风；
- Avatar runtime 失败时降级到语音或文字，而不是伪造“仍在正常通话”。

#### 9.3.2 第三方平台视频通话

Matrix/mautrix 不代表自动拥有 WhatsApp、Signal、Instagram 等原生视频通话能力。第三方视频通话采用：

```text
Yance Avatar Video Output
        ↓
OBS Virtual Camera 或平台正式支持的虚拟视频输入
        ↓
第三方桌面客户端
```

只有平台实际支持时才启用。禁止为了“看起来支持”去绕过平台安全限制、伪造不存在的协议能力或长期维护脆弱的私有逆向旁路。

#### 9.3.3 Video Message

需要预生成高质量视频消息时，可以使用更重的离线 Avatar/Video 模型；它与实时视频通话分离。离线高画质不能反向阻塞实时低延迟产品链。

### 9.4 Personal Presence 路由

同一个回复意图可以根据场景输出不同媒介：

```text
Reply Intent
   ├── Text
   ├── Cloned Voice
   ├── Real Photo
   ├── Generated Photo
   ├── Generated Video Message
   └── Realtime Avatar Speech
```

选择依据至少包括：当前 Journey、用户明确选择、平台能力、联系人偏好、隐私/授权、延迟、GPU 状态和失败回退。默认不允许模型绕过用户设置自行把普通文字升级成更高身份风险的实时 Avatar 通话。

## 10. Dating Companion Mode

Dating Companion 保留，但底层复用同一套统一能力：

```text
截图 / 文本 / 资料页 / 当前会话 / 语音或视频上下文
        ↓
PaddleOCR / STT / 结构解析
        ↓
Letta + Graphiti
        ↓
Parlant Goal/Journey
        ↓
Persona / Style
        ↓
RouteLLM + LiteLLM
        ↓
文字候选 / 本人克隆语音 / 真实或生成照片 / 视频消息 / Avatar 通话建议
        ↓
用户选择/修改/发送/发起通话
        ↓
Langfuse + DSPy 学习
```

第一版模板范围继续包括欧美、日本、韩国主要交友平台。模板只做 UI 识别、文化/语言配置与 Journey Pack，不为每个平台另造回复大脑。

## 11. Durable Execution：不再默认自研 WP-B

V1 的 `DurableTask / OutboxRecord / ExternalAttempt / LeaseFence / ReconciliationCase` 不再作为所有产品功能的强制自研前置条件。

原则：

1. 通信发送优先采用 Matrix/bridge/native upstream 自己的持久状态、重试和回执语义；
2. AI Agent 状态优先 Letta；
3. Journey 状态优先 Parlant；
4. 实时音视频状态优先 CyberVerse/LiveKit 及其成熟会话机制；
5. 长时间、跨服务、确实需要 durable workflow 的任务优先评估 Temporal 等成熟引擎；
6. 只有成熟引擎存在明确行为缺口时，才新增最小 Yance 持久化适配。

PR #17 的 Durable Task/Outbox 等历史资产继续冻结保留，作为测试语义、失败场景和必要回退参考，不因为 V2.1 而删除历史；但不再默认要求把整套自研运行时晋级为主产品前置条件。

## 12. 文件、多模态、隐私与诊断

继续优先采用：

- PaddleOCR：截图/扫描件/文档 OCR；
- Apache Tika：Office/PDF/email 等提取；
- whisper.cpp / FunASR：本地语音转写；
- LiveKit Agents / Pipecat：实时音频 Agent；
- CyberVerse / LiveKit：实时数字人与视频通话；
- FFmpeg：音视频编码、封装、转码；
- Microsoft Presidio：日志/导出/评测脱敏；
- restic：加密、增量、去重备份；
- OpenTelemetry：trace/metric/log；
- CycloneDX + OSV-Scanner：SBOM 与依赖漏洞。

能够由成熟服务直接完成的，不再建立 Yance 等价实现。

## 13. V2.1 工作线路与实施顺序

### 13.1 当前治理链先完成

当前已经授权的 OSS-A/OSS-1A 精确 Head、PR、workflow、receipt 和发布链继续按既有门禁完成。不得把 V2.1 大规模产品代码混入这些旧授权 Head。

### 13.2 最短真实产品闭环

完成当前治理链后，优先建立：

```text
Matrix/Synapse
      +
Element
      +
一个真实 bridge（优先 WhatsApp）
      ↓
真实收到消息
      ↓
Letta
      ↓
Parlant：读取当前聊天目标
      ↓
RouteLLM + LiteLLM
      ↓
多个回复候选
      ↓
用户选择/修改
      ↓
Matrix/bridge 真实发送
      ↓
Langfuse 记录结果
```

这条闭环成立后，不再重新打底，直接并行扩展 Voice / Visual / Video Presence。

### 13.3 Personal Presence 扩展顺序

```text
VoiceProfile
CosyVoice 多语言本人语音
        ↓
Immich real-first 素材检索
        ↓
ComfyUI 身份一致照片生成
        ↓
CyberVerse + LiveKit 实时 Avatar 最小闭环
        ↓
Ditto / MuseTalk / LivePortrait / FlashHead / LiveAct 统一 benchmark
        ↓
OBS Virtual Camera 第三方客户端能力矩阵
        ↓
离线高质量 Video Message
```

### 13.4 并行线路

```text
线路 A：Matrix / Synapse / Element 产品骨架
线路 B：mautrix WhatsApp / Telegram / Signal / Meta / Google Messages
线路 C：Letta + Graphiti 长期 Agent / 关系记忆
线路 D：Parlant Goal/Journey + SalesGPT Journey Packs
线路 E：RouteLLM + LiteLLM + provider pool
线路 F：Langfuse + DSPy + Promptfoo 学习闭环
线路 G：CosyVoice + 多语言本人 VoiceProfile
线路 H：Immich + ComfyUI + Identity Visual workflow
线路 I：CyberVerse + LiveKit + Avatar backend 实时视频通话
线路 J：Dating Companion + OCR + Presence 素材入口
线路 K：LINE/Kakao/iMessage/Companion gap fill
线路 L：Windows/Electron/安装/更新/备份/诊断/UAT
```

### 13.5 优先级

P0：

1. OSS-A 来源/许可证/供应链治理；
2. Matrix + Element + 第一真实 bridge；
3. Letta；
4. Parlant Goal Brain；
5. LiteLLM + RouteLLM；
6. Langfuse 基础 trace；
7. CosyVoice VoiceProfile；
8. Immich real-photo retrieval。

P1：

- Graphiti 深度关系；
- DSPy/Promptfoo 自动优化；
- ComfyUI 个性化生成；
- CyberVerse + LiveKit 实时 Avatar 通话；
- Ditto/MuseTalk/LivePortrait/FlashHead/LiveAct benchmark；
- 更多 bridges；
- Live voice；
- Dating Journey Packs；
- Companion Hosts。

视频 Avatar 是正式核心能力，但不阻塞第一条文字真实闭环；第一闭环成立后进入并行主线，而不是无限后置。

## 14. 固定质量门禁

每个采用的 OSS 产品/模块至少必须满足：

- 精确上游仓库、40 位 commit/tag 与来源记录；
- 许可证义务明确并进入 Release/SBOM/THIRD_PARTY_NOTICES；
- 模型权重与代码许可证分别记录；
- 上游关键测试保留或等效覆盖；
- Windows 真实数据与真实账号验证；
- 离线、断网、崩溃、重启、重复事件、迟到事件测试；
- 不吞错、不伪造成功；
- 升级和回滚可执行；
- upstream patch 尽量小、可重放、可重新基于新上游验证；
- UI 具有 loading、empty、offline、error、recovery、permission-denied；
- 关键外部动作默认可确认、可撤销或有明确不可撤销提示；
- 100%、125%、150%、200% DPI 与键盘基本可用；
- AI route、prompt、Journey、VoiceProfile、Visual workflow、Avatar runtime 均有版本和回归证据。

### 14.1 通信

- bridge capability matrix；
- history/backfill；
- edit/delete/reaction/read receipt；
- reconnect；
- media；
- 多账号；
- 平台特有能力不被静默丢弃。

### 14.2 Goal Brain

- 跑题后恢复 Journey；
- 不重复已完成问题；
- 条件跳转；
- 目标完成即停止推动；
- 用户改目标立即生效。

### 14.3 Voice

- 本人/授权声音；
- speaker similarity benchmark；
- 多语言自然度；
- latency；
- 平台音频兼容；
- 生成/发送失败明确反馈。

### 14.4 Visual

- real-first；
- 身份一致性 benchmark；
- 真实/生成 provenance 不混淆；
- 季节/时间/地点上下文必须来自用户输入或已授权数据；
- 依赖实时真实性的场景不自动使用合成图。

### 14.5 Video Avatar

至少测试：

- 本人/授权形象；
- identity consistency；
- lip-sync；
- listening/speaking 状态切换；
- 眨眼、idle motion、头部运动自然度；
- 首帧时间与持续端到端 latency；
- 目标 FPS/分辨率在指定 GPU 上稳定；
- 对方打断后的停止延迟；
- STT → Reply Brain → TTS → Avatar 的全链延迟；
- WebRTC ICE/TURN/P2P/SFU 网络失败恢复；
- 音视频同步；
- 用户切回真实麦克风/摄像头；
- Avatar backend 崩溃后的明确降级；
- 虚拟摄像头只在平台正式支持的路径启用；
- AI/合成来源在 Yance 内有明确状态与 provenance；
- 不以“无法识别为合成内容”作为验收条件。

### 14.6 Learning / Routing

- 离线评测；
- shadow 对比；
- prompt/Journey/routing 回归；
- 成本、延迟、接受率、修改距离、目标达成率可比较；
- Presence 媒介采用率与失败率可比较；
- 失败可回滚到上一个稳定版本。

## 15. 与旧计划的冲突处理

本 V2.1 明确取代以下旧架构硬要求：

- “Yance 必须保持唯一产品与数据权威”；
- “必须自建唯一 ChannelDriver”；
- “必须自建 CanonicalAccount/Contact/Conversation/Message 等统一事实层”；
- “Chatwoot 必须是唯一 Product Shell”；
- “所有渠道和模型调用必须先完成 Yance 自研 WP-B DurableTask/Outbox”；
- “外部成熟产品只能作为行为合同、不得成为实际状态权威”的一般性限制；
- 把 Voice、Visual、Video 当成互不关联的独立多模态附件能力的旧理解。

以下旧原则继续有效：

- 禁止临时绕过；
- 必须底层修复；
- 失败测试先行；
- 不强推、不改写历史、不弱化门禁；
- 精确上游 commit 与来源治理；
- 独立工作包、授权、PR、receipt、exact-Head 复验；
- 用户设置、主题、提示音和真实数据迁移不得无证据回归。

## 16. 计划维护协议

- 固定分支：`project-state/active-handoff`；
- 最高稳定文件：`YANCE_IMPLEMENTATION_MASTER_PLAN.md`；
- `START_HERE.md` 必须明确本文件为最高稳定架构指令；
- `PROJECT_CONTINUATION.md` 只记录当前精确状态、阻塞和下一步，不得反向覆盖本文件的稳定架构；
- 旧专题计划在与本文件冲突时自动降级为历史/局部参考；
- 总范围调整通过普通新提交，不 amend、不 rebase、不 force push；
- 具体落地仍需各自来源凭据、路径清单、RED/GREEN、receipt 与精确 Head 证据。

## 17. 当前立即行动

1. 不污染当前已授权精确 Head，先完成正在进行的 OSS-A/治理/发布链收口；
2. 为 V2.1 建立首批上游冻结矩阵：Matrix/Synapse、Element、mautrix、Letta、Graphiti、Parlant、LiteLLM、RouteLLM、Langfuse、DSPy、Promptfoo、CosyVoice、Immich、ComfyUI、CyberVerse、LiveKit、Ditto、MuseTalk、LivePortrait、OBS Studio；
3. 对每个上游固定精确 commit、许可证、模型资产许可证、运行方式、可移植模块、上游测试与 Windows 可运行性；
4. 新工作包优先打通 `Matrix + Element + WhatsApp bridge + Letta + Parlant + LiteLLM` 第一真实闭环；
5. 同时准备 VoiceProfile P0：CosyVoice 与第二候选的真实多语言 speaker-similarity benchmark；
6. 同时准备 Visual P0：Immich 真实照片检索；生成链在 real-first 闭环后接入 ComfyUI/PhotoMaker/InstantID/PuLID；
7. 第一文字闭环稳定后启动 Personal Video Avatar 工作包：先验证 CyberVerse + LiveKit 的完整实时通话母体，再对 Ditto/MuseTalk/LivePortrait/FlashHead/LiveAct 做同一硬件、同一素材、同一延迟口径 benchmark；
8. 第三方视频通话只通过平台正式能力或 OBS Virtual Camera 等成熟受支持路径，不为“看起来支持”自研脆弱绕过；
9. 第一闭环稳定后并行扩展 Telegram、Signal、Meta、Google Messages、Graphiti、DSPy/Promptfoo、Dating Journey Packs、LINE/Kakao/iMessage Companion；
10. 以后任何新功能先查成熟 OSS；没有“无成熟 OSS 证据”，不得转入自研。
