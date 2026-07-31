# 言策29 Stage 6.4.5.9
# WP6_IMPLEMENTATION_PLAN_V1

## 0. 文档身份、决定与治理边界

文档类型：

`WP6 Design Gate正式实施计划`

文档版本：

`V1`

生成日期：

`2026-07-05`

当前阶段：

`DESIGN_GATE_OUTPUT_ONLY`

当前正式治理值：

```text
WP6_PRODUCTION_IMPLEMENTATION_AUTHORIZED:
false

WP6_DESIGN_GATE_STATUS:
PLAN_ISSUED_AWAITING_OWNER_CONFIRMATION

Required owner decision:
WP6_DESIGN_GATE_CONFIRMED
```

本文件只完成WP6生产实施前的范围、权威、状态机、不变量、调用链、故障与并发处理、测试、mutation、evidence和两阶段验收设计。

本文件没有并且不得被解释为已经：

- 修改任何生产代码
- 修改SQLite数据库或迁移
- 创建WP6 implementation commit
- 执行或伪造WP6 required tests结果
- 生成WP6 evidence PASS结果
- 生成candidate binding commit
- 生成Final Delivery HEAD
- 生成完整Final Packaging
- 标记WP6 COMPLETED
- 激活WP7

本文件发布后立即停止。只有项目所有者明确签发：

`WP6_DESIGN_GATE_CONFIRMED`

才允许进入WP6生产实现。

---

## 1. 正式基线核验与来源登记

### 1.1 唯一开发基线

```text
WP5 Accepted Final Delivery HEAD:
c4d5a641e93c600c0199e9960fe8f570faa07808

WP5 Accepted final source tree:
b6ece87673d804686bd231858097f6561ff1b200

WP6 Activation commit:
3d48fc990deb64bb9fbfa623afa95c102ae516b5

WP6 Activation source tree:
fdf199697d2ca1dd1a001e05518316bae0f81ecf

WP6 Activation binding commit:
7de495936c955a67d737c351682a9e84ffd4d290

WP6 Activation binding source tree:
855376824e8f75aaebc41ce74f73a451026f977f
```

正式父链：

```text
c4d5a641e93c600c0199e9960fe8f570faa07808
  -> 3d48fc990deb64bb9fbfa623afa95c102ae516b5
  -> 7de495936c955a67d737c351682a9e84ffd4d290
```

### 1.2 干净工作区核验

从正式Activation Git bundle建立独立detached工作区后，核验结果：

```text
HEAD:
7de495936c955a67d737c351682a9e84ffd4d290

HEAD tree:
855376824e8f75aaebc41ce74f73a451026f977f

HEAD parent:
3d48fc990deb64bb9fbfa623afa95c102ae516b5

HEAD grandparent:
c4d5a641e93c600c0199e9960fe8f570faa07808

Repository state:
CLEAN

Checkout mode:
DETACHED

Git bundle history:
COMPLETE

Git fsck --full --strict:
PASS
```

### 1.3 正式决定优先级

当前项目所有者正式签发：

`WP6_ACTIVATION_ACCEPTED`

该决定与上述Activation identity共同构成WP6正式开发入口。

Activation binding commit中的候选期字段仍可显示：

```text
wp6ActivationAccepted=false
activationAcceptanceStatus=PENDING_INDEPENDENT_REVIEW
activationFormallyEffective=false
```

这些字段是独立审核前冻结的候选快照，不得反向覆盖后续正式审核决定。正式读取顺序为：

1. 项目所有者签发的`WP6_ACTIVATION_ACCEPTED`
2. 已接受Activation commit、tree、binding commit和binding tree
3. Activation verification与父链证明
4. Activation commit中的候选期治理字段

因此本次未发现阻止Design Gate的基线冲突。

此前另行生成但未被本次正式审核接受的ReadinessBound候选身份：

```text
791b508cb97d35b277ef48767de8384e6e765e8f
cdd7bf75a3861724e596f3d4556344c8b24198cf
```

不属于WP6开发基线，不得合并、cherry-pick或作为父提交使用。

### 1.4 已重新读取的正式设计来源

- `WP6_READINESS_DESIGN_V1.md`
- `WP6_READINESS_DESIGN_REVIEW_V1.md`
- `WP6_ACTIVATION_READINESS_REBIND.md`
- `WP6_READINESS_MATERIALS_SHA256.txt`
- R5-WP7阶段参考包中的WP6范围、required tests、evidence输出和出口条件
- Activation binding commit中的`project-handoff.json`
- Activation binding commit中的`work-package-status.json`
- Activation manifest、identity binding、verification和风险接受登记
- 项目所有者本次正式`WP6_ACTIVATION_ACCEPTED`决定

三份Readiness Markdown实际SHA256与正式清单一致：

```text
868adf9faf4013c688b78d5f8522230914b6d20a0c5f728a0fe4be4be6070d69  WP6_READINESS_DESIGN_V1.md
b8ff3dca8a7fe532a09601afd5988eb4c602963fa4b16082a8d929dafd3f29e3  WP6_READINESS_DESIGN_REVIEW_V1.md
0b39fcc43c915eb879a7f20c3df07c9f52a02b0749388be44276ba3e563f9481  WP6_ACTIVATION_READINESS_REBIND.md
```

### 1.5 当前正式状态投影

```text
WP5:
  status: COMPLETED
  active: false
  reviewStatus: ACCEPTED
  finalAcceptanceStatus: WP5_ACCEPTED

WP6:
  status: ACTIVE
  active: true
  reviewStatus: IMPLEMENTATION_IN_PROGRESS
  requiredTestsStatus: NOT_STARTED
  evidenceStatus: NOT_STARTED
  productionImplementationAuthorized: false
  finalPackagingAuthorized: false

activeWorkPackages:
  ["WP6"]

lastCompletedWorkPackage:
  "WP5"

WP7:
  status: BLOCKED_BY_WP6
  active: false
  activationAllowed: false
```

---

## 2. WP6正式范围

正式名称：

`Electron API v2 cutover verification and old Runtime deletion`

WP6只实施以下范围：

1. 将Electron中所有对backend Runtime状态、命令和生命周期投影的控制面统一到backend API v2。
2. 建立可信owner绑定的API v2 snapshot基线，并持续处理SQLite-backed API v2 events。
3. 实现snapshot reconnect、event sequence gap、out-of-order、stale session和stale owner恢复。
4. 实现backend crash、graceful stop、forced containment、restart和新owner重新绑定的完整闭环。
5. 将operating mode变更统一到`runtime.setOperatingMode`持久命令合同。
6. 清零`POST /policy`对operating mode的写控制。
7. 清零Electron、preload和renderer通过`AppRuntime.executeLegacy`或任何legacy core command控制Runtime的可达路径。
8. 清零`electron/main.js`和`DesktopHost`中绕过`DesktopCredentialApplicationCoordinator`的生产direct lifecycle fallback。
9. 删除或物理消除旧Electron Runtime、重复backend Runtime factory、重复Lifecycle入口及无调用的旧兼容入口。
10. 对源码树和installed runtime tree完整扫描，证明旧Runtime残留、API v2旁路、双执行路径和重复入口均为零。
11. 生成R5固定的五个WP6 evidence JSON。
12. 建立WP6 required tests、完整故障矩阵、并发/崩溃矩阵、mutation矩阵和开发者对抗式自审。
13. 形成且仅形成WP6 Convergence Pre-Review轻量候选。

---

## 3. 明确排除项

WP6不实施以下事项：

1. 不重做WP4 CredentialVault、FD4、FD5、FD6或credential custody协议。
2. 不改变WP4 accepted owner、trusted owner、containment和application lease合同，除非为消除WP6旁路进行最小调用接入。
3. 不重做WP5 `runtime_state`、migration receipt、Yance27只读迁移或LegacyRuntimeCutoverGate。
4. 不新增Yance27读取范围，不修改Yance27，不建立第二迁移路径。
5. 不恢复或重写Telegram、Facebook、翻译、AI大脑、联系人或聊天表面功能。
6. 不做WP7 installer、正式发布、签名、最终一次性构建或发布机器证据。
7. 不修改release identity规则，除非WP6 installed-tree验证需要只读读取既有manifest。
8. 不将现有业务WebSocket `/events`误改为Runtime authority；它可继续承载非权威业务通知，但不得驱动Runtime生命周期或operating mode。
9. 不将Electron升级为业务Runtime或SQLite authority。
10. 不将API v2 secret、credential payload、apiSessionToken或token hash写入evidence。
11. 默认不新增数据库表或迁移。任何确需schema变更的发现必须先作为Design Amendment停止报告，不得在现计划下自行实施。
12. 不提前生成Final Packaging或任何WP7材料。

---

## 4. WP5正式接口、模块、事件和状态绑定

### 4.1 WP5接受身份

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

Accepted final source tree:
b6ece87673d804686bd231858097f6561ff1b200
```

绑定状态：

`BOUND_TO_WP5_ACCEPTED_FINAL_DELIVERY`

### 4.2 WP5 Runtime authority模块

WP6必须以以下模块的accepted行为为上游合同：

- `backend/runtime/AppRuntime.js`
- `backend/runtime/AppRuntimeFactory.js`
- `backend/runtime/runtimeSingleton.js`
- `backend/runtime/LifecycleStateMachine.js`
- `backend/runtime/RuntimeStateStore.js`
- `backend/runtime/OperatingMode.js`
- `backend/runtime/OperatingModeTransitionGateway.js`
- `backend/runtime/RuntimeAuthorityMigrationCoordinator.js`
- `backend/runtime/BootCoordinator.js`
- `backend/runtime/AppRuntimeComposition.js`
- `backend/routes/apiV2.js`
- `backend/security/apiSessionAuth.js`
- `backend/middleware/r32LocalApiSecurity.js`

### 4.3 WP5 legacy cutover和迁移模块

- `electron/desktopHost/LegacyRuntimeCutoverGate.js`
- `electron/legacyDataRoots.js`
- `backend/services/legacyRootDiscovery.js`
- `backend/services/migrationService.js`
- `backend/services/safeModeService.js`
- `backend/services/systemPolicy.js`
- `shared/desktopSettings.js`

### 4.4 API v2正式接口

```text
GET  /api/app/v2/snapshot
POST /api/app/v2/commands
GET  /api/app/v2/events?afterSequence=<n>&limit=<n>
```

每个请求必须同时满足：

- 当前backend start生成的apiSessionToken
- `X-Yance-Contract-Version: 2`
- loopback和origin限制
- 当前可信owner和backend session绑定

### 4.5 Snapshot正式字段

WP6建立baseline时必须校验：

```text
contractVersion
buildId
stateVersion
lastEventSequence
runtime.lifecycleState
runtime.operatingMode
runtime.operatingModeRevision
runtime.ownerInstanceId
runtime.fencingToken
runtime.localReady
capabilities
diagnosticsSummary
credentialHydration非秘密元数据
localCriticalWorkers
externalWorkers
```

WP6内部baseline最少保存：

```text
backendStartInstance
backendPid
ownerSession
apiSessionGeneration
buildId
stateVersion
operatingModeRevision
lastEventSequence
ownerInstanceId
fencingToken
```

### 4.6 持久命令状态

`runtime.setOperatingMode`命令ledger状态：

```text
PERSISTED
APPLY_FAILED
APPLIED
PUBLISH_FAILED
PUBLISHED
RECOVERY_BLOCKED
```

WP6不得把transport response当作唯一事实。命令终态以backend持久ledger、authority revision和持久事件为准。

### 4.7 持久事件

API v2 `runtime_event`中的正式事件包括但不限于：

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

以下进程内EventBus事件不是跨进程权威：

`runtime:operating-mode-authority`

Electron不得将其作为snapshot、revision或command完成的依据。

### 4.8 上游状态和错误合同

WP6必须保留并正确处理：

```text
API_SESSION_UNAUTHORIZED
API_CONTRACT_MISMATCH
STATE_VERSION_CONFLICT
COMMAND_ID_REUSE_MISMATCH
EVENT_SEQUENCE_GAP
OPERATING_MODE_RECOVERY_REQUIRED
OPERATING_MODE_MULTIPLE_PENDING_COMMANDS
OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH
OPERATING_MODE_APPLY_FAILED
OPERATING_MODE_PUBLISH_FAILED
STALE_FENCING_TOKEN
RUNTIME_STATE_NOT_INITIALIZED
```

---

## 5. 唯一权威模型

### 5.1 Electron权威边界

Electron只拥有：

- release manifest验证
- backend子进程启动、终止和真实exit确认
- CredentialVaultHost与credential custody host
- DesktopCredentialApplicationCoordinator application lease
- backend owner接受、拒绝与containment
- API v2 client连接和只读投影
- 窗口、托盘、通知和本机UI

Electron不拥有：

- AppRuntime
- LifecycleStateMachine
- operating mode
- runtime command ledger
- persisted runtime event sequence
- SQLite runtime_state
- 业务account/message authority
- safe mode authority

### 5.2 Backend权威边界

Backend是唯一：

- AppRuntime生产实例
- LifecycleStateMachine生产实例
- RuntimeStateStore写入者
- `runtime_state` operating mode authority
- command ledger authority
- `runtime_event` sequence authority
- outbox claim owner
- API v2 Runtime控制面

### 5.3 WP4应用生命周期权威

`DesktopCredentialApplicationCoordinator`是Electron application-level start、stop、restart和credential mutation的唯一生产协调器。

`BackendProcessHost`是进程和owner custody执行者，但不得成为第二application coordinator。

`DesktopHost`只作为Facade，不得在coordinator缺失时静默进入生产direct fallback。

### 5.4 数据权威

```text
Yance29 SQLite runtime_state:
  operating_mode
  operating_mode_revision
  state_version
  lifecycle_state
  owner_instance_id
  fencing_token

Yance29 SQLite command_idempotency:
  command envelope、状态、revision、response和恢复信息

Yance29 SQLite runtime_event:
  单调持久event sequence

Yance29 SQLite runtime_migration_receipt:
  WP5迁移事实
```

### 5.5 WP6新增客户端只作投影

计划新增的Electron API v2 client和projection coordinator只保存可丢弃的内存baseline。

它们不得：

- 写SQLite
- 自行推进stateVersion或operatingModeRevision
- 自行宣布command成功
- 在没有trusted owner时保留旧baseline
- 把UI缓存作为authority

---

## 6. 完整生命周期和状态机

### 6.1 治理状态机

```text
WP6_ACTIVATION_ACCEPTED
  -> WP6_DESIGN_GATE_PLAN_ISSUED
  -> WAITING_FOR_WP6_DESIGN_GATE_CONFIRMED
  -> WP6_PRODUCTION_IMPLEMENTATION_AUTHORIZED
  -> WP6_IMPLEMENTATION_IN_PROGRESS
  -> WP6_IMPLEMENTATION_COMMIT_FROZEN
  -> WP6_CONVERGENCE_PRE_REVIEW_CANDIDATE
  -> WAITING_FOR_WP6_PREACCEPTED_FOR_FINAL_PACKAGING
  -> WP6_FINAL_PACKAGING_AUTHORIZED
  -> WP6_FINAL_PACKAGING
  -> WP6_PENDING_FINAL_INDEPENDENT_REVIEW
  -> WP6_ACCEPTED
```

当前状态：

`WAITING_FOR_WP6_DESIGN_GATE_CONFIRMED`

### 6.2 Desktop启动和trusted owner状态机

```text
DESKTOP_BOOT
  -> RELEASE_IDENTITY_VERIFIED
  -> LEGACY_RUNTIME_CUTOVER_GATE_PASSED
  -> APPLICATION_COORDINATOR_READY
  -> APPLICATION_LEASE_ACQUIRED
  -> BACKEND_PROCESS_STARTING
  -> FD4_SESSION_BOUND
  -> FD5_HYDRATED
  -> BACKEND_READY_UNTRUSTED
  -> FD6_ACTIVE
  -> RUNTIME_PROJECTION_FETCHED
  -> RUNTIME_PROJECTION_VALIDATED
  -> OWNER_ACCEPTED_TRUSTED
  -> API_V2_BASELINE_BOUND
  -> RUNTIME_SYNCHRONIZED
```

任何owner、FD、projection或identity检查失败：

```text
OWNER_REJECTED
  -> API_AUTHORITY_REVOKED
  -> FD6_DETACHED_AND_CLOSED
  -> APPLICATION_FENCE_INSTALLED
  -> CONTAINMENT_DURABLE
  -> TERMINATION_REQUESTED
  -> REAL_EXIT_CONFIRMED
  -> OWNER_EXIT_RECOVERY
  -> OWNER_FREE_VERIFIED
```

### 6.3 API v2 projection状态机

```text
UNBOUND
  -> OWNER_CANDIDATE_RECEIVED
  -> OWNER_TRUST_REQUIRED
  -> FETCHING_SNAPSHOT
  -> VALIDATING_CONTRACT_BUILD_OWNER_AUTHORITY
  -> BASELINE_ESTABLISHED
  -> POLLING_EVENTS
  -> SYNCHRONIZED
```

异常状态：

```text
STALE_SESSION
STALE_OWNER
CONTRACT_MISMATCH
MALFORMED_SNAPSHOT
AUTHORITY_ROLLBACK
EVENT_SEQUENCE_GAP
OUT_OF_ORDER_EVENT
TRANSPORT_UNAVAILABLE
OWNER_REJECTED
BACKEND_EXITED
```

统一恢复：

```text
CANCEL_IN_FLIGHT_REQUESTS
  -> DISCARD_BASELINE
  -> REVALIDATE_TRUSTED_OWNER
  -> FETCH_FRESH_SNAPSHOT
  -> REBIND_AUTHORITY_TRIPLE
  -> RESUME_EVENT_POLLING
```

### 6.4 Authority triple

每个baseline必须绑定：

```text
stateVersion
operatingModeRevision
lastEventSequence
```

同时绑定：

```text
ownerInstanceId
fencingToken
backendStartInstance
ownerSession
apiSessionGeneration
buildId
```

### 6.5 API v2 command状态机

```text
COMMAND_CREATED
  -> ENVELOPE_VALIDATED
  -> OWNER_AND_BASELINE_BOUND
  -> SUBMITTED
  -> RESPONSE_RECEIVED | TRANSPORT_OUTCOME_UNKNOWN
  -> PERSISTED_EVENT_OBSERVED
  -> APPLIED_EVENT_OBSERVED
  -> PUBLISHED_EVENT_OBSERVED
  -> TERMINAL_RESULT_CONFIRMED
```

transport outcome unknown时：

```text
REUSE_SAME_COMMAND_ID
  -> REUSE_SAME_NORMALIZED_ENVELOPE
  -> SAME_OWNER_ONLY
  -> REQUERY_OR_RESUBMIT
  -> CONFIRM_PERSISTED_TERMINAL_RESULT
```

不得生成新commandId猜测执行结果。

### 6.6 Operating mode状态机

```text
MODE_IDLE
  -> SNAPSHOT_REVISION_CAPTURED
  -> runtime.setOperatingMode ENVELOPE_CREATED
  -> PERSISTED
  -> APPLYING
  -> APPLIED
  -> PUBLISHING
  -> PUBLISHED
  -> SNAPSHOT_OR_EVENT_RECONCILED
```

恢复状态：

```text
APPLY_FAILED
PUBLISH_FAILED
RECOVERY_BLOCKED
```

存在未终结mode command时，不得启动第二个不同mode command。

### 6.7 Graceful stop状态机

```text
STOP_REQUESTED_BY_DESKTOP
  -> TRUSTED_OWNER_AND_BASELINE_REQUIRED
  -> runtime.stop COMMAND_SUBMITTED
  -> STOP_REQUEST_PERSISTED
  -> BACKEND_EXIT_WAIT
  -> REAL_EXIT_CONFIRMED
  -> OWNER_EXIT_RECOVERY
  -> STOP_COMPLETE
```

若API v2不可达或结果未知：

- 不回退到legacy runtime command。
- 进入process-custody shutdown路径。
- 由DesktopCredentialApplicationCoordinator和BackendProcessHost撤销API、关闭FD6、安装fence、终止并确认真实exit。
- 返回明确的graceful-stop-incomplete或forced-containment结果，不伪装为API命令成功。

### 6.8 Restart状态机

```text
RESTART_REQUESTED
  -> APPLICATION_LEASE_ACQUIRED
  -> OLD_RUNTIME_BASELINE_INVALIDATED
  -> GRACEFUL_STOP_ATTEMPTED
  -> REAL_EXIT_CONFIRMED
  -> OWNER_EXIT_RECOVERY_COMPLETE
  -> LEGACY_CUTOVER_RECHECKED
  -> NEW_BACKEND_STARTED
  -> NEW_OWNER_VALIDATED
  -> NEW_API_SESSION_BOUND
  -> FRESH_SNAPSHOT_FETCHED
  -> FRESH_BASELINE_ESTABLISHED
  -> RESTART_COMPLETE
```

旧owner、旧token、旧event poll和旧response不得跨restart复用。

### 6.9 Event gap状态机

```text
POLL(afterSequence=N)
  -> EVENT_SEQUENCE_GAP
  -> CANCEL_CURRENT_POLL
  -> DISCARD_INCREMENTAL_EVENTS
  -> DISCARD_BASELINE
  -> REVALIDATE_OWNER
  -> FETCH_SNAPSHOT
  -> VERIFY_NONROLLBACK
  -> SET lastEventSequence=SNAPSHOT_VALUE
  -> RESUME_POLL
```

### 6.10 Business event与Runtime event分离

现有WebSocket `/events`可继续处理：

- message notifications
- account summaries
- UI refresh
- desktop notifications
- model/AI非权威业务事件

它不得处理或决定：

- lifecycle state
- operating mode
- command completion
- stateVersion
- operatingModeRevision
- owner trust
- backend restart完成

Runtime authority只来自API v2 snapshot、commands和SQLite-backed events。

---

## 7. 不可破坏不变量

1. WP6所有生产修改必须从`7de495936c955a67d737c351682a9e84ffd4d290`开始。
2. 不得使用ReadinessBound未接受候选作为父提交或代码来源。
3. `WP6_DESIGN_GATE_CONFIRMED`前不得修改生产代码。
4. WP6 implementation commit只能有一个冻结身份。
5. Electron不得创建AppRuntime或LifecycleStateMachine。
6. Backend AppRuntime生产实例数必须为1。
7. Backend LifecycleStateMachine生产实例数必须为1。
8. DesktopCredentialApplicationCoordinator是唯一application lifecycle coordinator。
9. BackendProcessHost只能执行进程和owner custody，不得成为第二业务Runtime。
10. DesktopHost不得在生产中静默绕过application coordinator。
11. start只能在LegacyRuntimeCutoverGate成功后发生。
12. trusted owner前不得采纳API v2 snapshot。
13. trusted owner前不得向renderer发布Runtime synchronized状态。
14. API session必须随每次backend start轮换。
15. 旧API session的响应必须全部丢弃。
16. ownerSession必须与FD4、FD5、FD6、READY和runtime projection一致。
17. local_ready不等于trusted owner。
18. backend:ready不等于trusted owner。
19. owner registry durable trusted记录失败时不得继续。
20. rejected owner必须先撤销API和FD6 authority，再进行可能失败的持久化和终止。
21. real exit未确认时不得启动replacement owner。
22. runtime_state是唯一operating mode authority。
23. operating mode只能是`normal`或`safeMode`。
24. stateVersion、operatingModeRevision和lastEventSequence不得互相替代。
25. lifecycle或capability事件推进stateVersion时不得误推进operatingModeRevision。
26. API v2 snapshot缺少operatingModeRevision时不得建立baseline。
27. snapshot stateVersion不得小于已确认baseline stateVersion，除非owner/session已经变化且旧baseline已丢弃。
28. 同一owner内operatingModeRevision不得回退。
29. eventSequence必须单调。
30. event gap后不得继续应用旧增量。
31. out-of-order event不得更新投影。
32. process-local EventBus不得成为Electron跨进程authority。
33. `runtime.setOperatingMode`必须使用持久ledger。
34. mode apply失败不得报告完整成功。
35. mode publish失败不得报告完整成功。
36. transport timeout不得生成新commandId。
37. commandId必须绑定唯一normalized envelope digest。
38. 同commandId不同payload必须拒绝。
39. 未终结mode command存在时不得接受第二个不同mode command。
40. graceful stop必须优先使用API v2 `runtime.stop`，但process custody终止不得被错误描述为Runtime command成功。
41. start无法通过API v2完成，因此start仍属于Electron process custody；这不构成API v2 bypass。
42. restart必须包含真实exit确认和fresh snapshot，不得只重连旧进程。
43. `/policy`不得在WP6终态写operating mode。
44. renderer不得通过`/policy`改变safe mode。
45. `AppRuntime.executeLegacy`不得承载任何Runtime lifecycle或mode控制。
46. API v2失败时不得回退到legacy core command。
47. preload不得暴露泛型runtime executor。
48. Electron不得直接导入backend业务Runtime模块。
49. main.js direct launch/stop/restart fallback生产可达性必须为0。
50. DesktopHost direct executeControl/reset fallback生产可达性必须为0。
51. retired `backend/core/coreRuntime.js`和`backend/core/lifecycleManager.js`不得保留为可加载入口。
52. 无调用的`backend/core/compositionRoot.js`不得保留为第二Runtime facade。
53. 任何保留的AccountContext、SecurityGuard、RecoveryManager或UpdateManager只能是AppRuntime composition participant，不得是第二Runtime。
54. duplicate Runtime factory、composition root和lifecycle entrypoint必须为0。
55. Yance27必须保持只读。
56. WP6不得重新决定WP5迁移结果。
57. WP6不得创建第二migration receipt或修改既有receipt语义。
58. 新Runtime写入只允许进入Yance29。
59. `legacyFallbackUsed`必须保持false。
60. `YANCE_SAFE_MODE`不得影响Runtime。
61. `safe-mode-state.json`运行时读写必须为0。
62. desktop settings和renderer storage不得成为operating mode authority。
63. source scan必须完整，scanner异常不得输出zero。
64. installed-tree scan必须展开app.asar、unpacked、resources和支持的nested archives。
65. symlink、junction、大小写变体和dynamic import不得规避扫描。
66. test fixture不得被误打包为生产旧Runtime。
67. evidence不得包含credential secret、apiSessionToken、session token hash或可恢复秘密材料。
68. 所有WP2、WP3、WP4、WP5风险接受记录必须保留。
69. WP4 Windows实机证据缺口不得伪写为PASS。
70. Design Gate计划不得解释为required tests已经执行。
71. Convergence Pre-Review前不得生成candidate binding commit。
72. `WP6_PREACCEPTED_FOR_FINAL_PACKAGING`前不得生成Final Delivery HEAD或完整ZIP。
73. WP6接受前WP7必须保持blocked。

---

## 8. 生产模块、入口和调用链

### 8.1 既有Electron生产模块

- `electron/main.js`
- `electron/preload.js`
- `electron/r32LocalApiSession.js`
- `electron/desktopHost/DesktopHost.js`
- `electron/desktopHost/BackendProcessHost.js`
- `electron/desktopHost/DesktopCredentialApplicationCoordinator.js`
- `electron/desktopHost/CredentialAuthorityLifecycleCoordinator.js`
- `electron/desktopHost/CredentialVaultHost.js`
- `electron/desktopHost/CredentialCustodyHost.js`
- `electron/desktopHost/LegacyRuntimeCutoverGate.js`
- `electron/backendShutdownCoordinator.js`
- `electron/backendStartupSupervisor.js`

### 8.2 既有Backend生产模块

- `backend/desktopHostedEntry.js`
- `backend/runtime/index.js`
- `backend/runtime/BootCoordinator.js`
- `backend/runtime/AppRuntimeFactory.js`
- `backend/runtime/runtimeSingleton.js`
- `backend/runtime/AppRuntime.js`
- `backend/runtime/RuntimeStateStore.js`
- `backend/runtime/OperatingModeTransitionGateway.js`
- `backend/routes/apiV2.js`
- `backend/routes/system.js`
- `backend/routes/core.js`
- `backend/security/apiSessionAuth.js`
- `backend/middleware/r32LocalApiSecurity.js`

### 8.3 计划新增Electron模块

#### A. `electron/desktopHost/ApiV2RuntimeClient.js`

职责：

- 只接受当前BackendProcessHost提供的session binding
- 为API v2请求自动加入contract version 2和当前token
- 统一snapshot、command和events请求
- 使用AbortController绑定backendStartInstance和ownerSession
- 保留same-commandId retry信息但不持久化secret
- 标准化HTTP、contract、auth和transport错误
- 不包含任何fallback到legacy core或`/policy`

#### B. `electron/desktopHost/RuntimeProjectionCoordinator.js`

职责：

- 只在trusted owner后建立snapshot baseline
- 校验authority triple、buildId、ownerInstanceId和fencingToken
- 驱动API v2 event polling
- 处理gap、stale session、stale owner和restart
- 向main.js提供只读projection snapshot
- 不写backend状态，不成为authority

#### C. 可选共享合同模块

`shared/runtimeApiV2Contract.js`

只在确有重复验证时创建，用于：

- command envelope格式
- snapshot基本字段
- authority triple验证
- stable reason code

不得将backend secret或内部实现暴露给renderer。

### 8.4 Electron正常启动调用链

```text
electron/main.js
  -> LegacyRuntimeCutoverGate.verifyAndClear()
  -> DesktopCredentialApplicationCoordinator.startBackend()
  -> DesktopHost.startBackend()
  -> BackendProcessHost.start()
  -> FD4/FD5/FD6 handshake
  -> backend READY_UNTRUSTED
  -> ApiV2RuntimeClient.getSnapshot()
  -> RuntimeProjectionCoordinator.validateCandidateProjection()
  -> DesktopCredentialApplicationCoordinator accepts projection
  -> BackendProcessHost.acceptBackendOwner()
  -> RuntimeProjectionCoordinator.bindTrustedOwnerBaseline()
  -> API v2 event polling
```

重要顺序：

- 首个snapshot可作为owner acceptance候选证据，但在owner durable trusted前不得作为对外正式baseline。
- owner accepted后必须重新确认session/owner未变化，再正式绑定baseline。

### 8.5 Renderer operating mode调用链

计划终态：

```text
frontend/r32-settings-recovery.js
  -> explicit runtime mode command API
  -> POST /api/app/v2/commands
  -> AppRuntime.executeCommand()
  -> OperatingModeTransitionGateway.transition()
  -> RuntimeStateStore.persistOperatingModeCommand()
  -> apply
  -> publish
  -> persisted events
  -> RuntimeProjectionCoordinator reconciliation
```

允许renderer直接same-origin调用API v2，但必须由Electron session header注入和contract version 2保护；也可通过一个窄化IPC方法代理。最终实现选择标准：

- 不暴露token
- 不暴露泛型executor
- command envelope由单一可信模块生成
- 可绑定owner/session并处理unknown outcome

优先方案：由Electron通过窄化IPC提供`setOperatingMode`和`requestRuntimeStop`，renderer不直接构造泛型命令。

### 8.6 Graceful stop调用链

```text
renderer/tray/app shutdown request
  -> DesktopCredentialApplicationCoordinator application lease
  -> RuntimeProjectionCoordinator invalidates new UI mutations
  -> ApiV2RuntimeClient runtime.stop command
  -> backend persists runtime.stop_requested
  -> backend process exits
  -> BackendProcessHost confirms real exit
  -> credential owner exit recovery
  -> stop result
```

### 8.7 Forced stop/containment调用链

```text
API unavailable or owner rejected
  -> revoke API authority
  -> close FD6
  -> install application fence
  -> persist containment if possible
  -> BackendProcessHost terminate
  -> confirm real exit
  -> owner exit recovery
```

不得调用legacy Runtime命令。

### 8.8 Backend业务命令收口

计划将当前：

```text
AppRuntime.execute(input)
  -> contractVersion===2 ? executeCommand : executeLegacy
```

收口为两个显式、不可混淆入口：

```text
executeCommand(v2Envelope)
executeBusinessCommand(legacyBusinessEnvelope)
```

并：

- 删除`execute()`自动分流
- 删除或重命名`executeLegacy()`
- 从business入口移除`lifecycle.enterSafeMode`、`lifecycle.exitSafeMode`、stop/restart/mode控制
- `backend/routes/core.js`不得成为Runtime generic control endpoint
- account/message/recovery/update业务命令按明确白名单继续工作

---

## 9. 旧路径、旁路和兼容路径

### 9.1 当前已确认路径及目标

| 当前路径 | 当前性质 | WP6终态 |
|---|---|---|
| `electron/core/coreRuntime.js` | 已不存在 | 持续不存在 |
| `electron/core/accountContext.js` | 已不存在 | 持续不存在 |
| `electron/core/securityGuard.js` | 已不存在 | 持续不存在 |
| `backend/core/coreRuntime.js` | retired可加载stub | 物理删除 |
| `backend/core/lifecycleManager.js` | retired可加载stub | 物理删除 |
| `backend/core/compositionRoot.js` | 无调用legacy facade | 删除 |
| `backend/core/accountContext.js` | AppRuntime participant | 保留或迁移，但证明不是Runtime入口 |
| `backend/core/securityGuard.js` | security participant | 保留或迁移，但证明不是Runtime入口 |
| `AppRuntime.executeLegacy()` | 泛型legacy命令入口 | 删除/重命名为窄化business入口，Runtime控制为0 |
| `AppRuntime.execute()` | v2/legacy自动分流 | 删除 |
| `POST /api/r32/system/policy safeMode` | operating mode旁路 | safeMode写入拒绝或移除 |
| `backend/routes/core.js POST /command` | 泛型命令入口 | Runtime控制命令拒绝，必要时仅保留business白名单 |
| `main.js launchBackendDirect` fallback | coordinator旁路 | 生产不可达或删除 |
| `main.js stopBackendDirect` fallback | coordinator旁路 | 仅内部coordinator callback，不可从生产外部直接选择 |
| `main.js restartBackend`无coordinator fallback | coordinator旁路 | 删除 |
| `DesktopHost.executeControl` direct fallback | coordinator旁路 | coordinator缺失时fail closed |
| `DesktopHost.resetCredentialVault` direct fallback | coordinator旁路 | coordinator缺失时fail closed |
| WebSocket `/events` | 非权威业务事件 | 保留，但禁止Runtime authority语义 |
| `runtime:operating-mode-authority` | backend进程内事件 | 不被Electron消费 |

### 9.2 兼容原则

1. 兼容层只能保留业务命令，不得保留Runtime控制。
2. 兼容层必须有显式白名单，不得泛型透传任意command字符串。
3. 兼容层不得在API v2失败时自动接管。
4. 保留的业务WebSocket事件不得携带或覆盖authority triple。
5. 任何legacy命名文件若保留，必须在entrypoint inventory中证明不可创建第二Runtime。
6. 无调用stub或facade必须删除，不以“保险兼容”为由保留。

---

## 10. 正常流程矩阵

| 编号 | 流程 | 前置条件 | 必须结果 |
|---|---|---|---|
| N1 | Desktop首次启动 | release和legacy cutover通过 | coordinator启动单一backend |
| N2 | Credential hydration | FD4 session已绑定 | FD5完整hydrate，FD6 active |
| N3 | READY候选 | backend local_ready | owner仍untrusted |
| N4 | Snapshot候选 | 当前session有效 | contract/build/authority字段完整 |
| N5 | Owner接受 | FD和projection一致 | durable trusted owner |
| N6 | 正式baseline | trusted owner | authority triple绑定 |
| N7 | Event poll | baseline有效 | 只应用连续持久events |
| N8 | Capability更新 | external worker变化 | stateVersion可推进，mode revision不变 |
| N9 | Mode normal->safeMode | 无pending mode command | 同commandId完成PUBLISHED |
| N10 | Mode safeMode->normal | 完整性门禁通过 | authority revision推进一次 |
| N11 | Duplicate same command | 同ID同envelope | 单次副作用，同终态response |
| N12 | Runtime ping | baseline有效 | persistent command event和response一致 |
| N13 | Graceful stop | trusted owner | API v2 stop后真实exit确认 |
| N14 | Restart | old owner真实exit | 新token、新owner、新snapshot |
| N15 | Backend crash | old process退出 | old baseline废弃，恢复后fresh snapshot |
| N16 | Business WebSocket event | runtime baseline有效或无关 | 仅UI业务更新，不改authority |
| N17 | Privacy policy update | 不含safeMode | systemPolicy正常更新 |
| N18 | Account/message business command | explicit business whitelist | 不经过Runtime control fallback |
| N19 | Source scan | 完整源码 | legacy/旁路/duplicate计数准确 |
| N20 | Installed scan | 真实或规定fixture产物 | archives完整展开且zero有效 |

---

## 11. 故障矩阵

| 编号 | 故障 | 必须行为 | 稳定reason/result |
|---|---|---|---|
| F1 | HEAD或tree不匹配 | 停止实施 | `WP6_BASELINE_IDENTITY_MISMATCH` |
| F2 | repo不clean | 停止实施 | `WP6_WORKTREE_NOT_CLEAN` |
| F3 | Activation decision缺失 | 不实施 | `WP6_ACTIVATION_ACCEPTANCE_REQUIRED` |
| F4 | contract version不为2 | 副作用前失败 | `API_CONTRACT_MISMATCH` |
| F5 | API token无效 | 丢弃response并停poll | `API_SESSION_UNAUTHORIZED` |
| F6 | owner未trusted | 不采纳snapshot | `WP6_TRUSTED_OWNER_REQUIRED` |
| F7 | snapshot缺字段 | 不建立baseline | `WP6_SNAPSHOT_SCHEMA_INVALID` |
| F8 | buildId不匹配 | reject owner或baseline | `WP6_SNAPSHOT_BUILD_ID_MISMATCH` |
| F9 | ownerInstanceId不匹配 | 丢弃snapshot | `WP6_SNAPSHOT_OWNER_MISMATCH` |
| F10 | fencingToken无效/回退 | fail closed | `WP6_SNAPSHOT_FENCING_INVALID` |
| F11 | operatingModeRevision缺失 | 不建立baseline | `SNAPSHOT_OPERATING_MODE_REVISION_REQUIRED` |
| F12 | same-owner stateVersion回退 | 丢弃baseline | `WP6_SNAPSHOT_STATE_ROLLBACK` |
| F13 | same-owner mode revision回退 | 丢弃baseline | `WP6_MODE_REVISION_ROLLBACK` |
| F14 | event sequence gap | 丢弃增量，refetch snapshot | `EVENT_SEQUENCE_GAP` |
| F15 | out-of-order event | 不应用 | `WP6_EVENT_OUT_OF_ORDER` |
| F16 | old session response晚到 | 丢弃 | `WP6_STALE_API_SESSION_RESPONSE` |
| F17 | old owner event晚到 | 丢弃 | `WP6_STALE_OWNER_EVENT` |
| F18 | command expectedStateVersion冲突 | 不重写意图 | `STATE_VERSION_CONFLICT` |
| F19 | same ID不同envelope | 拒绝 | `COMMAND_ID_REUSE_MISMATCH` |
| F20 | command response timeout | same ID恢复 | `TRANSPORT_OUTCOME_UNKNOWN` |
| F21 | mode apply失败 | 不报告成功 | `OPERATING_MODE_APPLY_FAILED` |
| F22 | mode publish失败 | 不报告成功 | `OPERATING_MODE_PUBLISH_FAILED` |
| F23 | 多个pending mode command | fail closed | `OPERATING_MODE_MULTIPLE_PENDING_COMMANDS` |
| F24 | ledger/authority不一致 | recovery blocked | `OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH` |
| F25 | graceful stop API不可达 | process custody containment | `WP6_GRACEFUL_STOP_UNAVAILABLE` |
| F26 | stop后进程仍活 | 不报告stopped | `DESKTOP_BACKEND_STOP_NOT_CONFIRMED` |
| F27 | owner registry损坏 | 不启动replacement | WP4既有registry reason code |
| F28 | FD6无法关闭 | 保持fence并fail-stop | `FATAL_OWNER_CONTAINMENT` |
| F29 | owner durable trust写失败 | reject owner | WP4 acceptance write failure |
| F30 | LegacyRuntimeCutoverGate失败 | 不启动backend | WP5既有cutover reason code |
| F31 | `/policy`收到safeMode写 | 拒绝并指向API v2 | `OPERATING_MODE_API_V2_REQUIRED` |
| F32 | legacy business endpoint收到Runtime command | 拒绝 | `RUNTIME_COMMAND_API_V2_REQUIRED` |
| F33 | coordinator缺失仍要求start | fail closed | `DESKTOP_APPLICATION_COORDINATOR_REQUIRED` |
| F34 | coordinator缺失仍要求reset | fail closed | `DESKTOP_APPLICATION_COORDINATOR_REQUIRED` |
| F35 | API v2失败触发legacy fallback | test/evidence FAIL | `WP6_API_V2_BYPASS_DETECTED` |
| F36 | source scan命中旧Runtime | cutover FAIL | `WP6_OLD_RUNTIME_SOURCE_HIT` |
| F37 | installed archive未展开 | evidence无效 | `WP6_INSTALLED_SCAN_INCOMPLETE` |
| F38 | scanner异常却输出zero | evidence FAIL | `WP6_INVALID_ZERO_RESULT` |
| F39 | Yance27写入 | 回归FAIL | `WP6_YANCE27_WRITE_DETECTED` |
| F40 | secret进入evidence | 立即FAIL并删除产物 | `WP6_EVIDENCE_SECRET_MATERIAL_DETECTED` |

---

## 12. 并发、竞态和崩溃矩阵

1. 同commandId、同envelope并发提交：共享一次in-flight请求和一次backend副作用。
2. 同commandId、不同envelope并发：一个可继续，另一个必须reuse mismatch。
3. 用户连续切换safeMode：第二命令必须基于最新snapshot；存在pending mode command时阻断。
4. command POST超时但backend已persist：使用同ID恢复，不生成新ID。
5. persist后apply前backend崩溃：重启后由WP5 gateway按同revision恢复。
6. apply后publish前崩溃：重启后只恢复publish，不重复authority persist。
7. publish完成但HTTP ACK丢失：重试返回持久终态。
8. lifecycle event与mode event并发：stateVersion可变化，operatingModeRevision只在mode commit变化。
9. event poll与snapshot refetch并发：generation token只允许最新baseline提交。
10. old event poll与new owner并发：旧poll被AbortController取消，晚到结果丢弃。
11. restart与renderer mode命令并发：application lease先冻结新命令；未提交命令拒绝，unknown命令按同owner恢复后再restart。
12. stop与credential mutation并发：由DesktopCredentialApplicationCoordinator application lease串行。
13. restart与credential mutation并发：只能一个application operation持有lease。
14. READY与owner acceptance竞态：owner保持untrusted直到projection和FD全部验证。
15. owner acceptance后立即crash：durable owner记录和exit recovery必须收口，不得保留trusted旧baseline。
16. two backend process争夺：Named Mutex、lease和fencing共同拒绝stale writer。
17. PID reuse：必须比较process identity，不只比较PID。
18. LegacyRuntimeCutoverGate与new backend start竞态：cutover结果先于spawn。
19. business WebSocket reconnect与Runtime event poll并发：两条通道独立，业务通道不能确认Runtime状态。
20. app quit与event poll并发：先取消poll，再执行stop/containment。
21. forced kill与API response晚到：response因session generation失效而丢弃。
22. source scan与生成文件并发：扫描只在冻结implementation commit和clean tree执行。
23. installed scan与packager写入并发：只扫描封闭、不可变的staging产物。
24. governance reader竞态：先固定正式决定和identity，再读取候选期状态。

---

## 13. 恢复、重试和幂等规则

### 13.1 Snapshot和event恢复

- snapshot请求可在同owner/session内使用有限指数退避。
- 401、contract mismatch、owner mismatch和schema invalid不可盲重试，必须重新绑定owner/session。
- event gap不重试旧afterSequence，必须fresh snapshot。
- network错误可重试，但每次响应都必须检查generation token。
- owner变化后所有旧baseline和in-flight请求无条件废弃。

### 13.2 Command重试

- 每个用户意图生成一个commandId。
- normalized envelope固定后不得修改。
- transport unknown只允许same ID、same envelope、same owner/session恢复。
- `STATE_VERSION_CONFLICT`不自动改expectedStateVersion重放；必须刷新snapshot并要求上层重新确认意图。
- `COMMAND_ID_REUSE_MISMATCH`不可重试。
- `APPLY_FAILED`和`PUBLISH_FAILED`由同命令ledger恢复，不创建第二命令。

### 13.3 Stop和restart恢复

- graceful stop命令unknown时先查询进程和owner状态。
- 如果backend仍活且session仍同一，可same ID恢复。
- 如果backend已退出，进入exit recovery，不重启旧命令。
- restart必须在old owner exit recovery完成后开始。
- forced termination只作为process custody，不写成Runtime command完成。

### 13.4 UI幂等

- UI按钮在同一command进行中禁用或绑定同一operation。
- renderer reload后从Electron projection读取状态，不从localStorage恢复pending Runtime command。
- 不在renderer storage保存apiSessionToken或command envelope secret。

---

## 14. Fail-closed规则

以下任一条件成立时必须停止建立或继续使用Runtime baseline：

- owner不trusted
- API session为空或失效
- contract不为2
- buildId不匹配
- snapshot schema不完整
- authority triple无效
- ownerInstanceId或fencingToken不匹配
- same-owner version回退
- event gap且snapshot未完成
- old owner/session response
- multiple pending mode commands
- ledger/authority mismatch
- rejected owner containment未完成
- real exit未确认
- application coordinator缺失
- legacy cutover未通过
- API v2 call失败后出现legacy fallback企图
- scanner不完整或发生错误
- evidence含秘密材料

Fail-closed时允许继续的能力仅限：

- 显示诊断
- 导出不含秘密的evidence
- 执行owner containment和真实exit确认
- 由用户明确触发安全恢复

不得继续：

- 发送Runtime控制命令
- 采纳旧snapshot
- 自动重启并复用旧owner
- 通过`/policy`或legacy command更改mode

---

## 15. 数据持久化和迁移边界

### 15.1 数据库边界

WP6默认不新增或修改SQLite schema。

WP6只消费WP5正式表：

- `runtime_state`
- `runtime_event`
- `command_idempotency`
- `runtime_migration_receipt`
- `runtime_lease`
- `credential_hydration_state`

WP6不得绕过RuntimeStateStore直接写这些表。

### 15.2 Electron本地状态

Electron API v2 projection只保存在内存。

允许持久化的仅是非秘密诊断性标记，且默认不需要新增持久文件。若未来发现必须跨启动保留command恢复信息，应先提交Design Amendment，因为backend ledger已经是正式幂等权威。

### 15.3 迁移边界

- 已存在Yance29 runtime_state时不得重新读取Yance27决定mode。
- WP6不得修改migration receipt。
- WP6只验证receipt状态可用，不创建第二迁移流程。
- Yance27 read-only和Yance29-only writes继续作为回归门禁。

### 15.4 installed-tree扫描边界

installed-tree scan是只读验证，不构成发布或WP7构建。

Convergence Pre-Review阶段可使用：

- 受控fixture installed tree
- 或现有真实Windows产物的只读扫描

但不得将其伪装为WP7最终一次性发布构建。

---

## 16. Required tests清单

R5固定十项全部必须新增到`tests/wp6/`并由独立脚本运行。

### 16.1 `electron-api-v2-only.test.js`

验证：

- Electron Runtime control只调用API v2 client
- contract version 2存在
- `/policy` mode写路径为0
- `executeLegacy` Runtime control为0
- generic Runtime IPC为0
- coordinator bypass为0
- process-local mode event authority消费者为0

### 16.2 `snapshot-reconnect-baseline.test.js`

验证：

- trusted owner前不建立baseline
- restart后token、owner、start instance变化
- old response被丢弃
- fresh snapshot重建authority triple

### 16.3 `event-gap-forces-snapshot.test.js`

验证：

- 409 `EVENT_SEQUENCE_GAP`
- 旧增量不应用
- baseline丢弃
- fresh snapshot后恢复poll

### 16.4 `api-v2-contract-mismatch-integration.test.js`

验证：

- contract mismatch在副作用前失败
- baseline不被污染
- 不fallback legacy path

### 16.5 `command-idempotency-integration.test.js`

验证：

- same ID same envelope单次副作用
- same ID different envelope拒绝
- timeout后same ID恢复
- state conflict不自动改写重放

### 16.6 `backend-crash-recovery.test.js`

验证：

- persist/apply/publish各崩溃点
- owner和session轮换
- pending command恢复
- duplicate side effect=0
- real exit和owner recovery

### 16.7 `backend-restart-event-sequence-nonrollback.test.js`

验证：

- restart后event sequence不回退
- mode revision不回退
- old poll和old session不可污染新baseline

### 16.8 `old-runtime-source-scan-zero.test.js`

验证：

- exact paths
- semantic class/factory patterns
- generic runtime executor
- dynamic require/import
- path拼接
- 大小写变体
- symlink/junction alias
- source hit count=0

### 16.9 `old-runtime-installed-tree-scan-zero.test.js`

验证：

- app.asar
- app.asar.unpacked
- resources
- nested archives
- fixtures误打包
- scanComplete=true
- scannerErrors=[]
- installed hit count=0

### 16.10 `duplicate-runtime-entrypoint-scan-zero.test.js`

验证生产可执行入口唯一：

- AppRuntimeFactory create count入口
- LifecycleStateMachine构造入口
- RuntimeStateStore writer
- BootCoordinator
- RuntimeAuthorityMigrationCoordinator
- OperatingModeTransitionGateway
- API v2 command handler
- Electron process host

### 16.11 附加必须测试

- `policy-operating-mode-write-rejected.test.js`
- `legacy-runtime-command-rejected.test.js`
- `trusted-owner-before-baseline.test.js`
- `stale-api-session-response-discarded.test.js`
- `stale-owner-event-discarded.test.js`
- `operating-mode-revision-distinct-from-state-version.test.js`
- `graceful-stop-api-v2-then-exit.test.js`
- `forced-stop-is-process-custody-not-runtime-success.test.js`
- `desktop-coordinator-required.test.js`
- `business-websocket-not-runtime-authority.test.js`
- `evidence-secret-free.test.js`

### 16.12 运行脚本

计划新增：

```text
npm run test:wp6
npm run test:wp6:fault-matrix
npm run test:wp6:concurrency-crash
npm run test:wp6:mutations
npm run test:wp6:adversarial
npm run verify:wp6:source-scan
npm run verify:wp6:installed-scan
npm run evidence:wp6
npm run verify:wp6
```

任何脚本在未真实运行时不得写PASSED。

---

## 17. Mutation矩阵及oracle

### 17.1 API client和contract mutations

| Mutation | 必须捕获的oracle |
|---|---|
| 删除contract header | contract mismatch integration |
| 使用旧token | stale session test |
| 不绑定owner generation | reconnect baseline test |
| timeout后生成新commandId | idempotency integration |
| same ID允许不同payload | reuse mismatch test |
| 401后继续poll | fail-closed test |

### 17.2 Snapshot和event mutations

| Mutation | Oracle |
|---|---|
| trusted owner前采纳snapshot | trusted-owner-before-baseline |
| 忽略operatingModeRevision | snapshot schema/revision test |
| 用stateVersion代替mode revision | revision-distinct test |
| event gap后继续增量 | event-gap test |
| 应用out-of-order event | event ordering test |
| old owner response覆盖新baseline | stale-owner test |
| old token response覆盖新baseline | stale-session test |

### 17.3 Operating mode mutations

| Mutation | Oracle |
|---|---|
| `/policy`继续写safeMode | policy write rejected + source scan |
| legacy command进入safe mode | legacy runtime command rejected |
| apply失败仍报告success | WP5 gateway regression + WP6 integration |
| publish失败仍报告success | WP5 gateway regression + WP6 integration |
| pending mode command时接受第二个 | concurrency matrix |
| state conflict自动重写重试 | idempotency/state conflict oracle |

### 17.4 Lifecycle和coordinator mutations

| Mutation | Oracle |
|---|---|
| coordinator缺失时direct start | desktop-coordinator-required |
| coordinator缺失时direct restart | duplicate path scan |
| stop不确认exit就成功 | graceful stop test |
| API stop失败回退executeLegacy | electron-api-v2-only |
| restart复用旧token | reconnect baseline |
| restart不refetch snapshot | reconnect baseline |
| fence未释放启动replacement | WP4 regressions |
| 只比较PID | WP4 owner/PID reuse regressions |

### 17.5 Old Runtime和scanner mutations

| Mutation | Oracle |
|---|---|
| 恢复`backend/core/coreRuntime.js` | source scan |
| 恢复第二factory | entrypoint inventory |
| dynamic require加载旧Runtime | semantic source scan |
| 大小写变体文件 | source scan |
| nested archive藏旧Runtime | installed scan |
| scanner异常仍返回zero | invalid-zero test |
| fixture被打包 | installed scan |
| symlink/junction绕过 | installed/source scan |

### 17.6 Evidence mutations

| Mutation | Oracle |
|---|---|
| evidence sourceIdentity错误 | evidence contract test |
| 缺WP5 binding | evidence contract test |
| 漏风险ID | risk inheritance test |
| 包含token/hash | secret-free test |
| zero但scanComplete=false | evidence validation |
| PASS但required test失败 | aggregate verifier |

要求：

- 每个mutation至少被一个自动test或evidence validator杀死。
- survivor数量必须为0。
- invalid、timeout、signal、harness error必须单独统计，不能算killed。

---

## 18. Evidence文件和字段schema

固定输出目录：

`evidence/wp6/`

固定文件：

1. `electron-api-v2-cutover.json`
2. `event-gap-recovery.json`
3. `backend-crash-recovery.json`
4. `old-runtime-removal.json`
5. `runtime-entrypoint-inventory.json`

### 18.1 通用envelope

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
    "activationBindingCommit": "7de495936c955a67d737c351682a9e84ffd4d290",
    "implementationCommit": "",
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

### 18.2 `electron-api-v2-cutover.json`

必需字段：

```text
apiV2Endpoints
contractVersion
apiSessionBinding
trustedOwnerBinding
fd4Binding
fd5Binding
fd6Binding
snapshotAuthorityTriple
runtimeCommandCallSites
runtimeStopCallSites
runtimeSetOperatingModeCallSites
policyRouteOperatingModeCallSites
legacyExecuteRuntimeControlCallSites
processLocalEventAuthorityCallSites
directLifecycleFallbackCallSites
coordinatorBypassCount
apiV2BypassCount
policyModeControlCount
legacyExecuteModeControlCount
directLifecycleFallbackReachableCount
legacyFallbackUsed
credentialSecretPayloadPresent
```

PASS门槛：

```text
coordinatorBypassCount=0
apiV2BypassCount=0
policyModeControlCount=0
legacyExecuteModeControlCount=0
directLifecycleFallbackReachableCount=0
legacyFallbackUsed=false
credentialSecretPayloadPresent=false
```

### 18.3 `event-gap-recovery.json`

必需字段：

```text
backendStartInstance
ownerSession
apiSessionGeneration
ownerTrusted
stateVersionBefore
operatingModeRevisionBefore
lastEventSequenceBefore
injectedGap
incrementalEventsAppliedAfterGap
baselineDiscarded
snapshotRefetched
stateVersionAfter
operatingModeRevisionAfter
lastEventSequenceAfter
oldPollCancelled
oldOwnerResponseDiscarded
oldSessionResponseDiscarded
authorityTripleRebound
```

PASS门槛：

```text
incrementalEventsAppliedAfterGap=0
baselineDiscarded=true
snapshotRefetched=true
oldPollCancelled=true
authorityTripleRebound=true
```

### 18.4 `backend-crash-recovery.json`

必需字段：

```text
crashPoint
oldBackendIdentity
newBackendIdentity
tokenRotated
ownerSessionChanged
apiAuthorityRevokedBeforeContainment
fd6ClosedBeforeTermination
applicationFenceInstalled
realExitConfirmed
ownerExitRecoveryCompleted
pendingCommandStatusBeforeCrash
commandId
sameEnvelopeDigest
committedOperatingModeRevision
recoveredOperatingModeRevision
duplicateSideEffectCount
newOwnerAcceptedTrusted
freshSnapshotEstablished
eventSequenceNonrollback
windowsEvidenceLimitation
```

### 18.5 `old-runtime-removal.json`

必需字段：

```text
exactOldPaths
semanticPatterns
dynamicImportPatterns
policyRouteModeControlHits
legacyExecuteRuntimeControlHits
directLifecycleFallbackHits
safeModeFileRuntimeReadHits
safeModeEnvironmentFallbackHits
desktopSettingsModeAuthorityHits
rendererStorageModeAuthorityHits
yance27RuntimeWriteHits
sourceRoots
installedRoots
archiveFormatsExpanded
caseVariantsChecked
symlinkJunctionAliasesChecked
scanComplete
scannerErrors
sourceHitCount
installedHitCount
legacyFallbackUsed
```

zero结论只有在：

```text
scanComplete=true
scannerErrors=[]
```

时有效。

### 18.6 `runtime-entrypoint-inventory.json`

必需字段：

```text
AppRuntimeFactoryCreateSites
AppRuntimeConstructors
LifecycleStateMachineConstructors
BootCoordinatorConstructors
RuntimeStateStoreWriters
RuntimeAuthorityMigrationCoordinatorConstructors
OperatingModeTransitionGatewayConstructors
ApiV2CommandHandlers
GenericRuntimeCommandHandlers
DesktopProcessStartEntrypoints
DesktopProcessStopEntrypoints
DesktopProcessRestartEntrypoints
ApplicationCoordinatorEntrypoints
PolicyModeHandlers
LegacyExecuteHandlers
PreloadRuntimeControlExports
RendererRuntimeControlConsumers
AllowedProductionCompositionRoot
DuplicateExecutableEntrypoints
```

PASS门槛：

- 每类权威入口符合计划数量。
- `DuplicateExecutableEntrypoints=[]`。
- generic Runtime command handler为0。

---

## 19. 开发者对抗式自审计划

实施完成但冻结implementation commit前，开发者必须独立执行以下自审，不得只重复required tests：

### 19.1 身份与边界自审

- 从Activation binding commit重新diff全部改动。
- 证明没有WP7、installer或发布逻辑改动。
- 证明没有数据库schema或migration改动。
- 证明没有secret进入Git。

### 19.2 Authority攻击审查

尝试证明存在第二：

- AppRuntime
- LifecycleStateMachine
- RuntimeStateStore writer
- operating mode writer
- application lifecycle coordinator
- backend start/restart入口
- generic command executor

任何一个可成立则不得提交。

### 19.3 Bypass攻击审查

主动搜索和动态触发：

- `/policy safeMode`
- `executeLegacy` lifecycle命令
- generic `/api/core/command`
- preload generic executor
- main direct fallback
- DesktopHost direct fallback
- API v2失败后的兼容回退
- process-local event作为authority

### 19.4 Crash攻击审查

分别在：

- snapshot请求前后
- event poll前后
- command POST前后
- persist后apply前
- apply后publish前
- stop命令后exit前
- owner acceptance前后
- FD6 close前后
- restart新owner建立前后

注入崩溃或异常，确认稳定恢复或fail closed。

### 19.5 Scanner攻击审查

使用：

- 大小写变体
- 字符串拼接require
- dynamic import
- symlink/junction
- app.asar.unpacked
- nested zip/asar
- test fixture改名
- scanner读取错误

验证不能获得虚假zero。

### 19.6 Evidence攻击审查

- 删除一个required字段，validator必须失败。
- 将source identity替换为错误commit，validator必须失败。
- 漏一个风险ID，validator必须失败。
- 注入token-like material，secret scan必须失败。
- 将failed test配成PASS，aggregate verifier必须失败。

自审输出：

`WP6_DEVELOPER_ADVERSARIAL_REVIEW.json`

至少包含：

- checks总数
- pass/fail
-攻击方法
- oracle
- failed reason codes
- known gaps
- secretMaterialPresent=false

---

## 20. WP5及历史工作包回归范围

WP6候选必须在冻结implementation commit上执行：

### 20.1 WP0

- 全部WP0 tests
- WP0 gate
- evidence/gate脚本
- protected build/package/release规则不得被破坏

### 20.2 WP1

- 全部WP1 tests
- release identity与pipeline约束

### 20.3 WP2

- 全部WP2 tests
- Electron不含业务Runtime
- API session leak scanner
- 保留风险：`WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION`

不得宣称scanner覆盖所有SHA256等价编码。

### 20.4 WP3

- 全部WP3 tests
- singleton、mutex、lease、fencing、API auth、contract、idempotency、event sequence
- Windows Named Mutex既有skip必须保持可见
- 保留风险：`WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION`

### 20.5 WP4

- 全部47个WP4 test files及全部测试
- credential authority lifecycle
- FD4/FD5/FD6
- application coordinator
- rejected owner containment
- owner exit recovery
- mutation、fault和containment矩阵
- 保留风险：`WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION`

### 20.6 WP5

- 全部WP5 tests
- fault matrix
- concurrency/crash matrix
- mutation matrix
- source closure
- developer adversarial review
- Windows legacy cutover evidence合同
- Yance27只读和Yance29-only writes
- runtime_state唯一authority
- operating mode ledger和revision
- legacyFallbackUsed=false
- 保留风险：`WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED`

### 20.7 其他检查

- 全部tracked JavaScript syntax check
- dependency lockfile一致性
- repository clean
- source tree绑定
- changed-files边界

---

## 21. Convergence Pre-Review轻量包内容

WP6实现完成后，第一阶段只允许生成轻量候选：

1. WP6 implementation Git bundle
2. 从Activation binding commit到implementation commit的完整patch
3. implementation commit
4. implementation source tree
5. parent commit和parent tree
6. changed-files manifest
7. upstream-binding.json
8. WP6 required tests原始输出和汇总
9. WP0至WP5回归原始输出和汇总
10. WP0 gate结果
11. fault matrix
12. concurrency/crash matrix
13. mutation matrix
14. 五个R5固定evidence JSON
15. evidence validator结果
16. source old-runtime scan
17. installed-tree scan及扫描输入身份
18. runtime entrypoint inventory
19. developer adversarial review
20. known gaps、UNPROVEN、UNKNOWN和风险声明
21. Git identity、fsck和bundle verify
22. patch reconstruction证明
23. repository clean证明
24. SHA256清单

轻量包不得包含：

- candidate binding commit
- Final Delivery HEAD
-完整Source ZIP
-完整Test Artifacts ZIP
-完整Delivery ZIP
- WP6 COMPLETED状态
- WP7 Activation

---

## 22. Convergence Pre-Review退出条件

只有全部条件满足，才可提交独立Convergence Pre-Review：

1. implementation commit父链精确从accepted Activation binding commit开始。
2. repository clean。
3. WP6十项固定required tests全部PASS。
4. 所有追加WP6关键测试PASS。
5. fault matrix全部PASS。
6. concurrency/crash matrix全部PASS。
7. mutation 0 survivor、0 invalid、0 timeout、0 signal、0 harness error。
8. 五个evidence JSON全部生成并通过schema validator。
9. API v2 bypass count=0。
10. policy mode control count=0。
11. legacy execute mode control count=0。
12. direct lifecycle fallback reachable count=0。
13. coordinator bypass count=0。
14. old Runtime source hit count=0。
15. installed-tree old Runtime hit count=0。
16. duplicate executable runtime entrypoint=0。
17. legacyFallbackUsed=false。
18. Yance27 write count=0。
19. WP0至WP5全部回归符合正式接受基线。
20. WP3 Windows既有accepted skip未被隐藏。
21. WP4 Windows evidence limitation未被伪造关闭。
22. developer adversarial review全部PASS。
23. known gaps为空，或被明确登记为仍阻断而不提交。
24. evidence secretMaterialPresent=false。
25. patch可精确重建implementation tree。
26. bundle完整历史且git fsck通过。

满足后只能请求：

`WP6_PREACCEPTED_FOR_FINAL_PACKAGING`

不得自行签发。

---

## 23. Final Packaging禁止提前生成规则

在收到项目所有者或独立审核明确签发：

`WP6_PREACCEPTED_FOR_FINAL_PACKAGING`

之前，严格禁止：

- 创建candidate binding commit
- 创建Final Delivery HEAD
- 更新WP6为COMPLETED
- 将WP6 reviewStatus改为final pending/accepted
- 创建完整Source ZIP
- 创建完整Test Artifacts ZIP
- 创建完整Delivery ZIP
- 创建最终Delivery JSON
- 创建WP7 Activation commit
- 激活WP7
- 冻结WP7发布构建

任何脚本必须有显式preacceptance token门禁。缺少token时应返回：

`WP6_FINAL_PACKAGING_NOT_AUTHORIZED`

---

## 24. 所有仍存在的UNPROVEN、UNKNOWN和风险项

### 24.1 UNPROVEN

以下事项在本计划发布时仍未实施或未执行：

- WP6生产代码实现：`UNPROVEN_NOT_IMPLEMENTED`
- ApiV2RuntimeClient：`UNPROVEN_NOT_IMPLEMENTED`
- RuntimeProjectionCoordinator：`UNPROVEN_NOT_IMPLEMENTED`
- trusted-owner snapshot baseline集成：`UNPROVEN`
- API v2 event poll和gap恢复：`UNPROVEN`
- stale owner/session response丢弃：`UNPROVEN`
- graceful stop API v2集成：`UNPROVEN`
- backend crash command恢复集成：`UNPROVEN`
- `/policy` operating mode写路径清零：`UNPROVEN`
- `executeLegacy` Runtime控制清零：`UNPROVEN`
- generic Runtime command入口清零：`UNPROVEN`
- main.js direct lifecycle fallback清零：`UNPROVEN`
- DesktopHost coordinator bypass清零：`UNPROVEN`
- retired backend runtime stub物理删除：`UNPROVEN`
- duplicate runtime entrypoint zero：`UNPROVEN`
- old Runtime source scan zero：`UNPROVEN`
- installed-tree scan zero：`UNPROVEN`
- WP6 required tests：`UNPROVEN_NOT_EXECUTED`
- WP6 fault matrix：`UNPROVEN_NOT_EXECUTED`
- WP6 concurrency/crash matrix：`UNPROVEN_NOT_EXECUTED`
- WP6 mutation 0 survivor：`UNPROVEN_NOT_EXECUTED`
- 五个evidence JSON：`UNPROVEN_NOT_GENERATED`
- developer adversarial review：`UNPROVEN_NOT_EXECUTED`
- WP0至WP5在WP6实现上的回归：`UNPROVEN_NOT_EXECUTED`
- Convergence Pre-Review：`UNPROVEN_NOT_SUBMITTED`
- Final Packaging：`UNPROVEN_NOT_AUTHORIZED`
- WP6最终独立审核：`UNPROVEN_NOT_STARTED`

### 24.2 UNKNOWN

- Windows真实installed-tree扫描结果：`UNKNOWN_NOT_EXECUTED`
- backend crash各进程边界在真实Windows环境的时序：`UNKNOWN_NOT_EXECUTED`
- WP4 Windows reboot boundary、PID reuse和完整owner identity实机证据：`UNKNOWN_ACCEPTED_UPSTREAM_EXCEPTION`
- WP3 Windows Named Mutex真实机器验证：`UNKNOWN_ACCEPTED_UPSTREAM_EXCEPTION`

### 24.3 已接受历史风险

必须完整继承：

```text
WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION
WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION
WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION
WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED
```

这些风险不得扩展为：

- 忽略WP6测试失败
- 忽略identity不匹配
- 忽略API v2 bypass
- 忽略旧Runtime残留
- 忽略scanner错误
- 忽略秘密材料泄漏
- 忽略WP6状态错误

### 24.4 当前Design Gate风险判断

未发现需要停止Design Gate的上游接口或基线冲突。

已知实施复杂度集中在：

1. trusted owner接受与首个snapshot候选的顺序绑定。
2. graceful stop的API v2 Runtime命令与Electron process custody边界。
3. 现有业务WebSocket和新Runtime persisted event通道的严格分离。
4. `AppRuntime.executeLegacy`和`/api/core/command`的业务兼容收口。
5. direct lifecycle fallback物理删除后对WP4 coordinator测试的回归。
6. installed-tree scanner完整性和虚假zero防护。

这些属于WP6正式实施目标，不是Design Gate阻断。

---

## 25. 建议实施顺序

收到`WP6_DESIGN_GATE_CONFIRMED`后，按以下顺序实施，不得并行跳步：

### Phase A：测试和scanner骨架

1. 创建`tests/wp6`和`tools/wp6`。
2. 先写失败测试和evidence schema validator。
3. 建立source/installed scan完整性门禁。
4. 不生成PASS evidence。

### Phase B：API v2客户端和projection

1. 实现ApiV2RuntimeClient。
2. 实现RuntimeProjectionCoordinator。
3. 绑定owner/session generation和AbortController。
4. 完成snapshot、event poll和gap恢复。

### Phase C：生命周期集成

1. 将main.js接入projection coordinator。
2. owner acceptance加入projection验证。
3. stop/restart接入API v2 graceful stop和process custody。
4. 删除生产direct fallback。

### Phase D：Operating mode和legacy入口收口

1. renderer改用窄化API v2 mode命令。
2. `/policy`拒绝safeMode写。
3. 删除AppRuntime自动v2/legacy分流。
4. 将业务命令入口白名单化。
5. 阻断generic Runtime command。

### Phase E：旧Runtime物理删除和入口唯一化

1. 删除retired stubs和无调用facade。
2. 盘点所有factory、constructor、writer和handler。
3. 清除duplicate可执行入口。
4. 运行source scan。

### Phase F：故障、并发、mutation和回归

1. required tests。
2. fault matrix。
3. concurrency/crash matrix。
4. mutation matrix。
5. WP0至WP5全量回归。
6. developer adversarial review。

### Phase G：evidence和轻量候选

1. 在冻结implementation commit后生成五个evidence。
2. 生成bundle、patch、identity和SHA256。
3. 验证clean、fsck和patch reconstruction。
4. 只生成Convergence Pre-Review轻量包。
5. 停止等待独立审核。

---

## 26. Design Gate最终结论

基线、父链、source tree、bundle、repository clean、Readiness设计、Readiness审查、Activation Readiness重绑定和正式Activation接受决定已完成一致性核验。

未发现阻止进入WP6 Design Gate确认的冲突。

本计划完整定义了WP6实施边界和退出门禁，但没有授权生产实现。

当前正式值保持：

```text
WP6_PRODUCTION_IMPLEMENTATION_AUTHORIZED:
false

WP6_DESIGN_GATE_STATUS:
PLAN_ISSUED_AWAITING_OWNER_CONFIRMATION

WP6_REQUIRED_TESTS_STATUS:
NOT_STARTED

WP6_EVIDENCE_STATUS:
NOT_STARTED

WP6_FINAL_PACKAGING_AUTHORIZED:
false

WP7_STATUS:
BLOCKED_BY_WP6
```

下一项且唯一允许的治理决定：

`WP6_DESIGN_GATE_CONFIRMED`
