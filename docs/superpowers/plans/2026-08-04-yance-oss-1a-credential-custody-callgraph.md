# Yance OSS-1A Credential Custody 精确调用图与授权面收敛

> **绑定关系：** 本文收敛并替代 `2026-08-04-yance-oss-1a-credential-encryption-amendment.md` 中 Task 1A 的“候选路径”。除非后续 RED 测试证明现有权威合同本身有缺陷，OSS-1A 不得修改本文列为“复用且不修改”的文件。

## 已验证的现有权威调用图

### 桌面端启动快照

```text
DesktopHost.startBackend/restartBackend
  -> CredentialVaultHost.createHydrationFrame
  -> BackendProcessHost.start
  -> FD5 dedicated inherited pipe
  -> credential frame
```

已确认：

- `electron/desktopHost/DesktopHost.js` 把 `CredentialVaultHost.createHydrationFrame()` 作为 `createCredentialSnapshot` 传给 `BackendProcessHost`；
- `CredentialVaultHost` 已执行 application lease、rejected-owner containment、active owner、pending mutation、vault lifecycle 和 journal 校验；
- `BackendProcessHost` 只在子进程 PID、startup nonce、manifest、session 和一次性 token 已知后生成/发送 frame。

### 后端启动恢复

```text
BootCoordinator.start
  -> hydrateCredentialsFromPipe
  -> applyCredentialSnapshot
  -> secureBridge.replaceRuntimeSnapshot
  -> bindCredentialAuthority
  -> AppRuntime.configureProductionServices
  -> AppRuntime.startProductionServices
```

已确认：

- `backend/runtime/BootCoordinator.js` 在 runtime factory 前读取 FD5，校验 reference counts，并在主 Store 中接受 credential hydration；
- `backend/bootstrap/applyCredentialSnapshot.js` 把完整快照一次替换到 `secureBridge`，禁止重复 ref 和非对象 value；
- `BootCoordinator` 在 production services 启动前绑定 `secureBridge` 的 prepare/commit/rollback authority updater；
- `backend/server.js` 在启动迁移和权威命令后调用 `APP_RUNTIME.startProductionServices()`。

### 后端运行期持久化

```text
SecurityGuard.credentials.persist/remove
  -> secureBridge.persist/remove
  -> CredentialCustodyClient
  -> FD6 transactional custody
  -> CredentialVaultHost
  -> authority prepare/commit/rollback
  -> secureBridge runtime candidate commit
  -> AppRuntime + primary SQLite credential generation advance
```

已确认：

- `backend/core/securityGuard.js` 已提供受 lifecycle、safe mode、internal actor 和 system policy 约束的 `credentials.get/has/listRefs/persist/remove`；
- `backend/services/secureBridge.js` 已实现运行时快照、候选 map、FD6 custody、authority prepare/commit/rollback 和 owner recovery；
- credential value 可以是普通对象，适合存放版本化 DEK envelope；
- 运行期持久化成功后，vault、runtime map、AppRuntime credential metadata 和主 SQLite credential generation 同步推进。

## 结论

OSS-1A **不需要** 修改启动/保管协议来保存 WhatsApp DEK。修改这些已封印权威文件会扩大风险面，且没有当前证据支持。

### 复用且默认禁止修改

```text
electron/credentialVault.js
electron/desktopHost/CredentialVaultHost.js
electron/desktopHost/DesktopHost.js
electron/desktopHost/BackendProcessHost.js
backend/bootstrap/credentialHydrationPipe.js
backend/bootstrap/applyCredentialSnapshot.js
backend/runtime/BootCoordinator.js
backend/core/securityGuard.js
backend/core/securityGuardSingleton.js
backend/services/secureBridge.js
shared/credentialProtocol.js
shared/credentialCustodyProtocol.js
```

这些文件只有在独立 RED 测试证明其现有合同无法安全承载 DEK 时，才能通过新的父级 scope amendment 加入授权。不得在 OSS-1A implementation 分支内自扩。

## Task 1A 精确实现路径

### Create

```text
backend/security/whatsappAuthCipher.js
backend/services/whatsappAuthKeyAuthority.js
backend/tests/oss1aWhatsappAuthCipher.test.js
backend/tests/oss1aWhatsappAuthKeyAuthority.test.js
backend/tests/oss1aWhatsappAuthKeyRuntimeOrder.test.js
tests/wp4/oss1a-whatsapp-dek-custody.test.js
```

### Modify

```text
backend/runtime/AppRuntimeComposition.js
```

### 为什么只修改 Composition

`AppRuntimeComposition` 已取得 `securityGuard`，并定义 production service 的确定启动顺序。新增：

```text
security-guard
whatsapp-auth-key-authority
ai-gateway
recovery-manager
account-lifecycle-saga
account-context
...
```

`whatsapp-auth-key-authority` 必须位于：

- `security-guard` 之后；
- `account-lifecycle-saga`、`account-context` 和任何可能启动 WhatsApp socket 的服务之前。

它是 critical participant；DEK 不可用时生产服务启动失败，WhatsApp 不得降级到明文或文件认证。

## `WhatsAppAuthKeyAuthority` 合同

### 固定引用

```text
whatsapp-auth-data-key:v1
```

### 最小接口

```js
prepare()
start()
getCipher()
rotate(input)
stop()
snapshot()
```

### `prepare()`

- 只检查依赖与 `SecurityGuard.credentials` capability；
- 不生成或持久化密钥；
- 验证当前 lifecycle 允许安全凭据读取。

### `start()`

1. 使用 process-local single-flight promise，所有并发调用共享一个结果；
2. 通过 `credentials.get(ref, { actor: 'backend-core' })` 读取现有值；
3. 已存在时严格验证 algorithm、keyVersion、32-byte base64、purpose 和时间；
4. 不存在时生成 32 random bytes；
5. 通过 `credentials.persist(ref, value, { actor: 'backend-core' })` 走现有 FD6 authority；
6. 持久化完成后重新从 `credentials.get()` 读取权威值；
7. 重新读取值若不是本次值或合法既存值，返回 `WHATSAPP_AUTH_KEY_AUTHORITY_CONFLICT`；
8. 创建 `WhatsAppAuthCipher` capability；
9. 不返回 raw DEK。

### 并发与崩溃

现有单 backend owner 加 process-local single-flight 防止同一 owner 内重复创建；FD6 authority 提供跨持久化事务串行化。测试必须覆盖：

- 两个并发 `start()` 只调用一次 persist；
- persist 成功、内存赋值前崩溃，重启从 FD5 恢复同一 key；
- persist 报 indeterminate，当前启动 fail closed；下一启动以 vault 权威恢复；
- owner replacement 后旧 authority `stop()` 并关闭 cipher；
- 已存在合法 key 时零持久化；
- 已存在无效 key 时不覆盖，直接 quarantine/fail closed。

不通过“最后写入者获胜”处理两个不同密钥；检测到权威冲突必须失败。

### `rotate()`

首个 OSS-1A implementation batch 只实现接口与 `NOT_AUTHORIZED` 明确拒绝，除非 Task 0 精确授权已包含完整轮换 schema、双版本读取、迁移和崩溃矩阵。不能在首批中偷偷启用轮换。

### `stop()`

- 调用 cipher `close()`；
- 清除 authority 持有的 Buffer 引用；
- 不从 Vault 删除长期 DEK；
- owner replacement 后 `getCipher()` 必须拒绝。

## `WhatsAppAuthCipher` 合同补充

- constructor 只接受由 key authority 内部创建的不可伪造 capability，不接受任意 base64 字符串；
- raw key 不暴露为公共属性；
- `snapshot()` 只返回 algorithm/keyVersion/state，不返回 key、nonce、ciphertext；
- encryption/HMAC purpose keys 由 HKDF 分离；
- 每次 encrypt 使用新的 12-byte nonce；
- decrypt 前验证 envelope 结构、keyVersion、AAD identity；
- 错误对象不得附带 plaintext、raw key、完整 envelope 或原始远端标识；
- `close()` 后所有操作失败。

## Task 0 精确授权影响

Task 0 的 OSS-1A exact path set 必须：

- 包含本文的 7 个 Task 1A 实现/测试路径；
- 不包含上述 12 个已封印复用文件；
- 把 `backend/runtime/AppRuntimeComposition.js` 列为唯一现有 credential runtime 组合修改点；
- 为 Schema 23、auth repository、legacy import 和 generation fence 另列精确路径；
- 不使用 `backend/**`、`electron/**`、`tests/**` 或任何通配。

## 新增 RED 测试

`backend/tests/oss1aWhatsappAuthKeyRuntimeOrder.test.js` 必须从真实 composition 证明：

- key authority 紧跟 security guard；
- key authority 先于 account lifecycle/context；
- participant 为 critical；
- key authority start 失败时后续账号服务不启动；
- key authority 未 ready 时 WhatsApp adapter 无法取得 cipher；
- safe mode/credential authority unavailable 时不生成临时 key。

`tests/wp4/oss1a-whatsapp-dek-custody.test.js` 必须使用现有 CredentialVaultHost/BackendProcessHost/BootCoordinator 测试夹具证明：

- 新 DEK 通过 FD6 persist 后进入 vault authority journal；
- 新 backend owner 通过下一次 FD5 snapshot 恢复相同 key version；
- reference count、payload bytes、vault generation 和 AppRuntime generation 继续一致；
- rejected owner containment 阻断 DEK persist；
- 无任何启动协议、管道或 vault 核心源码修改也能完成该闭环。

## 禁止回退

- 为方便生成 DEK 而修改 FD5 frame 格式；
- 绕过 `SecurityGuard.credentials.persist` 直接调用 `secureBridge`；
- 从 backend 直接访问 Electron vault 文件；
- 把 DEK 作为环境变量传递；
- 在 key authority 未 ready 时启用 WhatsApp；
- key 竞争时静默选择一个值；
- 首批未授权密钥轮换；
- 因测试难写而把 CredentialVaultHost 加入广泛授权。
