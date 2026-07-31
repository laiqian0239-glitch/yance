# Batch39 重建关闭报告

## 结论

Batch39 八项源码修复已从已验证的 Batch38 基线重新实施。原临时工作区的
Git 对象不可恢复，因此下列提交是等价重建提交，不声称复原历史 SHA。

```text
WINDOWS_UAT_BLOCKED=true
readyForPromotion=false
formalRelease=false
```

真实 Windows Named Mutex 与平台验收证据仍是解除阻断的必要条件。

## 基线与提交

- 冻结基线：`5a137300b5599d75f30e05c1a849378ed8ecc7b4`
- 重建计划：`9483446`
- 账号级 outcome-unknown lane：`bd99f8f`
- AI 物理执行退出回执：`60b9770`
- AI 翻译/分析最终提交 fence：`f7d933d`
- AI 启动恢复 scope/due/cursor：`0d2a2f1`
- Telegram session-generation fence：`be0d1a5`
- WhatsApp socket-generation fence：`cf90b0d`
- Facebook relay poll/ACK fence：`a02dc74`
- WP3 严格测试摘要权威：`19e87f9`

## 新鲜验证证据

- Batch39 聚焦门禁：27/27 通过，0 fail/skipped/cancelled/todo。
- Batch27/28 继承门禁：29/29 通过，0 fail/skipped/cancelled/todo。
- WP3：55 通过、0 失败；1 个真实 Windows 专属用例在非 Windows 环境明确
  skip，该 skip 不构成外部验收证据。
- 六个关键生产文件 `node --check` 通过。
- `git diff --check` 通过。

## 八项路径复审

1. SQLite claim SQL 在原子领取查询内排除同平台/账号的未决发送结果。
2. AI provider 容量只由匹配 execution ID 的真实子进程 exit receipt 释放。
3. 中文翻译在每个外部 await 后及最终事务内复检取消和来源 generation。
4. AI 启动恢复限定 job type、固定 dueBefore、使用稳定 cursor 和显式预算。
5. Telegram 主消息 handler 绑定 session token，disconnect 先失效并移除 handler。
6. WhatsApp 12 类 socket 事件统一验证 session、row generation 与精确 socket，
   并在关键 await 后复检。
7. Facebook `/events`、本地处理、ACK candidate、`/ack`、健康和 timer 使用同一
   relay generation；disconnect 先 invalidate/abort。
8. WP3 两个证据入口共用最终完整摘要解析器，拒绝尾部不完整摘要及所有非零
   fail/skipped/cancelled/todo。

## 环境边界

本报告中的自动化验证运行于非 Windows 环境。它不能证明 Windows
`System.Threading.Mutex`、真实桌面安装、真实 Facebook/Telegram/WhatsApp
账户与网络链路。Windows acceptance 包只包含执行工具和身份清单，不包含
任何预制 PASS 证据。
