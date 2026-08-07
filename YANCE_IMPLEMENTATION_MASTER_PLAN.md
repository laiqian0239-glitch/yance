# 言策（Yance）总实施方案与开源移植最高指令

> **状态：V2 最高指令冻结，跨聊天持续有效。**
>
> 本文件是 Yance 的最高稳定架构与实施指令。除实时远端事实、已生效治理凭据、精确授权 Head 与正式安全/许可证约束外，任何旧聊天、旧设计快照、旧实施方案、旧 UI 计划或旧工作包说明与本文件冲突时，**以本文件为准**。
>
> 当前已经授权并正在收口的精确 Head、PR、workflow、receipt 与门禁不因本次架构升级而被改写或绕过；它们按原授权完成。新架构通过新的普通提交、独立工作包、精确上游 pin、RED/GREEN 证据和可回滚迁移逐步落地。

## 0. 最高指令：成熟 OSS 接管，禁止重复自研

Yance 的最高执行指标是：**以最短路径形成真实可运行、功能尽可能强、稳定、可维护的个人开源产品。**

项目定位固定为：

- 个人使用；
- 开源 Yance；
- 接受并履行 GPL、AGPL、LGPL、Apache、MIT、BSD、Boost 等所采用组件对应的许可证义务；
- 不再要求 Yance 自己拥有产品身份、通信事实权威、联系人事实权威、关系事实权威、Agent 状态权威或任务调度权威；
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

固定原则变更为：

> **成熟 OSS 是默认实现；Yance 只做必要整合。底层重构优先通过替换为成熟上游完成，而不是重新造轮子。**

## 1. 最终产品形态：Yance 开源整合发行版

Yance 最终仍提供一个统一桌面体验，但底层允许多个成熟 OSS 各自拥有其最擅长的真实运行状态。

```text
                              YANCE
                                │
             ┌──────────────────┼──────────────────┐
             ↓                  ↓                  ↓
      Communication Core     AI Brain        Multimodal Core
       Matrix / Element        Letta          Voice / Visual
             │                  │                  │
       mautrix bridges       Graphiti        CosyVoice / ComfyUI
             │                  │                  │
      Native OSS fallback     Parlant         Immich / OCR / STT
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ↓
                         Yance Integration
                  Branding / AI Panel / Config / UX
```

Yance 自身默认只维护：

```text
branding/
integration/
ai-panel/
goal-ui/
voice-ui/
visual-ui/
installer/
config/
upstream-patches/
compatibility-tests/
```

除非工作包证明没有成熟 OSS 可用，否则不新增第二套通信数据库、第二套消息状态机、第二套 Agent memory、第二套图像工作流引擎或第二套模型网关。

## 2. V2 核心开源母体矩阵

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
| OCR | PaddleOCR | Sidecar |
| 文档解析 | Apache Tika | Sidecar |
| PII 脱敏 | Microsoft Presidio | Sidecar |
| 备份 | restic | Sidecar |
| 可观测性 | OpenTelemetry | 固定依赖/Collector |
| SBOM/漏洞 | CycloneDX / OSV-Scanner | CI/发布工具 |

### 2.1 Copyleft 规则

GPL/AGPL 不再因为未来闭源商业化而被排除。采用时必须：

- 保留许可证与版权声明；
- 满足源码提供、修改披露、网络交互等对应义务；
- 在 `THIRD_PARTY_NOTICES`、SBOM 与 Release 资产中记录；
- 对分叉修改保持可重建与可追溯；
- 不把许可证义务当作绕开成熟上游、重新自研的默认理由。

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

不得伪装成平台不存在的完整同步能力；能力缺失必须明确显示。

### 3.3 Native capability escape hatch

Matrix 是主统一层，不是强制最小公分母。以下场景允许通过成熟原生 runtime 直达：

- bridge 尚未暴露但上游原生客户端已成熟支持的功能；
- 特殊媒体/群管理/设备生命周期；
- 平台特有编辑、反应、回执、线程或同步能力；
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
加入 Yance 品牌、AI 右侧栏、目标栏、语音/照片素材入口
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

### 6.3 Reply Brain 最终链

```text
对方消息
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
候选生成
   ↓
Critic / Eval / Ranking
   ↓
文字 / 本人克隆语音 / 素材建议
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
- vision/audio/tool 要求；
- context length；
- 延迟目标；
- 成本预算；
- local/cloud 隐私偏好；
- 历史真实质量数据。

路由结果通过 Langfuse/评测数据持续校准，而不是写死“某模型永远最好”。

## 8. Learning Brain：从“记录反馈”升级为可证据化成长

学习闭环优先采用成熟 OSS：

```text
生产回复 / Journey / 模型调用
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

形成：

- 修改距离；
- 语气变化；
- 长短变化；
- 正式程度；
- 常用词/语气词；
- 是否接受候选；
- Journey 是否推进；
- 最终目标是否达成。

这些数据先成为学习证据，不允许单次行为直接永久覆盖 Persona。

### 8.2 版本化成长

至少版本化：

```text
Persona/Profile Version
Style Version
Prompt/Program Version
Journey Template Version
Routing Policy Version
Voice Style Profile Version
```

每次晋级都必须可比较、可回滚。

## 9. Voice Brain：上传本人声音，自动跨语言生成本人语音

Yance 必须支持用户创建自己的 `VoiceProfile`，以后 AI 回复可直接生成接近本人音色的目标语言语音，不要求用户每次重新录音。

### 9.1 首选引擎

主候选：

- CosyVoice 3：主零样本/跨语言声音克隆引擎；
- Chatterbox Multilingual 或 GPT-SoVITS：第二引擎，经过同一 benchmark 后固定；
- OpenVoice V2：voice conversion / fallback；
- whisper.cpp / FunASR：STT；
- LiveKit Agents / Pipecat：需要实时 voice agent 时采用。

实施时必须用真实用户声音样本测试：

- speaker similarity；
- 中文/英文/日文/韩文及用户目标语言；
- 情绪自然度；
- latency；
- GPU/CPU 占用；
- 长文本稳定性；
- 音频编码后平台兼容性。

不得在未 benchmark 的情况下凭项目热度锁死唯一引擎。

### 9.2 发送链

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
Matrix / native platform audio message
```

### 9.3 Voice Style Learning

按联系人/场景学习：

- pace；
- pause；
- energy；
- formality；
- emotion；
- 常见语气。

仍然通过证据和版本晋级，不直接永久覆盖。

### 9.4 身份与授权边界

VoiceProfile 只允许来自用户本人或已明确获得授权的声音素材；默认在发送前可预览/确认。任何未来自动发送模式必须由用户显式开启并可一键关闭。

## 10. Visual Brain：真实照片优先，AI 个性化素材补足

交友、客户维护和日常聊天允许建立个人照片素材库，但不自研照片管理或图像生成基础设施。

### 10.1 Immich：真实素材库

Immich 默认负责：

- 照片/视频导入；
- 时间线；
- 相册；
- 人脸/人物；
- 地点；
- 语义搜索；
- 原图保存与元数据。

Yance 聊天时首先检索真实照片，而不是首先生成图片。

### 10.2 真实素材标签

通过已有视觉模型/Immich metadata/OCR 自动建立：

- 人物；
- 衣着；
- 室内/室外；
- 白天/夜晚；
- 春夏秋冬；
- 咖啡厅/餐厅/健身/旅行/办公/街景等场景；
- 自拍/半身/全身；
- 情绪与风格；
- 已授权的时间与地点信息。

### 10.3 AI 图像生成

真实库没有合适素材时，进入：

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

ComfyUI 是图像工作流运行时；Yance 不写新的 node graph engine。

### 10.4 Real-first 规则

素材推荐顺序固定为：

```text
真实照片高匹配
   ↓
真实照片可轻量裁切/增强
   ↓
基于本人已授权照片的 AI 个性化生成
```

AI 生成素材在 Yance 内部必须保留 provenance，不能与原始真实照片混淆。涉及“我现在就在这里”“实时现场证明”等依赖真实性的语境时，默认只推荐真实素材；不得把合成图自动当作实时事实证据。

## 11. Dating Companion Mode

Dating Companion 保留，但底层改为复用本文件的统一能力：

```text
截图 / 文本 / 资料页 / 当前会话
        ↓
PaddleOCR / 结构解析
        ↓
Letta + Graphiti
        ↓
Parlant Goal/Journey
        ↓
Persona / Style
        ↓
RouteLLM + LiteLLM
        ↓
文字候选 / 本人克隆语音 / 真实或生成照片素材建议
        ↓
用户选择/修改/发送
        ↓
Langfuse + DSPy 学习
```

第一版模板范围继续包括欧美、日本、韩国主要交友平台。模板只做 UI 识别、文化/语言配置与 Journey Pack，不为每个平台另造回复大脑。

## 12. Durable Execution：不再默认自研 WP-B

V1 的 `DurableTask / OutboxRecord / ExternalAttempt / LeaseFence / ReconciliationCase` 不再作为所有产品功能的强制自研前置条件。

原则变更：

1. 通信发送优先采用 Matrix/bridge/native upstream 自己的持久状态、重试和回执语义；
2. AI Agent 状态优先 Letta；
3. Journey 状态优先 Parlant；
4. 长时间、跨服务、确实需要 durable workflow 的任务优先评估 Temporal 等成熟引擎；
5. 只有成熟引擎存在明确行为缺口时，才新增最小 Yance 持久化适配。

PR #17 的 Durable Task/Outbox 等历史资产继续冻结保留，作为测试语义、失败场景和必要回退参考，不因为 V2 而删除历史；但不再默认要求把整套自研运行时晋级为主产品前置条件。

## 13. 文件、多模态、隐私与诊断

继续优先采用：

- PaddleOCR：截图/扫描件/文档 OCR；
- Apache Tika：Office/PDF/email 等提取；
- whisper.cpp / FunASR：本地语音转写；
- LiveKit Agents / Pipecat：实时音频 Agent；
- Microsoft Presidio：日志/导出/评测脱敏；
- restic：加密、增量、去重备份；
- OpenTelemetry：trace/metric/log；
- CycloneDX + OSV-Scanner：SBOM 与依赖漏洞。

能够由成熟服务直接完成的，不再建立 Yance 等价实现。

## 14. V2 工作线路与实施顺序

### 14.1 当前治理链先完成

当前已经授权的 OSS-A/OSS-1A 精确 Head、PR、workflow、receipt 和发布链继续按既有门禁完成。不得把 V2 大规模产品代码混入这些旧授权 Head。

### 14.2 V2 最短真实产品闭环

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

这条闭环成立后，不再重新打底，直接并行扩展。

### 14.3 并行线路

```text
线路 A：Matrix / Synapse / Element 产品骨架
线路 B：mautrix WhatsApp / Telegram / Signal / Meta / Google Messages
线路 C：Letta + Graphiti 长期 Agent / 关系记忆
线路 D：Parlant Goal/Journey + SalesGPT Journey Packs
线路 E：RouteLLM + LiteLLM + provider pool
线路 F：Langfuse + DSPy + Promptfoo 学习闭环
线路 G：CosyVoice + 多语言本人 VoiceProfile
线路 H：Immich + ComfyUI + Identity Visual workflow
线路 I：Dating Companion + OCR + 语音/照片素材入口
线路 J：LINE/Kakao/iMessage/Companion gap fill
线路 K：Windows/Electron/安装/更新/备份/诊断/UAT
```

### 14.4 V2 优先级

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
- 更多 bridges；
- Live voice；
- Dating Journey Packs；
- Companion Hosts。

## 15. 固定质量门禁

每个采用的 OSS 产品/模块至少必须满足：

- 精确上游仓库、40 位 commit/tag 与来源记录；
- 许可证义务明确并进入 Release/SBOM/THIRD_PARTY_NOTICES；
- 上游关键测试保留或等效覆盖；
- Windows 真实数据与真实账号验证；
- 离线、断网、崩溃、重启、重复事件、迟到事件测试；
- 不吞错、不伪造成功；
- 升级和回滚可执行；
- upstream patch 尽量小、可重放、可重新基于新上游验证；
- UI 具有 loading、empty、offline、error、recovery、permission-denied；
- 关键外部动作默认可确认、可撤销或有明确不可撤销提示；
- 100%、125%、150%、200% DPI 与键盘基本可用；
- AI route、prompt、Journey、VoiceProfile、Visual workflow 均有版本和回归证据。

额外专项门禁：

### 通信

- bridge capability matrix；
- history/backfill；
- edit/delete/reaction/read receipt；
- reconnect；
- media；
- 多账号；
- 平台特有能力不被静默丢弃。

### Goal Brain

- 跑题后恢复 Journey；
- 不重复已完成问题；
- 条件跳转；
- 目标完成即停止推动；
- 用户改目标立即生效。

### Voice

- 本人授权声音；
- speaker similarity benchmark；
- 多语言自然度；
- 平台音频兼容；
- 生成/发送失败明确反馈。

### Visual

- real-first；
- 身份一致性 benchmark；
- 真实/生成 provenance 不混淆；
- 季节/时间/地点上下文必须来自用户输入或已授权数据；
- 依赖实时真实性的场景不自动使用合成图。

### Learning / Routing

- 离线评测；
- shadow 对比；
- prompt/Journey/routing 回归；
- 成本、延迟、接受率、修改距离、目标达成率可比较；
- 失败可回滚到上一个稳定版本。

## 16. 与旧计划的冲突处理

本 V2 明确取代以下旧架构硬要求：

- “Yance 必须保持唯一产品与数据权威”；
- “必须自建唯一 ChannelDriver”；
- “必须自建 CanonicalAccount/Contact/Conversation/Message 等统一事实层”；
- “Chatwoot 必须是唯一 Product Shell”；
- “所有渠道和模型调用必须先完成 Yance 自研 WP-B DurableTask/Outbox”；
- “外部成熟产品只能作为行为合同、不得成为实际状态权威”的一般性限制。

以下旧原则继续有效：

- 禁止临时绕过；
- 必须底层修复；
- 失败测试先行；
- 不强推、不改写历史、不弱化门禁；
- 精确上游 commit 与来源治理；
- 独立工作包、授权、PR、receipt、exact-Head 复验；
- 用户设置、主题、提示音和真实数据迁移不得无证据回归。

## 17. 计划维护协议

- 固定分支：`project-state/active-handoff`；
- 最高稳定文件：`YANCE_IMPLEMENTATION_MASTER_PLAN.md`；
- `START_HERE.md` 必须明确本文件为最高稳定架构指令；
- `PROJECT_CONTINUATION.md` 只记录当前精确状态、阻塞和下一步，不得反向覆盖本文件的稳定架构；
- 旧专题计划在与本文件冲突时自动降级为历史/局部参考；
- 总范围调整通过普通新提交，不 amend、不 rebase、不 force push；
- 具体落地仍需各自来源凭据、路径清单、RED/GREEN、receipt 与精确 Head 证据。

## 18. 当前立即行动

1. 不污染当前已授权精确 Head，先完成正在进行的 OSS-A/治理/发布链收口；
2. 为 V2 建立首批上游冻结矩阵：Matrix/Synapse、Element、mautrix、Letta、Graphiti、Parlant、LiteLLM、RouteLLM、Langfuse、DSPy、Promptfoo、CosyVoice、Immich、ComfyUI；
3. 对每个上游固定精确 commit、许可证、运行方式、可移植模块、上游测试与 Windows 可运行性；
4. 新工作包优先打通 `Matrix + Element + WhatsApp bridge + Letta + Parlant + LiteLLM` 第一真实闭环；
5. 同时准备 VoiceProfile P0：CosyVoice 与第二候选的真实多语言 speaker-similarity benchmark；
6. 同时准备 Visual P0：Immich 真实照片检索；生成链在 real-first 闭环后接入 ComfyUI/PhotoMaker/InstantID/PuLID；
7. 第一闭环稳定后并行扩展 Telegram、Signal、Meta、Google Messages、Graphiti、DSPy/Promptfoo、Dating Journey Packs、LINE/Kakao/iMessage Companion；
8. 以后任何新功能先查成熟 OSS；没有“无成熟 OSS 证据”，不得转入自研。
