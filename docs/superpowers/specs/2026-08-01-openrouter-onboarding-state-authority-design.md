# OpenRouter 一键接入状态权威修复设计

## 目标

修复一键接入 OpenRouter 后模型数量、模型池、路由和测试状态不同步的问题；使“测试当前配置”在自动推荐模式下测试当前已解析的条件路由，同时保持正式专项评估门禁不变。

## 架构

1. 新增纯前端 `RouteDraftAuthority`，统一生成持久化草稿与瞬时测试草稿。持久化草稿保留 requested 意图；测试草稿额外携带当前 resolved 主备模型，避免自动选择在尚无正式冠军时被重新解析为空。任务超时的最小值、默认值和上限也由该公共权威统一归一化，避免页面输入、草稿和持久化出现不同规则。
2. 一键接入完成后只通过既有 `ModelRuntimeSnapshotAuthority` 投影并原子提交完整状态，不再逐字段更新页面状态。
3. 新增 OpenRouter 展示权威，区分“未返回额度”和数值零，并明确呈现目录接入、双模型 smoke、正式专项评估三个独立阶段。
4. 前后端一键接入链路均不得修改全平台自动化配置；后端只回传当前自动化状态，启用或关闭继续由现有独立控制按钮显式完成。

## 数据流

OpenRouter 自动配置 API → 状态 API → ModelRuntimeSnapshotAuthority → 单次提交 services / summary / pools / routes / readiness / OpenRouter / automation → 统一重绘。

路由测试：UI requested 草稿 + 当前 resolved 主备 → RouteDraftAuthority(test) → 后端 validateRouteDraft → AI Gateway 条件试运行；不写入 SQLite，不提升正式资格。

## 门禁约束

- 不运行“OpenRouter 正式专项评估”。
- onboarding smoke 只能建立需人工确认的 conditional route。
- 测试草稿不得修改持久化 requested 选择。
- 条件模型不得自动发送消息。
- 不通过放宽资格校验、伪造正式收据或跳过路由验证实现修复。

## 测试

- 自动推荐测试草稿保留 requested=auto，并携带 resolved 主备及 allowConditional。
- 持久化草稿仍不把自动解析结果伪装成人工选择。
- 完整快照提交同步 modelPools 和计数来源。
- null/undefined 额度显示“未返回”，真实零才显示 `$0.0000`。
- 源码门禁确认前端不再调用 AI automation PUT，后端 auto-configure 路由也不再调用 `aiAutomation.updateConfig`。
- 路由草稿对快速回复、深度回复等任务继续执行既有超时下限、默认值和安全上限。
- 交付身份重新绑定修改后的完整源码；不得沿用 FIX6J 的旧派生哈希。
- 恢复源码完整性清单声明但上游 ZIP 遗漏的 WhatsApp 安全 UAT 根入口，入口只委托现有安全工作流并原样传播阻断退出码。
