# Facebook Legacy Gateway 退休记录

> 状态：**RETIRED**  
> 退休日期：2026-09-28

旧的 Yance 自研 `services/facebook-gateway/`（OAuth Broker / WebSocket Relay）已经从仓库删除，不再是发布、回滚或运行时 authority。

## 当前成熟 authority

```text
Facebook Page
  → Chatwoot Facebook Page 官方集成
  → facebookChatwootMatrixBridge（薄接线）
  → Synapse / Matrix
  → Element timeline / RoomAvatar

Facebook Personal Messenger
  → mautrix-meta
  → Synapse / Matrix
  → Element
```

Yance 不再为 Facebook Page 自建 Gateway、WebSocket Relay、头像代理、历史镜像或第二套消息 owner。

## 禁止恢复

以下做法不得因为旧测试、旧文档或兼容需求重新引入：

- `services/facebook-gateway/`；
- 自研 Page OAuth Broker / WebSocket Relay；
- 自研 Facebook Page 头像 owner / proxy / cache；
- 自研 Page 历史数据库或 timeline；
- 以“兼容”为由重新增加与 Chatwoot / Matrix / Element 平行的 owner。

历史治理文件、旧实施报告可以继续作为审计证据存在，但不得成为当前运行时依赖。

## 后续退休边界

仓库内仍存在的旧 `facebookAdapter`、`facebookRelayClient`、Worker desktop/media/webhook 与 identity-only OAuth 路径属于独立退休批次。只有在对应调用面、测试和运行时依赖完成切除并验证后，才可宣称这些路径全部退休；不得通过新增 Yance 自研替代系统来完成切换。
