# 言策 Yance Batch41 FIX6M 开源架构参考闭环报告

## 1. 目标与边界

FIX6M 针对言策长期反复出现的多权威分裂问题进行公共层重构，重点覆盖：三平台登录与会话状态、联系人/头像/历史消息、媒体与动态贴纸、延迟等待、消息回执、联系人关系投影、AI 回复证据和 AI 学习收据。

本轮参考成熟开源项目的**架构模式**，没有复制其业务源码，也没有引入新的服务器运行时：

- Chatwoot：联系人—收件箱—会话—消息的领域边界；
- Temporal：持久任务、执行历史、心跳、取消、重试和代际 fencing；
- Dify：Provider、模型目录、连接验证、候选、资格和生产路由分离；
- Langfuse：Trace、Span、Generation 和 Receipt 的统一执行证据；
- Activepieces：类型化渠道插件与凭据边界；
- AnythingLLM/Open WebUI：本地优先桌面运行和本地/云模型目录分层；
- Mem0：记忆版本和检索收据思想，但不替代言策人工审核治理。

所有新权威先以**影子模式**运行，尚未切换生产读取路径。真实 WhatsApp、Telegram、Facebook 公共主页账号及真实 Windows 环境仍需独立 UAT。

## 2. 新增公共权威

### 2.1 EvidenceAuthority

新增持久化 `EvidenceAuthority`，把一次用户动作统一表示为 Trace，并按顺序追加 Observation。证据支持 `routeTestId` 兼容别名、`executionId`、`providerRequestId`、路由/资格/发送/学习收据 ID；禁止保存聊天正文、提示词、API Key 和凭据。

### 2.2 DurableExecutionAuthority

新增 `DurableExecutionAuthority`，任务状态固定为：

```text
CREATED → SCHEDULED → RUNNING / WAITING_REMOTE
→ RETRY_SCHEDULED / CANCEL_REQUESTED
→ SUCCEEDED / FAILED / CANCELLED / DEAD_LETTERED
```

每次状态变化写入追加式执行历史；worker claim 带 generation 和 owner，陈旧 worker 不得提交结果。登录恢复、历史同步、媒体下载、消息发送与回执核对应逐步迁移到该权威。

### 2.3 CommunicationAuthority

新增不含平台分支的 `CommunicationAuthority`：

- `communication_canonical_messages`：原始引用、规范内容和渲染投影分离；
- `communication_media_assets`：头像、图片、GIF、动态贴纸和附件的显式生命周期；
- `communication_delivery_attempts`：每次发送独立 attempt；
- `communication_delivery_receipts`：平台 acceptance/delivered/read/failure 追加式收据；
- `communication_sync_checkpoints`：历史回填和实时流的断点、high-watermark 与 gap 状态。

不支持的消息类型必须投影为 `unsupported`，不能退化为空白消息气泡。平台回执单调收敛，晚到失败不得覆盖已确认 delivered/read。

### 2.4 三平台类型化 Adapter

新增统一 Channel Adapter 契约，WhatsApp、Telegram、Facebook 公共主页均必须暴露：认证、会话恢复、账号身份、联系人/会话/消息回填、事件订阅、事件规范化、头像/媒体读取、发送、回执查询和断开。

Adapter 只负责协议转换，不得自行决定联系人合并、业务重试、AI 是否发送、关系阶段或学习激活。

### 2.5 ContactRelationshipAuthority

新增 `ContactRelationshipAuthority`：

- 相同显示名不会跨平台自动合并；
- 外部身份必须通过明确证据和人工确认绑定到稳定 contact；
- 规范消息绑定到 contact 后，关系断言必须引用同一 contact 的真实消息 ID；
- 关系断言保留算法版本、置信度、审核动作和撤销历史；
- AI 上下文使用版本化快照，只保存 ID/结构化事实，不复制消息正文到证据日志。

### 2.6 AIReplyLearningAuthority

新增 `AIReplyLearningAuthority`。只有候选模式生成、人工审核、非紧急、真实平台成功发送后的回复才能创建 pending 学习收据。生命周期为：

```text
pending → approved → shadow → active
                    ↘ rejected / revoked / rollback
```

只有 active 版本可被检索，并为每次检索生成收据。入站消息、未审核候选、发送失败和紧急回复不得直接激活学习。

### 2.7 ArchitectureShadowGate 与统一诊断

新增追加式影子比较记录和 `ArchitectureShadowGate`。只有每个目标权威达到最小样本、验收窗口内 mismatch 为 0，才允许提出读取路径切换；样本不足本身即阻断。

系统诊断新增 FIX6M 真值：停滞任务、死信、媒体失败、同步缺口、不确定发送、待审核关系、待审核学习、影子不一致。局部 UI 全绿不能覆盖这些 warning/fail。

## 3. 数据库迁移

数据库 Schema 从 18 升级到 19。迁移新增证据、持久任务、通信、联系人关系、学习和影子比较表，并保留此前 Batch27/28/39/40 与 FIX6J/K/L 的全部迁移收据和一致性检查。关键事件/收据/快照表均有 UPDATE/DELETE 阻断触发器。

## 4. 已完成验证

- FIX6M 聚焦红—绿测试：证据、持久执行、候选链、通信、三平台契约、媒体/回执、联系人关系、学习和诊断；
- 后端逐文件全量门禁；
- UI/UAT 诊断门禁；
- Schema 19 重开、旧迁移不降级、未来 Schema fail-fast；
- 派生源码身份、源码包 CRC、重复条目和路径安全校验将在最终打包阶段重新执行。

## 5. 未完成与禁止误报

本轮没有执行：

- 真实 WhatsApp 扫码登录和重启恢复；
- 真实 Telegram 登录、联系人/历史回填和原生贴纸收发；
- 真实 Facebook 公共主页 OAuth、页面选择、Webhook/Relay 和回执；
- 真实平台头像、GIF、动态贴纸、语音和附件端到端；
- 真实 Windows 多进程、断网、休眠、DPI 和长时间运行；
- OpenRouter 正式专项评估；
- 生产读取路径切换。

因此 FIX6M 当前只代表公共架构和影子门禁源码闭环，不代表三平台业务已通过真实环境验收。

## 6. 发布状态

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

只有真实 Windows 三平台 UAT、影子样本窗口零不一致、平台回执与 AI/学习闭环证据全部完成后，才可讨论生产切换。
