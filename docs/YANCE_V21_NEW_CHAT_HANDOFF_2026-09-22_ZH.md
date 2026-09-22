# Yance v21 新聊天交接 — 2026-09-22

> 用途：下一聊天直接恢复执行，不重新做泛化盘点。
> 人工验收为最终验收标准；自动测试/截图只是前置证据。

## 远端 checkpoint

- Branch: `checkpoint/yance-v21-closure-20260922`
- Current remote tip at handoff: `47e5878ddaa9283da36fd4475bf7f4d709d8a983`
- Core WIP checkpoint commit: `53e0af1a06e745e7ebc1335e73807956215b2aee`
- GitHub #1051 checkpoint comment: `5772257657`
- Base: `1d6288d3e36e72894ae3a11e959bcc33bbf91554`
- Ledger: `docs/YANCE_V21_CLOSURE_LEDGER_2026-09-22_ZH.md`
- Conversation authority: `docs/FINAL_CONVERSATION_PRODUCT_AUTHORITY_ZH.md`
- Conversation implementation handoff: `docs/FINAL_CONVERSATION_IMPLEMENTATION_HANDOFF_ZH.md`

## 下一聊天第一执行点

不要先改视觉，不要重建 Docker，不要重登 Matrix，不要清 SQLite。

第一任务只闭环 R2：
`canonical Product account → exact mautrix login_id → exact remote peer → official direct-chat portal → ensureRoomJoined → readable m.bridge → exact RoomView`。

当前具体断点：`tests/wp0/v21-mautrix-direct-chat-command-wiring-local.test.js` 仍有 2 个 RED：
1. `AccountContext` 尚未暴露 `account.provisioning.directChat.ensure`；
2. Element `ProductDesktop`/navigation 尚未通过 `runPlatformAccountCommand` 重试 unresolved mautrix route。

完成 R2 前，不把 Marc Rotte、Telegram 联系人去重、首页 readiness 标为 CLOSED。
## 固定执行顺序

1. R2 wiring：让 focused 2 RED → GREEN，并确认 typecheck/build。
2. 同一 frozen runtime materialize/reload；人工点击 Marc Rotte、至少两个 Telegram 联系人，确认联系人不重复、Timeline 不串房、RoomView 真正切换。
3. Telegram 双账号 + 同联系人防串台 E2E（需要用户第二个真实 Telegram 账号时再请求人工扫码）。
4. WhatsApp：pairing/QR → wait → timeout/cancel/restart → 手机确认 → connected；需要用户手机时明确停下请求人工操作。
5. Facebook Messenger：真实 room membership + bridge receiver/account identity 独立验证。
6. Facebook Page：安全配置 Chatwoot 四件套，discover Page/Inbox → exact attach → webhook 入站/出站验证。
7. 回到 Conversation Workspace v3：Reply Brain durable learning、Model Brain authority、双语/头像/Composer/Inspector，最终由用户截图验收。

## 每个问题的封账格式

每次只允许使用以下状态：
- RED：根因未修 / 测试仍失败 / 真实界面仍失败。
- CODE-GREEN：源码 + focused tests 通过，但尚未人工运行时验收。
- DATA-GREEN：需要的数据迁移/收敛已验证。
- HUMAN-ACCEPTED：同一 frozen runtime 由用户人工确认。
- CLOSED：CODE-GREEN + DATA-GREEN（适用时）+ HUMAN-ACCEPTED 全部成立。

每次状态变更都更新同一 ledger，并在 GitHub #1051 留非 Controller checkpoint comment；不覆盖 Controller State。

## 推荐技能 / 插件

无需再堆设计插件。当前足够：GitHub、Remote Desktop Commander、Superpowers、Canva、Adobe Express。
Superpowers 必用：`systematic-debugging`、`test-driven-development`、`verification-before-completion`；多步执行使用 `writing-plans` + `executing-plans`。
Canva 只做设计决策/验收记录；Adobe Express 只做视觉素材；真实 Electron/Element 是最终产品事实来源。
## 仅在确实需要时请求用户人工协助

- Telegram：第二个真实账号扫码/验证码，用于同联系人跨账号隔离验收。
- WhatsApp：真实手机扫码或配对码确认。
- Facebook Messenger：必要时重新确认个人账号登录/房间状态。
- Facebook Page：`CHATWOOT_BASE_URL / CHATWOOT_ACCOUNT_ID / CHATWOOT_API_ACCESS_TOKEN / CHATWOOT_WEBHOOK_SECRET`，必须走安全凭据 authority，禁止写进仓库。
- 最终 UI：用户提供真实 Electron 截图并决定通过/不通过。

## 禁止事项

- 不 reset / clean 当前 worktree。
- 不删除、合并或重写真实聊天历史来“修好”路由。
- 不直接改 Synapse/bridge SQLite 伪造成功状态。
- 不复活废弃 Facebook Page OAuth；Page authority 是 Chatwoot。
- 不把测试 GREEN 等同于人工验收。
- 不因为 Figma/Canva/Adobe Express 限额阻塞真实本地 UI 推进。
- 不在问题未完成四层证据前写“全部闭环”。

## 新聊天建议首条指令

`@Superpowers @GitHub @Remote Desktop Commander 继续言策项目收尾。先读取远端 checkpoint/yance-v21-closure-20260922 的 docs/YANCE_V21_NEW_CHAT_HANDOFF_2026-09-22_ZH.md 和 docs/YANCE_V21_CLOSURE_LEDGER_2026-09-22_ZH.md；不要重新盘点，不改视觉，直接从 R2 direct-chat command/IPC/Element wiring 的 2 个 RED 开始，按 CODE-GREEN → DATA-GREEN → HUMAN-ACCEPTED 对账封账。人工验收仍是最终标准。`