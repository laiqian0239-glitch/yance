# WhatsApp 自然输入节奏实现审计

## 目标

言策只在最终回复已经生成、质量检查通过并由用户明确确认发送后，才向 WhatsApp 暴露输入状态。AI 理解、关系判断、Persona 检查、候选生成与质量复核阶段均不向对方发送 `composing`。

## 默认节奏

| 档位 | 静默阅读 | 输入段数 | 每段输入 | 中间暂停 | 计划总时长 |
|---|---:|---:|---:|---:|---:|
| 简单短回复 | 10–25 秒 | 1–2 | 4–9 秒 | 2–4 秒 | 18–40 秒 |
| 普通回复 | 18–40 秒 | 2–4 | 6–14 秒 | 2–6 秒 | 45–85 秒 |
| 情绪或复杂回复 | 35–80 秒 | 3–5 | 8–18 秒 | 3–8 秒 | 80–150 秒 |

所有时间与段数在范围内随机生成。8 个字符以内的极短回复固定为一段，不会出现四次输入状态。

## 调用链

```text
本地 AI 理解、关系判断、Persona 与事实检查
  → 生成候选并完成质量检查
  → 用户批准候选
  → 用户再次确认发送
  → 本地静默准备（不发送平台状态）
  → WhatsApp composing / paused 随机交替
  → 最终 composing 期间加入发送队列并等待首个发送终态（最多 5 秒）
  → paused
```

正常网络路径中，最终 `paused` 在平台发送完成后发出，而不是在消息刚加入本地队列后立即发出。若平台发送失败，仍会清除输入状态并进入原有稳定失败/重试处理，不会永久保持 `composing`。

## 取消与陈旧上下文处理

以下事件会中止尚未发送的自然输入流程：

- 收到同一会话的新消息；
- 用户开始真实键盘输入；
- 用户切换会话；
- 账号状态改变或断开；
- 用户点击“取消发送”；
- 最终发送前发现联系人、关系、Persona、策略或账号状态已经变化。

取消发生在输入阶段时会立即发送 `paused`。用户主动取消、人工输入或切换会话时，已批准回复返回“等待再次确认发送”；收到新消息或上下文陈旧时，回复标记为 `reverify_required`，不能继续使用旧上下文发送。

## 人工输入

只有浏览器真实可信的键盘输入事件（`event.isTrusted`）才控制人工 `composing`。程序把 AI 候选填入输入框不会触发平台输入状态。人工输入停止约 1.8 秒或输入框失焦时发送 `paused`。

## 离线同步

离线消息进入本地消息管线不会自动启动自然输入。只有用户明确批准并确认发送的 AI Outbox 项才会执行模拟节奏。

## 修改文件

- `backend/store/typing/typingPolicy.js`
- `backend/services/typingStateService.js`
- `backend/services/aiReplyOutboxService.js`
- `backend/store/commands/registerAiReplyCommands.js`
- `backend/store/StoreManager.js`
- `backend/core/accountContext.js`
- `frontend/js/core-client.js`
- `frontend/js/r32-conversation-capabilities.js`
- `frontend/js/r32-ui-runtime.js`
- `backend/tests/whatsappHumanTypingPolicy.test.js`
- `package.json`

## 已执行测试

```text
npm run test:human-typing
# 8/8 PASS

node --test --test-concurrency=1 \
  backend/tests/accountLifecycleRegression.test.js \
  backend/tests/caller_migration.test.js \
  backend/tests/r32-production-baseline-static.js \
  backend/tests/sendMessageService.test.js \
  backend/tests/whatsappQrChallenge.test.js \
  backend/tests/facebookOAuthLifecycleRegression.test.js \
  backend/tests/facebookProductionReadinessRegression.test.js \
  backend/tests/platformAuthConfigRegression.test.js
# 49/49 PASS

node --test --test-concurrency=1 \
  backend/tests/accountLifecycleCommands.test.js \
  backend/tests/accountRepositoryConcurrency.test.js \
  backend/tests/replyFeedbackClosedLoop.test.js \
  backend/tests/replyFeedbackLearning.test.js \
  backend/tests/replyFeedbackVersioning.test.js \
  backend/tests/whatsappReceiptRecoveryRegression.test.js \
  tests/frontend-security/conversation-center-ui-v2.test.js \
  tests/persona-brain/reply-brain-safety.test.js \
  tests/persona-brain/reply-brain-upgrade.test.js \
  tests/sound-notification/active-conversation-lifecycle.test.js \
  tests/wp3/stale-fencing-token-outbox-denied.test.js
# 50/50 PASS

npm run verify:facebook-cloudflare
# Worker 49/49 PASS
# Desktop–Worker contracts 42/42 PASS
```

另外执行了相关 JavaScript 语法检查、`git diff --check` 和 10,000 次每档随机计划边界抽样。

## 尚未验证

- 未在用户真实 Windows 安装包中运行；
- 未使用真实 WhatsApp 账号观察另一台手机上的 `composing/paused` 显示；
- 未测量真实网络下 Baileys 发送完成与 WhatsApp 客户端 UI 状态消失的精确时差；
- 未生成或安装新的原地升级 EXE。

因此本提交是源码候选和自动化回归通过，不等于真实 Windows/WhatsApp UAT 通过。
