# Yance Architecture Closure V2 — WP-A Task A3 独立源码复审

- 文档类型：`INDEPENDENT_SOURCE_REVIEW`
- 工作包：`WP-A`
- 任务：`A3 — AuthorityTransactionCoordinator`
- 复审代码 Head：`d559c8e76a1f67717da2146151fd552fec51539c`
- 复审结论：`APPROVED_AFTER_LEDGER_SEQUENCE_AND_GOVERNANCE_CONTRACT_ROOT_REPAIR`
- Open P0：`0`
- Open P1：`0`
- PR 状态要求：`Draft`
- A4 生产实现授权：`false`

## 1. 复审范围

本轮只复审 A3 与被 A3 独立复审重开的 A1 Schema 21 基础合同，不审查、授权或暗示 A4–A8、WP-B–WP-H、Gate 1、候选包、合并、推广或发布。

核验文件包括：

- `backend/services/authorityTransactionCoordinator.js`
- `backend/services/authorityCommandProtocol.js`
- `backend/services/authorityTransactionContext.js`
- `backend/services/externalIoBoundaryGuard.js`
- `backend/services/projectorSqlPolicy.js`
- `backend/migrations/architectureClosureV2WpA.js`
- A3、Schema 21 与 adversarial 测试
- A0 source-closure 治理测试与 `wp-a-baseline.json`

## 2. 最终根因修复

### 2.1 全局 ledger sequence

失败 Head `597162e39f9d13ab41d3a3be79830e615bfe3133` 已证明 Schema 21 要求 `canonical_event_headers.ledger_sequence NOT NULL`，但 coordinator 仍先插入 Header、再读取 `rowid`，导致 Ubuntu/Windows A3 同源失败。

最终修复不增加默认值、不复用 aggregate version、不新增兼容列：

1. 在当前 `BEGIN IMMEDIATE` 权威事务内读取 `MAX(ledger_sequence)+1`；
2. 将该序号与完整 Header 元数据一次性写入；
3. Header 插入仍同时受 aggregate expected version 与当前 host generation/fencing 条件约束；
4. projection checkpoint 使用同一 ledger sequence。

由于 SQLite 当前只有一个 AuthorityWriteHost，且 coordinator 事务以 `BEGIN IMMEDIATE` 串行化写事务，序号分配与插入之间不存在第二写入者竞争窗口。

### 2.2 Projector 数据库能力

Projector 不再获得 raw primary database：

- 只获得事务期 `prepare()` facade；
- SQL 必须先经过词法策略验证；
- 禁止事务控制、多语句、Schema 操作、attachment、authority tables、SQLite 内部对象、随机值、隐式时钟、localtime 与 extension 加载；
- callback 返回后 capability 和已创建 statement 同时失效；
- Promise projector、保留句柄异步写入和 fire-and-forget 写入均 fail closed；
- ledger payload 深度冻结。

### 2.3 原子提交与外部 I/O

同一事务内提交：

```text
canonical event header
+ managed payload
+ authoritative projection
+ projection checkpoint
+ command receipt
```

任一 projector、hash、checkpoint、external-I/O guard 或 host fencing 失败会回滚全部事实；进程事件只在 commit 后发布，通知失败不会回滚已经提交的权威事实。

### 2.4 治理合同

A0 测试此前读取已废弃的顶层 `a3TestCodeAllowed` / `a3ProductionCodeAllowed` 字段，无法表达“任务被独立复审重开”的治理状态。

最终测试改为验证：

- A0 证据不变；
- completed/reopened/current task 的 A0–A8 序号单调；
- A3 review RED、root repair 与独立复审要求存在；
- production scope 只覆盖 A1 Schema 基础与 A3 coordinator；
- A4 仍锁定；
- 最终 source-closure scanner 仍独立 fail-closed 到 A8。

这不是放松门禁，而是移除过时状态字段与架构真值之间的耦合。

## 3. 验证证据

### 3.1 ACV2 平台矩阵

- Run：`30742117971`
- Ubuntu Job：`91481252161` — `SUCCESS`
- Windows Job：`91481252158` — `SUCCESS`
- Source Closure Job：`91481252131`
  - A0 registry/open-state contract：`SUCCESS`
  - 最终 WP-A scanner：`EXPECTED FAILURE UNTIL A8`

每个平台执行：

- Windows runtime mutex helper：3/3
- AuthorityWriteHost / Schema 21：7/7
- 真实进程竞争与强杀接管：2/2
- A2 canonicalization / classification / replay：33/33
- A3 coordinator / schema / adversarial：24/24
- 旧 SQLite ownership / path / stale fencing：22/22

### 3.2 WP0 与源码身份门禁

- Run：`30742117979` — `SUCCESS`
- WP0 Job：`91481252166` — `SUCCESS`
- sealed-export Ubuntu：`91481252192` — `SUCCESS`
- sealed-export Windows：`91481252177` — `SUCCESS`

WP0 required tests、staged-secret scanner、源码身份/Electron tracking、协议描述符及 local-equivalent gate 均成功。

## 4. CodeRabbit 状态

已在 PR #5 通过 comment `5156916790` 请求 CodeRabbit 复核最终 Head；机器人通过 comment `5156917299` 返回：当前账号未分配 Pro seat。

因此：

- CodeRabbit 正式 review 未执行；
- 本文不声称 CodeRabbit raised 0 issues；
- CodeRabbit 的缺失不被伪装成独立审查通过；
- 本轮批准来自本独立源码复审与可执行双平台证据。

## 5. 禁止绕过核验

未发现：

- 超时或参数放宽；
- compatibility column 补丁；
- aggregate version 冒充 ledger sequence；
- raw primary database 传给 projector；
- 测试 skip 或弱化；
- branch wildcard；
- source-closure 门禁降级；
- A4 或后续工作包生产实现。

## 6. 结论与下一授权

A3 在 Head `d559c8e76a1f67717da2146151fd552fec51539c` 上满足关闭条件：

```text
openP0=0
openP1=0
ubuntuA3AndLegacyRegressions=PASS
windowsA3AndLegacyRegressions=PASS
wp0=PASS
sourceClosureA0Contract=PASS
finalSourceClosureRemainsFailClosedUntilA8=true
```

下一步只能进入 **A4 test-first RED**：创建 `canonicalEventLedgerAuthority.test.js` 和 `domainEventCompatibilityFacade.test.js`，验证唯一 ledger 实现/append path、compatibility facade 无独立 persistence、hash/version/immutability fail-closed，以及 Evidence 不接收业务正文。

在可信 A4 RED 固化前：

- 不创建或修改 A4 生产实现；
- A5–A8 继续锁定；
- WP-B–WP-H、Gate 1、候选包、合并、推广和发布继续锁定。
