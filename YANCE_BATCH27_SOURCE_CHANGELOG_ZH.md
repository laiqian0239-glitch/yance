# 言策 Batch 27 源码变更记录

基线：Batch 26 PackageCommit `f97ae100e163a704fb28a625be121f8e0e6ac5e8`。  
实现：`0fea714780aad29aedca8a7ec51f25e42dac97b2` / Tree `84504230dcbd75d6791f65a801b3883961977d84`。

## 主要新增

- `backend/lib/resilientLeaseClock.js`
- `backend/migrations/batch27DeveloperHandoffV2Closure.js`（Schema 18）
- `backend/tests/batch27DeveloperHandoffV2Closure.test.js`
- `backend/tests/batch27SystemRegressionClosure.test.js`

## 主要改造域

1. SQLite ownership heartbeat、process fencing、时钟跳变保护。
2. Queue unknown scope 与 execution generation 持久化。
3. Telegram enrichment 分页恢复、在线重试与 scoped identity。
4. AI physical execution、zombie circuit 与 hard termination。
5. WhatsApp/Facebook post-SDK generation fence。
6. AI 翻译/分析取消链与 Persona 最终 CAS。
7. 学习 source/projection ledger、lease heartbeat、retry 与 DLQ。
8. durable recovery cursor、remaining 和 oldest age 可观测性。
9. 迁移快照唯一命名和同文件四进程竞争门禁。

所有变更保留 `WINDOWS_UAT_BLOCKED`，不构成真实环境关闭证明。
