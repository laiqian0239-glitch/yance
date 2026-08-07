# 言策项目持续执行接续记录

> **本文件只负责动态执行接续，不承载稳定架构。**
>
> 稳定架构唯一来源：[`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md) V2.1。
>
> 新聊天必须先读取 [`START_HERE.md`](./START_HERE.md)、V2.1 主计划和本文件，然后 fresh 核验 GitHub refs、PR、workflow、review 与 exact Head。实时 GitHub 事实优先于本文件。

## 0. 固定执行规则

1. 禁止临时绕过，必须底层修复 / 成熟 OSS 替换。
2. failure-first；不得跳过、关闭、弱化门禁制造 GREEN。
3. 不强推，不 amend/rebase 改写已发布历史。
4. 普通 merge 保留 ordinary two-parent history。
5. 成熟 OSS 优先；任何新的 Yance 自研基础设施必须先通过 V2.1 OSS-fit。
6. 快速落地模式：按完整 work package 连续实施，不按小 Task 单独审批；只在真实 RED、正式授权边界或最终 owner exact-Head merge approval 边界停下。
7. 当前已经授权的工作包不重复授权，不重新制造已经成立的 RED。
8. 稳定实施切片优先远端 checkpoint；Draft PR 作为恢复点。
9. failure-first RED 只取得 causal evidence；实现阶段尽量整包原子提交，最终 exact Head 再跑完整门禁。
10. CI 等待期间并行做只读上游/license/source/diff/scope 核验，不空转。
11. uploaded bundle/cache 可以离线加速，但 live GitHub SHA/blob/ref 才是最终权威。

## 1. V2.1 当前稳定产品方向

V2.1 已并入 Relationship Intelligence Enhancement，属于**原 V2.1 的严格超集增强**，不另起 V2.2，不重做 Communications/Letta 等已完成或已授权工作。

产品定位：

> **个人使用、开源、面向真实交友 / 情感 / 长期关系沟通的 AI 助手。**

不是 CRM、销售漏斗或营销自动化产品。

当前稳定架构继续包含：

- Matrix / Synapse / Element / mautrix 多平台；
- Letta + Graphiti；
- Parlant Relationship Goal/Journey；
- LiteLLM + RouteLLM；
- Langfuse + OpenTelemetry + DSPy + Promptfoo；
- SenseVoice / STT + CosyVoice；
- Immich + ComfyUI；
- CyberVerse + LiveKit + Avatar backends；
- Docling / Retrieval / MCP；
- 单一 Yance 产品工作区、设置/通知体验、用户确认与最终发送决策。

## 2. Communications P0 已完成，不得重做

PR #112 `feat(v21): adopt Matrix Element and mautrix-whatsapp P0` 已 merged。

实时核验：

- PR #112：closed / merged；
- final product Head：`8a2892cf9045cfe69b0340aeebbc8dbb27b2cb01`；
- ordinary merge commit：`932c7c6588de9af6bd86becc31b90b54e4110be4`；
- changed files：22；
- exact authorized path-set SHA-256：`972786dec8299d2d8c7e9b9a7aa44e89608310f6ac4f462d5d35fbf613f71ab2`；
- final Stage / ACV2 / post-merge / PVEP and independent review were GREEN at closure。

已冻结上游：

### Synapse
- version `v1.158.0`
- commit `7a3e98b6f77ee3a5fe4dbeb934b0a0c1721e6afe`

### Element Web
- version `v1.12.25`
- commit `a2a996ae50d802878bf48e4bbf3730004bdcc55c`

### mautrix-whatsapp
- version `v0.2607.0`
- commit `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`

不要重新规划 Communications P0，不恢复旧 Chatwoot Product Shell，也不要再建立 Yance 第二套 message/channel/sync runtime。

## 3. trusted main 当前事实

fresh GitHub 核验：

`main = cb8f816759dec6a17d22a9bd37cd2a23a72946fd`

这是 PR #118 `governance(v21): authorize Letta P0 v2` 的 ordinary merge commit。

PR #118：

- closed / merged；
- authorization head：`3b115a666faee4a9ff7b6db6e651ee58124b7f69`；
- merge：`cb8f816759dec6a17d22a9bd37cd2a23a72946fd`；
- scope：Letta P0 v2 exact 14 paths；
- workflow modification forbidden。

## 4. 当前实施工作包：Letta P0 v2 / PR #119

PR：**#119 `feat(v21): adopt Letta persistent-agent P0 v2`**

fresh 状态：

- Open；
- Draft；
- 未 merge；
- mergeable；
- branch：`product/v21-letta-p0-v2`；
- base：`main@cb8f816759dec6a17d22a9bd37cd2a23a72946fd`；
- exact current Head：`9e5dbf19de8dde85ac18324bd9877a997f9a8e00`；
- 3 commits；
- 3 changed files；
- 目前只含实施计划 + 两份 failure-first tests；
- **当前仍是预期 causal RED，尚无 Letta production code/dependency changes。**

### 4.1 正式授权范围

Work package：`V21-LETTA-P0-V2`

正式 implementation branch：

`product/v21-letta-p0-v2`

旧 `product/v21-letta-p0` 已被 supersede，不得继续使用。

exact 14 paths：

1. `THIRD_PARTY_NOTICES.md`
2. `config/upstreams/v21-letta-p0.json`
3. `docs/superpowers/plans/2026-08-07-yance-v21-letta-p0.md`
4. `electron/lettaAgentRuntime.js`
5. `electron/m2/ipcManifest.json`
6. `electron/main.js`
7. `electron/preload.js`
8. `integration/element-module/src/YanceWorkspace.tsx`
9. `package-lock.json`
10. `package.json`
11. `tests/wp0/v21-letta-p0.test.js`
12. `tests/wp0/v21-letta-workspace-contract.test.js`
13. `third_party/licenses/letta-agent-sdk-Apache-2.0.txt`
14. `third_party/licenses/letta-code-Apache-2.0.txt`

canonical path-set SHA-256：

`97a70af318307f072f029266b25b49f1ea3caeddf4382313adc452c9f0dab65d`

唯一 dependency-control paths：

- `package.json`
- `package-lock.json`

dependency-path digest：

`3a91d218beeaf6db0adeada91763ad528830a37c39fe81733e2f0b201ed47cb2`

### 4.2 已冻结 Letta OSS-fit

Direct exact dependencies：

- `@letta-ai/letta-agent-sdk@0.6.2`
- `@letta-ai/letta-code@0.30.5`

架构：

```text
Yance Electron main
  ↓ supervise trusted Node child
official Letta Code CLI
  letta server --listen ws://127.0.0.1:0
  ↓
loopback App Server
  ↓
public Letta Agent SDK
  backend: remote
```

固定边界：

- Letta owns agent state / memory / conversations / compaction / App Server internals；
- Yance 只监督官方 child lifecycle，并通过公开 remote API 做产品投影；
- `LETTA_LOCAL_BACKEND_DIR` 必须位于 Yance data root；
- stop 通过 SIGTERM 触发官方 clean shutdown；
- 禁止 private SDK fields/subpaths、复制 launcher、第二套 Yance agent memory/runtime。

### 4.3 causal RED 已成立

exact Head：

`9e5dbf19de8dde85ac18324bd9877a997f9a8e00`

Stage run：

`31191936121` — failure（预期 causal RED）

同一 exact Head：

- ACV2 `31191935852` — success；
- WP-A Main Post-Merge Validation `31191936242` — success。

Stage 失败精确落在新增 Letta product contracts：

- 首个失败：缺 `config/upstreams/v21-letta-p0.json`；
- 随后证明缺 exact Letta dependencies；
- 缺 `electron/lettaAgentRuntime.js`；
- 缺 IPC manifest/preload/main wiring；
- 缺现有 Yance Workspace 的 Letta projection；
- 没有语法错误或无关既有测试回归。

这是有效 failure-first 边界。下一步不是重新研究/重新授权/重新制造 RED，而是直接实施授权的 GREEN closure。

## 5. #119 下一步

继续在 `product/v21-letta-p0-v2` 上整包实现：

1. `config/upstreams/v21-letta-p0.json` exact provenance；
2. exact dependencies + Node >=22.19.0 + 正确 package-lock；
3. Apache-2.0 license copies + THIRD_PARTY_NOTICES；
4. `electron/lettaAgentRuntime.js` official CLI supervision；
5. main lifecycle integration；
6. read-only guarded IPC + preload + manifest；
7. 只在现有 Element `YanceWorkspace` 投影 Letta state/agents/conversations；
8. real local App Server probe + SIGTERM clean child exit；
9. final exact 14 paths/digest；
10. Stage / Layered / ACV2 / sealed-export / review threads 全 GREEN；
11. 最终停在 owner exact-Head merge approval，**不得自行 merge #119**。

## 6. Relationship Intelligence Enhancement 已写入 V2.1，但不扩大 #119

后续主线：

1. Parlant Relationship Goal/Journey；
2. LiteLLM + RouteLLM；
3. Langfuse + OpenTelemetry；
4. SenseVoice + CosyVoice；
5. Immich Relationship Media Memory；
6. Graphiti Relationship Timeline；
7. SillyTavern Persona / Character / Lorebook / Prompt 可移植模块 OSS-fit；
8. Docling + Retrieval；
9. MCP；
10. ComfyUI identity visual；
11. Live voice；
12. CyberVerse + LiveKit Avatar；
13. Temporal/durable engine only when a real long-running workflow requires it。

每项都必须独立 OSS-fit / authorization / RED-GREEN / PR。

## 7. Facebook modernization 新增为独立并行线

现有 Facebook Page 真实问题历史包括 OAuth/scope/domain/redirect、Business Login configuration、Business Suite 会话/echo、未知 PSID、history/reconciliation、permission-limited 状态等。

后续不再默认扩大 Yance 自研 Facebook transport，而是独立评估两条成熟 OSS 路线：

### Official Page Engine

- Chatwoot OSS Facebook Channel 的 MIT 范围能力；
- Meta official API / SDK / schema；
- Yance 只保留极薄 Facebook Bridge、统一产品投影和最终发送决策。

### Optional Session Engine

- `facebook-chat-api` 架构及 2026 仍维护的 FCA-compatible forks；
- 目标：账号/session 登录、2FA、encrypted appState、Personal Messenger，并真实验证 Page identity switch / Page send / Page receive / Business Suite echo；
- 只有真实 Facebook account + Page + Windows/Electron probe 全部成立后才准入；
- 不长期保存明文密码；
- 不凭旧 README/旧 `pageID` 支持宣称当前可用。

Facebook modernization 不允许污染 #119。

## 8. 跨聊天启动最短动作

1. 读取 `START_HERE.md`；
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1；
3. 读取本文件；
4. fresh 核验 `main`；
5. fresh 核验 #119 base/head/draft/mergeable/status；
6. fresh 核验 exact Head workflows；
7. 如 #119 Head 没有外部漂移，直接从 causal RED 继续 GREEN implementation；
8. 不重新规划 Communications P0，不重新授权 Letta，不扩大 #119 scope；
9. Relationship/Facebook 新能力另开独立 work package；
10. 只在真实 RED、正式授权边界或最终 exact-Head merge approval 停下。
