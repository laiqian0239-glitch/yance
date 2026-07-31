# 言策 Round 10 三平台生产链与真实Windows证据闭环报告

## 定位

Round 10 以 Round 9 AI任务权威源码为唯一基线，处理三平台生产链长期存在的共同根因：后台具备消息适配代码，但系统中心无法回答每个平台究竟卡在授权、发送、接收、历史、身份合并还是需要真实UAT；真实平台证据也没有统一、安全的导出入口。

本轮已生成真实Windows UAT候选，但不是正式发布版。自动测试不能替代真实Facebook、WhatsApp和Telegram账号操作。

## 一、三平台生产就绪权威

新增 `PlatformProductionReadinessAuthority`，以账号运行状态和适配器真实证据统一判断：

- `ready`：自动运行门禁通过，且没有待补偿项；
- `ready-for-real-uat`：源码与自动门禁通过，但仍需要真实平台操作证据；
- `degraded`：基础消息链可用，但历史、身份或同步能力降级；
- `blocked`：已配置账号的发送或接收核心链被阻断；
- `onboarding`：账号仍在登录、验证码、扫码或配置阶段；
- `not-configured`：该平台未配置，不影响其他平台或全局健康。

系统中心和 `/api/r32/system/platform-readiness` 读取同一权威结果。

## 二、Facebook生产链

已补充并验证：

- 首条未知联系人消息原子创建联系人、会话和消息；
- Business Suite外部发送Echo按对方PSID归属，并保存为自己的消息；
- Echo与本地发送使用同一Meta消息ID时只保留一条SQLite记录；
- `facebook:webhook-message-persisted` 证据包含方向、Echo、新会话和消息来源；
- 定期对账记录最近结果、游标、会话数、消息数和失败数；
- 缺少可选历史权限时只降级Business Suite历史补偿，不错误关闭实时消息；
- Webhook/Worker接收链缺失时明确判定核心接收阻断。

仍需在真实Windows中验证新联系人首条消息、Business Suite外部发送及真实Page历史对账。

## 三、WhatsApp生产链

已补充并验证：

- LID、手机号JID和旧账号数据的身份对账结果进入运行状态；
- 对账记录扫描、合并、失败、孤儿账号修复和完成时间；
- 身份对账失败与消息连接状态分开显示，避免“账号连接成功”掩盖重复会话风险；
- 既有媒体恢复、语音、GIF、贴纸、Echo去重和孤儿账号回归继续通过。

仍需真实账号验证LID/手机号JID合并、断网重连、无文字附件和媒体收发。

## 四、Telegram生产链

已补充并验证：

- 历史同步记录运行中、最近时间、错误和结果；
- 部分会话或消息失败时只标记历史同步降级，不关闭基础收发；
- 二维码、验证码等未完成登录状态属于onboarding，不判全局严重故障；
- 历史消息按时间顺序导入、未读恢复和首条消息头像逻辑继续通过。

仍需真实Windows验证二维码/验证码登录、认证恢复、头像、历史和媒体。

## 五、安全证据导出

新增：

```text
npm run export:platform-production-evidence -- --base-url http://127.0.0.1:27632 --output <目录>
```

导出内容包括运行Build、Manifest哈希、三平台生产门禁、降级点和待真实UAT项。账号、联系人等标识使用SHA256，不导出Token、Cookie、密码、二维码、数据库或会话密钥。

## 六、Windows UAT候选

Round 10新增单一安装入口与独立证据入口：

- `INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.cmd`
- `COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.cmd`

安装器会校验源码ZIP、选择最大现有数据库、创建逐文件SHA256恢复点、校验完整依赖并启动源码UAT。证据工具在言策运行期间导出安全ZIP到下载目录。

## 自动验证

- 顶层后端完整回归：721/721 PASS；
- 三平台生产就绪专项：53/53 PASS；
- WhatsApp专项：63/63 PASS；
- Round 10安装与证据模板：3/3 PASS；
- 主题颜色审计：PASS，固定颜色债务0。

## 边界

本轮证明生产链源码、状态权威和Windows证据工具已闭合，但下列内容仍不能标记通过：

- 真实Facebook新联系人、Echo和对账；
- 真实WhatsApp身份合并、媒体与断网重连；
- 真实Telegram登录、历史与媒体；
- OpenRouter商业模型、Kurt AI全链、29套主题、136套音效和8–12小时压力。

因此Round 10是可安装的真实Windows UAT候选，不是正式发布候选。
