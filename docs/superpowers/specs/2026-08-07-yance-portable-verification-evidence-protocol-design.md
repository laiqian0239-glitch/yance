# Yance 可移植验证证据协议设计

- 文档类型：`NORMATIVE_DESIGN_SPEC`
- 设计编号：`YANCE-PVEP-001`
- 日期：2026-08-07
- 仓库：`laiqian0239-glitch/yance`
- 设计基线：`main@9290b7e1c4995fa2c7f909911a84ac56e1176109`
- 设计分支：`design/portable-verification-evidence-protocol-2026-08-07`
- 状态：`APPROVED_FOR_IMPLEMENTATION_PLANNING`
- 用户批准：`2026-08-07`
- 实施计划：`docs/superpowers/plans/2026-08-07-yance-portable-verification-evidence-protocol.md`
- 生产代码修改授权：`false`
- PR #67 修改授权：`false`
- OSS-A 合并授权：`false`
- WP-B 启动授权：`false`

## 1. 目的

Yance 当前部分治理门禁把 GitHub Actions workflow run ID 作为最终候选证据的唯一可接受标识。GitHub-hosted runner 不可用时，即使精确 Head、测试命令、Linux/Windows 验证和独立审查能够在受控环境执行，治理层仍无法消费这些事实。

本设计从底层消除该单点依赖：建立 **Portable Verification Evidence Protocol（PVEP）**。治理策略验证统一、可加密校验、绑定精确 Git 身份的 canonical evidence receipt；GitHub Actions、受控 Linux 执行器、真实 Windows 执行器只是可信证据生产适配器，而不是事实权威本身。

本设计不降低任何现有门禁。没有可信证据时仍然 fail-closed。

## 2. 非目标与硬边界

PVEP 第一阶段明确不做以下事情：

1. 不修改、重写、强推或合并 PR #67。
2. 不把当前 PR #67 的 queued/failed GitHub Actions 追溯解释为 GREEN。
3. 不伪造 GitHub workflow run ID，也不把本地执行结果伪装成 GitHub Actions 结果。
4. 不修改现有 OSS-A final-candidate seal 以绕过其当前授权合同。
5. 不授权生产使用、正式发布、publish、promotion 或 WP-B。
6. 不引入任意 shell 远程执行平台。
7. 不存储执行器私钥、GitHub token、产品凭据或业务秘密。
8. 不把 receipt 变成新的产品/业务事实权威。
9. 不允许“人工声明已测试”代替机器可验证证据。

若未来要让 OSS-A final-candidate policy 消费 PVEP，必须在 PVEP 自身完成独立审查并合并到 trusted main 后，通过独立治理授权和独立 PR 修改 OSS-A policy；该迁移不能由本工作包自动发生。

## 3. 现有架构契合点

现有 `shared/release/openSourceSourceMergeAuthorizationPolicy.js` 已把外部事实隔离为 `graph` 与 `evidence` 适配器：策略层不直接执行 GitHub API，而调用 `verifyWorkflowRun`、`verifyStructuredReview`、`verifyFinalCandidateRuns` 和 `verifyFinalCandidateReview` 等接口。

因此 PVEP 不重写 source-merge authority，也不建立平行权威。它只把 evidence adapter 的输入从 GitHub 专属事实提升为统一 verification receipt，然后由策略层消费归一化结果。

原则：

```text
product authority != verification authority != evidence transport
```

- 产品权威仍由 Yance 既有业务、数据、发送和设置权威承担。
- verification policy 只判断某个精确代码身份是否完成规定验证。
- GitHub API、签名文件、artifact ZIP、日志文件只是证据传输载体。

## 4. 总体架构

```text
Exact Git base + Exact Git head
          |
          v
   Command Set Registry
          |
          v
  Trusted Evidence Producer
  /                    \
GitHub Actions      Signed Executor
                         |
               Linux / Windows host
          \              /
           v            v
       Canonical Evidence Receipt
                  |
        digest + authenticity verify
                  |
           Normalized Gate Fact
                  |
          Existing governance policy
```

核心规则：**执行环境产生证据，适配器证明证据来源，策略只消费归一化事实。**

## 5. 组件边界

### 5.1 `canonicalEvidenceReceipt`

建议模块：

`shared/verification/canonicalEvidenceReceipt.js`

职责仅限：

- receipt schema 验证；
- canonical payload 构造；
- RFC 8785 JSON Canonicalization Scheme（JCS）字节生成；
- SHA-256 payload/receipt digest；
- path、SHA、时间戳、平台枚举、命令结果等基本合法性检查；
- 返回稳定 reason code。

该模块不得访问网络、GitHub、私钥或执行命令。

### 5.2 `trustedEvidencePolicy`

建议模块：

`shared/verification/trustedEvidencePolicy.js`

职责：

- 根据 `adapterType` 选择已注册 verifier；
- 验证 receipt 真实性；
- 验证执行器授权、平台、command set 和 key generation；
- 归一化为 gate fact；
- 组合 Linux/Windows/多 gate 证据；
- fail-closed。

它不得把任一 adapter 的“自述 success”直接视为可信。

### 5.3 Trusted Executor Registry

建议路径：

`governance/verification/trusted-executors.json`

仅保存公开信息：

```json
{
  "schemaVersion": 1,
  "executors": [
    {
      "executorId": "example-windows-01",
      "platform": "windows",
      "keyAlgorithm": "Ed25519",
      "publicKeyPem": "...",
      "keyGeneration": 1,
      "status": "ACTIVE",
      "allowedCommandSetDigests": ["..."]
    }
  ]
}
```

禁止保存私钥。registry 变更本身必须走独立治理 PR 和独立审查。

### 5.4 Command Set Registry

建议路径：

`governance/verification/command-sets/*.json`

每个 command set 必须是预定义 argv 数组，不接受拼接 shell 字符串：

```json
{
  "schemaVersion": 1,
  "commandSetId": "oss-a-linux-final-v1",
  "platform": "linux",
  "commands": [
    {
      "commandId": "supply-chain-tests",
      "argv": ["node", "--test", "--test-concurrency=1", "tests/supply-chain/*.test.js"]
    }
  ]
}
```

实现必须对 command set 自身执行 JCS 后计算 `commandSetDigest = SHA-256(JCS(commandSet))`。receipt 必须绑定该 digest；执行器不得临时删减、替换、重排或追加命令。

如果某命令需要 glob 展开，必须由仓库内确定性 helper 解释显式规则，不能通过 shell expansion 获得不同平台的隐式语义。

### 5.5 `run-command-set`

建议工具：

`tools/verification/run-command-set.js`

职责：

1. 验证 repo identity 与精确 base/head；
2. 验证 clean checkout/workspace policy；
3. 加载已登记 command set；
4. 逐条使用 argv 直接 spawn，不通过 shell；
5. 记录开始/结束、退出码、stdout/stderr digest；
6. 对声明 artifact 计算 digest；
7. 重新检查工作区后置状态；
8. 生成 unsigned canonical payload；
9. 交给可信 adapter 产生 authenticity 数据。

运行器不得接受诸如 `--command "..."` 的任意命令输入。

### 5.6 `verify-receipt`

建议工具：

`tools/verification/verify-receipt.js`

必须能完全离线验证 `signed-executor-v1` receipt。GitHub API 事实获取应通过单独 verifier/integration 层注入，不能让核心 schema verifier 隐式联网。

## 6. Canonical Receipt Schema

第一版 receipt 顶层字段固定为：

```text
schemaVersion
recordType
repository
workPackage
gateId
baseCommit
headCommit
adapterType
producer
commandSet
execution
workspace
results
artifacts
canonicalPayloadSha256
authenticity
receiptSha256
```

未知顶层字段默认拒绝，防止不同实现对未识别字段采取不同语义。

### 6.1 Identity

```text
schemaVersion = 1
recordType = YANCE_PORTABLE_VERIFICATION_EVIDENCE_RECEIPT
repository = laiqian0239-glitch/yance
baseCommit = 40 lowercase hex
headCommit = 40 lowercase hex
```

base/head 必须来自执行前已经解析的精确 commit，不接受 branch 名代替 SHA。

### 6.2 Producer

`adapterType` 第一版只允许：

- `github-actions-v1`
- `signed-executor-v1`

`signed-executor-v1` producer：

```text
executorId
platform = linux | windows
architecture
nodeVersion
npmVersion
keyGeneration
```

`github-actions-v1` producer：

```text
workflowRepository
workflowId
runId
runAttempt
jobIds[]
runnerEnvironment
```

### 6.3 Execution

必须记录：

```text
startedAt
completedAt
commandSetId
commandSetDigest
commands[]
```

每条命令结果：

```text
commandId
argvDigest
exitCode
startedAt
completedAt
stdoutSha256
stderrSha256
```

策略判断成功只依据预定义命令结果和规范；日志摘要用于防篡改和审计，不允许用日志文本中出现 `PASS` 代替退出码。

### 6.4 Workspace

默认执行环境必须从 exact `headCommit` 创建新的 clean checkout。command set 可以声明生成目录（例如依赖安装目录或 artifact 输出目录），但这些目录必须显式列出，不能用任意 ignore pattern 扩大范围。

receipt 至少绑定：

```text
preHead
postHead
preTrackedDiffSha256
postTrackedDiffSha256
preUnexpectedUntrackedPathSetSha256
postUnexpectedUntrackedPathSetSha256
allowedGeneratedRootSetSha256
```

规则：

- `preHead == postHead == headCommit`；
- tracked diff 前后均必须为空；
- 除 command set 明确允许的 generated roots 外，不得存在 unexpected untracked path；
- generated roots 不能覆盖仓库受控源码路径；
- artifact 必须位于明确声明的输出路径并单独摘要。

### 6.5 Results 与 Artifacts

`results` 必须显式列出每个 command 的 success/failure 事实，且可以由 exit code 重算；不允许只保存聚合 `success: true`。

每个 artifact：

```text
artifactId
relativePath
sha256
sizeBytes
mediaType
producerCommandId
```

禁止绝对路径、`..`、反斜杠混淆和 NUL/control 字符。

## 7. Canonicalization、摘要与签名

### 7.1 Canonicalization

所有安全相关 JSON canonical bytes 必须遵循 RFC 8785 JCS。实现方式可以是经过审计的成熟实现或仓库内实现，但以下条件是规范性的：

- 必须通过固定 conformance vectors；
- 不得依赖普通 `JSON.stringify` 的偶然属性插入顺序；
- 不允许 NaN、Infinity、`undefined` 或非 JSON 类型；
- schema 中需要整数的字段只能使用 JavaScript safe integer；
- 时间统一为 RFC3339 UTC 字符串。

### 7.2 Payload Digest

构造：

```text
canonicalPayload = receipt minus canonicalPayloadSha256 minus authenticity minus receiptSha256
canonicalPayloadBytes = JCS(canonicalPayload)
canonicalPayloadSha256 = lowercase_hex(SHA-256(canonicalPayloadBytes))
```

### 7.3 Authenticity

`signed-executor-v1` 使用 Ed25519。签名对象是 `canonicalPayloadBytes` 原始 UTF-8 bytes，不是其十六进制摘要字符串。

`authenticity` 至少：

```text
scheme = ed25519
executorId
keyGeneration
signatureBase64
```

`github-actions-v1` 的 `authenticity` 保存用于 API 重新绑定的 run/job/workflow identity；这些字段本身不等于信任，verifier 必须重新查询 GitHub API。

### 7.4 Receipt Digest

真实性字段产生后，构造：

```text
receiptBody = receipt minus receiptSha256
receiptSha256 = lowercase_hex(SHA-256(JCS(receiptBody)))
```

因此：

- `canonicalPayloadSha256` 标识被签名/被 API 绑定的执行事实；
- `receiptSha256` 标识包含 authenticity 在内的完整持久 receipt。

Normalized Gate Fact 使用 `receiptSha256` 作为证据对象身份。

## 8. Signed Executor 的私钥与进程隔离

只写“外部签名步骤”不足以建立信任。第一版必须满足以下硬规则：

1. Ed25519 私钥不得存在仓库、工作树、环境变量、命令参数、stdout/stderr 或 artifact 中。
2. 被测仓库代码及其子进程不得拥有读取私钥的 OS 权限。
3. 签名器与被测命令必须处于权限隔离边界：独立 OS account、受限 service、硬件/OS keystore 或等价隔离机制。
4. runner 负责执行和构造 canonical payload；signer 只接受来自受信 runner 通道的 payload，不向被测子进程暴露通用 signing endpoint。
5. signer 不根据 payload 中的 `success` 字段决定真伪；签名只证明“该受信执行器产生了这份事实”。真正的 GREEN 仍由 verifier 根据 command results、workspace 和 policy 重算。
6. 如果无法证明私钥对被测进程不可访问，该 executor 不得登记为 `ACTIVE`。

该边界防止被测代码直接窃取执行器私钥并自行伪造 GREEN receipt。

## 9. GitHub Actions Adapter

GitHub receipt 不由 workflow 自己声明 API 真实性。verifier 必须从 GitHub API 重新核验至少：

- repository；
- workflow/run/job identity；
- exact head SHA；
- run attempt；
- conclusion；
- workflow path/identity；
- 所需 job 集合；
- artifact identity，并在 gate 要求时下载后重算 digest。

workflow 中打印的 JSON 只能作为候选 payload，不能替代 API 事实。

如果 GitHub API 无法访问、返回不完整事实或 identity 不一致，GitHub adapter 必须失败；这不影响 signed-executor adapter 独立验证其自身 receipt。

## 10. Normalized Gate Fact

无论来源为何，验证通过后只能向治理策略暴露受限事实：

```text
repository
workPackage
gateId
baseCommit
headCommit
platform
commandSetId
commandSetDigest
verificationStatus = VERIFIED_PASS
adapterType
receiptSha256
producerIdentity
```

adapter 特有字段不得泄漏进上层通用策略条件。例如上层不得再要求“必须有 GitHub runId”，除非某个治理合同明确要验证 GitHub 平台本身。

同一 gate/head/command set 的 GitHub 与 signed executor 通过验证后，应得到除 `adapterType`、`receiptSha256` 和 `producerIdentity` 外语义等价的 policy fact。

## 11. 多平台与多 Gate 聚合

聚合器必须根据治理 policy 明确列出 requirement set：

```text
required:
  - gateId: supply-chain-linux
    platform: linux
    commandSetDigest: ...
  - gateId: production-windows
    platform: windows
    commandSetDigest: ...
```

GREEN 条件是所有 requirement 都存在 exact base/head 一致的 `VERIFIED_PASS`。

禁止：

- Linux receipt 填 `platform=windows`；
- 一个 receipt 同时满足两个不同 command set；
- 不同 Head 的 receipt 拼装；
- 用较早 Head 的 GREEN 自动继承给新 Head；
- 同一 receipt 重复计数；
- 当两个可信 adapter 对同一 exact gate/head/command set 得出矛盾结论时选择“更绿”的一个。

发生可信来源矛盾时必须返回明确 conflict reason code 并 fail-closed，直到根因被诊断和重新执行。

## 12. 信任生命周期与撤销

Trusted executor registry 必须支持：

```text
ACTIVE
REVOKED
```

以及：

```text
keyGeneration
validFrom
revokedAt (only when revoked)
revocationReasonCode
```

规则：

1. 新 key 必须提高 generation，不允许覆盖旧 key 后保持相同 generation。
2. receipt 时间可用于审计，但不能单独证明“签名发生在撤销前”，因为受控主机时钟也可能失真。
3. `REVOKED` executor 的 receipt 不得用于新的 merge/release/promotion 授权，即使 receipt 自报时间早于 `revokedAt`。
4. 历史 receipt 可以保留作审计事实，但默认不自动成为新的授权证据。
5. 如果未来确需在撤销后继续信任历史 receipt，必须另行引入可信外部时间锚或 transparency log；PVEP v1 不提供该能力。

## 13. Failure-Closed Reason Codes

至少定义：

```text
EVIDENCE_SCHEMA_INVALID
EVIDENCE_REPOSITORY_MISMATCH
EVIDENCE_BASE_MISMATCH
EVIDENCE_HEAD_MISMATCH
EVIDENCE_CANONICAL_DIGEST_MISMATCH
EVIDENCE_RECEIPT_DIGEST_MISMATCH
EVIDENCE_ADAPTER_UNTRUSTED
EVIDENCE_EXECUTOR_UNKNOWN
EVIDENCE_EXECUTOR_REVOKED
EVIDENCE_KEY_GENERATION_INVALID
EVIDENCE_SIGNATURE_INVALID
EVIDENCE_SIGNER_ISOLATION_INVALID
EVIDENCE_PLATFORM_MISMATCH
EVIDENCE_COMMAND_SET_UNKNOWN
EVIDENCE_COMMAND_SET_DIGEST_MISMATCH
EVIDENCE_COMMAND_MISSING
EVIDENCE_COMMAND_UNEXPECTED
EVIDENCE_COMMAND_FAILED
EVIDENCE_WORKSPACE_DIRTY
EVIDENCE_ARTIFACT_DIGEST_MISMATCH
EVIDENCE_GITHUB_API_IDENTITY_INVALID
EVIDENCE_REQUIREMENT_SET_INCOMPLETE
EVIDENCE_MIXED_HEADS
EVIDENCE_TRUSTED_SOURCE_CONFLICT
```

不得返回模糊的 `UNKNOWN_ERROR` 作为正常政策判断结果。

## 14. 安全模型

PVEP 要抵抗以下攻击与事故：

### 14.1 Receipt 篡改

任何字段、命令、日志摘要、artifact 摘要、Head 或 platform 被修改都会改变 canonical digest，并使签名/API identity 或 receipt digest 验证失败。

### 14.2 任意命令注入

command set 使用预定义 argv；runner 不经 shell；CLI 不接受任意 command string。

### 14.3 执行器冒充

executor identity 由 registry public key + generation 绑定。只知道 `executorId` 不足以产生有效 receipt。

### 14.4 被测代码窃取签名权

签名私钥与被测进程做 OS 权限隔离；被测代码不能获得私钥或调用通用签名接口。

### 14.5 平台冒充

executor registry 固定 platform，receipt platform 必须同时匹配 registry 和 command set。

### 14.6 旧证据重放

所有 receipt 绑定 exact base/head、command set digest、key generation。新 Head 不能复用旧 Head GREEN。

### 14.7 工作区污染

gate 从 clean checkout 开始；pre/post tracked diff 和 unexpected untracked path 纳入验证。合法输出只能进入 command set 声明的 generated/artifact 路径。

### 14.8 Adapter 自认证

GitHub workflow 不能自己证明 GitHub run conclusion；signed executor 不能只附 public key。真实性必须由独立 verifier 根据受信 registry/API 核验。

## 15. 测试设计：失败测试先行

实现必须按以下因果顺序进行；RED commit 先于实现 commit。

### 15.1 Core Receipt RED

测试必须先证明当前代码无法：

- 拒绝篡改 canonical payload；
- 拒绝 receipt digest 漂移；
- 拒绝无签名 signed-executor receipt；
- 拒绝错误 base/head；
- 拒绝未知字段、非法 path 和非法数字；
- 拒绝 command set drift。

### 15.2 Signed Executor RED

覆盖：

- 未知 executor；
- 错 public key；
- 错 generation；
- revoked executor；
- Linux 冒充 Windows；
- signature byte 被修改；
- command/result/artifact 被签后篡改；
- signer isolation 未满足时拒绝登记或验证。

### 15.3 GitHub Adapter RED

覆盖：

- receipt 自称 success 但 API conclusion 非 success；
- run 对应错误 Head；
- workflow identity 错误；
- job 集合缺失；
- artifact digest 漂移；
- GitHub API 无法证明 identity。

### 15.4 Aggregation RED

覆盖：

- requirement 缺一个 gate；
- Linux/Windows 混淆；
- 混合两个 Head；
- command set digest 不同；
- 同一 receipt 重复计数；
- 两个可信来源对同一 gate 结论冲突。

### 15.5 GREEN

实现后至少证明：

1. 合法 `signed-executor-v1` Linux receipt GREEN；
2. 合法 `signed-executor-v1` Windows receipt GREEN；
3. 合法 `github-actions-v1` receipt GREEN；
4. GitHub 与 signed executor 在相同 gate/head/command set 上归一为等价 policy fact；
5. 完整 Linux + Windows requirement set GREEN；
6. 所有篡改与冲突测试持续 fail-closed，并返回明确 reason code。

## 16. 实施路径约束

正式实施计划应把工作拆为小批次：

1. RFC 8785 canonicalization contract + fixed vectors；
2. canonical receipt schema + payload/receipt digests；
3. command-set registry；
4. signed-executor registry/verifier；
5. signer privilege-isolation contract；
6. safe command-set runner；
7. GitHub adapter；
8. requirement aggregation；
9. CLI verification tooling；
10. threat/adversarial tests + documentation；
11. independent code review；
12. exact-Head verification。

每批必须：

- 失败测试先行；
- 只修根因，不添加绕过开关；
- 不允许 `--skip-verification`、`ALLOW_UNTRUSTED_EVIDENCE`、fallback success 等逃生口；
- 不强推、不改写历史；
- 保留 exact-Head 证据；
- 新依赖如非必要不得增加；若 canonicalization 采用第三方实现，必须先核验精确版本、许可证、来源与固定测试向量。

## 17. OSS-A 迁移规则

PVEP 成熟不等于自动改变 OSS-A 的现有授权合同。

迁移必须满足：

1. PVEP 实现分支独立 PR 完成 GREEN 和独立审查；
2. PVEP 合并到 trusted main；
3. 新建独立 OSS-A governance authorization，明确允许 source-merge policy 从 GitHub-run-only 迁移到 PVEP requirement set；
4. 失败测试先证明旧 policy 无法接受 PVEP；
5. policy migration 只改变证据验证方式，不降低原 gate 集合、平台要求、精确 SHA、review、path seal 或用户最终批准要求；
6. migration PR 独立审查并合并；
7. 对 PR #67 的最终 Head 重新产生 **新的** PVEP receipt；不得把迁移前本地执行记录追溯转换成授权证据；
8. 再按新 policy 创建 final-candidate seal；
9. 仍必须获得用户明确 source-merge approval。

因此 PVEP 解决的是验证基础设施单点依赖，不是对当前 outage 的临时豁免。

## 18. 与 GitHub Actions 的长期关系

GitHub Actions 保留为首选自动化适配器之一：

- 可用时持续自动跑；
- outage 时不再是唯一证据生产路径；
- GitHub 结果和 signed executor 结果使用同一 command-set contract；
- 若两种可信来源对同一 exact Head 产生矛盾结果，默认 fail-closed，并要求诊断根因；不得选择“更绿”的一个。

## 19. 验收标准

PVEP 第一阶段完成必须同时满足：

- canonicalization 符合 RFC 8785 且有固定 vectors；
- payload digest 与完整 receipt digest 均有确定算法；
- Ed25519 signed executor 有完整正/负测试；
- 私钥与被测仓库进程存在可验证的权限隔离；
- GitHub adapter 不能信任 workflow 自述结果；
- runner 不允许 shell 注入或任意命令；
- Linux/Windows 平台不可互换；
- exact base/head 不可漂移；
- command set 不可漂移；
- tracked source 与 unexpected untracked source 污染 fail-closed；
- artifacts 可摘要复验；
- executor 可撤销并有 generation；
- revoked executor 不得为新授权提供历史 receipt；
- requirement aggregation fail-closed；
- 可信来源冲突 fail-closed；
- normalized policy fact 不要求 GitHub run ID；
- 不修改 PR #67；
- 不修改 OSS-A 当前 final seal 合同；
- 不自动授权任何 merge/release/promotion/WP-B。

## 20. 设计结论

Yance 的正确依赖关系应为：

```text
GitHub Actions / Linux executor / Windows executor
                   |
                   v
       cryptographically verifiable receipt
                   |
                   v
          normalized verification fact
                   |
                   v
              governance policy
```

而不是：

```text
GitHub Actions available ? project can proceed : project stops
```

PVEP 把 GitHub Actions 从“唯一验证权威”降为“可信证据适配器之一”，同时保持 exact-SHA、跨平台验证、独立审查和显式用户批准的全部治理强度。任何证据缺失、身份漂移、签名隔离不足、来源冲突或验证失败都必须 fail-closed。