# FIX6M 开源架构参考映射矩阵

## 使用原则

本矩阵只吸收公开项目已经验证过的架构模式。言策不 fork 这些项目，不复制受限制源码，不引入与本地优先桌面形态不相符的完整服务器运行时。所有模式均以言策自己的 CommonJS、SQLite、Electron 和现有领域约束重新实现，并通过 TDD、影子投影和真实 Windows UAT 验证。

| 参考项目 | 研究对象 | 言策长期缺陷 | FIX6M 目标公共权威 | 本轮实现 | 不采用内容 | 许可证边界 |
|---|---|---|---|---|---|---|
| Chatwoot | ContactInbox、Contact、Conversation、Message、渠道 incoming message service | 三平台账号/联系人/会话边界混合；同名误合并；历史消息、实时消息、回执分别处理；媒体空白 | `CommunicationAuthority` | 账号作用域外部身份、规范消息、媒体、同步检查点、发送尝试/回执 | Rails、Chatwoot 数据表和前端 | 只研究公共仓库模式；企业目录单独排除 |
| Temporal TypeScript | Workflow、Activity、History、Heartbeat、Cancellation、Retry | 登录、历史同步、头像下载、AI 调用和发送依赖进程内 Promise；重启后等待状态丢失；取消无法确认 | `DurableExecutionAuthority` | SQLite 持久执行、append-only 事件、generation、心跳、取消、重试、DLQ | Temporal Server、云服务依赖 | SDK 模式重实现，不复制实现源码 |
| Dify | Model Provider plugin、模型能力、错误归一化、工作流输入输出 | 目录、smoke、候选、资格、冠军、生产路由相互冒充；Provider 错误散落 | `ModelLifecycleAuthority` | Provider 契约和生命周期映射进入后续工作包 | Dify 前端、多租户和运行时 | 修改版许可证；严禁复制受限制模块 |
| Langfuse | Trace、Span、Generation、Evaluator、稳定关联 ID | routeTestId、executionId、providerRequestId、平台回执、学习收据分散且不能跨链关联 | `EvidenceAuthority` | SQLite trace/observation，兼容 routeTestId，脱敏、append-only | 托管遥测、提示词正文上传 | 自有实现；不要求外部服务 |
| Activepieces | Piece auth、trigger/action、启停生命周期、版本化 connector | 三平台 Adapter 各自决定认证、同步、重试和业务状态 | `ChannelAdapterContract` | 统一 typed plain-data 端口 | 通用自动化引擎 | 只吸收接口边界 |
| Open WebUI | Ollama/OpenAI-compatible Provider 信息架构、本地/云模型分层 | 模型中心把本地、云、回复、后台、多模态和生命周期平铺混合 | `ModelLifecycleAuthority` UI 投影 | 后续模型中心重构参考 | 主仓库 UI/品牌源码 | 自定义许可证，禁止直接复制 |
| AnythingLLM | Windows 桌面本地优先、Provider 健康、本地数据目录 | 启动、依赖、自检、本地/云切换和恢复入口不统一 | `DesktopRuntimeAuthority`（既有） | 只用于 Windows UAT 和启动器审查 | 完整应用运行时 | MIT 模式参考，仍不复制 |
| Mem0 | user/session/agent/run 记忆分层、版本历史和检索 | AI 学习缺少“实际使用了哪个记忆版本”的可追踪收据 | `AIReplyLearningAuthority` | 后续加入学习版本、检索和撤销收据 | 自动把聊天提升为长期事实 | Apache-2.0 模式参考；保留言策人工审批 |

## 直接代码映射

| 当前言策位置 | 当前问题 | 新边界 | 迁移方式 |
|---|---|---|---|
| `backend/services/aiExecutionTraceAuthority.js` | 仅内存 Map，进程退出后证据消失 | `EvidenceAuthority` | 保留兼容 API，运行时持久写入；测试可显式使用内存模式 |
| `backend/services/candidateExecutionService.js`、`aiGateway.js` | 路由、worker、Provider 阶段有追踪但缺少统一持久 execution/attempt | `EvidenceAuthority` + `DurableExecutionAuthority` | 双写 trace 与 execution history |
| `backend/services/jobQueue.js` | 已有 physical execution fencing，但仅适用于部分 AI 队列 | `DurableExecutionAuthority` | 抽取通用状态/事件语义，不降低现有 fencing |
| `backend/services/domainEventLogService.js`、`platformCoreRepository.js` | 已有领域事件，但消息、媒体、发送和 UI 投影尚未统一 | `CommunicationAuthority` | 保留 domain event ledger，新增 canonical contract 和 shadow projection |
| Telegram history、WhatsApp reconciliation、Facebook reconciliation | 检查点、等待和错误状态各自定义 | `DurableExecutionAuthority` + `CommunicationAuthority` | 按 operation kind 迁移并保留旧状态影子比较 |
| 头像、GIF、贴纸和附件处理 | 下载、鉴权、缓存、渲染失败最终表现为空 | `MediaAsset` lifecycle | 原始引用、下载状态、渲染投影分离 |
| `customerProfileEvidenceAuthority`、关系投影 | 已有证据去重，但联系人/关系结论不能统一追溯到一条 canonical message trace | `ContactRelationshipAuthority` | 将来源键升级为 canonical message/event/trace receipt |
| 回复 feedback/learning/outbox | 有安全门禁但跨平台发送回执、学习版本和检索使用记录未统一 | `AIReplyLearningAuthority` | 成功平台回执后才创建 pending 学习；检索产生 receipt |

## 许可证和供应链门禁

1. 不把任何参考仓库作为言策子模块或 vendored source。
2. 不复制 Dify、Open WebUI、Chatwoot enterprise、Langfuse enterprise 目录代码。
3. 如果未来引入 SDK，必须固定版本、生成 SBOM、审查传递依赖和网络出口。
4. 当前 FIX6M 基础层不增加运行时依赖；使用 Node 22 内置模块和既有 SQLite。
5. 每个参考模式必须由言策自己的失败测试证明当前缺陷，再由最小实现关闭。
