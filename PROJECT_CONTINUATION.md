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

- 记录时间：2026-08-06 04:08（UTC+07:00）。
- OSS-1A Task 11 已完成 reviewed-candidate 验证、source merge 和合并后永久 WP0 收口。
- 当前目标：封存 OSS-1A 历史 PR/治理状态，完成 PR #19 开源加速总设计最终审阅，然后按总实施方案启动下一独立工作包。
- “源码已合并”不等于生产发布、正式 Release、publish、promotion 或下一工作包自动授权。

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
- 当前精确 Head：`1cf757964a220ad2c28137ba9c7829581e7b78ab`
- source-merge baseline role PR：#57
- source-merge receipt：`governance/open-source-acceleration/oss-1a-source-merge-receipt.json`
- 永久角色：`SOURCE_MERGED_BASELINE`
- `readyForPromotion=false`
- `productionUseAuthorized=false`
- `formalRelease=false`
- `publish=false`
- `automaticNextWorkPackageAuthorization=false`

## 3. 最终合并后验证证据

精确 Head：`1cf757964a220ad2c28137ba9c7829581e7b78ab`

### 永久 WP0

- workflow run：`31047121428`
- route job：GREEN
- product job：GREEN
- WP0 contracts：`123/123 GREEN`
- ACV2 A0：`4/4 GREEN`
- staged-secret scanner：GREEN
- source identity / Electron tracking：GREEN
- protocol descriptor：GREEN
- trusted product-route policy bundle：GREEN
- `Enforce product-route executable branch role`：GREEN
- Ubuntu sealed export：GREEN
- Windows sealed export：GREEN
- aggregate：GREEN

### OSS-1A

- workflow run：`31047119634`
- branch role：GREEN
- governance contract：GREEN
- runtime 对治理基线按设计 skipped
- aggregate：GREEN

### Provenance

- workflow run：`31047120955`
- Ubuntu：GREEN
- Windows：GREEN

## 4. 已完成的底层治理重构

1. reviewed-candidate 角色不再依赖 YAML 分支白名单；必须匹配 manifest 中的精确分支和 SHA。
2. reviewed-candidate manifest 同时封印 reviewed code Head、evidence tip、评审 ID、双父顺序和精确治理路径。
3. 永久 WP0 的角色策略由 PR base SHA 导出的受信 policy worktree 执行；候选代码不能决定自身角色。
4. source merge 后新增独立 `SOURCE_MERGED_BASELINE` 身份，不回退 v11 implementation registry。
5. source-merge receipt 精确绑定：PR #51、source merge commit、父提交顺序、reviewed-candidate manifest、当前 v11 authorization/receipt、远端 tip、祖先关系和 post-merge 治理路径。
6. 错误 tip、父顺序、额外路径、授权漂移和未注册角色均 fail closed。

## 5. Pull Request 状态

- PR #24：OSS-1A 实施历史，已合并；正文应更新为最终事实。
- PR #51：reviewed-candidate source merge，已合并。
- PR #52、#55、#56、#57：治理底层重构，均已合并。
- PR #39：旧 canonical projection 授权 PR；其单一路径目的已被后续授权、reviewed-candidate 与 source-merge baseline 完整吸收，应封存并关闭，不合并到冻结旧基线。
- PR #19：开源加速总设计，仍为 Draft；下一步进行最终设计审阅和状态更新。

## 6. 下一步严格执行顺序

1. 更新 PR #24 正文为最终 reviewed-candidate/source-merge/WP0 事实。
2. 更新并关闭 PR #39，注明被后续正式链路取代，不删除其分支与历史证据。
3. 对 PR #19 六个设计/治理文件进行最终审阅：
   - 核对与当前总实施方案、统一 UI 修订和已完成 OSS-0/OSS-1A 事实一致；
   - 移除或修订已过期的“尚未开始”表述；
   - 不在设计 PR 中混入产品 runtime 改动。
4. PR #19 精确 Head 门禁 GREEN 且审阅无阻塞后，完成 design-only merge。
5. 根据 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` 的优先级，为下一工作包建立独立分支、授权、RED 合同和 PR；不得复用 OSS-1A 权限。

## 7. 完成与发布边界

已完成：

- OSS-1A Task 11；
- reviewed-candidate 精确身份；
- source merge；
- source-merged baseline 永久 WP0 角色；
- 合并后 exact Head 全门禁 GREEN。

尚未完成且不得声称完成：

- 合并到 `main` 的产品发布链；
- 正式 tag / GitHub Release；
- 可下载发布资产的最终验证；
- production promotion；
- 自动授权下一工作包。

## 8. 本接续记录维护协议

- 固定分支：`project-state/active-handoff`
- 固定文件：`PROJECT_CONTINUATION.md`
- 每个实际里程碑后用普通新提交完整更新本文件，不 amend、不 rebase、不 force push。
- 新聊天恢复时先读取本文件，再核验 GitHub 当前 refs 与 Actions；若冲突，以远端 refs、治理凭据和精确 Actions 结果为准，并立即修订本文件。
