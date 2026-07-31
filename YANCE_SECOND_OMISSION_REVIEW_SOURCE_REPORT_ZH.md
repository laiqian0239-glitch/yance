# 言策第二轮独立遗漏审查源码报告

## 1. 审查身份与边界

- 审查分支：`development/second-omission-review-after-d45747e`
- 审查基点：`d45747e8420446ed3ca4a5a9386e24adae14d9b4`
- 上游恢复基线：`992d6cb806d94313a644e6387fbb934f34bc75d0`
- 本报告只声明源码级修复与自动回归结果，不声明真实 Windows、Facebook、WhatsApp、Telegram 或 OpenRouter 验收通过。
- 原 `YANCE_ROUND12_13_WINDOWS_UAT_d45747e.zip` 已失效，不得继续作为验收候选。

## 2. 第二轮发现并关闭的源码遗漏

### OMISSION-01｜Person 读取统一但写操作仍按当前 contact 分叉

回复学习恢复/清空、学习治理偏好修改/恢复/遗忘、客户档案和关系投影写入仍可能只修改当前平台联系人。现已统一解析 Person 范围；contact 仅作为入口和来源身份保留。相同版本在多个身份上内容不一致时 fail-closed，必须指定来源身份。

### OMISSION-02｜领域事件投影的 actual 仍可能由 expected/payload 自证

已将运营投影器改为读取消息、发送队列、联系人、会话、回执、历史同步、Reconcile、媒体和身份绑定的真实持久化状态。只有下游快照验证成功才设置 `_projectionVerified=true`；缺失或不一致生成阻断收据。

### OMISSION-03｜旧投影器版本可能继承历史自证收据

运营投影器版本由 `round13-v1` 升级为 `round13-v2`，强制旧事件重新审计，不允许沿用旧 applied 收据。

### OMISSION-04｜证据分页正确，但导出脱敏阶段暗截前 100 条

证据导出脱敏函数不再对数组固定 `slice(0,100)`。新增 150 条证据回归，确认全部保留、敏感身份哈希化、分页完整性状态不被伪造。

### OMISSION-05｜Windows 证据脚本自动截取整个桌面

已移除 `CopyFromScreen` 和 `current-screen.png` 自动全桌面截图。证据包只接受人工审查后的言策应用窗口截图，并写入截图采集政策说明，避免其他窗口、消息、二维码或凭据进入包内。

### OMISSION-06｜六份 V3 核心协议未进入正式源码门禁

已新增并校验：Artifact Descriptor、Test Plan、Environment Descriptor、Evidence Manifest、Tool Permission Policy、Agent Capability Manifest。协议固定三权分离、L0-L3 权限、禁止自批、禁止截断证据晋升、禁止根据文件名判断版本。

### OMISSION-07｜Person 锚点首次写入可能丢失旧 contact 档案和关系证据

首次向 Person 统一锚点写入前，会把旧非锚点档案/关系行物化到锚点，再合并新内容。旧事实、证据和关系摘要不会因统一写入被覆盖或消失。

### OMISSION-08｜关系关键节点新建仍绑定当前 contact

新建的手工关系关键节点现统一落到 active Person 的 profile anchor；标记已有时间线事件时仍保留真实平台/contact 来源身份，满足“Person 聚合 + 来源可追溯”。

## 3. 兼容性回归修复

- 保留旧“仅共享客户档案”的显式关联语义：没有 active Person 时，共享档案不能顺带合并平台路由和关系证据。
- Person 统一后仍保留物理平台、账号、external identity 和原始会话来源，避免发送路由串号。
- `relationship` 学习治理写入不再错误回退到 global owner；不支持的写操作返回 409 并 fail-closed。

## 4. 自动验证

- 全后端发现式回归：147/147 个测试文件，900/900 项测试 PASS，0 失败。
- Round 12 平台核心：79/79 PASS。
- Round 13 AI 质量：24/24 PASS。
- UAT 诊断：117/117 PASS。
- 源码 UAT 交付：33/33 PASS。
- V3 协议：2/2 PASS。
- 主题固定色审计：PASS，债务 0。
- 修改 JavaScript 语法检查：PASS。
- `git diff --check`：PASS。

## 5. 尚未关闭的正式晋升阻断

### BLOCKER-01｜完整依赖 Persona API 门禁未执行成功

`tests/persona-brain/runtime-contract.test.js` 与 `tests/persona-brain/workbench-api.test.js` 需要 `express`。当前环境没有 `node_modules`，`npm ci` 请求内部 npm 仓库时大量 tarball 返回 HTTP 503，包括 `express-4.22.2.tgz`。因此这两项是“依赖环境阻断”，不能记为源码通过，也不能忽略。

### BLOCKER-02｜执行、独立审核、发布批准必须分离

当前工作由执行角色完成；按照 V3 协议，执行者不能自行完成独立审核和发布批准。

### BLOCKER-03｜真实 Windows 与平台证据仍未开始

在完整依赖、制品反向验证和独立审核通过前，不生成替代 Windows UAT。Facebook、WhatsApp、Telegram、OpenRouter 商业模型和 Kurt 端到端链仍需真实外部证据。

## 6. 结论

第二轮确实发现了上一候选遗漏，旧 `d45747e` Windows UAT 候选已作废。新增八类源码遗漏已修复并完成变更后的完整后端回归，但正式晋升仍被完整依赖门禁、独立审核和真实 Windows/平台证据阻断。本检查点只能作为源码审查检查点，不能称为 Windows UAT 候选或正式发布版。
