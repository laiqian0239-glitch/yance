# Cloudflare 部署文档

## 0. 前提

需要一个 Cloudflare 账号，但不要求购买 VPS。目标资源：

- Worker：`yance-facebook-gateway`
- D1：`yance-facebook-gateway`
- R2：`yance-facebook-media`
- 固定地址：`https://yance-facebook-gateway.wangyi198675.workers.dev`

Cloudflare 官方更建议业务关键 Worker 使用自定义域名；本项目按产品约束保留固定 `workers.dev`，同时把地址作为发行密封配置，便于未来迁移。

## 1. 登录 Wrangler

```powershell
npx wrangler login
```

不要把 Cloudflare API Token 写进仓库、脚本或 `.dev.vars`。

## 2. 创建 D1 和 R2

```powershell
npx wrangler d1 create yance-facebook-gateway
npx wrangler r2 bucket create yance-facebook-media
```

将 D1 命令返回的 `database_id` 写入本地 `wrangler.jsonc` 的占位符位置。提交正式源码前，不要写入账户级秘密；D1 database ID 不是访问密钥，但仍建议通过部署分支管理。

## 3. 写入 Worker Secrets

逐项执行，交互输入真实值：

```powershell
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put DESKTOP_AUTH_MASTER_KEY
```

建议：

- `META_VERIFY_TOKEN`：至少 32 个随机字节；
- `TOKEN_ENCRYPTION_KEY`：32 字节 Base64，或密钥轮换 JSON；
- `DESKTOP_AUTH_MASTER_KEY`：至少 32 个随机字节；
- 不使用 `vars` 保存秘密。

密钥轮换格式：

```json
{
  "active": "k2",
  "keys": {
    "k1": "BASE64_OLD_32_BYTE_KEY",
    "k2": "BASE64_NEW_32_BYTE_KEY"
  }
}
```

保留旧密钥直至所有 Token 完成重加密，之后再移除。


## 3.1 企业版 Facebook 登录非秘密配置

`wrangler.jsonc` 必须保留以下非秘密变量，名称与 Worker 代码完全一致：

```json
{
  "META_BUSINESS_LOGIN_CONFIG_ID": "4234889550142986",
  "WORKER_BASE_URL": "https://yance-facebook-gateway.wangyi198675.workers.dev"
}
```

授权入口只能由 Worker 生成，并使用 `config_id`。Windows 不得自行拼接 Meta OAuth URL，也不得读取 App Secret 或 Page Token。

## 4. 执行 D1 迁移

先本地：

```powershell
npx wrangler d1 migrations apply yance-facebook-gateway --local
```

再远端：

```powershell
npx wrangler d1 migrations apply yance-facebook-gateway --remote
```

迁移使用 `IF NOT EXISTS`，可重复执行。

## 5. R2 生命周期

Worker 每天按 D1 `expires_at` 主动清理 R2。还应在 R2 桶增加兜底生命周期：

- 前缀 `facebook/incoming/`：建议 21 天删除；
- 前缀 `facebook/outgoing/`：建议 1 天删除。

兜底时间应略长于 Worker 的默认 14 天媒体保留期，避免时钟或 Cron 故障造成无限保存。

## 6. 部署

```powershell
npx wrangler deploy
```

记录部署输出的固定地址：

```text
https://yance-facebook-gateway.wangyi198675.workers.dev
```

随后设置非秘密变量 `WORKER_BASE_URL` 为该完整地址，可在 `wrangler.jsonc` 的 `vars` 增加：

```json
"WORKER_BASE_URL": "https://yance-facebook-gateway.wangyi198675.workers.dev"
```

重新部署后，OAuth 回调地址必须固定为：

```text
https://yance-facebook-gateway.wangyi198675.workers.dev/oauth/facebook/callback
```

部署前必须同时确认 Meta 控制台：

- 应用域名包含 `yance-facebook-gateway.wangyi198675.workers.dev`（若控制台要求父域则使用 `wangyi198675.workers.dev`）；
- Valid OAuth Redirect URIs 与上述回调逐字符一致；
- Business Login Configuration 只请求 `pages_show_list`、`pages_messaging`、`pages_manage_metadata`；
- `pages_read_engagement` 不得出现在登录范围内，只作为授权后的历史同步可选能力。

Webhook 地址：

```text
https://yance-facebook-gateway.wangyi198675.workers.dev/webhooks/facebook
```

## 7. 健康检查

公开健康页只返回服务和时间，不返回账号或 Token：

```powershell
Invoke-RestMethod https://yance-facebook-gateway.wangyi198675.workers.dev/healthz
```

设备级 `/api/desktop/health` 必须由言策签名调用。

## 8. 发行密封配置

Windows 构建资源只需要：

```json
{
  "facebook": {
    "workerBaseUrl": "https://yance-facebook-gateway.wangyi198675.workers.dev",
    "graphVersion": "v25.0"
  }
}
```

其中 Windows 只保存固定 Worker URL 和 Graph 版本。`META_APP_ID` 与 App Secret、Verify Token、Page Token、Cloudflare Token、加密密钥均只存在 Cloudflare Worker Secrets，绝不能进入 Windows 安装包。

## 9. 观察和故障

- Worker 日志只记录请求 ID、稳定错误码和 HTTP 状态，不记录 Token 或完整消息正文。
- D1 超限或写入失败时 Webhook 返回失败，让 Meta 重试；不能吞掉异常后返回伪成功。
- R2 或 Meta 媒体读取出现短暂故障时，媒体保持 `pending` 并由 Cron 按退避策略重试；达到最大次数或确认不可恢复后才标记失败并保留消息占位。
- Cron 使用 UTC，每日清理时间由 `wrangler.jsonc` 的 `17 3 * * *` 控制。
