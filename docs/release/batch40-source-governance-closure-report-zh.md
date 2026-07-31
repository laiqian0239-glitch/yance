# Batch40 源码治理闭环复审报告

日期：2026-07-30

## 结论

Batch40 Task 1–8 的生产路径已完成第二轮独立源码复审。复审发现并修复两项
P1 反证：物理 execution ID 重绑定持久化失败被吞掉，以及 Stage 6.3.4 在
数据库身份或 WAL checkpoint 失败后仍可能继续创建快照并迁移。修复提交为
`4c3e1b46c4eddfd0ee62f77f069377b809acc692`。

在当前可执行的源码、聚焦及继承门禁范围内，没有遗留 P0/P1 源码反证。
但最终 HEAD 的完整后端 runner 未取得终态汇总：运行到第 125 个已发现测试
文件、准备进入 `platformAuthConfigRegression.test.js` 时，执行环境因后续测试
可能向未受信任外部主机发送未知 payload 而拒绝继续。该运行没有
`ALL DONE`，不得记作完整通过，也不得以历史 190/190 结果替代。

因此最强且唯一允许的治理状态为：

```text
WINDOWS_UAT_SOURCE_READY_EXTERNAL_EVIDENCE_REQUIRED
readyForPromotion=false
formalRelease=false
```

## 身份与提交

- 可验证重建审查基线：`933f3a0d97aba16c663666699af5596099ba684a`
- Task 1：`a9608e135a08b2f7c1bb37c897be54a12fdf0292`
- Task 2：`64344aac8944c95a2f57b625c56c95ebfa8729a2`
- Task 3：`482fdc2c7c8648381e008359cc8cf9458d3f487a`
- Task 4：`43b55ec9730d4948998499b1d74f11c2d5325d08`
- Task 5：`23b86a3d8dafc3cc3304ddcfd2d39affb8fc8763`
- Task 6：`46c5d7d6973bff4d7fada3c5c2a1bb27ecd2a65b`
- Task 7：`49fc41d6afd2499c48a438fbd8cd4ba5a110b46d`
- Task 8：`6bc63dba97a53a56154455b7bfd6e95b56fa2d10`
- 独立复审修复：`4c3e1b46c4eddfd0ee62f77f069377b809acc692`

设计文档标注的 `3620d37` 不在当前重建对象库中，未把不可解析 SHA 伪作
Git diff 证据。全部 Task 1–8 差异以 Task 1 的真实父提交 `933f3a0` 为基线
复核。

## 新鲜验证证据

执行环境：

- Node：`/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`
- Node 版本：`v24.14.0`
- 临时目录：由 `backend/run_all_tests.js` 创建并统一传给
  `TMPDIR`、`TEMP`、`TMP`；聚焦验证使用工作区 `backend/.test-tmp`。

完成的最终聚焦门禁：

- 6 个关键生产文件 `node --check`：通过；
- Batch40 行为门禁：27/27 通过；连同关键继承门禁共 51/51 通过，0
  fail/skipped/cancelled/todo；
- 其中 migration/identity/learning 继承门禁：21/21；
- 物理执行、持久化和 Provider 隔离门禁：15/15；
- `git diff --check`：通过。

完整 runner 事实：

- 最终源码发现 `191` 个 `backend/tests/**/*.test.js` 文件；
- 本次启动 `125` 个文件；
- 日志最后启动项：
  `tests/platformAuthConfigRegression.test.js`；
- 没有 `FAILED:` 标记，但也没有 `ALL DONE` 或父进程 exit 0；
- 日志 SHA-256：
  `4f5a7283fcc0eb7580e44ea72c0e2c0a02e9b31d353168336d481f9b9747e37a`；
- 结论：环境/安全策略阻断，既不是产品失败，也不是完整通过证据。

## 独立生产路径复审

1. AI 主模型、fallback 和 context-reduction 的结果在成功计数、调用账本、
   完成事件及返回成功前共同执行 generation/signal fence；迟到结果只发审计。
2. 同 `taskId` 替换按 task 串行，必须取得匹配 execution ID 的真实退出回执，
   再执行 durable generation/fingerprint CAS；旧 `finish()` 不能删除新代。
3. JobQueue 的正常写、execution ID 重绑定写和恢复均使用同一 persistence
   health；写失败后停止新 enqueue/drain，`UNKNOWN` 只有匹配退出回执才能释放。
4. Provider capacity 以入队后固化的 provider key 计数，selection、reject、
   drain 和 status 共用 `providerExecutionDecision()`。
5. 学习任务的 signal、deadline、logical task ID 和 generation 贯穿分页、
   外部 await 与事务提交；future retry 仍计入 unresolved ledger。
6. Stage 6.3.4 在事务开始前取得数据库身份、通过真实 statement API 完成
   `PRAGMA wal_checkpoint(FULL)`、验证源/目标 identity/hash/bytes，并原子发布
   manifest；身份或 checkpoint 失败均 fail-closed。
7. 后端 runner 导入无副作用，每轮只创建一个存在的绝对 temp root并传给所有
   child。
8. 控制矩阵保留 107 个历史唯一 control ID，并加入 9 个 Batch40 control；
   外部 Windows/平台项仍无 PASS evidence。

## 独立复审发现与处置

### P1：物理 execution ID 重绑定写失败被吞掉

原路径直接执行 SQLite `UPDATE` 后用空 catch 忽略错误，可能导致内存与 durable
execution identity 分裂而健康状态仍为 `healthy`。现已接入
`markPersistenceDegraded()`；故障注入证明当前任务可结算，但后续工作
fail-closed。

### P1：WAL checkpoint 与数据库身份失败被吞掉

原路径使用当前 SQLite 适配器不支持的 `.pragma()`，TypeError 被吞掉；同时
`PRAGMA database_list` 失败被误当作非文件数据库。这可能使快照遗漏 WAL 中
已提交数据。现改为真实支持的 statement API，并把两种失败分别规范为
`MIGRATION_SNAPSHOT_CHECKPOINT_FAILED` 与
`MIGRATION_SNAPSHOT_IDENTITY_INVALID`，均在迁移事务前终止。

## 外部 Windows acceptance

`scripts/create-batch40-windows-acceptance.js` 生成绑定当前 commit/tree 的 ZIP
和 SHA-256。包内只有 manifest、Windows 命令、中文说明和空 evidence
template，不含预制 PASS。真实 Windows 主机必须回传：

- Batch40 聚焦与完整后端 runner 的原始日志、退出码和严格计数；
- Windows Named Mutex 真实证据；
- Facebook、Telegram、WhatsApp 真实账号 ingress/egress 平台 message ID 与
  本地 durable receipt；
- 真实 AI Provider 的取消、替换、超时、持久化降级和恢复回执；
- 安装包/runtime 版本、commit/tree、证据文件 SHA-256 和独立复核签署。

上述证据全部通过并经独立复核前，不得推进 promotion 或 formal release。
