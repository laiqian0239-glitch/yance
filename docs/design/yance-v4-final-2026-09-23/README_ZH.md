# 言策 v4 最终设计基线 — 2026-09-23

状态：`REPOSITORY DESIGN BASELINE`

本目录把 2026-09-23 已确认的新设计方案、功能非降级对账和交互状态稿固定为仓库内可追溯的产品设计基线。它用于约束后续实现不得因“界面收敛”而删除成熟能力。

> 核心原则：**减少一级页面，不减少能力；隐藏复杂度，不隐藏能力。**

> 最新 owner 真实运行时对账：eview/YANCE_V4_OWNER_ACCEPTANCE_RECONCILIATION_2026-09-26_ZH.md。该 review 记录最新截图差异与执行顺序，不替代本目录正式母版或功能 non-regression authority。

## 权威边界与优先级

1. `AGENTS.md`、repository-owned skills、最新有效 Controller State 继续拥有工程执行/发布治理权；本设计基线不能授权 CI、PR、merge、RC、UAT 或 Release。
2. 本目录负责产品信息架构、视觉结构、交互入口和非降级要求；不创建新的消息、模型、会话、路由、学习或媒体运行时 authority。
3. 出现视觉冲突时，`screens/core/` 与 `screens/states/` 中的 2026-09-23 定稿图优先于较早 presentation 中的示意画面。
4. 出现功能覆盖争议时，以 `spec/YANCE_V4_FINAL_FUNCTION_RECONCILIATION_2026-09-23_ZH.md` 的成熟能力清单和 Non-Regression 闸门为准。
5. Element / Matrix 继续拥有真实 timeline、composer、send、room/session 等成熟 authority；Yance 只做 Product 投影和关系体验。
6. 用户手动模型选择必须保留；自动推荐只能辅助，不能覆盖用户明确选择。Provider/fallback/retry 等物理路由仍由成熟 Model Brain/runtime authority 负责。

## 一级产品结构

最终一级产品位置收敛为：

- 首页 / People
- 关系世界
- 设置

真实 Conversation Workspace 是核心工作面；AI 工作台属于深层工作区；人格、模型与路由、语音与媒体、数据/隐私/学习属于高级管理层。减少一级页面不等于删除对应成熟能力。

## 核心视觉母版

`screens/core/`：

- `Yance_v4_precise_collapse_controls_final.png` — Conversation Workspace v4 主母版；包含精确折叠控制和 Focus Chat 的基础视觉约束。
- `Yance_Home_Adaptive_v1.png` — 首页 / People。
- `Yance_Relationship_World_v1.png` — 关系世界。
- `Yance_Settings_v1.png` — 设置与高级能力入口。
- `Yance_AI_Workspace_v1.png` — AI 深层工作区。
- `Yance_Model_Routing_v1.png` — 模型选择 / 路由管理。
- `Yance_Voice_Media_Management_v1.png` — 语音与媒体管理。
- `Yance_Data_Privacy_Learning_v1.png` — 数据、隐私与学习治理。

## 交互状态覆盖

`screens/states/`：

- `m01-live/` — Live 启动、连接中、活跃、重连、结束及状态总览。
- `m02-voice/` — Conversation 内 Voice：选声音 → 生成 → 试听 → 重生成 → 可发送。
- `m03-media/` — Conversation 内 Media：选择 → 预览 → 根据上下文生成 → 编辑 → 可发送。
- `m04-human-typing/` — 真人打字进度与控制。
- `m05-translation/` — 发送语言提示与翻译预览。
- `m07-learning/` — 学习语义矩阵与“发送并学习”菜单。

### M06 Focus Chat

没有伪造一个不存在的独立 `M06` 文件。M06 的双侧收起 / Focus Chat 视觉基线由 `screens/core/Yance_v4_precise_collapse_controls_final.png` 承载。后续若真实 Windows 验收需要单独的 M06 状态封样，可新增验收证据，但不得把它误解为缺失功能或恢复旧一级页面的理由。

## 对功能对账文件中 AMBER 的解释

`YANCE_V4_FINAL_FUNCTION_RECONCILIATION_2026-09-23_ZH.md` 在后续 M01–M05 / M07 状态稿生成前记录了“7 个 AMBER 状态缺口”。本目录同时归档了这些后续状态稿，因此该 AMBER 表应理解为**生成顺序的历史记录**，不是当前仓库资产缺失数量。

M06 仍按上面的 Conversation 母版映射处理；是否需要额外独立状态封样，最终以真实 Product 人工验收为准。

## 云端模型与媒体能力约束

- 文字转语音、语音能力、图片生成/编辑以及 Live/音视频相关智能能力，在 Provider 支持时必须允许通过成熟模型路由使用云端能力，不能把新版 UI 设计成“仅本地模型”。
- 同时保留本地模型/本地能力的可选路径；具体 provider、fallback、retry、rate limit 与能力可用性由真实模型目录和成熟 runtime 决定，界面不得硬编码示例模型为唯一真值。
- Conversation 中的模型选择以用户明确选择为最高产品意图；自动推荐可以提示，但不能偷偷替换用户选择。

## Presentation 说明

`presentations/` 保留两份互不重复的设计演示源：

- `yance_final_ui_solution_v3.pptx`
- `Yance_Final_Desktop_Experience_Design.pptx`

它们用于设计背景与完整叙事参考。若与 2026-09-23 核心 PNG / 状态稿发生冲突，以后者为最终视觉基线。

## Non-Regression 实现要求

后续实现至少必须持续满足：

- 只有一套 Yance 一级导航；不恢复通用 Element 侧栏成为竞争主导航。
- 真实 timeline / composer / send authority 不替换，不创建 shadow messaging runtime。
- Reply Brain、翻译、语音、媒体、Live 最终都回到 canonical conversation route / 真实发送链。
- Persona 只控制表达与作用域，不接管人物事实；即时风格调节不等于永久人格变更。
- 学习必须遵守真实发送成功、send-only / exception / do-not-learn 等既有治理语义。
- 展开/关闭 AI、Media、Voice、Live 或折叠面板时，不得丢失 timeline scroll、composer draft 和当前人物/关系上下文。
- 普通 Product UI 不暴露内部 engine/provider 技术名作为主要用户信息架构。
- 任何视觉升级只能新增、重排或折叠复杂度，不能删除成熟能力。

## 验收边界

本目录被提交进仓库，只代表**设计基线已持久化**，不代表 Product 已 HUMAN-ACCEPTED，也不代表任何 release gate 已 GREEN。真实运行行为、Windows 视觉、数据与成熟 authority 仍按仓库既有验收链证明。

## 明确排除的旧/重复资产

未纳入本基线：

- `Yance_Final_Desktop_Experience_Design (1).pptx`：与无后缀文件 SHA-256 完全相同，属于重复下载。
- `yance_final_ui_solution_v1.pptx`：旧版本，由 v3 取代。
- `yance_conversation_workspace_v3_effect_mockup.png`、`yance_workspace_v3_realistic.png`：旧 mockup，不作为最终 v4 authority。
- `Yance_New_Chat_Handoff_2026-09-21.md`：聊天交接资料，不是最终设计规范。

## 完整性

`ASSET_SHA256.txt` 记录本基线 35 个原始设计资产的仓库相对路径与 SHA-256。归档时所有目标文件均需与本地批准源文件逐字节一致。
