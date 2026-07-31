# Facebook 正式 Worker → 言策 Windows 集成

## 正式服务绑定

- Worker：`https://yance-facebook-gateway.wangyi198675.workers.dev`
- 健康检查：`/healthz`
- OAuth 启动：`/oauth/facebook/start`
- OAuth 回调：`/oauth/facebook/callback`
- Meta Webhook：`/webhooks/facebook`
- 桌面事件：`/api/desktop/events`
- 桌面 ACK：`/api/desktop/ack`
- 桌面发送：`/api/desktop/send`

Windows 正式构建必须带入：

- `release/facebook-production-resources/platform-auth.json`
- `release/facebook-production-resources/platform-auth.sha256`

这两个文件只包含公开 Worker 地址与 Graph 版本，不包含 Meta、Cloudflare 或 Page Secret。

## Windows 调用链

1. 账号中心创建 Facebook 账号并点击“在浏览器中登录 Facebook”。
2. Windows 生成 Ed25519 设备密钥对；私钥留在 Windows 安全凭据存储中。
3. 浏览器只打开正式 Worker 的 `/oauth/facebook/start`，携带 flow ID、客户端证明、设备 ID 与设备公钥。
4. Worker 完成 Meta OAuth；Windows 轮询安全主页元数据。
5. 用户选择公共主页；Worker 订阅 Page Webhook、保存加密 Page Token并注册设备。
6. Windows 保存 cloud account ID、Page ID、正式 Worker 地址和设备私钥，不保存 Page Token。
7. Windows 使用签名 HTTPS 请求拉取 D1 中的事件。
8. 事件继续进入现有 `FacebookAdapter → canonical identity → messageStore/SQLite` 管线。
9. 只有本地消息及媒体成功落库后才提交 ACK；失败或崩溃时租约到期后重新投递。

## 安全约束

- OAuth 返回的 Worker URL、设备 ID、Page ID 和 Graph 版本必须与当前 flow/发行绑定一致。
- 旧 Gateway URL 或被替换的 URL 会返回 `FACEBOOK_WORKER_BINDING_MISMATCH`，要求重新授权。
- Meta App Secret、Page Token、Webhook Verify Token、Token Encryption Key、Desktop Auth Master Key 不进入 Windows。
- ACK 统计只以 Worker 实际确认的 `acked` 列表为准，部分 ACK 失败不会被误记为成功。

## 构建

Facebook-only 构建可直接使用仓库中的公开 seal。若最终安装包同时启用 Telegram，应在隔离构建目录生成合并 seal，再传给 Windows Builder：

```powershell
-PlatformAuthConfig C:\secure\resources\platform-auth.json `
-PlatformAuthSha256 C:\secure\resources\platform-auth.sha256 `
-RequirePlatformAuth
```

## 验证

无需 Secret 的健康检查：

```powershell
node tools/facebook/verify-formal-worker.js
```

源码合同回归：

```powershell
npm run verify:facebook-cloudflare
```

真实 Windows UAT 仍需执行一次浏览器 OAuth、主页选择、设备注册、离线消息拉取、本地 SQLite 落库和 ACK；该 UAT 不需要重新配置 Worker Secret。
