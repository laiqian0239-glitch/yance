# 言策跨聊天执行入口

> **任何新聊天在修改仓库前，必须按以下顺序读取并核验。**

## 0. 最高稳定架构指令

首先读取 [`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md)。

该文件自 V2.1 起是 **Yance 最高稳定架构与实施指令**。除实时远端事实、已生效治理凭据、精确授权 Head 与正式安全/许可证约束外，任何旧聊天、旧设计、旧 PR 说明、旧专题计划与它冲突时，以它为准。

V2.1 已确认的最高原则：

- Yance 为个人使用的开源项目，并接受/履行所采用 GPL/AGPL/LGPL/Apache/MIT/BSD/Boost 等许可证义务；
- 成熟 OSS 产品、服务、Sidecar 和完整源码模块优先，**禁止重复自研已有成熟实现的基础能力**；
- 不再要求 Yance 自己拥有通信、联系人、关系、Agent memory、媒体或任务调度等唯一事实权威；
- 多平台优先 Matrix/Synapse + mautrix + Element，平台特有深度能力允许成熟 native OSS escape hatch；
- **产品体验始终只有一个 Yance 统一界面**：所有平台共享统一导航、会话列表、消息时间线、输入区和 AI/联系人工作区，不为 WhatsApp、Telegram、Signal、Meta 等重新建立独立产品界面；
- **统一产品界面 + 可折叠/可隐藏/可拖拽侧栏 + 渐进披露** 是 V2.1 固定 UX 硬规则：左侧全局导航、会话列表、右侧 AI/联系人/关系/Personal Presence 工作区均必须支持收起、完全隐藏、拖拽调整宽度和重启恢复；常用动作直接展示，低频动作进入菜单/侧栏，专业控制进入高级模式；
- AI 长期大脑优先 Letta + Graphiti；
- 有目标的聊天优先 Parlant Journey，SalesGPT 等作为领域 Journey 模板来源；
- 模型路由优先 RouteLLM + LiteLLM；
- 学习成长优先 Langfuse + DSPy + Promptfoo（需要人工标注时 Argilla）；
- Personal Presence 统一合并声音、照片和实时本人 AI Avatar：
  - 本人跨语言声音克隆优先 CosyVoice 3，并以 Chatterbox/GPT-SoVITS/OpenVoice 等作为 benchmark/备选；
  - 个人照片素材优先 Immich 真实图库，生成链优先 ComfyUI + PhotoMaker/InstantID/PuLID + IP-Adapter/ControlNet；
  - 实时本人 AI Avatar 视频通话优先 CyberVerse + LiveKit，Ditto/MuseTalk/LivePortrait/FlashHead/LiveAct 作为统一 benchmark 的 Avatar backend；
  - 第三方桌面视频客户端只在正式支持时通过 OBS Virtual Camera 等成熟路径输出，不自研协议绕过；
- 合成声音、照片和 Avatar 必须保留授权/provenance；不得把合成内容当作实时现场事实证据，也不得以“无法识别为 AI/合成内容”作为验收指标；
- 只有证明没有成熟 OSS 可满足时才允许最小自研；
- 禁止临时绕过，必须底层修复，不强推、不改写历史、不弱化门禁。

## 1. 当前精确状态

读取 [`PROJECT_CONTINUATION.md`](./PROJECT_CONTINUATION.md)：

- 当前任务、阻塞和下一步；
- 精确分支、commit SHA、workflow run/job；
- 授权路径、receipt 与正式门禁。

`PROJECT_CONTINUATION.md` 只负责当前动态事实。它不能把 V1/V2 已被取代的架构重新提升为最高稳定路线。

## 2. 旧专题计划

读取需要用到的专题计划，例如 [`YANCE_UNIFIED_UI_OPEN_SOURCE_MIGRATION_PLAN.md`](./YANCE_UNIFIED_UI_OPEN_SOURCE_MIGRATION_PLAN.md)。

这些文件继续保存历史决策、零回归要求、主题/声音/翻译/布局等细节，但其架构优先级已经调整：

- 与 V2.1 最高指令一致的部分继续有效；
- 与 V2.1 冲突的部分自动降级为历史参考；
- 尤其是“Chatwoot 唯一产品壳”“Yance 唯一 ChannelDriver/Canonical/Outbox 权威”等旧硬要求，不再覆盖 V2.1；
- Voice、Visual、Video 现在统一归 `Personal Presence`，旧计划若把它们视为独立附件能力，以 V2.1 为准；
- **统一界面、左右侧栏与会话列表可折叠/可隐藏/可拖拽、布局重启恢复、渐进披露** 属于继续有效且已升级为 V2.1 最高 UX 规则的部分；
- 现有主题、提示音、通知规则、用户设置、翻译体验和真实数据零回归要求仍然有效，除非后续专项迁移以 RED/GREEN 和可回滚证据正式替换。

## 3. 冲突处理优先级

从高到低：

1. 当前远端 refs、已生效正式治理凭据、精确授权 Head、workflow/receipt 事实；
2. `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1 最高稳定架构指令；
3. `PROJECT_CONTINUATION.md` 当前动态状态；
4. 与 V2.1 一致的专题计划；
5. 旧聊天、旧 PR 正文和已被 V2.1 取代的历史设计。

发现文档与远端事实冲突时，先核验事实，再用普通提交修正文档；不得 amend、rebase 或 force push。

## 4. 当前执行保护

V2.1 不允许污染当前已经授权的旧 exact-Head 工作包：

- 已授权 OSS-A/OSS-1A、治理、发布链继续按原门禁收口；
- V2.1 产品迁移必须使用新的工作包、来源 pin、路径清单、RED/GREEN、receipt 与精确 Head；
- 不允许因为“新架构更快”而跳过正在生效的门禁。

## 5. 固定分支

所有跨聊天稳定/状态文档固定保存在：

`project-state/active-handoff`
