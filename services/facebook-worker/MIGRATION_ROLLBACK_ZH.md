# 从旧 WebSocket Gateway 迁移到 Cloudflare Worker

## 旧链路

```text
Meta Webhook → Node Gateway 内存 → WSS Relay → 在线 Windows
```

问题：Windows 关闭或 WSS 断开时没有持久化队列，消息可能丢失；Page Token、Relay Token 和 Relay Secret 曾保存在桌面凭据。

## 新链路

```text
Meta Webhook → Worker 验签 → D1 去重/投递 → R2 临时媒体
Windows 上线 → HTTPS 设备签名拉取 → 本地 SQLite 成功 → ACK
```

Page Token 只在 Worker 中以 AES-256-GCM 密文保存。

## 切换步骤

1. 冻结旧正式版本和旧 Gateway 配置，生成回滚备份。
2. 部署 Worker、D1、R2，执行 migrations 和 Secrets 配置。
3. 使用 Meta 测试 App/Page 验证 Webhook、OAuth、发送、离线积压和媒体。
4. 构建绑定固定 Worker URL 的 Windows 候选版本。
5. 用户升级后对 Facebook 账号执行一次重新授权。旧本机 Page Token不允许自动上传到 Worker。
6. 验证本机联系人、会话、canonical identity、SQLite 和本地 AI/关系分析仍走原管线。
7. 关闭 Windows 数小时/数天后发送测试消息，再上线验证按 D1 队列恢复。
8. 新链路稳定后，停止旧 WebSocket Gateway 的生产入口。

## 多设备

同一 Page 可绑定多台言策设备：

- Webhook 原始事件只保存一次；
- 每台设备有独立 `facebook_event_deliveries`；
- 每台设备独立 lease/ACK；
- 一台设备普通退出只禁用该设备，不撤销 Page Token或影响其他设备；
- 只有显式“断开整个云端账号”才撤销云账号并尝试退订 Meta Webhook。

## 回滚

1. 停止向新 Windows 版本发布。
2. 保留 Worker/D1/R2，不删除未 ACK 事件。
3. 将客户端回退到旧安装包；本地 SQLite 数据保持不变。
4. 必要时临时恢复旧 Gateway，但必须明确：旧链路不保证电脑离线时消息不丢失。
5. 修复 Worker/桌面契约后重新部署；新客户端可继续拉取未 ACK 事件。

## 回滚禁止事项

- 不把 Worker 中的 Page Token导出到 Windows；
- 不删除 D1 未 ACK 或 dead-letter 事件来制造“队列清零”；
- 不把旧 Round 1/2 结果用于证明新 Commit 通过；
- 不在回滚期间同时让两个入口对同一事件产生两套本地消息而不依赖 `message.mid` 去重。
