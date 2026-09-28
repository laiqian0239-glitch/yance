# 言策 V5 Conversation Workspace 920×620 视觉权威 — 2026-09-28

状态：`V5 CONVERSATION VISUAL AUTHORITY — FROZEN`

## 唯一 Golden

- 唯一视觉 authority：`../screens/core/Yance_V5_Conversation_920x620_Golden.png`。
- 自 2026-09-28 起，V5 Conversation 920×620 的 Golden vs Actual 只能使用这张图，不得回退到旧 Conversation mockup、presentation 或 v4 Conversation 母版。
- 原始设计图是 1536×1024 的文档展示画布；其中**中间主窗口**表达目标 920×620 Conversation Workspace，画布外围内容不能被当作应用 client area。

## 图面语义边界

1. **中间主窗口 = 主界面权威。** Conversation 的真实窗口结构、信息密度、层级、控件位置与展开/收起关系，以中间主窗口为视觉判断对象。
2. **左侧说明框 = 文档标注。** 左侧四组说明框、箭头及说明文字只用于解释设计，不属于 Product UI；实现和视觉验收不得要求应用渲染这些说明框。
3. **右侧“闺蜜大脑” = 打开态示意。** 它表示 Overlay Drawer 已打开时的形态，不代表默认常驻右栏；默认 Conversation 应把宽度优先留给联系人列与真实聊天区。
4. **底部弹出菜单 = 交互展开态示意。** `＋` 工具菜单、AI 回复动作、真人打字、模型选择等弹层用于展示对应控件被展开后的状态，不代表默认同时常驻。
5. 外围顶部能力说明卡同样属于设计文档说明层，不属于中间 920×620 产品窗口。

## V5 Conversation 结构约束

- 无全局左导航；顶部保留 `← 首页` / 首页返回入口。
- 联系人列以约 190–205px 为基线并支持折叠，最大化真实聊天区。
- 默认无常驻右栏；闺蜜大脑使用 Overlay Drawer，需要时覆盖打开而不是永久压缩聊天区。
- timeline / composer / send 继续使用真实成熟会话 authority，不允许以静态 mockup 代替。
- 外语消息以原文为主层、中文译文为辅层；有效 Persona、HUMAN / AI_ASSIST / AI_AUTO、立即接管与模型状态必须保持清晰但避免重复占位。
- Next Interaction Brain 使用默认 3 条候选并提供明确扩展到 5 条的交互；解释文案使用“为什么这样回”。
- `＋` 为媒体/工具入口，消息级 `✨` 与 composer AI 动作需保持语义区分；真人打字、翻译、发送并学习、Focus Chat 均不得因视觉收敛而丢失。

## 覆盖与继承关系

- 本文件与 `Yance_V5_Conversation_920x620_Golden.png` **仅覆盖 V5 Conversation 920×620 的视觉 authority**。
- `Yance_v4_precise_collapse_controls_final.png` 对该表面的“当前 Golden”地位自此失效，只保留历史设计参考价值。
- 首页、关系世界、设置等其他 v4 核心屏幕仍按现有 repository design baseline 执行。
- `YANCE_V4_FINAL_FUNCTION_RECONCILIATION_2026-09-23_ZH.md` 的成熟能力 Non-Regression 约束继续有效；视觉换代不得删减能力。
- Element / Matrix 与既有成熟模块的真实 timeline、composer、send、room/session authority 不因本视觉规范而改变。

## Golden vs Actual 验收规则

1. 验收窗口必须把 `Yance_V5_Conversation_920x620_Golden.png` 作为唯一 Golden 输入。
2. Actual 以真实 920×620 Conversation client/workspace 为对照对象；不得把 1536×1024 文档展示画布误当作运行时窗口尺寸。
3. 差异判断只对中间主窗口的产品 UI 生效；左侧说明框、外围顶部说明卡和底部已展开菜单不能作为“默认态必须出现”的验收项。
4. 右侧闺蜜大脑应分别验证关闭默认态与 Overlay Drawer 打开态；Golden 中显示的是打开态示意。
5. 底部菜单分别按用户触发展开态验证，不要求在默认态同时展开。
6. 在现有验收工具支持时，920×620 需覆盖 Windows DPI 100% / 125% / 150%；DPI 验收不得改用另一张 Golden。
7. 任何后续 Conversation 视觉验收记录必须明确标注 Golden 文件名与其 SHA-256，防止旧图混入。

## 当前 Golden 完整性

仓库 PNG 的 SHA-256 由 `../ASSET_SHA256.txt` 固化。图像编码可影响文件哈希，因此仓库文件字节是持久化 authority；视觉来源核对可同时使用像素哈希证明与本次批准图一致。
