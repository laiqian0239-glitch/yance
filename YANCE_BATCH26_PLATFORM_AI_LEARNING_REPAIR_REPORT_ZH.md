# 言策 Batch 26｜通讯平台、AI Runtime 与学习闭环修复报告

## 身份

- Branch：`development/windows-uat-f25fe2e-repair-batch26-platform-ai-learning`
- ImplementationCommit：`0e64fa2155ef5b5d7ab9d0272dae0c0a42e87b4e`
- ImplementationTree：`0a78bfe0bc3000ea1587cf7a29ab752beb2871c8`
- ParentPackageCommit：`135444c06e771de594362232a435a9cb30db5f26`
- 当前状态：`REPAIR_ATTEMPT_IN_PROGRESS / WINDOWS_UAT_BLOCKED`

## 已实施公共层修复

1. 全平台出站端口统一执行 deadline。到期进入 `send_outcome_unknown`，释放账号 lane，禁止自动网络重发；晚到结果按 execution generation 丢弃。
2. WhatsApp deadline 主动终止当前 socket generation；Telegram deadline 隔离当前 client、受控断开并重连。
3. Telegram 文本、媒体、原生表达式、reaction、revoke 在远端接受后，本地失败统一返回 durable repair，不回到网络重试。
4. Telegram 入站先提交正文、会话和 pending attachment，再运行持久化媒体/头像 enrichment job；实时异常写 fail checkpoint 并释放 claim，历史失败不推进游标。
5. AI JobQueue 增加执行 watchdog、强制槽位回收、generation 和 late-completion 拒绝；重启时持久 running task 进入明确 interrupted/failed。
6. 入站消息事务内创建 durable `ai-conversation-analysis` job，关闭“落库后、debounce 前崩溃”漏分析窗口。
7. 学习反馈与 projection job 同事务提交；scope/L1 通过 token、lease、retry 状态逐项收敛；按 scope 排队而非全局队列，回复只做 150ms 有界等待并使用上一稳定版本。
8. 学习启动与周期对账分页处理超过 500 条积压。
9. `AI_REPLY_CANDIDATE_READY` 在 Store transaction 内比较 expected conversation revision/entity versions，旧候选不落库。
10. Facebook raw response body 拥有独立 deadline 和 body cancel。
11. Telegram QR polling、phone login、connect/disconnect/history SDK 调用均有统一期限。
12. Schema 10/11 migration snapshot 使用 PID+UUID，消除不同数据库并行迁移时的文件名碰撞。

## 自动验证

- 完整后端并行密封：**167 文件，1007/1007 PASS，0 fail，0 skipped**。
- Batch 26 阻断级反向测试：**19/19 PASS**。
- Round 12：79/79 PASS。
- Round 13：24/24 PASS。
- 平台生产就绪：58/58 PASS。
- UAT Diagnostics：142/142 PASS。
- Source UAT Delivery：33/33 PASS。
- Final Review：34/34 PASS。
- Component Readability：6/6 PASS。
- Root Cause Closure：2/2 PASS。
- 变更 JavaScript：28/28 语法 PASS；`git diff --check` PASS。

## 未关闭项

- Batch 26 最终源码 clean `npm ci` 需在真实 Windows 全新目录重新执行。
- 真实 WhatsApp/Telegram/Facebook timeout、late ACK、重复抑制、断网、重启对账待验证。
- 真实 OpenRouter 两个不同模型的 timeout、429、余额不足、取消和供应商切换待验证。
- Windows 睡眠/唤醒、系统时间跳变、强杀 Electron/Backend 后任务恢复待验证。
- 独立审核和授权未完成。

因此本报告不授权晋升或正式发布。
