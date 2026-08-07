# 言策跨聊天执行入口

> **任何新聊天在修改仓库前，必须按以下顺序读取并核验。**

## 0. 唯一稳定架构指令

首先读取 [`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md)。

该文件自 V2.1 起是 **Yance 唯一稳定架构与实施指令**。除实时远端事实、已生效治理凭据、精确授权 Head 与正式安全/许可证约束外，任何旧聊天、旧设计、旧 PR 说明、旧专题计划与它冲突时，以它为准。

为了避免旧方案被误用，已经被 V2.1 完整吸收且存在架构冲突的旧计划文件应从活动状态分支删除，而不是继续保留为可执行参考。历史信息依赖 Git 历史追溯，不在活动入口重复保留第二份权威。

V2.1 已确认的最高原则：

- Yance 为个人使用的开源项目，并接受/履行所采用 GPL/AGPL/LGPL/Apache/MIT/BSD/Boost 等许可证义务；
- 成熟 OSS 产品、服务、Sidecar 和完整源码模块优先，**禁止重复自研已有成熟实现的基础能力**；
- 不再要求 Yance 自己拥有通信、联系人、关系、Agent memory、媒体或任务调度等唯一事实权威；
- 多平台优先 Matrix/Synapse + mautrix + Element，平台特有深度能力允许成熟 native OSS escape hatch；
- **所有平台始终进入同一个 Yance 产品界面**，不得拆成 WhatsApp/Telegram/Signal/Meta 等独立产品 UI；
- **统一产品界面 + 可折叠/可隐藏/可拖拽侧栏 + 渐进披露** 是固定 UX 硬规则；左侧导航、会话列表、右侧 AI/联系人/关系/Personal Presence 工作区都必须可收起、完全隐藏、拖拽宽度，并支持重启恢复和明确恢复入口；
- 隐藏/折叠只改变展示，不得静默停止同步、消息接收、Journey、AI 或后台任务；
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

`PROJECT_CONTINUATION.md` 只负责当前动态事实。它不能把任何已被 V2.1 取代的架构重新提升为稳定路线。

## 2. 当前有效补充文件

只有当某个补充文件仍承载 **V2.1 未在主计划中吸收的有效合同** 时才允许继续存在。所有已被主计划完整吸收、且容易误导后续执行的旧 V1/旧专题计划，应删除出活动状态分支，由 Git 历史保留审计轨迹。

补充文件不得：

- 重新声明 Chatwoot 为唯一产品壳；
- 重新声明 Yance 必须自建唯一 ChannelDriver/Canonical/Outbox 权威；
- 重新拆分 Voice、Visual、Video 为互不关联的产品底座；
- 覆盖 V2.1 的统一 UI、OSS-first、Personal Presence、Goal Brain、Model Brain、Learning Brain 路线。

## 3. 冲突处理优先级

从高到低：

1. 当前远端 refs、已生效正式治理凭据、精确授权 Head、workflow/receipt 事实；
2. `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1 唯一稳定架构指令；
3. `PROJECT_CONTINUATION.md` 当前动态状态；
4. 明确声明与 V2.1 兼容且未被主计划吸收的专项合同；
5. Git 历史中的旧方案仅用于审计追溯，不作为当前执行输入。

发现文档与远端事实冲突时，先核验事实，再用普通提交修正文档；不得 amend、rebase 或 force push。

## 4. 当前执行保护

V2.1 不允许污染当前已经授权的旧 exact-Head 工作包：

- 已授权 OSS-A/OSS-1A、治理、发布链继续按原门禁收口；
- V2.1 产品迁移必须使用新的工作包、来源 pin、路径清单、RED/GREEN、receipt 与精确 Head；
- 不允许因为“新架构更快”而跳过正在生效的门禁。

## 5. 已移除的旧活动计划

以下旧计划已被 V2.1 主计划完整吸收，因此从活动状态分支删除：

- `YANCE_UNIFIED_UI_OPEN_SOURCE_MIGRATION_PLAN.md`

需要审计旧设计时从 Git 历史读取，不允许把旧文件恢复成当前执行入口。

## 6. 固定分支

所有跨聊天稳定/状态文档固定保存在：

`project-state/active-handoff`
