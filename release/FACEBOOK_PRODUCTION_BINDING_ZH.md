# Facebook 正式 Cloudflare Worker 发行绑定

本目录中的 `facebook-production-resources/platform-auth.json` 与 `platform-auth.sha256` 是 Windows 正式构建使用的公开发行绑定，不包含任何 Secret 或 Page Access Token。

正式 Worker：

- Base URL：`https://yance-facebook-gateway.wangyi198675.workers.dev`
- Health：`/healthz`
- OAuth callback：`/oauth/facebook/callback`
- Meta Webhook：`/webhooks/facebook`
- Graph API：`v25.0`

Windows Builder 应把这两个文件作为 `--platform-auth-config` 和 `--platform-auth-sha256` 输入。如果最终安装包同时启用 Telegram，构建环境应在私有目录生成包含 Telegram 发行凭据和上述 Facebook URL 的合并 seal；不得把 Telegram API Hash 或任何 Cloudflare/Meta Secret 提交到 Git。

桌面端不会保存或接收 Meta App Secret、Page Access Token、Webhook Verify Token、Token Encryption Key 或 Desktop Auth Master Key。浏览器 OAuth 完成后，Worker 只返回公共主页安全元数据、云账号 ID 与设备注册结果。
