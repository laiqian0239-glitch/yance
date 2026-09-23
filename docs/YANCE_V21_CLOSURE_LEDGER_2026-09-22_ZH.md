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
- 代码级已修但仍缺真实 E2E：5 项
- 正在实施：4 项
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
| P06 | direct-chat command / IPC / preload / renderer wiring | **CODE-GREEN** | focused 10/10 + fresh typecheck/build；待同一 frozen runtime DATA/HUMAN 验证 |
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
- R2 Conversation route / Matrix portal 生命周期：P06 wiring 已 **CODE-GREEN**；目标链为 canonical account → exact login_id → exact peer → official portal → join → m.bridge → RoomView，仍待同一 frozen runtime DATA/HUMAN 验证。
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

## 2026-09-22 R2 CODE-GREEN fresh evidence

- `tests/wp0/v21-mautrix-direct-chat-command-wiring-local.test.js`：2 / 2 GREEN；两个 checkpoint RED 均已关闭。
- direct-chat / routing focused suite（checkpoint 原 10-test 集）：**10 / 10 GREEN**。
- Element Yance module：`lint:types --skip-nx-cache` GREEN；`build --skip-nx-cache` GREEN。
- source 与 frozen Element `modules/yance/src/index.tsx` materialized SHA-256 一致：`64D6D52D5745062CF6554A176ED6FE55CA488E4AD046830271D2DBE13BC21F58`。
- RoomView remount regression：**1 / 1 GREEN**。
- Product final admission：仍为 **17 tests / 14 pass / 3 fail**；三个既有 admission RED 未被本轮 wiring 变更冒充为 GREEN。
- `git diff --check` GREEN。
- 当前状态仅为 **CODE-GREEN**；尚未声明 DATA-GREEN / HUMAN-ACCEPTED / CLOSED。

## 2026-09-22 Owner correction / new-chat handoff checkpoint

This checkpoint supersedes the stale “next task = R2 command wiring” wording in earlier sections, but does not rewrite history and does not authorize promotion.

- R2 command/IPC/driver direct-chat wiring remains **CODE-GREEN**, not HUMAN-ACCEPTED/CLOSED.
- Current bounded Product RED is contact-directory completeness: Facebook mature Matrix space has **26** `m.space.child` room edges (not yet a proven unique-contact count), while current Yance People projection only exposes the subset with materialized/joined `Room` objects.
- Current runtime evidence after mature bridge observation recovery: Product People shows **14** relationships; Facebook contributes the currently materialized/joined subset, not all hierarchy children.
- Fresh focused test `tests/wp0/v21-product-contact-directory-authority-local.test.js`: **4 total / 2 PASS / 2 RED**. The RED requires a mature-owner hierarchy summary seam plus thin Product projection; it must not be weakened.
- RED H remains OPEN. RED I (`添加联系人 / 新建联系`) remains OPEN and follows directory identity/projection closure.
- User explicitly rejected further rule drift. New chat must execute `AGENTS.md` repository skill routing first, including one-shot release-controller recovery and mature-authority admission before any production mutation.

## R2 DATA-GREEN fresh evidence — current frozen runtime

- Frode Amundsen now resolves to exact Matrix room `!cuBzJhZKiBqXQKnuAQ:yance.local`; clicking the invite-only contact no longer retains Marc Rotte or falls into `NO_UNIQUE`.
- Synapse current membership for `@tester01:yance.local` in that room is `join`; the prior `invite` event remains historical evidence only.
- Mature-owner room state contains both `m.bridge` and `uk.half-shot.bridge`: Telegram receiver `8638095739`, exact peer `user:6472340049`, bridge bot `@yance_telegram_bot:yance.local`.
- Frozen Element host bundle now exposes mature `ensureRoomJoined -> MatrixClient.joinRoom`; live `init.js` SHA-256 is `b2e63161e64bdfa3476447d991756a240b33526e410c28c828e1b9a738fcb394`.
- Frozen Yance module `index.js` host/container/HTTP SHA-256 is `f9549fbefc90792f85abb2a1e70b80af8cfd2bb667f08fa9683ad56b90af28f3`.
- Runtime admission is fresh GREEN on the active Frode RoomView: Product conversation presentation active, real Element Composer present, 4 rich-reply actions present, no New Room intro / crypto event / generic system summary, authenticated contact media loaded.
- The admission helper's stale `richReplyToolCount === 3` expectation was corrected to the current 4-action Product contract via RED→GREEN test; no Product visual behavior was changed.
- Telegram mature bridge currently has `backfill.enabled: false`; therefore zero historical `m.room.message` events in this newly joined portal is not treated as an R2 P06/P07 failure and no fake history/backfill authority was introduced.
- Fresh focused direct-chat wiring test: **6 / 6 GREEN**. Frozen acceptance admission test: **6 / 6 GREEN**. `git diff --check`: GREEN (line-ending advisories only).
- R2 status is now **DATA-GREEN**. **HUMAN-ACCEPTED is still pending**; no CLOSED claim is authorized. Windows visual closure requires real owner-approved evidence/receipts and synthetic or hand-authored receipts are forbidden.

## 2026-09-23 RED H / People-Relationship closure continuation

This continuation supersedes the earlier RED-H runtime counts without rewriting their historical evidence.

- Persistent mature-owner seam is now `upstream-patches/element-web/0021-yance-space-hierarchy-summary.patch`; `tools/matrix/bootstrap.js` applies it during Element materialization.
- Element exposes read-only `getSpaceHierarchyRooms(spaceRoomId)` summaries. Product enumeration does not bulk-join child rooms; exact-room join remains lazy on contact selection.
- Fresh focused closure suite covering direct-chat authority, hierarchy projection, pending conversation handoff, Home return, and frozen admission: **32 / 32 GREEN**.
- Fresh Yance Element module `lint:types`: GREEN.
- Frozen runtime admission and repository safe renderer reload: GREEN; materialized Yance module SHA-256 is `c7fa5451375811d748eab8c4c800cc1d90dd29662175eb18035fa36ab971bc98`.
- Real Product regression is closed at DATA level: enter Relationship World -> click Home -> People mounts; stale Relationship World unmounts; Home becomes the active destination.
- People authority reconciliation is exact: 8 backend direct relationships + 35 mature Matrix hierarchy-owned rooms - 6 canonical route overlaps = **37 Product relationships**, matching the rendered People count of 37.
- Matrix authority evidence: 2 bridge spaces, 35 hierarchy children, 35 / 35 joined at observation time, zero hierarchy-read failures.
- `/api/health` is a large diagnostic projection (~435 KB in the observed runtime) and returned in 3174 ms during diagnosis. Frozen admission now reuses its existing `YANCE_ACCEPTANCE_READY_TIMEOUT_MS` boundary for this health projection instead of the generic 4-second fetch default; the admission regression is GREEN.
- Unrelated/unadmitted Telegram backfill configuration remains outside this closure commit and must not be treated as part of RED H or R2 evidence.
- Status: **RED H = DATA-GREEN; R2 = DATA-GREEN; HUMAN-ACCEPTED remains pending.** No CLOSED / release / merge claim is authorized by this note alone.

## 2026-09-23 Final chat-cutover checkpoint

This is the current ledger checkpoint for the next chat and supersedes stale earlier execution targets without rewriting historical evidence.

- Exact branch: `checkpoint/yance-v21-closure-20260922`.
- Product closure baseline commit: `fbd0cec65755668ec6acd714fa611b855af0d7ce` (`fix(yance): close v21 direct-chat and people hierarchy`).
- The checkpoint branch may contain docs-only handoff commits on top; do not hard-code a self-referential branch-tip hash here. Fresh State Recovery must resolve exact local/remote HEAD.
- R2 direct-chat path: **DATA-GREEN → HUMAN-ACCEPTED pending**.
- RED H contact-directory / hierarchy projection: **DATA-GREEN → HUMAN-ACCEPTED pending**.
- People ↔ Relationship World return regression: **DATA-GREEN → HUMAN-ACCEPTED pending**.
- RED I Add Contact: still OPEN and must be treated as a separate future causal batch, not folded into the already-closed implementation batch.

Current Product data reconciliation remains exact: `8 + 35 - 6 = 37`, matching the rendered People count of 37. The mature Matrix hierarchy remains the directory authority and Element remains the real room/timeline/composer authority.

Tracked local changes intentionally left outside this checkpoint are only Telegram backfill enablement in `config/matrix/mautrix-telegram/config.yaml` and `services/matrix/docker-compose.yml`. These are not admitted/validated closure bytes. Preserve them locally, but do not stage/commit/ship them without separate authority admission.

The next chat must begin with repository-owned Fresh State Recovery and fresh Controller verification. Do not repeat contact census, Docker recreation, Matrix re-login, SQLite cleanup, ad-hoc acceptance-runtime restart/reload, or any other broad recovery. HUMAN acceptance remains the final standard before CLOSED.
