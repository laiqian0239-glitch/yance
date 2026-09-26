# 言策 v4｜2026-09-25 真实界面对账记录

状态：`RUNTIME VISUAL / INTERACTION REVIEW`

> 2026-09-26 owner 后续真实截图对账已固化到 YANCE_V4_OWNER_ACCEPTANCE_RECONCILIATION_2026-09-26_ZH.md；后续视觉/运行时差异以该 successor review 继续，本文保留为 09-25 原始证据。

本记录依据用户提供的三张真实 Windows 截图，与仓库设计基线 `docs/design/yance-v4-final-2026-09-23/` 对账。截图本身不入库，避免把真实联系人/头像等用户数据持久化进仓库。

## 对账权威

- 首页：`screens/core/Yance_Home_Adaptive_v1.png`
- 关系世界：`screens/core/Yance_Relationship_World_v1.png`
- 设置：`screens/core/Yance_Settings_v1.png`
- 对话：`screens/core/Yance_v4_precise_collapse_controls_final.png`
- 功能非降级：`spec/YANCE_V4_FINAL_FUNCTION_RECONCILIATION_2026-09-23_ZH.md`
- 设计总约束：`README_ZH.md`

## 总结

当前真实 UI 不是单纯“还差美化”，而是同时存在：
1. 新 v4 首页；
2. 旧 Relationship Universe 路由/紫色设计系统；
3. 与最终 Conversation 母版不一致的对话工作面；
4. Settings 真实不可达症状。

因此当前主要风险是 **shell / route / capability projection 未统一到最新设计 authority**，不能只做颜色和间距微调。
## A. 首页截图

### V4-RT-001｜P0｜Settings 入口真实不可达
- 现象：用户点击首页左侧「设置」无响应；截图中该入口也呈低强调状态。
- 设计要求：设置是唯一 Global Rail 的固定一级位置，必须始终可达。
- 源码证据：`PeopleSurface.tsx` 的 v4 rail 设置按钮调用 `onOpenSettings`；父层 handler 会 `setSettingsVisible(true)` 并进入 `general`，源码没有 intentional disabled。
- 当前判定：**确认 runtime bug；根因尚未定位**。后续先查实际加载 bundle / DOM hit-test / overlay 或事件交接，不允许以“重新做一个设置按钮”绕过。

### V4-RT-002｜P1｜首页 shell 与最终 Home 母版不一致
- 现状：v4 首页自己隐藏了 Product 顶栏与旧 rail，使用独立 `yance-v4-rail`；实际界面缺少最终母版里的统一 Yance 顶栏/Workspace 身份/全局状态层。
- 风险：Home、Relationship、Conversation 看起来像三套应用，而不是同一根 persistent Global Rail。

### V4-RT-003｜P1｜联系人筛选能力展示偏离设计
- 最终 Home 母版使用平台维度/平台数量作为显著筛选入口；当前实现改成「全部 / 未读 / 收藏 / 最近」。
- 不是立即判定功能删除，但需要确认平台筛选仍有可达入口；若没有，则属于联系人工具能力降级。

### V4-RT-004｜P1｜“真人打字”状态语义错误
- 截图右侧全局环境出现类似「真人打字：当前关系投影」的表达。
- 最终设计语义应是全局 typing mode（如 `自然 / 关闭 / 慢速 / 快速 / 自定义`）以及联系人 override；“当前关系投影”不是 typing mode。
## B. 点击「关系世界」后的截图

### V4-RT-005｜P0｜「关系世界」实际被接到旧 Relationship Universe
- 真实现象：点击首页「关系世界」后进入紫色关系宇宙图谱。
- 已确认源码根因：`PeopleSurface.tsx` 的 v4 rail 中，「关系世界」按钮实际调用 `onViewModeChange("universe")`；当 `viewMode === "universe"` 时直接渲染旧 `Relationship Universe` 图谱。
- 最终设计要求：一级「关系世界」应进入当前人物的深层 Relationship World；关系图谱最多是其中一个上下文/标签，不应替代整个工作区。
- 当前判定：**确认 route semantics 错接，不是单纯视觉问题。**

### V4-RT-006｜P0｜Relationship 页面恢复了竞争性旧导航
- 截图出现「首页 / 关系宇宙 / 关系世界 / 对话 / AI 助手 / 设置」等多项旧一级导航。
- 最终设计只保留唯一 Global Rail：`首页 / 关系世界 / 设置`；Conversation 是核心工作面，不再作为另一套竞争产品导航。
- 该截图构成明确架构回退：同一产品同时存在两套一级 IA。

### V4-RT-007｜P1｜Relationship World 视觉回退到紫色/霓虹旧主题
- 当前紫色高饱和 glow、大面积空场、发光关系节点与最终 `Premium Calm` 的 navy / graphite / restrained gold 不一致。
- 该页面视觉应与 Home / Conversation 属于同一设计系统，不能成为单独的 cyber/purple 产品。

### V4-RT-008｜P1｜深层关系能力没有投影到当前页面
- 最终 Relationship World 应覆盖：总览、共同片段、关系图、历史、洞察，以及关系旅程、目标/下一步、最近信号、事实、边界、未完成事项、当前人格与返回真实对话。
- 当前截图主要是关系宇宙图 + 当前焦点卡，绝大多数深层关系信息不可见。
- 关系图谱可以保留，但应降为 Relationship World 内的一种视图，而不是整个页面。
## C. Conversation 截图

### V4-RT-009｜P0｜Reply Brain 主价值区被「人物设定」替换
- 最终 Conversation 母版要求中央下方始终以 Reply Brain 为价值中心：3 条回复建议、每条建议的使用/解释、语气微调、换一组建议、平衡模式与学习反馈。
- 当前截图中央下方主要是「人物设定 · 当前关系」及 3 个风格卡片；3 条回复建议完全没有出现。
- 这是明显的功能层级回退，不是单纯排版差异。

### V4-RT-010｜P0｜真人打字全局发送层未出现在 Conversation
- 最终母版要求紧凑控件 `真人打字 · 全局：自然`，并统一服务 AI 回复 / 手写 / 翻译后文本。
- 当前截图没有该控件，也没有 `正在输入 / 立即发送 / 取消` 的发送层入口。

### V4-RT-011｜P0｜模型选择 / Provider / 推理控制没有按最终母版可见
- 最终 Conversation 非回退要求包含用户模型选择、模型来源（如 OpenRouter）、推理强度/快慢模式与状态。
- 当前截图只在右侧 AI 解释里出现内部 cloud 模型标识和「快速/深度回复」，没有可见的用户模型 selector / provider selector。
- 需要确认高级设置中是否仍可达；若只能后台自动选，则违反“用户手动选择优先”。

### V4-RT-012｜P1｜右侧 Inspector 缺少「人格」一级 Tab
- 最终母版右侧为 `AI / 人格 / 关系 / 记忆 / 目标`。
- 当前截图只看到 `AI / 关系 / 记忆 / 目标`，人格被移出/合并到中央人物设定，造成信息架构偏离。

### V4-RT-013｜P1｜发送/学习语义在默认工作面不可见
- 最终设计锁定 `发送并学习 / 仅发送 / 本次例外 / 本次不学习` 四种语义，并要求真实发送成功后才激活学习。
- 当前截图没有可见的发送模式入口或下拉；需要验证它是否仅在输入后出现，还是已经被移除。
- 若不可达，属于学习治理能力降级。

### V4-RT-014｜P1｜Conversation 视觉层级与最终母版不一致
- 中央 timeline 出现大面积近黑/灰空块，Reply Brain 区域被人物设定占据；紫色媒体/AI 控件仍较突出。
- 最终基线要求 Conversation 获得最高空间优先级、背景/消息层次稳定、金色克制、紫色不作为主视觉语言。
- Voice / Media / Live 入口在当前截图中仍存在，这是保留项，不应在后续修正时误删。
## D. 当前明确保留、不要误删的能力

以下在真实截图中仍可见或已被现有 runtime 证明，应作为后续修正的 non-regression 保护项：

- Home 真实联系人列表、搜索、未读/收藏/最近筛选、继续真实对话。
- Home 当前关系、提醒、今日目标、37 人真实 People 投影。
- Conversation 真实 Element timeline / composer authority。
- Incoming translation projection 已可见。
- Conversation 的发送图片、生成/编辑图片、语音回复、实时互动入口仍存在。
- 右侧 AI / 关系 / 记忆 / 目标相关上下文仍有部分投影。

## E. 修正顺序（仅记录，不在本 review 中直接修）

1. **P0 Settings runtime root cause**：先证明为什么源码 handler 存在但真实点击无响应。
2. **P0 Relationship route cutover**：把首页「关系世界」从 `universe` 错接切回真正 `RelationshipWorld`，旧关系宇宙只作为深层关系图视图保留。
3. **P0 Conversation non-regression restoration**：恢复 Reply Brain、真人打字、模型选择/Provider/推理控制和完整 send-learning 入口。
4. **P1 Shell convergence**：Home / Relationship / Conversation 统一唯一 Global Rail、Premium Calm 设计系统和宽度层级。
5. **P1 视觉精修**：最后再做色彩、间距、边框、背景和文案微调；不得先用视觉 polish 掩盖 route / capability 问题。

## 状态语言

- 本文是问题对账与执行输入，不代表问题已修复。
- `V4-RT-005` 已有源码级根因证据。
- `V4-RT-001` 是确认 runtime 症状，但根因仍需下一轮只读诊断。
- 其它项是相对 2026-09-23 repository design baseline 的确认差异；涉及“能力是否仍隐藏可达”的条目必须用真实 runtime 再验证后才能判定为功能删除。
