# 言策 v4｜2026-09-26 Owner 真实界面验收对账

状态：`OWNER SCREENSHOT RECONCILIATION / EXECUTION INPUT`

本记录固化 2026-09-26 owner 在真实 Windows frozen acceptance runtime 上连续截图验收后确认的问题。截图本身不入库，避免把真实联系人、头像、消息与桌面信息持久化进仓库；本文只记录相对正式设计 authority 的差异与执行边界。

## 1. 权威与边界

- Home：`screens/core/Yance_Home_Adaptive_v1.png`
- Relationship World：`screens/core/Yance_Relationship_World_v1.png`
- Settings：`screens/core/Yance_Settings_v1.png`
- Conversation：`screens/core/Yance_v4_precise_collapse_controls_final.png`
- 功能非降级：`spec/YANCE_V4_FINAL_FUNCTION_RECONCILIATION_2026-09-23_ZH.md`
- 前序真实运行时对账：`review/YANCE_V4_RUNTIME_RECONCILIATION_2026-09-25_ZH.md`

本文不修改验收标准、不重排既定 causal batch，也不授权 CI / merge / RC / UAT / Release。当前执行顺序仍是：F-01 完成证明后 F-02，再 F-03，最后统一处理 F-04～F-11 / P2 视觉治理。

## 2. F-01 当前状态

F-01 的确认根因是 Conversation active 时通配 direct-child 规则 `.yance-product-shell[data-conversation-active] > * { width: 100% }` 把唯一 Global Rail 拉成全工作区 hit-test overlay。

最小源码修复已经收窄为只让 `.yance-shell-scene--conversation` 填充工作面；对应 regression 已独立落盘。owner 最新 Conversation 截图中已经不再出现全屏 NAV / blur overlay，Global Rail 视觉上恢复为窄 rail。

但这不等于整个 Conversation / Desktop Shell 已 HUMAN-ACCEPTED：后续截图继续暴露了与正式母版显著不一致的 presentation / projection 问题。F-01 只能按“rail 遮罩根因已修、需完成对应 runtime 判定”的范围关闭，不能据此宣布全项目 ACCEPTED。

## 3. Desktop Shell：默认窗口必须 laptop-first

owner 明确否定以当前 32 英寸桌面显示器作为默认窗口设计基准。当前本地未提交实验曾把 Electron 默认窗口改成 `1600×900`，该方向已被 owner 否决，不得进入正式分支。

正式要求：

- 默认窗口必须以笔记本场景优先，而不是以大尺寸桌面显示器为基准；
- 必须基于 Electron / Windows 的 `workArea`（DIP / 逻辑像素）自适应，不按物理分辨率硬编码；
- 不允许固定一个在 1366×768、125% / 150% DPI 下逼近或超过可用工作区的 desktop-sized 初始窗口；
- 用户调整过的窗口尺寸可记忆，但恢复时必须 clamp 到当前显示器 workArea；
- 窄窗口下 Product composition 自身要响应式收敛，不能靠超大窗口掩盖布局缺陷。

具体最终数值需在对应视觉 causal batch 中按 laptop-first 响应式测试锁定；本文只锁定“固定 1600×900 不可接受”和“workArea 自适应”两个 owner 已确认约束。

## 4. Home / People 对账

### H-01｜页面头层级过重

当前运行时在 Global Header 下又出现 `首页 · People`、大号“今天值得关注”和副标题的网页式 Page Hero。正式 Home 母版没有这一层大 Hero；主体应在紧凑页面标题后立即进入关系卡片。

### H-02｜“今天值得关注”右侧状态区信息密度失衡

当前 `最近互动 / 真实对话 / 关系状态` 三行使用了大块横向面积，但文字层级弱、值表达稀疏，造成明显死空间。正式母版要求右侧是紧凑状态摘要：label 与明确 value 成对呈现，并紧接“言策建议的下一步”，不能成为三行弱文本占半张卡。

### H-03｜联系人筛选出现横向滚动

当前平台筛选在实际窗口中出现 `WhatsA...` 裁切与横向 scrollbar。正式母版中的 `全部 / Facebook / Telegram / WhatsApp` 应在联系人栏内完整可达；响应式收敛不能依赖横向滚动掩盖宽度问题。

### H-04｜过度 Card 化

当前联系人、摘要和动作的边框/圆角权重偏高，整体更像 Web dashboard。正式母版依赖更连续的桌面列表、较少的容器边界和更明确的选中态。

## 5. Settings 对账——当前偏差最大

### S-01｜错误的 Page Hero composition

当前 Settings 在 Global Header 下又叠加大块 `YANCE SETTINGS / 常规 / 说明 / 返回关系` 页面头，占据大量首屏高度。正式 `Yance_Settings_v1.png` 没有这一大 Hero：结构应是 Global Header → 唯一 Global Rail → Settings 分类栏 → 右侧直接进入设置内容。

该 Hero 应按母版移除，而不是只缩小字体或 margin。

### S-02｜内容模型被错误改成“入口卡片”

当前运行时把对话默认、AI 工作台、真人打字、人格管理等做成大卡片 + 整宽 CTA（如“查看模型与路由”“打开 AI 工作台”“查看输入边界”）。母版要求这些能力在 Settings 中直接呈现为紧凑设置行、开关、选择器和右侧次级动作，而不是把设置页做成跳转门户。

### S-03｜主题体系错误

当前 Settings 大面积紫色 / 洋红 Card、描边和文字与正式 Premium Calm 的 navy / graphite / restrained gold 明显冲突。不能只做“紫色换蓝色”的 token 替换；Card composition 与层级本身也需回到母版。

### S-04｜容器嵌套与滚动造成明显 Web/embed 感

当前形成 Global Rail → Settings 左栏 → 大内容面板 → 紫色卡片 → 卡片内整宽按钮，多层独立滚动和边框让用户感觉“桌面应用里嵌了网页”。技术上继续复用 mature Element/Yance owner，但 presentation 不得暴露这种嵌入感。

### S-05｜标题重复与 IA 漂移

顶栏已经有“设置”，页面又重复 `YANCE SETTINGS / 常规`，右侧内容再重复“常规 / 全局默认与关系行为”。同时“AI 工作台”等被提升为入口卡片，破坏了母版左侧分类 + 右侧直接配置的 IA。

## 6. Conversation 对账

### C-01｜Conversation Header 结构错误

母版是紧凑 toolbar：联系人身份 + 平台/关系信息 + 电话/视频/更多 + 回复模式。当前运行时变成大面积圆角空卡，右侧有明显空按钮/空容器，横向空间利用低且呈 Web Card Header 感。

### C-02｜Timeline 空间分配异常

真实消息数量允许与母版不同，但当前 timeline 在少量消息时出现大块无用途空区，消息/媒体被拉得过散。应保持真实 Element timeline authority，同时让消息沿自然文档流保持连续密度；不得为了“填满设计图”伪造消息。

### C-03｜Reply Brain 仍停留在策略入口，不是正式结果工作台

当前中央下方主要是“人物设定 · 当前关系”和 `轻松接住 / 好奇引导 / 制造期待` 等策略卡，并显示“生成真实建议”。正式母版要求默认呈现 3 条真实回复候选，每条具有使用、解释、语气微调、换一组、平衡模式和学习反馈等直接工作能力。

问题不是缺少金色视觉，而是产品层级错了一层：当前是“先选策略再生成”，母版是“直接给出成熟候选结果再选择/微调”。

### C-04｜Composer 正式能力没有完整投影到可见工作面

母版中的图片库、生成图片、语音、Live、翻译、真人打字、发送学习模式、模型/Provider/推理控制等应在 canonical composer 周围形成紧凑工作台。当前截图可见区域几乎只剩 `发送消息...` 和少量图标。

已有 mature owner / DOM 实体存在不能替代 Product 可见性；`entity exists` 不等于 `Product projection GREEN`。

### C-05｜Inspector 主内容模型错误

母版右侧是 persistent `AI / 人格 / 关系 / 记忆 / 目标` Inspector，并直接呈现当前人格、关系信息、沟通风格、记忆与目标及更多能力。当前右侧主要变成“回复大脑为什么这样想 / 人物设定 / 思考方式 / 为什么这样回复”等 explanation panel，且下半部大面积空白。

AI explanation 可以作为 AI tab 的内容之一，但不能吞掉完整关系/人格 Inspector。

### C-06｜Conversation route 下 Global Rail 的状态投影仍不符母版

F-01 已证明“唯一、窄 Global Rail”结构必须保留；但母版 Conversation 态应在同一条 rail 上呈现 Conversation 当前状态，而当前截图仍显示 `首页 / 关系世界 / 设置` 的 Home 风格投影。禁止通过创建 conversation-specific 第二 rail 解决；必须由唯一 Global Rail 正确投影 route state。

### C-07｜左侧 Conversation List 过度 Card 化

母版联系人行是高密度连续列表，普通项边界弱、仅选中项明显暖金强调。当前每个联系人都是独立厚圆角卡，降低一屏信息量并强化 Web dashboard 感。

### C-08｜视觉层级过平

当前大量区域使用相近 navy + 蓝色边框 + 圆角，所有容器权重接近。母版的 Premium Calm 依赖深浅层次、少量暖金关键强调、克制边界和高密度有序信息，不是“给所有卡片加 glow”。

## 7. 明确不是缺陷、不得伪造的数据差异

以下与母版不同不构成问题：

- Hermes / Yeonhee Kim 等联系人身份不同；
- WhatsApp / Facebook Messenger 等实际平台不同；
- 真实消息条数、时间、媒体数量不同；
- 记忆、共同兴趣、亲密度、关系状态等值必须来自真实 mature owner；
- 不得为了“看起来像设计图”伪造 Matrix 消息、关系事实、记忆、人格或平台数据。

需要对齐的是：结构、密度、层级、控件、响应式和真实 owner 的 Product 投影。

## 8. Non-Regression 保护

后续视觉治理必须继续保护：

- Element timeline / composer / send / room / session / crypto / membership / retry / recovery；
- 37 人 People 投影；
- translation；
- Voice；
- Media；
- Live；
- Relationship / Memory / Goal；
- Persona；
- Model routing；
- Telegram backfill 及其它 unrelated local changes。

不允许通过第二套 typing runtime、第二套 navigation、shadow composer/timeline、overlay workaround 或 fake data 来追设计图。

## 9. 执行顺序保持不变

本文新增的视觉 RED 不抢在既定 P0/P1 前执行：

1. 先完成 F-01 对应的 runtime GREEN / Conversation + Desktop Shell 重判；
2. F-02：恢复真人打字真实 mode projection 与发送控制，复用 mature typing/send owner；
3. F-03：修正“真实对话”计数语义，不修改 Matrix 数据、不伪造消息；
4. F-04～F-11 / P2 再统一做 Home / Settings / Conversation / Shell 的母版级 presentation reconciliation。

若某个视觉问题在 F-02 / F-03 中与同一真实 projection root 直接重合，只能在同一 mature owner / 同一 causal boundary 内处理，不得借机扩大到全屏视觉重写。

## 10. 2026-09-26 本地仓库清洁记录

本轮开始时活动 checkpoint 分支存在混合 dirty：已验证 F-01 与此前未完成/已被 owner 否决的 UI 实验混在同一 worktree。为避免 `reset / clean / stash` 破坏未确认字节，采取以下安全分离：

- F-01 最小修复与 regression 独立提交为 `aa8a12dd`（`fix(v4): keep conversation global rail narrow`）；
- 其余混合 WIP 原样保存在本地 safety 分支 `safety/yance-v4-pre-clean-20260926-0914`，保存 commit `72b931fe`；
- safety WIP 包含已被 owner 否决的 `1600×900` fixed desktop window 实验，因此不是正式 authority、不是待推远端候选；
- 活动分支恢复 clean 后再提交本文与 README 指针；
- 未执行 `git reset`、`git clean`、`git stash`；
- 未触碰或顺手 stage `config/matrix/mautrix-telegram/config.yaml`、`services/matrix/docker-compose.yml`。

后续新聊天应从活动 checkpoint 分支与本文继续；除非明确需要取回某段未完成实验，不要把 safety 分支整体 merge 回正式分支，应按新的 causal batch 从中逐项审查/取用。

## 11. 状态语言

- 本文是 owner 真实截图形成的最新 design/runtime reconciliation 输入。
- 它不替代 2026-09-23 正式母版，不降低任何功能 non-regression 标准。
- “测试 GREEN”仍不等于完成；每个 causal batch 必须完成 materialized runtime proof。
- 当前不得因为记录了这些问题就宣布全项目 ACCEPTED。

## 12. F-01 runtime closure 与局部重判（2026-09-26）

本轮在同一 frozen acceptance runtime / profile / Matrix session 上完成 F-01 真实 Windows renderer 复验；未 Docker rebuild、未重登、未清 SQLite、未换 profile/session。

### F-01 核心证据

- frozen runtime admission：GREEN；Matrix 身份仍为 `@tester01:yance.local / VVSOCENLTA`；materialized Yance bundle SHA-256 仍为 `ba17d313c031788dc5c6e6874c80eb16672debf3674e9628b17c533e26e849d4`。
- AL MA Conversation 通过真实 Home 两步 UI 路径进入，没有直接改 hash。
- 唯一 Global Rail：`railCount=1`；Conversation 内第二 rail：`0`；rail 实测总宽约 `98px`，仍为窄 rail。
- Conversation scene 从 rail 后方展开并占满剩余 client area；不再出现全屏 blur / NAV overlay。
- timeline 可滚动（probe 中 `scrollTop 18 -> 0`）。
- composer 可真实 focus，插入 `__F01_PROBE__` 后成功撤销清理，没有发送消息。
- timeline / composer / Reply Brain 三建议 / tone / model row 的 `elementFromPoint` 均未命中 Global Rail / NAV。
- Inspector tab 可见且可命中自身 tab navigation；5 个 tab 为 `AI / 人格 / 关系 / 记忆 / 目标`，与正式 Conversation 母版一致。
- ActionDock 自身存在 `65px` 可滚动余量；滚到底后“发送照片 / 生成编辑图片 / 语音回复”中心点均命中自身按钮。Live 中心点仍被 model control 局部覆盖，归入已记录的 Conversation composition / P2，不重新扩大 F-01 rail causal batch。
### v2 acceptance 局部重判

依据 `Yance_v4_ACCEPTANCE_REPORT_v2_2026-09-26.md` 原始 Screen Verdicts，Desktop Shell 与 Conversation 的 FAIL 均由 F-01 全屏 rail 遮罩直接造成；F-02 / F-03 单列于 Functional Non-Regression。

因此本轮只重判这两个 F-01 相关结论：

- **Desktop Shell：F-01 PASS** — 唯一窄 Global Rail 恢复，核心工作面不再被 NAV 接管；已记录的 laptop-first 默认窗口与视觉母版问题仍按后续 P2/独立 causal batch 处理。
- **Conversation：F-01 PASS** — timeline / composer / Reply Brain / tone / model / Inspector 不再因 Global Rail 不可达；ActionDock 不再被 Global Rail 覆盖。已记录的 Reply Brain composition、Inspector 信息密度、Composer/ActionDock 母版偏差仍保留，不据此宣称整屏 design authority GREEN。
- **Functional Non-Regression：仍 FAIL / 未重判** — F-02 真人打字投影与 F-03 “真实对话”计数语义仍待后续 causal batch。
- **全项目：仍 NOT ACCEPTED**。

### admission harness 对齐说明

`frozen-acceptance-admission.js` 原先硬编码 `conversationInspectorTabCount === 4`，与正式母版和本轮 owner 已确认的 5-tab `AI / 人格 / 关系 / 记忆 / 目标` 冲突。该 harness 实现已通过 TDD 从 4 修正为 5；这是把工具恢复到既有验收标准，不是修改验收标准，也没有改变 Product 字节。

## 13. F-02 真人打字 Product projection closure（2026-09-26）

F-02 只恢复 mature typing/send owner 的 Product 可见投影，不新增第二套 timer、queue、send state 或 composer authority。

### F-02 mature owner / source 证据

- mature owner 仍为 `TypingStateService / StoreManager / Element send`；Product 只通过现有 `storeSnapshot({ domains: ["typingState"] })` 与 release/cancel bridge 读取/调用真实状态。
- focused regression + mature typing owner：`12 tests / 12 pass / 0 fail`。
- mature-authority proof：`GREEN`，无 second owner / shadow authority / parallel lifecycle / mirror state。
- `yance-element-module:lint:types --skip-nx-cache`：GREEN；`yance-element-module:build --skip-nx-cache`：GREEN。

### F-02 materialized runtime 证据

- 本轮 F-02-only materialized Yance bundle SHA-256：`30f2c6dc85be880d611f1fe24e8a4e37e571464a622b8c16637bdb0b37fcb835`，built / mounted / container 三处一致。
- mature runtime `typingState`：`ready=true`、`platformAfterApproval=true`、`platformDuringGeneration=false`，因此当前全局 mode 为“自然”。
- 真实 Electron 最大化验收窗口 `1920×1032` 下，Home 右侧“全局环境”可见显示：`真人打字 · 全局：自然`；旧错误文案“当前关系投影”不存在。
- 通过真实 Home UI 进入 AL MA Conversation 后，真实 composer accessory 静态态持续显示：`真人打字 · 全局：自然`，并说明 `AI、手写与翻译后的最终文本统一经过真实发送层。`
- 静态态 `data-state=ready`，没有“立即发送 / 取消”伪控制；这些按钮仍只在 mature owner 返回真实 active send state 时出现。
- runtime proof 未发送消息、未改 Matrix 数据、未修改 typing policy。

因此：**F-02 PASS**。Functional Non-Regression 中真人打字投影项由 FAIL 重判为 PASS；F-03 “真实对话”计数语义及其独立导航/恢复 RED 仍未关闭。全项目仍 `NOT ACCEPTED`。
