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
6. 快速落地模式：按完整 work package 连续实施，不按小 Task 单独审批；成熟 OSS 优先整块采用。
7. 已正式授权的工作包不重复授权，不重新制造已经成立的 RED。
8. 稳定实施切片优先远端 checkpoint；Draft PR 作为恢复点。
9. failure-first RED 只取得 causal evidence；实现阶段连续做到底层 GREEN，最终 exact Head 再跑完整门禁。
10. CI 等待期间并行做只读上游/license/source/diff/scope/review 核验，不空转。
11. uploaded bundle/cache 可以离线加速，但 live GitHub SHA/blob/ref 才是最终权威。
12. 已正式授权且 scope 冻结的工作包，在 exact Head/base/scope/gates/review 都不漂移时，standing owner authorization 允许直接完成 routine source merge，不再逐次请示。
13. standing authorization 不覆盖：新 scope/new work package、TRUE RED、license/security/privacy/credential 新边界、production release/publish/promotion、或任何治理弱化。
14. 大文件/二进制/超长源码优先交付完整本地文件、ZIP、bundle、patch 或 cache 给用户，由用户本机上传；上传后必须做 byte/blob/hash 核验，禁止截断、手写 lock/integrity 或用临时架构绕过 connector 限制。

## 1. V2.1 当前稳定产品方向

V2.1 已并入 Relationship Intelligence Enhancement，属于**原 V2.1 的严格超集增强**，不另起 V2.2，不重做 Communications/Letta 等已完成工作。

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

不要重新规划 Communications P0，不恢复旧 Chatwoot Product Shell 作为第二产品，也不要再建立 Yance 第二套 message/channel/sync runtime。

## 3. trusted main：Letta P0 v2 已正式并入

本次交接前 fresh GitHub 事实：

```text
main = d259fc68b81bf099a9b6891fdc5f4cbd5e7d1a36
```

这是 PR #119 的 ordinary two-parent merge commit：

```text
parent1 = e60e6c5c26a0570ae0339c73828891bdbba2bcf0
parent2 = ce1b69575815340ed938112ad58412c52eeea334
verified signature = true
```

PR #119：

- title: `feat(v21): adopt Letta persistent-agent P0 v2`；
- source branch: `product/v21-letta-p0-v2`；
- final reviewed Head: `ce1b69575815340ed938112ad58412c52eeea334`；
- merged: true；
- merge commit: `d259fc68b81bf099a9b6891fdc5f4cbd5e7d1a36`；
- exact changed files: 14；
- canonical path-set SHA-256: `97a70af318307f072f029266b25b49f1ea3caeddf4382313adc452c9f0dab65d`；
- workflow modification: none。

**结论：Letta P0 v2 已完成，不是待实施工作。新聊天不得重新制造其 RED、重新授权、另建第二 Letta runtime 或把旧 #119 Draft 描述当当前事实。**

## 4. Letta P0 v2 最终冻结架构

Direct exact dependencies：

- `@letta-ai/letta-agent-sdk@0.6.2`
  - exact upstream commit `c48df1693731443682fe8c7f356ef9b8a33df6c0`
  - Apache-2.0
- `@letta-ai/letta-code@0.30.5`
  - exact upstream commit `3e5ead65dcf3b7fdf1e2da595660eb85063a9722`
  - Apache-2.0
- Node floor `>=22.19.0`

正式运行边界：

```text
Yance Electron main
  ↓ owns/supervises one child
official @letta-ai/letta-code CLI
  server --backend local --listen ws://127.0.0.1:0
  ↓ loopback App Server
public @letta-ai/letta-agent-sdk
  LettaAgentClient({ backend: 'remote', url })
```

固定 authority：

- Letta owns persistent agent state / memory / conversations / compaction / App Server internals；
- Yance 只负责 official child supervision、Yance-rooted local storage boundary、guarded readonly projection；
- `LETTA_LOCAL_BACKEND_DIR` 在 Yance data root 下；
- inherited `LETTA_API_KEY` 不进入 local child；
- CLI `--backend local` 是 persistence/backend authority；
- SDK `backend:'remote'` 只表示连接拓扑，不表示云端 persistence；
- renderer 只有三个 guarded readonly、data-minimized IPC projection；
- renderer read API 不得启动 Letta child；
- `backendPid` 与 Letta PID 分离；
- 现有 Element `YanceWorkspace` 是唯一产品表面；
- 禁止 Agent SDK private fields/subpaths、复制 launcher、第二套 Yance memory/agent runtime。

### 4.1 shutdown 冻结决策

`stop()` 对 adapter 自己拥有的 Letta child 发送 `SIGTERM` 并等待退出。

独立 review 曾建议：

1. SIGTERM 超时后自动 SIGKILL；
2. Letta mandatory startup 失败时静默继续启动桌面。

这两项均被独立审查后**明确拒绝**，因为与当前 fail-closed authority model 冲突。新聊天不得把这两项当“遗漏 bug”重新加回，除非建立新的正式设计/authorization 边界。

## 5. #119 failure-first 与最终验证证据

初始真实 App Server probe 曾证明：如果只运行 `letta server --listen ...`，可能继承用户/机器 cloud/API backend preference 并要求 `LETTA_API_KEY`。

正确底层修复是：

```text
server --backend local --listen ws://127.0.0.1:0
```

并从 local child environment 移除 `LETTA_API_KEY`。

最终 exact Head：

`ce1b69575815340ed938112ad58412c52eeea334`

最终 pre-merge permanent gates：

- Stage `31233519933` — GREEN；
- ACV2 `31233519858` — GREEN；
- WP-A Main Post-Merge Validation `31233519864` — GREEN；
- independent exact-Head review — complete；
- unresolved inline review threads — 0。

Stage 中：

- locked dependency install GREEN；
- WP0 required tests GREEN；
- real local Letta App Server management/lifecycle probe GREEN；
- real probe 拦截实际 `ChildProcess.kill` 并证明 adapter-owned PID 收到 `SIGTERM`；
- staged-secret scanner GREEN；
- source identity/Electron tracking GREEN；
- protocol descriptor GREEN；
- base-owned executable gate GREEN；
- Ubuntu sealed-export GREEN；
- Windows sealed-export GREEN；
- aggregate `wp0-gates` GREEN。

merge commit `d259fc68...` 自身的 post-merge validation：

- run `31233723919` — GREEN；
- Ubuntu complete portable matrix — GREEN；
- Windows complete portable matrix — **192/192 pass, 0 fail**；
- identity/source closure — GREEN；
- clean validation workspace — GREEN；
- aggregate `wp-a-post-merge-gate` — GREEN。

## 6. #119 前置 route bootstrap 已完成，不得重开

#119 初次生产实现触发过真实 route fail-closed：三个 Letta supply-chain path 未注册。

未知路径当时精确为：

- `config/upstreams/v21-letta-p0.json`
- `third_party/licenses/letta-agent-sdk-Apache-2.0.txt`
- `third_party/licenses/letta-code-Apache-2.0.txt`

正确修复链已完成：

### PR #123

`governance(v21): authorize Letta P0 route bootstrap`

- authorization Head `e35bef1ce4d021f59e5c3ce0ad1acd27589517c1`
- ordinary merge `a8d5852740cd1cc2365a355531ab3b1b46903be2`

### PR #124

`fix(v21): bootstrap exact Letta P0 WP0 routes`

- exact literal route fix only；
- no `config/` / `third_party/` broad prefix；
- final ordinary merge into main `e60e6c5c26a0570ae0339c73828891bdbba2bcf0`。

#119 随后在 fresh main 上完成 14-path implementation closure。

**不要再为 Letta 三路径建立第二套路由修复。**

## 7. active-handoff 自身历史

交接更新前 `project-state/active-handoff` Head：

`8d2d723b1b6ddd4b6c58b3e015f418677437e6a5`

此前关键 handoff merge：

- PR #121：active-handoff documentation route authorization，merge `2d14fda7d4d12b969d8eeec577b3d4a210c67828`；
- PR #122：active-handoff root document routing fix，merge `20578070cd717132cb841f412a012dc03010bb92`；
- PR #120：Relationship Intelligence + Facebook modernization docs，merge `8d2d723b1b6ddd4b6c58b3e015f418677437e6a5`。

本次 handoff 更新只刷新 `START_HERE.md` 与 `PROJECT_CONTINUATION.md`，不修改 V2.1 主计划或产品代码。

## 8. 当前没有“继续 #119 实现”任务

新的聊天开始后，第一件产品工作不是继续 #119，而是：

1. fresh 核验 main 是否仍为 `d259fc68...` 或有新的可信 advancement；
2. 读取 active-handoff 最新 Head；
3. 重新确认没有外部工作线已经推进；
4. 从 V2.1 主计划中选择**新的独立 work package**；
5. 对该 work package 做 V2.1 OSS-fit / exact upstream / license / architecture boundary；
6. 建立新的正式 authorization/scope；
7. failure-first RED；
8. 连续实现完整 GREEN closure；
9. standing owner authorization 只在该新 work package 的正式 scope 已成立后覆盖 routine merge。

Relationship Intelligence 默认候选顺序仍包括：

- Parlant Relationship Goal/Journey；
- Graphiti Relationship Timeline；
- SillyTavern Persona / Character / Lorebook / Prompt 可移植模块；
- LiteLLM + RouteLLM；
- Langfuse + OpenTelemetry + DSPy + Promptfoo；
- SenseVoice + CosyVoice；
- Immich + ComfyUI；
- Docling + Retrieval；
- MCP；
- LiveKit/Pipecat / Avatar。

具体下一项不得凭旧聊天猜测；以 V2.1 主计划、当前远端事实和新的 OSS-fit 为准。

## 9. Facebook modernization 仍为独立工作线

Facebook 必须区分：

### Official Page Engine

- Chatwoot OSS Facebook Channel 可移植核心；
- Meta official API / SDK / schema；
- Yance 只保留极薄 bridge、统一产品投影和最终发送决策。

### Optional Session Engine

- `facebook-chat-api` / 2026 仍维护的 FCA-compatible forks；
- 必须真实验证 account + Page 登录、2FA、encrypted appState、send/receive、Business Suite echo、Page identity switch、reconnect、Windows/Electron；
- 不长期保存明文密码；
- 不能凭旧 README 的 `pageID` 宣称当前可用。

这条线必须独立 OSS-fit / authorization / RED-GREEN / PR，不污染其他关系智能工作包。

## 10. 旧开放 PR：默认历史，不自动复活

仓库当前仍存在多条旧 Draft/open PR。其正文中的 base SHA、exact Head、授权状态可能严重滞后。

尤其包括：

- ACV2 / OSS-1A 历史栈：#17、#20、#21、#23、#25、#28、#30、#33、#35、#37、#42、#43、#44；
- 旧 UI governance/design 栈：#50、#53、#54、#65、#85、#92；
- OSS-A：#67；
- 旧 PVEP design：#93。

固定规则：

- Open/Draft 只说明 GitHub 对象还存在，不等于当前工作包；
- 不得直接相信旧 PR 正文缓存的 main/head/workflow；
- 不得因为 standing owner authorization 就把这些历史 PR 自动 merge；
- 如果未来要恢复其中某条线，必须先 fresh 核验 supersession、当前 main、exact Head、scope、receipt、review 和适用 V2.1 方向；
- 新工作包不得污染这些历史分支。

## 11. 大文件 / 本机上传交接规则

用户明确要求以后保持：**大文件给用户，由用户本机上传。**

执行方式：

1. ChatGPT 负责生成或整理完整文件/ZIP/patch/bundle/cache；
2. 提供可下载文件给用户；
3. 用户在本机上传到 GitHub 或新聊天；
4. ChatGPT 对上传后的远端 blob/file 做 byte-level 或 hash-level 核验；
5. 核验通过后才继续 exact-Head seal。

适用示例：

- `electron/main.js` 这类过大源码；
- 大型 JSON manifest；
- Electron ZIP；
- npm tgz/cache；
- portable Git bundle；
- Git LFS object；
- package-lock seed/cache。

#119 收口期间已经使用过这一模式：用户本机上传包含最终 `electron/main.js` / `electron/m2/ipcManifest.json` 的文件，随后对 GitHub blobs 与上传字节做了完全一致核验，再进入 exact Head 门禁。

### 11.1 当前聊天本地资产不可跨聊天假设存在

本聊天曾出现的本地资产包括：

- `yance-pvep-portable-2026-08-07(1).bundle`
- `yance-pvep-npm-cacache-2026-08-07.tar(1).gz`
- `electron-v39.8.5-linux-x64(2).zip`
- `yauzl-2.10.0(3).tgz`
- 以及用户后续上传的 Letta/大文件修复材料。

新聊天的 `/mnt/data` 不保证继承这些文件。若新的工作包真正需要，要求用户重新上传或从正式 GitHub/artifact 获取；不得假设旧路径仍存在。

## 12. 新聊天启动动作（必须完整执行）

1. 读取 `project-state/active-handoff:START_HERE.md`；
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1；
3. 读取本 `PROJECT_CONTINUATION.md`；
4. 明确宣布当前遵循 mature-OSS-first / failure-first / fast complete-work-package 模式；
5. fresh 核验 `main`；
6. fresh 核验 `project-state/active-handoff`；
7. fresh 查询最近 merged/open PR，确认没有外部 advancement；
8. 确认 #119 已 merged，不重新实施 Letta P0 v2；
9. 不自动恢复 #67/#92/#93 或旧 OSS-1A/UI 栈；
10. 根据 V2.1 选择下一独立 work package，先完成 OSS-fit 与 formal scope；
11. failure-first RED 后连续实施完整工作包，不逐小 Task 请示；
12. routine source merge 在 standing owner authorization 条件满足时直接完成；
13. 新 scope / TRUE RED / license-security boundary / release-publish-promotion 才停；
14. 大文件由 ChatGPT 生成完整文件交给用户本机上传，之后做 byte/hash 核验；
15. 任何 cached SHA/PR/body 都必须让位于 fresh GitHub facts。

## 13. 新聊天可直接使用的最短事实摘要

```text
Repo: laiqian0239-glitch/yance
Stable handoff branch: project-state/active-handoff
Architecture authority: YANCE_IMPLEMENTATION_MASTER_PLAN.md V2.1
Product: personal/open-source relationship communication AI, not CRM/sales
Mode: mature OSS first + failure-first + complete work-package fast execution
No bypass / no force / no rebase-amend published history / ordinary two-parent merge
Standing owner auth: routine merge allowed only after existing formal scope + fresh exact-Head/base/scope/gates/review seal
Large files: ChatGPT gives complete local file/ZIP/patch; user uploads from own machine; then byte/hash verify
Communications P0: DONE
Letta P0 v2: DONE
#119 final reviewed Head: ce1b69575815340ed938112ad58412c52eeea334
#119 merge/main: d259fc68b81bf099a9b6891fdc5f4cbd5e7d1a36
#119 14-path digest: 97a70af318307f072f029266b25b49f1ea3caeddf4382313adc452c9f0dab65d
post-merge run 31233723919: GREEN, Windows 192/192
Next: choose a NEW independent V2.1 OSS work package; do not continue #119
Old open PRs are not automatically actionable; fresh verify before any reuse
```
