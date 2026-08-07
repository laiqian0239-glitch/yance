# 言策项目持续执行接续记录

> **本文件只负责动态执行接续，不再承载稳定架构。**
>
> 稳定架构唯一来源：[`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md) V2.1。
>
> 新聊天必须先读取 [`START_HERE.md`](./START_HERE.md)，再读取 V2.1 主计划和本文件，然后重新核验远端 refs、PR、workflow、receipt 与 exact Head。禁止依赖本文件中的历史 SHA、旧工作包顺序或旧 UI/架构描述直接执行。

## 0. 固定修复与治理规则

1. 禁止临时绕过，必须底层修复/底层替换为成熟 OSS。
2. 失败测试先行；不得通过跳过测试、关闭测试、`continue-on-error`、弱化断言或修改门禁口径制造 GREEN。
3. 不得强推，不得改写历史；分支更新只能使用普通提交、可证明的非强制快进或正式 merge。
4. 所有阶段结论必须绑定实时核验的精确 commit SHA、workflow run/job、路径集合和治理凭据。
5. 本文件不授予任何新增权限；新增实施路径、source merge、promotion、production、release、publish 与下一工作包均须独立正式授权。

## 1. 唯一架构入口

当前有效稳定架构只认：

```text
START_HERE.md
        ↓
YANCE_IMPLEMENTATION_MASTER_PLAN.md  V2.1
        ↓
PROJECT_CONTINUATION.md  当前动态执行状态
        ↓
实时远端 refs / PR / workflow / receipt / exact Head
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

- **统一产品界面**：所有平台进入一个 Yance 工作区；
- **固定 UX**：左侧导航、会话列表、右侧工作区可折叠、可隐藏、可拖拽，布局可恢复，并采用渐进披露；
- **通信底座**：Matrix/Synapse + mautrix + Element，平台深度能力允许成熟 native OSS escape hatch；
- **AI Reply Brain**：Letta + Graphiti + Parlant；
- **Goal Brain**：每个会话可设置目标/成功条件/Journey；
- **Model Brain**：RouteLLM + LiteLLM；
- **Learning Brain**：Langfuse + DSPy + Promptfoo（需要时 Argilla）；
- **Personal Presence**：CosyVoice + Immich/ComfyUI + CyberVerse/LiveKit；
- **OSS-first**：有成熟产品/服务/模块时禁止重复自研。

## 4. 当前最新执行进展：PVEP WP0 授权传输底层修复

当前最新修复 exact Head：

`c34ba1fb8bf56c06007ab0702a5f3441838f8e46`

完整 RED→GREEN 历史：

```text
c3c54b0  test(wp0): require non-circular authorization transport
737559e  test(wp0): bind delegated authority to main and exact scope
c1d9acc  test(wp0): reject merge-only and rename transport escapes
c34ba1f  fix(wp0): separate authorization transport from branch authority
```

本次底层修复的核心合同：

```text
AUTHORIZATION_PROPOSAL_TRANSPORT
        ≠
IMPLEMENTATION_AUTHORITY
```

并额外封闭两类旁路：

1. 普通 two-parent merge 本身必须相对 first parent 只包含授权文件；
2. Git diff 强制 `--no-renames`，防止 rename 伪装成单文件授权。

### 4.1 Fresh local RED→GREEN 证据

以下为本地 fresh 验证结果，不冒充 GitHub Actions 结果：

- Layered：77/77 GREEN；
- OSS authorization：8/8 GREEN；
- implementation branch policy：14/14 GREEN；
- independent-review contract：7/7 GREEN；
- security：6/6 GREEN；
- ACV2 A0：4/4 GREEN；
- protocol：GREEN；
- `git diff --check`：GREEN；
- 工作区：clean。

完整 `test:wp0` 中的重型 `evidence-source-binding.test.js` 在沙箱运行约 10 分钟后被外层执行时限截断；未观察到测试失败。该测试不属于本次实际 `GOVERNANCE_WP0` 路由执行集合，因此本次修复没有为它修改、跳过或弱化任何测试。

### 4.2 PR #94 状态

PR #94 当前必须保持：

- Open；
- Draft；
- 未合并；
- 不把 known-RED authorization proposal 当作可直接 merge 的实现授权。

远端实时核验优先于本文件；任何继续动作前必须重新查询 PR #94、目标 implementation branch、main、workflow 和 exact Head。

## 5. 当前执行恢复协议

每次恢复实施必须重新执行：

1. 读取 `START_HERE.md`；
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1；
3. 读取本文件的当前动态进展；
4. 查询当前 `main`、目标分支、PR Head、merge 状态；
5. 查询当前 workflow runs/jobs、receipt、review threads、授权路径；
6. 只基于实时事实决定下一动作；
7. 如本文件与实时远端事实冲突，先修正本文件，不得让本文件覆盖远端事实。

## 6. 活动状态分支清理规则

- 已被 V2.1 完整吸收且会误导后续执行的旧**静态架构/专题计划**，可从 `project-state/active-handoff` 删除；
- `PROJECT_CONTINUATION.md` 作为当前动态执行接续记录必须保留，不属于删除对象；
- `START_HERE.md` 必须把本文件作为动态状态入口，而不是把旧专题计划列为必读主线；
- Git 历史保留全部审计轨迹，因此删除活动旧计划不等于删除历史；
- 仍需保留的专项合同必须明确声明只补充 V2.1，不能覆盖 V2.1。

## 7. 当前下一步边界

当前 PVEP WP0 修复已经有本地 RED→GREEN 证据，但下一步仍必须以**实时远端状态和正式授权**为准：

- 不因为本地 GREEN 自动获得 merge、promotion、production、release 或下一工作包权限；
- 不把 PR #94 从 Draft 改为 Ready，除非后续 exact-Head 证据与正式授权明确允许；
- 不污染当前其它 exact-Head 工作包；
- 不恢复 V1/旧 UI/自研 WP-B 作为产品主线。
