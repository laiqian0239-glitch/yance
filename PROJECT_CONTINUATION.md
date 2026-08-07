# 言策项目持续执行接续记录

> **本文件只负责动态执行接续，不再承载稳定架构。**
>
> 稳定架构唯一来源：[`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md) V2.1。
>
> 新聊天必须先读取 [`START_HERE.md`](./START_HERE.md)，再读取 V2.1 主计划，然后重新核验远端 refs、PR、workflow、receipt 与 exact Head。禁止依赖本文件中的历史 SHA、旧工作包顺序或旧 UI/架构描述直接执行。

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

## 4. 当前执行恢复协议

每次恢复实施必须重新执行：

1. 读取 `START_HERE.md`；
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1；
3. 查询当前 `main`、目标分支、PR Head、merge 状态；
4. 查询当前 workflow runs/jobs、receipt、review threads、授权路径；
5. 只基于实时事实决定下一动作；
6. 如本文件与实时远端事实冲突，先修正本文件，不得让本文件覆盖远端事实。

## 5. 活动状态分支清理规则

- 已被 V2.1 完整吸收且会误导后续执行的旧计划，从 `project-state/active-handoff` 删除；
- 已删除：`YANCE_UNIFIED_UI_OPEN_SOURCE_MIGRATION_PLAN.md`；
- `START_HERE.md` 不再把已删除旧计划列为必读项；
- Git 历史保留全部审计轨迹，因此删除活动文件不等于删除历史；
- 仍需保留的专项合同必须明确声明只补充 V2.1，不能覆盖 V2.1。

## 6. 当前下一步

**不在本文件缓存具体 next-step SHA 或旧工作包顺序。**

进入任何具体实施会话时，先实时核验仓库与 GitHub Actions，再依据 V2.1 主计划和当前有效授权选择下一工作包。若发现旧治理/实施链仍有必须收口的 exact-Head 任务，则按其既有正式授权完成，但不得把其旧产品架构扩展为新的稳定路线。
