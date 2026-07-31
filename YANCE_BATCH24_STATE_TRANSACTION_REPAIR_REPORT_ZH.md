# 言策 f25fe2e Batch 24｜状态持久化与事务一致性根因修复报告

## 1. 身份与治理

- Branch：`development/windows-uat-f25fe2e-repair-batch24-state-transaction-closure`
- ImplementationCommit：`4582160eefb2f8c9fc628ac4aecfc9e035e87226`
- ImplementationTree：`6784e899382166545c180b1e9981d24c236c2376`
- Parent PackageCommit：`2b99f855628579624ee4a8fb9f768f6e2754e996`
- 权威原始基线：`f25fe2e2b4f065d2c09de034eddb67857eeb83bb` / `015f7969a2363952071bf11f4da3eb2adaf7edbf`
- 状态：`REPAIR_ATTEMPT_IN_PROGRESS`
- Windows UAT：`WINDOWS_UAT_BLOCKED`
- `formalRelease=false`
- `readyForPromotion=false`

本报告只登记源码修复和自动故障注入结果。真实 Windows Electron、真实平台 ACK、真实 OpenRouter 和独立审核未完成，不能据此宣布最终关闭。

## 2. 本轮公共层修复

1. **启动恢复与单写 Owner**：Boot Phase 0 在任何主库写句柄前执行；主库由 Broker 统一持有；第二进程和设置 Worker 不能写活动主库。
2. **出站原子事务**：ExternalIdentity、Conversation、不可变 RouteVersion、Queue、Message、摘要与绑定在同一 SQLite 事务中创建。
3. **Queue CAS**：claim generation、token、lease、row version 约束领取与完成；迟到 callback 无法覆盖新状态。
4. **本地 ACK checkpoint**：Queue 状态和 outbound Message receipt 同事务提交；远端 ACK 与本地 SQLite 之间继续使用 durable acceptance journal。
5. **Hydration barrier**：凭据、SQLite 与 Adapter 未对账完成前只发布 `recovering`，不提前发布 `unconfigured/blocked` 假权威。
6. **账号 Saga**：connect/disconnect/logout/remove 持久记录 phase；Adapter 成功而 SQLite 失败时进入补偿或 manual review，回滚有独立超时。
7. **Event projector**：DomainEvent 与 projection job 同事务创建；重启按既有 eventId 重放，失败可重试或隔离，不返回“全部失败”假语义。
8. **Identity outbox**：身份事务内必写 outbox；processing 使用 token、lease 和迟到 finalizer CAS。
9. **不可变 RouteVersion**：Queue 必须引用具体版本；数据库拒绝非法 state、错账号、错会话或错平台作用域；WhatsApp LID 合并和跨账号迁移会原子生成 canonical 新版本。
10. **账号与设置投影**：通用账号更新不清空兼容能力；授权提升、默认账号和 audit 同事务；RuntimeSettings 通过共享 Broker 串行合并。
11. **认证重启恢复**：RUNNING auth operation 按 resume policy 恢复或明确失败，旧 generation 回调被拒绝。
12. **最终遗漏修复**：人工 `confirmed_not_sent/cancelled`、手动 retry/cancel 与 Message receipt 改为同事务，receipt 失败时 Queue 和 row version 全部回滚。

## 3. 自动证据

- 完整后端：**165 个文件，981/981 PASS，0 失败，0 跳过**。
- Batch 23/24 状态与事务专项：**23/23 PASS**。
- Round 12 平台核心：**79/79 PASS**。
- Round 13 AI 质量：**24/24 PASS**。
- 平台生产就绪：**58/58 PASS**。
- UAT Diagnostics：**142/142 PASS**。
- Source UAT Delivery：**33/33 PASS**。
- Component Readability：**6/6 PASS**。
- Final Review：**34/34 PASS**。
- Root Cause Closure：**2/2 PASS**。
- Protocol V3：**2/2 PASS**。
- 变更 JavaScript 语法：**53/53 PASS**。
- `git diff --check`：PASS。

完整后端采用逐文件独立数据目录，避免并行测试进程争用同一主库而产生假失败。R5 汇总 SHA256：`169967c74f18db8f9c7006cf423f66acbd3498cf1a4d5a0da3f2a2b656733a36`。

## 4. clean npm ci

在全新目录执行 clean `npm ci` 时，依赖网关下载 `yauzl-2.10.0.tgz` 返回 HTTP 503。该项登记为环境阻断，不登记为源码 PASS，也不据此推断源码失败。原始日志 SHA256：`a6f25c879264814d80b491c9e841f5c336a6269b0db209021204526196f89d9d`。

## 5. 尚未关闭

- 真实 Windows 10/11 冷启动、正常退出、强制结束、重启和 EBUSY/EPERM 文件锁证据；
- WhatsApp、Facebook、Telegram 的真实入站、出站、text/emoji/media ACK、Echo、对账和强关恢复；
- 真实 SQLite 表快照与重启前后收敛对比；
- 真实 OpenRouter 两个不同模型 2/2 冒烟；
- clean `npm ci` 成功证据；
- 独立审核与 UAT 授权。

## 6. 结论

Batch 24 已完成交接文档 11 个工作包及追加人工 Queue 状态事务旁路的源码实现和自动验证。所有项目仍保持 `WINDOWS_UAT_BLOCKED`，不得晋升。
