# FIX6D Runtime Authority V1 Windows 源码 UAT 清单

## 身份门禁

启动控制台必须显示：

- Commit：`91096c2eb1a9e289b1a68b351a326166cf9c379d`
- Tree：`de013fcf1f2547cdc48874976f2a719f9c73f57c`
- Branch：`fix6d-runtime-authority-v1`

不一致立即停止。

## A. 凭据事务

- [ ] 输入有效 OpenRouter Key 并保存。
- [ ] 成功时显示安全存储与运行时确认均通过。
- [ ] 后端重启确认故障时，显示“已安全保存，但运行时应用确认失败”，并包含真实 reasonCode/requestId。
- [ ] 未提交故障明确显示“未写入”，不得与已提交状态混淆。
- [ ] 重启应用后仍能读取已提交凭据并完成 `/key`、`/models`。

## B. OpenRouter 双模型

- [ ] 目录中的 `:batch` 模型不进入交互候选。
- [ ] 人为选择一个会 400/404 的候选后，系统继续尝试下一候选。
- [ ] 最终必须取得两个不同 model slug 的真实 `/chat/completions` 成功 requestId。
- [ ] 两个成功前，OpenRouter 状态保持 blocked；两个成功后才允许 runtime ready。

## C. 正式任务资格

- [ ] 快速回复主/备均有有效回复大脑正式收据。
- [ ] 深度回复主/备均有有效回复大脑正式收据。
- [ ] 导演主/备均有有效回复大脑正式收据。
- [ ] 翻译主/备均有商业翻译正式收据，并且主备模型独立。
- [ ] onboarding smoke、人工勾选和 conditional 均不能产生正式资格。
- [ ] 收据模型不匹配、任务不匹配或过期时路由被隔离。

## D. 安全模式分域

- [ ] 制造一条不合格 AI 持久路由。
- [ ] AI 自动任务停止，新任务不再进入执行。
- [ ] 进行中 AI 任务进入可恢复重试，不产生成功副作用。
- [ ] 人工消息发送仍可用。
- [ ] 账号连接与同步不因该 AI 故障被全局暂停。
- [ ] 更新中心不因该 AI 故障被全局暂停。
- [ ] UI 显示 AI 域隔离，而不是全局安全模式。

## E. 系统级安全模式

- [ ] 注入发送结果未知或权威账本不一致。
- [ ] 全局安全模式正确进入。
- [ ] 诊断 JSON 同时包含 operatingMode、reasonCode、reasons、enteredAt、trigger、updatedBy、evidenceSha256。
- [ ] 清除故障后通过恢复中心退出，元数据保留审计记录。

## F. UI 防回归

分别在 100%、125%、150% 检查标准/舒适/大字、紧凑/舒适密度、导航三态、AI 面板开关、普通/窄窗口及全部正式路由。

## 证据

导出脱敏诊断 JSON、OpenRouter 双成功 requestId、角色资格收据摘要、安全模式/AI 隔离快照和三档缩放截图。未完成前保持发布状态全 false。
