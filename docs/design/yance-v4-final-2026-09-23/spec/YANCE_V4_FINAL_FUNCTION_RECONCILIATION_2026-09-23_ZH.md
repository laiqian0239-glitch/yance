# 言策 v4｜新版界面最终功能对账审查

日期：2026-09-23  
目标：验证新版“界面收敛”是否造成成熟能力降级，并给出剩余设计覆盖缺口。

## 结论

- **确认功能降级（RED）：0**
- **功能/架构已覆盖（GREEN）：34**
- **能力仍在，但交互状态尚未完整出图（AMBER）：7**
- 当前判断：**新版是架构升级，不是功能删减；但还不能称为“全部交互状态设计完成”。**
- 最终原则：**减少一级页面，不减少能力；隐藏复杂度，不隐藏能力。**

## 新版页面体系

### 一级产品位置
1. 首页 / People
2. 关系世界
3. 设置

### 核心工作面
4. 真实对话 Conversation Workspace

### 深层工作区
5. AI 工作台

### 高级管理
6. 人格管理
7. 模型与路由
8. 语音与媒体
9. 数据 · 隐私 · 学习

---

## A. 一级导航与产品结构

| # | 成熟能力/旧入口 | 新版入口 | 状态 | 审查结论 |
|---|---|---|---|---|
| A01 | 唯一 Yance 主导航 | 首页 / 关系世界 / 设置 | GREEN | 不再把 AI/记忆/目标/素材/声音/学习平铺成一级入口 |
| A02 | People / 联系人 | 首页 | GREEN | 联系人先于功能，符合人物中心模型 |
| A03 | Conversation | 首页/关系世界进入真实对话 | GREEN | 不再做“对话大厅”式重复页面 |
| A04 | Relationship Universe | 关系世界 | GREEN | 成为人物的关系深层空间 |
| A05 | Settings | 设置 | GREEN | 高级能力集中管理，不污染聊天主界面 |
| A06 | AI 深层任务 | AI 工作台 | GREEN | 保留跨人物/跨关系主动分析能力，但不恢复为一级导航 |

## B. 真实对话主链

| # | 能力 | 新版位置 | 状态 | 审查结论 |
|---|---|---|---|---|
| B01 | 真实 timeline | Conversation | GREEN | 继续由 Element / Matrix 真实时间线承载 |
| B02 | 真实 composer | Conversation | GREEN | 手写回复路径保留 |
| B03 | 唯一 send authority | Conversation | GREEN | 没有第二套 shadow send |
| B04 | 联系人/会话 Context Pane | Conversation 左侧 | GREEN | 搜索、最近、未读、人物、最后消息等保留 |
| B05 | AI Reply Brain | Composer 上方回复大脑 | GREEN | 3 个策略候选保留 |
| B06 | “为什么这样回” | 每条候选 | GREEN | 解释能力保留 |
| B07 | 快捷风格调整 | 回复大脑 | GREEN | 更自然/成熟/暧昧/少问/别太主动/更像我 |
| B08 | 跟回复大脑聊聊 | 回复大脑 | GREEN | AI 纠错与指令入口保留 |
| B09 | 换一组建议 | 回复大脑 | GREEN | 保留 |
| B10 | 平衡/策略选择 | 回复大脑 | GREEN | 保留 |
| B11 | 学习反馈 | 回复大脑 | GREEN | 反馈→当前 turn→证据→发送后学习链保留 |
| B12 | 手写输入 | Composer | GREEN | 未被 AI 路径替代 |
| B13 | AI 发送路径 | 发送并学习下拉 | GREEN | 与手写路径保持独立 |
| B14 | 真人打字 | 共享发送层 | GREEN | AI/手写/翻译后文本统一经过全局真人打字 |
| B15 | 图片/生成图片/声音/Live/翻译 | Composer ActionDock | GREEN | 能力入口保留 |
| B16 | 用户模型选择 | 对话底部模型控制 | GREEN | 用户选择优先 |
| B17 | 快速/深度/推理强度 | 对话 + 模型路由 | GREEN | 保留 |
| B18 | OpenRouter/Provider | 高级模型设置 | GREEN | 不重复创建第二套路由逻辑 |
| B19 | AI/人格/关系/记忆/目标 Inspector | Conversation 右侧 | GREEN | 核心上下文仍可达 |
| B20 | 面板折叠 | Conversation | GREEN | 折叠入口已保留并完成精确微调 |

## C. 关系智能

| # | 能力 | 新版入口 | 状态 | 审查结论 |
|---|---|---|---|---|
| C01 | 当前关系阶段 | 关系世界 / Inspector | GREEN | 保留 |
| C02 | Relationship momentum / 变化 | 关系世界 | GREEN | 保留 |
| C03 | Relationship journey | 关系世界 | GREEN | 不复制聊天时间线 |
| C04 | Shared Moments | 关系世界 | GREEN | 点击回真实消息/媒体/evidence |
| C05 | Open loops | 关系世界 / 记忆 | GREEN | 保留 |
| C06 | Promise / boundaries | 关系世界 / 数据治理 | GREEN | 保留 |
| C07 | 当前意图 / Goal | 关系世界 / Inspector | GREEN | 保留 |
| C08 | 下一步建议 | 关系世界 | GREEN | 保留 |
| C09 | Relationship Atmosphere | Conversation / 设置 | GREEN | 从全局皮肤升级为关系视觉投影 |

## D. Persona

| # | 能力 | 新版入口 | 状态 | 审查结论 |
|---|---|---|---|---|
| D01 | 全局默认人格 | 设置 / 人格管理 | GREEN | 保留 |
| D02 | 联系人绑定 | 人格管理 / Conversation | GREEN | 保留 |
| D03 | 本次对话临时覆盖 | 人格管理 / Conversation | GREEN | 保留 |
| D04 | 新建人格 | 人格管理 | GREEN | 保留 |
| D05 | Character Card 导入/预览 | 人格管理 | GREEN | 保留 |
| D06 | 人格对比 | 人格管理 | GREEN | 保留 |
| D07 | 版本历史/回滚 | 人格管理 | GREEN | 保留 |
| D08 | truth firewall | 人格管理/运行链 | GREEN | Persona 只管表达，不接管人物事实 |
| D09 | 稳定偏好学习 | 人格管理 / 学习治理 | GREEN | 单次反馈不永久修改人格 |

## E. Model Brain

| # | 能力 | 新版入口 | 状态 | 审查结论 |
|---|---|---|---|---|
| E01 | 用户手动选择模型 | Conversation / AI 工作台 | GREEN | 明确高于自动推荐 |
| E02 | 自动推荐模型 | Conversation / 模型路由 | GREEN | 只推荐，不覆盖手动选择 |
| E03 | logical model / task route | 模型与路由 | GREEN | 保留 |
| E04 | primary / fallback | 模型与路由 | GREEN | 保留 |
| E05 | provider | 模型与路由 | GREEN | 保留 |
| E06 | reasoning strength | Conversation / 模型与路由 | GREEN | 保留 |
| E07 | timeout / retry / rate limit | 模型与路由 | GREEN | 保留 |
| E08 | provider failure-domain isolation | 模型与路由 | GREEN | 保留 |
| E09 | 未验证模型禁入正式功能 | 模型与路由 | GREEN | 保留验证门槛 |

> 注意：当前设计稿中的具体模型名称属于**界面示例数据**，最终运行态必须由真实已验证模型目录填充，不能把示例名称当成产品硬编码。

## F. Voice / Media / Live / Translation

| # | 能力 | 新版入口 | 状态 | 审查结论 |
|---|---|---|---|---|
| F01 | Voice profile | 语音与媒体管理 | GREEN | 录入/持久化/删除保留 |
| F02 | ASR | 语音管理 / Conversation Voice | GREEN | 保留 |
| F03 | voice clone TTS | Conversation + 语音管理 | GREEN | 保留 |
| F04 | preview / regenerate | Conversation Voice / 管理页 | GREEN | 保留能力 |
| F05 | multilingual voice | 语音管理 | GREEN | 保留 |
| F06 | route-bound voice send | Conversation | GREEN | 管理页不能直接绕过真实会话发送 |
| F07 | media search / people / albums | 媒体管理 | GREEN | 保留 |
| F08 | media preview | 媒体管理 / Conversation Photo | GREEN | 保留 |
| F09 | image generate/edit | Conversation / 媒体管理 | GREEN | 保留 |
| F10 | save-back library | 媒体管理 | GREEN | 保留 |
| F11 | Live 入口 | Conversation Composer / Header | GREEN | Live 不再做一级导航 |
| F12 | inbound translation | Timeline 内联理解 | GREEN | 不替换原始消息 |
| F13 | outbound translation | Composer | GREEN | 先形成最终文本，再翻译/校验/发送 |

## G. Learning / Memory / Privacy

| # | 能力 | 新版入口 | 状态 | 审查结论 |
|---|---|---|---|---|
| G01 | send_and_learn | Conversation / 数据学习 | GREEN | 真实发送成功后才激活 |
| G02 | send_only | Conversation / 数据学习 | GREEN | 阻止学习 |
| G03 | exception | Conversation / 数据学习 | GREEN | 仅当前轮/例外语义保留 |
| G04 | do_not_learn | 数据学习 | GREEN | 能力仍在，但 UI 语义需最终锁定 |
| G05 | provisional evidence | 数据学习 | GREEN | 发送前只做临时证据 |
| G06 | repeated evidence | 数据学习 / Persona | GREEN | 多次后才提议长期固化 |
| G07 | learning evidence history | 数据学习 | GREEN | 可追溯/可撤销 |
| G08 | confirmed memory | 关系世界 / 数据治理 | GREEN | 保留 |
| G09 | open loops / promises / boundaries | 关系世界 / 数据治理 | GREEN | 保留 |
| G10 | conflicting/expired/superseded memory filter | 数据治理 | GREEN | 不允许偷偷进入回复 |
| G11 | structured signals instead of raw coach chat | 数据隐私 | GREEN | 隐私边界保留 |

---

## 仍需补齐的 7 个 AMBER 交互状态

这些不是“功能被删”，而是**能力已有入口，但完整交互状态还没有单独出图/封样**。

| # | 未完成状态 | 风险 | 下一步 |
|---|---|---|---|
| M01 | Live 会话 overlay | mic/camera/avatar/remote media 的启动、连接中、断线、结束态尚未视觉封样 | 补 1 张 Live overlay 状态组 |
| M02 | Conversation 内 Voice mini-flow | “当前文字→生成我的声音→试听→重生成→发送”尚未在当前母版上完整展开 | 补 1 张局部展开稿 |
| M03 | Conversation 内 Photo/Media mini-flow | 最近素材/人物/相册/根据对话生成/编辑的弹层尚未封样 | 补 1 张局部展开稿 |
| M04 | 真人打字进度态 | “正在输入… / 立即发送 / 取消”功能已定义，但当前母版未展开展示 | 补 1 张局部状态稿 |
| M05 | Translation preview / integrity failure | “将以目标语言发送·预览”、校验失败阻止错误语言发送的状态未展开 | 补 1 张局部状态稿 |
| M06 | Focus Chat | 两侧都收起后的当前 v4 精确视觉状态需要重新封样 | 补 1 张 Focus Chat 稿 |
| M07 | `本次例外` vs `本次不学习` 的最终 UI 文案映射 | 两个成熟语义都存在，若菜单文案不清可能造成学习含义误解 | 先锁最终菜单语义，再出下拉状态稿 |

## 不建议新增独立页面的能力

以下能力**不应**因为“旧版曾经有界面”而重新升级为一级/独立工作区：

- Translation：应留在消息/Composer 内联。
- Live：应是当前关系的实时 overlay。
- Voice/Photo 日常发送：应从真实 Composer 发起。
- Memory：正常状态只显示“现在有用的记忆”，不做数据库式主页面。
- Goal：属于当前关系/对话上下文，复杂 editor 才进入展开层。
- Learning：平时尽量隐形，只有治理/检查时进入高级页。
- Model Brain：核心聊天低存在感，高级路由才进设置。

## Non-Regression 最终闸门

在进入实现封账前，必须继续满足：

1. 只有一套 Yance 一级导航。
2. Element / Matrix timeline、composer、send authority 不替换。
3. 不创建 shadow timeline / composer / messaging runtime。
4. Reply Brain 最终文本必须回真实发送链。
5. Incoming translation 只做 projection。
6. Voice / Media / Live 必须 canonical route-bound。
7. Persona 保持 contact/conversation scope + truth firewall。
8. 即时风格调节不等于永久 Persona mutation。
9. Learning 真实发送成功后才激活。
10. send-only / exception / do-not-learn 必须真的阻止对应学习。
11. 新消息使旧 AI 候选 stale 的机制必须保留。
12. quick/deep、provider fallback、retry 继续属于 Model Brain。
13. Memory 只用 evidence-governed facts。
14. AI 不自动遮挡真实 timeline。
15. 展开/关闭 Reply Brain、Media、Voice、Live 不丢 timeline scroll / composer draft。
16. 双侧收起自然形成 Focus Chat。
17. 普通界面不暴露内部 engine 名称。
18. 任何视觉升级只能新增/重排/隐藏复杂度，不可删除成熟能力。

## 最终判定

**当前新版不是功能降级。**

它把旧版“很多功能页面”重新组织为：

> 人 → 关系 → 真实对话 → 表达能力 → 智能与治理

这比旧版“每个 AI 能力一个页面”的结构更符合 Relationship Intelligence Workbench。

但在 M01–M07 完成之前，状态应标记为：

- `FUNCTIONAL_ARCHITECTURE = GREEN`
- `FEATURE_COVERAGE = GREEN`
- `INTERACTION_STATE_COVERAGE = AMBER`
- `FINAL_VISUAL_CLOSURE = NOT YET`

下一阶段应只补 M01–M07，不再新增新的产品页面。
