# 旧 Facebook WebSocket Gateway（仅迁移/回滚参考）

该目录不是当前正式生产实现。旧架构依赖在线 WebSocket，电脑关闭或连接中断时没有 D1 持久化队列，因此不满足离线消息恢复目标。

正式候选实现位于：

```text
services/facebook-worker/
```

禁止在新发布配置中重新下发 Page Token、Relay Token 或 Relay Secret。旧 Gateway 只可用于短期回滚，并必须明确其离线消息可能丢失的限制。
