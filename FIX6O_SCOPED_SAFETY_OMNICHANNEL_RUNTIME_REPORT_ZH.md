# 言策 FIX6O：分级安全与多账号驱动权威修复报告

## 结论

FIX6O 将原先单一全局安全模式拆分为系统、平台、账号和能力四级故障作用域。单个账号登录失效、单个平台同步异常、单项发送结果不确定或 AI 路由异常，不再自动暂停全部平台和整个应用。全局安全模式只允许由共享数据库、迁移、凭据库、恢复、构建完整性和启动循环等共享基础设施故障触发。

本轮同时把 Facebook 公共主页、官方个人身份和个人 Messenger 实验能力拆成独立驱动合同。公共主页继续走正式 Worker/Page 接入；个人身份使用官方 Facebook Login，仅取得身份与头像；个人 Messenger 仍为非官方实验能力，浏览器桥未完成真实验收前禁止创建不可用账号。

## 根因

旧实现把账号、平台、发送、AI、后台任务和共享数据库故障统一投影到 `runtime_state.operating_mode=safeMode`。因此一个账号重新授权失败即可暂停其他正常账号、同步、发送和 AI 自动任务。恢复界面又以一个全局布尔值呈现，无法解释具体影响范围，也缺少可信的退出收据。

## 底层重构

### ScopedSafetyAuthority

- 全局 reason code 采用明确白名单；未知故障不能升级为系统安全模式。
- 账号问题投影为 `reauth-required` 或 `quarantined`。
- 平台问题投影为 `degraded`。
- 单项问题投影为 capability pause。
- `scoped_safety_events` 使用数据库触发器禁止更新和删除。
- 自动清除需要连续两次健康观察；人工清除需要健康探测收据。

### Safe-mode exit receipt

- 删除 `force=true` 退出路径。
- 退出前重新执行共享基础设施评估。
- 账号、平台和能力问题作为 scoped issue 返回，但不阻止退出全局安全模式。
- 只有不存在系统级 blocker 时才签发 60 秒、一次性退出收据。
- Electron API v2 消费该收据后才能把 operating mode 从 safeMode 改回 normal。

### Facebook 驱动分离

- `facebook-page-official`：官方公共主页消息驱动。
- `facebook-personal-identity-official`：官方个人身份登录，仅身份和头像，`messagingSupported=false`。
- `facebook-personal-messenger-experimental`：非官方隔离浏览器会话合同，显式风险披露，当前 onboarding 不开放。

### Facebook Worker OAuth v6

- `mode=page` 保留 Business Login Configuration、Page 枚举、订阅和消息能力。
- `mode=identity` 使用官方 Facebook Login，仅请求 `public_profile`。
- 个人身份 Access Token 不返回 Windows，也不写入 D1 长期存储。
- 桌面端只保存 user id、显示名、头像和 SHA-256 身份收据。
- 从 Page 账号切换到身份模式时清除 Page、Worker、设备私钥等旧凭据字段。

## 数据迁移

SQLite Schema 20 新增：

- `scoped_safety_issues`
- `scoped_safety_events`
- `platform_driver_profiles`

并保留此前全部 Schema 1–19 迁移、表、触发器和收据。

## 开源架构参考

- Home Assistant：integration/config entry、reauth、repair、system health 和最小故障范围。
- Chatwoot：Page/Inbox/Contact/Conversation/Message 领域边界。
- Activepieces：类型化连接器、独立认证和动作合同。
- Meta 官方 Messenger Platform/Facebook Login：主页消息与个人身份能力分离。

本轮没有把 Chatwoot、Home Assistant 或非官方 Facebook 客户端源码直接复制进言策。

## 自动验证边界

源码与自动测试能够证明分级状态机、数据库约束、退出收据、驱动选择、OAuth 合同和界面契约。它们不能证明真实 Meta、WhatsApp、Telegram 或 Windows Electron 环境已通过。

```text
realWindowsUat=false
realWhatsAppUat=false
realTelegramUat=false
realFacebookPageUat=false
realFacebookPersonalIdentityUat=false
realFacebookPersonalMessengerUat=false
productionFacebookWorkerV6DeploymentVerified=false
readyForPromotion=false
formalRelease=false
```

个人 Messenger 浏览器桥尚未完成，当前版本不会向普通用户提供一个看似可登录但实际不可用的入口。
