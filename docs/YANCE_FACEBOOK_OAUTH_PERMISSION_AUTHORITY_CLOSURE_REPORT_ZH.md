# 言策 Facebook OAuth 权限权威闭环报告

日期：2026-07-22

## 范围

仅修改 Facebook OAuth 回调、主页选择、D1 权限/Token 持久化、桌面凭据替换、实时权限刷新及状态提示。WhatsApp、Telegram、主题、头像与其他已冻结 Facebook 能力未修改。

## 输入权威

- AuthorityCommit：`9d7de80fac68ed679e61202a6b8a60a0129bd53c`
- 私人源码 ZIP SHA-256：`6cb38a209f5b27c5e61ac8c76f30975bc7a95a6aa52a31905b9cd2c7ef78c7e2`
- 头像修复报告结论：Worker、D1 migration 与真实运行数据必须共同闭环，不能把 UI 状态直接当作 Meta 实时授权结果。
- Git Bundle 验证通过并包含完整历史；本交付分支直接以 `9d7de80fac68ed679e61202a6b8a60a0129bd53c` 为 Parent。

## 审计结论

1. OAuth callback 已调用 `/me/permissions`，但同一用户权限快照被复制给所有主页候选，且缺少探针时间和来源。
2. D1 `facebook_accounts` 只有 `permissions_json`，缺少 granted/missing、历史同步判定、原因、最后检查时间与来源字段。
3. Worker 允许缺少 `pages_read_engagement` 时选择主页，桌面端却在选择前和选择后各阻断一次，导致新 Page Token、设备绑定和本地凭据均无法替换。
4. 桌面连接时可被旧 credential/metadata 权限覆盖；没有连接时实时等价探针。
5. UI 将可选历史权限与必要消息权限合并为同一个禁用条件，导致 OAuth 成功后没有可完成的主页选择入口。

## 修复

- 新增 D1 migration `0006_permission_authority.sql`。
- 候选与账号持久化增加：`granted_scopes`、`missing_permissions`、`history_sync_available`、`history_sync_reason`、`last_permission_check_at`、`permission_source`。
- 主页选择原子更新 Page Token、权限权威、设备绑定和 OAuth completed 状态。
- 必要消息权限仍阻断；仅缺 `pages_read_engagement` 时允许完成绑定并明确进入受限模式。
- 新增签名的 `/api/desktop/permissions/refresh`：Worker 用保管的 Page Token 调用 Meta `debug_token` 等价权限探针，刷新 D1 后桌面再读取账号状态。
- 桌面优先采用 Worker 的 `grantedScopes` 与历史同步权威字段，不再用旧 metadata 覆盖新状态。
- UI 允许选择受限主页，并把“消息可用、历史对账受限”与“必要权限缺失”分开显示。
- `/healthz` D1 schema 权威升级为 version 6，迁移不完整时不得报告 ready。

## 自动验证

- Facebook Worker：62/62 PASS
- Facebook OAuth/Business Suite/账号投影定向回归：49/49 PASS
- 相关 JavaScript syntax：PASS
- Git whitespace：PASS

自动验证不等于真实 Windows、生产 Worker/D1 migration 或 Meta 实际授权通过。

## UAT 状态

`SOURCE_TARGETED_REGRESSION=PASS`

`WINDOWS_RENDER_PASS=PENDING`

`PRODUCTION_D1_MIGRATION_PASS=PENDING`

`META_LIVE_PERMISSION_PROBE_PASS=PENDING`

`PAGE_SELECTION_CREDENTIAL_REPLACEMENT_PASS=PENDING`

`BUSINESS_SUITE_REAL_E2E_PASS=PENDING`

`USER_CONFIRMED_REAL_WINDOWS_PASS=PENDING`

`FORMAL_RELEASE_PASS=PENDING`
