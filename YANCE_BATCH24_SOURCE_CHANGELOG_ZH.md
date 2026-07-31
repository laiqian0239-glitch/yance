# 言策 Batch 24 源码变更记录

## 身份

- Branch：`development/windows-uat-f25fe2e-repair-batch24-state-transaction-closure`
- ImplementationCommit：`4582160eefb2f8c9fc628ac4aecfc9e035e87226`
- ImplementationTree：`6784e899382166545c180b1e9981d24c236c2376`

## 新增

- `backend/bootstrap/bootPhase0Restore.js`
- `backend/lib/sqliteConnectionBroker.js`
- `backend/migrations/batch24StateTransactionConsistency.js`
- `backend/services/accountLifecycleSagaService.js`
- Batch 24 状态事务与 DomainEvent 重放故障注入测试。

## 核心修改

- 主数据库单 Owner 与 Boot Phase 0 恢复顺序；
- Schema 16：Queue CAS、RouteVersion、Saga、Projection Job、Identity Outbox lease、Auth restart 元数据；
- 出站命令、Queue/Message checkpoint、人工裁决/重试/取消原子事务；
- 账号 hydration、Saga 补偿和认证恢复；
- DomainEvent projector 与 Identity transactional outbox；
- WhatsApp 会话及跨账号迁移的 RouteVersion/Identity 原子重绑；
- 账号能力投影、授权提升和 RuntimeSettings 并发保护；
- 自动预言机升级到新数据库约束与 committed/pending 语义。

## 验证

- 165 files / 981 tests PASS；其余权威门禁详见修复报告。
