# 言策 Batch 30｜WP3 / WP4 / WP5 Windows 根因修复报告

## 1. 制品身份

- Branch：`development/windows-uat-batch30-wp3-wp4-wp5-root-fix`
- ImplementationCommit：`4ef7a2b4182400e0ca7b4603dea6ba962ecb9bac`
- ImplementationTree：`52401514689468b2cd4b7e49e3ad6e107aa38d5e`
- ParentPackageCommit：`cfd2dcae49614cd53b0706f823fdca82b1cbd52f`
- ParentPackageTree：`f09d42285686a8f4c670e72faf0df541d32d6b96`

## 2. 输入证据

输入：`YANCE_BATCH29_WINDOWS_EVIDENCE_20260729-154611.zip`
SHA256：`e3e5a4648ecad52db989348c2084fd55f4528e97bf6c466b9bc970a40d3eca36`

该证据证明 Batch 29 的制品身份、clean npm ci、npm ls 与核心门禁通过，但同时确认：

1. WP3 的 43 项测试通过后，生产证据启动后端失败；
2. WP4 的 A12、A14、A20、A21 与启动取消时序仍失败；
3. WP5 的 24 个 mutant 已全部 KILLED，但 source-closure 后续失败五项。

## 3. 根因与修复

### 3.1 WP3

生产证据脚本仍向真实后端注入 `YANCE_SAFE_MODE=1`，与已冻结的 SQLite `runtime_state` 单一权威相冲突。Batch 30 删除该环境变量，并新增静态测试，禁止证据脚本重新引入该旁路。

### 3.2 WP4

关闭 FD6 后，Windows 子进程可能在 stop 回调已经返回失败以后自行退出。旧协调器只相信 stop 结果，立即把已退出或即将退出的 Owner 固化为永久 `FATAL_OWNER_CONTAINMENT`。

Batch 30 加入有界并发退出观察：

- 子进程仍存活：继续保留应用 fence，严格 fail-closed；
- 子进程已真实退出且 Owner registry、FD6、SQLite authority 都完成恢复：原子解除 containment，进入 `FAILED_SAFE`；
- 日志或 sentinel 持久化失败：不得利用并发退出绕过 fail-closed。

同时将“启动代次已取消”与“后续进程清理完成”拆分观测，不再用总耗时误判 FD5 取消失败。

### 3.3 WP5

source-closure 的旧正则把负向探针文件、`YANCE_SAFE_MODE_*` 安全阈值、压缩 Renderer 同行文本及最终已绑定 Commit/Tree 误判为遗留运行旁路。Batch 30 改为精确键匹配、直接属性访问匹配、显式负向探针白名单及阶段感知身份校验。

## 4. 本地验证

- WP3 静态 authority 门禁：2/2 PASS；
- WP4 startup/FD5/containment/journal 专项：43/43 PASS；
- WP4 其余已执行的非真实后端状态机与 IPC 回归：PASS；
- WP5 基础：58/58 PASS；
- WP5 source-closure：11/11 PASS；
- WP5 mutation：24/24 KILLED，0 survived，0 harness error；
- 修改 JavaScript：`node --check` PASS；
- `git diff --check`：PASS。

当前 Linux 依赖目录缺少 `express` 与 Electron，真实生产子进程启动不能在本环境闭环；该限制不得改写为 PASS。

## 5. Windows 复验策略

Batch 30 采用短路顺序：

1. clean `npm ci` 与身份核验；
2. WP3 真实生产证据；
3. WP4 启动取消定向测试及 A12/A14/A20/A21；
4. WP5 source-closure 与完整连续 verify；
5. 以上全部通过后，才运行完整 WP3/WP4/WP5、完整后端与 Electron。

## 6. 治理结论

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
windowsUatAuthorized=false
```
