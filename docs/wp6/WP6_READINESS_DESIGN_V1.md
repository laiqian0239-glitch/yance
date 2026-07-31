# 言策29 Stage 6.4.5.9
# WP6_READINESS_DESIGN_V1

## 0. 文档身份与治理边界

文档类型：

`WP6正式启动前Readiness设计基线`

文档状态：

`READY_FOR_ACTIVATION_NOT_ACTIVATED`

本文件只定义WP6的范围、入口、权威、状态机、不变量、故障与并发处理、mutation、required tests、evidence和两阶段验收出口。

本文件不执行以下事项：

- 不修改生产代码
- 不创建WP6 Activation commit
- 不激活WP6
- 不生成WP6 implementation commit
- 不生成candidate binding commit
- 不生成Final Delivery HEAD
- 不生成Final Delivery ZIP
- 不把Readiness结论解释为实施已经开始

当前最终Readiness结论：

`WP6_READY_FOR_ACTIVATION`

该结论仅授权后续创建独立的WP6 Activation治理提交。

---

## 1. 正式上游接受基线

### 1.1 WP0

```text
Final implementation commit:
3c4a09000de5d8efd5f50efecfed2925ed5b20cd

Accepted Final Delivery HEAD:
34eba806e5ec7094336db74ea2d518f350f3e519

Accepted source tree:
fe486d685200ba217082c1772d8bac6e0537b2d6
```

### 1.2 WP1

```text
Final implementation commit:
635d80f87d3e76720886b95b5ff01c13b552c1f4

Accepted Final Delivery HEAD:
cb6aa093115ee29d3505e45d252bcec4ca440e1a

Accepted source tree:
36d986c6d01f5a809a892eee77089ff45106acae
```

### 1.3 WP2

```text
Final implementation commit:
85ec59889dc2ca5c4c2d2ebd2feac9e631b006bc

Accepted Final Delivery HEAD:
3474d37d8bea07d1ea0294801e7f78284aae6ff8

Accepted source tree:
ada9ddf5db0e25ef2274b82db5f5a3f8f5bb4c9e
```

保留风险：

`WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION`

不得宣称scanner已覆盖所有SHA256等价编码。

### 1.4 WP3

```text
Final implementation commit:
aca19d12c20e5ea23af93d1a1a9e840237f5a726

Accepted Final Delivery HEAD:
3d8bac3665098d495e3266ea8ea013c5aba6be16

Accepted source tree:
e2670016e7d6252e5cf206223fc4420b5666e606
```

保留风险：

`WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION`

### 1.5 WP4

```text
Implementation commit:
da29b9dc13e258b66d3de5a5320132a324ab8b6f

Implementation source tree:
ffcf273bf83416c4eec38f1e9d2b3f1de6bc7f35

Candidate binding commit:
91786b29a96ba338ba49263c164976ff83173e51

Accepted Final Delivery HEAD:
2b929258c4d51c10a4dc49e90fcecf8b9f8170c4

Accepted source tree:
8de896200f82a65d22a7d15db78cd83f813188bf
```

绑定状态：

`BOUND_TO_WP4_ACCEPTED_FINAL_DELIVERY`

保留风险：

`WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION`

WP4接受不等于Windows reboot boundary、PID reuse和全部owner identity实机证据已经完成。

### 1.6 WP5

```text
Implementation commit:
2d42a7424b1bac0dafa2b4c3bee3378266e1a92f

Implementation source tree:
1b7594dcc35e77a09e3e31473fbec74847a5e3c1

Candidate binding commit:
ba3728dcf267c338af19d78297309aa306ee8018

Candidate binding source tree:
6e6a9c27a18bce011da06863aa7ea4c2015db386

Accepted Final Delivery HEAD:
c4d5a641e93c600c0199e9960fe8f570faa07808

Accepted source tree:
b6ece87673d804686bd231858097f6561ff1b200
```

绑定状态：

`BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY`

最终接受决定：

`WP5_ACCEPTED`

保留风险：

`WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED`

---

## 2. 状态读取权威

机器读取优先级：

1. 最终独立审核决定
2. 项目所有者明确签发的正式接受身份
3. 风险接受记录
4. Accepted Final Delivery HEAD和source tree
5. Final Packaging验证结果
6. Final Delivery内候选期handoff/status
7. R5-WP7阶段参考资料

WP5包内下列候选期字段不得覆盖`WP5_ACCEPTED`：

```text
wp5Accepted=false
WP5.status=ACTIVE
WP5.reviewStatus=PENDING_INDEPENDENT_REVIEW
WP6.status=BLOCKED_BY_WP5
purpose=WP5_ACTIVATION_HANDOFF
```

治理覆盖只有在以下三项同时成立时允许：

```text
formalDecision=WP5_ACCEPTED
acceptedHead=c4d5a641e93c600c0199e9960fe8f570faa07808
acceptedSourceTree=b6ece87673d804686bd231858097f6561ff1b200
```

---

## 3. 已关闭的PROVISIONAL项

以下临时依赖全部关闭：

- WP4 CredentialVaultHost唯一vault authority
- WP4 CredentialAuthorityLifecycleCoordinator唯一credential lifecycle authority
- WP4 DesktopCredentialApplicationCoordinator唯一application lifecycle authority
- WP4 FD4/FD5/FD6正式协议与owner session绑定
- WP4 local_ready、backend:ready和trusted owner接受边界
- WP4 rejected owner containment和fence释放顺序
- WP5 SQLite runtime_state唯一operating mode权威
- WP5 operating_mode_revision和持久command ledger
- WP5 Yance27只读迁移、migration receipt和Yance29-only写入
- WP5 LegacyRuntimeCutoverGate
- WP5 safe-mode file、environment、desktop和renderer fallback关闭
- WP5治理字段不一致的正式风险接受
- WP6 activation父提交

当前不得再使用：

`PROVISIONAL_PENDING_UPSTREAM_ACCEPTANCE`

或：

`PROVISIONAL_PENDING_WP5_ACCEPTANCE`

---

## 4. 仍保留的UNPROVEN或UNKNOWN项

以下内容尚未实施或未执行：

- WP6生产实现：`UNPROVEN_NOT_IMPLEMENTED`
- Electron API v2-only cutover：`UNPROVEN`
- `/policy` operating mode路径清零：`UNPROVEN`
- Electron对`executeLegacy`不可达：`UNPROVEN`
- WP4 direct lifecycle fallback清零：`UNPROVEN`
- Snapshot reconnect和event gap集成：`UNPROVEN`
- Command idempotency和crash recovery集成：`UNPROVEN`
- old Runtime source scan zero：`UNPROVEN`
- installed-tree scan zero：`UNPROVEN`
- duplicate runtime entrypoint zero：`UNPROVEN`
- WP6 mutation 0 survivor：`UNPROVEN`
- 五个WP6 evidence JSON：`UNPROVEN_NOT_GENERATED`
- WP6 required tests：`UNPROVEN_NOT_EXECUTED`
- WP0至WP5在WP6候选上的回归：`UNPROVEN_NOT_EXECUTED`
- Windows真实安装树扫描：`UNPROVEN_NOT_EXECUTED`
- WP4 Windows完整实机证据：`UNKNOWN_ACCEPTED_UPSTREAM_EXCEPTION`
- WP6 Convergence Pre-Review：`UNPROVEN_NOT_STARTED`
- WP6 Final Packaging：`UNPROVEN_NOT_AUTHORIZED`
- WP6最终独立审核：`UNPROVEN_NOT_STARTED`

---

## 5. WP6范围

正式名称：

`Electron API v2 cutover verification and old Runtime deletion`

### 5.1 正式范围

1. Electron全部Runtime控制路径切换至backend API v2。
2. 验证snapshot、commands、events、event-gap recovery和backend crash recovery。
3. 删除或证明持续不存在旧Electron CoreRuntime、AccountContext、SecurityGuard和重复Lifecycle。
4. 删除secondary backend runtime factories和lifecycle entrypoints。
5. 清零`POST /policy`对operating mode的控制。
6. 清零Electron/preload/renderer对`AppRuntime.executeLegacy`的runtime-control可达性。
7. 清零WP4过渡性direct start、stop、restart和credential reset fallback。
8. 对源码树和installed runtime tree证明：
   - old Runtime residue为0
   - API v2 bypass为0
   - dual execution path为0
   - duplicate runtime entrypoint为0

### 5.2 非范围

- 不重做WP4 credential custody。
- 不重做WP5 runtime_state或legacy migration。
- 不在Readiness阶段恢复Telegram、Facebook、翻译或AI表面功能。
- 不生成WP7 installer。
- 不进行Phase 1最终总验收。
- 不把R5参考包视为任何工作包已完成。

---

## 6. 唯一权威模型

### 6.1 Electron

Electron仅是DesktopHost，负责：

- 窗口、托盘和通知
- backend子进程管理
- release manifest验证
- CredentialVault和credential custody host
- API v2 client投影

Electron不得成为：

- AppRuntime
- LifecycleStateMachine
- operating mode权威
- safe mode权威
- command幂等权威
- persisted event权威

### 6.2 Backend

Backend是唯一：

- AppRuntime
- LifecycleStateMachine
- RuntimeStateStore写入者
- runtime_state operating mode权威
- command ledger权威
- runtime_event sequence权威
- Outbox claim owner
- API v2控制面

### 6.3 WP4凭据权威

唯一vault mutation authority：

`CredentialVaultHost`

唯一credential lifecycle authority：

`CredentialAuthorityLifecycleCoordinator`

唯一desktop application authority：

`DesktopCredentialApplicationCoordinator`

owner只有在以下全部成立后才可信：

- FD5 hydration完成
- backend READY绑定正确
- FD6 active
- credential authority ACTIVE
- 无active transaction
- vaultEpoch、generation、authority event head一致
- SQLite、AppRuntime、SecurityGuard、SecureBridge投影一致
- owner registry写为trusted

### 6.4 WP5 operating mode权威

唯一持久权威：

```text
Yance29 SQLite
runtime_state.operating_mode
runtime_state.operating_mode_revision
```

必须区分：

- `stateVersion`：全局runtime状态版本
- `operatingModeRevision`：operating mode提交修订
- `lastEventSequence`：持久事件序列

三者不得互相替代。

### 6.5 API v2权威

唯一Runtime控制面：

- `GET /api/app/v2/snapshot`
- `POST /api/app/v2/commands`
- `GET /api/app/v2/events`

Credential secret snapshot继续走FD5，不进入API v2。

API v2 snapshot可包含非秘密credential authority metadata。

---

## 7. 正式模块盘点

### 7.1 WP4绑定模块

Electron：

- `electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js`
- `electron/desktopHost/CredentialVaultHost.js`
- `electron/desktopHost/CredentialCustodyHost.js`
- `electron/desktopHost/CredentialIpcHost.js`
- `electron/desktopHost/DesktopCredentialApplicationCoordinator.js`
- `electron/desktopHost/BackendProcessHost.js`
- `electron/desktopHost/DesktopHost.js`
- `electron/desktopHost/startupProtocol.js`
- `electron/main.js`

Backend：

- `backend/bootstrap/desktopStartupPipe.js`
- `backend/bootstrap/credentialHydrationPipe.js`
- `backend/runtime/BootCoordinator.js`
- `backend/runtime/AppRuntime.js`
- `backend/runtime/LifecycleStateMachine.js`
- `backend/services/credentialCustodyClient.js`
- `backend/services/secureBridge.js`
- `backend/security/apiSessionAuth.js`
- `backend/routes/apiV2.js`

### 7.2 WP5绑定模块

- `backend/runtime/OperatingMode.js`
- `backend/runtime/OperatingModeTransitionGateway.js`
- `backend/runtime/RuntimeStateStore.js`
- `backend/runtime/RuntimeAuthorityMigrationCoordinator.js`
- `backend/runtime/BootCoordinator.js`
- `backend/runtime/AppRuntime.js`
- `electron/desktopHost/LegacyRuntimeCutoverGate.js`
- `electron/legacyDataRoots.js`
- `backend/services/legacyRootDiscovery.js`
- `backend/services/migrationService.js`
- `backend/services/safeModeService.js`
- `backend/services/systemPolicy.js`
- `shared/desktopSettings.js`
- `frontend/r32-settings-routing.js`
- `frontend/r32-settings-recovery.js`
- `frontend/r32-system-center.js`

### 7.3 WP6强制扫描对象

精确路径必须保持不存在：

- `electron/core/coreRuntime.js`
- `electron/core/accountContext.js`
- `electron/core/securityGuard.js`

必须扫描：

- `backend/core/coreRuntime.js`
- `backend/core/lifecycleManager.js`
- `backend/core/compositionRoot.js`
- `AppRuntime.executeLegacy`
- `POST /policy`
- `main.js` direct launch/stop/restart fallback
- `DesktopHost.executeControl` direct fallback
- `DesktopHost.resetCredentialVault` direct fallback
- preload runtime control exposure
- dynamic require/import
- 路径拼接加载
- 大小写变体
- app.asar、app.asar.unpacked、resources和nested archives
- symlink/junction alias
- test fixture误打包

---

## 8. WP6入口条件

正式激活前必须满足：

1. WP0至WP5正式接受身份均已固定。
2. WP2至WP5风险接受记录均已保留。
3. WP5最终决定为`WP5_ACCEPTED`。
4. WP5 accepted HEAD为：
   `c4d5a641e93c600c0199e9960fe8f570faa07808`
5. WP5 accepted source tree为：
   `b6ece87673d804686bd231858097f6561ff1b200`
6. WP5治理字段风险覆盖已绑定。
7. WP6 Activation commit父提交必须精确为WP5 Accepted Final Delivery HEAD。
8. Activation commit只允许更新治理状态和identity binding。
9. Activation commit不得混入生产实现。
10. WP7继续保持`BLOCKED_BY_WP6`。

当前入口判断：

`PASS_READY_FOR_SEPARATE_ACTIVATION_COMMIT`

---

## 9. 治理状态机

```text
WP5_ACCEPTED_IDENTITY_VERIFIED
  -> WP5_GOVERNANCE_RISK_OVERRIDE_APPLIED
  -> WP6_READY_FOR_ACTIVATION
  -> WP6_ACTIVATION_COMMIT_CREATED
  -> WP6_ACTIVATION_IDENTITY_BOUND
  -> WP6_ACTIVE_IMPLEMENTATION
  -> WP6_CONVERGENCE_PRE_REVIEW
  -> WP6_PREACCEPTED_FOR_FINAL_PACKAGING
  -> WP6_FINAL_PACKAGING
  -> WP6_PENDING_INDEPENDENT_REVIEW
  -> WP6_ACCEPTED
```

当前状态：

`WP6_READY_FOR_ACTIVATION`

---

## 10. 运行状态机

### 10.1 Runtime authority建立

首次迁移：

```text
NO_RUNTIME_AUTHORITY
  -> LEGACY_OWNER_CUTOVER
  -> OWNERSHIP_ACQUIRED
  -> MIGRATION_SOURCE_VALIDATED
  -> AUTHORITY_AND_RECEIPT_COMMITTED
  -> RUNTIME_AUTHORITY_VALIDATED
  -> RUNTIME_STATE_READY
```

已有authority：

```text
OWNERSHIP_ACQUIRED
  -> EXISTING_AUTHORITY_VALIDATED
  -> NO_LEGACY_REREAD
  -> RUNTIME_STATE_READY
```

### 10.2 Credential owner与API基线

```text
RUNTIME_STATE_READY
  -> CREDENTIAL_AUTHORITY_ACTIVE
  -> FD4_SESSION_BOUND
  -> FD5_HYDRATED
  -> BACKEND_READY_UNTRUSTED
  -> FD6_ACTIVE
  -> RUNTIME_PROJECTION_VALIDATED
  -> OWNER_ACCEPTED_TRUSTED
  -> SNAPSHOT_FETCHED
  -> AUTHORITY_TRIPLE_VALIDATED
  -> API_V2_SYNCHRONIZED
```

Authority triple：

```text
stateVersion
operatingModeRevision
lastEventSequence
```

### 10.3 Snapshot/Event

```text
NO_BASELINE
  -> FETCHING_TRUSTED_OWNER_SNAPSHOT
  -> VALIDATING_SESSION_OWNER_AND_AUTHORITY
  -> BASELINE_ESTABLISHED
  -> POLLING_PERSISTED_EVENTS
```

异常：

```text
EVENT_SEQUENCE_GAP
OUT_OF_ORDER_EVENT
STALE_OWNER_EVENT
STALE_API_SESSION_RESPONSE
SNAPSHOT_STATE_ROLLBACK
SNAPSHOT_MODE_REVISION_INVALID
SNAPSHOT_OWNER_BINDING_MISMATCH
MALFORMED_SNAPSHOT
```

统一恢复：

```text
DISCARD_INCREMENTAL_BASELINE
  -> REVALIDATE_TRUSTED_OWNER
  -> REFETCH_SNAPSHOT
  -> REBIND_AUTHORITY_TRIPLE
```

### 10.4 Command

```text
COMMAND_IDLE
  -> ENVELOPE_VALIDATED
  -> COMMAND_SUBMITTED
  -> AUTHORITY_PERSISTED
  -> APPLYING
  -> APPLIED
  -> PUBLISHING
  -> PUBLISHED
  -> COMMAND_RESULT_CONFIRMED
```

失败状态：

```text
APPLY_FAILED
PUBLISH_FAILED
RECOVERY_BLOCKED
TRANSPORT_OUTCOME_UNKNOWN
```

恢复规则：

- 同commandId同normalized envelope恢复同一事务。
- 同commandId不同envelope拒绝。
- owner session变化时不得自动跨owner重放旧用户意图。
- 未终结mode command存在时不得接受第二个mode command。

### 10.5 Rejected owner containment

```text
OWNER_REJECTED
  -> API_AUTHORITY_REVOKED
  -> FD6_DETACHED_AND_CLOSED
  -> APPLICATION_FENCE_INSTALLED
  -> CONTAINMENT_RECORD_DURABLE
  -> TERMINATION_REQUESTED
  -> REAL_EXIT_CONFIRMED
  -> OWNER_EXIT_RECOVERY
  -> OWNER_FREE_ACTIVE_VERIFIED
  -> FENCE_RELEASE_AUTHORIZED
```

任何步骤无法证明：

`FATAL_OWNER_CONTAINMENT`

### 10.6 Cutover

```text
LEGACY_PATHS_INVENTORIED
  -> API_V2_PATHS_VERIFIED
  -> POLICY_MODE_CONTROL_DISABLED
  -> LEGACY_EXECUTE_RUNTIME_CONTROL_DISABLED
  -> DIRECT_LIFECYCLE_FALLBACK_DISABLED
  -> LEGACY_FILES_REMOVED_OR_CONFIRMED_ABSENT
  -> SOURCE_SCAN_ZERO
  -> INSTALLED_TREE_SCAN_ZERO
  -> CUTOVER_VERIFIED
```

---

## 11. 不可破坏不变量

1. WP6 Activation commit父提交必须是WP5 Accepted Final Delivery HEAD。
2. Activation commit不得包含生产实现。
3. WP5最终决定优先于候选期治理字段。
4. 治理风险覆盖只适用于已登记字段不一致。
5. accepted HEAD/tree不匹配时不得应用治理覆盖。
6. Electron不是业务Runtime权威。
7. Backend AppRuntime只能有一个生产实例。
8. Backend LifecycleStateMachine只能有一个生产实例。
9. CredentialVaultHost是唯一vault mutation authority。
10. DesktopCredentialApplicationCoordinator是唯一desktop application authority。
11. FD4、FD5、FD6必须绑定同一backend session。
12. apiSessionToken每次backend start轮换。
13. FD5必须完整严格hydrate。
14. 任一credential decrypt失败必须拒绝整个snapshot。
15. local_ready不是trusted owner边界。
16. backend:ready不是trusted owner边界。
17. owner trusted前不得采纳API v2 snapshot。
18. rejected owner必须先撤销API和FD6 authority。
19. fence未释放前不得启动replacement owner。
20. runtime_state是唯一operating mode权威。
21. operatingMode只能是normal或safeMode。
22. operatingModeRevision不得由stateVersion替代。
23. existing authority不得重读Yance27决定mode。
24. Yance27必须只读。
25. 新写入只允许进入Yance29。
26. migration authority和receipt必须原子提交。
27. corrupt legacy不得当作不存在。
28. legacyFallbackUsed必须为false。
29. YANCE_SAFE_MODE不得影响runtime。
30. safe-mode-state.json运行时I/O必须为0。
31. desktop settings和renderer storage不得成为mode authority。
32. SafeModeService不得写mode。
33. runtime.setOperatingMode必须走persistent ledger。
34. apply或publish失败不得报告完整成功。
35. commandId必须绑定唯一normalized envelope。
36. stale fencing token不得写runtime_state。
37. Electron只能使用API v2 snapshot、command和persisted events。
38. backend进程内colon event不是跨进程权威。
39. `/policy`不得在WP6终态修改operating mode。
40. executeLegacy不得成为Electron runtime-control旁路。
41. eventSequence必须持久且单调。
42. event gap必须重新snapshot。
43. old session和old owner响应不得污染新baseline。
44. external worker失败只能改变capability。
45. external worker失败不得触发旧Runtime fallback。
46. direct lifecycle fallback生产可达性必须为0。
47. duplicate runtime entrypoint必须为0。
48. old Runtime source和installed-tree残留必须为0。
49. scan不完整或异常视为FAIL。
50. evidence不得包含credential、session token或秘密hash。
51. 所有上游风险接受记录必须保留。
52. Readiness通过不得解释为WP6已经实施。

---

## 12. required tests

R5固定十项：

1. `electron-api-v2-only.test`
2. `snapshot-reconnect-baseline.test`
3. `event-gap-forces-snapshot.test`
4. `api-v2-contract-mismatch-integration.test`
5. `command-idempotency-integration.test`
6. `backend-crash-recovery.test`
7. `backend-restart-event-sequence-nonrollback.test`
8. `old-runtime-source-scan-zero.test`
9. `old-runtime-installed-tree-scan-zero.test`
10. `duplicate-runtime-entrypoint-scan-zero.test`

追加要求：

- WP0至WP5全量回归
- WP0 gate
- JavaScript syntax check
- source ZIP与Git tree一致性
- fault matrix
- concurrency/crash matrix
- mutation matrix
- Windows installed-tree证据
- 每个关键mutation至少有一个test或evidence oracle

---

## 13. 故障矩阵

| 故障 | 必须行为 | 稳定结果 |
|---|---|---|
| WP5最终决定缺失 | 不解除候选阻断 | `WP5_FINAL_ACCEPTANCE_REQUIRED` |
| WP5 accepted HEAD/tree不匹配 | 阻断Activation | identity mismatch |
| 治理风险ID缺失 | 不应用override | governance block |
| 候选status覆盖正式决定 | 拒绝读取结果 | status precedence violation |
| LegacyRuntimeCutoverGate失败 | 不启动Yance29 backend | fail closed |
| legacy owner identity不明 | 不启动 | owner ambiguous |
| old owner未确认exit | 不启动replacement | exit not confirmed |
| runtime_state存在但receipt无效 | fail closed | receipt invalid |
| legacy候选冲突 | 不选择默认值 | candidate conflict |
| legacy SQLite损坏 | 不当作空源 | source invalid |
| Yance27迁移期间变化 | 不提交authority | source changed |
| FD5 decrypt失败 | 全部拒绝 | no partial hydration |
| READY binding mismatch | reject owner | containment |
| FD6 owner mismatch | reject owner | containment |
| projection mismatch | reject owner | containment |
| owner untrusted时snapshot | 不采纳 | owner trust required |
| snapshot缺operatingModeRevision | 不建立baseline | revision required |
| API旧token | 401 | unauthorized |
| contract mismatch | 副作用前失败 | 426 |
| commandId不同envelope | 拒绝 | reuse mismatch |
| expectedStateVersion冲突 | 无副作用 | state conflict |
| mode apply失败 | 保留recoverable ledger | apply failed |
| mode publish失败 | 保留recoverable ledger | publish failed |
| 多个pending mode command | fail closed | multiple pending |
| event gap | 丢弃增量 | refetch snapshot |
| old owner/event response晚到 | 拒绝 | stale response |
| `/policy`仍改mode | WP6验收失败 | API bypass |
| executeLegacy仍控制runtime | WP6验收失败 | API bypass |
| direct lifecycle fallback可达 | WP6验收失败 | dual path |
| safe-mode file/env fallback恢复 | 回归失败 | legacy fallback |
| Yance27新写入 | 回归失败 | write violation |
| source scan命中旧Runtime | cutover失败 | nonzero |
| installed archive未完整展开 | evidence失败 | scan incomplete |
| scanner异常仍输出zero | evidence失败 | invalid zero |

---

## 14. 并发与崩溃矩阵

1. 同commandId同envelope并发：共享单次副作用。
2. 同commandId不同envelope并发：拒绝冲突请求。
3. mode command处于APPLY_FAILED：阻止第二个mode command。
4. persist后apply前崩溃：使用同revision恢复。
5. apply后publish ACK丢失：恢复publication，不重复apply。
6. lifecycle推进stateVersion：不得误推operatingModeRevision。
7. event retention prune与重启：gap后snapshot恢复。
8. Yance27源在迁移期间变化：不得提交authority。
9. 双backend owner争夺：mutex、lease和fencing共同拒绝stale owner。
10. PID reuse：必须比较process identity。
11. cutover gate与Yance29启动：cutover必须先完成。
12. WP4 owner接受与snapshot：trusted前不得采纳。
13. old session与new response竞态：old全部丢弃。
14. start与credential mutation：application lease串行。
15. restart与FD6 transaction：先exit、recovery、authority ACTIVE。
16. READY与projection validation：owner保持untrusted。
17. rejection与持久化失败：独立fence继续阻断。
18. termination与应用崩溃：多个持久发现源均可触发fail closed。
19. command commit与backend crash：persistent ledger确认。
20. credential commit与backend crash：FD6 QUERY和journal恢复。
21. external capability event与snapshot：按persisted sequence处理。
22. stop与startup handshake：未确认exit不得报告成功。
23. 两个restart：coordinator串行，只能产生一个replacement。
24. 治理读取竞态：先固定final decision和identity，再解析候选status。

---

## 15. mutation计划

### 15.1 治理读取

- 删除WP5_ACCEPTED override。
- 让wp5Accepted=false覆盖最终决定。
- 忽略accepted HEAD/tree。
- 不要求治理风险ID。
- 用候选downstream status覆盖正式状态。

### 15.2 Owner和凭据

- owner trusted前采纳snapshot。
- 跳过FD6 active检查。
- 跳过projection validation。
- owner registry写失败后仍成功。
- rejection时先做可失败持久化，后撤销API/FD6。
- fence未释放允许restart。
- real exit未确认启动replacement。
- 只比较PID。

### 15.3 Authority和revision

- 用stateVersion替代operatingModeRevision。
- lifecycle更新错误推进mode revision。
- mode persist不推进revision。
- snapshot删除operatingModeRevision。
- 忽略ledger/authority revision mismatch。

### 15.4 Migration

- existing authority重新读取Yance27。
- receipt缺失时fresh initialize。
- 接受多个receipt。
- 忽略source fingerprint和file count。
- 忽略before/after变化。
- corrupt legacy当不存在。
- 冲突候选选择第一个。
- 对Yance27写入。

### 15.5 Command和event

- timeout后生成新commandId。
- same ID不同payload仍执行。
- duplicate request重复副作用。
- 忽略expectedStateVersion。
- apply失败报告成功。
- publish失败报告成功。
- event gap后继续增量。
- restart时eventSequence清零。
- old-session response污染新baseline。

### 15.6 API cutover

- Renderer继续通过`POST /policy`改mode。
- Electron通过executeLegacy改mode。
- API v2失败回退legacy path。
- preload暴露runtime内部对象。
- 进程内colon event成为Electron authority。
- main.js direct launch/stop/restart仍可达。
- DesktopHost direct control/reset仍可达。
- 新增第二runtime control IPC/HTTP endpoint。

### 15.7 Safe mode和scan

- 恢复YANCE_SAFE_MODE。
- 恢复safe-mode-state.json。
- desktopSettings持久化safeMode。
- renderer storage fallback。
- legacyFallbackUsed=true。
- 大小写变体和dynamic require规避扫描。
- app.asar.unpacked或nested archive保留旧Runtime。
- scanner异常仍返回zero。

---

## 16. evidence schema

固定输出：

1. `evidence/wp6/electron-api-v2-cutover.json`
2. `evidence/wp6/event-gap-recovery.json`
3. `evidence/wp6/backend-crash-recovery.json`
4. `evidence/wp6/old-runtime-removal.json`
5. `evidence/wp6/runtime-entrypoint-inventory.json`

### 16.1 通用envelope

每个文件必须包含：

```json
{
  "schemaVersion": 1,
  "stage": "6.4.5.9",
  "phase": "core-runtime-p1",
  "workPackage": "WP6",
  "evidenceType": "",
  "generatedAtUtc": "",
  "status": "PASS|FAIL",
  "sourceIdentity": {
    "implementationCommit": "",
    "candidateHead": "",
    "sourceTree": "",
    "repositoryClean": true
  },
  "upstreamBindings": {
    "WP4": {
      "bindingStatus": "BOUND_TO_WP4_ACCEPTED_FINAL_DELIVERY",
      "acceptedHead": "2b929258c4d51c10a4dc49e90fcecf8b9f8170c4",
      "acceptedSourceTree": "8de896200f82a65d22a7d15db78cd83f813188bf"
    },
    "WP5": {
      "bindingStatus": "BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY",
      "acceptedHead": "c4d5a641e93c600c0199e9960fe8f570faa07808",
      "acceptedSourceTree": "b6ece87673d804686bd231858097f6561ff1b200",
      "finalAcceptanceStatus": "WP5_ACCEPTED"
    }
  },
  "riskAcceptances": [],
  "requiredTests": [],
  "invariants": [],
  "mutationOracleExecution": [],
  "failedReasonCodes": [],
  "secretMaterialPresent": false
}
```

### 16.2 WP5治理规范化

必须记录：

- 风险ID
- formalDecision=`WP5_ACCEPTED`
- 检测到的候选期字段
- override是否应用
- accepted HEAD/tree是否匹配
- productionImpact=false

### 16.3 electron-api-v2-cutover.json

必须记录：

- API v2三个endpoint
- API session和contract验证
- trusted owner边界
- FD4/FD5/FD6绑定
- runtime projection验证
- snapshot authority triple
- operating mode mutation所有call sites
- `/policy` mode call sites
- executeLegacy runtime-control call sites
- process-local event authority call sites
- direct lifecycle fallback inventory
- coordinator bypass count
- API v2 bypass count
- credential secret payload=false
- legacyFallbackUsed=false

PASS门槛：

```text
apiV2BypassCount=0
policyModeControlCount=0
legacyExecuteModeControlCount=0
directLifecycleFallbackReachableCount=0
coordinatorBypassCount=0
legacyFallbackUsed=false
```

### 16.4 event-gap-recovery.json

必须记录：

- owner trusted
- backendStartInstance和ownerSession
- stateVersion before/after
- operatingModeRevision before/after
- lastEventSequence before/after
- injected gap
- gap后未应用事件数
- incremental baseline丢弃
- snapshot refetch
- old owner poll取消
- stale response拒绝
- recovered authority triple

### 16.5 backend-crash-recovery.json

必须记录：

- old/new backend identity非秘密字段
- token rotated布尔值
- API authority先撤销
- FD6先关闭
- application fence安装
- real exit确认
- owner-exit recovery
- pending mode command状态
- committed operatingModeRevision
- same commandId recovery
- duplicate side effect count
- new owner accepted trusted
- eventSequence nonrollback
- Windows evidence limitation

### 16.6 old-runtime-removal.json

必须记录：

- exact old paths
- semantic role patterns
- dynamic require/import scan
- `/policy` mode hits
- executeLegacy runtime-control hits
- direct lifecycle fallback hits
- safe-mode file/env hits
- desktop/renderer authority hits
- Yance27 write hits
- source roots和installed roots
- archive展开格式
- case/symlink处理
- scanComplete
- scannerErrors
- source/installed hit counts

zero只有在完整扫描且scannerErrors为空时有效。

### 16.7 runtime-entrypoint-inventory.json

必须记录：

- CredentialAuthorityLifecycleCoordinator constructors
- CredentialVaultHost constructors
- DesktopCredentialApplicationCoordinator constructors
- BackendProcessHost constructors
- AppRuntime constructors/factories
- LifecycleStateMachine constructors
- RuntimeAuthorityMigrationCoordinator constructors
- OperatingModeTransitionGateway constructors
- RuntimeStateStore direct writers
- API v2 command handlers
- `/policy` mode handlers
- executeLegacy handlers
- preload/renderer consumers
- allowed production composition root
- direct fallback call sites
- duplicate executable entrypoints

---

## 17. Convergence Pre-Review轻量包

WP6实施候选只允许先提交：

- Git bundle
- complete patch
- implementation commit
- implementation source tree
- changed-files manifest
- upstream-binding.json
- 十项required tests
- WP0至WP5回归
- fault matrix
- concurrency/crash matrix
- mutation matrix
- 五个evidence JSON
- source scan
- installed-tree fixture或真实产物scan
- developer adversarial review
- known limitations和risk declarations

不得生成完整Final Packaging。

---

## 18. Final Packaging出口

只有收到：

`WP6_PREACCEPTED_FOR_FINAL_PACKAGING`

后才允许生成：

- candidate binding commit
- Final Delivery HEAD
-完整Source ZIP
-完整Test Artifacts ZIP
-完整Delivery ZIP
- Delivery JSON
- SHA256清单

最终出口必须满足：

- final implementation commit冻结
- 五个evidence PASS
- 十项required tests PASS
- WP0至WP5回归和WP0 gate PASS
- fault、concurrency和mutation PASS
- source scan zero
- installed-tree scan zero
- duplicate entrypoint zero
- API v2 bypass zero
- direct lifecycle fallback zero
- legacyFallbackUsed=false
- risk acceptance全部保留
- Source ZIP与Git tree逐文件一致
- 所有产物绑定同一Final Delivery HEAD/tree
- WP6独立审核前仍为ACTIVE/PENDING_INDEPENDENT_REVIEW
- WP7在WP6接受前仍未激活

---

## 19. 当前正式结论

WP6全部正式上游依赖已经绑定。

未发现阻止创建独立Activation治理提交的上游合同冲突。

当前只允许下一步创建独立的WP6 Activation commit，父提交必须精确为：

`c4d5a641e93c600c0199e9960fe8f570faa07808`

`WP6_READY_FOR_ACTIVATION`
