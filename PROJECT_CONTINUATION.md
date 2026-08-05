# 言策项目持续执行接续记录

> **新聊天必须先读本文件，再执行任何仓库修改。**
>
> 本文件是跨聊天的持续执行索引，不替代治理授权、授权凭据、精确 Head 工作流结果或正式审计证据。所有安全与发布判定仍以仓库内治理文件及 GitHub Actions 精确结果为准。

## 0. 固定修复规则

1. 禁止临时绕过，必须进行底层重构。
2. 失败测试先行；不得通过跳过测试、关闭测试、`continue-on-error`、弱化断言或修改门禁口径制造 GREEN。
3. 不得强推，不得改写历史；所有分支更新只能使用可证明的非强制快进或普通 merge commit。
4. 所有阶段结论必须绑定精确 commit SHA、workflow run/job 和精确路径集合。
5. 不得把本接续文档当成授权扩展；任何新增实施路径必须先完成正式授权与 receipt。

## 1. 当前时间点与目标

- 记录时间：2026-08-06 04:35（UTC+07:00）。
- OSS-1A Task 11 已完成 reviewed-candidate、source merge、source-merged baseline 与永久 WP0 收口。
- PR #22 非执行产品文档 WP0 路由已完成独立审查并合入 `main`。
- PR #19 开源加速总设计已完成最终审查并以 design-only 形式合入 `main`。
- 当前目标：执行 OSS-A 来源、许可证与供应链底座缺口审计；只为未被 OSS-0 覆盖的精确缺口建立新工作包，不重复开发既有 provenance foundation。
- “设计合并”与“源码已合并”都不等于生产发布、正式 Release、publish、promotion 或下一工作包自动授权。

## 2. OSS-1A 最终权威状态

### 已评审实施代码

- 实施分支：`oss/1a-baileys-lifecycle`
- 已评审实施 Head：`3e3a52ed9dd255ca5ba027a3b12704b5e281448d`
- 结构化独立评审：PR #24 review ID `4868185392`
- 评审决定：`ALLOW_MERGE`
- P0/P1：`0/0`
- temporary bypass / missing evidence / blockers：均无

### Reviewed candidate

- 分支：`reviewed-candidate/oss1a-task11`
- reviewed code Head：`3e3a52ed9dd255ca5ba027a3b12704b5e281448d`
- evidence tip：`e01a93edc10de165681c4a419f00421ec28788fd`
- reviewed-candidate source merge PR：#51
- source merge commit：`51f924079c020fb165409da9d03d4184d8d2d787`

### Source-merged baseline

- 长期受信分支：`governance/oss-1a-canonical-projection-checkpoint-authorization`
- 精确 Head：`1cf757964a220ad2c28137ba9c7829581e7b78ab`
- source-merge baseline role PR：#57
- source-merge receipt：`governance/open-source-acceleration/oss-1a-source-merge-receipt.json`
- 永久角色：`SOURCE_MERGED_BASELINE`
- `readyForPromotion=false`
- `productionUseAuthorized=false`
- `formalRelease=false`
- `publish=false`
- `automaticNextWorkPackageAuthorization=false`

## 3. OSS-1A 最终验证证据

精确 Head：`1cf757964a220ad2c28137ba9c7829581e7b78ab`

### 永久 WP0

- workflow run：`31047121428`
- route、product、Ubuntu/Windows sealed export、final role 和 aggregate：GREEN
- WP0 contracts：`123/123 GREEN`
- ACV2 A0：`4/4 GREEN`
- staged-secret scanner、source identity、Electron tracking、protocol：GREEN

### OSS-1A

- workflow run：`31047119634`
- branch role、governance contract、aggregate：GREEN
- runtime 对治理基线按设计 skipped

### Provenance

- workflow run：`31047120955`
- Ubuntu：GREEN
- Windows：GREEN

## 4. 已完成的 reviewed-candidate / source-merge 底层治理重构

1. reviewed-candidate 角色不依赖 YAML 分支白名单；必须匹配 manifest 中的精确分支和 SHA。
2. manifest 同时封印 reviewed code Head、evidence tip、评审 ID、双父顺序和精确治理路径。
3. 永久 WP0 角色策略由 PR base SHA 导出的受信 policy worktree 执行；候选代码不能决定自身角色。
4. source merge 后使用独立 `SOURCE_MERGED_BASELINE` 身份，不回退 v11 implementation registry。
5. source-merge receipt 精确绑定 PR #51、source merge commit、父提交顺序、reviewed-candidate manifest、当前 v11 authorization/receipt、远端 tip、祖先关系和 post-merge 路径。
6. 错误 tip、父顺序、额外路径、授权漂移和未注册角色均 fail closed。

## 5. 非执行文档 WP0 路由

### PR #22

- 分支：`governance/wp0-product-documentation-route`
- reviewed Head：`56ba8aaca5b82945df11fd3d5abc92a52ba16a2c`
- independent review ID：`4868855671`
- decision：`ALLOW_MERGE`
- P0/P1：`0/0`
- main merge commit：`14c08b24439f0d105e8b0a969b91e4dc89b3dd37`

### 已修复的独立审查发现

- trusted Git path 首尾空白被静默 `trim()`；
- `./` 前缀和反斜杠被静默改写。

最终策略对受信 changed path 做零归一化，拒绝首尾空白、`./`、反斜杠、尾随 `/`、控制字符、glob、盘符、遍历与空 segment。

### 精确验证

- Stage WP0：`31048092060` GREEN
- Layered CI：`31048092727` GREEN（Ubuntu/Windows L2）
- ACV2 WP-A：`31048092105` GREEN
- WP-A post-merge：`31048090918` GREEN
- main push post-merge validation：`31048366456` GREEN

文档路线只验证 `docs/superpowers/plans/*.md` 与 `docs/superpowers/specs/*.md` 的非执行 Markdown；不授权 runtime、build、package、release、publish、production 或 promotion。

## 6. PR #19 开源加速总设计

- 最终 Head：`efabd9a7a36d2d01e5f1c0dd183f1860d99e5bc9`
- base：`main@14c08b24439f0d105e8b0a969b91e4dc89b3dd37`
- main merge commit：`48e465fe741fd91c80c22ddd20c547de2727f7f5`
- final diff：精确五个 Markdown 文件
- structured review ID：`4868962978`
- decision：`ALLOW_MERGE`
- P0/P1：`0/0`

### 基线同步

设计分支通过普通双父 merge commit接入 PR #22 的受信 `main`：

- merge commit：`efabd9a7a36d2d01e5f1c0dd183f1860d99e5bc9`
- first parent：`2e4132adaeadf95b69f9882e35e87716deaaa2d8`
- second parent：`14c08b24439f0d105e8b0a969b91e4dc89b3dd37`
- relative to main：只含五份 Markdown
- 未强推、未改写历史

### 精确验证

- documentation WP0 run：`31048843165` GREEN
  - route：`PRODUCT_DOCUMENTATION_WP0`
  - exact Markdown diff、安全扫描、协议、aggregate：GREEN
  - product、governance、sealed export：按设计 skipped
- ACV2 WP-A run：`31048842839` GREEN
  - Ubuntu：GREEN
  - Windows：GREEN
  - source closure：GREEN

### 绑定状态修订

`docs/superpowers/specs/2026-08-06-yance-open-source-acceleration-status-amendment.md`：

- 记录 OSS-0 已完成，但最终项目许可证仍未决；
- 记录 OSS-1A reviewed/source-merged baseline 完成；
- 澄清统一 Product Shell 可替换 UI 实现层，但言策保持唯一产品、数据、设置、通知和发送权威；
- 不授权任何 Chatwoot/SillyTavern/copyleft 源码移植、生产、发布或下一工作包。

## 7. Pull Request 状态

- PR #19：总设计，已合并到 `main`。
- PR #22：文档 WP0 路由，已合并到 `main`。
- PR #24：OSS-1A 实施历史，已合并；正文已更新为最终事实。
- PR #39：旧 canonical projection 授权，已被正式链路取代并关闭，历史保留。
- PR #51：reviewed-candidate source merge，已合并。
- PR #52、#55、#56、#57：治理底层重构，均已合并。

## 8. 下一步严格执行顺序

1. 对 OSS-A 当前来源、许可证和供应链能力做精确库存：
   - OSS-0 provenance 已覆盖哪些合同；
   - SBOM、锁文件、GitHub Actions 固定、artifact/source identity、依赖完整性、许可证决策还缺哪些底层合同；
   - 不把已有能力重新实现一次。
2. 将库存结论固化为独立 OSS-A 工作包设计、精确授权路径和 receipt。
3. 先提交失败合同，证明真实供应链缺口；再做底层实现修复。
4. OSS-A exact Head 全门禁 GREEN、独立审查和 source merge 后，从 PR #17 精确提取 WP-B 持久执行核心。
5. WP-B 只允许 DurableTask、OutboxRecord、ExternalAttempt、LeaseFence、ReconciliationCase 及其最小权威边界；不得带入 PR #17 的 UI、未来平台或未授权 AI 学习范围。

## 9. 完成与发布边界

已完成：

- OSS-0 provenance foundation；
- OSS-1A Task 11 reviewed-candidate/source merge/source-merged baseline；
- PR #22 非执行文档路线；
- PR #19 design-only merge；
- 上述阶段 exact-Head 门禁和独立审查。

尚未完成且不得声称完成：

- OSS-A 剩余供应链底座；
- WP-B 持久执行核心提取；
- 产品实现合并到 `main` 的正式发布链；
- 正式 tag / GitHub Release；
- 可下载发布资产最终验证；
- production promotion；
- 自动授权下一工作包。

## 10. 本接续记录维护协议

- 固定分支：`project-state/active-handoff`
- 固定文件：`PROJECT_CONTINUATION.md`
- 每个实际里程碑后用普通新提交完整更新本文件，不 amend、不 rebase、不 force push。
- 新聊天恢复时先读取本文件，再核验 GitHub 当前 refs 与 Actions；若冲突，以远端 refs、治理凭据和精确 Actions 结果为准，并立即修订本文件。
