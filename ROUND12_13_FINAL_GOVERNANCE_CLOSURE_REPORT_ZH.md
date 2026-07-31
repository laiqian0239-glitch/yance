# 言策 Round 12/13 最终治理源码闭环报告

## 一、身份

- Branch：`architecture/system-round12-13-final-governance-closure-20260727`
- Implementation Commit：`26bb72f547fe821605772bc9c5fa6daecfee8dcc`
- Implementation Tree：`b708b407ea7d5745813409c8277a02de2de7e4be`
- Implementation Parent：`b4256a05a585d388cef95271ef33e038c6b77e4c`
- Implementation Tag：`architecture-round12-round13-final-governance-implementation-20260727`
- 基线 Delivery Commit：`1ffcd4229b105524ab048f467485fa1e950b61a3`

本报告只证明源码与自动化闭环，不替代真实 Windows、真实三平台、真实数据库和真实 OpenRouter 证据。

## 二、本轮关闭的七项缺口

### 1. Person 成为统一关系锚点

建立并迁移 `person_contact_bindings` 与 `conversation_bindings`，将客户档案、证据、关系洞察、关系状态、时间线、AI 上下文、导演策略、候选计划、反馈事件、学习信号与学习配置绑定到同一 Person。IdentityLink 合并和回滚会同步移动或恢复这些锚点，不再只移动平台身份外壳。

### 2. IdentityLink 全状态可逆

人工确认、争议、解除、合并均写治理操作收据和审计。每种状态迁移都有可执行回滚；解除身份后关联会话绑定也可恢复。显示名相似、头像相似等弱信号仍禁止自动合并。

### 3. 动态账号级 Capability 正式接线

正式会话工作台会读取当前账号的 `PlatformCapabilityAuthority` 状态，而不是仅依赖静态平台矩阵。通用媒体、历史、Presence、Typing、Reaction、撤回与发送动作根据账号级 support、availability、reasonCode 和约束决定显示和执行。

### 4. 扩展领域事件与可修复投影

领域事件覆盖普通入站、发送、Echo、回执、Reaction、撤回、已读、媒体生命周期、历史同步、Reconcile 和身份治理。事件保存前脱敏并幂等；投影支持分页审计、阻断收据、单项修复、批量重放和重新计算收敛状态。

### 5. 架构证据自动导出

Windows 证据导出包含运行身份、平台 readiness、Round 12/13 架构状态、发布门禁、动态能力、IdentityLink 治理、投影审计与修复、L2/L3 调度与提案、AI 路由回执、Outbox/SendPolicy/幂等证据及当前屏幕截图。

### 6. 运行健康与发布门禁

投影未审计、投影阻断、事件桥失败会使发布门禁阻断；学习调度停止或持续失败会使系统降级并显示 reasonCode。消息主链可继续运行，但不允许以健康状态冒充架构收敛或晋升正式发布。

### 7. 大数据治理分页

IdentityLink、投影阻断项和 L2/L3 提案支持分页、筛选和持续处理。投影“修复全部”按批次循环并重新审计，不再只读取固定前 200 条或一次处理固定前 1000 条。

## 三、关键安全边界

- 所有持久文本、媒体、Reaction、撤回与 Telegram 原生表达均先进入 Outbox；平台 SDK 直接发送旁路为零。
- 用户确认后的目标语言文本和 SendPolicy 进入不可变命令信封并参与哈希；断网等待不消耗重试预算。
- AI 超时先缩减无关上下文并重试同一高能力模型，再切换同档备用；应急结果不进入长期学习。
- L2 可自动综合；L3 只生成提案，必须人工批准后生效。
- 真实数据库 `blocking=0` 仍需 Windows 全量审计证明，不能由空库或测试库替代。

## 四、自动验证

- Round 12 平台核心：**60/60 PASS**
- Round 13 AI 质量：**24/24 PASS**
- 最终综合专项：**34/34 PASS**
- 后端逐文件隔离：**146/146 文件，881/881 测试 PASS**
- CandidateBinding：**3/3 PASS**
- UAT 诊断：**112/112 PASS**
- Source UAT：**33/33 PASS**
- Round 11 UI 契约：**6/6 PASS**
- Windows UAT 包契约：**7/7 PASS**
- 主题颜色审计：**PASS，固定颜色债务 0**
- `git diff --check`：**PASS**
- `git fsck --full --strict`：**PASS**

## 五、当前结论

当前源码阻断项为 0，允许生成一次综合 Windows UAT 候选。以下项目仍未被源码测试替代：真实数据迁移与投影收敛、真实三平台收发与对账、真实跨平台 Person 合并和回滚、真实 L2/L3 治理、真实 OpenRouter 质量路由、Round 11 界面及长时间恢复。
