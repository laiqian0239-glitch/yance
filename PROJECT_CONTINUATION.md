# 言策项目持续执行接续记录

> **本文件只负责动态执行接续，不承载稳定架构。**
>
> 稳定架构唯一来源：[`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md) V2.1。
>
> 新聊天必须先读取 [`START_HERE.md`](./START_HERE.md)、V2.1 主计划和本文件，然后重新核验远端 refs、PR、workflow、review、receipt 与 exact Head。实时远端事实优先于本文件中的历史状态。

## 0. 固定执行规则

1. 禁止临时绕过，必须底层修复/底层替换为成熟 OSS。
2. 失败测试先行；不得跳过、关闭、弱化门禁制造 GREEN。
3. 不强推，不 amend/rebase 改写已发布历史。
4. 普通 merge 必须保留 two-parent 历史。
5. 成熟 OSS 优先；任何新的 Yance 自研基础设施必须先通过 V2.1 OSS-fit 准入。
6. 快速落地模式：按完整工作包连续实施，不按小 Task 单独审批；只在真实 RED、正式授权边界或最终 owner exact-Head merge approval 边界停下。
7. 本文件不授予新增实现、依赖、workflow、promotion、release、publish 或下一工作包权限。

## 1. 当前稳定架构入口

```text
START_HERE.md
      ↓
YANCE_IMPLEMENTATION_MASTER_PLAN.md  V2.1
      ↓
PROJECT_CONTINUATION.md  动态状态
      ↓
实时远端 refs / PR / workflow / review / exact Head
```

V2.1 当前产品主线仍为：

- Matrix/Synapse + Element + mautrix bridges；
- 单一统一、可折叠/隐藏/拖拽的 Yance 工作区；
- Letta + Graphiti；
- Parlant Goal/Journey；
- RouteLLM + LiteLLM；
- Langfuse + DSPy + Promptfoo；
- CosyVoice VoiceProfile；
- Immich real-first photo；
- 后续 ComfyUI + CyberVerse + LiveKit Personal Presence。

不得恢复第二套 Yance 消息状态机、Agent memory、Journey runtime、模型网关、照片系统、TTS、WebRTC/SFU、Avatar 或通用供应链信任基础设施。

## 2. PVEP 已完成 OSS-backed 安全收口

### 2.1 最终 merge

截至 2026-08-07 实时核验：

```text
trusted main = 043a446b5e9a995cd63835f11924ab0c42bd2e0d
merged PR = #108
reviewed exact Head = 3981d0e003f83c374deb0a4ea1b228bf89300863
authorization merge = 7f4c15bb93e053f17f6c1cb874342099242dff4c
```

PR #108 已经由 owner 明确批准 exact Head 后使用普通 `merge` 合并。

merge commit `043a446b5e9a995cd63835f11924ab0c42bd2e0d` 是 ordinary two-parent merge：

```text
parent1 = 7f4c15bb93e053f17f6c1cb874342099242dff4c
parent2 = 3981d0e003f83c374deb0a4ea1b228bf89300863
```

GitHub commit verification = valid；远端 `refs/heads/main` 已精确指向该 merge commit。

### 2.2 最终实现范围

相对正式授权 merge，最终实现恰好 5 路径 / 5 commits：

```text
docs/governance/PVEP_OPERATIONS.md
governance/verification/requirements/pvep-selftest-v1.json
shared/verification/githubAttestationVerifier.js
tests/layered-ci/pvep-github-attestation-verifier.test.js
tools/verification/verify-attestation.js
```

canonical sorted path-set SHA-256：

`8acee72f1756d1e8ea4edfdb1524a1ca5055e6fcd8a65f2bf5bef38e08bb0865`

没有新增 package dependency；没有在最终 5 路径实现中修改 workflow。

### 2.3 Failure-first 证据

失败测试 commit：

`bbc7c139eab84a25e5aad65136f535190dfc54da`

Layered CI run `31148679653` / job `92773565165`：81/82，通过 81 项，唯一 causal RED：

`Cannot find module '../../shared/verification/githubAttestationVerifier'`

随后在同一授权范围内完成实现，final exact Head `3981d0e0...` 的对应 Layered contract 转 GREEN。

### 2.4 final exact-Head GREEN

exact Head `3981d0e003f83c374deb0a4ea1b228bf89300863`：

- PVEP Attested Evidence run `31148820641`：SUCCESS；
  - Linux job `92773993548`：SUCCESS；
  - Windows job `92773993577`：SUCCESS；
  - `attest-same-head` job `92774101201`：SUCCESS；
  - `actions/attest`：SUCCESS；
  - strict `gh attestation verify` signer/source verification：SUCCESS。
- Stage 6.4.5.9 WP0 run `31148821927`：SUCCESS。
- Layered CI Fast Feedback run `31148821964`：SUCCESS。
- ACV2 WP-A Architecture Gates run `31148821907`：SUCCESS；source-closure / Ubuntu / Windows 全 GREEN。
- unresolved review threads = 0。

## 3. PVEP 信任架构最终结论

旧 41 路径 PR #100 的通用自研信任栈被正式废止，不再作为活动实现：

- custom JCS / canonical receipt；
- detached Ed25519 executor/signature trust；
- executor registry / custom trust-root lifecycle；
- GitHub API rebind 作为 command-fact authenticity 来源。

当前活动实现改为：

```text
GitHub base-owned pull_request_target workflow
        ↓
Linux + Windows untrusted workload verification
        ↓
actions/attest / GitHub Artifact Attestations / Sigstore
        ↓
gh attestation verify
        ↓
Yance 极薄 policy：repository/base/head + signer/source + verified timestamp + Linux/Windows requirement + conflict rejection
```

Yance 不再自研第二套通用签名、证书、根信任或 GitHub provenance 协议。

## 4. PR #100 状态

PR #100 `feat(pvep): integrate authorized portable verification evidence protocol` 已：

- Closed；
- 未 merge；
- 保留历史审计；
- 已添加 superseded 说明，明确由 merged PR #108 / main `043a446b...` 替代；
- 禁止以后重新 merge 其 custom trust stack。

## 5. 当前停止点：新的 V2.1 P0 正式授权边界

PVEP 已闭环，因此此前“PVEP 未收口前不得启动 V2.1 产品 P0”的阻塞已解除。

根据 V2.1 §13，下一完整产品工作包应直接建立最短真实产品闭环，首个 P0 为：

```text
Matrix / Synapse
      +
Element
      +
第一真实 bridge（WhatsApp 优先）
      +
统一可折叠 Yance 工作区
```

之后在同一真实闭环路线继续接：

```text
Letta
  ↓
Parlant Goal/Journey
  ↓
RouteLLM + LiteLLM
  ↓
回复候选 + 用户选择/修改
  ↓
真实发送
  ↓
Langfuse trace
```

第一闭环必须直接进入统一 Yance 工作区；不得临时为 WhatsApp 或任何单平台另建产品级聊天页面。

### 5.1 下一工作包的 OSS-first 要求

下一正式授权必须先完成精确 OSS-fit / provenance 冻结，至少覆盖：

- Matrix / Synapse 精确上游 commit/tag、许可证、部署方式；
- Element 精确上游 commit/tag、许可证、可移植产品壳边界；
- mautrix-whatsapp 精确上游 commit/tag、许可证、真实 bridge 能力矩阵；
- 现有 Yance UI/主题/提示音/通知/用户设置的保留与迁移边界；
- 单一工作区折叠/隐藏/拖拽/重启恢复/后台连续性合同；
- 不复制第二套 message/contact/state authority；
- Windows/Electron 与真实账号验证路径；
- 精确授权 changed paths / dependency / workflow 范围；
- rollback 与 compatibility test。

成熟 OSS 能整块采用时必须整块采用；只有真实行为缺口才能批准最小 Yance adapter。

## 6. 下一聊天启动动作

1. 读取 `START_HERE.md`。
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1。
3. 读取本文件。
4. fresh 核验 `main` 是否仍为 `043a446b5e9a995cd63835f11924ab0c42bd2e0d` 或其正常后继。
5. fresh 核验 PR #108 已 merged、PR #100 已 closed/unmerged。
6. 不再继续 PVEP custom trust stack。
7. 从“Matrix + Element + 第一真实 bridge + 统一 Yance 工作区”的**独立正式授权工作包**开始；未获授权前不得写产品实现。
8. 获得授权后按完整工作包连续实施，不按小 Task 停下。
