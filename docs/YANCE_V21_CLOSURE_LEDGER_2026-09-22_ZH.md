# Yance v21 闭环对账台账 — 2026-09-22

> 状态：WIP checkpoint，不是发布结论，不授权 merge / RC / UAT。
> 人工验收仍是最终视觉与真实行为验收标准；自动测试只作为证据，不替代人工验收。

## 当前权威工作区

- Worktree: `C:\Users\Public\Documents\yance-product-final-ui-local-20260919`
- Checkpoint branch: `checkpoint/yance-v21-closure-20260922`
- Base HEAD: `1d6288d3e36e72894ae3a11e959bcc33bbf91554`
- 当前工作区存在大量未提交累积修改；不得 reset / clean / 丢弃。
- 真实 Electron / Element runtime、SQLite 与 Docker Compose 仍是最终运行证据来源。

## 结论计数

当前统计：17 个主产品/运行时问题 + 5 个工程风险。

- 已达到问题级数据/运行证据闭环：1 项（P02）
- 代码级已修但仍缺真实 E2E：4 项
- 正在实施：5 项
- 仍开放：7 项
- 6 个根因簇整体闭环：0 / 6

## 四层闭环门槛

任何问题只有同时满足以下条件才允许标记 CLOSED：
1. 根因源码修复；
2. 定向回归 / typecheck / build 有 fresh evidence；
3. 现存数据迁移或收敛完成（若问题涉及数据）；
4. 同一 frozen runtime 中由用户人工验收真实行为/截图。
## 主问题台账

| ID | 问题 | 当前状态 | 封账要求 |
|---|---|---|---|
| P01 | 跨账号 conversation 串到错误 Matrix room | 代码/专项测试修复，待 E2E | 两个真实账号 + 同联系人绝不串房 |
| P02 | Telegram 同一登录重复 active 账号 | **数据已收敛** | 保持 1 个 canonical active；projection 为 merged |
| P03 | Telegram 联系人栏重复 | projection canonicalization 已改，待 UI 验收 | reload 后不重复、不丢联系人 |
| P04 | WhatsApp pairing code 不显示 | 代码已读 `code`，待真实登录验收 | 手机侧真实 pairing code 可见 |
| P05 | exact peer → Mautrix direct-chat portal authority | 正在实施 | 官方 create_dm 精确返回唯一 portal |
| P06 | direct-chat command / IPC / preload / renderer wiring | **当前主 RED** | wiring 专项 0 fail；真实导航可调用 |
| P07 | Telegram portal 存在但多数仍为 invite | 未闭环 | 严格 route 验证后 Element join 成功 |
| P08 | 已连接账号被误报“账号尚未就绪” | 未闭环 | account / portal / membership / room readiness 分层 |
| P09 | Marc Rotte 无法稳定打开唯一真实 RoomView | 被 P05–P08 阻塞 | 点击 Marc 稳定进入唯一真实房间 |
| P10 | Facebook Messenger receiver / membership 独立验证 | 未闭环 | 验证真实 meta room state 与 receiver authority |
| P11 | WhatsApp QR/pairing timeout→restart→connected | 未闭环 | 真实手机确认完成全状态机 |
| P12 | Facebook Page 产品连接 | picker 代码存在，真实 Page 未 attach | 真实 Chatwoot Page/Inbox attach |
| P13 | Chatwoot runtime + webhook 完整 readiness | 未闭环 | BASE_URL/ACCOUNT/TOKEN/WEBHOOK_SECRET 全部 ready |
| P14 | 切联系人后 RoomView 保留旧 Facebook 内容 | key remount 代码/专项测试修复，待 E2E | 连续切两联系人，timeline 必须真实切换 |
| P15 | Conversation Workspace v3 最终真实界面 | 被 R2 阻塞 | 真实 Element timeline/composer 上人工截图验收 |
| P16 | Reply Brain“和闺蜜大脑聊聊”+ durable learning | 未闭环 | 纠错进入既有 feedback-learning，下一轮可观察消费 |
| P17 | Product UI 泄漏物理 primary/fallback 路由 | 未闭环 | Product 只展示 Auto/用户模型/推理偏好；LiteLLM 拥有 fallback |
## 根因簇

- R1 账号身份 canonicalization / 防串台：部分修复；N2 receiver 缺失 fail-open 已修，N1 保留为跨账号 E2E 防回归项。
- R2 Conversation route / Matrix portal 生命周期：当前第一阻塞；目标链为 canonical account → exact login_id → exact peer → official portal → join → m.bridge → RoomView。
- R3 WhatsApp provisioning：当前 active driver 已是 mautrix-whatsapp；剩余是 QR/pairing、timeout/cancel/restart、手机确认。
- R4 Facebook Page / Chatwoot：picker 已在活工作区；仍缺真实 Chatwoot 配置、Page attach 与 webhook readiness。
- R5 Conversation Workspace：RoomView remount 已有代码证据；Reply Brain durable learning、Model Brain authority 与最终视觉验收仍开放。
- R6 工程验收：测试基线仍漂移；不得用旧的 18/20 或其他历史分子分母当 fresh evidence。

## 5 个工程风险

1. 当前 checkpoint 来自累积 dirty worktree；提交用于保存现场，不代表这些变更已经发布或全部审查完成。
2. 源码与 materialized Element runtime bytes 可能不一致；每次人工验收前必须确认加载的是本 checkpoint 字节。
3. admission 测试存在规格漂移；错误断言不能为了 GREEN 删除正确成熟 authority。
4. 同 runtime reload/CDP harness 曾出现 9223 消失；这属于验收 harness 风险，不应误判为产品根因。
5. 若干最终验收依赖真人外部动作：双 Telegram 账号、WhatsApp 手机确认、Facebook Messenger、Chatwoot 凭据。

## 当前 fresh 自动证据（checkpoint 前）

- direct-chat / routing focused suite：10 tests，8 pass / 2 fail；两项 RED 均指向 command/IPC/renderer wiring 尚未完成。
- RoomView remount regression：1 / 1 GREEN。
- Product final admission：17 tests，14 pass / 3 fail；不得声称 broad suite GREEN。
- SQLite：Telegram canonical account `te-b4ff...` active；synthetic `te-mautrix...` merged；两者真实 login ID 均为 `8638095739`。
- SQLite：当前 active WhatsApp driver 为 `whatsapp-personal-mautrix-whatsapp`；旧 Baileys 仅保留 retiredDriverId。