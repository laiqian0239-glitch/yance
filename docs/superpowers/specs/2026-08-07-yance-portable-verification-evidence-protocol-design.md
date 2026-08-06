# Yance 可移植验证证据协议设计

- 文档类型：`NORMATIVE_DESIGN_SPEC`
- 设计编号：`YANCE-PVEP-001`
- 日期：2026-08-07
- 仓库：`laiqian0239-glitch/yance`
- 设计基线：`main@9290b7e1c4995fa2c7f909911a84ac56e1176109`
- 设计分支：`design/portable-verification-evidence-protocol-2026-08-07`
- 状态：`PROPOSED_FOR_WRITTEN_SPEC_REVIEW`
- 生产代码修改授权：`false`
- PR #67 修改授权：`false`
- OSS-A 合并授权：`false`
- WP-B 启动授权：`false`

## 1. 目的

Yance 当前部分治理门禁把 GitHub Actions workflow run ID 作为最终候选证据的唯一可接受标识。GitHub-hosted runner 不可用时，即使精确 Head、测试命令、Linux/Windows 验证和独立审查都能够在受控环境执行，治理层仍无法消费这些事实。

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

若未来要让 OSS-A final-candidate policy 消费 PVEP，必须在 PVEP 自身完成独立审查和主分支合并后，通过独立治理授权和独立 PR 修改 OSS-A policy；该迁移不能由本工作包自动发生。

## 3. 现有架构契合点

现有 `shared/release/openSourceSourceMergeAuthorizationPolicy.js` 已把外部事实隔离为 `graph` 与 `evidence` 适配器：策略层不直接执行 GitHub API，而调用 `verifyWorkflowRun`、`verifyStructuredReview`、`verifyFinalCandidateRuns` 和 `verifyFinalCandidateReview` 等接口。

因此 PVEP 不重写 source-merge authority，也不建立平行权威。它只把 evidence adapter 的输入从 GitHub 专属事实提升为统一 verification receipt，然后由策略层消费归一化结果。

原则：

```text
product authority != verification authority != evidence transport
```

- 产品权威仍由 Yance 既有业务/数据/发送/设置权威承担。
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
          Canonicalization + SHA-256
                  |
      Adapter authenticity verification
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
- 确定性序列化；
- SHA-256 receipt digest；
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

### 5.3 `trusted-executors.json`

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

禁止保存私钥。撤销通过状态或 generation 前进完成；旧 generation receipt 在撤销生效点之后不得继续接受。

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

规范化 command set 后计算 `commandSetDigest = SHA-256(...)`。receipt 必须绑定该 digest；执行器不得临时删减、替换或追加命令。

### 5.5 `run-command-set`

建议工具：

`tools/verification/run-command-set.js`

职责：

1. 验证 repo identity 与精确 base/head；
2. 验证工作树前置状态；
3. 加载已登记 command set；
4. 逐条使用 argv 直接 spawn，不通过 shell；
5. 记录开始/结束、退出码、stdout/stderr digest；
6. 对声明 artifact 计算 digest；
7. 重新检查工作树后置状态；
8. 生成 unsigned canonical payload；
9. 由外部受控签名步骤签名，或交给 GitHub adapter 绑定 API identity。

运行器不得接受诸如 `--command "..."` 的任意命令输入。

### 5.6 `verify-receipt`

建议工具：

`tools/verification/verify-receipt.js`

必须能完全离线验证 signed-executor receipt；GitHub adapter 的 API 事实获取应通过单独 verifier/integration 层注入，不能让核心 schema verifier 隐式联网。

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
```

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

策略判断成功只依据预定义命令结果和规范；日志摘要用于防篡改和审计，不允许用日志文本中出现 “PASS” 代替退出码。

### 6.4 Workspace

至少绑定：

```text
preHead
postHead
preTrackedDiffSha256
postTrackedDiffSha256
preUntrackedPathSetSha256
postUntrackedPathSetSha256
sourceTreeSha256
```

默认 gate 要求执行前后 tracked diff 为空，且 pre/post Head 等于 receipt `headCommit`。若某 command set 合法地产生受控 artifact，artifact 必须写入 command set 明确声明的输出目录，不能通过修改 tracked source 实现。

### 6.5 Artifacts

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

## 7. Canonicalization 与签名

### 7.1 签名输入

`authenticity` 和 `canonicalPayloadSha256` 不参与自身 hash。先从 receipt 构造 `canonicalPayload`：

```text
receipt minus canonicalPayloadSha256 minus authenticity
```

对 canonical payload 使用确定性 JSON 序列化：

- UTF-8；
- 对象 key 按 Unicode code point 升序；
- 数组保持顺序；
- 不允许 `undefined`、NaN、Infinity、重复语义字段或非 JSON 类型；
- 数字只允许 schema 明确定义的安全整数；时间统一 RFC3339 UTC 字符串；
- 末尾不额外附加换行作为 payload 的语义内容。

第一版实现必须带 canonicalization conformance tests 和固定 vectors，禁止依赖普通 `JSON.stringify` 的偶然属性顺序作为安全合同。

`canonicalPayloadSha256`：

```text
lowercase_hex(SHA-256(canonical_utf8_bytes))
```

### 7.2 Signed Executor

签名算法固定 `Ed25519`，使用 Node `crypto` 原生能力。

`authenticity` 至少：

```text
scheme = ed25519
executorId
keyGeneration
signatureBase64
```

签名对象是 canonical payload 原始 UTF-8 bytes，不签其十六进制文本。

验证顺序：先 schema/canonical digest，再 registry identity/generation，再 Ed25519 signature，再策略约束。

### 7.3 GitHub Actions Adapter

GitHub receipt 不由 workflow 自己声明 API 真实性。verifier 必须从 GitHub API重新核验至少：

- repository；
- workflow/run/job identity；
- exact head SHA；
- run attempt；
- conclusion；
- workflow path/identity；
- 所需 job 集合；
- artifact identity/digest（若 gate 要求）。

workflow 中打印的 JSON 只能作为候选 payload，不能替代 API 事实。

## 8. Normalized Gate Fact

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

adapter 特有字段不得泄漏进上层策略条件。例如上层不得再要求“必须有 GitHub runId”，除非某个治理合同明确要验证 GitHub 自身。

## 9. 多平台与多 Gate 聚合

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

GREEN 条件是所有 requirement 都存在精确 base/head 一致的 `VERIFIED_PASS`。

禁止：

- Linux receipt 填 `platform=windows`；
- 一个 receipt 同时满足两个不同 command set；
- 不同 Head 的 receipt 拼装；
- 用较早 Head 的 GREEN 自动继承给新 Head；
- 用一个 adapter 的失败由另一个 adapter 的“声明成功”覆盖。

## 10. 信任生命周期与撤销

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
2. receipt 的执行完成时间必须落在该 generation 的有效期。
3. 撤销后生成的旧 key receipt 一律失败。
4. 历史 receipt 是否继续有效，由治理 policy 明确规定；默认只用于审计，不自动成为新合并授权。
5. registry 变更本身必须走独立治理 PR 和审查。

## 11. Failure-Closed Reason Codes

至少定义：

```text
EVIDENCE_SCHEMA_INVALID
EVIDENCE_REPOSITORY_MISMATCH
EVIDENCE_BASE_MISMATCH
EVIDENCE_HEAD_MISMATCH
EVIDENCE_CANONICAL_DIGEST_MISMATCH
EVIDENCE_ADAPTER_UNTRUSTED
EVIDENCE_EXECUTOR_UNKNOWN
EVIDENCE_EXECUTOR_REVOKED
EVIDENCE_KEY_GENERATION_INVALID
EVIDENCE_SIGNATURE_INVALID
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
```

不得返回模糊的 `UNKNOWN_ERROR` 作为正常政策判断结果。

## 12. 安全模型

PVEP 要抵抗以下攻击/事故：

### 12.1 Receipt 篡改

任何字段、命令、日志摘要、artifact 摘要、Head 或 platform 被修改都会改变 canonical digest，并使签名/API identity 验证失败。

### 12.2 任意命令注入

command set 使用预定义 argv；runner 不经 shell；CLI 不接受任意 command string。

### 12.3 执行器冒充

executor identity 由 registry public key + generation 绑定。只知道 `executorId` 不足以产生有效 receipt。

### 12.4 平台冒充

executor registry 固定 platform，receipt platform 必须同时匹配 registry 和 command set。

### 12.5 旧证据重放

所有 receipt 绑定 exact base/head、command set digest、key generation。新 Head 不能复用旧 Head GREEN。

### 12.6 工作区污染

pre/post workspace identity 纳入 receipt；默认 tracked source 必须干净。合法输出只能进入 command set 声明的 artifact 路径。

### 12.7 Adapter 自认证

GitHub workflow 不能自己证明 GitHub run conclusion；signed executor 不能只附 public key。真实性必须由独立 verifier 根据受信 registry/API核验。

## 13. 测试设计：失败测试先行

实现必须按以下因果顺序进行；RED commit 先于实现 commit。

### 13.1 Core Receipt RED

测试必须先证明当前代码无法：

- 拒绝篡改 canonical payload；
- 拒绝无签名 signed-executor receipt；
- 拒绝错误 base/head；
- 拒绝重复/异常字段或非法 path；
- 拒绝 command set drift。

### 13.2 Signed Executor RED

覆盖：

- 未知 executor；
- 错 public key；
- 错 generation；
- revoked executor；
- Linux 冒充 Windows；
- signature byte 被修改；
- command/result/artifact 被签后篡改。

### 13.3 GitHub Adapter RED

覆盖：

- receipt 自称 success 但 API conclusion 非 success；
- run 对应错误 Head；
- workflow identity 错误；
- job 集合缺失；
- artifact digest 漂移。

### 13.4 Aggregation RED

覆盖：

- requirement 缺一个 gate；
- Linux/Windows 混淆；
- 混合两个 Head；
- command set digest 不同；
- 同一 receipt 重复计数。

### 13.5 GREEN

实现后至少证明：

1. 合法 `signed-executor-v1` Linux receipt GREEN；
2. 合法 `signed-executor-v1` Windows receipt GREEN；
3. 合法 `github-actions-v1` receipt GREEN；
4. GitHub 与 signed executor 在相同 gate/head/command set 上归一为等价 policy fact；
5. 完整 Linux + Windows requirement set GREEN；
6. 所有篡改测试持续 RED-by-design，即 verifier 返回明确拒绝。

## 14. 实施路径约束

正式实施计划应把工作拆为小批次：

1. canonical receipt + schema + vectors；
2. command-set registry；
3. signed-executor verifier；
4. safe command-set runner；
5. GitHub adapter；
6. requirement aggregation；
7. CLI verification tooling；
8. documentation + threat tests；
9. independent code review；
10. exact-Head verification。

每批必须：

- 失败测试先行；
- 只修根因，不添加绕过开关；
- 不允许 `--skip-verification`、`ALLOW_UNTRUSTED_EVIDENCE`、fallback success 等逃生口；
- 不强推、不改写历史；
- 保留 exact-Head 证据；
- 新依赖如非必要不得增加。

## 15. OSS-A 迁移规则

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

因此 PVEP 解决的是未来和后续验证可用性，不是对当前 outage 的临时豁免。

## 16. 与 GitHub Actions 的长期关系

GitHub Actions 保留为首选自动化适配器之一：

- 可用时持续自动跑；
- outage 时不再是唯一证据生产路径；
- GitHub 结果和 signed executor 结果使用同一 command-set contract；
- 若两种来源对同一 exact Head 产生矛盾结果，默认 fail-closed，并要求诊断根因；不得选择“更绿”的一个。

## 17. 验收标准

PVEP 第一阶段完成必须同时满足：

- 核心 receipt schema 与 canonical digest 有固定 vectors；
- Ed25519 signed executor 有完整正/负测试；
- GitHub adapter 不能信任 workflow 自述结果；
- runner 不允许 shell 注入或任意命令；
- Linux/Windows 平台不可互换；
- exact base/head 不可漂移；
- command set 不可漂移；
- artifacts 可摘要复验；
- executor 可撤销并有 generation；
- requirement aggregation fail-closed；
- policy fact 不暴露对 GitHub run ID 的必要依赖；
- 不修改 PR #67；
- 不修改 OSS-A 当前 final seal 合同；
- 不自动授权任何 merge/release/promotion/WP-B。

## 18. 设计结论

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

PVEP 把 GitHub Actions 从“唯一验证权威”降为“可信证据适配器之一”，同时保持 exact-SHA、跨平台验证、独立审查和显式用户批准的全部治理强度。任何证据缺失、身份漂移或验证失败都必须 fail-closed。
