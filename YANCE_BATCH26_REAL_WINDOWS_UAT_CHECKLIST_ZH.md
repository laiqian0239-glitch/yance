# 言策 Batch 26｜真实 Windows / 平台 / OpenRouter UAT 清单

## A. 制品与安装

- 校验 PackageCommit、PackageTree、源码 ZIP SHA256、Bundle HEAD。
- 在全新目录执行 clean `npm ci`；保存 npm ci 与 `npm ls --depth=0` 完整日志。

## B. 平台超时与 late ACK

每个平台分别执行 text、emoji-only、media、reaction/revoke：

1. 正常 ACK；
2. SDK 网络调用延迟超过 deadline；
3. deadline 后再返回 late ACK；
4. 本地 SQLite/媒体投影失败；
5. 强杀并重启；
6. 对账 Queue、Message、repair job、ACK evidence，确认网络调用一次且不重复发送。

## C. Telegram 入站与历史

- 大媒体下载永久悬挂时，文本和 pending attachment 先可见。
- sender/avatar 超时不阻塞正文。
- live handler 在 claim、message commit、enrichment schedule 各边界强杀并重启。
- history 第 N 条失败时 checkpoint 不越过失败消息，重启补齐。
- QR、手机号、两步密码、disconnect、history sync 分别测试 timeout 和重启恢复。

## D. AI Runtime / OpenRouter

- 两个不同模型分别验证正常、timeout、429、余额不足、取消和供应商切换。
- Provider 忽略 AbortSignal 时槽位仍回收，其他联系人回复不阻塞。
- 模型运行中强杀，重启后任务明确 interrupted/failed 或按 snapshot 重建，不得永久 running。
- 入站落库后、analysis 执行前强杀，重启后事实提取与理解任务恢复。

## E. 学习闭环

- 在 feedback、scope、L1 各边界强杀；重启后全部一次且仅一次完成。
- 1201 条 pending 分页清空并保留真实 backlog 指标。
- 一个学习任务悬挂时，其他联系人的回复可使用上一稳定版本继续生成。

## 治理

任一真实项目未通过，维持：`WINDOWS_UAT_BLOCKED / formalRelease=false / readyForPromotion=false`。
