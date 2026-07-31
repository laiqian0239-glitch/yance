# 言策 Round 11 全项目功能资产清单

> 本清单由 Round 11 实施提交 `8fab2cf6f394ffc953fc45d0a6ef34d0a2c622c8` 的源码自动扫描生成。资产存在只代表“发现源码证据”，不代表已经接入正式生产入口、通过真实 Windows 或真实平台验收。

## 总览

- 扫描源码文件：1362
- 发现功能资产：1158
- 前端工作区：5
- 导航入口：8
- 可交互控件：244
- 后端 API 路由：254
- 运行命令：35
- SQLite 表：68
- AI任务引用：13
- 测试文件：505

## 十二个审查领域

| 领域 | 源码资产 | 测试文件 | 文档 | 当前证据级别 |
|---|---:|---:|---:|---|
| 安装、启动与运行身份 | 183 | 122 | 10 | 源码证据，Windows/平台待逐项绑定 |
| Facebook完整链路 | 41 | 22 | 8 | 源码证据，Windows/平台待逐项绑定 |
| WhatsApp完整链路 | 24 | 19 | 3 | 源码证据，Windows/平台待逐项绑定 |
| Telegram完整链路 | 9 | 2 | 0 | 源码证据，Windows/平台待逐项绑定 |
| 消息与会话工作台 | 156 | 28 | 3 | 源码证据，Windows/平台待逐项绑定 |
| 翻译与中文工作层 | 104 | 10 | 1 | 源码证据，Windows/平台待逐项绑定 |
| AI回复大脑 | 370 | 48 | 4 | 源码证据，Windows/平台待逐项绑定 |
| 客户档案、关系与记忆 | 171 | 33 | 1 | 源码证据，Windows/平台待逐项绑定 |
| 界面、布局与主题 | 316 | 66 | 10 | 源码证据，Windows/平台待逐项绑定 |
| 音效与通知 | 12 | 10 | 0 | 源码证据，Windows/平台待逐项绑定 |
| 数据、迁移、备份与恢复 | 251 | 24 | 0 | 源码证据，Windows/平台待逐项绑定 |
| 诊断、性能与商业门禁 | 121 | 41 | 5 | 源码证据，Windows/平台待逐项绑定 |

## 关闭规则

每项功能必须后续补充：正式生产入口、权威数据源、下游读取、失败路径、自动测试、真实Windows证据、真实平台证据和实际运行Build。未补齐前不得标记为“已完成并真实验证”。

## 领域资产索引

### 安装、启动与运行身份

- api-route: 12
- ai-task-reference: 55
- sqlite-table: 15
- runtime-command: 35
- control: 49
- package-script: 17

- `/:id/runtime` · api-route · `backend/routes/accounts.js`
- `/bootstrap-status` · api-route · `backend/routes/personaBrain.js`
- `/release-identity` · api-route · `backend/routes/system.js`
- `/runtime` · api-route · `backend/routes/system.js`
- `/update-preflight` · api-route · `backend/routes/system.js`
- `/runtime/recover` · api-route · `backend/routes/system.js`
- `/runtime-settings` · api-route · `backend/routes/system.js`
- `/runtime-settings` · api-route · `backend/routes/system.js`
- `/desktop/notify-test` · api-route · `backend/routes/system.js`
- `/bootstrap` · api-route · `backend/routes/workspace.js`
- `translation` · ai-task-reference · `backend/runtime/AppRuntime.js`
- `director` · ai-task-reference · `backend/runtime/RuntimePathIdentity.js`
- `runtime_fencing_counter` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `runtime_lease` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `runtime_state` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `runtime_transition_log` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `boot_attempt` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `credential_hydration_state` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `outbox_event` · sqlite-table · `backend/runtime/RuntimeStateStore.js`
- `command_idempotency` · sqlite-table · `backend/runtime/RuntimeStateStore.js`

### Facebook完整链路

- sqlite-table: 3
- api-route: 21
- ai-task-reference: 10
- package-script: 7

- `r32_meta` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `/:id/facebook/oauth/start` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/oauth/status` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/oauth/select-page` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/oauth/cancel` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/avatar-closure/diagnose` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/avatar-import/session` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/avatar-import/session` · api-route · `backend/routes/accounts.js`
- `/:id/facebook/avatar-import/session/stop` · api-route · `backend/routes/accounts.js`
- `/facebook/webhook` · api-route · `backend/routes/accounts.js`
- `/facebook/webhook` · api-route · `backend/routes/accounts.js`
- `/status` · api-route · `backend/routes/facebookAvatarImportBridge.js`
- `/preview` · api-route · `backend/routes/facebookAvatarImportBridge.js`
- `/import` · api-route · `backend/routes/facebookAvatarImportBridge.js`
- `translation` · ai-task-reference · `backend/services/facebookAdapter.js`
- `summary` · ai-task-reference · `backend/services/facebookAdapter.js`
- `summary` · ai-task-reference · `backend/services/facebookBusinessSuiteAvatarImportService.js`
- `translation` · ai-task-reference · `backend/tests/facebookAvatarClosureDiagnostic.test.js`
- `summary` · ai-task-reference · `backend/tests/facebookAvatarClosureDiagnostic.test.js`
- `summary` · ai-task-reference · `backend/tests/facebookBusinessSuiteAvatarImport.test.js`

### WhatsApp完整链路

- api-route: 5
- ai-task-reference: 6
- sqlite-table: 5
- control: 1
- package-script: 7

- `/whatsapp/status` · api-route · `backend/routes/messages.js`
- `/whatsapp/:accountId/start` · api-route · `backend/routes/messages.js`
- `/whatsapp/:accountId/restart` · api-route · `backend/routes/messages.js`
- `/whatsapp/:accountId/stop` · api-route · `backend/routes/messages.js`
- `/:profileId/validate` · api-route · `backend/routes/personaBrain.js`
- `director` · ai-task-reference · `backend/services/whatsappAdapter.js`
- `director` · ai-task-reference · `backend/services/whatsappAuthResolver.js`
- `identity_aliases` · sqlite-table · `backend/services/whatsappConversationMergeService.js`
- `identity_merge_audit` · sqlite-table · `backend/services/whatsappConversationMergeService.js`
- `whatsapp_identity_authority` · sqlite-table · `backend/services/whatsappIdentityAuthority.js`
- `director` · ai-task-reference · `backend/services/whatsappIdentityAuthority.js`
- `director` · ai-task-reference · `backend/tests/aiReplyBrainWhatsAppClosure.test.js`
- `whatsapp_merge_collision` · sqlite-table · `backend/tests/sourceUatRound5ConversationIdentityRegression.test.js`
- `summary` · ai-task-reference · `backend/tests/whatsappCanonicalUiReferenceClosure.test.js`
- `director` · ai-task-reference · `backend/tests/whatsappMediaRecoveryClosure.test.js`
- `whatsapp_account_rebind_collision` · sqlite-table · `backend/tests/whatsappOrphanAccountReconciliation.test.js`
- `aiwPersonaValidate` · control · `frontend/js/r32-ai-workbench-runtime.js`
- `verify:wp6:evidence` · package-script · `package.json`
- `test:human-typing` · package-script · `package.json`
- `test:dating-fast-reply` · package-script · `package.json`

### Telegram完整链路

- api-route: 5
- control: 3
- package-script: 1

- `/:id/telegram/qr/start` · api-route · `backend/routes/accounts.js`
- `/:id/telegram/phone/start` · api-route · `backend/routes/accounts.js`
- `/:id/telegram/cancel` · api-route · `backend/routes/accounts.js`
- `/:id/telegram/code` · api-route · `backend/routes/accounts.js`
- `/:id/telegram/password` · api-route · `backend/routes/accounts.js`
- `ac32TelegramCode` · control · `frontend/r32-account-center.js`
- `ac32TelegramPassword` · control · `frontend/r32-account-center.js`
- `ac32TelegramPhone` · control · `frontend/r32-account-center.js`
- `test:platform-production-readiness` · package-script · `package.json`

### 消息与会话工作台

- sqlite-table: 22
- ai-task-reference: 11
- api-route: 73
- runtime-command: 11
- navigation: 2
- workspace: 1
- control: 31
- package-script: 5

- `contacts` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_conversations` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_messages` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_reply_outbox` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `sync_message_receipts` · sqlite-table · `backend/migrations/stage6_3_4ArchitectureClosure.js`
- `translation` · ai-task-reference · `backend/repositories/messageRepository.js`
- `/:id/bind-conversation` · api-route · `backend/routes/accounts.js`
- `/media/:messageId/analysis` · api-route · `backend/routes/conversationCapabilities.js`
- `/media/:messageId/analyze` · api-route · `backend/routes/conversationCapabilities.js`
- `/media/analyze-stream` · api-route · `backend/routes/conversationCapabilities.js`
- `/capabilities` · api-route · `backend/routes/messages.js`
- `/conversations` · api-route · `backend/routes/messages.js`
- `/conversations/:id/messages/stream` · api-route · `backend/routes/messages.js`
- `/conversations/:id/messages` · api-route · `backend/routes/messages.js`
- `/expressions/recent` · api-route · `backend/routes/messages.js`
- `/expressions/send` · api-route · `backend/routes/messages.js`
- `/search` · api-route · `backend/routes/messages.js`
- `/conversations/:id/read` · api-route · `backend/routes/messages.js`
- `/send-queue` · api-route · `backend/routes/messages.js`
- `/send-queue/:id/retry` · api-route · `backend/routes/messages.js`

### 翻译与中文工作层

- ai-task-reference: 91
- api-route: 11
- control: 1
- package-script: 1

- `translation` · ai-task-reference · `backend/lib/r32SqliteStore.js`
- `translation` · ai-task-reference · `backend/migrations/legacySqliteMigrator.js`
- `translation` · ai-task-reference · `backend/repositories/messageRepository.js`
- `translation` · ai-task-reference · `backend/repositories/replyFeedbackRepository.js`
- `translation` · ai-task-reference · `backend/repositories/workspaceRepository.js`
- `translation` · ai-task-reference · `backend/routes/models.js`
- `/translations/chinese` · api-route · `backend/routes/store.js`
- `/translations/messages/:messageId` · api-route · `backend/routes/store.js`
- `/translations/messages/:messageId/jobs` · api-route · `backend/routes/store.js`
- `/translations/jobs/:jobId` · api-route · `backend/routes/store.js`
- `/translations/jobs/:jobId` · api-route · `backend/routes/store.js`
- `/translations/jobs/:jobId/retry` · api-route · `backend/routes/store.js`
- `/translations/jobs` · api-route · `backend/routes/store.js`
- `/customers/:contactId/language` · api-route · `backend/routes/store.js`
- `/customers/:contactId/language` · api-route · `backend/routes/store.js`
- `/translations/structured` · api-route · `backend/routes/store.js`
- `translation` · ai-task-reference · `backend/routes/store.js`
- `/conversations/:sessionKey/outbound-language` · api-route · `backend/routes/workspace.js`
- `translation` · ai-task-reference · `backend/runtime/AppRuntime.js`
- `translation` · ai-task-reference · `backend/server.js`

### AI回复大脑

- sqlite-table: 41
- ai-task-reference: 230
- api-route: 57
- runtime-command: 4
- control: 33
- package-script: 5

- `ai_reply_candidates` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `director` · ai-task-reference · `backend/migrations/legacySqliteMigrator.js`
- `director` · ai-task-reference · `backend/persona/defaultPersonaProfile.js`
- `director` · ai-task-reference · `backend/persona/presets/yeonhee-kim-v1.json`
- `summary` · ai-task-reference · `backend/persona/presets/yeonhee-kim-v1.json`
- `persona_brain_profiles` · sqlite-table · `backend/personaBrain/schema.js`
- `persona_brain_versions` · sqlite-table · `backend/personaBrain/schema.js`
- `persona_brain_change_log` · sqlite-table · `backend/personaBrain/schema.js`
- `persona_brain_pending_changes` · sqlite-table · `backend/personaBrain/schema.js`
- `persona_brain_scope_bindings` · sqlite-table · `backend/personaBrain/schema.js`
- `persona_brain_migration_runs` · sqlite-table · `backend/personaBrain/schema.js`
- `director` · ai-task-reference · `backend/repositories/replyFeedbackRepository.js`
- `/status` · api-route · `backend/routes/models.js`
- `/audit` · api-route · `backend/routes/models.js`
- `/:id/lifecycle` · api-route · `backend/routes/models.js`
- `/cloud` · api-route · `backend/routes/models.js`
- `/cloud/discover` · api-route · `backend/routes/models.js`
- `/cloud/openrouter/auto-configure` · api-route · `backend/routes/models.js`
- `/cloud/openrouter/commercial-benchmark` · api-route · `backend/routes/models.js`
- `/cloud/openrouter/commercial-benchmark/cancel` · api-route · `backend/routes/models.js`

### 客户档案、关系与记忆

- sqlite-table: 22
- ai-task-reference: 45
- api-route: 38
- runtime-command: 2
- navigation: 3
- workspace: 3
- control: 30
- package-script: 28

- `customer_profiles` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_profile_evidence` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `relationship_insights` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `relationship_state_signals` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `relationship_timeline_events` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_social_state` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_interaction_preferences` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_reply_feedback_profiles` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_reply_feedback_profile_versions` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `fact_extraction` · ai-task-reference · `backend/migrations/legacySqliteMigrator.js`
- `director` · ai-task-reference · `backend/persona/defaultPersonaProfile.js`
- `persona_brain_profiles` · sqlite-table · `backend/personaBrain/schema.js`
- `/profiles` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/current` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/validate` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/export` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/import` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/signature-status` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/versions` · api-route · `backend/routes/personaBrain.js`
- `/:profileId/versions/:version` · api-route · `backend/routes/personaBrain.js`

### 界面、布局与主题

- ai-task-reference: 7
- api-route: 34
- runtime-command: 7
- navigation: 8
- workspace: 5
- control: 244
- package-script: 11

- `translation` · ai-task-reference · `backend/repositories/workspaceRepository.js`
- `summary` · ai-task-reference · `backend/repositories/workspaceRepository.js`
- `/ui/theme/preview` · api-route · `backend/routes/store.js`
- `/ui/theme/cancel-preview` · api-route · `backend/routes/store.js`
- `/ui/theme/apply` · api-route · `backend/routes/store.js`
- `/ui/theme/preferences` · api-route · `backend/routes/store.js`
- `/ui/theme/presets` · api-route · `backend/routes/store.js`
- `/ui/theme/presets/:presetId/apply` · api-route · `backend/routes/store.js`
- `/ui/theme/presets/:presetId` · api-route · `backend/routes/store.js`
- `/bootstrap` · api-route · `backend/routes/workspace.js`
- `/conversations/:sessionKey/outbound-language` · api-route · `backend/routes/workspace.js`
- `/contacts` · api-route · `backend/routes/workspace.js`
- `/contacts/:contactId/context` · api-route · `backend/routes/workspace.js`
- `/contacts/:contactId/customer-association` · api-route · `backend/routes/workspace.js`
- `/contacts/:contactId/customer-association` · api-route · `backend/routes/workspace.js`
- `/conversations/:sessionKey/export` · api-route · `backend/routes/workspace.js`
- `/conversations/:sessionKey/context` · api-route · `backend/routes/workspace.js`
- `/conversations/:sessionKey/archive` · api-route · `backend/routes/workspace.js`
- `/conversations/:sessionKey/pin` · api-route · `backend/routes/workspace.js`
- `/conversations/:sessionKey/analyze` · api-route · `backend/routes/workspace.js`

### 音效与通知

- api-route: 5
- ai-task-reference: 1
- control: 3
- package-script: 3

- `/:platform/:accountId/presence` · api-route · `backend/routes/messages.js`
- `/notifications` · api-route · `backend/routes/system.js`
- `/notifications` · api-route · `backend/routes/system.js`
- `/notifications/sounds` · api-route · `backend/routes/system.js`
- `/notifications/sounds/:id` · api-route · `backend/routes/system.js`
- `director` · ai-task-reference · `backend/services/customNotificationSoundService.js`
- `testNotificationBtn` · control · `frontend/index.html`
- `testSoundBtn` · control · `frontend/index.html`
- `sc32SoundUpload` · control · `frontend/r32-system-center.js`
- `test:sound-notification` · package-script · `package.json`
- `verify:m2` · package-script · `package.json`
- `test:notification-sound-authority` · package-script · `package.json`

### 数据、迁移、备份与恢复

- sqlite-table: 108
- ai-task-reference: 41
- api-route: 54
- runtime-command: 35
- control: 11
- package-script: 2

- `r32_meta` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_accounts` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `contacts` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_profiles` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_profile_evidence` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `relationship_insights` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_analysis_runs` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_conversations` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_messages` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_settings` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `r32_migration_runs` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `relationship_state_signals` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `relationship_timeline_events` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_social_state` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `customer_interaction_preferences` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `interaction_policies` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_context_snapshots` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `social_inference_corrections` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_reply_tasks` · sqlite-table · `backend/lib/r32SqliteStore.js`
- `ai_reply_candidates` · sqlite-table · `backend/lib/r32SqliteStore.js`

### 诊断、性能与商业门禁

- sqlite-table: 8
- ai-task-reference: 48
- api-route: 14
- control: 9
- package-script: 42

- `identity_merge_audit` · sqlite-table · `backend/migrations/stage6_3_4ArchitectureClosure.js`
- `integrity_issue_aggregates` · sqlite-table · `backend/migrations/stage6_3_4ArchitectureClosure.js`
- `director` · ai-task-reference · `backend/persona/defaultPersonaProfile.js`
- `/audit` · api-route · `backend/routes/accounts.js`
- `/:id/default` · api-route · `backend/routes/accounts.js`
- `/audit` · api-route · `backend/routes/models.js`
- `/:profileId/initialize-default` · api-route · `backend/routes/personaBrain.js`
- `/customers/:contactId/learning-governance` · api-route · `backend/routes/store.js`
- `/customers/:contactId/learning-governance/:scopeType/preferences/:key` · api-route · `backend/routes/store.js`
- `/customers/:contactId/learning-governance/:scopeType/restore` · api-route · `backend/routes/store.js`
- `/customers/:contactId/learning-governance/forget` · api-route · `backend/routes/store.js`
- `/health` · api-route · `backend/routes/system.js`
- `/diagnostics` · api-route · `backend/routes/system.js`
- `/diagnostics/export` · api-route · `backend/routes/system.js`
- `/api/health` · api-route · `backend/server.js`
- `/api/wp4/credential-persist-probe` · api-route · `backend/server.js`
- `translation` · ai-task-reference · `backend/services/diagnosticReadiness.js`
- `fact_extraction` · ai-task-reference · `backend/services/diagnosticReadiness.js`
- `memory_extraction` · ai-task-reference · `backend/services/diagnosticReadiness.js`
- `quick_reply` · ai-task-reference · `backend/services/diagnosticReadiness.js`
