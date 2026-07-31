# 言策 Round 7 产品生产接线审查矩阵

基线：Round 6 真实运行源码快照 `275705558c19a074564ec0b755b56b15655b8535`。

> 本仓库由上传的源码快照导入，用于审查和修复；不冒充原始 Git 历史。任何“完成”必须同时具备源码修改、正式生产入口、数据写回和真实 Windows 证据。

| 编号 | 严重级 | 需求 / 缺陷 | 权威数据源 | 正式生产入口 | 当前状态 | 关闭证据 |
|---|---|---|---|---|---|---|
| P0-UI-001 | P0 | 左侧会话摘要在双语/中文模式下显示已有中文译文 | `r32_messages` 原文/译文 | `workspace.bootstrap → renderContacts` | 源码接线完成，Windows待验收 | 后端契约 + DOM契约 + Windows截图 |
| P0-UI-002 | P0 | 输入中文时显示目标语言并只发送译文 | `ContactLanguageAuthority` | Composer → `message.sendText` / Store Outbox | 源码接线完成，真实平台待验收 | 路由契约 + UI状态 + 真实平台发送 |
| P0-AI-001 | P0 | 没有意图、证据、策略时不得显示“理解完成” | AI分析运行与结构化结果 | `applyCrossModuleContext → renderUnderstanding` | 源码接线完成，Windows待验收 | 不完整结果测试 + Windows截图 |
| P0-AI-002 | P0 | 导演路由为空时明确阻断，不得伪装已配置 | 模型路由注册表 | AI工作台 / AI回复大脑 | 状态门禁完成，模型评估与配置待执行 | 路由状态一致性证据 |
| P0-UI-003 | P0 | 联系人右键菜单只保留打开、置顶、归档 | 会话命令 | 联系人列表右键 | 源码接线完成，Windows待验收 | DOM契约 + Windows截图 |
| P0-AI-003 | P0 | 对方入站事实→证据→客户档案自动写回 | Workspace权威事实与证据 | `message:inserted → StoreManager / AI automation` | 源码与SQLite闭环完成，三平台Windows待验收 | Kurt固定样本 + SQLite证据 + UI刷新事件 |
| P0-AI-004 | P0 | 客户事实与关系状态进入回复大脑上下文 | StoreManager `customers / memories / relationships` | `INGEST_SOCIAL_MESSAGE → ContextAwareReplyBrain` | 源码闭环完成，真实模型候选待验收 | StoreManager集成测试 + 反向上下文证据 |
| P0-AI-005 | P0 | 没有合格理解模型时，明确事实仍自动保存 | 确定性事实提取服务 | `aiBrainOrchestrator.processConversation` | 源码闭环完成，Windows事件待验收 | 无模型集成测试 + 档案刷新事件 |

## 完成定义

每一项只有同时满足下列条件才允许改为“已关闭”：

1. 真实生产入口已经接线，而非只存在辅助函数或测试文件；
2. 使用正确的 `platform + sourceAccountId + sessionKey`；
3. 结果写入权威数据源，下一层确实读取；
4. 失败、超时和迟到结果不会虚假完成或串会话；
5. 自动测试、实际 DOM 断言与真实 Windows 截图相互一致。
