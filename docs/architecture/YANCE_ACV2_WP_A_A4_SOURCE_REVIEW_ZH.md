# Yance ACV2 WP-A Task A4 独立源码复审

## 结论

**Decision：`APPROVED_AFTER_THREE_ADVERSARIAL_REOPENS_AND_ROOT_REPAIRS`**

- Open P0：0
- Open P1：0
- PR 状态：必须保持 Draft
- A5–A8、WP-B–WP-H、Gate 1、候选包、合并、推广与发布：继续锁定
- 本结论只关闭 A4，不构成 WP-A 总关闭或发布授权。

## 审阅范围

最终生产实现 Head：`0eda8a159db88d15379ae8d66a504e3aa5f80dbd`

A4 生产范围：

- `backend/services/canonicalEventLedgerAuthority.js`
- `backend/services/domainEventLogService.js`
- `backend/repositories/platformCoreRepository.js`（保留 legacy 方法源码；运行期由持久数据库触发器 fail closed，A6/A8 继续治理源码残留）

A4 测试范围：

- `backend/tests/architectureClosureV2/wpA/canonicalEventLedgerAuthority.test.js`
- `backend/tests/architectureClosureV2/wpA/domainEventCompatibilityFacade.test.js`

## TDD 与重开记录

### 初始 RED

- RED Head：`ae43ede5c096ec6438969294d9c8248ad3196be0`
- Run：`30742811474`
- Ubuntu Job：`91483141685`
- Windows Job：`91483141676`
- 结果：每个平台 A1–A3 全绿，A4 `0/8` 预期失败。

初始缺口：缺少唯一 canonical ledger authority；旧 `domainEventLogService` 仍自行 canonicalize、redact、生成身份并调用 repository 持久化；header/payload 不可变、hash mismatch、direct repository append 与 Evidence 边界未形成统一合同。

### 第一次独立复审重开

- RED Head：`edceded87c86af6759ed127babcfb3f2fe1d1c8d`
- Run：`30743381932`
- Ubuntu Job：`91484674100`
- 结果：A4 `7/10`，精确暴露三项缺口：
  1. replay payload 仅浅冻结；
  2. authority 顶层 unknown/symbol/accessor 字段未严格 fail closed；
  3. 同一 scoped external event 可通过不同幂等键形成重复事实。

根修复：输入字段精确白名单、descriptor 检查且不执行 getter、symbol/prototype key 拒绝、replay payload 深冻结、scoped external identity 参与确定性聚合根。

### 第二次独立复审重开

- RED Head：`3f438629d92aaeba9ed127c96b384dc2d7cf614e`
- Run：`30743693050`
- Ubuntu Job：`91485497265`
- 结果：A4 `9/10`，唯一失败为调用方使用不同显式 `aggregateId` 绕过 scoped external identity 唯一性。

根修复：scoped external event 固定绑定：

- aggregate type：`ExternalDomainEvent`
- aggregate ID：由 `platform + sourceAccountId + eventType + externalEventId` 确定性生成
- expectedVersion：固定为 `0`，非零直接 fail closed
- 调用方显式 aggregate type/ID 不再影响外部事件唯一根。

## 最终架构判断

### 1. 唯一 ledger 与 append path

`CanonicalEventLedgerAuthority.append()` 是 A4 唯一权威 append 入口，并通过 `AuthorityTransactionCoordinator` 将 header、payload、projector checkpoint、receipt 与投影结果放在同一权威事务中。旧 `domainEventLogService.js` 已降为纯委托 facade，不再拥有独立哈希、脱敏、身份生成或 repository persistence。

### 2. 不可变与直写阻断

Authority 初始化安装持久 SQLite triggers：

- committed `canonical_event_headers` 禁止 UPDATE/DELETE；
- active `authority_payload_store` 禁止 UPDATE/DELETE；
- legacy `domain_events` 禁止 INSERT，错误为 `CANONICAL_EVENT_LEDGER_APPEND_REQUIRED`。

`platformCoreRepository.insertDomainEvent` 的源码方法仍存在，原因是 A4 未扩大到全仓 call-site 删除；但真实 DB 写入在 authority 启动后由持久触发器拒绝。其启动前不可达性由 A6 的 write-host/ledger startup ordering 门禁负责，最终源码零 writer 由 A8 source-closure 负责。因此该残留不是 A4 双写许可，也不能被描述为已全仓删除。

### 3. Hash 与 replay

读取 canonical event 时同时校验：

- canonical payload 重新计算 hash；
- header `payload_sha256`；
- payload store `payload_sha256`。

任一不一致均 fail closed。返回 payload 递归冻结，调用方不能修改嵌套业务数据。

### 4. 输入边界

Authority 顶层输入仅接受冻结字段集合；未知字段、symbol key、accessor、prototype mutation key 与非 plain object 均拒绝。Accessor descriptor 在读取 value 前检查，测试证明 getter 不会执行。

### 5. Evidence 边界

Evidence 只接收 event ID、aggregate/version、ledger sequence、payload hash/classification、command/trace、generation/fencing、commit time 与 redaction count；不接收 `payload`、`canonicalJson` 或业务正文。业务 payload 仅保留在 canonical payload store 供 replay。

### 6. Scoped external identity

外部事件 scope 包含 `platform + sourceAccountId + eventType + externalEventId`。该 scope 固定决定单事件 aggregate root，显式幂等键、aggregate type/ID 与非零 expectedVersion 均不能制造第二事实。

## 最终验证

最终 ACV2 Run：`30743781529`

- Ubuntu Job `91485738360`：SUCCESS
- Windows Job `91485738414`：SUCCESS
- A4：`10/10` PASS / platform
- A2：`33/33` PASS / platform
- A3：`24/24` PASS / platform
- 旧 SQLite ownership/path/fencing：`22/22` PASS / platform
- Source Closure Job `91485738387`：A0 合同 SUCCESS；最终 scanner 按 A8 前规则保持 EXPECTED FAILURE。

最终 WP0 Run：`30743781521`

- WP0 Job `91485738358`：SUCCESS
- sealed-export Ubuntu `91485738355`：SUCCESS
- sealed-export Windows `91485738341`：SUCCESS

## CodeRabbit 限制

- 最终请求评论：`5157199728`
- 机器人回复：`5157200259`
- 结果：`NOT_EXECUTED_PRO_SEAT_NOT_ASSIGNED`

正式 CodeRabbit review 未执行，因此不声明“0 issues”。独立源码复审、TDD 重开记录和 GitHub 双平台门禁构成本轮关闭依据。

## 修复方式核验

- 未使用 feature flag、warning-only guard、兼容双写或参数放宽；
- 未修改 RED 断言以迎合旧实现；
- 未弱化 A0/source-closure 门禁；
- 未把 Windows 文件句柄清理问题伪装为业务通过；清理改为真实 `checkpointAndClose()`；
- 未修改 A5 或后续生产代码。

## 下一授权边界

A4 关闭后只允许 A5 的 test-first RED：

- `backend/tests/architectureClosureV2/wpA/identityAuthority.test.js`

A5 生产文件仍锁定：

- `backend/services/identityAuthority.js`
- `backend/services/canonicalIdentityService.js`
- `backend/services/identityLinkAuthority.js`

可信 A5 RED 固化前不得修改上述生产文件。
