# 言策项目持续执行接续记录

> **本文件只负责动态执行接续，不承载稳定架构。**
>
> 稳定架构唯一来源：[`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md) V2.1。
>
> 新聊天必须先读取 [`START_HERE.md`](./START_HERE.md)、V2.1 主计划和本文件，然后 fresh 核验远端 refs、PR、workflow、review 与 exact Head。实时 GitHub 事实优先于本文件。

## 0. 固定执行规则

1. 禁止临时绕过，必须底层修复/成熟 OSS 替换。
2. 失败测试先行；不得跳过、关闭、弱化门禁制造 GREEN。
3. 不强推，不 amend/rebase 改写已发布历史。
4. 普通 merge 必须保留 two-parent 历史。
5. 成熟 OSS 优先；任何新的 Yance 自研基础设施必须先通过 V2.1 OSS-fit 准入。
6. 快速落地模式：按完整工作包连续实施，不按小 Task 单独审批；只在真实 RED、正式授权边界或最终 owner exact-Head merge approval 边界停下。
7. 当前 P0 已完成正式授权；不要再次停下来索取中间 Task 批准。
8. **防丢失加速规则**：稳定的非平凡实施切片优先用单个 Git tree 原子提交并立即 fast-forward 到远端 Draft 实施分支；不要在会话里长期积累未提交代码。昂贵查询/长 CI 前先做远端 checkpoint。
9. **减少无效 CI**：failure-first RED 只需取得 causal 证据；实现阶段尽量整包/大切片原子提交，不逐文件 push。最终 exact Head 才要求适用全门禁完整 GREEN。
10. **等待不空转**：CI 运行期间并行做只读上游核验、license/source closure、patch 生成、diff 审查；不得为了等待而停。
11. 已冻结的上游/架构不重复研究；只做 fresh drift 核验。上传的 portable bundle 可用于代码地图/本地精确 blob 重放，但 live GitHub refs/精确 blob 才是最终权威。

## 1. 当前产品架构与唯一目标

当前 V2.1 第一真实产品闭环：

```text
Matrix/Synapse + Element + mautrix-whatsapp
        ↓
单一统一 Element conversation shell
        ↓
可折叠/隐藏/可恢复 Yance Workspace
        ↓
Letta → Parlant → RouteLLM/LiteLLM → reply candidates
        ↓
用户选择/修改 → Matrix/bridge 真实发送 → Langfuse
```

当前工作只推进第一段：**Matrix/Synapse + Element + 第一真实 WhatsApp bridge + 统一 Yance Workspace**。

权威边界：
- Synapse = Matrix server/state authority；
- Element = conversation/product shell authority；
- mautrix-whatsapp = WhatsApp bridge authority；
- Yance 只保留薄 branding/integration/workspace UX，不新建第二套 message/contact/channel/state runtime。

不得恢复旧 Chatwoot 产品壳、每平台独立聊天页面、第二套消息状态机或自研通信基础设施。

## 2. 已完成的治理闭环

PVEP 已由 PR #108 完整收口，旧 PR #100 已 closed/unmerged，不再继续 custom trust stack。

为 P0 OSS dependency 引入补齐的治理链也已完成：

- PR #109：exact dependency-control delegation authorization，ordinary merge `d4da61ac...`；
- PR #110：dependency delegation policy implementation，causal RED `32f81ff4...`，GREEN implementation Head `9e309cf8...`，ordinary merge `c3363f8c...`；
- PR #111：V2.1 Comms P0 正式授权，ordinary merge **`2e7beefc6fd349f5a0b06ab6d5ded67418e75d9f`**。

当前 live `main` fresh 核验：

**`2e7beefc6fd349f5a0b06ab6d5ded67418e75d9f`**

因此 P0 实施已经在授权范围内；新聊天不要再建立一轮重复授权。

## 3. 当前实施 PR #112

PR：**#112 `feat(v21): adopt Matrix Element and mautrix-whatsapp P0`**

状态：
- Open；
- Draft；
- 未 merge；
- branch：`product/v21-comms-p0`；
- base：`main@2e7beefc6fd349f5a0b06ab6d5ded67418e75d9f`。

### 3.1 Failure-first RED

RED Head：

**`7664eea49b206ec3bd40fc2efeca7e690ca4ae5d`**

只包含两份永久 WP0 合同：
- `tests/wp0/v21-comms-p0.test.js`
- `tests/wp0/v21-element-workspace-contract.test.js`

Stage WP0 run **`31153194208`**：
- routing GREEN；
- Linux sealed-export GREEN；
- Windows sealed-export GREEN；
- 唯一 causal failure = `wp0-product / Run WP0 required tests`，8/8 都是缺少本 P0 实现文件/行为。

这是有效 RED；不要重新制造另一颗 failure-only Head。

### 3.2 当前远端 recovery checkpoint

为防止长会话卡死导致进度丢失，当前实施已经上传到远端：

**exact Head = `9cfbfa62e8fa9e04a902458056529dd586c08771`**

commit：`wip(v21): checkpoint Matrix Element P0 implementation`

当前 PR #112：
- 3 commits；
- 15 changed files；
- 其中 2 个永久 RED contracts + 13 个已授权 implementation paths；
- Draft 保持不变；
- **DO NOT MERGE checkpoint**。

最终正式授权范围：**exactly 22 paths**；canonical sorted path-set SHA-256：

**`972786dec8299d2d8c7e9b9a7aa44e89608310f6ac4f462d5d35fbf613f71ab2`**

唯一 dependency-control 路径：`integration/element-module/package.json`；root `package.json` 和 workflow 都不在授权范围。

## 4. 已冻结上游，禁止重复选型

精确 OSS pins：

### Synapse
- repo: `https://github.com/element-hq/synapse.git`
- version: `v1.158.0`
- commit: **`7a3e98b6f77ee3a5fe4dbeb934b0a0c1721e6afe`**
- license: AGPL-3.0-or-later

### Element Web
- repo: `https://github.com/element-hq/element-web.git`
- version: `v1.12.25`
- commit: **`a2a996ae50d802878bf48e4bbf3730004bdcc55c`**
- license: AGPL-3.0-only（上游同时提供其它许可文件，但本 P0 按 AGPL 路径履约）

### mautrix-whatsapp
- repo: `https://github.com/mautrix/whatsapp.git`
- version: `v0.2607.0`
- commit: **`a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`**
- license: AGPL-3.0-or-later WITH upstream exceptions

不要再做 Chatwoot/shadcn-vue 等旧 UI 线选型来替换这一 P0 主体。

## 5. Element workspace 最终技术方向已冻结

Element 1.12.25 已具备 runtime Module API、`navigation.registerLocationRenderer`、`extras.addRoomHeaderButtonCallback` 等能力，但其 `CustomComponentsApi` **没有 global persistent right-panel renderer slot**；`Container:"right"` 只用于已有 room widget，不满足 Yance 全局 workspace。

因此 V2.1 OSS-fit 结论：

- 不 fork Element 整体；
- Yance Workspace UI = 官方 Element runtime module；
- module 源码存 `integration/element-module/*`，bootstrap 复制到 Element monorepo `modules/yance`，继续使用 Element 自己 Nx/Vite workspace，不建立 Yance 第二套前端构建基础设施；
- 只保留一个最小、可重放 upstream patch，补 global right-panel renderer；
- patch 必须精确只改这 4 个 Element upstream files：
  1. `apps/web/src/components/structures/RightPanel.tsx`
  2. `apps/web/src/modules/customComponentApi.ts`
  3. `packages/module-api/element-web-module-api.api.md`
  4. `packages/module-api/src/api/custom-components.ts`
- patch 文件路径：`upstream-patches/element-web/0001-yance-global-right-workspace.patch`；
- 不新建第二个 RightPanel store；显示/隐藏/resize/session persistence 继续复用 Element `RightPanelStore`/现有 shell；
- module 负责 AI / Goal / Contact / Presence UI；hide/render 不得 stop client、logout、stop sync 或控制 bridge runtime。

## 6. checkpoint 已保存的实施内容

`9cfbfa62...` 已保存核心 13 implementation paths，包括：
- `config/upstreams/v21-comms-p0.json` 精确 upstream lock；
- Synapse config；
- mautrix-whatsapp config；
- Element config；
- `services/matrix/docker-compose.yml`；
- `tools/matrix/bootstrap.js` exact-commit/bootstrap 骨架；
- `integration/element-module/*` runtime module / Nx/Vite skeleton；
- P0 实施计划。

这些内容已在 GitHub，不需要新聊天从头生成。

## 7. 下一步只剩 7 个授权路径收口

从 **`product/v21-comms-p0@9cfbfa62e8fa9e04a902458056529dd586c08771`** 继续，直接完成剩余 7 paths：

1. `upstream-patches/element-web/0001-yance-global-right-workspace.patch`
2. `electron/main.js`
3. `THIRD_PARTY_NOTICES.md`
4. `third_party/licenses/element-web-AGPL-3.0.txt`
5. `third_party/licenses/synapse-AGPL-3.0.txt`
6. `third_party/licenses/mautrix-whatsapp-AGPL-3.0.txt`
7. `third_party/licenses/mautrix-whatsapp-LICENSE.exceptions.txt`

注意：`electron/main.js` 在 uploaded portable bundle 中的 Git blob 已确认与 #112 原 exact Head 一致（blob `95820fe9...`），因此可用 bundle 做本地精确最小 patch，但提交前仍以 live branch blob 做 fresh identity 核验。

剩余实现完成后：
1. 单个/极少原子 Git tree commit fast-forward 到 `product/v21-comms-p0`；
2. 立即跑两份 WP0 contracts，确认 causal RED → GREEN；
3. fresh 比较相对授权 merge：必须 exactly 22 paths，无 scope drift；
4. final exact Head 跑所有适用 Stage WP0 / Layered / ACV2 / sealed-export 等门禁；
5. review threads 必须 0；
6. 若出现真实产品/安全/授权 RED，底层修复；不得绕过；
7. 全 GREEN 后停在 **owner final exact-Head merge approval**，不要自行 merge #112。

## 8. 加速方式（新聊天必须遵守）

- 不重新读几十个旧 PR；启动只读 3 个 handoff docs + fresh main + #112 + final authorization receipt/paths。
- 不重复上游选型；pins 已冻结，只核 tag/commit/license 是否漂移。
- 多文件实施用 Git blob/tree/commit 一次性原子落库，避免 contents API 逐文件制造 7 次 CI。
- 每完成一个真正可恢复的大切片就先远端 checkpoint，再做长查询/CI；Draft PR 是恢复点。
- CI 等待期间并行完成 license blob、patch static review、Electron exact diff、scope/hash 计算，不空等。
- 只为 causal RED 获取必要日志；不要下载/美化大段审计材料。
- 能用上传的 bundle/cacache/Electron ZIP 做离线加速就用，但身份和最终结论仍由 GitHub exact SHA/blob 验证。
- 不碰 PR #67 / OSS-A /旧 Chatwoot UI 独立工作线，不把它们 merge/rebase 到 #112。
- 不创建新的 Yance message runtime、provenance platform、front-end build system。

## 9. 新聊天最短启动动作

1. 读取 `project-state/active-handoff/START_HERE.md`。
2. 读取 `project-state/active-handoff/YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1。
3. 读取本文件。
4. fresh 核验 `main` 与 PR #112 exact Head；预期当前值分别为 `2e7beefc...` / `9cfbfa62...`，如有正常后继则以 live GitHub 为准。
5. 确认 #112 仍 Draft/Open，scope authorization SHA `972786de...` 未改变。
6. **不要重新规划/重新授权/重新制造 RED。直接从剩余 7 路径继续整包实施。**
7. 只在真实 RED 或最终 exact-Head merge approval 边界停下。

### 临时 ref 噪音

此前为防丢失工具探测可能留下若干 `checkpoint/v21-comms-p0-*` refs。它们不是权威实施分支，不要基于它们继续；唯一权威实施 ref 是：

`product/v21-comms-p0`
