# 言策 f25fe2e｜Batch 22 根因公共层闭环修复报告

## 1. 治理结论

Batch 22 从已反向验证的 Batch 21 PackageTree `feffa17382ce18a54e5349a95800f342fc46d59b` 导入隔离 Git 仓库继续修复，没有回退旧源码，没有删除账号、重新扫码、清空真实数据，也没有以提示文案或单页 CSS 规避。

当前状态保持：

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
```

实现身份：

- Branch: `development/windows-uat-f25fe2e-repair-batch22-root-authority-closure`
- ImplementationCommit: `012685f2f89b4668f8f1ab0d60387506794ed28b`
- ImplementationTree: `4aef90a1d14ca89fa603e4b21aa8faf8e3486576`

真实 Windows Electron、真实 WhatsApp/Facebook/Telegram ACK、真实 OpenRouter 2/2、真实重启持久化和独立审核尚未执行，因此 RC-01～RC-08 均不得标记为最终 CLOSED。

## 2. 本轮关闭的 Batch 21 自检遗漏

### RC-01 状态权威

- Store 投影、AccountManager、AI Outbox 和发送门禁统一读取 `canAttemptSend`；
- `canSend` 仅保留为真实 ACK 的兼容别名；
- connected/online 不能推导 verified；
- 未取得 ACK 不会误取消仍可生成的 AI 候选；
- 修复旧 SQLite `can_send=true` 账号在重启 hydration 后丢失 `canAttemptSend/sendVerified` 的升级兼容问题。

### RC-02 完整身份与路由契约

新增 Schema 15：

- `external_identities`
- `outbox_routes`
- `identity_domain_event_outbox`

并将 PlatformAccount、ExternalIdentity、IdentityLink、ConversationBinding、Message、OutboxRoute 和 SendQueue 通过外键、触发器与事务连接。入站身份/消息以及出站路由/队列任一步失败均整体回滚。

### RC-03 SQLite 权威 hydration

`message:inserted`、`message:updated`、`message:translation-updated` 和媒体恢复事件只使 SQLite 投影失效并触发重载，不再直接修改前端历史数组。旧 `applyMediaLifecycleEvent()` 旁路已删除。

### RC-04 完整认证工作流生命周期

QR、验证码、OAuth/登录等待状态保持 `RUNNING`；后续平台账号事件、失败、取消或 supersede 回写同一持久 operation。direct handler 不再绕过统一生命周期，旧代次不能覆盖新代次。

### RC-05 能力级 ACK 健康

text、emoji-only、media 分别记账。emoji-only 失败不会把账号级 text 健康改为 blocked；账号级健康只受 `message.text.send` 的真实 ACK 影响。

### RC-08 测试预言机

新增行为测试覆盖 SQLite 迁移与重启、事务回滚、认证状态机、消息刷新协调器、能力级健康、持久补偿和身份/路由全链。旧正则预言机已改为验证 SQLite reload 语义。

## 3. 自动验证

- 完整后端：162 个测试文件，956/956 PASS；
- Batch 21+22 根因：18/18 PASS；
- Round 12 平台核心：79/79 PASS；
- Round 13 AI 质量：24/24 PASS；
- 平台生产就绪：58/58 PASS；
- UAT Diagnostics：142/142 PASS；
- Source UAT Delivery：33/33 PASS；
- 组件可读性：6/6 PASS；
- Final Review：34/34 PASS；
- JavaScript 语法：45/45 PASS；
- `git diff --check`：PASS。

完整后端采用逐文件隔离串行执行：每个文件使用独立 Node test 进程、`--test-concurrency=1` 和单文件超时，162 份日志均有 SHA256。单次多文件 Node runner 在本环境固定文件边界不能退出，相关尝试没有被登记为 PASS；等价隔离门禁的汇总 SHA256 为 `b6e2326d0ea8a3b134898ccc0f8f3d080f16c78b16f4984c6e5af76994def214`。

## 4. 制品身份修复

Tracked Descriptor/Checkpoint 不再把 ImplementationTree 冒充 PackageTree，也不在受控 Tree 内写入会改变自身 Tree 的 PackageTree。

源码 ZIP 必须额外包含未被 Git 跟踪的 `YANCE_PACKAGE_IDENTITY.json`：

1. sidecar 声明实际 PackageCommit/PackageTree；
2. ZIP 除 sidecar 外的全部条目必须反向重建出该 PackageTree；
3. 交接包必须包含可恢复该 PackageCommit 的 Git bundle；
4. Delivery Receipt、Package Verification 和 SHA256SUMS 同时绑定 sidecar、源码 ZIP 与 bundle。

## 5. 仍未关闭的真实门禁

- clean `npm ci` 未在本环境重新执行；
- 真实 Windows Electron 启动、DPI 100/125/150、29 套主题和全页面裁切证据；
- 真实 Facebook text/emoji/media、WhatsApp、Telegram ACK 矩阵；
- 实时入站、历史、Echo、SQLite、UI 和重启一致性；
- 真实 OpenRouter Key 与两个不同模型 2/2 回执；
- 真实 ACK 后学习、重启后学习生效；
- 独立审核。

任何一项未通过时必须保持 `WINDOWS_UAT_BLOCKED`。
