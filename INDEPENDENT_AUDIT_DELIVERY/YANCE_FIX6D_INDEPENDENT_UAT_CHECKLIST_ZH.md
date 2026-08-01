# FIX6D Runtime Authority V1 独立逐项测试结论清单

> 结论口径：`源码通过` 不等同于 `真实 Windows UAT 通过`。未取得真实外部链路证据的项目均保持待验。

| # | 场景 | 源码/自动化 | 真实 Windows/外部链路 | 结论 |
|---:|---|---|---|---|
| 1 | 凭据写入失败事务状态区分 | `PASS_AFTER_REPAIR` | `PENDING` | 源码权威已区分未提交、已提交但运行时确认失败、完整成功；仍需真实 Windows UI 文案与重启链路。 |
| 2 | OpenRouter 首个模型失效自动切换候选 | `PASS_AFTER_REPAIR` | `PENDING_REAL_OPENROUTER` | 已验证失败后继续候选、规范化 slug 独立性和真实调用收据契约；未取得真实服务 requestId。 |
| 3 | 普通对话禁止调度 Batch-only 模型 | `PASS_AFTER_REPAIR` | `PENDING_UI_CONFIRMATION` | 能力权威对全部已声明交互任务及未知任务 fail-closed；仍需 Windows 路由 UI 观察。 |
| 4 | 翻译/快捷回复无法绕过资格收据 | `PASS_AFTER_REPAIR` | `PENDING_REAL_ROLE_ROUTING` | 收据绑定模型、任务、当前正式基准、证据摘要和期限；conditional/onboarding/手工构造均不能铸造正式资格。 |
| 5 | AI 路由故障不阻断人工消息与账号连接 | `PASS_AFTER_REPAIR` | `PENDING_REAL_CHANNELS` | AI 路由状态异常进入 AI 独立隔离域且不升级全局安全模式；真实三渠道与账号连接仍待实机。 |
| 6 | 执行中 AI 任务隔离后支持重试且无脏副作用 | `PASS` | `PENDING_LIVE_RETRY` | 恢复重试、晚到结果 fence、任务替换和隔离回归通过；真实执行中断与人工复核仍待 Windows。 |
| 7 | 安全模式触发信息完整原子存储 | `PASS_AFTER_REPAIR` | `PENDING_DIAGNOSTIC_EXPORT` | operatingMode 与 reasonCode/reasons/enteredAt/trigger/updatedBy/evidenceSha256 同事务落库并读取校验；需 Windows 诊断 JSON 实证。 |

## 固定全局门禁

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

## UI 防回归

- 源码静态排版：2/2 PASS。
- Chromium 生产排版矩阵：1/1 PASS。
- 真实 Windows 100%/125%/150% 截图：未执行，因此不提升 `windowsUiUat`。

## WP4

- `BOOT_SERVER_IMPORT_FAILED` 等上游固有阻断已复现并留档。
- 按本轮审核指令，不作为 FIX6D 派生修复的阻断条件，也未添加忽略项或放宽断言。
