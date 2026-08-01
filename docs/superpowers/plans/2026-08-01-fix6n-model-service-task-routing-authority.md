# FIX6N 模型服务任务路由实施计划

1. 冻结 FIX6M 为输入基线。
2. RED：候选翻译、正式门禁、故障域、非重试错误、空回复、429、总预算和冷却重启测试。
3. GREEN：建立 ModelServiceTaskRoutingAuthority 并接管 AiGateway 恢复决策。
4. 将 Provider 错误归一化为明确 recovery policy。
5. 将主备选择限制为独立供应商故障域。
6. 所有 attempts 共享一个执行总预算。
7. 持久化 Retry-After 冷却。
8. 将 translation 纳入 OpenRouter 条件接入路由。
9. 保留候选/生产隔离与取消晚到结果 fencing。
10. 运行完整后端、UI/UAT、源码身份和打包复核。
11. 真实 Windows UAT 完成前保持 readyForPromotion=false。
