# 言策 Batch 27｜Schema 18 迁移与恢复说明

Schema 18 新增或扩展：

- Queue structured outcome-unknown scope/reason/lane/execution generation；
- learning source/projection ledger、lease generation、DLQ；
- AI physical execution/zombie 状态；
- durable recovery metrics/cursor 所需索引与字段。

迁移规则：

1. 仅当前 SQLite write owner 可以迁移。
2. Snapshot 名称绑定 DB identity、migrationId、PID、process generation 与 UUID。
3. 目标必须不存在，并在完成后校验 size/hash/integrity。
4. 中断后重启必须幂等识别已完成结构或使用已验证快照恢复。
5. 旧二进制不得写 Schema 18。

真实 Windows 仍需执行同文件四进程、迁移中强杀、WAL/SHM 和回滚快照验证。
