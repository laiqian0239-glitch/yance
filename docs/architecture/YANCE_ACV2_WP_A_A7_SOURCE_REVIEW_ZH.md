# Yance ACV2 WP-A A7 独立源码复审

## 1. 复审范围

- `backend/services/ledgerReplayAuthority.js`
- `backend/services/ledgerArchiveAuthority.js`
- `backend/tests/architectureClosureV2/wpA/ledgerReplay.test.js`
- `backend/tests/architectureClosureV2/wpA/ledgerArchiveFaultMatrix.test.js`
- `tools/architecture-closure-v2/wp-a-replay-evidence.js`
- `governance/architecture-closure-v2/wp-a-a7-task-contract.json`

复审候选代码 Head：`15512d531079334829f3ebf2d04ab174cec58a8c`。

## 2. 独立结论

结论：`SOURCE_REVIEW_PASSED_FINAL_PLATFORM_GATES_REQUIRED`。

- Open P0：0
- Open P1：0
- A7 在最终 Ubuntu、Windows、WP0 与 sealed-export 复验通过前不得关闭。
- PR #5 必须保持 Draft，不得合并、推广、打包或发布。

## 3. Replay Authority 核验

1. Replay 只消费显式 `fromSequence..toSequence` 连续区间；缺口、重复、逆序及范围不完整均 fail closed。
2. 每个 payload 在 upcast 前校验 `payloadSha256`，每个事件 envelope 在 upcast/reducer 前校验 `eventSha256`。
3. `readEvents`、upcaster、reducer 与 evidence recorder 均禁止 Promise/thenable，避免异步 I/O 或调度时序进入确定性重放路径。
4. 初始状态、事件、upcast 结果和 reducer 状态均经 canonical serialization 克隆并深冻结；调用方对象不会成为可变权威状态。
5. reducer 完成后生成确定性的 `stateSha256` 与 `replaySha256`；取消路径不记录成功证据。
6. Replay 不持有 canonical ledger 写能力，不会回写生产 authority 状态。

## 4. Archive Authority 核验

1. `readSegment` 必须返回绑定 `segmentId` 与 `snapshotToken` 的版本化快照；裸事件数组、错 segment、无效 token 均拒绝。
2. archive 文档包含 snapshot token、精确首尾序列、事件数量和完整 canonical events，并以 canonical bytes 与 SHA-256 内容寻址。
3. 写入后必须取得精确 archive identity 回执，并重新读取 canonical bytes；bytes、digest、segment、snapshot token、边界或数量任一漂移均禁止 retire。
4. retirement evidence 在 retire 前生成，evidence recorder 必须返回匹配 `evidenceSha256` 的持久确认回执。
5. retire 请求绑定 `segmentId + snapshotToken + archiveId + archiveSha256 + evidenceSha256`；返回回执必须精确匹配当前快照。
6. write、read-back、digest、evidence、cancel、stale receipt 或 retire 失败均 fail closed；authority 本身不会走第二写路径。

## 5. 对抗性边界

已形成可执行合同覆盖：

- sequence gap / duplicate / reorder；
- payload 与 event hash 篡改；
- async upcaster / reducer；
- replay cancellation；
- unversioned snapshot；
- archive write/read-back/digest/evidence 故障；
- stale、缺字段及错 snapshot retirement receipt；
- cancellation 时不写 archive、不 retire；
- retirement evidence 先于 snapshot-bound atomic retire。

## 6. 非阻断边界与后续归属

- A7 提供确定性 replay/archive authority 合同，不声明跨进程 durable command/receipt 调度已经完成；该能力属于后续工作包。
- A7 不关闭 WP-A 全仓 writer inventory；source closure 仍由 A8 独占负责。
- 测试 fixture 的内存 archive/evidence/retirement adapter 只用于合同证明，不得描述为生产持久层实现。

## 7. 最终关闭条件

A7 仅在下列条件同时满足后可写入 closure receipt：

1. 本复审文件所在最终候选 Head 的 A7 contracts 在 Ubuntu 与 Windows 均通过；
2. A1–A6 回归在同一 Head 保持通过；
3. WP0 product gate 与 sealed-export Ubuntu/Windows 均通过；
4. source-closure failure 仅来自 A8 保留缺口；
5. PR 仍为 Draft，`readyForPromotion=false`。
