# 言策 Round 12 / Round 13｜交付自检与缺陷闭环报告

> **历史报告状态：已被第二次独立自检取代。** 029237f 仍存在“任意后继提交可冒充元数据交付、脏工作区仍可通过”的门禁缺陷；当前有效身份见 `ROUND12_13_SECOND_SELF_CHECK_CLOSURE_REPORT_ZH.md`。

> 结论：原交付提交 `64da4973f40348f5c633a05ed874212fdc0e15ae` 被本次自检驳回并取代。它不能继续作为可信的 Round 12 / 13 交付身份，也不能据此生成 Windows UAT。

## 一、自检范围

本次不是只重跑原有测试，而是反向核对：

- Git Branch、Commit、Tree、Parent、Tag 与工作区状态；
- 完整源码 ZIP 是否逐文件等同于 Git HEAD；
- Bundle、Patch、材料包和 SHA256 是否可复原；
- `YANCE_SOURCE_CHECKPOINT.json` 是否真的是生产工具读取的规范身份；
- Round 12 能力、身份、Outbox、Adapter 和事件权威是否真正接入主链；
- Round 13 质量路由是否真正阻止不合格模型，而不是只生成诊断结果；
- 自动测试是否遗漏失败事务和实时账号状态等反向场景。

## 二、发现并关闭的五项真实缺陷

### 1. 规范源码身份文件仍指向 Round 11

原源码 ZIP 虽然与 Git HEAD 一致且没有重复条目，但仓库中的规范文件 `YANCE_SOURCE_CHECKPOINT.json` 仍指向 Round 11 的 `8fab2cf...`。Round 12 专用身份文件是正确的，但运行预检、完整资产清单和通用源码交付工具读取的是规范文件。

这意味着原交付的“身份文件恰好一份”只统计了专用文件，没有证明正式工具会读到正确身份。

**修复：**规范身份文件现在明确指向本次功能实现提交 `3bdeb66...` 及 Tree `45eda78...`，并登记原交付已被取代。

### 2. AIQualityRouteAuthority 对部分任务仅观测、不阻断执行

原 `AiGateway` 会生成质量计划，但仍把旧路由规则选中的 primary 放入实际执行候选。翻译、事实提取、记忆提取等任务可能在缺少专项质量标签或严格 JSON 能力时仍被调用。

**修复：**

- primary 只有在 `primaryPass` 或显式允许的 `primaryConditional` 时才能进入执行候选；
- fallback 必须在合格 primary 基础上满足同档门禁；
- emergency 必须经过显式应急资格；
- 无合格候选时返回 `AI_QUALITY_ROUTE_BLOCKED`，携带完整质量计划；
- 新增 Gateway 级反向测试，证明旧规则可选但质量不合格的翻译和事实模型不会执行。

### 3. 身份证据早于消息事务提交

原入站链先创建 `Person / IdentityLink / identity_link_audit`，随后才提交消息事务。若消息写入失败，身份审计可能引用一个不存在的消息 ID。

**修复：**

- 先事务化保存联系人、会话和消息；
- 成功提交后才观察身份并绑定证据；
- 身份富化失败不回滚真实消息；
- 新增故障注入测试，强制消息投影失败并证明 persons、identity_links 和 identity_link_audit 均为 0。

### 4. SendPolicy 使用了陈旧账号行或默认放行不存在账号

原策略优先读取底层账号表，而实时 `canSend / credentialReady / state` 由 AccountManager 运行投影维护；同时缺少账号时会生成默认可发送的兼容投影。其结果可能是：真实已连接账号被错误阻断，或不存在的 Facebook / Telegram 账号先进入队列再失败。

**修复：**

- 默认从 AccountManager 的实时公开投影读取账号能力；
- 平台不匹配立即阻断；
- 不存在账号在入队前返回 `ACCOUNT_NOT_CONFIGURED`；
- WhatsApp 旧运行身份只有提供明确运行证据时才能走兼容投影，不能凭任意 ID 自动放行；
- 新增实时账号投影和不存在账号反向测试。


### 5. 源码 UAT 预检错误拒绝“实现提交 + 元数据交付提交”

规范身份文件明确允许后续元数据提交包含已经冻结的功能实现提交，但原 `sourceUatP0Preflight` 仍要求 Git HEAD 与 checkpoint commit/tree 完全相等。只要在功能实现后提交交付说明或身份文件，真实 Git 工作区就会被错误判定为 `P0_SOURCE_BASELINE_MISMATCH`。

**修复：**

- 在 Git 仓库中读取 checkpoint 指向的实现提交真实 Tree；
- 验证该 Tree 与 checkpoint 完全一致；
- 验证实现提交是当前 HEAD 的祖先；
- 允许同分支或 detached HEAD 的合法交付检查；
- 错误 Tree、缺失提交或无祖先关系继续 fail-closed；
- 新增“元数据提交合法包含实现”和“伪造 Tree 必须阻断”反向测试。

## 三、修复后功能实现身份

- Branch：`architecture/system-round12-platform-core-unification-20260726`
- Implementation Commit：`3bdeb66fe626d46990cfbf0f3693b4c29415869c`
- Implementation Tree：`45eda78962c9f344005fbb6e87ef250eb4bb965f`
- Parent：`00eeba03e155b877edebc5efd5bebcdb49b37292`
- Implementation Tag：`architecture-round12-round13-selfcheck-v2-implementation-20260726`

## 四、修复后自动证据

- Round 12 平台核心：`26/26 PASS`；
- Round 13 AI 质量：`24/24 PASS`；
- 顶层后端完整回归：`768/768 PASS`；
- 源码 UAT 交付专项：`26/26 PASS`；
- UAT 诊断：`109/109 PASS`；
- Round 11 UI 源码契约：`6/6 PASS`；
- 主题颜色审计：`PASS`，固定颜色债务 `0`；
- 本次修改 JavaScript 语法：`9/9 PASS`；
- Git whitespace：`PASS`。

`backend/tests/personaBrain/candidateBinding.test.js` 仍因当前容器没有完整 Express 依赖而未运行，未计为通过。

## 五、仍未完成

本次自检没有把以下项目冒充完成：

- 真实 Windows UI；
- Facebook、WhatsApp、Telegram 真实账号；
- 真实 OpenRouter 高能力主备模型；
- domain_event 权威投影切换；
- 所有出站操作全部进入持久 Outbox；
- Adapter 内部认证和 Reconcile 全量迁移；
- 自动跨平台身份合并；
- 自动 L2 / L3 学习综合；
- 超时前上下文缩减；
- Kurt 完整正向与反向证据链。

## 六、结论

本次自检证明原 `64da497` 交付不能直接接受。修复后的实现提交关闭了规范身份、AI 质量执行门禁、身份证据事务顺序、实时账号发送策略和源码预检身份包含关系五个实际根因。

后续只能以本报告所列的新实现身份及其后续元数据交付提交为基线继续推进。
