# 言策29 Stage 6.4.5.9
# WP6_ACTIVATION_READINESS_REBIND

## 0. 文档性质

本文件只完成 WP6 正式激活前的最终上游重绑定与设计核验。

本次没有：

- 修改生产代码
- 修改正式 `project-handoff.json`
- 修改正式 `work-package-status.json`
- 自动激活 WP6
- 生成 WP6 implementation commit
- 生成 WP6 candidate binding commit
- 生成 WP6 Final Delivery HEAD
- 生成 WP6 Delivery ZIP
- 将 WP6 描述为已经开始实施

最终决定：

`WP6_READY_FOR_ACTIVATION`

该决定只表示 WP6 已满足正式激活入口条件。WP6 当前仍未激活。

---

## 1. 权威状态与读取优先级

### 1.1 WP5正式接受决定

本次正式独立审核决定以项目所有者明确签发为权威：

`WP5_ACCEPTED`

WP5正式接受身份：

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

### 1.2 状态读取优先级

WP6机器读取必须使用以下优先级：

1. WP5最终独立审核决定 `WP5_ACCEPTED`
2. 本次明确签发的正式接受身份
3. WP5风险接受记录
4. Accepted Final Delivery HEAD和source tree
5. Final Packaging验证结果
6. Final Delivery包内候选期`project-handoff.json`
7. Final Delivery包内候选期`work-package-status.json`
8. R5-WP7阶段参考材料

任何较低优先级字段不得覆盖`WP5_ACCEPTED`。

### 1.3 当前有效正式投影

在不修改正式状态文件的前提下，本次Readiness判断使用以下有效投影：

```text
WP5:
  status: COMPLETED
  active: false
  reviewStatus: ACCEPTED
  finalAcceptanceStatus: WP5_ACCEPTED
  acceptedFinalDeliveryHead:
    c4d5a641e93c600c0199e9960fe8f570faa07808
  acceptedSourceTree:
    b6ece87673d804686bd231858097f6561ff1b200

WP6:
  status: READY_FOR_ACTIVATION
  active: false
  activationAllowed: true

WP7:
  status: BLOCKED_BY_WP6
  active: false

activeWorkPackages:
  []

lastCompletedWorkPackage:
  WP5
```

这只是激活前Readiness投影，不是对正式状态文件的写入。

---

## 2. 来源核验

### 2.1 已重新读取

- WP0最终接受源码包
- WP1最终接受源码包
- WP2最终接受源码包
- WP3最终接受源码包
- WP4最终接受源码包
- WP5最终接受源码包
- R5-WP7阶段参考包
- WP5包内`implementation/project-handoff.json`
- WP5包内`implementation/work-package-status.json`
- `WP5_FINAL_DELIVERY.json`
- `WP5_FINAL_PACKAGING_VALIDATION_SUMMARY.json`
- WP5 Convergence Pre-Review决定
- 本次正式`WP5_ACCEPTED`决定
- WP5风险接受记录

### 2.2 WP5交付身份独立核验

```text
Outer accepted-source ZIP SHA256:
941304bc19d65281425145caf6adfb7aa0cdd5d004145bf8e08e713380464e84

WP5_FINAL_DELIVERY.json SHA256:
a56dd1809d05d9123e07421655d861cbfc6d0af86212dc74f2332fb0ced0af18

WP5_FINAL_PACKAGING_VALIDATION_SUMMARY.json SHA256:
e057c66b8c3ffd0a70e4d6bb57f96763fd700b1f9b01dd9d03204892093e5431
```

核验结果：

- 所有来源ZIP压缩完整性：PASS
- Git bundle完整历史：PASS
- bundle HEAD：
  `c4d5a641e93c600c0199e9960fe8f570faa07808`
- bundle tree：
  `b6ece87673d804686bd231858097f6561ff1b200`
- Git fsck：PASS
- repository clean：PASS
- tracked files：562
- Source ZIP与Git tree：562/562一致
- missing：0
- mismatch：0
- extra：0
- patch reconstruction：PASS_EXACT_FINAL_TREE
- WP5 required tests：42/42 PASS
- fault matrix：18/18 PASS
- concurrency/crash matrix：10/10 PASS
- mutation matrix：24/24 killed
- Windows legacy runtime cutover：4/4 PASS
- WP4 regression：158/158 PASS
- WP3 regression：22/23 PASS，1项为既有已接受Windows skip
- WP2 regression：60/60 PASS
- WP1 regression：24/24 PASS
- WP0 regression：16/16 PASS
- WP0 gate：4/4 PASS

---

## 3. WP5治理字段不一致风险

### 3.1 风险接受记录

```text
RiskAcceptanceId:
WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED
```

接受范围仅限Final Packaging治理元数据不一致：

- `project-handoff.json`的`purpose`仍为`WP5_ACTIVATION_HANDOFF`
- `project-handoff.json.downstream.WP5.reviewStatus`仍为`IMPLEMENTATION_IN_PROGRESS`
- `currentWp5.reviewStatus`为`PENDING_INDEPENDENT_REVIEW`
- `work-package-status.json`仍把WP5标记为ACTIVE
- Final Delivery元数据仍有`wp5Accepted=false`
- WP6仍在候选期字段中标记为`BLOCKED_BY_WP5`

风险被接受的理由：

- 不影响生产代码
- 不影响SQLite数据库和runtime_state
- 不影响迁移逻辑
- 不影响operating mode权威
- 不影响Windows cutover
- 不影响Git身份
- 不影响Source ZIP一致性
- 不影响required tests、fault、concurrency或mutation结果

### 3.2 对WP6机器读取的约束

WP6激活工具不得直接用以下候选期字段作最终结论：

```text
wp5Accepted=false
WP5.status=ACTIVE
WP5.reviewStatus=PENDING_INDEPENDENT_REVIEW
WP6.status=BLOCKED_BY_WP5
purpose=WP5_ACTIVATION_HANDOFF
downstream.WP5.reviewStatus=IMPLEMENTATION_IN_PROGRESS
```

必须先应用：

```text
formalDecisionOverride = WP5_ACCEPTED
```

然后校验：

```text
acceptedHead == c4d5a641e93c600c0199e9960fe8f570faa07808
acceptedSourceTree == b6ece87673d804686bd231858097f6561ff1b200
riskAcceptanceId == WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED
```

只有三项同时满足，才可把候选期阻断字段视为已被正式决定覆盖。

### 3.3 风险边界

该风险接受不允许：

- 忽略Git HEAD或tree不匹配
- 忽略生产代码差异
- 忽略测试失败
- 忽略WP5 runtime_state合同冲突
- 忽略迁移receipt不一致
- 忽略WP5 accepted identity之外的包
- 在没有`WP5_ACCEPTED`决定时自行解除阻断

---

## 4. WP5正式实现绑定

原所有：

`PROVISIONAL_PENDING_WP5_ACCEPTANCE`

现改为：

`BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY`

绑定身份：

```text
acceptedHead:
c4d5a641e93c600c0199e9960fe8f570faa07808

acceptedSourceTree:
b6ece87673d804686bd231858097f6561ff1b200
```

---


## 4.1 已关闭的PROVISIONAL项

以下原Readiness临时项现已正式关闭：

| 原临时项 | 正式关闭依据 | 当前绑定 |
|---|---|---|
| WP4 credential authority合同 | `WP4_ACCEPTED`及Accepted Final Delivery身份 | `BOUND_TO_WP4_ACCEPTED_FINAL_DELIVERY` |
| WP4 owner acceptance与FD4/FD5/FD6合同 | WP4最终接受源码与独立审核 | 已固定 |
| WP4 local_ready、trusted owner、containment顺序 | WP4最终接受实现 | 已固定 |
| WP5 runtime_state operating mode权威 | `WP5_ACCEPTED`及Accepted Final Delivery身份 | `BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY` |
| WP5 operatingModeRevision与命令ledger | WP5最终接受实现 | 已固定 |
| WP5 Yance27只读迁移和receipt | WP5最终接受实现 | 已固定 |
| WP5 LegacyRuntimeCutoverGate | WP5最终接受实现 | 已固定 |
| WP5 safe-mode fallback移除 | WP5最终接受实现和Windows cutover evidence | 已固定 |
| WP5治理字段最终状态 | `WP5_ACCEPTED`决定与风险接受覆盖 | 已关闭为已接受治理风险 |
| WP6上游父提交 | WP5 Accepted Final Delivery HEAD | 固定为`c4d5a641e93c600c0199e9960fe8f570faa07808` |

Readiness材料中不得再出现：

`PROVISIONAL_PENDING_WP5_ACCEPTANCE`

所有WP5依赖统一登记为：

`BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY`

## 4.2 仍保留的UNPROVEN或UNKNOWN项

Readiness通过不等于以下事项已经实施或通过。它们继续保持未证明状态：

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| WP6生产代码实现 | `UNPROVEN_NOT_IMPLEMENTED` | WP6正式激活后完成实现并冻结implementation commit |
| Electron全部runtime控制切换至API v2 | `UNPROVEN` | `electron-api-v2-only.test`及cutover evidence通过 |
| `/policy` operating mode控制清零 | `UNPROVEN` | source和installed-tree旁路扫描为0 |
| `AppRuntime.executeLegacy`对Electron runtime control不可达 | `UNPROVEN` | call-site与动态路径扫描为0 |
| WP4 direct lifecycle fallback在WP6终态清零 | `UNPROVEN` | coordinator bypass和direct fallback reachability为0 |
| Snapshot/event gap恢复的WP6生产集成 | `UNPROVEN` |对应required tests和evidence通过 |
| Command持久幂等与崩溃恢复的WP6集成 | `UNPROVEN` | command和crash required tests通过 |
| old Runtime源码树残留为0 | `UNPROVEN` | source scan complete且hit count为0 |
| installed runtime tree残留为0 | `UNPROVEN` | app.asar、unpacked、resources和nested archives完整扫描为0 |
| duplicate runtime entrypoint为0 | `UNPROVEN` | inventory evidence完整且duplicate count为0 |
| WP6 mutation计划全部被杀死 | `UNPROVEN` | mutation matrix执行完成且0 survivor |
| WP6五个evidence JSON | `UNPROVEN_NOT_GENERATED` | Convergence Pre-Review候选生成 |
| WP6 required tests | `UNPROVEN_NOT_EXECUTED` | WP6 implementation候选执行 |
| WP0至WP5回归在WP6最终实现上的结果 | `UNPROVEN_NOT_EXECUTED` | WP6候选全量回归 |
| Windows installed-tree真实产物扫描 | `UNPROVEN_NOT_EXECUTED` | WP6 Windows证据生成 |
| WP4 Windows reboot/PID reuse完整实机证据 | `UNKNOWN_ACCEPTED_UPSTREAM_EXCEPTION` | 仅由后续正式风险关闭决定解除 |
| WP6 Final Packaging | `UNPROVEN_NOT_AUTHORIZED` | 先收到`WP6_PREACCEPTED_FOR_FINAL_PACKAGING` |
| WP6最终独立审核 | `UNPROVEN_NOT_STARTED` | 完整Final Packaging后由独立审核签发 |

任何机器读取器必须保留这些状态，不得把：

`WP6_READY_FOR_ACTIVATION`

解释为：

- WP6 implementation已存在
- required tests已通过
- evidence已生成
- Convergence Pre-Review已通过
- Final Packaging已授权
- WP6已完成或已接受


## 5. WP5真实模块、接口、事件与状态

## 5.1 Operating mode唯一权威

正式模块：

- `backend/runtime/OperatingMode.js`
- `backend/runtime/OperatingModeTransitionGateway.js`
- `backend/runtime/RuntimeStateStore.js`
- `backend/runtime/RuntimeAuthorityMigrationCoordinator.js`
- `backend/runtime/BootCoordinator.js`
- `backend/runtime/AppRuntime.js`

唯一权威：

```text
database: Yance29 SQLite
table: runtime_state
column: operating_mode
revision: operating_mode_revision
```

合法值：

```text
normal
safeMode
```

重要修订：

- `operating_mode_revision`是operating mode提交修订号
- `state_version`是全局runtime状态版本
- 两者不得被当作始终相等
- lifecycle或capability事件可推进`state_version`，而不改变`operating_mode_revision`
- operating mode恢复必须绑定`operating_mode_revision`

## 5.2 Operating mode命令接口

API v2命令：

```text
commandType:
runtime.setOperatingMode
```

命令合同：

- `contractVersion=2`
- UUID commandId
- expectedStateVersion
- issuedAtUtc
- payload.operatingMode
- payload.reason

持久命令状态：

```text
PERSISTED
APPLY_FAILED
APPLIED
PUBLISH_FAILED
PUBLISHED
RECOVERY_BLOCKED
```

处理顺序：

```text
persist authority
  -> apply production state
  -> publish
  -> terminal response
```

失败语义：

- apply失败：不得报告完整成功
- publish失败：不得报告完整成功
- 同commandId同envelope：恢复或重放同一结果
- 同commandId不同envelope：`COMMAND_ID_REUSE_MISMATCH`
- state version不匹配：`STATE_VERSION_CONFLICT`
- 存在未终结mode command：`OPERATING_MODE_RECOVERY_REQUIRED`
- 多个待恢复命令：`OPERATING_MODE_MULTIPLE_PENDING_COMMANDS`
- ledger与authority不一致：`OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH`

## 5.3 持久事件

API v2持久事件包括：

```text
runtime.authority_initialized
runtime.owner_acquired
runtime.state_changed
runtime.state_updated
runtime.command_applied
runtime.command_ping
runtime.stop_requested
runtime.operating_mode_persisted
runtime.operating_mode_applied
runtime.operating_mode_published
runtime.external_capabilities_updated
```

必须区分：

```text
runtime.operating_mode_*
```

是SQLite `runtime_event`中的API v2持久事件。

```text
runtime:operating-mode-authority
```

是backend进程内EventBus发布事件，不得作为Electron跨进程唯一权威事件源。

WP6 Electron必须以snapshot和`runtime_event`序列为权威，不能依赖进程内colon事件。

## 5.4 Snapshot正式字段

API v2 snapshot包括：

- contractVersion
- buildId
- stateVersion
- lastEventSequence
- runtime.lifecycleState
- runtime.operatingMode
- runtime.operatingModeRevision
- runtime.ownerInstanceId
- runtime.fencingToken
- runtime.localReady
- capabilities
- diagnosticsSummary
- credentialHydration非秘密元数据
- localCriticalWorkers
- externalWorkers

WP6必须同时保存：

```text
stateVersion
operatingModeRevision
lastEventSequence
backendStartInstance
ownerSession
```

## 5.5 Runtime authority迁移

正式模块：

`backend/runtime/RuntimeAuthorityMigrationCoordinator.js`

启动顺序：

```text
ownership acquired
  -> ensure runtime authority
  -> runtime_state_ready
```

如果Yance29已有runtime_state：

- 只验证当前authority和receipt
- 不重新读取Yance27来决定mode
- `legacyRead=false`

如果Yance29尚无runtime_state：

- 只读取精确Yance27 root
- Yance27以只读方式检查
- 读取前后文件身份必须完全一致
- sourceMutationCount必须为0
- 冲突候选必须阻断
- 无效mode必须阻断
- 损坏SQLite必须阻断
- authority初始化和migration receipt必须在同一事务中完成

迁移receipt表：

`runtime_migration_receipt`

关键绑定：

- migrationId
- migrationVersion
- sourceCanonicalPath
- sourceFingerprint
- sourceFileCount
- sourceTotalBytes
- targetSchemaVersion
- status=COMMITTED
- selectedOperatingMode
- candidates
- verification before/after
- ownerInstanceId
- fencingToken
- startedAtUtc
- completedAtUtc

## 5.6 Legacy owner cutover

正式模块：

`electron/desktopHost/LegacyRuntimeCutoverGate.js`

该门禁在Electron创建正式DesktopHost和启动Yance29 backend之前执行。

成功状态：

```text
LEGACY_OWNER_CLEARED
LEGACY_OWNER_EXIT_CONFIRMED
```

阻断原因包括：

```text
WP5_LEGACY_OWNER_REGISTRY_INVALID
WP5_LEGACY_OWNER_AMBIGUOUS
WP5_LEGACY_OWNER_TERMINATION_EPERM
WP5_LEGACY_OWNER_SIGTERM_FAILED
WP5_LEGACY_OWNER_SIGKILL_FAILED
WP5_LEGACY_OWNER_EXIT_NOT_CONFIRMED
WP5_LEGACY_OWNER_EXIT_AMBIGUOUS
```

规则：

- PID存在不足以证明owner身份
- PID reuse可被识别为旧owner已释放
- 活owner身份不明确时fail closed
- SIGTERM后仍活可使用SIGKILL
- 未确认真实exit时禁止Yance29启动
- 不修改Yance27 owner registry

## 5.7 Yance27迁移与写路径

正式模块：

- `electron/legacyDataRoots.js`
- `backend/services/legacyRootDiscovery.js`
- `backend/services/migrationService.js`

约束：

- discovery policy为`EXACT_YANCE27_ONLY`
- 不接受环境变量扩展legacy roots
- 不执行宽泛sibling scan
- Yance27只读
- 所有新runtime写入只进入Yance29
- observedWriteRoots只能是`Yance29`
- legacyWriteCount必须为0

## 5.8 Safe mode fallback关闭

正式模块：

- `backend/services/safeModeService.js`
- `backend/services/systemPolicy.js`
- `shared/desktopSettings.js`
- `frontend/r32-settings-routing.js`
- `frontend/r32-settings-recovery.js`
- `frontend/r32-system-center.js`

合同：

- `safeModeService`只是只读兼容投影
- `safeModeService.enter/clear`必须拒绝
- `systemPolicy.safeMode`不能成为持久权威
- desktop settings不能持久化safeMode
- localStorage/IndexedDB不能成为mode权威
- `YANCE_SAFE_MODE`不得影响runtime
- `safe-mode-state.json`运行时读写为零
- `legacyFallbackUsed=false`

---

## 6. 对WP6设计的正式修订

### 6.1 全部WP5临时绑定关闭

原章节中所有：

`PROVISIONAL_PENDING_WP5_ACCEPTANCE`

均改为：

`BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY`

### 6.2 Snapshot基线增加operatingModeRevision

旧设计只强调stateVersion和lastEventSequence。

修订后必须绑定：

```text
stateVersion
operatingModeRevision
lastEventSequence
```

不得使用当前全局stateVersion替代mode authority revision。

### 6.3 Operating mode恢复状态机纳入WP6

WP6必须识别：

```text
PERSISTED
APPLY_FAILED
APPLIED
PUBLISH_FAILED
PUBLISHED
RECOVERY_BLOCKED
```

在前一mode command未达到可证明终态前，不得启动另一个mode command。

### 6.4 API v2事件源边界修订

Electron只能消费：

- API v2 snapshot
- API v2 command response
- SQLite-backed API v2 events

Electron不得依赖backend进程内：

`runtime:operating-mode-authority`

作为跨进程权威。

### 6.5 旧`/policy`控制路径列入WP6切换范围

WP5正式实现仍保留：

```text
POST /policy
  -> legacy coreExecute
  -> recovery.enterSafeMode / recovery.clearSafeMode
  -> AppRuntime.executeLegacy
```

这不是WP5合同冲突，因为WP5任务是收口权威，而WP6任务才是API v2 cutover。

WP6必须把该路径迁移为：

```text
POST /api/app/v2/commands
commandType=runtime.setOperatingMode
```

WP6 Final Exit前：

- Renderer不得通过`/policy`修改safe mode
- Electron不得通过旧core execute修改runtime
- `POST /policy`可以保留非mode policy字段，但不得再控制operating mode
- 所有runtime控制旁路计数必须为0

### 6.6 Legacy execute链列入旁路扫描

WP5正式实现仍有`AppRuntime.executeLegacy()`，用于既有业务命令。

WP6不得把“该函数存在”自动视为上游冲突，但必须证明：

- Electron runtime control不调用它
- preload不暴露它
- renderer operating mode不调用它
- stop/restart/runtime lifecycle不调用它
- API v2失败时不回退到它

### 6.7 Cutover门禁前置

WP6 Electron API v2 baseline建立前必须同时满足：

1. WP4 credential authority ACTIVE
2. WP4 owner accepted trusted
3. WP5 LegacyRuntimeCutoverGate成功
4. WP5 runtime authority验证通过
5. migration receipt验证通过
6. `legacyFallbackUsed=false`
7. snapshot authority三元组有效
8. API session和contract匹配

---

## 7. WP6入口条件最终核验

| 条件 | 状态 |
|---|---|
| WP0正式接受基线已固定 | PASS |
| WP1正式接受基线已固定 | PASS |
| WP2正式接受及风险记录已固定 | PASS |
| WP3正式接受及风险记录已固定 | PASS |
| WP4正式接受身份已绑定 | PASS |
| WP4风险接受限制已保留 | PASS |
| WP5正式决定为WP5_ACCEPTED | PASS |
| WP5 accepted HEAD匹配 | PASS |
| WP5 accepted tree匹配 | PASS |
| WP5 bundle/source/patch身份一致 | PASS |
| WP5 runtime_state唯一权威 | PASS |
| WP5 legacyFallbackUsed=false | PASS |
| WP5 Yance27只读 | PASS |
| WP5 Yance29-only写入 | PASS |
| WP5 safe-mode fallback关闭 | PASS |
| WP5 Windows cutover evidence | PASS |
| WP5治理字段不一致风险已正式接受 | PASS_WITH_ACCEPTED_GOVERNANCE_RISK |
| 未发现WP5生产合同冲突 | PASS |
| WP6尚未自动激活 | PASS |

WP6激活提交必须满足：

```text
parent commit:
c4d5a641e93c600c0199e9960fe8f570faa07808
```

激活提交只能更新正式激活所需治理字段和Readiness绑定，不得在同一提交混入WP6生产实现。

---

## 8. 更新后的WP6治理状态机

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

## 9. 更新后的WP6运行状态机

### 9.1 Authority建立

```text
NO_RUNTIME_AUTHORITY
  -> LEGACY_OWNER_CUTOVER
  -> OWNERSHIP_ACQUIRED
  -> MIGRATION_SOURCE_VALIDATED
  -> AUTHORITY_AND_RECEIPT_COMMITTED
  -> RUNTIME_AUTHORITY_VALIDATED
  -> RUNTIME_STATE_READY
```

已有authority时：

```text
OWNERSHIP_ACQUIRED
  -> EXISTING_AUTHORITY_VALIDATED
  -> NO_LEGACY_REREAD
  -> RUNTIME_STATE_READY
```

### 9.2 Owner与API基线

```text
RUNTIME_STATE_READY
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

### 9.3 Operating mode命令

```text
IDLE
  -> ENVELOPE_VALIDATED
  -> AUTHORITY_PERSISTED
  -> PERSISTED
  -> APPLYING
  -> APPLIED
  -> PUBLISHING
  -> PUBLISHED
```

失败恢复：

```text
APPLY_FAILED
PUBLISH_FAILED
RECOVERY_BLOCKED
```

同一commandId只能恢复同一envelope。

### 9.4 Event gap恢复

```text
POLLING_EVENTS
  -> EVENT_GAP_DETECTED
  -> INCREMENTAL_BASELINE_DISCARDED
  -> TRUSTED_OWNER_REVALIDATED
  -> SNAPSHOT_REFETCHED
  -> AUTHORITY_TRIPLE_REBOUND
  -> POLLING_EVENTS
```

---

## 10. 更新后的不可破坏不变量

1. WP6激活父提交必须精确为WP5 Accepted Final Delivery HEAD。
2. WP6激活前不得修改生产代码。
3. `WP5_ACCEPTED`优先于包内候选期治理字段。
4. WP5治理风险覆盖只限已接受字段不一致。
5. WP5 accepted HEAD/tree不匹配时不得应用治理覆盖。
6. runtime_state是唯一operating mode权威。
7. operatingMode只能是normal或safeMode。
8. operatingModeRevision不得用全局stateVersion替代。
9. existing Yance29 authority不得重读Yance27决定mode。
10. Yance27必须保持只读。
11. 新写入必须只进入Yance29。
12. migration authority和receipt必须原子提交。
13. receipt缺失、重复、不完整或身份不匹配必须fail closed。
14. corrupt legacy不得按不存在处理。
15. `legacyFallbackUsed`必须始终为false。
16. `YANCE_SAFE_MODE`不得影响runtime。
17. `safe-mode-state.json`运行时读写必须为0。
18. desktop settings不得持久化safeMode。
19. renderer storage不得成为mode权威。
20. system-policy不得成为mode权威。
21. SafeModeService不得写mode。
22. runtime.setOperatingMode必须经过persistent command ledger。
23. apply失败不得报告完整成功。
24. publish失败不得报告完整成功。
25. 一个未终结mode command存在时不得接受另一个mode command。
26. commandId必须绑定唯一normalized envelope digest。
27. stale fencing token不得写runtime_state。
28. Electron不得使用backend进程内EventBus作为跨进程权威。
29. Electron runtime control必须只走API v2。
30. `/policy`不得在WP6终态控制operating mode。
31. legacy execute不得成为Electron runtime control旁路。
32. LegacyRuntimeCutoverGate未成功时不得启动Yance29 backend。
33. live legacy owner身份不明确时必须fail closed。
34. old owner真实退出未确认时不得启动新owner。
35. WP4 trusted owner边界继续有效。
36. event gap必须重新snapshot。
37. old session和old owner响应不得污染新baseline。
38. API v2 snapshot必须包含有效operatingModeRevision。
39. WP2、WP3、WP4和WP5风险接受记录必须全部保留。
40. Readiness决定不得被解释为WP6已经开始实施。

---

## 11. 更新后的故障矩阵

| 故障 | 必须行为 | 结果 |
|---|---|---|
| 未找到WP5_ACCEPTED决定 | 不解除候选期阻断 | `WP5_FINAL_ACCEPTANCE_REQUIRED` |
| WP5 accepted HEAD不匹配 | 阻断激活 | `WP5_ACCEPTED_HEAD_MISMATCH` |
| WP5 accepted tree不匹配 | 阻断激活 | `WP5_ACCEPTED_TREE_MISMATCH` |
| 未登记WP5治理风险 | 阻断机器覆盖 | `WP5_GOVERNANCE_RISK_BINDING_REQUIRED` |
| 直接读取wp5Accepted=false | 应用正式决定覆盖 | 不得错误阻断 |
| downstream状态覆盖正式决定 | 拒绝该读取结果 | `STATUS_PRECEDENCE_VIOLATION` |
| runtime_state缺失且receipt不完整 | fail closed | migration failure |
| runtime_state存在但receipt缺失 | fail closed | `RUNTIME_MIGRATION_RECEIPT_INVALID` |
| receipt fingerprint不匹配 | fail closed | `RUNTIME_MIGRATION_RECEIPT_MISMATCH` |
| legacy候选冲突 | 不选择默认值 | `LEGACY_RUNTIME_CANDIDATE_CONFLICT` |
| corrupt legacy SQLite | 不当作空源 | `LEGACY_RUNTIME_SOURCE_INVALID` |
| Yance27迁移期间变化 | 阻断 | `LEGACY_RUNTIME_SOURCE_CHANGED` |
| legacy owner registry损坏 | 阻断backend启动 | `WP5_LEGACY_OWNER_REGISTRY_INVALID` |
| live legacy owner身份不明 | 阻断backend启动 | `WP5_LEGACY_OWNER_AMBIGUOUS` |
| old owner未退出 | 阻断backend启动 | `WP5_LEGACY_OWNER_EXIT_NOT_CONFIRMED` |
| snapshot缺operatingModeRevision | 不建立baseline | `SNAPSHOT_OPERATING_MODE_REVISION_REQUIRED` |
| global stateVersion推进但mode revision不变 | 保留mode revision | 正常 |
| command expectedStateVersion冲突 | 无副作用 | `STATE_VERSION_CONFLICT` |
| commandId不同envelope | 拒绝 | `COMMAND_ID_REUSE_MISMATCH` |
| mode apply失败 | 保留recoverable ledger | `OPERATING_MODE_APPLY_FAILED` |
| mode publish失败 | 保留recoverable ledger | `OPERATING_MODE_PUBLISH_FAILED` |
| 多个pending mode command | fail closed | `OPERATING_MODE_MULTIPLE_PENDING_COMMANDS` |
| ledger与authority revision不一致 | 不apply | `OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH` |
| event gap | 丢弃增量并snapshot | `EVENT_SEQUENCE_GAP` |
| `/policy`仍控制safeMode | WP6最终验收失败 | API v2 bypass |
| Electron调用executeLegacy控制runtime | WP6最终验收失败 | API v2 bypass |
| safe-mode file/env fallback恢复 | WP6回归失败 | legacy fallback |
| Yance27出现新写入 | WP6回归失败 | write-path violation |

---

## 12. 更新后的并发与崩溃矩阵

1. 同commandId并发且envelope相同：
   - 共享单次in-flight apply和publish
   - 不重复副作用

2. 同commandId并发但envelope不同：
   - 一个可继续
   - 另一个必须`COMMAND_ID_REUSE_MISMATCH`

3. 第一个mode command处于APPLY_FAILED：
   - 不允许第二个不同command开始
   - 原command恢复到终态

4. persist后、apply前崩溃：
   - 重启后按operatingModeRevision恢复
   - 不创建新revision

5. apply后、publish ACK丢失：
   - 重启后恢复publication
   - 外部响应等于持久终态结果

6. lifecycle事件推进stateVersion：
   - 不改变operatingModeRevision
   - reconcile不得误判ledger mismatch

7. event retention prune与重启：
   - operatingModeRevision保持
   - gap通过snapshot恢复

8. Yance27源迁移期间变化：
   - before/after不一致即阻断
   - 不提交authority

9. 两个backend owner争夺写入：
   - Named Mutex、runtime lease和fencing共同限制
   - stale owner不能commit

10. legacy owner退出与PID reuse：
    - 以进程identity而非PID单值判断
    - identity mismatch可判定旧owner已释放

11. legacy cutover与Yance29启动并发：
    - cutover必须先完成
    - 未完成不得创建DesktopHost启动链

12. WP4 owner接受与WP5 runtime baseline并发：
    - owner trusted前不得采纳snapshot
    - snapshot必须绑定accepted owner

13. old API session与new backend响应竞态：
    - old response全部丢弃
    - new snapshot重新绑定authority triple

14. governance机器读取竞态：
    - 先固定final audit decision和identity
    - 再读取候选期status作为历史证据
    - 禁止反向覆盖

---

## 13. 更新后的mutation计划

### 13.1 治理读取

- 删除`WP5_ACCEPTED` override
- 让`wp5Accepted=false`覆盖最终决定
- 让`downstream.WP5.reviewStatus`覆盖current/final decision
- 忽略accepted HEAD匹配
- 忽略accepted tree匹配
- 不要求WP5风险接受ID

### 13.2 Authority与revision

- 用stateVersion替代operatingModeRevision恢复mode
- lifecycle更新时错误推进operatingModeRevision
- mode persist时不推进operatingModeRevision
- snapshot删除operatingModeRevision
- reconcile忽略ledger/authority revision mismatch

### 13.3 Migration

- existing authority重新读取Yance27
- receipt缺失时fresh initialize
- 接受多个receipt
- 忽略source fingerprint
- 忽略sourceFileCount/sourceTotalBytes
- 忽略before/after变化
- corrupt legacy按不存在处理
- 冲突候选选择第一个
- 对Yance27执行写入

### 13.4 Safe mode closure

- 恢复`YANCE_SAFE_MODE`
- 恢复`safe-mode-state.json`读取
- desktopSettings持久化safeMode
- systemPolicy持久化safeMode
- renderer localStorage/IndexedDB作为fallback
- `legacyFallbackUsed=true`

### 13.5 API cutover

- Renderer继续通过`POST /policy`改mode
- Electron通过legacy coreExecute改mode
- API v2失败后回退executeLegacy
- preload暴露legacy runtime control
- 把进程内`runtime:operating-mode-authority`当作跨进程权威
- 忽略persisted event sequence
- event gap后继续应用增量

### 13.6 Legacy owner cutover

- owner registry损坏仍启动
- live owner身份不明仍启动
- SIGTERM后不确认exit
- SIGKILL后不确认exit
- 只比较PID不比较identity
- cutover未完成先启动Yance29

每个mutation必须至少被一个required test或evidence gate捕获。

---

## 14. 更新后的WP6 evidence schema

R5固定文件名保持不变：

1. `evidence/wp6/electron-api-v2-cutover.json`
2. `evidence/wp6/event-gap-recovery.json`
3. `evidence/wp6/backend-crash-recovery.json`
4. `evidence/wp6/old-runtime-removal.json`
5. `evidence/wp6/runtime-entrypoint-inventory.json`

### 14.1 通用上游绑定

每个文件必须包含：

```json
{
  "upstreamBindings": {
    "WP4": {
      "bindingStatus": "BOUND_TO_WP4_ACCEPTED_FINAL_DELIVERY",
      "acceptedHead": "2b929258c4d51c10a4dc49e90fcecf8b9f8170c4",
      "acceptedSourceTree": "8de896200f82a65d22a7d15db78cd83f813188bf"
    },
    "WP5": {
      "bindingStatus": "BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY",
      "implementationCommit": "2d42a7424b1bac0dafa2b4c3bee3378266e1a92f",
      "implementationSourceTree": "1b7594dcc35e77a09e3e31473fbec74847a5e3c1",
      "candidateBindingCommit": "ba3728dcf267c338af19d78297309aa306ee8018",
      "candidateBindingSourceTree": "6e6a9c27a18bce011da06863aa7ea4c2015db386",
      "acceptedHead": "c4d5a641e93c600c0199e9960fe8f570faa07808",
      "acceptedSourceTree": "b6ece87673d804686bd231858097f6561ff1b200",
      "finalAcceptanceStatus": "WP5_ACCEPTED"
    }
  }
}
```

### 14.2 治理覆盖证据

```json
{
  "wp5GovernanceNormalization": {
    "riskAcceptanceId": "WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED",
    "formalDecision": "WP5_ACCEPTED",
    "candidateFieldsDetected": {
      "wp5Accepted": false,
      "wp5Status": "ACTIVE",
      "wp5ReviewStatus": "PENDING_INDEPENDENT_REVIEW",
      "wp6Status": "BLOCKED_BY_WP5"
    },
    "formalDecisionOverrideApplied": true,
    "identityMatchRequired": true,
    "productionImpact": false
  }
}
```

### 14.3 electron-api-v2-cutover.json新增字段

- operatingModeAuthority
- operatingModeRevision
- snapshotAuthorityTriple
- runtimeSetOperatingModeCallSites
- policyRouteOperatingModeCallSites
- legacyExecuteRuntimeControlCallSites
- processLocalEventBusAuthorityCallSites
- rendererModeMutationPath
- electronModeMutationPath
- apiV2BypassCount
- policyModeControlCount
- legacyExecuteModeControlCount
- legacyFallbackUsed
- legacyOwnerCutoverStatus
- migrationReceiptStatus
- wp5GovernanceNormalization

最终PASS要求：

```text
apiV2BypassCount=0
policyModeControlCount=0
legacyExecuteModeControlCount=0
legacyFallbackUsed=false
```

### 14.4 event-gap-recovery.json新增字段

- stateVersionBefore
- operatingModeRevisionBefore
- lastEventSequenceBefore
- eventGap
- snapshotRefetched
- stateVersionAfter
- operatingModeRevisionAfter
- lastEventSequenceAfter
- operatingModeRevisionNonrollback
- oldProcessLocalEventIgnored
- persistedRuntimeEventsUsed

### 14.5 backend-crash-recovery.json新增字段

- pendingOperatingModeCommandStatusBeforeCrash
- committedOperatingModeRevision
- applyStatusBeforeCrash
- publishStatusBeforeCrash
- recoveryCommandId
- sameEnvelopeDigest
- duplicateSideEffectCount
- recoveredOperatingModeRevision
- recoveredTerminalResponse
- legacyOwnerCutoverRechecked
- ownerTrustedBeforeSnapshot

### 14.6 old-runtime-removal.json新增字段

- policyRouteModeControlHits
- legacyExecuteRuntimeControlHits
- safeModeFileRuntimeReadHits
- safeModeEnvironmentFallbackHits
- desktopSettingsModeAuthorityHits
- rendererStorageModeAuthorityHits
- yance27RuntimeWriteHits
- legacyFallbackUsed
- scanComplete
- scannerErrors

### 14.7 runtime-entrypoint-inventory.json新增字段

- RuntimeAuthorityMigrationCoordinator constructors
- OperatingModeTransitionGateway constructors
- RuntimeStateStore direct mode writers
- runtime.setOperatingMode command handlers
- `/policy` mode handlers
- executeLegacy runtime control handlers
- process-local mode authority publishers
- Electron/preload/renderer consumers
- LegacyRuntimeCutoverGate constructors
- Yance27 discovery call sites
- allowed authoritative entrypoint
- duplicate executable entrypoints

---

## 15. 激活提交约束

本决定不自动激活WP6。

正式激活时必须单独生成激活提交，且：

```text
parent:
c4d5a641e93c600c0199e9960fe8f570faa07808
```

激活提交应只完成：

- WP5 accepted identity绑定
- WP5 governance risk绑定
- WP6状态改为ACTIVE
- WP6 active=true
- activeWorkPackages=["WP6"]
- lastCompletedWorkPackage="WP5"
- WP7继续BLOCKED_BY_WP6
- activation identity记录

不得在激活提交中加入WP6生产实现。

---

## 16. 最终结论

`WP6_READY_FOR_ACTIVATION`
