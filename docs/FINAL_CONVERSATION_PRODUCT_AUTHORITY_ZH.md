# Yance Final Conversation Product Authority Spec（ZH）

状态：DESIGN AUTHORITY FREEZE  
生效依据：GitHub Issue #1051 Controller State V5.574  
当前阶段：设计验收前；禁止据此提前进入 CI / PR / Merge / RC / UAT。

## 1. 产品唯一定位

言策不是工作/销售聊天工具，也不是“普通聊天软件 + AI 按钮”。
言策的核心是一个服务于个人情感生活、长期成长的 AI Reply Brain。

产品长期目标：
- 中文优先 UI；
- 对方使用英语、德语及其他欧美语言时，入站优先转成中文理解；
- 用户可用中文表达意图，出站转换成对方语言；
- AI 回复必须越来越像“这个具体的人”，而不是一个通用 AI；
- 回复质量同时受 Character、具体联系人、关系化学反应、记忆、目标、当前语境和长期学习共同影响；
- 暧昧、挑逗、调情、留白、吸引、边界、主动/退让属于正常关系语境，不是一个孤立的“调情模式”。

## 2. 最终产品原则

1. 聊天是真实主舞台，AI 是围绕聊天持续存在的第二层能力。
2. 能力要强，但 UI 不能像功能墙；默认安静，按上下文展开。
3. 用户最终决定自己的关系与表达；AI 可以自动，但必须有清晰授权边界。
4. 每个能力必须形成闭环，不能只有入口没有后续消费。
5. Mature Authority First；禁止 Yance 重新拥有成熟 subsystem 的 lifecycle / state / retry / recovery / routing。
## 3. Conversation Intelligence 主闭环

```text
对方真实消息
  ↓
Element / Matrix / Bridge
  ↓
入站语言识别与中文理解
  ↓
Person + Relationship + Memory + Goal + Current Context
  ↓
SillyTavern Character Card / Persona Composition
  ↓
Reply Director 判断本轮关系策略
  ↓
功能绑定的模型 / reasoning preference
  ↓
成熟 Model Brain / LiteLLM / OpenRouter
  ↓
候选回复（中文理解 + 对方语言真实文本）
  ↓
HUMAN / AI_ASSIST / AI_AUTO
  ↓
Element Composer / Send
  ↓
对方真实反馈、回复速度、关系变化
  ↓
Learning Signal
  ↓
L1 → L2 → L3 / Persona / Learned Policy
  ↓
下一轮 Reply Brain 真正消费
```

任何一环没有被下一环消费，都不能声明“功能闭环”。

## 4. Persona / Character Authority

### 4.1 Mature Owner
Persona / Character composition 以已 vendored 的 SillyTavern Character Card / Prompt Composition 为成熟 owner。

已存在证据：
- `vendor/sillytavern/1.18.0`
- Character Card parser / validator
- chara_card_v2 / v3
- prompt composition core
- `backend/personaBrain/sillyTavernAdapter.js`
- `backend/personaBrain/compiler.js`

禁止将其降级为 Yance 自研的平面 persona prompt。
### 4.2 “个性”不等于“回复风格”

真正人格必须至少由以下内容共同构成：
- Description：身份、生活、价值观、气质、背景；
- Personality：稳定人格结构；
- Scenario：当前关系/场景；
- Character Note：长期或按深度注入的行为约束；
- Example Dialogues：真实“我会怎么说”的语言证据；
- Character Book / World Info：按当前话题动态激活的人格背景。

“成熟、自然、幽默、调皮、暧昧、主动、高冷”等只能作为动态 style overlay，
不能替代 Character Card。

### 4.3 Scoped Persona

人格必须支持：
- Owner / Global Character：稳定的“我是谁”；
- Contact scoped Persona：面对某个具体联系人自然呈现的那一面；
- Conversation scoped Persona：特定阶段/会话的局部覆盖。

核心人格不能因为联系人不同而被复制成多个互相矛盾的“我”。

### 4.4 Relationship Chemistry

每个联系人都应形成独立的关系化学反应：
- 对方如何回应挑逗；
- 什么幽默有效；
- 什么时候应该主动；
- 什么时候应该收一点；
- 哪种表达会让对方更投入或降温；
- 哪些边界不能碰。

它来自真实互动和学习，不来自静态标签。
## 5. Learning / Growth：A → A+

言策的目标不是“基础模型 A”，而是：
`A + Character + Person Memory + Relationship Learning + Goals + Outcome Learning = A+`

### 5.1 L1：单次回复学习
记录：
- adopted / rejected / revised；
- shorter / direct / natural / gentle / flirtier / no_question 等显式修改；
- 本次模型、strategy、target language、Persona version；
- 对方是否继续回复、回复延迟、conversation 是否延续。

### 5.2 L2：联系人 / 关系级学习
积累某个联系人特有的互动规律与关系化学反应，并进入下一轮上下文。

### 5.3 L3：Owner Persona 长期学习
当相同修正持续出现时，形成对主人格/Example Dialogues/长期表达方式的有证据提案。

### 5.4 Reply Brain Chat
必须恢复为正式产品能力，而不是表单式 Learning Coach：

用户可以直接告诉 Reply Brain：
“这句话不像我。”
“对这个人不要这么正式。”
“这种情况下我会更暧昧一点。”
“我不会这样夸男人。”

Reply Brain 必须判断此次反馈属于：
- 只这一次；
- 只对这个联系人；
- 某一类关系；
- Owner Persona 长期规则。

学习结果必须真正进入后续回复，而不是只生成一条建议。
## 6. Model / OpenRouter / LiteLLM Authority

### 6.1 Mature Owner Boundary
- OpenRouter：模型目录、provider 元数据、模型能力、reasoning 支持；
- LiteLLM / mature Model Brain：物理 model selection、routing、retry、provider fallback、runtime lifecycle；
- Yance：只保留“某个产品能力绑定 Auto 或哪个 model id / reasoning preference”的最薄产品配置。

### 6.2 禁止继续 Yance Router
禁止新增任何依赖到以下 legacy Shadow Router：
- `replyChampionAuthority.js`
- `aiRouteResolutionAuthority.js`
- `aiBrainRoleLifecycleAuthority.js`
- `modelPoolSegmentationAuthority.js`
- `aiWorkloadPlacementAuthority.js`
- `modelRoutingIntegrityService.js`
- `modelServiceTaskRoutingAuthority.js`
- 任何同类 Yance-owned ranking / qualification / fallback / retry authority

后续授权 cleanup 目标：
- production refs = 0；
- persisted primary/fallback routes = 0；
- Yance model scoring/ranking = 0；
- Yance provider retry/fallback = 0；
- Yance champion election = 0。

### 6.3 功能绑定模型
每个 logical capability 可有自己的模型绑定：
quick_reply / deep_reply / director / relationship / translation /
understanding / summary / fact_extraction / memory_extraction /
persona_rewrite / media_analysis / speech_transcription 等。

手动选择是用户配置，不是 Yance model admission。
### 6.4 Reasoning Level
仅投影成熟 provider / model 实际支持的 reasoning 能力。
UI 可产品化为：
关闭 / 最小 / 低 / 中 / 高 / 极高。

禁止 Yance 给模型做自研 S/A/B 评级或自行判断“允许/禁止使用”。

### 6.5 Execution Receipt
每次 AI Reply 应可追溯：
- logical capability；
- selected model；
- reasoning setting；
- Persona / Character version；
- Relationship context version；
- strategy；
- target language；
- outcome / learning signal。

这样才能区分：
是模型变好，还是 Persona、Prompt、Relationship Context 变好。

## 7. Media / Photo Mature Authority

### 7.1 原始素材
原始照片/视频 authority = 本机文件系统。
Yance 只允许选择一个或多个素材根目录，不复制出第二份“真相库”。

### 7.2 Media Library
Immich = 媒体库成熟 owner：
- asset lifecycle；
- search；
- people / face；
- albums；
- thumbnails；
- metadata；
- smart search / semantic search；
- folder/external library。

Yance 只投影 Immich 结果和 assetId。

### 7.3 生成 / 编辑
ComfyUI = 图片生成与编辑 mature owner。
Yance 只选择：
- workflow；
- reference asset；
- prompt intent；
- 当前 conversation target。

禁止 Yance 自建 media-index / thumbnail cache / face DB / file watcher / duplicate authority。
## 8. Voice Mature Authority

### 8.1 原始声音
原始 voice samples authority = 本机文件系统 / 用户选择的 Voice Library 目录。

### 8.2 ASR
SenseVoice = 语音识别 mature owner。

### 8.3 Voice Clone / TTS
CosyVoice = voice clone / speaker / TTS mature owner。

Yance 只负责：
- 选择 voice profile；
- 传入当前回复文本；
- 预览；
- 交给真实聊天发送链。

### 8.4 Shadow Voice Library Retirement
当前 `electron/voiceBrainRuntime.js` 自建：
- `voice-brain/profiles/<id>/profile.json`
- `prompt.wav`
- Yance list/delete profile lifecycle

该部分属于后续 authority cleanup 的 retirement candidate。
禁止继续扩展成 Yance-owned Voice Library。

## 9. Real Chat Mature Authority

Element / Matrix / mature bridges 永远保留：
- account/session；
- crypto；
- room membership；
- timeline；
- composer；
- send；
- retry/recovery；
- platform delivery。

Yance 不实现第二套 chat client、第二套 send、第二套 session。
## 10. Final Conversation UX Architecture

生产结构固定为：

1. App Rail
2. Conversation / People List
3. Chat Canvas（绝对主区域）
4. AI Reply Dock（围绕 composer，状态驱动）
5. Intelligence Inspector（按需打开）

### 10.1 Chat Header
常驻信息：
- 联系人姓名 / 头像；
- 当前平台 / 当前账号；
- AI mode：本人回复 / AI辅助 / AI自动；
- 搜索 / 信息 / 更多。

禁止常驻大 Hero、重复人物介绍、工程状态。

### 10.2 AI Reply Dock
状态驱动：
- idle：一行“AI 已理解当前上下文”；
- peer typing：AI 暂缓生成；
- new message：展开 1–3 个候选；
- user typing：切换润色/翻译辅助；
- AI_AUTO：显示自动处理状态与授权范围；
- stale context：旧建议自动标记失效。

候选应体现不同关系策略，而不是同一句的同义改写。

### 10.3 Intelligence Inspector
一级 Tab：
- AI
- 关系
- 记忆
- 目标

默认收起；展开时只显示当前最重要的信息。
### 10.4 AI Tab
展示：
- 当前 reply goal；
- current strategy；
- 当前 Character / scoped Persona；
- model binding（简化产品表达）；
- 为什么这次建议这样回复；
- “与回复大脑聊天”入口。

### 10.5 关系 Tab
展示：
- relationship stage；
- momentum；
- timeline；
- chemistry；
- next step；
- “这个判断不对”纠错入口。

### 10.6 记忆 Tab
展示：
- confirmed facts；
- recurring interests；
- open loops；
- promises；
- boundaries；
- sensitive topics；
- important events。

### 10.7 目标 Tab
展示：
- Daily Chat Goal；
- long-term Relationship Goal；
- progress；
- next action；
- Daily Review / Learning suggestions。

## 11. Rich Reply Tools

必须作为 contextual tools，而不是常驻功能墙：
- 真实照片；
- Immich 素材搜索；
- AI 图片生成 / 编辑；
- Voice ASR；
- 我的声音 / Voice Clone；
- TTS；
- 翻译；
- Live Presence；
- 关系关键节点；
- reminder / follow-up。

AI 应能基于关系与语境建议“这一次更适合文字、照片、语音或组合”。
## 12. AI_AUTO

AI_AUTO 是用户授予的最高产品级自主权，但不能越过 mature owner。

允许逻辑：
理解 → 关系/记忆/目标 → Character → Director → model/tool →
生成 → 翻译 → quality check → mature send → outcome → learning。

不允许：
- 绕过 Element/Matrix 直接发送；
- 自己维护 provider retry/fallback；
- 自己维护平台 session；
- 自己伪造成功状态。

AI_AUTO 的授权边界必须清晰可见，并支持按行为类别控制。

## 13. Conversation Intelligence Closure Matrix

任何实现前必须逐项填写：

| 字段 | 必填 |
|---|---|
| Capability | 是 |
| Mature Owner | 是 |
| Model / Tool Binding | 是 |
| Input Context | 是 |
| Output | 是 |
| UI Entry | 是 |
| HUMAN / AI_ASSIST / AI_AUTO Permission | 是 |
| Learning Signal | 是 |
| Long-term Memory / Persona Effect | 是 |
| Next-turn Consumption | 是 |
| Final Materialized Proof | 是 |
| Closure Status | 是 |

只要某一能力缺“next-turn consumption”，就不是成长闭环。

## 14. 设计验收状态

当前：PENDING。

在用户明确接受 Final Conversation 设计前：
- 不进入生产实现；
- 不继续 backend authority mutation；
- 不开 CI / PR / Merge / RC / UAT；
- 只允许规范固化和设计方案收敛。

设计接受后，按本文件逐项对账执行，禁止重新退回“普通聊天软件 + AI按钮”或新增 Shadow Authority。

## 15. FINAL VISUAL ACCEPTANCE — 2026-09-20

状态：**ACCEPTED / FROZEN**。

用户已明确接受本轮最终效果图作为 Conversation 实现视觉基准。
会话内生成图标识：
- gen_id: `a81bd20e-1cd5-4152-b3ea-59aef9e64d47`
- artifact name: `暮色露台上的暧昧对话.png`

该图不是“功能展示参考”，而是后续 Production UI 的最低视觉/功能验收基准：
实现可以更好，但不得减少能力、退回网页化按钮或普通 AI Chat UI。

### 15.1 必须保留的主结构
- 左：Yance App Rail + Conversation List；
- 中：真实 Chat Canvas + 双语消息 + AI Reply Dock + Rich Reply + Composer；
- 右：AI / 关系 / 记忆 / 目标 Intelligence Inspector；
- 左右侧栏均可独立收起；
- 禁止新增多余的全宽顶栏或第二层窗口工具条。

### 15.2 会话与翻译
- 左侧 Conversation List 每个联系人显示真实头像、姓名、年龄、国籍；
- 左侧最近消息预览默认显示**翻译后的中文**，不是外语原文；
- 外语消息正文在聊天区保留原文，同时直接显示中文理解；
- 禁止出现“中文翻译”四个冗余标签字样；
- 自己与对方发送的消息都必须显示各自头像；
- 自己头像在右侧，对方头像在左侧；
- 气泡视觉采用已确认的圆润、带轻微尖角/尾部、层次清晰的桌面聊天气泡，不采用扁平网页卡片。

### 15.3 AI Reply Dock
必须保留：
- 3 个不同关系策略的回复候选；
- 每个候选的中文理解/外语真实文本；
- “更暧昧 / 更温柔 / 更简短 / 深度想想”等 contextual refinement；
- 最终入口文案：**和闺蜜大脑聊聊**；
- “换一批”；
- 采用/调整动作；
- 当前 Character / Relationship / Memory / Goal 必须真实进入生成链。

禁止把该区域退化成普通“AI 建议”按钮或单条建议。

### 15.4 Rich Reply
AI Reply Dock 下方必须继续保留并闭环：
- 从 Immich 素材库选择真实照片；
- ComfyUI 生成/编辑图片；
- CosyVoice 声音回复；
- 中文 Composer；
- 实际外语发送预览；
- mature Element / Matrix send。

不得为了视觉简洁把照片、生成/编辑、声音入口删除或迁移成难以发现的独立工程页。

### 15.5 Intelligence Inspector
右侧必须保留：
- Character / Owner Persona；
- 当前策略；
- 当前模型与 reasoning projection；
- 为什么这样回复；
- 近期/相关记忆；
- 今日/长期目标；
- 快捷关系动作；
- AI / 关系 / 记忆 / 目标 tabs。

信息可以渐进展开，但能力不可消失。

### 15.6 Desktop Visual Language
- 所有按钮必须表现为**原生桌面控制**，不能像网页 CTA/pill button 集合；
- 控件使用统一高度、圆角、边框、hover/pressed/focus 层级与图标语言；
- 降低“彩色网页按钮墙”感，强调 compact toolbar / icon button / segmented control；
- 聊天气泡是视觉主角，AI 能力次之；
- theme 必须 token-driven，不硬编码单一主题。

### 15.7 左右隐藏按钮
最终使用用户明确指定的风格：
- 小型方形桌面 icon button；
- 深色/半透明表面；
- 细描边；
- 中间为简洁的“侧栏矩形”图标；
- 左右两侧使用同一视觉组件，只通过方向/状态表达收起与展开；
- 禁止使用大箭头、K形符号、双尖括号、独立漂浮网页按钮；
- 左右按钮必须处于各自栏标题区域，不产生多余顶栏。

### 15.8 禁止退化
后续任何实现或视觉优化都不得删除：
Character Card、Reply Brain Chat、模型绑定、reasoning、Why this reply、Memory、Goals、
中文入站理解、中文输入→外语发送、Immich、ComfyUI、CosyVoice、AI_AUTO、Learning loop。
