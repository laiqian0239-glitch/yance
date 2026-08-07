# 言策项目持续执行接续记录

> **本文件只负责动态执行接续，不再承载稳定架构。**
>
> 稳定架构唯一来源：[`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md) V2.1。
>
> 新聊天必须先读取 [`START_HERE.md`](./START_HERE.md)，再读取 V2.1 主计划和本文件，然后重新核验远端 refs、PR、workflow、receipt、review 与 exact Head。禁止依赖本文件中的历史 SHA、旧工作包顺序或旧 UI/架构描述直接执行。

## 0. 固定修复与治理规则

1. 禁止临时绕过，必须底层修复/底层替换为成熟 OSS。
2. 失败测试先行；不得通过跳过测试、关闭测试、`continue-on-error`、弱化断言或修改门禁口径制造 GREEN。
3. 不得强推，不得 amend/rebase 改写已发布历史；分支更新只能使用普通提交、可证明的非强制快进或正式 merge。
4. 普通 merge 保留 two-parent 历史。
5. 所有阶段结论必须绑定实时核验的精确 commit SHA、workflow run/job、路径集合和治理凭据。
6. 成熟 OSS 优先；任何新的 Yance 自研基础设施必须先通过 V2.1 OSS-fit 准入。
7. 本文件不授予任何新增权限；新增实施路径、依赖、workflow、source merge、promotion、production、release、publish 与下一工作包均须独立正式授权。
8. 快速落地模式：完整工作包连续实施，不按每个小 Task 停下；只在真实 RED、正式授权边界或最终 owner exact-Head merge approval 边界停下。

## 1. 唯一架构入口

当前有效稳定架构只认：

```text
START_HERE.md
        ↓
YANCE_IMPLEMENTATION_MASTER_PLAN.md  V2.1
        ↓
PROJECT_CONTINUATION.md  当前动态执行状态
        ↓
实时远端 refs / PR / workflow / receipt / review / exact Head
```

不得把 Git 历史中的 V1/旧专题计划、旧 PR 正文或本文件旧版本重新当成当前实施路线。

## 2. 已废止的旧执行方向

以下旧方向已被 V2.1 取代，不得从本文件旧历史中恢复：

- Yance 自建唯一 ChannelDriver / Canonical / 联系人 / 消息事实权威；
- Chatwoot 作为唯一 Product Shell；
- OSS-A 后必须先提取并自研 WP-B DurableTask/Outbox 才能继续产品能力；
- 把 Voice、Visual、Video 当成互相独立的多模态附件底座；
- 为 WhatsApp、Telegram、Signal、Meta 等建立独立产品级聊天页面；
- 把旧 UI-WP1 / Chatwoot source-copy 顺序当成 V2.1 产品主线。

历史证据需要时直接从 Git commit 读取，不在活动接续文件重复保存第二份架构真相。

## 3. 当前稳定产品方向摘要

- **统一产品界面**：所有平台始终进入一个 Yance 工作区；
- **固定 UX**：左导航、会话列表、右工作区可展开/收起/完全隐藏/拖拽宽度，布局重启恢复，并有明确恢复隐藏区域入口；
- **后台连续性**：隐藏 UI 不得静默停止同步、消息、Journey、AI 或后台任务；
- **通信底座**：Matrix/Synapse + mautrix + Element，平台深度能力允许成熟 native OSS escape hatch；
- **AI Reply Brain**：Letta + Graphiti + Parlant；
- **Goal Brain**：每个会话可设置目标/成功条件/Journey；
- **Model Brain**：RouteLLM + LiteLLM；
- **Learning Brain**：Langfuse + DSPy + Promptfoo（需要时 Argilla）；
- **Personal Presence**：Voice / Photo / Generated Visual / Realtime Avatar 统一为 Personal Presence；首选 CosyVoice + Immich/ComfyUI + CyberVerse/LiveKit；
- **OSS-first**：不自研第二套消息状态机、Agent memory、Journey runtime、模型网关、照片系统、TTS、WebRTC/SFU 或 Avatar 基础设施，除非先证明成熟 OSS 无法满足。

## 4. 当前实时执行状态：PVEP Task 12 OSS-fit / 安全收口 BLOCKED

### 4.1 Fresh remote identity

截至 2026-08-07 本次实时核验：

```text
trusted main = 028d14458269d0be6196e724fe5a0416dbfa900a
PVEP authorization merge = 028d14458269d0be6196e724fe5a0416dbfa900a
implementation branch = governance/portable-verification-evidence-protocol-authorized
implementation exact Head = f2c8d657f3623d1982fc71d687a4967aa457268f
parent1 = bbd2a153116b9f17399ebe1e7f9135b7df49d0a2
parent2 = 9ec59ac836f70e95a1e6d32a03451a3780908bdd
```

`f2c8d657...` 仍是 ordinary two-parent merge。

PR #100：

- title：`feat(pvep): integrate authorized portable verification evidence protocol`；
- Open；
- Draft；
- 未合并；
- mergeable；
- base = `main@028d14458269d0be6196e724fe5a0416dbfa900a`；
- Head = `f2c8d657f3623d1982fc71d687a4967aa457268f`；
- 45 commits；
- 41 changed files；
- 0 deletions。

正式 implementation diff 仍恰好为授权的 41 路径；`package.json` 不在 diff 中。canonical sorted-path-set + trailing-newline SHA-256 fresh 重算仍为：

`8f32666cc108db2f2804f218c94bba7c100eacac30812d23156619c8ac20d2cd`

### 4.2 Fresh remote workflow evidence

exact Head `f2c8d657...`：

- Stage 6.4.5.9 WP0 Architecture Gates：run `31143719604`，GREEN；
  - `wp0-route` job `92758775876`：GREEN；
  - `wp0-product` job `92758885334`：GREEN；
  - Ubuntu sealed export job `92758885354`：GREEN；
  - Windows sealed export job `92758885380`：GREEN；
  - final `wp0-gates` job `92759037359`：GREEN。
- ACV2 WP-A Architecture Gates：run `31143719585`，GREEN；
  - Ubuntu job `92758775787`：GREEN；
  - source-closure job `92758775793`：GREEN；
  - Windows job `92758775823`：GREEN。

这些 GREEN 只证明现有门禁通过；不能覆盖 V2.1 Task 12 新增的 OSS-fit 与人工安全审查结论。

### 4.3 Review state

本次核验开始时 PR #100：

- inline review threads = 0；
- submitted reviews = 0。

随后已经对 exact Head `f2c8d657...` 提交 Task 12 最终人工安全 COMMENT review；GitHub 因连接身份就是 PR 作者而禁止 self `REQUEST_CHANGES`，因此使用 `COMMENTED` review 记录阻断结论，PR 继续保持 Draft。

当前正式 Task 12 review：

- review node：`PRR_kwDOTpHaoM8AAAABItqJyw`；
- state：`COMMENTED`；
- submitted：`2026-08-07T03:34:08Z`；
- verdict：**BLOCKED — do not mark Ready or merge**。

## 5. Task 12 最终人工安全审查

### P0 — GitHub API rebind 没有认证 PVEP receipt / command facts 的来源

当前 `github-actions-v1` verifier 会验证：

- repository / exact Head；
- workflow ID / run ID / attempt；
- workflow run conclusion = success；
- job ID 集合及 job conclusion；
- 若存在 artifact，则检查 artifact identity / bytes。

但 PVEP receipt 本身只是 Yance 自己计算 canonical hash / receipt hash；GitHub 没有对该 receipt 或其中 command facts 做密码学签名，也没有 provenance attestation 证明这些 command facts 确实由所引用 run 产生。

更关键的是，当前 `pvep-linux-selftest-v1` 与 `pvep-windows-selftest-v1` command set 的 `artifacts` 均为空，因此该自测路径连 artifact-content binding 都不存在。攻击者可以构造 schema 合法、`exitCode=0` / `passed=true` 的 receipt，自行重算 Yance hash，再指向一个匹配 exact Head / workflow / jobs 的成功 run；当前 verifier 无法证明 receipt 中的命令事实来自该 run。

这直接破坏 trusted-evidence 边界，属于 P0 merge blocker。禁止通过继续增加本地 hash 或更多 API 字段临时修补；必须由真实 attestation/provenance 来源绑定接管。

### P1 — signed executor 的 signer 隔离没有绑定 trusted runner/builder implementation

当前 `signed-executor-v1` 正确地把 Ed25519 私钥从 repository runner 中隔离，但生产信任模型没有把**生成待签 payload 的 runner implementation**绑定到独立可信、base-owned、immutable/pinned 的实现。

现有操作文档直接运行 worktree 中的 `tools/verification/run-command-set.js`；signer isolation 只约束 key custody 与 canonical payload channel。如果候选 Head 控制生成 payload 的 runner 代码，候选可以先伪造成功 command facts，再把合法格式 payload 送入 signer。仅隔离私钥不能证明命令真的执行过。

生产 executor 必须由独立可信 builder/runner 身份产生 provenance，或者让成熟 attestation 系统把 provenance generation 与不可信 workload 隔离。

该问题属于 P1 merge blocker。

## 6. V2.1 OSS-fit 结论：当前 PVEP 形态 FAIL，必须底层重构

当前 PVEP 存在重复自研成熟供应链基础能力，不能以“已经写完/现有测试 GREEN”为理由合并。

### 6.1 应由成熟 OSS / 平台能力接管

- **in-toto Statement + DSSE**：接管通用 statement/envelope 与签名 payload 语义；删除 Yance 自定义通用 receipt envelope / JCS-signing 协议作为信任基础。
- **GitHub Artifact Attestations**：接管 GitHub-hosted provenance 与 GitHub Actions identity binding；不再用 Yance 自制 `github-api-rebind` 认证 command facts。
- **Sigstore / cosign**：接管签名、keyless OIDC identity、certificate/bundle、transparency/offline verification；不再自研通用 detached-signature authenticity 协议。
- **SLSA provenance**：用于真实 build artifact 的 provenance；不要把 SLSA provenance 强行滥用为所有测试 gate 的唯一 predicate。PVEP test/gate evidence 可使用 in-toto custom predicate/statement。
- **Sigstore/GitHub trusted roots；TUF（适用时）**：由上游 trusted-root lifecycle 承接 Fulcio/Rekor/GitHub Sigstore 根信任更新；Yance 不再维护通用 root/key-generation lifecycle。TUF 不需要再由 Yance 另造一套。

### 6.2 Yance 只保留薄层

PVEP 重构后 Yance 只应保留：

1. exact-Head binding；
2. work-package exact path policy；
3. Linux + Windows same-Head requirement aggregation；
4. Yance governance reason codes；
5. trusted-executor / GitHub evidence policy adapter；
6. 对上游 attestation predicate 的最小 Yance-specific schema/policy。

不要继续保留第二套通用签名格式、证书/密钥生命周期、GitHub provenance 协议或 trust-root 系统。

## 7. 当前正式授权边界

现行授权来自 trusted main 的：

`governance/layered-ci/pvep-implementation-v2-authorization.json`

它明确约束：

```text
approvedChangedFileCount = 41
approvedChangedFileSetSha256 = 8f32666cc108db2f2804f218c94bba7c100eacac30812d23156619c8ac20d2cd
newDependencyAllowed = false
workflowModificationAllowed = false
productionUseAuthorized = false
readyForPromotionAuthorized = false
automaticNextWorkPackageAuthorizationAuthorized = false
```

因此，Task 12 已同时命中：

- 真实安全 RED（P0 + P1）；
- V2.1 OSS-fit FAIL；
- 正式授权边界。

采用 `actions/attest` / GitHub Artifact Attestations、Sigstore/cosign、in-toto/DSSE 等成熟实现需要新增依赖和/或 workflow、trusted-builder 配置等路径，不能在当前 41-path 授权下偷偷实施。

**当前禁止：**

- 把 PR #100 改 Ready；
- merge PR #100；
- 用额外 Yance hash、手写签名包装或 API 字段检查临时绕过 P0/P1；
- 在未授权路径增加 Sigstore/in-toto/GitHub attestation 依赖或 workflow；
- 因为现有 Actions GREEN 而忽略 V2.1 OSS-fit；
- 提前启动依赖“PVEP 已收口”的后续产品工作包。

## 8. 下一完整工作包：PVEP OSS-backed refactor authorization

下一步必须先建立新的独立正式授权工作包，授权成熟 OSS 接管所需的精确路径/依赖/workflow 修改，然后按失败测试先行完成底层替换。

推荐重构顺序：

```text
RED 1: 伪造 github-api-rebind receipt 不得被可信化
RED 2: candidate-controlled runner 不得获得 trusted signed-executor provenance
        ↓
in-toto Statement / DSSE predicate model
        ↓
GitHub Artifact Attestations / actions/attest for GitHub-hosted evidence
        ↓
Sigstore/cosign bundle + identity verification for portable/local evidence
        ↓
SLSA provenance only for build artifacts
        ↓
Sigstore/GitHub trusted-root adapter (TUF upstream lifecycle where applicable)
        ↓
Yance thin exact-Head/path/same-Head/reason-code aggregation
        ↓
new exact Head full gates + manual security review + OSS-fit
        ↓
owner exact-Head merge approval boundary
```

在该授权生效前，PR #100 保持 Draft@`f2c8d657...`，不合并。

## 9. PVEP 后续产品 P0（尚未启动）

只有 PVEP OSS-backed refactor 完成、exact-Head 全门禁与安全/OSS-fit 通过并完成 owner merge approval 后，才进入 V2.1 产品 P0：

- Matrix/Synapse + Element + mautrix WhatsApp；
- 单一可折叠/可隐藏/可拖拽 Yance Workspace；
- Letta + Parlant；
- LiteLLM/RouteLLM；
- Langfuse。

并行准备：

- CosyVoice VoiceProfile；
- Immich real-first photo。

第一文字闭环稳定后启动：

- CyberVerse + LiveKit Personal AI Avatar。

不得提前恢复旧 V1/Chatwoot-only/自研 Channel Fabric/WP-B 主线。

## 10. 恢复协议

每次恢复实施必须：

1. 读取 `START_HERE.md`；
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1；
3. 读取本文件；
4. fresh 查询 `main`、PR #100、目标 implementation branch、workflow runs/jobs、review、授权文件与 exact Head；
5. 若任何 SHA、PR 状态、路径、workflow 或 review 与本文件不同，以实时远端为准；
6. 继续快速落地模式，但只能在新的正式授权范围内实施；
7. 禁止强推、rebase/amend、弱化门禁或临时绕过。
