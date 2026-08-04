# Yance OSS-1A 启动前 FD6 权威推进与 READY 握手修订

> **绑定关系：** 本文是 `2026-08-04-yance-oss-1a-credential-custody-callgraph.md` 的后续修订。仅在本文明确冲突处取代其“现有 FD5/FD6 sealed core 无需修改”的结论；其余 CredentialVault、DEK、Cipher、Composition、禁止回退与治理条款继续生效。

## 1. 独立 RED 证据

### 精确目标

```text
repository: laiqian0239-glitch/yance
implementation branch: oss/1a-baileys-lifecycle
exact RED Head: a33e6e9a20659714b2516cc5ec8265472b3c994b
OSS-1A workflow run: 30951977457
runtime job: 92135997239
```

精确命令：

```bash
node --test --test-concurrency=1 backend/tests/oss1aWhatsappAuthSchema.test.js
```

精确结果：

```text
tests 20
pass 19
fail 1
cancelled 0
skipped 0
todo 0
```

原有 19 项 Schema 23、Cipher、KeyAuthority 与真实 Composition 合同全部保持 GREEN。唯一失败为：

```text
real FD6 custody persists the WhatsApp DEK and the next backend owner restores it through FD5
```

精确错误：

```text
Credential ready acknowledgement metadata does not match the transmitted snapshot
```

失败栈进入：

```text
electron/desktopHost/BackendProcessHost.js
  -> assertCredentialHandshakeBinding
  -> BackendProcessHost._startUnlocked
```

这不是 checkout、依赖安装、测试夹具初始化、超时、Schema、Cipher、Vault 加密或 FD6 事务失败。它是由真实生产启动时序触发的握手权威冲突。

## 2. 根因

当前启动顺序为：

```text
CredentialVaultHost.createHydrationFrame
  -> FD5 generation N snapshot
  -> backend:credential-hydrated acknowledgement for generation N
  -> AppRuntime.startProductionServices
  -> WhatsAppAuthKeyAuthority.start
  -> empty fixed DEK ref
  -> SecurityGuard.credentials.persist
  -> secureBridge
  -> FD6 committed transaction
  -> CredentialVaultHost authority generation N+1
  -> AppRuntime credential metadata generation N+1
  -> backend:ready reports current generation N+1
```

`BackendProcessHost` 当前把两个不同语义的消息都与最初发送的 FD5 frame 做逐字段相等比较：

1. `backend:credential-hydrated`：证明子进程准确消费了最初 FD5 snapshot；
2. `backend:ready`：报告生产服务启动完成时的当前 AppRuntime credential authority。

第一项必须继续与初始 FD5 frame 精确相等。第二项在同 owner 于 READY 前完成合法 FD6 事务时，理应反映新的 CredentialVault 权威边界。继续要求 READY 等于旧 frame 会拒绝真实、已提交且已同步到 AppRuntime/SQLite 的权威推进。

## 3. 禁止的伪修复

以下方案全部禁止：

- 删除或跳过 READY credential metadata 校验；
- 接受任意 `generation >= initialGeneration`；
- 只比较 generation，不比较 vault epoch、authority event/head、counts 与 payload bytes；
- 在 READY 中伪报旧 generation；
- 阻止 AppRuntime 在 FD6 commit 后更新 credential metadata；
- 让 KeyAuthority 在 DEK 尚未持久化时宣称 started；
- 把 KeyAuthority 移到 READY 之后或账号服务之后；
- 在首启时由 DesktopHost 直接预生成 WhatsApp DEK；
- 绕过 FD6，使用环境变量、命令行、SQLite、普通文件或进程临时 key；
- 把握手失败改成 warning-only；
- 修改 FD5 frame 格式、协议版本或秘密传输方式来回避该冲突。

## 4. 权威语义拆分

### 4.1 Hydration ACK 保持严格不变

`backend:credential-hydrated` 必须继续逐字段等于初始 FD5 frame：

```text
pid
startupNonce
vaultEpoch
generation
authorityEventId
vaultReferenceCount
decryptedEntryCount
frameEntryCount
entryCount
payloadBytes
restoredReferenceCount
```

任何缺失、不等、重复 token、错误 owner/session、错误 manifest 或错误 vault epoch 继续 fail closed。

### 4.2 READY 改为当前 Vault 权威证明

`backend:ready` 的 credential metadata 只能通过以下两种模式之一：

```text
INITIAL_FD5_EXACT
SAME_OWNER_PRE_READY_FD6_COMMITTED_ADVANCE
```

#### INITIAL_FD5_EXACT

READY metadata 与最初 FD5 frame 完全相等，现有行为不变。

#### SAME_OWNER_PRE_READY_FD6_COMMITTED_ADVANCE

READY metadata 可以高于初始 generation，但必须由 `CredentialVaultHost` 独立证明其正是当前权威边界，而不是由 `BackendProcessHost` 根据子进程自报值推断。

## 5. CredentialVaultHost 新职责

允许在现有 `CredentialVaultHost` 中增加一个无秘密返回的 READY authority validator。名称可由实现选择，但合同必须满足下列语义。

### 输入

- 最初发送的 FD5 frame metadata；
- 已验证的 hydration acknowledgement；
- backend READY credential metadata；
- 当前 pending/active owner session；
- 当前 startup attempt/session binding。

### 验证

Validator 必须：

1. 调用现有 operational、application fence 与 authority journal 校验；
2. 要求 initial frame、hydration ACK、READY 都属于同一：
   - backend PID；
   - startup nonce；
   - backend session id；
   - FD6 pipe instance id；
   - manifest SHA-256；
   - vault epoch；
3. 要求 hydration ACK 仍精确等于 initial frame；
4. 要求当前 authority 无 non-terminal transaction、无 active transaction ambiguity、无 reset、无 owner replacement；
5. 从 VaultHost 当前 journal head、metadata projection 与 vault raw digest 重新验证：
   - generation；
   - authorityEventId；
   - authorityHeadDigest；
   - reference count；
6. 使用现有 `vault.entriesStrict()` 取得当前解密条目，仅在内存中按 canonical ref order 重建 entries；
7. 使用现有 credential protocol canonical payload 计算逻辑重新计算：
   - vaultReferenceCount；
   - decryptedEntryCount；
   - frameEntryCount；
   - entryCount；
   - restoredReferenceCount；
   - payloadBytes；
8. 要求 READY metadata 与该独立重算结果逐字段相等；
9. 若 generation 高于 initial generation，要求中间每次 generation 推进均由同一 owner/session 的 terminal `COMMITTED` FD6 transaction 连续产生；
10. 拒绝 rollback、indeterminate、aborting、reset、desktop mutation、其他 owner、缺失 journal 历史或 generation 跳跃；
11. 不返回 entries、credential value、raw DEK、ciphertext、vault digest 或任何可恢复秘密的材料。

### 输出

返回冻结的无秘密 receipt，例如：

```js
{
  accepted: true,
  mode: 'INITIAL_FD5_EXACT' | 'SAME_OWNER_PRE_READY_FD6_COMMITTED_ADVANCE',
  vaultEpoch,
  initialGeneration,
  readyGeneration,
  authorityEventId,
  authorityHeadDigest,
  referenceCount,
  payloadBytes,
  ownerSessionMatched: true,
  journalHeadMatched: true
}
```

字段名称可调整，但不能减少上述证明语义。

## 6. BackendProcessHost 新职责

`BackendProcessHost` 必须：

1. 保留现有 hydration ACK 精确比较；
2. 保留 `CredentialVaultHost.markHydrationAccepted()` 的 owner 激活语义；
3. 对 READY metadata：
   - 先执行 existing exact comparison；
   - 若 exact，则按 `INITIAL_FD5_EXACT` 接受；
   - 若不 exact，不得自行放宽或只比较 generation；
   - 必须调用同一个 `CredentialVaultHost` 的 current-authority validator；
   - validator 返回已验证 receipt 后才能进入 RUNNING；
4. 把验证 receipt 保存在非秘密 session/start evidence 中；
5. validator 缺失、抛错、返回非 frozen/不完整 receipt 或 metadata 不匹配时 fail closed；
6. 不把 READY current metadata 反写成新的 FD5 hydration ACK；两种证据必须保持语义分离。

## 7. 精确修改面

独立 RED 已证明原先 sealed core 的两条路径必须进入新的父级授权：

```text
electron/desktopHost/BackendProcessHost.js
electron/desktopHost/CredentialVaultHost.js
```

继续复用且不修改：

```text
electron/credentialVault.js
electron/desktopHost/DesktopHost.js
backend/bootstrap/credentialHydrationPipe.js
backend/bootstrap/applyCredentialSnapshot.js
backend/runtime/BootCoordinator.js
backend/core/securityGuard.js
backend/core/securityGuardSingleton.js
backend/services/secureBridge.js
shared/credentialProtocol.js
shared/credentialCustodyProtocol.js
```

不得因为 validator 需要 canonical counts 而修改共享 frame 格式或协议版本；应复用现有 protocol helper。

## 8. 必须新增/保留的行为合同

现有 RED 文件继续作为主集成合同：

```text
tests/wp4/oss1a-whatsapp-dek-custody.test.js
```

至少还必须覆盖：

1. READY 与 initial FD5 完全相等时继续通过；
2. 同 owner 在 READY 前完成一个合法 FD6 persist 时通过；
3. 同 owner 连续完成多个合法 FD6 commit 时，只有当前 journal head metadata 可通过；
4. generation 更高但 journal head 不匹配时拒绝；
5. authorityEventId 或 authorityHeadDigest 错误时拒绝；
6. reference/decrypted/frame/entry/restored count 任一错误时拒绝；
7. payloadBytes 错误时拒绝；
8. vault epoch 错误时拒绝；
9. PID、startup nonce、backend session、FD6 pipe 或 manifest 错误时拒绝；
10. 存在 PREPARED/COMMITTING/INDETERMINATE/ABORTING transaction 时拒绝；
11. generation 跳跃、rollback、reset 或 desktop mutation 夹在中间时拒绝；
12. rejected-owner containment 时 FD6 persist 继续失败，READY 不得借 current-authority validator 越过 fence；
13. 下一 owner FD5 恢复同一 DEK record，KeyAuthority 零重复 persist；
14. journal、日志、SQLite 与普通运行时文件中不存在 raw DEK 或其常见编码/摘要。

## 9. 新授权要求

原 29-path authorization 不足以实现该根修复。新的 governance successor 必须：

- 从冻结 v3 baseline 的精确 Head 派生；
- 保留原 29 个 runtime paths；
- 精确新增上述 2 个 sealed paths；
- 新 approved runtime path count 为 31；
- 重新计算 sorted unique path-set SHA-256；
- 使用新的 authorization version、receipt 与 implementation base；
- 保持 branch、Draft、no-merge、no-production、no-release、no-publish 与 no-bypass 约束；
- 不向冻结 PR #23、#25 或 #28 追加普通提交；
- 在新 authorization seal 完成前，PR #24 必须停留在 test-only RED Head，不得修改这两条生产路径。

## 10. 停止边界

当前 implementation branch 的合法状态是：

```text
currentExactRedHead=a33e6e9a20659714b2516cc5ec8265472b3c994b
productionCoreFixStarted=false
parentScopeAmendmentRequired=true
mergeAuthorized=false
productionUseAuthorized=false
temporaryBypassAllowed=false
warningOnlyClosureAllowed=false
```

只有新的 31-path governance successor 完成精确授权、验证与封印后，才能从该 RED 进入 GREEN。
