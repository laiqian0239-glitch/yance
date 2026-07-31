# Facebook Cloudflare Worker / D1 / R2 正式契约

本文件取代旧的“OAuth Broker + WebSocket Relay”生产契约。`services/facebook-gateway/` 仅保留为迁移审计和短期回滚参考，不再是正式发布传输层。

## 当前调用链

```text
前端 r32-account-center.js
  → backend/routes/accounts.js
  → facebookOAuthService.js
  → Cloudflare Worker OAuth
  → Page Token 加密留在 Worker/D1

Meta Messenger
  → Worker /webhooks/facebook
  → D1 facebook_webhook_events
  → 每设备 facebook_event_deliveries
  → R2 临时媒体
  → facebookRelayClient.js HTTPS polling
  → facebookAdapter.handleWebhook()
  → canonical identity / messageStore / SQLite
  → 本地关系分析与 AI
```

## OAuth 结果契约

桌面端只可接收：

```json
{
  "cloudAccountId": "fbacct_...",
  "deviceId": "fbdev_...",
  "workerBaseUrl": "https://...workers.dev",
  "page": {
    "id": "PAGE_ID",
    "name": "Page Name",
    "permissions": [],
    "tokenStatus": "active",
    "webhookStatus": "subscribed"
  }
}
```

禁止返回：Page Access Token、App Secret、Relay Token、Relay Secret。

## 事件租约契约

拉取：

```json
{
  "events": [{
    "delivery_id": "fbdel_...",
    "event_id": "fbevt_...",
    "lease_token": "...",
    "lease_expires_at": "UTC ISO",
    "payload": {}
  }],
  "next_cursor": "...",
  "has_more": false
}
```

ACK：

```json
{
  "acknowledgements": [
    { "delivery_id": "fbdel_...", "lease_token": "..." }
  ]
}
```

桌面端只有在 `FacebookAdapter.handleWebhook()` 完成标准消息管线和本地 SQLite 写入后才可 ACK。

## 设备认证

每次请求必须签名：

```text
YANCE-FACEBOOK-DESKTOP-V1
设备 ID
UTC 时间戳
请求 ID
HTTP 方法
Path + Query
Body SHA-256
幂等键
```

算法：Ed25519。Worker 校验时间窗口、正文哈希、公钥、签名、速率和请求 ID 重放。

## 发送白名单

只允许：

```text
text
media(image/video/audio/file)
typing_on
typing_off
mark_seen
```

桌面不能指定任意 Graph API 路径、任意 Page ID 或任意 access_token。

## 数据保留

- ACK 事件：默认 7 天；
- dead-letter：默认 30 天；
- R2 媒体：默认 14 天；
- OAuth state：10 分钟；
- 请求防重放：24 小时；
- 发送幂等：7 天。

Cron 和 R2 生命周期负责清理。
