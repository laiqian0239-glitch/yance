# Yance OSS-1A 认证材料加密与消息投影修订

> **状态：** 本文是 `2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md` 的绑定安全修订。主计划中所有明文 `creds_json`、`value_json`、`raw_message_json`、普通 SHA-256 身份索引和“旧认证目录长期备份”条款，均由本文替代。

## 修订原因

主计划正确要求把 Baileys 认证状态迁入 Yance 唯一主 SQLite Store，但初稿把 credentials、Signal keys 和 Baileys retry payload 设计为明文 JSON 列。这会产生三个根问题：

1. SQLite 文件泄露即可直接取得 WhatsApp 长期身份和 Signal key material；
2. 在 OSS-1A 内另造密钥存储，会与现有 `CredentialVault`、`CredentialVaultHost` 和一次性 backend hydration 权威冲突；
3. `whatsapp_message_key_index.raw_message_json` 同时保存索引和完整消息内容，使索引成为第二消息权威。

现有 Yance 已具备：

- Electron `safeStorage` 支持的本机用户级加密；
- `CredentialVaultHost` 单一变更权威、journal 和崩溃恢复；
- 一次性 token、PID、manifest、vault epoch、reference count 和 authority head 绑定的 backend credential hydration pipe；
- 现有 canonical message 权威表 `communication_canonical_messages(message_id)`。

OSS-1A 必须复用这些底座，不得平行建设第二个 vault、第二个 Store 或第二消息权威。

## 安全决定

### 1. WhatsApp 数据加密密钥只由现有 CredentialVault 持有

新增凭据引用：

```text
whatsapp-auth-data-key:v1
```

Vault 值：

```json
{
  "algorithm": "AES-256-GCM",
  "keyVersion": 1,
  "keyBase64": "<32 random bytes>",
  "createdAt": "<ISO timestamp>",
  "purpose": "WHATSAPP_AUTH_AND_RETRY_PROJECTION"
}
```

约束：

- 使用 `crypto.randomBytes(32)` 生成；
- 只能通过 `CredentialVaultHost` 受权事务创建、读取、轮换或删除；
- 不写入 SQLite、普通文件、环境变量、命令行、日志、测试快照或治理证据；
- backend 不得自行生成一个无法由桌面 vault 恢复的长期主密钥；
- OS secure storage 不可用、vault 损坏、hydration 缺失或 key version 不支持时 fail closed；
- 不允许回退到明文认证存储。

### 2. 后端复用现有一次性 hydration

启动路径：

```text
CredentialVaultHost
  -> existing authority transaction
  -> existing one-time credential frame
  -> backend/bootstrap/credentialHydrationPipe.js
  -> runtime credential capability
  -> WhatsAppAuthCipher
```

不得削弱现有 token replay、PID、manifest、vault epoch、entry count 和 authority-head 验证。

后端约束：

- DEK 只存在于当前 runtime owner 内存；
- repository 不接受 raw key 参数，只接受 `WhatsAppAuthCipher` capability；
- shutdown、owner replacement 和 fatal containment 时尽力执行 `Buffer.fill(0)`；
- 审计证据必须承认 JavaScript 堆内存不能被证明完全锁定或可靠清零；
- renderer、普通 worker、日志接口和子进程不得获得 DEK。

### 3. 版本化 AEAD envelope

算法合同：

```text
AES-256-GCM
nonce: random 12 bytes per encryption
auth tag: 16 bytes
keyVersion: positive integer
```

每条加密记录包含：

```text
cipher_version
key_version
nonce
ciphertext
auth_tag
ciphertext_sha256
```

`ciphertext_sha256` 只用于定位存储损坏，不替代 GCM tag，也不得改成无密钥明文 hash。

AAD 使用 typed builder，并按冻结顺序绑定适用字段：

```text
schemaVersion
recordType
accountKey
accountId
currentEpoch
category
keyId
canonicalMessageId
```

把密文复制到另一个账号、epoch、key category 或 canonical message 时，解密必须失败。

禁止确定性 nonce、时间戳 nonce、主键派生 nonce和任何 nonce 重用。

## 修订后的 Schema 23 合同

### `whatsapp_auth_accounts`

删除主计划中的：

```text
creds_json
creds_sha256
identity_jid
```

替换为：

```text
creds_cipher_version INTEGER NOT NULL
creds_key_version INTEGER NOT NULL
creds_nonce BLOB NOT NULL CHECK(length(creds_nonce)=12)
creds_ciphertext BLOB NOT NULL
creds_auth_tag BLOB NOT NULL CHECK(length(creds_auth_tag)=16)
creds_ciphertext_sha256 TEXT NOT NULL CHECK(length(creds_ciphertext_sha256)=64)
identity_jid_hmac TEXT NOT NULL DEFAULT ''
```

`identity_jid_hmac` 使用从 DEK 通过 HKDF 派生的独立索引密钥计算 HMAC-SHA-256；不得存裸 JID 或普通 SHA-256。

账号 state、epoch、generation、socket token 和时间字段保持明文，以支持条件更新和恢复判定，但不得包含认证内容。

### `whatsapp_auth_keys`

删除主计划中的：

```text
value_json
value_sha256
```

替换为：

```text
value_present INTEGER NOT NULL CHECK(value_present IN (0,1))
cipher_version INTEGER
key_version INTEGER
nonce BLOB
ciphertext BLOB
auth_tag BLOB
ciphertext_sha256 TEXT NOT NULL
```

约束：

- `value_present=0` 表示删除 tombstone；envelope 列必须为空；
- `value_present=1` 时 envelope 列全部存在，nonce/tag 长度正确；
- 同一 `keys.set()` 的 set/delete 在一个短事务中提交；
- 任一值加密失败，整批零写入。

### `whatsapp_message_key_index`

索引只保留映射：

```text
account_id
remote_jid_hmac
message_id_hmac
participant_hmac
from_me
canonical_message_id
created_at
updated_at
```

禁止存：

```text
raw_message_json
message body
media bytes
auth material
```

HMAC 使用与 auth encryption key 分离的 HKDF 派生索引密钥；不允许普通 SHA-256 形成可离线枚举的 JID/message-id 指纹。

### 新增 `whatsapp_message_retry_payloads`

Baileys `getMessage` 所需 protocol payload 使用独立加密投影：

```text
canonical_message_id TEXT PRIMARY KEY
account_id TEXT NOT NULL
cipher_version INTEGER NOT NULL
key_version INTEGER NOT NULL
nonce BLOB NOT NULL CHECK(length(nonce)=12)
ciphertext BLOB NOT NULL
auth_tag BLOB NOT NULL CHECK(length(auth_tag)=16)
ciphertext_sha256 TEXT NOT NULL CHECK(length(ciphertext_sha256)=64)
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
FOREIGN KEY(canonical_message_id)
  REFERENCES communication_canonical_messages(message_id)
  ON DELETE CASCADE
```

要求：

- 与现有 canonical message 严格一对一；
- projection 写入与 canonical message 写入同一 SQLite 事务；若现有写入边界无法一次重构，则必须使用已有持久 repair receipt，并在 repair 完成前让 `getMessage` fail closed；
- revoke、retention 和物理删除必须通过 canonical authority 触发投影清理，不允许独立长期保留；
- `getMessage` 先精确命中 key index，再按 canonical id 读取和解密 projection；
- 解密、AAD、tag、ciphertext hash 或外键任一失败都返回结构化 corruption 状态，不返回猜测 payload；
- retry projection 不成为业务消息编辑、显示、搜索、学习或 Outbox 权威。

### `whatsapp_message_retry_counters`

计数值不是长期认证材料，可保持结构化存储，但必须：

- 按 account 隔离并设置 TTL；
- 不包含 message body、JID 或 auth key；
- cache key 若含远端标识，先使用 HKDF 派生索引密钥做 HMAC。

## 新增 Task 1A：CredentialVault DEK 权威

在 Task 1 Schema 23 之后、Task 2 repository 之前执行。

**候选路径：**

- Modify: `electron/desktopHost/CredentialVaultHost.js`
- Modify: 实际负责生成 startup credential frame 的 DesktopHost 文件
- Modify: `backend/bootstrap/credentialHydrationPipe.js`
- Create: `backend/security/whatsappAuthCipher.js`
- Create: `backend/tests/oss1aWhatsappAuthCipher.test.js`
- Create: `tests/wp4/oss1a-whatsapp-dek-hydration.test.js`
- Modify: OSS-1A 精确授权文件集

Task 0 封印前必须读取实际调用图并把真正需要修改的 exact paths 写入 authority；上述候选列表不构成授权，也不得使用通配。

### RED 测试

1. Vault 中无 DEK 时，只有 CredentialVaultHost 能原子创建；
2. 两个并发启动只能得到同一个 key version；
3. secure storage 不可用时 fail closed；
4. hydration 缺失、重复、错误 PID、错误 manifest 和错误 vault epoch 继续被既有协议拒绝；
5. DEK 不出现在 SQLite、环境、argv、日志和错误对象；
6. 每次加密 nonce 唯一；
7. ciphertext、AAD、tag 任一位变化解密失败；
8. 账号 A 密文复制给 B 解密失败；
9. epoch N 密文复制到 N+1 解密失败；
10. unsupported key version fail closed；
11. owner replacement 后旧 cipher capability 不能继续工作；
12. shutdown/fatal containment 调用内存清理路径；
13. 轮换中崩溃后旧/新 key version 均有确定恢复状态。

### `WhatsAppAuthCipher` 最小接口

```js
encrypt(recordType, aadIdentity, plaintextBuffer)
decrypt(recordType, aadIdentity, envelope)
hmacIndex(purpose, value)
close()
```

实现约束：

- `recordType` 枚举冻结；
- AAD 由 typed builder 生成，不接受任意拼接字符串；
- `close()` 后抛 `WHATSAPP_AUTH_CIPHER_CLOSED`；
- 错误不含明文、密钥、完整 envelope 或原始 JID；
- HKDF 分离 encryption、index 和 log-redaction purpose；
- 不缓存完整解密 auth dataset，只按 Baileys 请求读取必要记录。

## 对主计划 Tasks 的强制修改

### Task 0

精确授权必须加入真正需要的 Vault、hydration、cipher 和测试路径。不能在实现中再以“安全修复”为理由自扩文件集。

### Task 1

Schema 测试必须断言：

- 不存在 `creds_json`、`value_json`、`raw_message_json`；
- envelope 列和 CHECK 完整；
- key index 不含裸远端标识或消息内容；
- retry payload 精确引用 `communication_canonical_messages(message_id)`；
- schema dump、备份和 migration fixture 中无明文 secret。

### Task 2

repository 接收 cipher capability，不接受 raw DEK。写入顺序：

1. generation/epoch/socket token 条件验证；
2. 事务外完成最小必要加密；
3. 开启短事务；
4. 再次条件验证；
5. 写入 envelope；
6. commit；
7. 失败时释放 plaintext Buffer 引用并返回结构化错误。

不得在持有 SQLite 写锁时调用 Electron、IPC 或 safeStorage。

### Task 3

Baileys `AuthenticationState` adapter 只为当前 generation 解密所需 creds/keys。旧 socket、closed store、quarantine 或 key-version mismatch 均为零明文返回。

### Task 4

旧目录导入必须：

- 在内存解析旧文件并立即加密写库；
- 不把旧目录永久保留为备份；
- 成功 receipt 后安全删除，或进入有期限、权限受限、不可被恢复器读取的隔离销毁队列；
- Windows 文件锁失败时保持 cleanup-required，且旧目录永不重新成为 auth 权威；
- crash evidence 不得复制旧 auth 内容。

### Task 8

`getMessage` 读取纯 key index + encrypted retry projection；不从索引直接读取完整 raw message。投影一致性、retention、revoke 和 corruption fault matrix 必须加入测试。

### Task 10

新增故障点：

- DEK 创建 transaction 各阶段；
- hydration 后、cipher capability 建立前；
- encrypt 后、SQLite commit 前；
- key rotation 每个阶段；
- canonical message 与 retry projection commit 边界；
- OS safeStorage 暂时不可用；
-旧 key version 在新版本启用后的读取；
- ciphertext、tag、AAD corruption。

## 明确禁止

- SQLite 明文 creds、Signal keys 或 Baileys retry payload；
- 用数据库文件权限代替加密；
- 用普通 SHA-256 隐藏 JID/message id；
- 把 DEK 写入 `.env`、配置 JSON、SQLite、命令行或日志；
- backend 绕开 CredentialVaultHost 自建长期 master key；
- 每次启动生成新 key 导致旧认证不可恢复；
- 在 SQLite 事务内调用 safeStorage/IPC；
- 密钥轮换期间永久双写明文/密文；
- 把旧认证目录作为长期恢复权威或无限期备份；
- 以“本地桌面应用”为理由取消静态加密。

## 修订后的完成定义

除主计划完成定义外，还必须满足：

- SQLite、备份、日志和崩溃证据中没有 auth/Signal 明文；
- DEK 由现有 OS secure-storage CredentialVault 单一持有；
- 后端通过现有一次性 hydration 获得版本化 capability；
- envelope 有随机 nonce、GCM tag、AAD 和 key version；
- key index 不保存 raw message/JID；
- retry payload 与 canonical message 一对一且加密；
- key rotation、vault unavailable、corruption、owner replacement 和 Windows cleanup 均 fail closed；
- 独立审查明确覆盖本文修订。
