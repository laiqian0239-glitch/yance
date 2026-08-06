# 言策项目持续执行接续记录

> **新聊天必须先读本文件，再执行任何仓库修改。**
>
> 本文件是跨聊天持续执行索引，不替代正式授权、receipt、精确 Head 工作流结果或审计证据。远端 refs、仓库内治理凭据与 exact-Head Actions 证据始终高于本文件。

## 0. 固定修复规则

1. 禁止临时绕过，必须进行底层重构。
2. 失败测试先行；不得通过跳过测试、关闭测试、`continue-on-error`、弱化断言或修改门禁口径制造 GREEN。
3. 不得强推，不得改写历史；分支更新只能使用可证明的非强制快进或普通 merge commit。
4. 所有阶段结论必须绑定精确 commit SHA、workflow run/job 和精确路径集合。
5. 本文件不授予任何新增权限；新增实施路径、source merge、promotion、production、release、publish 与下一工作包均须独立正式授权。

## 1. 当前时间点与精确状态

- 记录时间：2026-08-06 15:45（UTC+07:00）。
- 当前 `main`：`ad195d8497ec61fbe3387c606692110f5645fba0`。
- 当前 OSS-A 实施分支：`oss/a-supply-chain-foundation`。
- PR #67 exact Head：`028535eb6c092c47ad92bce3f0675c7d7b23f22d`。
- PR #67：open、Draft、`mergeable=true`、未合并。
- PR #67 相对 `main`：精确 24 路径；排除当前 receipt 后为精确 23 个实施路径。
- 23 路径集合 SHA-256：`fb99d7c9b090a0c8b92b5655c401b80f0e0674c6e6f5725bad8264c9ec19a175`。
- receipt 的 `implementationBaseCommit`：`ad195d8497ec61fbe3387c606692110f5645fba0`。
- PR #67 结构化独立审查：review ID `4872646973`，`ALLOW_MERGE`，P0/P1=`0/0`；该结论只表示代码审查闭环，不授予 source merge 或 promotion。
- PR #67 unresolved review threads：`0`。

## 2. OSS-1A 最终权威状态

OSS-1A Task 11 已完成 reviewed-candidate、source merge、source-merged baseline 与永久 WP0 收口。

- 已评审实施 Head：`3e3a52ed9dd255ca5ba027a3b12704b5e281448d`。
- reviewed-candidate evidence tip：`e01a93edc10de165681c4a419f00421ec28788fd`。
- reviewed-candidate source merge PR：#51。
- source merge commit：`51f924079c020fb165409da9d03d4184d8d2d787`。
- 长期受信分支：`governance/oss-1a-canonical-projection-checkpoint-authorization`。
- source-merged baseline Head：`1cf757964a220ad2c28137ba9c7829581e7b78ab`。
- 永久角色：`SOURCE_MERGED_BASELINE`。
- source-merge receipt：`governance/open-source-acceleration/oss-1a-source-merge-receipt.json`。
- `readyForPromotion=false`、`productionUseAuthorized=false`、`formalRelease=false`、`publish=false`、`automaticNextWorkPackageAuthorization=false`。

OSS-1A source-merge 通用化注意事项：

- `shared/release/openSourceSourceMergePolicy.js` 与对应 source-merge receipt/role 合同目前存在于 OSS-1A 长期受信分支，不在当前 `main`。
- 不得假设当前 `main` 已具备通用 OSS source-merge 能力。
- OSS-A source merge 前必须建立独立、current-main、失败测试先行的治理授权链；不得直接复制旧文件或把 PR #67 的实施 receipt 改成 merge 权限。

## 3. OSS-A 技术候选最终状态

PR #67 已完成供应链底座实现：

- 确定性 provenance registry 与第三方 notices；
- 基于已提交 npm lockfile 的 canonical CycloneDX 1.7 SBOM；
- 所有外部 GitHub Actions 的精确 commit lock；
- lock、provenance 与 notices 的 exact reviewed release tag 一致性；
- checkout `persist-credentials: false` 强制；
- 浮动 ref、表达式、Docker Action、flow mapping、quoted/anchored `uses` 与 malformed lock entry 的 fail-closed 合同；
- Ubuntu/Windows provenance、SBOM 与 Action lock 验证；
- base-owned WP0 route、L2 risk 与供应链 evidence 分类。

固定 Action 身份：

```text
actions/checkout@11d5960a326750d5838078e36cf38b85af677262 -> v4.2.2
actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e -> v6.4.0
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 -> v4.6.2
```

失败测试链包括：

- `9d968f2ee58299c8fd0335b67e850a5ec9f5d0ae`：SBOM path、exact tag、flow mapping、malformed entry RED；
- `9167b98de49b1ca4b459e8d5d6b1bb000937e292`：最小 SBOM path 修复后暴露 Action-lock RED；
- `fc997c6b7b7fca140fa914f742ee31d6b67bef32`：provenance/lock exact-version binding RED；
- `3ee2bd8ec77654ee9776ec4e1c4d6c5d4cbae601`：quoted/anchored `uses` RED；
- `028535eb6c092c47ad92bce3f0675c7d7b23f22d`：最终 GREEN。

## 4. PR #67 exact-Head 最终门禁

全部证据绑定 `028535eb6c092c47ad92bce3f0675c7d7b23f22d`：

- OSS Provenance run `31084829850`：Ubuntu/Windows GREEN；provenance、SBOM、11 个 Action-lock 合同与三个严格 verifier 全通过。
- Stage WP0 run `31084829808`：`PRODUCT_WP0`、required tests、staged-secret、source identity、protocol、executable gate、Ubuntu/Windows sealed export 与 aggregate GREEN。
- Layered CI run `31084830046`：policy/risk、Ubuntu/Windows L2 GREEN。
- ACV2 run `31084829997`：Ubuntu、Windows、source closure GREEN。
- WP-A post-merge validation run `31084829858`：Ubuntu、Windows、identity/source closure GREEN。
- WP-A Promotion Authorization Gate run `31084829813`：按设计 skipped。

最终 CodeRabbit 请求因 PR 为 Draft 被明确跳过；其 success context 不作为实质审查结论。此前所有 finding 均已逐项修复、回归测试并关闭。

## 5. 已合入 `main` 的 OSS-A base-owned 根修复

以下修复均通过独立授权、RED→GREEN、精确路径、普通 merge 与 exact-Head 验证进入 `main`：

- PR #68/#69：OSS-A receipt 与 WP0 frozen-scope 测试基础设施修复；
- PR #70/#71/#72/#73：隔离分支、fixture root、evidence 与 protected-command 身份修复；
- PR #75/#76：全局 checkout credential 与 Layered CI 供应链 L2 分类修复；
- PR #77/#78：当前 main 的八个供应链字面路径 PRODUCT_WP0 bootstrap；
- PR #79/#80：八个已审查供应链证据路径的精确 `SUPPLY_CHAIN_EVIDENCE` 分类；未知未来 `third_party` 路径仍 fail closed。

这些修复不构成 PR #67 source merge、production、release、publish 或下一工作包授权。

## 6. UI Product Shell 并行线

已完成：

- PR #63：四个 UI 治理路径 current-main 精确授权；
- PR #64：四路径 WP0 route RED→GREEN 根修复；
- 四个精确治理路径在 `main` 选择 `GOVERNANCE_WP0`：

```text
docs/ui-migration/CHATWOOT_TRANSPLANT_MANIFEST.yaml
docs/ui-migration/UI_ASSET_BASELINE.json
docs/ui-migration/UI_WP1_AUTHORIZATION.md
docs/ui-migration/UPSTREAM_PINS.yaml
```

当前开放 PR #65 是旧基线上的四文件 UI-WP1 授权候选：

- base 仍记录 `main@bdcc04017fd79a494ba66fad83f762a1c714ff1a`；
- Head：`c2e9de32ffd9f0da52540c068d7c467734d1f6d4`；
- 不得把旧 base 观察值当成当前执行权威；任何继续动作必须先重新核验并按普通 merge/current-main 规则重建封印。

未授权边界保持：

```text
uiWP1RedAuthorized=false
productShellImplementationAuthorized=false
chatwootSourceCopyAuthorized=false
soundPublicRedistributionAuthorized=false
legacyWriterCutoverAuthorized=false
automaticNextWorkPackageAuthorization=false
readyForPromotion=false
```

## 7. 当前 PR 状态

- PR #19：总设计，已合并。
- PR #22：非执行产品文档 WP0 route，已合并。
- PR #24：OSS-1A 实施历史，已合并并更新最终事实。
- PR #51：OSS-1A reviewed-candidate source merge，已合并。
- PR #52/#55/#56/#57：OSS-1A source-merge 治理底层重构，已合并到长期受信分支。
- PR #60/#61/#62/#66：OSS-A 设计、route、通用 authorization 与 seal，已合并。
- PR #63/#64：UI current-main route 授权与修复，已合并。
- PR #65：开放、旧 base 的 UI-WP1 四文件授权候选，尚未形成 current-main 执行权限。
- PR #67：开放、Draft、技术候选全 GREEN；source merge 未授权。
- PR #68-#80：PR #67 暴露的 base-owned 根修复链，已按各自权限普通合并或明确关闭。

## 8. 下一步严格执行顺序

### OSS-A 主线

1. 冻结 `main@ad195d8497ec61fbe3387c606692110f5645fba0`、PR #67 Head `028535eb6c092c47ad92bce3f0675c7d7b23f22d`、24/23 路径集合和 exact workflow evidence。
2. 建立独立 source-merge 治理设计与授权包；先证明当前 `main` 缺少通用 source-merge authority 时必须 fail closed。
3. 授权包必须明确选择并证明以下方案之一：
   - 将 OSS-1A 已验证的 source-merge policy 抽象为 current-main 通用能力；或
   - 建立最小 OSS-A 专用 source-merge authority，但不得复制形成第二套相互竞争的权威。
4. source-merge authorization 必须绑定 PR #67、exact Head、base、24/23 路径、digest、workflow runs、review ID、预期普通 merge 父顺序和 post-merge path set。
5. `productionUseAuthorized=false`、`formalRelease=false`、`publish=false`、`readyForPromotion=false`、`automaticNextWorkPackageAuthorization=false` 必须保持。
6. 授权 exact Head 全门禁 GREEN、独立审查、普通合入 `main` 后，才可改变 PR #67 Draft/merge 状态。
7. PR #67 普通 source merge 与 new-main post-merge 全验证完成后，建立 OSS-A source-merged baseline receipt。
8. 只有 OSS-A source-merged baseline 完成后，才从 PR #17 提取 WP-B：`DurableTask`、`OutboxRecord`、`ExternalAttempt`、`LeaseFence`、`ReconciliationCase`。

### UI 并行治理线

1. 不直接复用 PR #50、旧 PR #58/#59 或 PR #65 的旧 base 观察值。
2. 先把四文件 UI-WP1 授权候选重建/同步到 fresh current main，并重新计算路径和内容 digest。
3. 授权必须继续包含：唯一 `YanceAppearanceAdapter` writer、严格 patch allowlist、声音分发权分类、Chatwoot file-level manifest、翻译缺失证明和 surface 状态标签。
4. fresh UI-WP1 授权明确生效前，不创建 RED 分支，不添加 Product Shell/adapter 源码，不复制 Chatwoot 源码。

## 9. 完成与发布边界

已完成：

- OSS-0 provenance foundation；
- OSS-1A reviewed-candidate/source merge/source-merged baseline；
- PR #19 design-only 总计划；
- OSS-A design、authorization seal、23 路径实施候选及全部技术门禁；
- PR #67 暴露的 base-owned WP0/CI/security 根修复；
- UI 四个治理路径 current-main route。

尚未完成且不得声称完成：

- OSS-A source-merge authorization；
- PR #67 source merge 与 source-merged baseline；
- WP-B 持久执行核心提取；
- fresh current-main UI-WP1 授权；
- UI-WP1 RED 与 Product Shell 实施；
- 正式 tag / GitHub Release / 可下载发布资产验证；
- production promotion、formal release、publish；
- 自动授权下一工作包。

## 10. 本接续记录维护协议

- 固定分支：`project-state/active-handoff`。
- 固定文件：`PROJECT_CONTINUATION.md`。
- 每个实际里程碑后使用普通新提交完整更新，不 amend、不 rebase、不 force push。
- 新聊天恢复时先读本文件，再核验远端 refs、PR、receipt 与 Actions；发生冲突时以远端事实为准并立即修订本文件。
