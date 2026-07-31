# 言策 Batch 37｜Windows 证据工具链根因修复报告

## 输入证据

- 文件：`YANCE_BATCH36_WINDOWS_FULL_EVIDENCE_20260729-191217.zip`
- SHA256：`e6d80f847c129be0d922e9174b809653cb109ebb732bf049fbb0e1648b1b189e`
- 结果：自动化总体 FAIL，但核心产品测试已大范围通过。

## 已确认通过

- clean npm ci：PASS；
- V3 协议：PASS；
- Source UAT：PASS；
- WP3 测试：44/44 PASS；
- WP4 测试：215/215 PASS；
- WP4 mutation：62/62 KILLED；
- A12/A14/A20/A21：4/4 PASS；
- WP5 source-closure：11/11 PASS。

## 三个工具链根因

1. WP3 evidence generator 在同一 Node 进程串行执行生产探针与 singleton，且继承运行路径/互斥锁环境；
2. WP4 evidence generator 使用 `shell:true` 和 wildcard，Windows Node 位于 `C:\Program Files` 时被错误拆分；
3. WP3/WP4 将证据写入 Git worktree，导致后续 WP5 clean-repository 门禁必然失败。

## 修复

- WP3 singleton 改为独立、净化环境的 Node 子进程；
- WP3 generator 改为 import-safe，并支持 `WP3_EVIDENCE_DIR`；
- WP3/WP4 required tests 强制 TAP、完整数量校验；
- WP4 显式枚举测试文件，`shell:false`；
- Batch 37 Windows runner 将 WP3/WP4 证据写到外部证据目录，并在 WP5 前显式检查仓库干净。

## 当前治理

`REPAIR_ATTEMPT_IN_PROGRESS / WINDOWS_UAT_BLOCKED`
