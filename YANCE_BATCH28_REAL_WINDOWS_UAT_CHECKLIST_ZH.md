# 言策 Batch 28｜真实 Windows UAT 必做清单

## A. 身份与安装

- [ ] 校验交接 ZIP、源码 ZIP、Git bundle 和 `SHA256SUMS.txt`。
- [ ] 从 Git bundle 恢复并验证 PackageCommit/Tree。
- [ ] 在全新目录执行 `npm ci`，ExitCode=0。
- [ ] 执行 `npm ls --depth=0`，ExitCode=0。
- [ ] 运行时显示的 Commit/Tree 与交接身份完全一致。

## B. SQLite Owner 与 Electron

- [ ] 冷启动、正常退出、托盘退出、强制结束进程和重启。
- [ ] 双实例同时启动，只允许一个有效 SQLite Owner。
- [ ] 活进程 heartbeat 新鲜时禁止另一个进程接管。
- [ ] 模拟系统时间前跳、回拨、睡眠/唤醒，不误抢活 Owner。
- [ ] PID 复用/Owner 进程死亡后可安全接管。
- [ ] 声明的 dataRoot/dbPath 与实际 SQLite 文件一致。

## C. Telegram

- [ ] enrichment 超过一页并跨重启继续。
- [ ] poison 任务 retry 后进入 DLQ，后续健康任务继续。
- [ ] 历史 backfill 超过多页并跨重启继续。
- [ ] 新增消息突发超过单页上限，双游标无缺口。
- [ ] 登录成功和注销清理凭据不栈溢出。
- [ ] 同步/认证超时后迟到结果不覆盖当前状态。

## D. 真实平台 operation matrix

- [ ] WhatsApp、Telegram、Facebook：text/media/reaction/revoke/presence/read。
- [ ] 每种操作验证 deadline、generation、取消、late ACK 和重启恢复。
- [ ] `send_outcome_unknown` 全局/账号 lane 阻断符合预期。
- [ ] Queue、Message、Journal、Route、Identity 最终幂等收敛。
- [ ] Facebook OAuth、页面选择、取消、Avatar 导入与诊断超时后无迟到成功写回。

## E. OpenRouter 与 AI

- [ ] 两个不同 Provider/模型分别验证正常、超时、用户取消和限流。
- [ ] Provider worker/请求物理终止后槽位立即释放。
- [ ] 不可终止 zombie 继续占用上限并触发熔断。
- [ ] 重启后遗留 AI 任务恢复且迟到结果不写业务副作用。

## F. 学习、候选和翻译

- [ ] 50,000+ source/projection 混合积压，ready/deferred/DLQ 总账准确。
- [ ] poison 记录不阻断健康任务。
- [ ] Candidate revision/Persona 变更时旧结果 CAS 失败。
- [ ] 翻译强制重试和重启恢复时旧代次不能覆盖新代次。

## G. 治理

- [ ] 所有证据绑定最终 PackageCommit/Tree。
- [ ] 完全独立角色复核。
- [ ] 在上述全部完成前保持 `WINDOWS_UAT_BLOCKED`。
