# Batch 21 自检阻断项在 Batch 22 的处理结果

- P0-01 `canSend` 双权威：已改为 `canAttemptSend` / `sendVerified` 单一运行权威，并修复旧 SQLite hydration。
- P0-02 `message:inserted` 不刷新：已纳入 SQLite 投影全量重载事件。
- P0-03 登录/扫码过早成功：等待验证保持 RUNNING，后续平台状态完成同一 operation。
- P0-04 ZIP Tree 与 checkpoint 身份不一致：采用 tracked implementation identity + untracked package sidecar + Git bundle 的可验证协议。
- P0-05 ExternalIdentity/OutboxRoute 非实体：Schema 15 已建立实体、约束、事务与 egress 反向验证。
- 能力健康污染：账号级健康仅由 text ACK 更新。
- 旧媒体数组旁路：已删除。
- 身份领域事件补偿：新增持久 `identity_domain_event_outbox` 与重放。
- 测试预言机：新增行为测试；完整 backend 956/956 PASS。

这些是源码与自动门禁处理结果，不代表真实 Windows/平台/OpenRouter 已关闭。
