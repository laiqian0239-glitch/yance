# 言策 Batch 27 真实 Windows UAT 清单

源码身份必须匹配最终 Batch 27 PackageCommit/Tree 和 sidecar。

## A. 主库 ownership 与时间

- 同一 DB 四进程竞争，任何时刻最多一个写 owner。
- 运行超过 2×staleMs 后仍不可抢占活 owner。
- SIGKILL 后在受控窗口接管；PID 复用拒绝旧 identity。
- 系统时间 +1h/-1h、睡眠/唤醒后不 double-claim。

## B. 全平台 Egress

对 WhatsApp、Telegram、Facebook 分别执行 text、media、reaction、revoke/delete、presence/typing、read/receipt（以平台实际能力为准）：

- deadline 前成功；
- SDK 永久悬挂；
- deadline 后 late success/late failure；
- 强杀发生在 unknown 落库前后；
- 重启 reconciliation；
- 其他账号 lane 继续发送。

## C. Telegram enrichment

- 1/500/501/5000 条恢复。
- 同 externalId 跨账号不串号。
- 在线失败自动 retry。
- orphan job/base message、毒记录、DLQ 和 oldest age 证据。

## D. AI Runtime/OpenRouter

- 两个不同真实模型。
- timeout、caller cancel、429、余额不足、provider switch。
- Provider 忽略 AbortSignal 时物理连接/worker 回收。
- 重启后 running task 收敛，迟到结果无副作用。

## E. 学习闭环

- 501/50001 条分页。
- 首页毒记录不阻塞。
- lease 过期双 worker 竞争，scope/L1 副作用各一次。
- source = projected + DLQ + pending 总账成立。

## F. 证据

分别保存：产品行为、SQLite 表快照、进程/句柄、自动化工具日志、真实平台 ACK、OpenRouter 原始非秘密回执。

任一项失败继续 `WINDOWS_UAT_BLOCKED`。
