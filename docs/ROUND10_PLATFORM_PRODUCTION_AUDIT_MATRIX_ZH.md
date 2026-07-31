# 言策 Round 10 三平台生产链审查矩阵

| 编号 | 平台/领域 | 自动源码状态 | 当前权威证据 | 真实Windows要求 | 最终状态 |
|---|---|---|---|---|---|
| R10-FB-01 | Facebook授权与发送 | 已接线 | credential/canSend | 真实Page发送 | 待UAT |
| R10-FB-02 | Webhook与Worker接收 | 已接线 | canReceive/subscription/relay | 新联系人首条消息 | 待UAT |
| R10-FB-03 | Business Suite Echo | 已接线 | direction/isEcho/peerId/newConversation | 后台真实发送且只写一条 | 待UAT |
| R10-FB-04 | 历史与会话补偿 | 已接线 | historySyncAvailable/reason | 真实最近会话补拉 | 待UAT |
| R10-FB-05 | 定期对账 | 已接线 | reconciliationLastResult/cursor | 等待真实周期结果 | 待UAT |
| R10-WA-01 | 认证与基础收发 | 已接线 | credential/canSend/canReceive | 真实文本收发 | 待UAT |
| R10-WA-02 | LID/手机号JID合并 | 已接线 | identityReconciliationLastResult | 真实联系人无重复会话 | 待UAT |
| R10-WA-03 | 媒体能力 | 回归通过 | 现有媒体恢复与去重测试 | 图片/语音/GIF/贴纸/附件 | 待UAT |
| R10-WA-04 | 离线与重连幂等 | 源码已有 | 队列与receipt回归 | 断网发送、重连只发送一次 | 待UAT |
| R10-TG-01 | 未配置状态语义 | 已修复 | onboarding/not-configured | 未登录不污染全局健康 | 待UAT |
| R10-TG-02 | 二维码/验证码登录 | 源码已有 | QR challenge与登录状态 | 真实登录 | 待UAT |
| R10-TG-03 | 历史与头像 | 已接线 | historySyncLastResult | 真实历史和头像 | 待UAT |
| R10-TG-04 | 媒体 | 源码已有 | 平台能力矩阵 | 图片/语音/贴纸 | 待UAT |
| R10-SYS-01 | 三平台权威状态 | 已完成 | platform-readiness API | 与真实操作结果一致 | 待UAT |
| R10-SYS-02 | 安全证据导出 | 已完成 | 哈希身份/秘密扫描/Manifest | 导出Windows证据ZIP | 待UAT |
| R10-SYS-03 | Windows安装候选 | 已完成 | SHA256/恢复点/依赖门禁 | 本机启动及Build回读 | 待UAT |

关闭任何“待UAT”项目时，必须同时提供实际运行Build、平台侧操作、言策界面结果和安全诊断证据。只有自动测试不得标记真实平台通过。
