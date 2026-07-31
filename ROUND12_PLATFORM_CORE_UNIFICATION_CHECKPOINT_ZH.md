# 言策 Round 12｜剩余多平台核心架构闭环检查点

> 文档性质：源码与自动化闭环检查点。真实 Windows、真实三平台和现有真实数据库投影差异仍需后续 UAT 证据。

## 源码身份

- Branch：`architecture/system-round12-13-remaining-closure-20260727`
- Implementation Commit：`ad75c51c44ad980bca21e02c1ac8818c56036903`
- Implementation Tree：`23eb54576e519faa5201511e4c74919b1ee06eff`
- Parent：`e447d62b1b78196cf5e8fe8dec81534b868ffba3`
- Tag：`architecture-round12-round13-remaining-closure-implementation-20260727`

## 本次关闭范围

### Adapter 四端口迁移

Facebook、WhatsApp、Telegram 的正式认证、登录状态变更、运行时恢复、同步及 Facebook 资料补偿入口均通过 `AuthPort` 或 `ReconcilePort` 调度。发送队列继续只通过 `EgressPort` 执行冻结 OutboxCommand，Ingress 只产生归一化领域事件。

源码扫描门禁禁止 `accountContext.js` 和 `platformAdapterPorts.js` 之外的生产代码直接调用旧账号认证与对账方法。运行时网络恢复也只调用 AuthPort。

### 事件日志权威切换

新的对方入站消息执行：

`脱敏 domain_event 先写 → 稳定消息投影 → SQLite 消息事务 → 提交后哈希校验 → applied receipt`

若事件投影与正式消息投影不一致，会写入阻断收据并拒绝声明收敛。启动时 `DomainEventProjectionAuthority` 审查现有 `message.received` 事件，输出 applied、missing、mismatch 和 convergence。

这里完成的是源码权威切换和差异门禁。现有真实 Windows 数据库能否达到 `blocking=0`，必须在真实数据环境验收，不能由合成测试代替。

### Schema 12

新增 `012_round12_round13_remaining_closure`：

- `learning_preference_profiles` 支持 `pending-approval`；
- `learning_promotion_audit` 支持 `pending-human-approval`；
- 两个历史 Schema 键统一为 12；
- 迁移回执、校验和、外键和重开一致性均为强门禁；
- 任一历史键超前或损坏均阻断旧二进制打开。

## 自动化结果

- Round 12：`46/46 PASS`
- 全部后端：`144/144` 测试文件、`867/867 PASS`
- 最终综合专项：`34/34 PASS`
- 源码 UAT 交付：`33/33 PASS`
- UAT 诊断：`112/112 PASS`
- Windows 包契约：`7/7 PASS`
- 主题审计：PASS，固定颜色债务 0

## 当前边界

源码层已关闭“旧认证/对账旁路”和“事件仍只做影子双写”两项缺口。尚未宣称真实 Facebook、WhatsApp、Telegram 操作通过，也未宣称现有真实数据库投影差异归零。
