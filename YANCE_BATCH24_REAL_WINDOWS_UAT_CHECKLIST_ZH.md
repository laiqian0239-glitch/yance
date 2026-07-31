# 言策 Batch 24｜真实 Windows UAT 证据清单

> 当前状态：`WINDOWS_UAT_BLOCKED`。本清单不是通过证明。

## A. 制品与启动

- 校验源码 ZIP、Git Bundle、PackageCommit/Tree、Sidecar 和 SHA256。
- clean `npm ci` 成功并保存完整日志。
- Windows 10/11 冷启动、正常退出、强制结束、重启各至少 10 次。
- 验证 Boot Phase 0 恢复期间不存在已打开主库句柄、EBUSY 或 EPERM。
- 验证只有一个主 SQLite 写 Owner，设置 Worker 不能打开主库。

## B. 强关与 SQLite 快照

分别在以下阶段强制结束进程并重启：

1. RouteVersion 创建前/后；
2. Queue 写入前/后；
3. Message receipt checkpoint 前/后；
4. 远端 ACK 后、本地 checkpoint 前；
5. DomainEvent append 后、Projection apply 前；
6. Identity outbox processing；
7. connect/disconnect/logout/remove Saga 每个 phase；
8. QR/验证码/OAuth RUNNING。

保存重启前后表快照：`r32_accounts`、`external_identities`、`identity_links`、`conversation_bindings`、`r32_conversations`、`r32_messages`、`r32_send_queue`、`outbox_routes`、`outbox_route_versions`、`account_lifecycle_saga`、`domain_event_projection_jobs`、`identity_domain_event_outbox`、`async_operation_state`。

## C. 真实平台

WhatsApp、Facebook、Telegram 分别验证：

- 入站首次联系人、已有联系人、历史同步、Echo；
- 纯文本、emoji-only、媒体；
- 平台 ACK 与 SQLite Queue/Message/RouteVersion 一致；
- 远端已接受但本地写入中断时不自动重发；
- 强关重启后 reconciliation 收敛；
- 账号切换、会话合并和跨账号迁移不串号。

## D. OpenRouter

- Key 持久化与重启 hydration；
- 两个不同模型分别完成格式、语言和事实边界冒烟；
- 2/2 前生产路由保持 blocked/pending；
- 旧 operation/generation 回写被拒绝。

## E. 授权门禁

只有 clean install、真实 Windows、三平台、OpenRouter、数据库快照和独立审核全部通过，才可讨论授权或晋升。
