# Yance OSS-1A 认证材料加密与消息投影修订

> **状态：** 本文是 `2026-08-04-yance-oss-1a-baileys-lifecycle-implementation.md` 的绑定安全修订。凡主计划中出现明文 `creds_json`、`value_json`、`raw_message_json`、无密钥版本的 auth hash 或“旧目录作为长期备份”的条款，均以本文为准。

## 修订原因

OSS-1A 主计划正确要求把 Baileys 认证状态迁入 Yance 唯一主 SQLite Store，但初稿把 credentials、Signal keys 和 Baileys retry message payload 设计为明文 JSON 列。这会产生三个根问题：

1. SQLite 文件泄露即可直接取得 WhatsApp 长期身份和 Signal key material；
2. 在新工作包中另造密钥存储，会与 Yance 已封印的 `CredentialVault` / `CredentialVaultHost` / 一次性 backend hydration 权威冲突；
3. `whatsapp_message_key_index.raw_message_json` 同时保存索引和完整消息内容，使索引成为第二消息权威。

现有 Yance 已具备：

- Electron `safeStorage` 支持的本机用户级加密；
- `CredentialVaultHost` 单一变更权威、崩溃恢复和 journal；
- 一次性 token、PID、manifest、vault epoch 和 authority head 绑定的 backend credential hydration pipe；
- 后端启动时只在内存中接收解密条目的合同。

OSS-1A 必须复用该底座，不得绕过或平行建设第二套 vault。

## 安全决定

### 1. 数据加密密钥只能由现有 CredentialVault 持有

新增凭据引用：

```text
whatsapp-auth-data-key:v1
```

Vault 中的值：

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

- 32 字节密钥使用 `crypto.randomBytes(32)` 生成；
- 只能通过 `CredentialVaultHost` 受权事务创建、读取、轮换或删除；
- 不写入 SQLite、普通文件、环境变量、命令行、日志、测试快照或治理证据；
- 不允许 backend 自行生成一个无法由桌面 vault 持久恢复的长期密钥；
- OS secure storage 不可用、vault 损坏、hydration 缺失或 key version 不支持时，WhatsApp auth 必须 fail closed，账号进入不可发送状态；
- 不得回退到明文存储。

### 2. 后端通过现有一次性 hydration 获得 DEK

启动流程：

```text
CredentialVaultHost
  -> existing credential authority transaction
  -> existing one-time credential frame
  -> backend/bootstrap/credentialHydrationPipe.js
  -> runtime credential capability
  -> WhatsAppAuthCipher
```

新增条目不得改变现有一次性 token、PID、manifest、vault epoch、reference count 和 authority-head 验证。

后端约束：

- DEK 只存在于持有 capability 的 runtime owner 内存；
- repository 不接受 raw key 参数，只接受 `WhatsAppAuthCipher` capability；
- shutdown、owner replacement 和 fatal containment 时尽力 `Buffer.fill(0)`；
- 不能声称 JavaScript 堆内存可被完全锁定或可靠清零；该限制必须写入审计证据；
- 子进程、worker、renderer 和日志接口不得获得 DEK。

### 3. 加密格式使用版本化 AEAD envelope

算法：

```text
AES-256-GCM
nonce: random 12 bytes per encryption
 tag: 16 bytes
keyVersion: integer
ciphertext: bytes
```

每个 envelope 必须包含：

```text
cipher_version
key_version
nonce
ciphertext
auth_tag
ciphertext_sha256
```

`ciphertext_sha256` 只用于存储/传输损坏定位，不替代 GCM tag，也不对明文做无密钥 hash。

AAD 必须绑定不可替换的存储身份：

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

仅使用与该记录适用的字段；字段按冻结顺序编码。把密文复制到另一个账号、epoch、key category 或 message row 时，解密必须失败。

任何 nonce 重用测试失败均阻断；不允许确定性 nonce、时间戳 nonce或基于主键推导 nonce。

## 修订后的 Schema 23 合同

### `whatsapp_auth_accounts`

主计划中的：

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
identity_jid_hash TEXT NOT NULL DEFAULT ''
```

`identity_jid_hash` 必须是使用从 DEK 通过 HKDF 派生的独立索引密钥计算的 HMAC-SHA-256；不得存裸 JID 或普通 SHA-256。

账号 state、epoch、generation、socket token 和时间字段继续明文，以支持条件更新和恢复判定，但不得包含认证内容。

### `whatsapp_auth_keys`

主计划中的：

```text
value_json
value_sha256
```

替换为：

```text
value_present INTEGER NOT NULL CHECK(value_present IN (0,1))
cipher_version INTEGER
key_version INTEGER
nonce BLOB\ nciphertext BLOB
 auth_tag BLOB
ciphertext_sha256 TEXT NOT NULL
```

实现时必须修正上面展示中的排版空格，最终 SQL 精确列名为：

```text
nonce BLOB
ciphertext BLOB
auth_tag BLOB
```

合同：

- `value_present=0` 表示删除 tombstone；cipher envelope 列必须为空；
- `value_present=1` 时 envelope 列全部存在并满足长度约束；
- 同一 `keys.set()` 的 set/delete 在一个短事务中提交；
- 任何一条加密失败，整批不写入。

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

Baileys `getMessage` 需要的 protocol payload 使用独立加密投影表：

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
FOREIGN KEY(canonical_message_id) REFERENCES canonical_messages(id) ON DELETE CASCADE
```

要求：

- 与 canonical message 严格一对一；
- message revoke/delete/retention purge 必须级联删除投影；
- projection 写入与 canonical message 写入同一事务；无法同事务时，必须使用已有持久 repair receipt 且发送/重试读取在 repair 完成前 fail closed；
- `getMessage` 先精确命中 key index，再按 canonical id 读取和解密 projection；
- 解密/AAD/hash/外键任一失败返回结构化 corruption 状态，不返回猜测 payload；
- retry projection 不成为业务消息编辑、显示、搜索或 Outbox 权威。

### `whatsapp_message_retry_counters`

计数值不是长期认证材料，可保持结构化存储，但必须：

- account 隔离；
- TTL；
- 不包含 message body/JID/auth key；
- cache key 若含远端标识，必须使用 HMAC 派生键后再落库。

## 新增实施任务：Task 1A—CredentialVault DEK 权威

Task 1 Schema 23 之后、Task 2 repository 之前执行。

**候选文件：**

- Modify: `electron/credentialVault.js`（只有通用 envelope/验证合同确需扩展时）
- Modify: `electron/desktopHost/CredentialVaultHost.js`
- Modify: `electron/desktopHost/DesktopHost.js`
- Modify: `backend/bootstrap/credentialHydrationPipe.js`
- Create: `backend/security/whatsappAuthCipher.js`
- Create: `backend/tests/oss1aWhatsappAuthCipher.test.js`
- Create: `tests/wp4/oss1a-whatsapp-dek-hydration.test.js`
- Modify: OSS-1A 精确授权文件集

在 Task 0 封印授权前，必须读取实际调用图并把确需修改的 exact paths 写入 authority；上述列表不是通配授权。

### RED 测试

1. Vault 中无 DEK 时，只有 CredentialVaultHost 能原子创建；
2. 两个并发启动只能得到同一个 key version；
3. secure storage 不可用时 fail closed；
4. hydration 缺失、重复、错误 PID、错误 manifest、错误 vault epoch 继续被既有协议拒绝；
5. DEK 不出现在 SQLite、环境、argv、日志和错误对象；
6. 每次加密 nonce 唯一；
7. ciphertext/AAD/tag 任一位变化解密失败；
8. 把账号 A 密文复制给 B 解密失败；
9. 把 epoch N 密文复制到 N+1 解密失败；
10. unsupported key version fail closed；
11. owner replacement 后旧 cipher capability 不能继续加密/解密；
12. shutdown/fatal containment 调用内存清理路径；
13. 轮换中崩溃后旧/新 key version 均有确定恢复状态，不出现半轮换明文回退。

### 实现合同

`WhatsAppAuthCipher` 最小接口：

```js
encrypt(recordType, aadIdentity, plaintextBuffer)
decrypt(recordType, aadIdentity, envelope)
hmacIndex(purpose, value)
close()
```

- `recordType` 枚举冻结；
- `aadIdentity` 由 typed builder 生成，不接受任意拼接字符串；
- `close()` 后所有操作抛 `WHATSAPP_AUTH_CIPHER_CLOSED`；
- 错误不含明文、密钥、nonce+ciphertext 全量或原始 JID；
- HKDF 分离 encryption/index/log-redaction purposes；
- 不缓存解密后的完整 auth dataset，只按 Baileys 请求读取必要记录。

## 对既有 Tasks 的强制修改

### Task 0

精确授权必须加入真正需要的 Vault、hydration、cipher 和测试路径。不能在实现过程中再以“安全修复”为理由自扩文件集。

### Task 1

Schema 测试必须断言：

- 不存在 `creds_json`、`value_json`、`raw_message_json`；
- envelope 列和 CHECK 完整；
- key index 不含可逆远端标识；
- retry payload 与 canonical message 一对一 FK/CASCADE；
- schema dump 和备份中无明文 fixture secret。

### Task 2

repository 接口接收 cipher capability，不接受 raw DEK。事务顺序：

1. generation/epoch/socket token 条件验证；
2. 事务外完成最小必要加密；
3. 开启短事务；
4. 再次条件验证；
5. 写入 envelope；
6. commit；
7. 失败时释放 plaintext Buffer 引用并返回结构化错误。

不得在持有 SQLite 写锁时调用 Electron/IPC/safeStorage。

### Task 3

Baileys `AuthenticationState` adapter 解密后只把所需 creds/keys 返回给当前 socket generation。旧 socket、关闭 store、quarantine 或 key-version mismatch 均为零明文返回。

### Task 4

旧目录导入流程必须：

- 在内存解析旧文件；
- 立即加密后写入 SQLite；
- 不把旧目录永久保留为“加密备份”；
- 成功 receipt 后安全删除或进入有期限、权限 0600、不可被自动恢复读取的隔离销毁队列；
- Windows 删除/锁失败时持续显示 cleanup-required，且文件永不重新成为 auth 权威；
- crash evidence 不得复制旧 auth 文件内容。

### Task 8

`getMessage` 读取 key index + encrypted retry projection；不从 index 直接取完整 raw message。投影一致性、retention 和 revoke fault matrix 必须加入测试。

### Task 10

新增故障点：

- DEK 创建 transaction 各阶段；
- hydration 后、cipher capability 建立前；
- encrypt 后、SQLite commit 前；
- key rotation 每个阶段；
- canonical message commit 与 retry projection commit 边界；
- OS safeStorage 暂时不可用；
-旧 key version 在新版本启用后的读取；
- ciphertext/tag/AAD corruption。

## 明确禁止

- SQLite 明文 creds、Signal keys 或 Baileys raw retry payload；
- 用数据库文件权限代替加密；
- 用普通 SHA-256 隐藏 JID/message id；
- 把 DEK 写入 `.env`、配置 JSON、SQLite、命令行或日志；
- backend 绕开 CredentialVaultHost 自建长期 master key；
- 每次启动生成新 key 导致旧认证不可恢复；
- 在 SQLite 写事务内调用 safeStorage/IPC；
- 密钥轮换期间永久双写明文/密文；
- 把旧认证目录作为长期恢复权威或无限期备份；
- 以“本地桌面应用”为理由取消静态加密。

## 修订后的完成定义

除主计划完成定义外，还必须满足：

- SQLite、备份、日志、崩溃证据中没有 auth/Signal 明文；
- DEK 由现有 OS secure-storage CredentialVault 单一持有；
- 后端通过现有一次性 hydration 获得版本化 capability；
- cipher envelope 有随机 nonce、GCM tag、AAD 和 key version；
- key index 不保存 raw message/JID；
- retry payload 与 canonical message 一对一且加密；
- key rotation、vault unavailable、corruption、owner replacement 和 Windows cleanup 均 fail closed；
- 独立审查明确覆盖本文修订。
