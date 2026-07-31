# Facebook 公共主页 Page Token 定向恢复（OAuth contract v5）

## 真实 UAT 证据

生产 OAuth 已确认：

- `/me/accounts` 返回 `0`；
- `debug_token.granular_scopes.target_ids` 返回已选择主页 `1203748086150141`；
- `/{debug_token.user_id}/accounts` 仍返回 `0`；
- 旧的富字段主页探针返回 Meta 错误 `100`；
- 用户确实在 Meta Business Login 界面选择了主页。

这说明资产选择证据存在，但 Meta 的 accounts edges 没有返回 Page Access Token。

## v5 恢复顺序

1. 优先调用 `GET /me/accounts`，请求官方标准的主页列表和 Page Access Token。
2. 若为空，读取 `debug_token`，只保留必要权限的 `granular_scopes.target_ids`。
3. 尝试 `GET /{debug_token.user_id}/accounts`，并按 target IDs 过滤。
4. 若仍为空，仅对已授权 target ID执行最小字段请求：
   - 首先 `GET /{page-id}?fields=id,access_token`；
   - Meta 错误 100 时退化为 `GET /{page-id}?fields=access_token`。
5. 取得 Page Token 后，改用 Page Token读取 `id,name,username,picture`；资料读取失败不会丢弃已经取得的 Page Token。
6. 所有 Token 只在 Worker 内使用并加密写入 D1，不返回 Windows，也不写入安全诊断。

## 诚实边界

- v5 是针对真实 Meta 空 accounts edge 的定向恢复候选，必须在生产重新授权验证。
- 不重新加入旧式 `scope` 参数。
- `pages_read_engagement` 仍是历史同步可选能力，不阻塞新消息收发。
- 不重建 App、Worker、D1 或 R2，不读取、修改或打印 Worker Secret。
