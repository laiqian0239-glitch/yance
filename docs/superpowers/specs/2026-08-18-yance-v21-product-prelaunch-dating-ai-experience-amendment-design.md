# Yance V2.1 上线前交友 AI 体验闭环 Amendment 设计

- 日期：2026-08-18
- 设计分支：`design/v21-product-prelaunch-dating-ai-experience-amendment`
- 设计基线：`main@ca48fc7b365084089de5060469c913d6fb0339f1`
- 状态：产品方向已由 owner 批准；本文件只定义设计与后续治理边界，不授予生产代码实施权限
- 适用产品：Yance / 言策桌面端

## 0. 决策

言策的上线定位不是 CRM、营销、销售自动化、客服自动化或增长后台，而是一个面向德国及欧洲成熟男性用户的、关系优先的私人交友沟通产品。

核心产品价值是 **AI 回复大脑**：

1. 普通聊天首先仍然是人与人之间的私人聊天；
2. AI 回复大脑理解当前联系人、当前关系、历史对话、Persona、人设事实、语言、学习结果、当地时间语义与模型运行状态；
3. 人工模式默认存在并保持稳定；
4. AI 自动代聊默认关闭，只能由用户对某一个联系人显式开启；
5. 开启后只处理该联系人的新入站消息，沿用同一套 Reply Brain、Persona、Learning、Model Brain、Outbox、Typing 与 Send Queue authority；
6. P0 不允许自动陌生开场、不允许定时主动骚扰、不允许把现有 `proactiveAutomationEnabled` 偷偷打开；
7. 用户随时关闭后立即恢复人工模式；
8. UI 必须中文优先、关系优先、安静、私人，不得出现营销漏斗、Lead、Conversion、Campaign、CRM 等视觉或文案语言；
9. 普通用户界面不得暴露 Letta、Graphiti、Langfuse、DSPy、LiteLLM、Promptfoo 等内部技术栈名称；
10. 所有用户可见外语必须有中文理解或中文说明，聊天原文必须保留，中文翻译不得覆盖或篡改真正发送的外语正文；
11. 字体大小与主题风格必须成为真正全局设置，覆盖 Yance Product Shell、Element 托管界面和所有上线 overlay/workspace，而不是只覆盖历史 `frontend/`；
12. 时间语义是 Reply Brain 的生产上下文，不得让模型凭感觉猜“现在是早上还是下午”；
13. 自动代聊不能通过“秒已读 + 秒输入 + 秒回复”暴露机器行为，平台可见 read/composing 必须遵守同一套人类化节奏策略。

本 Amendment 正式修改旧 Product Experience Shell P0 的一项产品边界：

> 旧规则“禁止 autonomous sending”被替换为“默认关闭、按联系人显式授权、仅响应式自动回复、随时撤销、沿用现有安全与发送 authority”。

其他“不创建第二消息引擎、不创建第二 AI runtime、不绕过 send authority、不自动修改事实”的旧边界继续有效。

---

## 1. 当前 trusted-main 审计事实

设计基线 `ca48fc7b...` 已证明：

### 1.1 已有成熟能力，禁止重做

- Element / Matrix 已是消息、房间、timeline 与 composer authority；
- `contextAwareReplyBrain` 已有真实候选生成、导演策略、Persona、语言、模型执行、质量校验、repair、中文理解与 stale-context fencing；
- Model Brain 已由 LiteLLM 持有真实 provider/model routing，Yance 只保留资格、编排、证据与 readiness；
- Learning Brain 已有 evidence → evaluation → candidate artifact → approval/promotion → runtime consumption → rollback 的后端闭环；
- Persona Brain 已有 truth firewall、动态 reply style、learned runtime、所在地 `timezone` 字段；
- 联系人 social context 已有 `customer.timezone`、关系状态、互动偏好、历史消息和反馈学习；
- `aiReplyOutboxService` 已经持有候选到真实 send queue 的生产路径；
- `typingStateService` 已经实现自然阅读/输入节奏、`composing/paused`、新消息取消、人工输入取消、账号变化取消、上下文过期重验；
- #478 已建立 active-room → bridge identity → canonical conversation route 的可信产品路由边界，selected relationship 不能替代真实 route authority。

### 1.2 当前真实上线缺口

- Product Shell 的普通聊天入口没有把 Reply Candidate 生成/审阅完整接到当前 Element 产品面；
- `aiReplyOutboxService.status()` 当前固定 `manualApprovalRequired: true`、`automaticSendEnabled: false`，不存在按联系人授权的自动代聊；
- 旧 Product Shell 设计明确禁止 autonomous sending，与 owner 当前产品要求冲突；
- Persona 与联系人数据模型虽然已有 timezone，但 Reply Brain 当前生成上下文没有可靠注入“当前 UTC、人设当地时间/日段、联系人当地时间/日段、消息时差”；
- Product Shell / Learning / Media / Voice 等当前用户可见区域仍有英文标签或工程术语；
- 现有 theme / typography audit 主要覆盖历史 `frontend/`，不能证明当前 `integration/element-module` Product Shell 已被全局字体和主题 authority 覆盖；
- Learning Workspace 期望产品桥调用，但 current Electron preload/main 未证明完整暴露 `getLearningWorkspaceSnapshot` / `invokeLearningCoachAction` 对应 production bridge；
- Model Brain 后端 routing/readiness 已有真实 authority，但当前产品面缺少足够清楚的用户可理解 readiness 投影。

因此上线前不能把“后端有代码”当成“产品闭环”。

---

## 2. 非回归 authority

后续实现必须复用这些唯一 authority：

- 消息/timeline/composer：Element / Matrix；
- Reply Brain：现有 `contextAwareReplyBrain`；
- Persona：现有 Persona Brain / truth firewall；
- 联系人关系与偏好：现有 Store social context / interaction policy；
- 模型路由：现有 Model Brain + LiteLLM；
- 学习：现有 Learning Brain 与 approved OSS stack；
- 中文理解/翻译：现有 translation / bilingual understanding authority；
- AI 候选外发：现有 Outbox + Send Queue；
- 人类化输入状态：现有 TypingStateService；
- 平台 read/receipt/presence：现有平台 capability / messaging authority；
- 真实平台发送：现有平台 adapter / send authority；
- Product Shell：现有 Element module ProductExperienceShell；
- Theme：现有 Yance theme/appearance authority 与 Element 自身主题能力；
- 字体：一个全局 typography authority，不创建 Product Shell 私有字号系统。

禁止新增：

- `AutoReplyService` 第二回复引擎；
- 第二模型 router；
- 第二 Learning engine；
- 第二 send queue；
- 第二 typing delay runtime；
- 第二 read-receipt runtime；
- Product Shell 私有 theme registry；
- Product Shell 私有 typography registry；
- 独立 CRM/customer automation dashboard；
- 通过 localStorage 保存会影响生产发送授权的 per-contact 自动代聊权限。

---

## 3. 工作包分解

这次上线体验闭环拆成三个实施工作包。三者共享本设计，但独立授权、failure-first 与验证。

### WP-1：中文 / 全局字号 / 全局主题体验闭环

目标：让用户看到的言策真正像一个中文私人交友产品，而不是中英混杂的工程控制台。

必须完成：

- 普通产品导航、按钮、状态、空态、错误信息、设置项以中文为主；
- 外语聊天原文保留，同时显示中文理解；
- AI 候选显示“实际发送文本 + 中文意思”；
- 技术 error code 可保留为次级诊断信息，但必须先显示中文用户说明；
- 普通界面隐藏内部 OSS/模型/运行时名称；
- 全局字号默认 100%，允许用户在 **85%–150%** 范围内连续调节，步进 **1%**；
- 字号设置持久化后覆盖 Element 主界面、Product Shell、Media、Voice、Learning、搜索/翻译、弹窗、抽屉、toast 与设置页；
- 不允许局部组件继续硬编码形成无法随全局字号缩放的正文/标题层级；
- Theme 切换必须覆盖同样的全部上线表面；
- Product Shell 的颜色、对比度、surface、focus、status 等只能消费语义 token，不得再形成独立 palette；
- 若 Element public module API 不足以承载全局 appearance/typography，允许通过正式授权的最小 replayable upstream patch 暴露必要 seam，但不得 fork 一套主题引擎。

UI 风格：私人、安静、关系优先；不用 CRM 卡片墙、销售漏斗、KPI 仪表盘；不把技术 runtime 状态当首页主视觉。

### WP-2：Reply Brain 产品接线 + per-contact AI 代聊 + 时间语义 + Model readiness

目标：把“AI 回复大脑”真正变成上线产品核心，而不是只存在于后端。

必须完成：

- 当前关系页能生成/查看/使用 Reply Candidate；
- 当前关系页有清晰的 `AI 代聊` 开关；
- 开关默认关闭；
- 状态是 per-contact durable policy，不是全局开关；
- 开启时明确显示“仅为这个联系人自动回复”；
- 关闭立即阻止后续自动发送；
- 自动代聊只响应新入站消息，不主动陌生开场、不定时追问、不自动恢复历史旧未答消息；
- 每条自动回复仍经过 Reply Brain、Persona truth firewall、Language authority、Learning policy、Model Brain、质量门禁、temporal gate、stale-context fence、Outbox、Typing、Send Queue；
- 新消息在生成期间到达时，旧生成取消，基于最新 turn 重新生成；
- 用户开始真实键盘输入时，待发送自动回复取消，本轮交还人工；
- 用户手动发送消息后，AI 代聊开关仍保持原状态，但人工消息成为后续风格连续性的高价值证据；
- 账号离线、route 不可信、模型不可用、上下文不完整、send authority 不可用时 fail closed；
- 自动代聊不能绕过现有 outbox / send queue 或直接调用平台 SDK；
- 自动代聊启用后，即使用户没有正打开该联系人，会话收到新的 canonical inbound event 时仍可响应；但 UI 当前选中联系人不得成为后台发送 identity；
- 后台自动代聊必须绑定 inbound message 自身的 canonical `contactId + conversationId + account/route identity`；
- 用户在 UI 中开启某联系人的 AI 代聊时，必须先通过 #478 的 active-room trusted route binding 将当前关系解析到 canonical contact/conversation；selectedRelationship fallback 不得授权生产发送。

### WP-3：Learning Product Bridge + 用户可理解的成长闭环

目标：不重做 Learning 算法，只把现有真实后端闭环接成真实产品能力。

必须完成：

- Electron main/preload 暴露 Learning Workspace 所需的真实只读 snapshot 与 coach action bridge；
- Product Shell 调用 production bridge，而不是 mock/fallback 假绿；
- `getLearningWorkspaceSnapshot` 与 `invokeLearningCoachAction` 必须有真实 preload → main → runtime contract，或在正式治理下被等价、单一、明确命名的 canonical API 替换；
- 用户看到的是中文的“学习与成长”“最近学到了什么”“待你确认的改进”“已采用/已回退”等产品语言；
- 不显示 Langfuse、DSPy、GEPA、Promptfoo、OpenFeature 等工程名作为普通 UI 一级内容；
- 所有会改变 Persona、关系策略、prompt/program 或 rollout 的 Learning 建议继续要求现有 approval authority；
- gate 必须新增 production bridge contract，不能只检查文件存在。

---

## 4. AI 代聊状态机

每个联系人拥有独立 automation policy。

```text
OFF (默认)
  -> user enables for this canonical contact
ON_IDLE
  -> new peer inbound committed
WAITING_CONTEXT
  -> identity/language/model/send readiness GREEN
READING_DELAY
  -> local understanding / reply generation
GENERATING
  -> quality + temporal + persona + stale checks GREEN
READY_TO_SEND
  -> platform-visible human cadence
TYPING
  -> existing send queue
SENDING
  -> terminal sent
ON_IDLE
```

任何阶段都可能：

```text
user disables        -> OFF
user starts typing    -> CANCEL_CURRENT -> ON_IDLE
new inbound arrives   -> SUPERSEDE_CURRENT -> WAITING_CONTEXT(latest turn)
account disconnected  -> BLOCKED -> ON_IDLE when healthy
route/context stale   -> CANCEL/REGENERATE
model unavailable     -> FAIL_CLOSED, no send
send failed           -> existing retry/failure semantics, no duplicate direct send
```

### 4.1 权限规则

- 默认 OFF；
- 只能用户显式开启；
- 权限必须持久化在现有 Store/interaction-policy authority 体系；
- 不能把生产发送权限放在 `localStorage`；
- 开关是联系人级，不是账号级，不是平台级，不是全局级；
- 解除联系人关系/归档/封锁时必须关闭或阻断；
- archived/contact blocked/route unresolved 时 fail closed；
- 所有自动回复操作必须带可审计的 automation-policy receipt / contact identity / conversation generation / source inbound message identity；
- restart/recovery 不允许双发；
- runtime 重启后只能处理“本次同步后被 canonical ingestion 判定为新的、尚未被该 automation receipt 消费的 inbound turn”，不得遍历历史消息批量补发。

### 4.2 Reactive only

P0 自动代聊只针对“对方先发来新消息”的响应式场景。

不包括：AI 主动早安、到时间自动问候、对方未回复时自动追问、根据关系阶段自动邀约、定时营销式触达、自动陌生开场。

未来任何 proactive messaging 都需要独立设计和授权，不能借本 Amendment 偷渡。

---

## 5. 平台可见的人类化节奏

自动代聊不能因为 AI 在本地处理速度快，就对外表现成秒读秒回。

### 5.1 本地阶段默认不可见

以下阶段默认不得向对方暴露 `read` / `composing`：

- 本地消息理解；
- Persona/关系检查；
- Model routing；
- candidate generation；
- quality/temporal repair；
- 中文理解生成。

### 5.2 Read / typing 节奏

- 复用现有 TypingStateService 的自然阅读/输入时间档位，不创建第二套 delay engine；
- 如果平台支持可控 read receipt，自动代聊不得在新消息刚到达时立即主动发送 read receipt；read receipt 必须在计划的人类化阅读窗口内触发；
- `composing` 只能在阅读窗口结束、最终候选已通过所有门禁后开始；
- `composing/paused` 继续使用现有随机节奏与取消语义；
- 新消息、人工输入、账号断开、上下文陈旧必须清除尚未完成的可见输入状态；
- 如果某个平台的 read receipt 由上游不可控地自动产生，产品必须把它识别成 capability limitation，不得伪造“可控制已读”的 GREEN 证据；该平台的 P0 自动代聊验收必须明确记录此限制。

---

## 6. 聊天风格连续性

自动代聊必须像用户之前在这个联系人上的自然聊天延续，而不是每次重新生成一种 AI 风格。

输入优先级：

1. 当前 Persona 与 truth-safe presentation profile；
2. 当前联系人最近真实对话，尤其用户本人 outbound 文本；
3. 用户修改/采用过的 AI reply 与 feedbackLearning evidence；
4. 当前联系人的 interaction preferences；
5. approved learned policy；
6. 当前关系阶段与 director strategy。

必须保留：长短、emoji 使用、正式/随意程度、问句频率、暧昧程度、直接程度、语言/地区表达、回复节奏、truth-safe 的常用称呼与表达习惯。

禁止串用其他联系人风格、把未经确认的人设经历当事实、为了“像人”故意加入错误事实、把中文翻译当外语风格样本、使用营销/销售/客服模板。

---

## 7. 时间语义生产合同

“当地时间”不是 prompt 装饰，而是 Reply Brain 的确定性上下文。

每次 candidate generation 必须绑定：

```text
generatedAtUtc
personaTimezone (IANA timezone)
personaLocalDateTime
personaDayPart
peerTimezone (仅已确认时)
peerLocalDateTime (仅已确认时)
peerDayPart (仅已确认时)
incomingSentAt
incomingAgeMinutes
incomingDayPartAtSend (能够可靠计算时)
```

### 7.1 Persona timezone authority

- 优先使用 Persona authoritative residence timezone；
- 必须是明确 IANA timezone，如 `Europe/Berlin`；
- 不允许只凭城市字符串在生产发送阶段临时猜时区；
- Persona timezone 缺失时仍允许一般回复，但禁止生成需要“我这里现在早上/下午/晚上”才能成立的事实性表达。

### 7.2 联系人 timezone authority

- 联系人时区只能来自已确认字段/已确认事实；
- 不从昵称、手机号、语言、IP、平台账号或 AI 推断直接提升为 confirmed timezone；
- 未确认时可以知道消息绝对 `sentAt`，但不能声称“你那里现在几点”。

### 7.3 Day-part 定义

为了让测试和 runtime 使用同一确定性分类，Persona local time 采用：

```text
morning   05:00–11:29
 daytime   11:30–17:29
evening   17:30–22:29
night     22:30–04:59
```

语言质量策略可以更保守，但不能把下午/晚上判成 morning。

### 7.4 Greeting quality gate

至少识别：早上好/早安/Guten Morgen/good morning、下午好/Guten Tag/good afternoon、晚上好/Guten Abend/good evening、晚安/Gute Nacht/good night，以及“今天早上/今晚/等会儿睡”等时间敏感表达。

规则：

- 不允许简单镜像对方早先的 greeting；
- 对方早上 08:00 发 `Guten Morgen`，若 Persona 当前当地时间已 15:30，候选不能机械回复 `Guten Morgen`；
- Persona timezone 真实可用时，可以自然承接“刚看到你的早安，我这边已经下午了”这类表达；
- Persona timezone 不可用时，必须使用不依赖当地时间事实的中性承接；
- 生成结果违反 temporal contract 时先同模型受控 repair；仍失败则 candidate/auto-send fail closed。

### 7.5 DST

欧洲时区必须由 IANA timezone runtime 计算，不允许手写 `UTC+1/UTC+2` 常量；DST 变化必须自动正确。

---

## 8. 双语与中文产品合同

### 8.1 聊天内容

对于德语、英语、法语、意大利语等外语聊天：

```text
原文：真正收到/真正准备发送的文本
中文理解：给用户阅读的中文翻译/解释
```

原文是消息 authority；中文理解是辅助 projection。中文理解失败不得改写原文；AI candidate 必须清楚标识哪一段会真正发送；“中文意思”不得被误送给对方。

### 8.2 用户可见系统文案

普通产品层所有用户可见外语必须有中文，包括导航、按钮、empty state、错误、模型 readiness、Learning status、Media/Voice status、设置、工具提示、搜索/翻译、AI 状态。

内部 error code 可以作为括号内诊断，不得取代中文说明。

### 8.3 技术名隐藏

普通产品 UI 不应显示 `Letta / Graphiti / Langfuse / DSPy / GEPA / LiteLLM / Promptfoo / OpenFeature / Qdrant / provider SDK name`。

普通关系聊天界面使用产品语言：记忆、关系理解、回复大脑、学习与成长、模型可用、暂不可用、等待确认。

---

## 9. 全局字体合同

全局字号是唯一用户设置，不是每个 workspace 各有一套。

要求：

- 默认 100%；
- 可调范围 85%–150%，步进 1%；
- 设置持久化；
- 所有 user-facing root 共享同一 effective scale；
- Element timeline/composer、Yance Product Shell、Media、Voice、Learning、search/translation、overlay、toast 都必须响应；
- 控件尺寸、点击区域和可访问性不得因为字体放大而崩坏；
- 大字号必须允许合理换行/滚动，而不是裁切；
- automated typography audit 必须扫描当前 shipping Product paths，不再只扫描历史 `frontend/`；
- 正文/标题必须通过统一 typography scale。

---

## 10. 全局主题合同

主题风格切换必须项目全覆盖。

要求：

- 一个 theme/appearance authority；
- Element host 与 Yance custom surfaces 使用同一 effective theme；
- Product Shell 不创建第二 palette；
- 所有颜色通过 semantic tokens：background/surface/text/subtle/accent/success/warning/error/focus/border 等；
- 深色/浅色与现有 theme catalog 均必须让 custom surfaces 同步；
- Theme audit 必须覆盖 `integration/element-module`；
- 主题切换后无需重启；
- 对比度、focus、disabled、error 状态不能只靠颜色区分。

---

## 11. Reply Brain 产品 UI

AI 不再是顶层“技术功能页”，而是当前关系里的助手。

当前关系页应有：

```text
[联系人姓名]                 AI代聊：关闭/开启

聊天 timeline（Element authority）

AI 回复建议
- 实际发送文本（德语/英语/其他）
- 中文意思
- 重新生成
- 采用/编辑

composer（Element authority）
```

AI 代聊开启时：

- 顶部或 AI companion 区显示清楚状态；
- 用户能一眼看出“这个联系人现在由 AI 自动回复”；
- 关闭入口必须始终容易找到；
- 若因模型/账号/route/上下文阻断，显示中文原因，如“AI 代聊已暂停：当前账号离线”，而不是静默失败。

人工模式下 AI 建议不遮挡 composer；用户可以忽略；用户开始手动输入时不会被 AI 抢发送权。

---

## 12. Model readiness 产品投影

Model Brain / LiteLLM 后端 authority 不改。

产品只投影用户真正需要知道的状态：回复大脑可用、准备中、当前模型不可用已暂停 AI 代聊、缺少必要模型能力、连接异常。

普通 UI 不显示 provider routing 表、模型候选排序、LiteLLM 内部配置。Reply Brain readiness 非 GREEN 时自动代聊 fail closed。

---

## 13. Learning 产品闭环

用户要看到“系统确实在成长”，但不能把 OSS observability 工具直接扔给用户。

产品层示例：

```text
学习与成长
- 最近学到：更偏好短回复 / 少问问题 / 更少 emoji ...
- 来自：真实聊天与用户修改
- 待确认改进：N
- 已采用：N
- 最近回退：原因
```

Learning Coach 任何会改变生产策略的动作仍必须经过现有 approval boundary。

Production bridge contract 必须真实覆盖：

```text
Product Shell
 -> preload exposure
 -> Electron main handler
 -> Learning snapshot / coach action
 -> existing Learning authority
```

任一层缺失都必须 RED。

---

## 14. 失败关闭与稳定性

上线体验宁可清楚暂停 AI，也不能偷偷发送错误内容。

自动代聊必须在以下情况停止发送：

- inbound canonical contact/conversation/route identity 不唯一；
- conversation generation 已变化；
- 新入站消息 supersede 当前 turn；
- Persona version/policy hash 已变化；
- 联系人被归档/封锁；
- 用户关闭 AI 代聊；
- 用户开始人工输入；
- target language unresolved 且无法质量保证；
- temporal quality gate 无法得到安全结果；
- Model Brain readiness 非 GREEN；
- account/send capability 不可用；
- Outbox/SendQueue/Typing authority 不可用；
- domain isolation/safe mode 阻断 AI。

禁止 fallback 到直接平台 send。

---

## 15. 验收矩阵

### 15.1 WP-1 GREEN

- shipping Product UI 中不存在无中文解释的主要用户文案；
- 普通 UI 不暴露内部 OSS 引擎名；
- 字号 85%、100%、150% 时 Element + Product Shell + overlays 全部响应且无关键裁切；
- theme 切换后所有 shipping surfaces 响应；
- typography/theme audit 覆盖 `integration/element-module`；
- Product Final materialization/typecheck GREEN。

### 15.2 WP-2 GREEN

必须至少覆盖：

- 新联系人默认 AI 代聊 OFF；
- A 联系人开启不影响 B 联系人；
- 当前 UI relationship 未通过 trusted route binding 时不能开启生产自动代聊；
- 后台自动代聊由 inbound canonical identity 触发，不依赖当前 UI selected relationship；
- app restart 后 per-contact policy 正确恢复且不双发、不批量补发历史消息；
- 开启后新 inbound 触发同一个 Reply Brain；
- 用户人工输入取消当前 auto run；
- 新 inbound supersede 旧 candidate；
- route/model/account unavailable 时不发送；
- Outbox/Typing/SendQueue 是唯一外发链；
- 在支持可控 read receipt 的平台上，新 inbound 不会由 AI 立即主动标记已读；
- `composing` 不会在候选最终门禁 GREEN 之前出现；
- 手工聊天历史与 adopted/edited replies 影响后续风格；
- `Guten Morgen` 早上入站、Persona Berlin 下午生成时不能机械回复 `Guten Morgen`；
- DST 场景使用 IANA timezone 正确计算；
- timezone 缺失时不生成虚假的当前日段事实；
- 外语 candidate 与中文理解严格分离；
- Model readiness RED 时 auto-reply fail closed；
- Product Surface 能生成/显示/编辑/采用 AI reply。

### 15.3 WP-3 GREEN

- Learning product bridge 端到端 contract GREEN；
- preload/main/runtime 任一 seam 移除时测试必须 RED；
- `getLearningWorkspaceSnapshot` / `invokeLearningCoachAction` 或其正式 canonical replacement 有真实 production handler；
- 用户可见 Learning UI 中文化；
- 普通 UI 不显示内部 OSS 技术名；
- proposal/approval/promotion/rollback 后端 authority 不变；
- Product Final materialization/typecheck GREEN。

---

## 16. 治理与 failure-first

每个工作包：

1. 从当时 fresh trusted main 建立正式 authorization；
2. 精确 path scope；
3. 第一 implementation commit 只能是 failure-first tests；
4. 必须取得 fresh causal RED；
5. 再实施生产修复；
6. 禁止改 gate/scanner 放行；
7. 禁止 workaround；
8. 成熟 OSS 与现有 authority 优先；
9. 新 Yance general-purpose infrastructure 禁止；
10. 最终只允许 ordinary two-parent merge；
11. 不 squash、不 rebase、不 force push。

本设计本身不授予生产 path 修改权限。

---

## 17. 实施顺序

固定顺序：

1. **WP-1 中文 / Typography / Theme**；
2. **WP-2 Reply Brain / AI 代聊 / Temporal / Model readiness**；
3. **WP-3 Learning Product Bridge**。

WP-2 可以依赖 WP-1 的中文、theme、typography primitives；WP-1 不得依赖 AI 自动发送。

---

## 18. 不在本 Amendment P0 内

- AI 主动发起陌生对话；
- 定时主动问候；
- 对方不回复后的自动追问；
- 批量联系人自动触达；
- CRM / sales pipeline；
- 多账号营销 campaign；
- 自动约会邀约策略；
- 新模型路由框架；
- 新 Learning 框架；
- Docling/Retrieval 新功能；
- MCP 新功能；
- 生产登录环境人工 UAT 本身。

---

## 19. 产品成功定义

完成后，用户应感受到：

- 我在和“这个人”聊天，不是在操作 CRM；
- 外语我看得懂，因为原文旁边有中文理解；
- 我可以按自己的阅读习惯调全局字号；
- 我换主题以后整个项目真的一起换；
- AI 回复大脑就在当前关系里，能给我真正可发的回复；
- 我想自己聊就自己聊；
- 我对某一个人开启 AI 代聊以后，即使没有一直打开这个会话，它也只根据这个人的新消息继续我的聊天风格；
- AI 的回复知道“我这里现在几点”，不会下午机械回复早上好；
- 自动回复不会刚收到就立刻主动已读、立刻输入、立刻发送；
- 模型不可用时 AI 会清楚暂停，而不是乱发；
- 学习系统不是摆设，我能看到它从真实聊天中成长，但重要改变仍然由我确认。

这才是本 Amendment 的上线体验闭环。