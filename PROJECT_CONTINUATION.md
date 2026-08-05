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

- 记录时间：2026-08-06 05:30（UTC+07:00）。
- 当前 `main` 精确 Head：`bdcc04017fd79a494ba66fad83f762a1c714ff1a`。
- OSS-1A Task 11 已完成 reviewed-candidate、source merge、source-merged baseline 与永久 WP0 收口。
- PR #22 非执行产品文档 WP0 路由已完成独立审查并合入 `main`。
- PR #19 开源加速总设计已完成最终审查并以 design-only 形式合入 `main`。
- PR #60 OSS-A 供应链工作包设计与 PR #61 OSS-A 精确授权基础路由已合入 `main`；这不等于 OSS-A 实施完成。
- UI Product Shell 的四个精确治理文档路径已通过 current-main 授权、RED→GREEN、独立审查与根合并进入 `main`。
- UI-WP1 RED、Product Shell 源码、Chatwoot 源码复制、声音公共再分发和旧前端 writer cutover 仍未授权。
- “设计合并”“路由合并”和“源码已合并”都不等于生产发布、正式 Release、publish、promotion 或下一工作包自动授权。

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

设计分支通过普通双父 merge commit 接入 PR #22 的受信 `main`：

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

## 7. OSS-A 设计与精确权威路由

### PR #60：设计工作包

- 标题：`docs(oss-a): freeze supply-chain foundation work package`
- Head：`7ebeb5085e0a57dfbefd47c858ac45d2c24d660f`
- 已合入 `main`。
- 仅冻结 OSS-A 剩余来源、许可证、SBOM、依赖与 GitHub Actions 供应链范围；不授权实现、runtime、release、publish 或 promotion。

### PR #61：精确授权基础路由

- reviewed Head：`a0e5978901638112265df51927df85616c266ca4`
- main merge commit：`e7f7b530893689d2ed5fcc20a7583c8619ed7c91`
- RED Head：`ee0a23e097a92cc6b659cd2f93c1e705ba2b2ad7`
- RED：`57/58`，唯一失败为 OSS-A 精确权威路径错误选择 `PRODUCT_WP0`。
- GREEN：只把既有九路径集合中的八个未登记路径加入 `governanceExactPaths`；不添加目录前缀、通配符或执行权限。
- Stage WP0：`31050711856` GREEN。
- Layered CI：`31050712055` GREEN。
- ACV2 WP-A：`31050711558` GREEN。
- 结构化独立评审 ID：`4869151155`，`ALLOW_MERGE`，P0/P1=`0/0`。

该路由只为 OSS-A 正式授权基础设施提供治理路径，不代表 OSS-A 产品实施已经完成。

## 8. UI Product Shell WP0 根路由收口

### 历史链

- PR #53/#54：schema v1 路由历史证据，仍不得作为 current-main 执行链。
- PR #58：旧 schema v2 授权，Head `b5f46b8d0be46840365678f07f01500546f3fb3b`，已关闭、未合并，历史保留。
- PR #59：旧 schema v2 RED/GREEN，RED `b55b1d540c12d98bef2966baad6ea4d39eb85e50`，GREEN `4045cbf6a91772bb56b8dfa21ff657b56126cb78`，已关闭、未合并，历史保留。
- 上述旧分支不得直接 merge、rebase、force-update 或改写历史。

### PR #63：current-main 授权

- 授权分支：`governance/ui-product-shell-wp0-current-main-authorization`
- 授权 Head：`2a264738f5d38940cd21809ed9cece64e8d054b5`
- 授权文件：`governance/layered-ci/ui-product-shell-wp0-current-main-authorization.json`
- 精确基线：`main@e7f7b530893689d2ed5fcc20a7583c8619ed7c91`
- WP0：`31051950195` GREEN。
- Layered CI：`31051950473` GREEN。
- ACV2：`31051949800` GREEN。
- 独立评审 ID：`4869269547`，`ALLOW_MERGE`，P0/P1=`0/0`。
- 普通 merge commit：`4be95a404f64d223833d0d00c44e97bd42c83506`。
- 合并后根树与受审 Head 树均为 `7909e0b949279cb37f376d80a52c297309cef09a`。

### PR #64：RED→GREEN 根修复

- 实施分支：`fix/ui-product-shell-wp0-current-main-exact-routing`
- 授权根：`4be95a404f64d223833d0d00c44e97bd42c83506`
- RED Head：`dbe59b50f5106786c97da7fdb2c3c9bafa7a83a8`
- RED run：`31052539983`，policy job `92462785012`。
- RED 结果：`63/67`，仅四项新增 UI 路由合同失败；OSS-A、产品文档路线、schema v2 与 fail-closed 合同保持 GREEN。
- GREEN Head：`3d7872618d48fcd9c22e18b9b399682b5e225a1a`。
- GREEN policy blob：`e8d38025870543ff7d756e968666ac0fae211ba4`。
- 精确变更仅为：
  - `governance/layered-ci/wp0-routing-policy.json`：新增四个字面路径；
  - `tests/layered-ci/ui-product-shell-wp0-routing.test.js`：独立 UI 路由合同。
- WP0：`31052610603` GREEN。
- Layered CI：`31052610704` GREEN。
- ACV2：`31052610592` GREEN（Ubuntu、Windows、source closure）。
- 独立评审 ID：`4869325417`，`ALLOW_MERGE`，P0/P1=`0/0`。
- 普通 merge commit：`bdcc04017fd79a494ba66fad83f762a1c714ff1a`。
- 合并后根树与受审 GREEN Head 树均为 `f0d24bed8ca3ca132e47777a8a4dedd3cd521d09`。
- 合并提交 first parent：`4be95a404f64d223833d0d00c44e97bd42c83506`。
- 合并提交 second parent：`3d7872618d48fcd9c22e18b9b399682b5e225a1a`。

### 当前四个精确治理路径

```text
docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml
docs/ui-migration/UI_ASSET_BASELINE.json
docs/ui-migration/UI_WP1_AUTHORIZATION.md
docs/ui-migration/UPSTREAM_PINS.yaml
```

这些路径现在在 `main` 上精确选择 `GOVERNANCE_WP0`。未登记的 `docs/ui-migration/**` 仍选择 `PRODUCT_WP0`；没有前缀或通配符授权。与产品源码或产品文档混合时仍升级到 `PRODUCT_WP0` 并保留变更类别证据。

### 未授权边界

```text
uiWP1RedAuthorized=false
productShellImplementationAuthorized=false
chatwootSourceCopyAuthorized=false
soundPublicRedistributionAuthorized=false
legacyWriterCutoverAuthorized=false
automaticNextWorkPackageAuthorization=false
readyForPromotion=false
```

## 9. Pull Request 状态

- PR #19：总设计，已合并到 `main`。
- PR #22：文档 WP0 路由，已合并到 `main`。
- PR #24：OSS-1A 实施历史，已合并；正文已更新为最终事实。
- PR #39：旧 canonical projection 授权，已被正式链路取代并关闭，历史保留。
- PR #51：reviewed-candidate source merge，已合并。
- PR #52、#55、#56、#57：治理底层重构，均已合并。
- PR #60：OSS-A design-only 工作包，已合并。
- PR #61：OSS-A 精确权威路由，已合并。
- PR #63：UI WP0 current-main 授权，已合并。
- PR #64：UI WP0 current-main RED→GREEN 根修复，已合并。
- PR #58/#59：已关闭、未合并，历史证据保留。
- PR #50：第一版 UI-WP1 授权快照，仍为 BLOCKED 历史证据，不可直接创建 RED 分支。

## 10. 下一步严格执行顺序

### OSS-A 主线

1. 继续按已合入的 OSS-A 设计和精确授权基础设施执行供应链缺口工作包。
2. 先提交失败合同证明真实 SBOM、锁文件、Action 固定、artifact/source identity、依赖完整性或许可证缺口，再做底层实现。
3. 不重复开发 OSS-0 已存在的 provenance foundation。
4. OSS-A exact Head 全门禁 GREEN、独立审查和 source merge 后，再从 PR #17 精确提取 WP-B 持久执行核心。
5. WP-B 只允许 DurableTask、OutboxRecord、ExternalAttempt、LeaseFence、ReconciliationCase 及其最小权威边界；不得带入 PR #17 的 UI、未来平台或未授权 AI 学习范围。

### UI 并行治理线

1. 四条 UI 治理路径已在 `main` 根权威中生效。
2. 下一项必须是新的四文件 UI-WP1 授权修订，而不是复用 PR #50 或旧 PR #58/#59。
3. 新授权必须重新计算路径集合和内容 digest，并纳入：单一 Appearance authority、严格 patch allowlist、声音分发权分类、Chatwoot 精确移植清单、翻译缺失证明与明确 surface 状态标签。
4. 在新的 UI-WP1 授权明确生效前，不创建 UI-WP1 RED 分支，不添加 Product Shell 源码，不复制 Chatwoot 源码。
5. 该状态文档不授予上述下一工作包权限。

## 11. 完成与发布边界

已完成：

- OSS-0 provenance foundation；
- OSS-1A Task 11 reviewed-candidate/source merge/source-merged baseline；
- PR #22 非执行文档路线；
- PR #19 design-only merge；
- OSS-A design-only 工作包与精确授权基础路由；
- UI Product Shell 四路径 WP0 current-main 授权与根修复；
- 上述阶段 exact-Head 门禁和独立审查。

尚未完成且不得声称完成：

- OSS-A 剩余供应链实现；
- 新四文件 UI-WP1 授权修订；
- UI-WP1 RED 与 Product Shell 实施；
- WP-B 持久执行核心提取；
- 产品实现合并到 `main` 的正式发布链；
- 正式 tag / GitHub Release；
- 可下载发布资产最终验证；
- production promotion；
- 自动授权下一工作包。

## 12. 本接续记录维护协议

- 固定分支：`project-state/active-handoff`
- 固定文件：`PROJECT_CONTINUATION.md`
- 每个实际里程碑后用普通新提交完整更新本文件，不 amend、不 rebase、不 force push。
- 新聊天恢复时先读取本文件，再核验 GitHub 当前 refs 与 Actions；若冲突，以远端 refs、治理凭据和精确 Actions 结果为准，并立即修订本文件。
