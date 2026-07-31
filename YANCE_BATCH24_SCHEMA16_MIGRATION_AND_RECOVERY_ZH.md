# 言策 Batch 24｜Schema 16 迁移与恢复说明

## 新增/强化对象

- `r32_send_queue`：claim generation/token/lease、row version、RouteVersion 引用与状态/作用域触发器；
- `outbox_route_versions`：不可变路由版本；
- `account_lifecycle_saga`：账号生命周期持久阶段；
- `domain_event_projection_jobs`：入站投影任务；
- `identity_domain_event_outbox`：claim token、lockedAt、lease；
- `async_operation_state`：resume policy、lease、challenge/session 信息。

## 升级原则

- 迁移在统一主 SQLite Owner 下执行；
- 旧合法 Queue 通过确定性兼容迁移绑定 RouteVersion；
- 非法或无法确定作用域的数据不得静默伪造，进入诊断/隔离；
- 应用重启不得因数据库版本高于旧迁移器上限而拒绝合法 Schema 16。

## 回滚

本批次不提供把 Schema 16 数据直接降级写回旧 Schema 的自动回滚。真实环境失败时应：

1. 停止所有主库 Owner；
2. 使用升级前完整备份恢复；
3. 验证数据库文件、WAL、schemaVersion 与 DataRoot；
4. 重新执行迁移并保存日志；
5. 禁止只删除新增表或触发器后继续运行旧二进制。
