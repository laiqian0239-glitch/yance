# 言策 Yance Batch40 FIX6D Runtime Authority V1 底层重构报告

## 1. 身份与状态

- 上游源码：`514dc7a45e4891ed96c00a9046702676b9fe6d2c`
- 上游 Tree：`c594b6848c6bf588ec72eba6308eef21090cc5ec`
- 实现分支：`fix6d-runtime-authority-v1`
- 实现提交：`91096c2eb1a9e289b1a68b351a326166cf9c379d`
- 实现 Tree：`de013fcf1f2547cdc48874976f2a719f9c73f57c`
- `windowsUiUat=false`
- `readyForPromotion=false`
- `formalRelease=false`
- `candidatePackageGenerated=false`

本轮只生成 Windows 源码 UAT 包，不生成 MSI/EXE 候选包。

## 2. Windows 诊断确认的根因

1. 凭据写入结果契约丢失底层 `reasonCode`、`mutationCommitted`、`runtimeConfirmed`，导致“已提交但运行时确认失败”被误报为“未保存”。
2. OpenRouter smoke 固定依赖前两个候选；一个模型 HTTP 400 后不会继续尝试第三候选。
3. Batch-only 模型可进入交互聊天候选和 `/chat/completions` smoke。
4. 快速回复、深度回复、导演、翻译的正式资格缺少模型绑定、证据绑定、有效期受控的持久收据。
5. `MODEL_ROUTE_QUALIFICATION_BLOCKED` 被错误升级成全局安全模式，暂停与 AI 路由无关的人工消息、账号连接和更新。
6. 安全模式状态与原因元数据不是同一权威事务，诊断出现 `active=true` 但 `reason/reasons/enteredAt/trigger` 为空。

## 3. 底层重构

### 3.1 凭据变更收据

新增 `r32-credential-mutation-receipt`，主进程和前端统一消费：

- `mutationCommitted`
- `runtimeConfirmed`
- `requestId`
- `reasonCode`
- `message`

凭据已经提交但后端重启确认失败时，界面明确显示“API Key 已安全保存，但运行时应用确认失败”，不再虚构“未写入”。

### 3.2 模型能力权威

新增 `modelCapabilityAuthority`，把模型能力结构化为交互聊天、Batch-only、翻译、视觉等语义。Batch-only 模型从交互路由、聊天 smoke、快速/深度回复、导演和翻译中结构性排除。

### 3.3 OpenRouter 自适应双模型 smoke

候选调用失败后继续尝试后续独立模型，直到获得两个真实成功模型或候选池耗尽。单个过期 slug 或 Provider 400 不再阻断其余可用候选。

### 3.4 正式角色资格收据

新增 `AIRoleQualificationReceiptAuthority`：

- 收据绑定 `modelId + task`；
- 绑定正式基准权威和状态；
- 绑定证据 SHA256；
- 带签发时间和过期时间；
- 翻译只接受 `YanceCommercialModelBenchmark / COMMERCIAL_MODEL_QUALIFIED`；
- 回复角色只接受 `YanceReplyBrainBenchmark / REPLY_BRAIN_QUALIFIED`；
- OpenRouter onboarding smoke、调用方自报 `pass=true`、旧 `allowConditional` 均不能铸造正式资格。

条件试运行只保留给未正式合格的回复模型，并继续强制人工确认。正式合格模型如果缺收据，不会被降级为 conditional 来绕过门禁。翻译不再允许 conditional 绕过。

### 3.5 AI 域隔离

新增 `RuntimeDomainIsolationAuthority`：

- 模型路由资格故障只隔离 AI 自动任务；
- 停止新 AI 自动任务；
- 进行中任务转为可恢复重试 `AI_DOMAIN_ISOLATED`；
- 人工消息、账号连接、非 AI 数据写入和更新不再因单一模型路由故障被全局暂停；
- 发送结果未知、状态权威损坏、账本不一致等系统级问题仍进入全局安全模式。

### 3.6 安全模式原子元数据

`operating_mode` 与 `reasonCode/reasons/enteredAt/trigger/actor/evidenceSha256` 在同一 SQLite 权威事务中提交和读取，避免状态与原因分裂。

## 4. 验证结果

- 新增运行时权威 RED→GREEN：14/14 PASS。
- 合并相关回归：71/71 PASS。
- 后端逐文件隔离回归：194 文件、1146/1146 PASS。
- Windows 源码交付门禁：41/41 PASS。
- WP5 运行状态与安全模式权威：68/68 PASS。
- FIX6D 排版静态与真实 Chromium 防回归：3/3 PASS。

### WP4 既有阻断

完整 `npm run test:wp4` 未通过，且以下失败在未修改的 R2 上游源码同样复现：

- BackendProcessHost 启动：`BOOT_SERVER_IMPORT_FAILED`；
- credential transport 静态扫描把既有 `modelExecutionHost` IPC 识别为泛化 Node IPC；
- application lifecycle matrix 因上述启动失败连锁失败。

`test:wp4:mutations` 在干净提交上运行 15 分钟无输出后被执行窗口终止。上述是上游已有 WP4 工作包阻断，未通过放宽规则或添加忽略项掩盖；因此本轮不能宣称完整凭据工作包门禁通过。

## 5. 外部工具边界

StubEngine 已两次查询组织，均返回空列表 `[]`，因此无法创建模拟 OpenRouter endpoint。没有用模拟结果冒充真实 OpenRouter 证据。

## 6. Windows 复验要求

必须在真实 Windows 重新验证：

1. 一键接入 OpenRouter 后，凭据结果文案能区分“未提交”和“已提交但运行时确认失败”；
2. 一个候选 HTTP 400/404 后继续尝试其他候选并取得两个独立真实成功模型；
3. Batch-only 模型不进入交互路由；
4. 导演主备、翻译主备必须各有正式资格收据；
5. 单一 AI 路由故障只显示 AI 域隔离，人工消息和账号连接保持可用；
6. 系统级故障仍能进入全局安全模式，诊断中原因、时间和证据完整；
7. 100%/125%/150% 下既有 UI 排版防回归。
