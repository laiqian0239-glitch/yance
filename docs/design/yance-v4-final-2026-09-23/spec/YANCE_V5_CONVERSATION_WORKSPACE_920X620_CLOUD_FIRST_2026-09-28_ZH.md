# 言策 V5｜Conversation Workspace 920×620 Cloud-first 设计合同

日期：2026-09-28  
状态：`REPOSITORY DESIGN AUTHORITY SUPPLEMENT / NOT RELEASE AUTHORIZATION`

本文件冻结言策小视窗 Conversation Workspace 的实施合同。它补充并在 **920×620 对话工作区** 范围内优先于 2026-09-23 v4 Conversation 母版；首页、关系世界、设置等未冲突部分继续沿用 v4 设计基线。

> 核心原则：**真实聊天永远占最大面积；全部能力保持可达；复杂能力按上下文渐进披露；成熟 owner 保留 lifecycle/state/retry/materialization authority。**

## 1. 设计目标

1. 默认真实视口为 **920×620**。
2. Conversation 内不再保留全局左侧导航；从首页进入对话后，顶部只保留“返回首页”。
3. 真实 Element timeline / composer / send 为唯一消息权威，Yance 只做 Product projection 与上下文能力入口。
4. 原文是聊天事实主层，中文译文是理解辅层；双方消息都保持双语可见。
5. AI 回复能力从“给几条文案”升级为 **Next Interaction Brain**：判断此刻最合适的互动方式（文字 / 语音 / 场景照片 / 视频素材 / 暂缓等），再调用成熟能力。
6. TTS、图片生成/编辑、视频生成采用 **Cloud-first** 目标架构，不能把 Windows 本地 GPU、Python runtime、模型下载作为 Release 必备前置。
7. 本地 CosyVoice / ComfyUI 后续只允许成为**用户明确选择的 Offline Mode**；禁止 silent fallback、双 owner 竞争和 Yance 自研媒体模型路由器。

## 2. Window Contract

| 项目 | 强制规格 |
|---|---|
| 默认真实视口 | 920×620 |
| Conversation 全局左导航 | 禁止 |
| 返回首页 | 顶部栏左侧 |
| 联系人列 | 默认 190–205px，可折叠 |
| 真正聊天区 | 占全部剩余宽度 |
| 常驻右栏 | 禁止 |
| 闺蜜大脑 | Overlay / Drawer |
| 页面整体纵向滚动 | 不依赖 |
| Timeline | 自身滚动 |
| Drawer / Popover | 自身滚动 |
| Composer | 始终可见 |
| Windows scaling | 100% / 125% / 150% 必须验收 |
| Focus Chat | 联系人列收起后聊天主区占满可用宽度 |

任何实现不得重新形成“联系人 + timeline + 常驻 AI 右栏”三列挤压结构。

## 3. 页面骨架

```text
Conversation Workspace
├─ Desktop / Product Titlebar
├─ Conversation Header
│  ├─ ← 首页
│  ├─ 当前联系人 / 平台
│  ├─ 当前 effective Persona
│  ├─ HUMAN / AI_ASSIST / AI_AUTO
│  ├─ 当前 Model Brain 状态
│  ├─ 闺蜜大脑
│  ├─ 搜索
│  └─ 平台真实支持的操作
├─ Contacts Pane (190–205px / collapsible)
│  ├─ 搜索
│  ├─ 全部 / 未读 / 关注
│  └─ 联系人列表
└─ Conversation Main
   ├─ Element Real Timeline
   │  └─ Yance bilingual projection
   ├─ Next Interaction Brain
   └─ Element Real Composer
      └─ Yance Composer Accessory
```

## 4. Header Contract

默认紧凑顺序：

```text
← 首页 | [Avatar] AL MA · WhatsApp | 人格 Vivian ▾ | AI辅助 ▾ | 模型 智能 ▾ | 🧠 闺蜜大脑 | 搜索 | 平台操作
```

### 4.1 Persona

- 显示当前联系人 + 当前 conversation 解析后的 **effective Persona**。
- Persona 数据必须来自现有 Persona authority；不得用 renderer 临时 state 伪造绑定。
- 点击可查看当前人格、切换既有合法绑定或进入人格详情。
- Character Card 导入、版本、回滚、库管理属于首页/设置高级能力，不常驻 Conversation。

### 4.2 回复模式

UI 必须绑定既有持久模式：

- `HUMAN` → 由我回复
- `AI_ASSIST` → AI辅助
- `AI_AUTO` → AI自动

AI_ASSIST 仍需人工确认最终发送。AI_AUTO 必须显示明显的 **立即接管**；人工接管后未物理发送的自动工作按现有 fail-closed authority 终止。

### 4.3 模型

默认只显示“模型 · 智能”或当前已验证模型名称。  
手动选择模型是用户产品意图，但不得创建 Yance 第二套 router；provider/fallback/retry/health 继续属于现有 LiteLLM Model Brain。

## 5. Bilingual Message Contract

外语原文是 Primary，中文译文是 Secondary，时间/状态是 Tertiary。

Incoming：

```text
I had a really long day at work.
The pressure is getting exhausting.

今天工作特别漫长，
这种压力已经让我有些疲惫了。

10:24
```

Outgoing：

```text
That sounds exhausting.
Maybe you deserve a little escape this weekend. 😉

听起来确实很累。
也许这个周末你该让自己喘口气。😉

✓✓ 10:26
```

禁止把中文译文取代原文成为唯一消息正文；禁止隐藏真实发送语言。

## 6. Next Interaction Brain

Reply Brain 在小视窗中默认只占一条紧凑区，不常驻三张大卡。

示例：

```text
✨ 言策建议
[文字 · 温柔接住]  [语音 · 7秒更自然]  [场景照片 · 今晚在家]     换一组 ›
```

候选类型可根据真实 capability 动态变化：文字、语音、照片、已有视频素材、Live、暂缓回复、邀请、继续倾听、改变话题等。

它的职责是综合当前消息、effective Persona、关系事实、记忆、Goal/Journey、平台能力与用户回复模式，判断“下一步互动方式”；它不得重新实现这些成熟 subsystem 的状态或生命周期。

## 7. 文字回复 mini-flow

点击文字建议后只展开一个小预览：

```text
外语：That sounds like a long day...
中文：听起来今天真的很累……
为什么：对方正在释放压力，此刻接住比追问更自然。

[用这条] [换一种]
```

`用这条` 只写入真实 Element composer，不直接发送；AI_AUTO 走既有自动授权链。

## 8. Cloud-first Voice Contract

目标默认链：

```text
Reply Brain final text
→ Cloud Voice Authority
→ audio preview
→ existing generated-artifact boundary
→ existing send-media-stream
→ platform send authority
```

选定实施目标：**ElevenLabs Cloud** 作为 TTS / voice-cloning 的成熟云端 owner；现有 CosyVoice 仅保留为后续显式 Offline Mode 候选，不允许 silent fallback。

Conversation 体验：

```text
[用文字]
[用我的声音说]
→ 生成中…
→ Vivian · English · 温柔自然 · 00:08
→ ▶ 预览
→ [重新生成] [发送]
```

API key 只能由 backend/Electron 安全凭据 authority 托管，renderer 不得持有 provider secret。

## 9. Cloud-first Photo / Image Edit Contract

目标默认链：

```text
current conversation
→ Yance scene intent
→ Cloud Media Authority
→ preview
→ save/import to Immich
→ existing route-bound media send
```

选定实施目标：**fal.ai Cloud** 作为图片生成/编辑的成熟云端执行 owner；现有 ComfyUI 仅保留为后续显式 Offline Mode 候选。

Yance 拥有“为什么现在适合什么场景”的 Product scene intent；不拥有模型执行、模型队列、推理生命周期或第二套媒体库。

## 10. Cloud-first Video Contract

视频生成正式进入目标能力，但只有在 Cloud Media Authority capability ready 时才可呈现为可执行功能：

```text
current conversation
→ scene recommendation
→ selected source photo / media asset
→ cloud video generation
→ provider-native queue/status
→ preview
→ Immich
→ existing media send
```

长任务状态必须投影 provider-native request/job identity；禁止 Yance 再做一套 scheduler/retry engine。云端不可用时显示明确 unavailable；不得自动切换到本地视频模型。

## 11. Composer Contract

真实 Element Composer 始终可见。Yance 只增加轻量 accessory：

```text
＋  ✨  输入消息……

中 → 对方语言
真人打字 · 自然
发送并学习 ▾

                                      发送
```

`发送并学习` 菜单必须复用现有语义：

- 发送并学习
- 仅发送
- 本次例外
- 不学习

不得另建 Learning state。

## 12. “＋” Context Media Menu

```text
照片
场景照片
语音
用我的声音说
视频
Live
文件
更多
```

其中：
- “照片”可选 Immich 已有素材。
- “场景照片”调用 Cloud Media Authority。
- “视频”只有云端视频 capability ready 时可用；否则明确 disabled / unavailable。
- “Live”继续使用现有 CyberVerse + LiveKit。
- 附件继续走 Element uploader / 成熟平台发送能力。

## 13. “✨” Current Message AI Menu

```text
生成回复
换一组
润色
翻译
改语气
更像我
少问一句
别太主动
为什么这样回
问闺蜜大脑
```

这些是当前消息动作，不是新的持久 authority。

## 14. 真人打字

UI 只投影现有 TypingStateService / platform typing semantics：

```text
真人打字 · 自然 ▾
关闭 / 轻微 / 自然 / 较慢 / 自定义…
```

禁止 renderer 自己用 setTimeout / 自定义重试模拟新的 typing lifecycle。

## 15. 闺蜜大脑 Drawer

不是常驻右栏。点击 Header 的“闺蜜大脑”后从右侧覆盖打开，并优先临时收起联系人列，避免压缩 timeline。

Tabs：

```text
关系 | 人格 | 记忆 | 目标 | 建议 | 今日
```

- 关系：当前关系阶段、趋势、下一步。
- 人格：effective Persona / Character Card 摘要。
- 记忆：当前回复真正相关的 evidence-governed memory/facts。
- 目标：Private Quest / Daily Goal。
- 建议：为什么 Reply Brain 给出当前互动策略。
- 今日：Daily Conversation Review。

关闭 Drawer 后恢复完整聊天宽度、原 timeline scroll、composer draft 和当前关系上下文。

## 16. 首页与 Conversation 边界

| 首页 / 设置管理 | Conversation 只显示当前有效状态 / 当前动作 |
|---|---|
| Persona / Character Card 库 | 当前 effective Persona |
| Model Brain / OpenRouter / 模型目录 | 当前模型 / 临时合法选择 |
| Cloud Voice 设置 / 声音库 | 当前消息“用我的声音说” |
| Immich 素材库 | 当前场景素材选择 |
| Cloud Media provider readiness | 场景照片 / 视频生成 |
| 平台账号 | 当前平台 |
| 全局自动回复策略 | 当前 HUMAN / ASSIST / AUTO |
| Learning 管理 | 发送并学习 |
| 关系世界 | 当前关系摘要 |
| 全局目标 | 当前 Private Quest / Daily Goal |
| 今日总览 | 当前人物今日复盘 |
| Provider 凭据/健康 | 仅显示“能力已就绪/不可用” |

普通 Product UI 不展示 API key、endpoint、Python runtime、GPU、ComfyUI/CosyVoice 内部名等工程控制。

## 17. Cloud-first Authority Rules

1. Voice Cloud owner 与 Local Voice owner 不得同时自动竞争。
2. Media Cloud owner 与 Local Media owner 不得同时自动竞争。
3. 默认 Cloud；Offline Mode 必须由用户明确选择。
4. Cloud 失败不得 silent fallback 到 Local。
5. Yance 不实现第二套 provider router。
6. Provider credentials 只在受信 backend/Electron 边界。
7. renderer 只接 capability/readiness、任务 intent、progress/result projection。
8. provider-native queue/job/retry 语义优先；Yance 不复制生命周期。
9. 生成结果进入现有 artifact/media authority 后，才允许进入真实发送链。
10. 所有媒体发送继续 canonical conversation route-bound。

## 18. Mature Authority Preservation

- Element / Matrix：timeline、composer、send、room/session/crypto。
- LiteLLM Model Brain：LLM provider/model physical routing、retry、health。
- Persona：现有 SillyTavern-derived parser/compile/effective scope/truth firewall。
- Memory / relationship fact：现有 Letta / Graphiti authorities。
- Goal/Journey：Parlant。
- Asset library：Immich。
- Cloud voice target：ElevenLabs。
- Cloud image/video target：fal.ai。
- Live：CyberVerse + LiveKit。
- Platform protocol：现有 WhatsApp / Telegram / mautrix-meta / Chatwoot 等成熟 owner。
- Electron：native desktop lifecycle、credential custody。

任何实现不得为了满足视觉稿新增第二 timeline、composer、send、session、router、Persona store、memory store、goal store、media library、voice engine、media model router、platform lifecycle。

## 19. Required Interaction States

至少封样并测试：

1. Normal Conversation
2. AI Assist
3. AI Auto
4. Manual Takeover
5. Reply Brain generating
6. Candidate stale on new inbound
7. Translation preparing / preview / integrity failure
8. Human typing progress / cancel / immediate send
9. Cloud voice generating / preview / regenerate / provider unavailable
10. Cloud photo generating / editing / preview / provider unavailable
11. Cloud video queued / generating / preview / failure / cancelled
12. Media save-to-Immich success/failure
13. Drawer open
14. Contacts collapsed / Focus Chat
15. Offline / degraded
16. Platform operation unsupported
17. Composer multiline
18. Empty conversation

## 20. Implementation Admission

每个 Conversation UI / Cloud capability production mutation 前必须明确回答：

- 是否仍然是 Element timeline？
- 是否仍然是 Element composer？
- 是否仍然是现有真实 send authority？
- 是否仍然由 LiteLLM 决定 LLM physical routing？
- Persona 是否来自 effective Persona authority？
- Relationship/Memory/Goal 是否仍由成熟 owner 管理？
- Cloud voice/media 是否只通过最薄 backend/main adapter？
- provider secret 是否完全不进入 renderer？
- 是否没有 silent fallback、mirror state、second scheduler、second queue？
- 这次 mutation 是否直接服务当前 frozen causal batch？

任一答案为否，mutation 不得进入 promotion。

## 21. Visual Acceptance

- 920×620 是第一 Golden。
- Conversation 内无全局左导航。
- 联系人列默认 ≤205px 且可收起。
- 无常驻 AI 右栏。
- timeline 为最大视觉主体。
- 外语原文 + 中文译文同时可读。
- composer 始终可见。
- AI 建议默认紧凑，不长期占据大块 timeline。
- Drawer 打开不永久改变 layout。
- 100% / 125% / 150% 无裁剪、重叠、caption safe-area 错误。
- raw Element generic sidebar / room info 不得成为 Product primary UI。

## 22. Release Boundary

本文件不授权立即替换当前生产 Voice/Media owner。当前 Release root 未关闭前：
- 不新增 provider dependency；
- 不改 Voice/Media production routing；
- 不改 runtime topology；
- 不让 Cloud migration 与当前 Conversation Product root 混成一个 causal batch。

Cloud-first implementation 必须在当前 root Local Closure 后以独立 Mature-Authority causal batch 执行；CI 只作为 Validator，Windows UAT 只作为 Final Proof。
