# Facebook 公共主页真实 OAuth UAT 修复清单

## 已确认的失败表现

1. Meta 页面显示 `Invalid Scopes: pages_read_engagement`；
2. Meta 页面显示“无法加载网址，URL 的域名未包含应用的网域”；
3. 言策账号保持 `unconfigured / credential-missing`；
4. 浏览器失败后桌面端持续轮询授权状态。

## Meta 控制台必须修正

### 应用域名

```text
yance-facebook-gateway.wangyi198675.workers.dev
```

若控制台只接受可注册父域：

```text
wangyi198675.workers.dev
```

### Valid OAuth Redirect URIs

```text
https://yance-facebook-gateway.wangyi198675.workers.dev/oauth/facebook/callback
```

### Business Login Configuration 权限

仅保留：

```text
pages_show_list
pages_messaging
pages_manage_metadata
```

移除：

```text
pages_read_engagement
```

`pages_read_engagement` 只影响历史会话同步，不阻断新消息收发。若原 Configuration 无法编辑，在同一个 App 中创建新 Configuration，再更新 `META_BUSINESS_LOGIN_CONFIG_ID`。

## 重新部署现有 Worker

在源码目录执行：

```powershell
Set-Location 'D:\Yance_SOURCE_UAT_5455146\services\facebook-worker'
npx wrangler login
npx wrangler d1 list --json
```

把真实 D1 ID 写入 `wrangler.jsonc` 的 `database_id`，并将新的 Business Login Configuration ID 写入 `META_BUSINESS_LOGIN_CONFIG_ID`。不要打印或修改任何 Secret，然后执行：

```powershell
npx wrangler deploy
```

部署后验证：

```powershell
Set-Location 'D:\Yance_SOURCE_UAT_5455146'
node '.\tools\facebook\verify-formal-worker.js'
```

必须返回 OAuth contract version `2`、`legacyScopeParameter=false` 和精确 callback URL 后，言策才允许再次打开授权页面。
