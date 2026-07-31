# WP5 Windows Legacy Runtime Cutover 验证报告
## 时间
2026-07-05 11:21 GMT+7（Session 启动）
实际验证执行：2026-07-05 04:23 UTC

## 包信息
- 文件：`WP5_Windows_Cutover_Validation_Kit_2026-07-05_v2.zip
- KIT_MANIFEST schemaVersion: 2, stage: 6.4.5.9, workPackage: WP5
- 绑定 source tree: `675e0c35f9774c96fceef33928a9867ff207b3da
- activation binding commit: `e52b9f6c6ddb59a45fc652aef43b195fbecb6aee
- launcher revision: `PERSISTENT_CONSOLE_AND_EXTRACT_DIAGNOSTICS_V2

## 环境
- Node.js: v22.22.3
- 平台: win32（真实 Windows 主机 ✅）
- 运行目录: `C:\Users\1\.qclaw\workspace-ua58rsb93veqtxl7\WP5_win\WP5_Windows_Cutover_Validation_Kit_2026-07-05_v2\

## 验证结果：✅ PASS

### 合约测试（Contract Tests）
`node --test tests/wp5/windows-cutover-evidence-contract.test.js

| # | 测试 | 结果 |
|---|------|------|
| 1 | Windows cutover evidence owner record satisfies the accepted WP4 registry schema | ✅ PASS |
| 2 | stale Windows identity remains schema-valid but cannot match the real command digest | ✅ PASS |
| 3 | Windows evidence cannot PASS when a required real-host check is missing or failed | ✅ PASS |

**合约测试结论: 3/3 PASS** ✅

### 实机证据收集（Windows Evidence）
`node tools/wp5/windows-legacy-runtime-cutover-evidence.js

| Check ID | 描述 | 结果 | 关键指标 |
|----------|------|------|----------|
| `NO_OWNER_ALLOWS_STARTUP` | 无 owner 记录时允许启动 | ✅ PASS | state: `LEGACY_OWNER_CLEARED`, sourceRegistryMutated: false |
| `LIVE_OWNER_CONTAINED` | 存活 legacy owner 被正确 contained | ✅ PASS | PID 22312 存活→graceful exit→not live, forced: false |
| `PID_REUSE_NOT_KILLED` | PID 重用场景不应杀死无辜进程 | ✅ PASS | pidReused: true, killAttempts: 0, unrelatedStillLive: true |
| `AMBIGUOUS_IDENTITY_FAILS_CLOSED` | 模糊 identity 必须闭源失败 | ✅ PASS | blockedCode: `WP5_LEGACY_OWNER_AMBIGUOUS`, killAttempts: 0 |

**完整性门禁: missing=0, duplicates=0, failed=0** ✅

### 整体证据状态
- `status`: **PASS**
- `productionChainExecuted`: **true**（真实 Windows 硬件执行）
- `completeness.missing`: [] ✅
- `completeness.duplicates`: [] ✅
- `completeness.failed`: [] ✅

## 证据文件
- 路径: `evidence/wp5/development/windows-legacy-runtime-cutover.json
- SHA256: `F6C76FAE97049C9EA512CD8AD6A4980DEC37595B4B682066DF51DA5E858DAE49
- 大小: 4629 bytes
- generatedAtUtc: `2026-07-05T04:23:12.615Z

## 结论
**WP5 Windows Legacy Runtime Cutover 验证 → PASS ✅**

所有 4 个 required check 在真实 Windows 硬件（DESKTOP-029FH47, win32, Node.js v22.22.3）上通过，证据链完整，可用于 WP5 convergence pre-review。
