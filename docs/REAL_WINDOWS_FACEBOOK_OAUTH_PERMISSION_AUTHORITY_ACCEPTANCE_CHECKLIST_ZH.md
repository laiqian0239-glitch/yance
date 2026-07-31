# 真实 Windows 验收清单

## 部署前

- 先部署 Worker 代码并执行 D1 `0006_permission_authority.sql`。
- `/healthz` 必须显示 D1 schema version 6、ready=true。
- 保存迁移前备份；不得上传 Token、Cookie、凭据库或 SQLite 原库。

## OAuth 与凭据替换

1. 记录旧账号 pageId、cloudAccountId、权限检查时间和 Token 指纹（只记指纹）。
2. 发起 OAuth，记录 flow_id。
3. 浏览器回调后，言策必须出现主页选择列表。
4. 缺 `pages_read_engagement` 时主页仍可选择，但文案必须明确“消息可用、历史对账受限”。
5. 选择主页后核对 OAuth state=completed、selected_page_id、D1 token updated_at、设备 account_id/page_id，以及桌面 metadata 的 pageId/cloudAccountId 均为新值。
6. 重连触发实时权限刷新，核对 permission_source、last_permission_check_at 更新；D1、Worker accounts API、桌面账号状态三者一致。

## Business Suite 四场景

1. 新联系人首次发消息：自动创建联系人、会话和首条消息。
2. Business Suite 代表主页回复：言策显示为己方消息。
3. 言策回复：Business Suite 显示，Echo/手动对账后本地不重复。
4. 正常退出并重启：联系人、方向、顺序和完整历史一致。

## 判定

任何一项失败，只重开 Facebook OAuth 权限权威与 Business Suite 对账范围。不得把自动测试或单次界面截图标记为真实 UAT 通过。
