# 言策 V5｜Capability × Authority × UI Scope Matrix

日期：2026-09-28  
状态：`DESIGN AUTHORITY MATRIX / NOT PRODUCTION AUTHORIZATION`

本矩阵用于防止后续实现“功能存在但入口错误”“为了视觉稿重造成熟能力”“全局功能塞进 Conversation”“本地 runtime 变成 Release 阻断”等问题。

## 1. Scope 词汇

- `GLOBAL`：全局默认 / 资产 / 账号 / provider 管理。
- `ACCOUNT`：平台账号级。
- `PERSONA`：Persona / Character Card 级。
- `CONTACT`：联系人级。
- `RELATIONSHIP`：关系级。
- `CONVERSATION`：具体会话级。
- `MESSAGE`：当前消息级。
- `SCENE`：当前聊天场景级。

## 2. Capability Matrix

| 能力 | 当前/目标成熟 Owner | Scope | Conversation 表现 | 首页/设置表现 | 设计规则 |
|---|---|---|---|---|---|
| 真实 timeline | Element / Matrix | CONVERSATION | 永远可见，最大面积 | 无 | 禁止第二 timeline |
| 真实 composer | Element | MESSAGE | 永远可见 | 无 | Yance 仅 accessory |
| 最终 send | Element + platform authority | MESSAGE | 发送按钮 / send state | 无 | 禁止 shadow send |
| Matrix session / crypto | Element / Matrix | ACCOUNT | 不暴露内部实现 | 安全/会话入口 | Yance 不拥有 |
| 联系人列表 | Yance Product projection | CONTACT | 190–205px，可折叠 | 首页 People | Conversation 内不是第二主导航 |
| 返回首页 | Yance navigation | CONVERSATION | Header 左侧 | — | 不保留全局 rail |
| Incoming 原文 | Element event truth | MESSAGE | Primary | — | 不得被译文替代 |
| 中文译文 | existing translation authority | MESSAGE | Secondary | 搜索/翻译管理 | 只做 projection |
| Outbound 翻译 | existing prepare-only translation authority | MESSAGE | Composer 发送前状态/预览 | 默认语言策略 | 失败 fail closed |
| 双语搜索 | existing workspace search/translation | GLOBAL/CONTACT | 顶部搜索轻入口 | 可在首页搜索 | 原文/中文都可匹配 |
| HUMAN | existing durable conversation automation | CONVERSATION | 一级模式 chip | 默认策略 | 用户完全手动 |
| AI_ASSIST | existing durable conversation automation | CONVERSATION | 一级模式 chip | 默认策略 | 最终发送需人工确认 |
| AI_AUTO | existing durable conversation automation | CONVERSATION | 一级模式 chip + 立即接管 | 自动化规则 | durable receipt + fail closed |
| 人工接管 | existing Store/Outbox authority | CONVERSATION | AI_AUTO 时显著按钮 | — | 不得仅视觉切换 |
| Reply Brain quick/deep/director | existing Reply Brain + LiteLLM | MESSAGE/SCENE | Next Interaction Brain | AI 工作台 | 不重建 reply engine |
| 候选回复 3→5 | existing Reply Brain UX contract | MESSAGE | 3 个紧凑入口，可展开 5 | — | 候选不直接发送 |
| 为什么这样回 | Reply Brain reason/strategy projection | MESSAGE | 按需展开 | AI 工作台 | 默认折叠 |
| 风格调节 | existing director/persona strategy | MESSAGE | ✨ 菜单 | 默认风格 | 单轮调整 ≠ Persona 永久修改 |
| Model Brain | LiteLLM | GLOBAL/MESSAGE | “模型·智能”轻量状态 | 模型管理 | Yance 不做第二 router |
| OpenRouter | existing model provider path under Model Brain | GLOBAL | 当前模型/合法临时选择 | provider 管理 | 手动选择不等于自行路由 |
| 本地模型 | existing adaptive local runtime | GLOBAL | 仅显示合法状态 | 高级设置 | 非 Release 必备 |
| Persona / Character Card | existing SillyTavern-derived Persona authority | PERSONA | current effective Persona | Persona 库 / 导入 / 版本 | contact/conversation scope |
| Persona truth firewall | existing Persona authority | PERSONA/MESSAGE | 不常驻；阻断时解释 | Persona 管理 | 不得绕过 |
| Relationship intelligence | existing relationship authority | RELATIONSHIP | Drawer 摘要 / Reply Brain context | 关系世界 | 不复制 store |
| Memory | Letta / existing memory projection | CONTACT/RELATIONSHIP | Drawer“记忆”按需 | 数据/隐私/学习 | 只用 evidence-governed facts |
| Temporal relationship facts | Graphiti / existing projection | RELATIONSHIP | Drawer“关系/记忆” | 关系世界 | 不建立 mirror graph |
| Private Quest | Parlant relationship goal/journey | RELATIONSHIP | Drawer“目标” | 关系世界 | 不复制 planner |
| Daily Chat Goal | Parlant | RELATIONSHIP | 当前状态轻投影 | 今日/关系世界 | 与 Private Quest 分离 |
| Daily Conversation Review | existing workspace authority | CONTACT | Drawer“今日” | 首页今日总览 | 必须真实 current-local-day |
| 学习模式 | existing learning authority | MESSAGE | 发送并学习菜单 | Learning 管理 | 真实发送成功后才学习 |
| send_and_learn | existing learning authority | MESSAGE | Composer 菜单 | 默认策略 | success 后学习 |
| send_only | existing learning authority | MESSAGE | Composer 菜单 | 默认策略 | 必须阻止学习 |
| exception | existing learning authority | MESSAGE | Composer 菜单 | — | 本轮例外 |
| do_not_learn | existing learning authority | MESSAGE/GLOBAL | 菜单/状态 | 数据隐私 | 不允许假开关 |
| 真人打字 | TypingStateService + platform semantics | MESSAGE | “真人打字·自然” | 默认档位 | renderer 不自建 timer |
| 平台 typing/presence | mature platform adapters | ACCOUNT/MESSAGE | 状态投影 | 平台账号 | capability gated |
| 媒体资产库 | Immich | GLOBAL/SCENE | 选择已有照片/视频 | 素材库管理 | 禁止第二媒体库 |
| 图片生成 | **Target: fal.ai Cloud** | SCENE | 场景照片 mini-flow | provider readiness | Cloud-first |
| 图片编辑 | **Target: fal.ai Cloud** | SCENE | 当前素材编辑 | provider readiness | Cloud-first |
| 本地图片生成 | current ComfyUI | GLOBAL/SCENE | Offline Mode 明确选择后才出现 | 高级设置 | 禁止 silent fallback |
| 视频素材发送 | Immich + existing media send | SCENE | ＋菜单“视频” | 素材库 | 已有资产可发 |
| 视频生成 | **Target: fal.ai Cloud** | SCENE | capability ready 才启用 | provider readiness | provider-native queue |
| TTS | **Target: ElevenLabs Cloud** | MESSAGE | “用我的声音说” | Voice provider readiness | Cloud-first |
| Voice clone | **Target: ElevenLabs Cloud** | GLOBAL/MESSAGE | 当前 voice identity | 声音库 | secret/server-side |
| 本地 TTS | current CosyVoice | GLOBAL/MESSAGE | Offline Mode 明确选择后 | 高级设置 | 非自动 fallback |
| ASR | current SenseVoice | MESSAGE | 收到语音→转写/理解 | Voice 设置 | 当前可保留本地 |
| Voice preview/regenerate | Voice owner + Product projection | MESSAGE | mini-flow | 声音管理 | 不建 Voice outbox |
| Voice send | existing send-media-stream | MESSAGE | Preview 后发送 | — | Voice 不拥有 send |
| Live | CyberVerse + LiveKit | RELATIONSHIP/SCENE | ＋菜单 / Overlay | readiness | 不升级为一级页面 |
| 相机/麦克风 | LiveKit / platform/native | SCENE | Live Overlay | 设置 | capability truth |
| Generic attachment | Element uploader | MESSAGE | ＋菜单“文件” | — | MediaWorkspace 不替换 uploader |
| 平台账号 | WhatsApp/Telegram/mautrix-meta/Chatwoot etc. | ACCOUNT | 当前平台状态 | 首页平台管理 | 真实 capability gating |
| Facebook Personal Messenger | mautrix-meta | ACCOUNT | 当前平台 | 账号管理 | 不自研 protocol |
| Facebook Page | Chatwoot | ACCOUNT | 当前平台 | 账号管理 | retired Worker OAuth 不复活 |
| WhatsApp | mature WhatsApp bridge | ACCOUNT | 当前平台 | 账号管理 | 不自研 protocol |
| Telegram | mature Telegram bridge | ACCOUNT | 当前平台 | 账号管理 | 不自研 protocol |
| 群聊 | canonical conversation projection | CONVERSATION | secondary lane | People | 不伪造 Person Relationship |
| 通知 | existing Yance/Electron authority | GLOBAL | 轻提示 | 设置 | 单一通知 authority |
| Tray / startup / close / update | Electron | GLOBAL | 不占 Conversation | 设置 | native lifecycle owner |
| 主题 / 29 themes / 字体 | existing appearance authority | GLOBAL | 主题 tokens 生效 | 设置 | 禁止硬编码主题色 |
| 数据备份/恢复/迁移 | existing data authority | GLOBAL | 不常驻 | 数据/隐私 | Conversation 不做管理员面板 |
| export/archive/merge/undo/correction/notes/key moments | existing Product/Data authorities | CONTACT/RELATIONSHIP | Drawer 深层入口 | 关系世界/数据 | 不挤主聊天 |

## 3. Progressive Disclosure Levels

### L1 永远可见
- 当前联系人 / 平台
- effective Persona
- HUMAN / AI_ASSIST / AI_AUTO
- Model Brain 当前状态
- timeline
- 外语原文 + 中文译文
- Composer
- 真人打字状态
- 发送学习状态

### L2 轻量可见
- Next Interaction Brain 3 个建议入口
- 翻译目标语言
- AI AUTO 立即接管
- 搜索
- 当前平台真实可用操作

### L3 点击展开
- 5 条候选
- 为什么这样回
- 语气/风格
- Voice preview
- Photo/Video preview
- Model 临时合法选择
- 闺蜜大脑 Drawer

### L4 首页/设置
- Persona/Character Card 完整管理
- OpenRouter / provider / 模型目录
- ElevenLabs / fal.ai credential/readiness
- Immich 素材库管理
- Offline Mode
- Learning 管理
- 平台账号管理
- 数据/隐私/备份/恢复
- 高级系统支持

## 4. Cloud-first 规则

### Voice
默认：ElevenLabs Cloud。  
Local CosyVoice 只有用户显式选择 Offline Mode 后才能成为当前执行 owner。

### Image / Video
默认：fal.ai Cloud。  
Local ComfyUI 只有用户显式选择 Offline Mode 后才能成为当前执行 owner。

### 禁止
- Cloud failure → Local 自动 fallback。
- renderer 决定 provider。
- renderer 保存 API key。
- Yance 创建第二 provider health/retry/router。
- 两套生成任务同时竞争同一个 Product intent。
- Cloud 与 Local 生成结果绕过 Immich / existing artifact/send boundary。

## 5. Capability Readiness UI

普通用户只应看到：

```text
AI模型        已就绪
声音          已就绪
照片生成      已就绪
视频生成      已就绪 / 暂不可用
实时陪伴      已就绪
```

高级设置才显示 provider 技术信息。Provider 不可用时应透明显示“暂不可用”，不得伪装成功或静默切换 owner。

## 6. Missing / Target Gaps

以下是**目标能力缺口**，不是当前已完成生产能力：

1. ElevenLabs Cloud adapter / credential / readiness / TTS+clone production chain。
2. fal.ai Cloud image generate/edit production chain。
3. fal.ai Cloud video generation production chain。
4. Cloud-generated output → existing artifact/Immich → real send 的完整 materialized proof。
5. Cloud provider unavailable / timeout / cancel / credential invalid 的 Product 状态。
6. Offline Mode 明确切换与“no silent fallback” proof。
7. 920×620 新 Golden 与全部交互状态封样。

这些 gap 必须在当前 Release root closure 之后以独立 causal batch 处理，不得偷偷混入当前 Conversation UI root。
