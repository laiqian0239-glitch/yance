# 言策 Batch 27｜Developer Handoff V2 公共根因修复报告

## 1. 工程结论

Batch 27 从 Batch 26 PackageCommit `f97ae100e163a704fb28a625be121f8e0e6ac5e8` 建立独立修复分支，逐项实施开发者交接包 V2 的 4 个 P0、6 个 P1、7 个 P2，并纳入 SYS-REG-01～05 系统增量门禁。

当前结论仅为：**源码已修复并通过自动化回归**。真实 Windows、真实 WhatsApp/Telegram/Facebook、真实 OpenRouter 与独立审核仍未完成，因此保持 `WINDOWS_UAT_BLOCKED`。

## 2. 实现身份

- Branch：`development/windows-uat-f25fe2e-repair-batch27-developer-handoff-v2`
- ImplementationCommit：`0fea714780aad29aedca8a7ec51f25e42dac97b2`
- ImplementationTree：`84504230dcbd75d6791f65a801b3883961977d84`
- Parent PackageCommit：`f97ae100e163a704fb28a625be121f8e0e6ac5e8`
- Parent PackageTree：`e04232ba80c49e6e2e1f654211fd17ce60cee292`

## 3. P0 公共层修复

### DEV-P0-01｜SQLite 活 Owner heartbeat 与 fencing

- 非 reentrant owner 周期 heartbeat，小于 stale window 的三分之一。
- ownership 判断优先 PID 与 process identity，禁止仅凭 wall-clock stale 抢占活 owner。
- heartbeat 丢失后当前 owner fail-closed。
- 使用 resilient lease clock 识别墙钟前跳、回拨和睡眠恢复。
- 四进程同一 SQLite 文件竞争时最多一个迁移 owner。

### DEV-P0-02｜Telegram enrichment 持久恢复

- Job 持久化 scoped dedupe key，兼容旧 job 时按 account/chat/externalId 重建。
- oldest-first cursor 分页、hasMore/remaining/oldestPendingAt。
- 在线周期 retry，不依赖重连。
- orphan job、orphan base message 和毒记录均可观测，失败进入 retry/DLQ。

### DEV-P0-03｜发送 unknown scope 崩溃恢复

- Schema 18 为 Queue 增加 `unknown_scope/unknown_reason/unknown_lane/execution_generation/unknown_recorded_at`。
- claim 阶段即持久化 command/account lane，强关恢复不再把单账号故障升级成全局冻结。
- unknown 禁止普通重试；匹配 generation 的 late acceptance 只幂等收敛一次。

### DEV-P0-04｜AI 物理 Provider 资源治理

- 区分 logical running 与 physical in-flight。
- Provider zombie 未终止前不补充相同 Provider 容量。
- 支持硬终止 worker/连接，并持久记录物理执行状态。
- zombie 超阈值打开 provider circuit，迟到结果不能写业务副作用。

## 4. P1/P2 修复摘要

- 中文翻译与 AI analysis 全链路传播 AbortSignal，取消异常不再降级成普通翻译失败。
- WhatsApp SDK 返回后执行 signal/generation/current-socket fence。
- Facebook driver→adapter→relay 贯通 signal/generation，并在响应后再次 fencing。
- durable recovery 使用稳定 cursor、active-only 状态和精确 remaining，不再把单批结果当全部恢复。
- 学习源、投影、processing、retry、DLQ、completed 建立总账；毒记录不阻塞后续；projection lease 使用 generation/heartbeat/CAS。
- 通用迁移快照使用 DB identity、migrationId、PID、process generation 与 UUID 防碰撞。
- external AbortSignal 立即 settle，不再等待总 deadline。
- background job enqueue 返回 created/updated/already-succeeded/already-running/retry-wait 等明确 outcome。
- Persona version/hash 在 `AI_REPLY_CANDIDATE_READY` 状态事务内原子复核。

## 5. 系统增量门禁

- SYS-REG-01：WhatsApp/Telegram/Facebook 共 17 条 operation path 验证 signal、generation 与 Queue 投影归属。
- SYS-REG-02：unknown、accepted journal、Message 与 reconcile 幂等收敛。
- SYS-REG-03：平台悬挂、AI zombie、601 条 durable backlog 与 SQLite 查询组合压力，健康 lane 持续推进。
- SYS-REG-04：统一 correlationId、operationId、executionGeneration、accountLane 与 physical zombie 指标。
- SYS-REG-05：源码修复、自动化、真实环境和 UAT 工具证据分开登记。

## 6. 自动验证

- 完整后端：169 个文件，1026/1026 PASS，4 路并行，每文件独立 `YANCE_DATA_DIR`。
- Batch 27 Developer Handoff V2：13/13 PASS。
- Batch 27 System Regression：6/6 PASS。
- Batch 26 专项回归：19/19 PASS。
- Round 12：79/79 PASS。
- Round 13：24/24 PASS。
- 平台生产就绪：58/58 PASS。
- UAT Diagnostics：142/142 PASS。
- Source UAT：33/33 PASS。
- Final Review：34/34 PASS。
- Component Readability：6/6 PASS。
- Root Cause Closure：2/2 PASS。
- 变更 JavaScript：37/37 syntax PASS。
- `git diff --check`：PASS。

## 7. 未关闭的真实门禁

- Batch 27 最终身份 clean `npm ci` Windows 复验。
- Windows 冷启动、强关、睡眠/唤醒、系统时间跳变、同文件多进程接管。
- 真实 WhatsApp/Telegram/Facebook 全 operation matrix、timeout、late ACK 与重启 reconciliation。
- 真实 OpenRouter 两个不同模型的 timeout/cancel/provider switch/physical termination。
- 50,000+ 学习积压及真实资源曲线。
- 独立审核和发布批准。

## 8. 治理状态

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
windowsUatAuthorized=false
```
