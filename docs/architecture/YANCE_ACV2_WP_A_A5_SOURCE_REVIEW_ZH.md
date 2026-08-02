# Yance Architecture Closure V2 — WP-A Task A5 独立源码复审

## 1. 复审结论

- 复审对象：WP-A Task A5 — IdentityAuthority 与 canonical scoped IDs
- 最终代码 Head：`eae90377b78768a2f8779049f60f5b486e05f40c`
- 结论：**APPROVED_AFTER_TWO_ADVERSARIAL_REOPENS_AND_ROOT_REPAIRS**
- Open P0：`0`
- Open P1：`0`
- PR 状态要求：继续保持 Draft
- 本结论不构成 A6–A8、WP-B–WP-H、Gate 1、候选包、合并、推广或发布授权。

## 2. 审查范围

生产文件严格限定为：

1. `backend/services/identityAuthority.js`
2. `backend/services/identityLinkAuthority.js`
3. `backend/services/canonicalIdentityService.js`

测试与证据载体：

- `backend/tests/architectureClosureV2/wpA/identityAuthority.test.js`
- `.github/workflows/acv2-wp-a.yml`
- `governance/architecture-closure-v2/wp-a-a5-red-evidence.json`
- `governance/architecture-closure-v2/wp-a-a5-review-red-evidence.json`
- `governance/architecture-closure-v2/wp-a-a5-evidence.json`

## 3. 最终架构判断

### 3.1 单一身份 authority

`IdentityAuthority` 现为跨平台身份事实的唯一服务边界，承接 scoped identity 观察、状态转换、验证、合并、回滚和解析。旧 `IdentityLinkAuthority` 仅导出同一类与同一 singleton；旧 `canonicalIdentityService` 仅通过同一 singleton 转发兼容 API，不再直接暴露 repository 作为第二服务事实源。

### 3.2 canonical scope 与确定性 ID

外部身份 scope 固定包含：

- `workspaceId`
- `platform`
- `sourceAccountId`
- `externalId`

Person ID 与 IdentityLink ID 均由完整 scope 确定性生成。平台、来源账号或外部 ID 任一变化都会进入不同哈希域，避免跨账号或跨渠道误合并。

### 3.3 弱信号不能触发身份合并

显示名、头像 URL、username、格式化电话号码只能作为观察数据，不能单独成为合并授权。旧 WhatsApp canonicalization 执行前必须先 dry-run；每个计划合并组至少包含以下一种强证据：

- `jid:`
- `credential:`
- `source:`

仅含 `phone:` 等弱 token 的组在任何写入前 fail closed，错误码为 `IDENTITY_CANONICALIZATION_WEAK_SIGNAL_FORBIDDEN`。

### 3.4 输入边界 fail closed

scope 与公开身份操作输入通过 property descriptor 构造安全快照：

- accessor 不执行 getter，直接拒绝；
- Symbol 键直接拒绝；
- 非 plain object 直接拒绝；
- prototype mutation key、敏感字段、循环引用和非 JSON 数据继续由底层校验拒绝。

### 3.5 事务与事件边界

observe、transition、merge、rollback 的数据库事实、审计和 operation receipt 在 repository 事务内完成；identity domain event 在事务返回后统一发布。失败事务不会先发出成功事件，也不会在主事务中执行第二条事件持久化链。

## 4. TDD 与复审重开记录

### 4.1 初始可信 RED

- Head：`4711e319e9e4bc85255582b70b01d6d6d312696e`
- Run：`30744296174`
- Ubuntu Job：`91487138223`
- Windows Job：`91487138219`
- 结果：A5 `0/4`，缺少 `identityAuthority.js`；A1–A4 保持全绿。

### 4.2 第一次独立复审重开

- Head：`ef847d6140d77e59645b481a7ff3c0cc29dbf160`
- Run：`30744907149`
- Ubuntu Job：`91488728958`
- Windows Job：`91488728964`
- 结果：A5 `4/7`。

暴露的根因：

1. scope getter、Symbol、非 plain object 边界未 fail closed；
2. legacy canonical service 仍直接引用 repository；
3. transition/merge/rollback 事件仍可在 repository 事务内记录。

修复方式：统一 descriptor-safe 输入边界、单例 authority facade、事务后 `finalizeOperation` 事件发布。

### 4.3 第二次独立复审重开

- Head：`d1157378bef4da76600d2c08f131058dec435d13`
- Run：`30745355767`
- Ubuntu Job：`91489897796`
- Windows Job：`91489898063`
- 结果：A5 `7/8`。

暴露的根因：旧 canonicalization 可使用 phone-only 共享 token 执行合并。

修复方式：执行前强制 dry-run 证据审查；缺少 JID、credential 或 managed source 的组整体 fail closed，禁止部分执行。

## 5. 最终验证

最终代码 Head `eae90377b78768a2f8779049f60f5b486e05f40c`：

- ACV2 Run：`30745488892`
  - Ubuntu Job `91490249468` — SUCCESS
  - Windows Job `91490249479` — SUCCESS
  - Source Closure Job `91490249445`
    - A0 registry/open-state contract — SUCCESS
    - 全仓 scanner — EXPECTED FAILURE UNTIL A8
- WP0 Run：`30745488917` — SUCCESS
  - WP0 Job `91490249593` — SUCCESS
  - sealed-export Ubuntu `91490249592` — SUCCESS
  - sealed-export Windows `91490249601` — SUCCESS

每个平台共同通过：

- A5 identity authority：`8/8`
- targeted legacy identity observe/verify/merge/rollback：PASS
- A4 canonical ledger/facade：`10/10`
- A3 coordinator/schema/adversarial：`24/24`
- A2 canonical/classification/replay：`33/33`
- AuthorityWriteHost / Schema 21：PASS
- 真实进程竞争与强杀接管：PASS
- 旧 SQLite ownership/path/fencing：`22/22`

## 6. 工具复核状态

CodeRabbit 已在初始 RED 后被请求复核，但机器人明确返回未分配 Pro seat，正式 review 未执行。本复审不将该回复描述为“0 issues”。最终代码仍需再次发起限定请求并如实记录工具结果。

## 7. 治理边界

A5 可关闭，但以下事项仍未完成：

- A6：运行时启动顺序、AuthorityWriteHost 与 canonical ledger/identity authority 的生产组合；
- A7：确定性 replay、snapshot、segment 与腐败矩阵；
- A8：全仓 writer inventory 归零、最终 source-closure 和 WP-A closure receipt。

因此 `wpAComplete=false`、`gate1MayStart=false`、`readyForPromotion=false`、`formalRelease=false` 必须保持。
