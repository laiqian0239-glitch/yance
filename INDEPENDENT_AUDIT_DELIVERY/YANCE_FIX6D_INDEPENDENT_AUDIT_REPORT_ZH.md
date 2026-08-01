# 言策 Yance Batch40 FIX6D Runtime Authority V1 独立源码 UAT 与底层重构报告

## 1. 结论

输入双包 SHA256 门禁全部精确匹配，允许进入测试。原 FIX6D 自带门禁虽然通过，但独立对抗测试发现 **10 条可稳定复现的 fail-open/权威绕过缺陷**。这些缺陷均已通过公共权威层重构修复，独立 RED→GREEN 为 `0/10 → 10/10`。

修复后 fresh 回归结果：

- 聚焦相关回归：`129/129 PASS`；
- 后端逐文件隔离：`194/194` 文件、`1146/1146 PASS`、`0` 超时；
- Windows 源码交付门禁：`41/41 PASS`；
- WP5：`68/68 PASS`；
- 排版：静态 `2/2 PASS`，Chromium 矩阵 `1/1 PASS`；
- 修改 JavaScript 语法门禁：`11/11 PASS`。

但本环境不是 Windows，且未使用真实 OpenRouter Key、三渠道账号、Sentry 项目或 Replay 录制。因此只能判定“源码层闭环”，不能判定真实 Windows 全量 UAT 或发布。

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

## 2. 输入身份与哈希门禁

| 包 | 期望 SHA256 | 实际 SHA256 | 结果 |
|---|---|---|---|
| `YANCE_BATCH40_FIX6D_RUNTIME_AUTHORITY_V1_SOURCE_HANDOFF_e6f47b3_R1(1).zip` | `f579e47796d977f778251409a6a4926d711861b553d11f61f46c61fc053a91a0` | `f579e47796d977f778251409a6a4926d711861b553d11f61f46c61fc053a91a0` | PASS |
| `YANCE_BATCH40_FIX6D_RUNTIME_AUTHORITY_V1_WINDOWS_SOURCE_UAT_91096c2_R1(1).zip` | `931c6905c88939c1f28b2412644a50de750091d83110f5b6b31de78c13651023` | `931c6905c88939c1f28b2412644a50de750091d83110f5b6b31de78c13651023` | PASS |

声明源码身份：

- Branch：`fix6d-runtime-authority-v1`
- Commit：`91096c2eb1a9e289b1a68b351a326166cf9c379d`
- Tree：`de013fcf1f2547cdc48874976f2a719f9c73f57c`

本交付是独立派生修复包，不伪称上述官方提交，也不生成 MSI/EXE 候选。

## 3. 独立发现与底层修复

| ID | 级别 | RED 复现 | 根因 | 底层修复 |
|---|---|---|---|---|
| `FIX6D-IA-01` | 高 | PASS（修复前失败） | 凭据成功态可在未明确持久提交、未明确运行时确认时被接受 | 凭据收据统一 fail-closed：仅 mutationCommitted=true 且 runtimeConfirmed=true 才允许 ok=true。 |
| `FIX6D-IA-02` | 高 | PASS（修复前失败） | Batch-only 模型对部分已声明任务及未知任务 fail-open | 模型能力权威改为已知交互任务白名单；未知任务和 Batch-only 一律拒绝。 |
| `FIX6D-IA-03` | 高 | PASS（修复前失败） | OpenRouter 双模型可用不同注册表 ID 重复同一规范化 model slug | 候选与成功结果均按规范化 slug 去重，禁止“同模型双 ID”伪独立。 |
| `FIX6D-IA-04` | 高 | PASS（修复前失败） | OpenRouter smoke 可在缺少真实 chat-completions requestId/模式时通过 | 新增真实调用收据校验：requestId、returnedModel、requestMode 必须完整且匹配。 |
| `FIX6D-IA-05` | 高 | PASS（修复前失败） | 正式资格收据可由未完成的形式证据签发 | 签发入口只接受 completed=true 的正式证据；删除公共原始 issue 入口。 |
| `FIX6D-IA-06` | 高 | PASS（修复前失败） | 已签发收据未绑定当前模型基准，基准变更后旧收据仍有效 | 收据绑定当前正式基准摘要、状态、模型、任务与有效期，验证时重新核对。 |
| `FIX6D-IA-07` | 严重 | PASS（修复前失败） | 手工构造外形合法的收据可绕过当前基准权威 | 收据 ID 与证据摘要确定性签名式绑定；伪造、过期、未来签发、基准不一致全部拒绝。 |
| `FIX6D-IA-08` | 高 | PASS（修复前失败） | 模型路由状态权威读取失败时 AI 自动化未隔离 | 将 MODEL_ROUTE_STATUS_UNAVAILABLE 归入 AI 隔离域，停止自动任务但不触发全局安全模式。 |
| `FIX6D-IA-09` | 高 | PASS（修复前失败） | AI Brain 模型选择器未委托统一路由完整性权威 | 模型选择统一调用 modelRoutingIntegrityService，关闭调用方直连绕过。 |
| `FIX6D-IA-10` | 高 | PASS（修复前失败） | 低层安全模式迁移可写入空原因/来源/证据，破坏原子诊断 | 网关与 RuntimeStateStore 统一从耐久命令包派生完整元数据；读取时校验完整性。 |

## 4. 测试矩阵

| 测试层 | 结果 | 证据 |
|---|---:|---|
| 独立对抗 RED | 0/10 PASS，10/10 FAIL | `independent_audit_red.tap` + 10 张复现截图 |
| 独立对抗 GREEN | 10/10 PASS | `independent_audit_green.tap` |
| 聚焦回归 | 129/129 PASS | `focused_regression_green.tap` |
| 后端逐文件隔离 | 194/194 文件；1146/1146 PASS | `backend_per_file_summary.json` + 每文件 TAP |
| Windows 源码交付门禁 | 41/41 PASS | `source_uat_delivery_green.tap` |
| WP5 | 68/68 PASS | `wp5_green.tap` |
| 排版静态 + Chromium | 3/3 PASS | `typography_static_green.tap`、`typography_matrix_green.tap` |
| 修改文件语法 | 11/11 PASS | `modified_js_syntax_check.log` |

一次聚合后端运行在后段发生测试进程挂起，未被计为通过；随后改为每文件独立进程和独立超时，得到上述 194/194 的可定位证据。此处没有跳过文件或放宽断言。

## 5. 七项 UAT 结论

### 1. 凭据写入失败事务状态区分

- 源码：`PASS_AFTER_REPAIR`
- 真实环境：`PENDING`
- 结论：源码权威已区分未提交、已提交但运行时确认失败、完整成功；仍需真实 Windows UI 文案与重启链路。

### 2. OpenRouter 首个模型失效自动切换候选

- 源码：`PASS_AFTER_REPAIR`
- 真实环境：`PENDING_REAL_OPENROUTER`
- 结论：已验证失败后继续候选、规范化 slug 独立性和真实调用收据契约；未取得真实服务 requestId。

### 3. 普通对话禁止调度 Batch-only 模型

- 源码：`PASS_AFTER_REPAIR`
- 真实环境：`PENDING_UI_CONFIRMATION`
- 结论：能力权威对全部已声明交互任务及未知任务 fail-closed；仍需 Windows 路由 UI 观察。

### 4. 翻译/快捷回复无法绕过资格收据

- 源码：`PASS_AFTER_REPAIR`
- 真实环境：`PENDING_REAL_ROLE_ROUTING`
- 结论：收据绑定模型、任务、当前正式基准、证据摘要和期限；conditional/onboarding/手工构造均不能铸造正式资格。

### 5. AI 路由故障不阻断人工消息与账号连接

- 源码：`PASS_AFTER_REPAIR`
- 真实环境：`PENDING_REAL_CHANNELS`
- 结论：AI 路由状态异常进入 AI 独立隔离域且不升级全局安全模式；真实三渠道与账号连接仍待实机。

### 6. 执行中 AI 任务隔离后支持重试且无脏副作用

- 源码：`PASS`
- 真实环境：`PENDING_LIVE_RETRY`
- 结论：恢复重试、晚到结果 fence、任务替换和隔离回归通过；真实执行中断与人工复核仍待 Windows。

### 7. 安全模式触发信息完整原子存储

- 源码：`PASS_AFTER_REPAIR`
- 真实环境：`PENDING_DIAGNOSTIC_EXPORT`
- 结论：operatingMode 与 reasonCode/reasons/enteredAt/trigger/updatedBy/evidenceSha256 同事务落库并读取校验；需 Windows 诊断 JSON 实证。

## 6. WP4 已知上游阻断

`BOOT_SERVER_IMPORT_FAILED`、泛化 Node IPC 静态扫描与 application lifecycle matrix 连锁失败已在本包复现。根据审核指令，该问题是上游固有问题，不作为本轮新增阻断；本修复没有加忽略项、放宽规则或伪造通过。完整日志保存在 `wp4_current.tap`。

## 7. 外部工具与真实链路边界

- StubEngine：已调用，组织列表为 `[]`，未创建 endpoint，未用模拟结果充当真实 OpenRouter 证据。
- Sentry：缺少 `SENTRY_AUTH_TOKEN`、组织和项目，未取得生产错误证据。
- Replay.io：未提供 recordingId，未取得时间旅行录制证据。
- SonarQube：当前会话没有 MCP 工具，CLI/容器不可用。
- Fallow：CLI 不存在，安装被内部 npm registry 404 阻断。
- CodeRabbit：CLI 不存在，官方安装域名 DNS 不可达。

以上均明确标为“未取得证据”，不按通过处理。

## 8. 数据与打包完整性

测试期间包内 SQLite 数据库曾被运行时写入。交付前已恢复为输入包原始字节：`7ea2c4ea67963ca820712d83821cfd3180ff357eff3185406164f8d38427f0f7`。派生源码包不包含该测试污染。

源码差异共 16 个文件：10 个生产文件（含前端凭据收据权威）、5 个既有测试文件更新、1 个新增独立对抗测试。完整差异见 `independent_audit_repair.patch` 与 `changed_files.json`。

## 9. 发布判定

本轮判定：**源码底层重构闭环，真实 Windows/真实服务边界未闭环。**

因此不得将此结果解释为正式发布批准，四项全局门禁维持 `false`。
