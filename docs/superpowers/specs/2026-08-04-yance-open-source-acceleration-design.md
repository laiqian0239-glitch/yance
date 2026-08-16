# 言策开源能力加速与稳定化设计

日期：2026-08-04  
状态：已确认为下一阶段方向，等待设计 PR 审查后进入实施计划  
基线：`main`（创建本设计分支时的 Head：`e53bf933a8f4e3273e515587d917433df24d6feb`）

## 1. 决策摘要

言策已经是可以运行的 Electron/Node.js 桌面产品，具备工作区、联系人、关系资料、会话、三平台适配、AI 模型调用、Persona Brain、SQLite 持久化、消息发送和大量治理与回归测试。

下一阶段不从零重写言策，也不继续为成熟基础能力重复造轮子。执行方向改为：

> 保留言策已经形成的产品、数据与业务权威边界，把不稳定、不完整或维护成本过高的底层能力，替换为经过验证的开源实现；通过依赖、Sidecar、受控 Fork、协议适配或逐文件移植完成整合。

言策不以闭源商业发行为目标。允许采用 AGPL-3.0、GPL-3.0、MIT、Apache-2.0、Boost 等兼容开源项目，但每一项整合必须完成许可证、来源、版本、修改和分发义务审计。

本设计不是“把多个开源项目全部塞进言策”，而是为每个领域选择一个主要权威实现，避免多套平台连接、模型路由、记忆系统或工作流框架争夺同一状态。

## 2. 目标

### 2.1 产品目标

1. 保持现有言策可运行、可升级和可恢复。
2. 尽快提高 WhatsApp、Telegram、Facebook 三平台的连接、恢复、同步和发送稳定性。
3. 用成熟模型网关解决 Provider 差异、模型路由、故障转移、限流和可观测性问题。
4. 把 Persona、Prompt、知识、长期记忆、回复规划和反馈学习组合成可追踪、可评估、可成长的 AI 回复大脑。
5. 让每一次回复都能够解释：使用了哪些身份、人格、历史、知识、记忆、模型和规则。
6. 通过真实 Windows、真实已有数据和真实平台故障矩阵证明稳定性，而不是只通过孤立单元测试宣称完成。

### 2.2 工程目标

1. 不推翻言策现有 canonical identity、conversation、message、ledger、outbox 和 authority 模型。
2. 所有外部组件通过明确 Port/Adapter 接入，外部代码不得直接写言策权威数据库。
3. 同一领域只保留一个运行时事实权威。
4. 所有复制或修改的代码都固定到精确上游提交，并保存来源清单。
5. 每项替换都具备迁移、回滚、故障注入和行为级回归测试。
6. 禁止临时绕过：不得通过吞异常、扩大重试、关闭门禁、绕过迁移、伪造 readiness 或跳过权威层完成“稳定化”。

## 3. 非目标

本阶段不做以下事情：

- 不整体替换 Electron UI、SQLite 数据模型或言策全部后端。
- 不同时引入多套 WhatsApp、Telegram、Memory、RAG 或 Agent 运行时。
- 不直接复制整个 Chatwoot、SillyTavern、AnythingLLM 或其他完整产品。
- 不让第三方扩展或 Sidecar 绕过言策的身份、权限、Outbox、审计和数据分类。
- 不在缺少高质量反馈数据时优先训练或微调模型。
- 不把“许可证允许复制”等同于“可以无来源、无测试、无边界地复制”。
- 不因当前正式发布治理尚未全部闭合而否定现有源码运行和产品增强。

## 4. 总体架构

```text
┌──────────────────────────────────────────────┐
│ Yance Electron UI                            │
│ conversation / persona / knowledge / trace   │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Yance Core                                   │
│ workspace / identity / contact / relation    │
│ canonical message / policy / ledger / outbox │
└───────────────┬───────────────────┬──────────┘
                │                   │
┌───────────────▼────────────┐  ┌───▼────────────────────────┐
│ Channel Gateway            │  │ Reply Brain                │
│ WhatsApp: Baileys          │  │ Prompt/Persona compiler    │
│ Telegram: TDLib Sidecar    │  │ Memory + RAG retrieval     │
│ Facebook: Meta API adapter │  │ Reply graph + validation   │
└───────────────┬────────────┘  └───┬────────────────────────┘
                │                   │
                │              ┌────▼────────────────────────┐
                │              │ Model Gateway               │
                │              │ AI SDK → LiteLLM/OpenRouter │
                │              └────┬────────────────────────┘
                │                   │
┌───────────────▼───────────────────▼──────────┐
│ SQLite / sqlite-vec / durable task / outbox  │
│ XState deterministic lifecycle authorities   │
└───────────────────────────────────────────────┘

OpenTelemetry → Langfuse
Feedback dataset → Promptfoo → reviewed promotion
```

### 4.1 不变的言策核心

以下能力继续由言策作为唯一权威：

- 工作区与本地用户身份；
- 平台账号与 canonical contact identity；
- 联系人合并、关系状态和客户档案；
- canonical conversation/message/attachment；
- 数据分类、权限、审计、ledger 和不可变回执；
- OutboxCommand、发送意图、幂等键和最终业务结果；
- Persona 发布版本和业务规则；
- 导入数据的归属、保留、删除和迁移。

外部项目只能通过适配器提供协议、模型、检索或推理能力，不能成为第二套业务事实数据库。

## 5. 开源能力映射

## 5.1 跨平台会话领域模型：Chatwoot

上游：`chatwoot/chatwoot`

用途：参考并受控移植以下成熟模型和测试：

- Inbox、Conversation、Message、Contact、Attachment；
- delivery status、webhook ingestion、idempotency；
- Facebook、Instagram、WhatsApp、Telegram 等 channel adapter 的边界设计；
- 多平台消息归一化、会话归属和联系人映射；
- webhook 重放、重复消息和状态更新处理。

整合方式：不引入完整 Rails 服务，不复制 `enterprise/` 目录。只移植经过许可证确认的 OSS 领域规则、协议映射和行为测试，并重写为言策 TypeScript/JavaScript Port/Adapter。

## 5.2 WhatsApp：Baileys 为唯一 Web 协议引擎

上游：`WhiskeySockets/Baileys`

言策当前已经依赖 Baileys。第一阶段不更换引擎，而是让实现完整遵守上游生命周期契约，重点对齐：

- auth state 与 Signal key 持久化；
- `creds.update` 原子保存；
- `makeCacheableSignalKeyStore`；
- `sock.ev.process` 事件批处理；
- `messages.upsert` 和 `messaging-history.set`；
- `getMessage` 与消息重试缓存；
- DisconnectReason 分类和恢复；
- history sync、app-state sync 和身份变化；
- 单账号单活动 socket 所有权。

辅助参考：`wppconnect-team/wppconnect-server` 的多 Session、Webhook、媒体和实例管理；Evolution API 仅在完成其附加许可证/品牌条件审查后作为参考，不直接复制进入第一阶段。

明确模式：

```text
WHATSAPP_PERSONAL_WEB     -> Baileys
WHATSAPP_BUSINESS_CLOUD  -> Meta WhatsApp Cloud API
```

同一账号不能同时由两种模式驱动。

## 5.3 Telegram：TDLib Sidecar

上游：`tdlib/td`

目标：逐步把 Telegram 的连接、更新顺序、网络恢复、历史同步、会话数据库和鉴权状态交给官方 TDLib，而不是继续在 Node 侧自行拼装复杂生命周期。

建议边界：

```text
yance-tdlib-host
  ├── JSON request/update protocol
  ├── local named pipe or stdin/stdout
  ├── per-account data directory
  └── process health/readiness

TelegramPlatformAdapter
  ├── canonical command mapping
  ├── canonical event mapping
  ├── fencing identity
  └── outbox result reconciliation
```

现有 Telegram 实现保留为迁移来源和回归对照，不与 TDLib 同时消费同一账号更新。

## 5.4 Facebook/Instagram：官方 Meta API + Chatwoot adapter 参考

商业 Page、Instagram Professional Account 和 Messenger Webhook 采用官方 Meta Graph API；从 Chatwoot OSS channel adapter 吸收：

- webhook 验证与事件映射；
- Page/Instagram 账号绑定；
- access token 生命周期；
- message、delivery、read 和 attachment 处理；
- 联系人和会话归属；
- webhook 去重与重放。

个人 Facebook Messenger 如确有需求，可评估 `mautrix/meta` 作为独立 AGPL Sidecar，但不得与商业 Page/Instagram 模式混为同一状态机，也不得在第一阶段阻塞商业平台稳定化。

## 5.5 模型客户端：Vercel AI SDK

上游：`vercel/ai`

用途：替换言策各 Provider 重复实现的 streaming、tool call、structured output、usage 和响应标准化代码。

言策仍然决定任务语义：翻译、回复、总结、关系分析、风险复核、知识抽取等；AI SDK 只负责类型化请求和响应。

## 5.6 模型路由：LiteLLM Proxy

上游：`BerriAI/litellm`

LiteLLM 作为独立模型网关，负责：

- OpenAI-compatible API；
- Provider 适配；
- 模型别名；
- fallback、timeout 和 retry policy；
- RPM/TPM、预算和健康状态；
- 统一 usage、错误分类和成本数据。

言策 Reply Brain 不直接依赖各 Provider SDK，而通过受控 ModelGatewayPort 调用 LiteLLM 或明确的本地模型适配器。

LiteLLM 的 retry/fallback 不能取代言策 durable task、Outbox 或幂等权威。模型调用成功不等于业务消息允许发送。

## 5.7 Persona、Prompt 和上下文：SillyTavern

上游：`SillyTavern/SillyTavern`

重点复用或重写：

- Prompt Manager；
- Character Card/Persona schema；
- World Info/Lorebook；
- context template；
- token budget；
- chat summary；
- example dialogue；
- provider preset 和 prompt trace 思路。

语义转换：

```text
Character Card       -> Yance Persona Package
World Info           -> 工作区/客户/关系/业务知识
Chat Summary         -> 受版本控制的会话长期摘要
Post-History Prompt  -> 当前行动目标与回复边界
Example Dialogue     -> 经过评价的优质回复示例
```

导入后必须进入言策 canonical schema，经过 validator、compiler、版本发布和内容哈希；SillyTavern 文件不能直接成为运行时事实权威。

## 5.8 长期记忆：Mem0

上游：`mem0ai/mem0`

第一阶段只选 Mem0 作为长期记忆提取和检索实现，不同时引入 Letta 作为第二套记忆权威。

映射：

```text
user_id     -> Yance workspace/user
agent_id    -> Persona version
session_id  -> platform conversation/contact scope
metadata    -> contact/relation/platform/language/time/trust
```

Mem0 生成的是候选记忆。候选必须保留来源消息、证据、可信度、范围和保留策略，由言策 MemoryAuthority 审核后写入 canonical memory tables。

## 5.9 文档知识与 RAG：AnythingLLM + sqlite-vec

上游：`Mintplex-Labs/anything-llm`、`asg017/sqlite-vec`

从 AnythingLLM 吸收：

- 文档摄取；
- 文件解析和清洗；
- chunking；
- embedding pipeline；
- workspace-scoped retrieval；
- source citation；
- provider abstraction。

向量和元数据优先存入言策现有 SQLite，通过 sqlite-vec 提供本地检索，避免第一阶段引入独立向量数据库集群。

建议 canonical tables：

```text
knowledge_documents
knowledge_chunks
knowledge_embeddings
memory_facts
memory_evidence
retrieval_runs
retrieval_results
```

## 5.10 AI 推理流程：LangGraph.js

上游：`langchain-ai/langgraphjs`

职责分离：

- XState 继续负责账号登录、连接、冻结、恢复、任务、租约和发送等确定性生命周期；
- LangGraph.js 只负责 AI 回复推理图。

初始回复图：

```text
normalize input
→ classify intent
→ resolve identity/relation
→ retrieve memory
→ retrieve knowledge
→ assemble prompt
→ generate candidates
→ language/style/safety validation
→ rank/select final draft
→ return draft + trace
```

LangGraph 节点不得直接发送平台消息；最终发送必须回到言策 Outbox/physical boundary。

## 5.11 可观测性和评价：OpenTelemetry、Langfuse、Promptfoo

OpenTelemetry 提供统一 trace/span/metric 语义。

Langfuse 保存：

- 回复 trace；
- Prompt/Persona 版本；
- retrieval 结果；
- 模型、token、成本和延迟；
- 用户修改、接受、拒绝和发送结果；
- 数据集与人工评分。

Promptfoo 用于：

- Prompt 和模型对比；
- 真实历史聊天回归；
- 多语言、风格、事实和关系边界评价；
- RAG 和 Agent 测试；
- 安全与红队检查。

任何 Persona、Prompt、Memory 策略或模型路由升级，必须先通过离线数据集，再进入受控版本发布。

## 5.12 后期训练：LlamaFactory / TRL

模型训练不是第一阶段依赖。只有当言策积累了足量、去隐私化、具备同意和数据来源的高质量反馈样本后，才评估：

- SFT；
- LoRA；
- DPO/偏好优化；
- 专用回复风格模型或 reranker。

训练产物仍通过 ModelGateway 接入，不进入平台适配器或核心数据库权威。

## 6. 集成方式选择规则

每个上游项目必须从以下方式中选择一种，不能模糊混合：

1. **直接依赖**：成熟 Node/TypeScript 库，保持上游包边界，例如 AI SDK、sqlite-vec。
2. **Sidecar**：不同语言、原生运行时或强独立状态，例如 TDLib、LiteLLM。
3. **受控 Fork**：需要长期修改且许可证允许，例如 SillyTavern Prompt/Persona 组件。
4. **逐文件移植**：只需要领域算法或 adapter，必须重写接口并保留来源，例如 Chatwoot channel 行为。
5. **仅参考**：许可证、架构或运行时不适合直接整合，例如第一阶段的 Evolution API 完整服务。

决定方式前必须记录：运行时所有权、数据库所有权、更新成本、故障域、许可证、Windows 支持、测试可移植性和卸载路径。

## 7. 许可证与来源治理

顶层许可证方向：`AGPL-3.0-or-later`，但只有在完成现有仓库和全部第三方代码盘点后才修改根 `LICENSE`。

必须新增并维护：

```text
LICENSE
THIRD_PARTY_NOTICES.md
third_party/provenance.json
third_party/patches/
```

每个整合项记录：

```json
{
  "component": "example",
  "upstreamRepository": "owner/repo",
  "upstreamCommit": "40-character SHA",
  "sourcePaths": ["path/in/upstream"],
  "integrationMode": "dependency|sidecar|fork|port|reference",
  "license": "SPDX identifier",
  "licenseFiles": ["LICENSE"],
  "yancePaths": ["path/in/yance"],
  "modificationSummary": "...",
  "updatePolicy": "pinned|scheduled|manual",
  "securityNotes": "..."
}
```

禁止：

- 复制 Chatwoot `enterprise/`；
- 复制 Langfuse `ee/`；
- 复制上游未授权、无许可证或来源不明代码；
- 删除上游版权和许可证头；
- 只记录项目名称而不记录精确提交和源文件；
- 因项目公开可访问就假设可自由复制。

## 8. 工作包与执行顺序

本设计拆分为独立、可验证的工作包。每个工作包单独设计、计划、实现和审查，不建立一个包含全部项目的大分支。

### OSS-0：来源、许可证与适配边界底座

交付：

- 第三方来源 schema 和验证器；
- `THIRD_PARTY_NOTICES.md` 生成/校验；
- 精确提交、许可证文件和源路径校验；
- dependency/sidecar/fork/port/reference 五种模式合同；
- CI 禁止未登记第三方代码进入仓库；
- 开源集成 ADR 模板。

此工作包必须最先完成，否则后续复制无法审计。

### OSS-1A：WhatsApp/Baileys 生命周期对齐

这是第一项功能稳定化实施，因为言策已经依赖 Baileys，改造成本最低且能最快产生真实收益。

交付：

- 当前实现与固定 Baileys 上游提交的合同差异矩阵；
- auth/key 原子持久化；
- 单活动 socket 所有权；
- disconnect 分类与恢复；
- history sync 和消息重试；
- 重复 inbound/outbound 消除；
- 既有账号数据迁移；
- Windows 真实断网、杀进程、重启和重登矩阵。

### OSS-1B：Telegram/TDLib Sidecar

交付：

- TDLib Windows 构建和固定版本；
- sidecar JSON 协议；
- 账号数据目录和进程所有权；
- canonical message/event mapping；
- 从现有 Telegram session 的迁移策略；
- 历史同步、掉线恢复和重复更新矩阵。

### OSS-1C：Facebook/Instagram 官方 adapter

交付：

- Meta webhook 和 token authority；
- Page/Instagram channel contracts；
- Chatwoot OSS 行为差异矩阵；
- webhook idempotency；
- delivery/read/attachment reconciliation；
- 生产配置、权限和失效恢复测试。

### OSS-2：模型网关

交付：

- ModelGatewayPort；
- AI SDK 请求/响应标准；
- LiteLLM Sidecar；
- OpenRouter 与其他 Provider 映射；
- fallback、timeout、budget 和 health；
- 迟到 AI 结果失效和无副作用合同；
- OpenTelemetry trace。

### OSS-3：Persona 与 Prompt Compiler

交付：

- SillyTavern Persona/Character Card 导入器；
- Yance Persona Package canonical schema；
- Prompt Manager 等价编译能力；
- World Info/Lorebook 到 scoped knowledge 的迁移；
- token budget 和 prompt trace；
- 版本发布、回滚和内容哈希。

### OSS-4：Memory 与 RAG

交付：

- Mem0 candidate adapter；
- MemoryAuthority；
- AnythingLLM 文档摄取能力移植；
- sqlite-vec 检索；
- evidence、scope、retention 和 deletion；
- retrieval trace 和引用。

### OSS-5：回复图、评价与成长闭环

交付：

- LangGraph reply planner；
- 用户修改/接受/拒绝反馈；
- Langfuse 数据集；
- Promptfoo 回归和 promotion gate；
- Persona/Prompt/Memory 策略候选晋升；
- 训练数据资格和隐私政策。

## 9. 第一实施切片

设计 PR 获得批准后，第一份实施计划只覆盖：

```text
OSS-0 来源与许可证底座
+
OSS-1A Baileys 生命周期差异矩阵和第一个底层修复
```

不在第一实施切片中同时启动 TDLib、LiteLLM、Mem0 或 LangGraph。原因：

- Baileys 已经存在，能够最快验证“复用成熟代码而非重写”的路线；
- 来源治理必须先于大规模移植；
- 较小切片能防止当前长分支和大范围变更再次扩大风险；
- WhatsApp 生命周期稳定后形成的 Port、provenance 和故障测试模式，可以复用于 Telegram、Facebook 和模型网关。

## 10. 稳定性与验收标准

每个工作包除自身测试外，必须满足共同门槛：

### 10.1 产品回归

- Electron 可启动；
- 现有工作区和数据库可打开；
- 现有联系人、关系、会话和消息不丢失；
- 未迁移平台仍可按原路径运行；
- AI 回复和手动发送路径不退化。

### 10.2 生命周期故障矩阵

至少验证：

- 连续启动/退出 10 次；
- 运行时强制结束进程；
- 断网和恢复；
- 网络超时；
- 重复 webhook/update；
- 数据库 WAL/SHM 恢复；
- 旧 session/credential 升级；
- 同账号第二实例竞争；
- 模型迟到结果；
- 发送结果不确定；
- Sidecar 崩溃和重启；
- Windows 路径、编码和文件锁。

### 10.3 幂等与副作用

- 一个 canonical inbound message 只能产生一次业务接收结果；
- 一个 OutboxCommand 只能产生一次可确认物理发送；
- 失败恢复不得盲目重发不确定结果；
- 过期 lease/fencing identity 不能写入结果；
- 外部库不能直接更新 canonical ledger 或业务表；
- imported/forked code 不能获取未声明的凭据和数据范围。

### 10.4 可观测性

每次平台事件或 AI 回复至少记录：

- correlation/trace ID；
- workspace/account/conversation scope；
- adapter/upstream version；
- state transition；
- retry/fallback decision；
-最终结果和错误分类；
- 不包含秘密或完整业务内容的诊断摘要。

## 11. 更新与安全策略

- 所有核心第三方依赖固定精确版本或精确提交；
- 不允许自动漂移到上游最新主分支；
- 每次升级先运行上游差异审计、许可证检查和言策故障矩阵；
- Sidecar 使用最小权限、独立数据目录和明确健康协议；
- 第三方代码默认无权访问全部 SQLite、文件系统、凭据或任意网络；
- 上游安全公告必须映射到言策组件清单；
- 发现上游不再维护时，通过 Port/Adapter 更换实现，不修改消费者业务语义。

## 12. 成功定义

本方向成功不是“仓库中出现了更多开源代码”，而是：

1. 言策现有功能保持可用；
2. 三平台连接、同步、恢复和发送问题显著减少；
3. 模型路由不再依赖分散的 Provider 特例；
4. Persona、知识、记忆和回复流程能够被解释、测试和版本化；
5. 用户反馈能够安全地推动回复质量提升；
6. 每项复用都具备精确来源、许可证和更新路径；
7. 没有新的双权威、旁路写入或不可恢复状态；
8. 修复以底层契约和真实故障验证完成，而不是临时绕过。

## 13. 审查决策

批准本设计即代表：

- 开源复用成为言策下一阶段正式开发战略；
- 言策不以闭源商业发行约束阻止 AGPL 等开源整合；
- 第一实施计划从 OSS-0 + OSS-1A 开始；
- 后续工作包按独立 PR、精确上游版本和真实故障矩阵推进；
- 当前 ACV2 长分支不得未经范围重审直接吸收全部开源整合工作。
