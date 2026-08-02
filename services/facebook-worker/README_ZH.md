# 言策 Facebook Cloudflare 离线网关

本目录是言策 Facebook 公共主页接入与官方个人身份登录的云端候选实现。它不是独立 Webhook Demo，而是现有 Windows `FacebookAdapter` 的云端传输层：

```text
Meta Messenger
  → HTTPS Webhook
Cloudflare Worker
  → D1 事件与设备投递队列
  → R2 临时媒体
言策 Windows HTTPS 拉取
  → FacebookAdapter.handleWebhook()
  → canonical identity / 联系人合并 / 会话去重 / SQLite
  → 本地 Persona Brain、关系分析与 AI 回复
```

## 边界

Worker 只负责：

- Meta Webhook 验签、去重和快速入队；
- OAuth 模式隔离：公共主页授权与官方个人身份登录；
- 公共主页枚举、Webhook 订阅；
- Page Access Token 加密保管；
- 设备认证、租约、ACK、断点续传；
- 受限的发送、历史和资料读取；
- R2 媒体临时保存、失败重试与到期清理。

官方个人身份模式只返回 `id/name/picture` 的安全身份收据，不返回用户 Access Token，也不提供个人 Messenger 私信能力。

Worker **不会**执行 Persona Brain、关系分析或 AI 回复，也不会把 Page Access Token 下发到 Windows。可选固定“已收到”回复未启用，默认不会在云端自动回复客户。

## 目录

- `src/`：Worker 完整源码。
- `migrations/`：D1 可重复执行迁移。
- `tests/`：Webhook、OAuth、加密、设备认证、租约/ACK、幂等、R2 和桌面契约测试。
- `.dev.vars.example`：仅包含占位符的本地开发示例。
- `DEPLOY_CLOUDFLARE_ZH.md`：部署步骤。
- `META_CONSOLE_SETUP_ZH.md`：Meta 控制台配置。
- `MIGRATION_ROLLBACK_ZH.md`：旧 WebSocket Gateway 切换和回滚。

## 本地测试

```powershell
cd services\facebook-worker
npm test
```

当前测试不需要真实秘密或外网；D1/R2 使用内存测试替身。真实 Cloudflare `workerd`、真实 D1/R2、真实 Meta App/Page 和真实 Windows 安装后验证必须在部署阶段另行执行，不能由这些测试替代。

## 本地 Worker 开发

安装 Wrangler 后：

```powershell
Copy-Item .dev.vars.example .dev.vars
# 只在本机编辑 .dev.vars；禁止提交
npx wrangler d1 migrations apply yance-facebook-gateway --local
npx wrangler dev --local
```

`.dev.vars`、`.env`、Cloudflare API Token、Meta App Secret、Verify Token、Page Token 和加密主密钥均被禁止提交。

## 固定接口

Meta：

```text
GET  /webhooks/facebook
POST /webhooks/facebook
GET  /oauth/facebook/start
GET  /oauth/facebook/callback
```

桌面端：

```text
GET  /api/desktop/events
POST /api/desktop/ack
POST /api/desktop/send
GET  /api/desktop/accounts
POST /api/desktop/disconnect
GET  /api/desktop/health
GET  /api/desktop/history
GET  /api/desktop/history/messages
GET  /api/desktop/profile
GET  /api/desktop/media/:eventId/:index
```

桌面接口使用 Ed25519 设备签名、UTC 时间窗口、请求 ID、防重放正文哈希和发送幂等键，不使用永久静态 Bearer Token。


## Facebook 账号类型边界

```text
page      → Business Login Configuration → Page 枚举/订阅/消息
identity  → 官方 Facebook Login          → id/name/picture，仅身份
```

`mode=identity` 不请求 Page 权限、不枚举 Page、不保存用户 Access Token；桌面端只得到脱敏身份字段。个人 Messenger 不是官方 Facebook Login 能力，不得由此 Worker 冒充支持。
