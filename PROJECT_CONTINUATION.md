# 言策项目持续执行接续记录

> **新聊天必须先读本文件，再执行任何仓库修改。**
>
> 本文件是跨聊天的持续执行索引，不替代治理授权、授权凭据、精确 Head 工作流结果或正式审计证据。所有安全与发布判定仍以仓库内治理文件及 GitHub Actions 精确结果为准。

## 0. 固定修复规则

1. 禁止临时绕过，必须进行底层重构。
2. 失败测试先行；不得通过跳过测试、关闭测试、`continue-on-error`、弱化断言或修改门禁口径制造 GREEN。
3. 不得强推，不得改写历史；实施分支只能使用可证明的非强制快进。
4. 所有阶段结论必须绑定精确 commit SHA、精确 workflow run/job 和精确路径集合。
5. 不得把本接续文档当成授权扩展；任何新增实施路径必须先完成正式授权与 receipt。

## 1. 当前时间点与唯一目标

- 记录时间：2026-08-06 00:16（UTC+07:00）
- 当前唯一目标：完成 **OSS-1A Task 11：UAT diagnostics runtime 修复候选的可靠发布、Windows 验证、实施分支快进及正式门禁收口**。
- 当前不要继续扩大 OSS-1A 设计范围；Task 11 完成后关闭 OSS-1A 当前阶段，进入 PR #19 总设计审阅和后续全局实施路线。

## 2. 当前权威分支、PR 与精确 SHA

### 实施与治理

- 实施分支：`oss/1a-baileys-lifecycle`
- 当前已验证实施 Head：`fbb59fa305399596df53a665663669cf45272f8d`
- v11 治理分支：`governance/oss-1a-uat-diagnostics-runtime-authorization`
- v11 治理 receipt Head：`0f06ee23d6c64907b0fea0ce0d2239f34ffc452e`
- v11 pre-receipt Head：`26ba9a6a7d498782d9b120621dcf551475213f15`
- v11 授权锚点 commit：`530671bbd4d1db8718cfbd9fa584b1db9bfde5df`
- v11 authorization blob：`fdff206ac24ccc6dba4c188fcc219501060e7882`
- v11 authorization 文件 SHA-256：`e2c9b7ee2f20057901a43b713199287528144b46e4d1920c7f9088ede73d1450`
- v11 授权路径数：`71`
- v11 授权路径集合 SHA-256：`1066e8c30e1dc29f62f5ddac59bc33a6df0780b576cf82dc4b4c5961185f6506`
- v11 receipt：`governance/open-source-acceleration/oss-1a-authorization-receipt-v11.json`

### 生成器

- 生成器分支：`generator/oss1a-v11-uat-diagnostics-runtime-fix`
- 当前生成器 Head：`625d8c61fb635fd19a4722e4c66bd432e1ce1188`
- 生成器固定实施祖先：`fbb59fa305399596df53a665663669cf45272f8d`
- 生成器固定治理祖先：`0f06ee23d6c64907b0fea0ce0d2239f34ffc452e`
- 最近尝试的候选分支名：`candidate/oss1a-v11-uat-diagnostics-runtime-green-v2`
- **候选尚未成功发布到远端。不得假定候选 SHA；必须从精确日志恢复或确定性重新生成。**

### Pull Requests

- 实施 PR：[#24](https://github.com/laiqian0239-glitch/yance/pull/24)，保持 Draft。
- v11 治理 PR：[#44](https://github.com/laiqian0239-glitch/yance/pull/44)，保持 Draft。
- Task 11 完成后下一阶段：最终审阅 PR #19 总设计。

## 3. 已完成的底层修复

### 3.1 WhatsApp logout 生命周期次序

已修复 `backend/services/whatsappAdapter.js`：

- `socket.logout()` 在 auth writer generation 仍为 current/writable 时完成；
- 之后才推进 generation、关闭 lease、使 fence 失效并删除 runtime row；
- 没有通过弱化 lifecycle guard 或跳过真实 logout 达成通过。

相关 RED Head：`e2071e2349f73ef75f5c6ccf45da8b98a8517cec`。

### 3.2 Canonical projection 根修复

已移除 `messageRepository` 对 legacy `domain_events` 的 inbound projection job 写入依赖，并在 `platformCoreRepository` 中建立 fail-closed receipt/checkpoint 行为：

- 失败或跳过且 projection hash 为空时生成确定性的 64 字符 checkpoint state hash；
- 已应用且合法的 projection hash 保持原值；
- 不恢复 legacy domain writes。

相关 RED Head：`3be359911440e38b4e587b19e0918aebe1c3c41a`。

### 3.3 Source UAT delivery 根修复

v10 已修复：

- 不再把可变工作仓库误判成旧 source ZIP；
- 不再把 Git LFS pointer 当作已水合 Electron ZIP；
- Windows `.cmd` 以 CRLF 正确物化；
- Ubuntu/Windows Source UAT delivery 为 `72/72 GREEN`。

v10 receipt Head：`82bc44d648c16eb7c454063a1bd36636bfa53d75`。
当前实施 Head：`fbb59fa305399596df53a665663669cf45272f8d`。

### 3.4 UAT diagnostics runtime 根修复设计

正式失败运行显示 `245` 项中 `26` 项失败：

- `20` 项因 Python 环境缺少真实 Playwright；
- `6` 项因 UAT fixture 未初始化全局 SQLite broker，报 `SQLITE_BROKER_NOT_READY`。

当前候选实现采用：

- 固定真实运行时 `playwright==1.61.0`；
- 安装真实 Chromium，不使用 stub/skip；
- 测试专用 authority bootstrap，按生产链路启动：
  `AuthorityWriteHost -> SqliteConnectionBroker -> broker.open()`；
- 不修改生产 guard，不允许测试绕过 authority。

## 4. v11 候选允许变更的七个实施路径

候选相对实施祖先只能包含以下七个路径：

1. `.github/workflows/oss1a-whatsapp-lifecycle.yml`
2. `requirements/uat-playwright.txt`
3. `tests/uat/helpers/authoritySqliteTestHost.js`
4. `tests/uat/f25WindowsUatRepairBatch20AiUxReadability.test.js`
5. `tests/uat/fix6dRuntimeAuthorityIndependentAudit.test.js`
6. `tests/uat/fix6dRuntimeAuthorityRepair.test.js`
7. `tests/uat/modelRegistryFactSeparation.test.js`

任何额外路径均必须视为污染并停止发布，不得事后扩大解释。

## 5. 已取得的验证证据

### v11 pre-receipt

- OSS-1A：run `31021754673`，GREEN。
- Provenance：run `31021754470`，GREEN。
- WP0：run `31021753869`；`115` tests，`112` pass，恰好 `3` 个失败均来自缺失 v11 receipt；Ubuntu/Windows sealed exports GREEN。

### v11 receipt 精确 Head `0f06ee23...`

- OSS-1A：run `31021950966`，GREEN。
- Provenance：run `31021951090`，GREEN。
- WP0：run `31021950978`，所需测试、安全、来源、协议、角色、Ubuntu/Windows sealed export 与 aggregate 均 GREEN。

### 候选生成器本地验证

第一次：

- run `31022379275`
- job `92362113147`
- 新鲜 worktree、真实 Playwright/Chromium 安装、UAT diagnostics `245/245 GREEN`、OSS-1A `303 GREEN`、Source UAT `72 GREEN`、相关回归 GREEN。
- 最终候选 push 步骤 exit code `1`，候选未发布，Windows 跳过。

第二次：

- run `31023104554`
- job `92364598457`
- 同样通过新鲜 worktree、真实浏览器依赖、UAT diagnostics `245/245 GREEN`、OSS-1A `303 GREEN`、Source UAT `72 GREEN` 与相关回归。
- `Push isolated candidate only after Ubuntu validation` 再次 exit code `1`，候选仍未发布，Windows 跳过。

## 6. 当前唯一阻塞

候选的代码与 Ubuntu 全量验证已经通过，唯一阻塞是：

> 生成器 job `92364598457` 的最终远端候选发布步骤失败，精确 stderr 尚未被可靠提取并持久化。

不得根据猜测修改流程。必须先获取以下精确输出：

- `candidate HEAD`
- `git status --porcelain`
- `git diff --exit-code`
- `git diff --cached --exit-code`
- 两个 merge-base 验证结果
- `git remote -v`
- `git push --verbose` 的 `fatal:`、`remote:` 或 `error:` 行

## 7. 下一步严格执行顺序

1. 获取 run `31023104554` / job `92364598457` 的完整日志或 check annotations，定位 push 步骤精确失败行。
2. 根据证据做底层修复：
   - 若 worktree 污染：找出生成污染的真实路径与产生机制并修复；
   - 若 non-fast-forward/分支创建问题：从正确祖先预建全新候选分支，再执行普通快进 push；
   - 若 workflow 文件发布权限问题：重构为可审计的两阶段远端提交与精确最终 Head 复验，不能删除 workflow 变更或降低验证；
   - 禁止使用 `--force`、跳过 clean check 或取消 Windows 验证。
3. 重新生成并发布候选。
4. 在同一远端精确候选 Head 上完成：
   - Ubuntu UAT diagnostics `245/245`；
   - Windows UAT diagnostics `245/245`；
   - OSS-1A `303`；
   - Source UAT delivery `72/72`；
   - 相关回归全部 GREEN。
5. 核验候选相对 `fbb59fa...` 只含上述七个路径，并同时证明：
   - `fbb59fa305399596df53a665663669cf45272f8d` 是祖先；
   - `0f06ee23d6c64907b0fea0ce0d2239f34ffc452e` 是祖先。
6. 使用 `force=false` 非强制快进更新 `oss/1a-baileys-lifecycle`。
7. 对新实施精确 Head 运行正式门禁：
   - OSS-1A；
   - Fault Matrix；
   - Provenance；
   - WP0。
8. 若 WP0 此时仅剩 `Immutable implementation branch role` RED，按仓库既定晋级政策完成正式角色晋级；不得绕过角色门禁。
9. 更新 PR #24 的过期正文与 base，使其反映最终事实。
10. 完成 OSS-1A 当前阶段后，进入 PR #19 总设计最终审阅，并启动后续 OSS-A / OSS-B / 持久执行核心工作。

## 8. Task 11 完成判定

只有同时满足下列条件，才可宣告 Task 11 完成：

- 远端候选存在且 SHA 可验证；
- 候选只包含授权七路径；
- 双祖先关系成立；
- Ubuntu 与 Windows 在同一精确候选 Head 上全量 GREEN；
- 实施分支完成非强制快进；
- 新实施精确 Head 的 OSS-1A、Fault Matrix、Provenance、WP0 满足正式发布口径；
- PR #24 与治理记录已同步为当前事实；
- 没有临时绕过、强推、历史改写或门禁弱化。

## 9. 本接续记录的维护协议

- 固定分支：`project-state/active-handoff`
- 固定文件：`PROJECT_CONTINUATION.md`
- 每个实际里程碑后用普通新提交完整更新本文件，不 amend、不 rebase、不 force push。
- 新聊天恢复时先读取本文件，再核验 GitHub 上的当前 refs 与 Actions；若两者冲突，以当前远端 refs、治理凭据和精确 Actions 结果为准，并立即修订本文件。
