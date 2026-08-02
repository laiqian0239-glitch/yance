# Yance Architecture Closure V2 — WP-A / A2 独立源码复审

- 文档类型：`INDEPENDENT_SOURCE_REVIEW`
- 工作包：`WP-A`
- 任务：`A2_VERSIONED_CANONICAL_SERIALIZATION_AND_DATA_CLASSIFICATION`
- 仓库：`laiqian0239-glitch/yance`
- PR：`#5`（必须保持 Draft）
- 初始 RED Head：`81d92f05ce061c984c5936047bced1863337e585`
- 首轮 GREEN Head：`44e38d30ba5a79ecf18e885d13f089f221249965`
- 复审补强 RED Head：`fdef944954ad9d86f707b10a19e617075ce8f099`
- 最终受审源码 Head：`ff74d7a72a7be2974a4023035ab6d779e17ed081`
- 复审日期：2026-08-02
- 最终结论：`APPROVED_AFTER_REVIEW_REOPEN_AND_ROOT_REPAIR`

## 1. 审查边界

本轮只审查 A2 新增的三个公共模块及其测试：

- `backend/services/canonicalSerialization.js`
- `backend/services/dataClassificationRegistry.js`
- `backend/services/eventTypeRegistry.js`
- `backend/tests/architectureClosureV2/wpA/canonicalSerialization.test.js`
- `backend/tests/architectureClosureV2/wpA/dataClassificationRegistry.test.js`
- `backend/tests/architectureClosureV2/wpA/eventTypeRegistryReplay.test.js`

本轮不审查、也不授权 A3–A8、WP-B–WP-H、Gate 1、候选包、推广、合并或发布。

## 2. 审查方法

1. 对照总体设计、独立设计修订案、实施计划与实施计划修订案逐条核验。
2. 检查确定性、跨平台一致性、字段枚举、getter/accessor、副作用、秘密/二进制边界、schema 演进与 Upcaster 执行环境。
3. 不把首轮 21/21 测试通过直接解释为源码闭环；在源码层重新构造对抗输入。
4. 每个新增缺陷先加入失败测试并取得 Ubuntu/Windows RED，再实施公共层修复。
5. 最终复验 A1 前置合同、A2 合同和既有 SQLite ownership/fencing 回归。

## 3. 首轮 TDD 证据

### 3.1 RED

- Head：`81d92f05ce061c984c5936047bced1863337e585`
- Workflow：`30736818711`
- Ubuntu Job：`91466991439`
- Windows Job：`91466991449`
- A1 前置：每个平台 `12/12 PASS`
- A2：每个平台 `0/21 PASS`，21 项仅因三个公共模块不存在而失败

该 RED 证明测试先于生产实现，且失败原因不是分支策略、旧回归或环境错误。

### 3.2 首轮 GREEN

- Head：`44e38d30ba5a79ecf18e885d13f089f221249965`
- Workflow：`30736985826`
- Ubuntu Job：`91467461468` — SUCCESS
- Windows Job：`91467461457` — SUCCESS
- A2：每个平台 `21/21 PASS`
- 既有 SQLite/fencing 回归：每个平台 `22/22 PASS`

首轮 GREEN 只证明原始合同满足，不作为独立复审最终结论。

## 4. 独立复审发现与根因修复

| ID | 级别 | 首轮实现缺口 | 风险 | RED / 修复 |
|---|---|---|---|---|
| A2-R-P1-01 | P1 | 对象键和 set-like 元素使用 `localeCompare` 排序 | 排序受宿主区域实现影响，跨 OS/locale hash 可能不一致 | 注入反向 `localeCompare` 取得 RED；改为 ECMAScript 字符串关系运算的 UTF-16 code-unit 顺序 |
| A2-R-P1-02 | P1 | symbol key、稀疏数组和数组自定义属性未进入编码也未拒绝 | 隐藏状态可从 hash 中消失 | 新增三类对抗测试；统一 fail-closed |
| A2-R-P0-01 | P0 | 分类校验只遍历 enumerable string keys | non-enumerable/symbol 字段可绕过 unknown-field 门禁并夹带内容 | 改为 `getOwnPropertyNames` + symbol 显式拒绝 |
| A2-R-P0-02 | P0 | 二进制引用预扫描使用 `Object.entries` | getter 可在校验前执行副作用或抛出非治理错误 | 先检查 descriptors；整个校验不读取 accessor |
| A2-R-P1-03 | P1 | 任意 URL scheme 可作为 credential/binary reference | HTTP URL 可冒充 custody/managed reference，削弱存储边界 | credential 仅允许 vault/credential/custody scheme；binary 仅允许 managed scheme |
| A2-R-P0-03 | P0 | Upcaster 原函数直接在宿主进程调用，静态正则可被闭包别名绕过 | Upcaster 可访问宿主闭包、环境或副作用能力 | 改为受限 `node:vm` context；禁止宿主 globals、动态代码、随机、定时器、网络/文件能力，并设置执行预算；只返回 structured-cloneable plain data |
| A2-R-P1-04 | P1 | descriptor 额外字段被忽略，payload required 字段未强制分类覆盖 | 临时开关或未分类重放字段可静默进入注册表 | descriptor/upcaster 使用精确字段集合；required payload 字段必须有合法分类 |

## 5. 复审补强 RED

- Head：`fdef944954ad9d86f707b10a19e617075ce8f099`
- Workflow：`30737130362`
- Ubuntu Job：`91467868831` — EXPECTED FAILURE
- Windows Job：`91467868855` — EXPECTED FAILURE
- A1 前置：每个平台 `12/12 PASS`
- A2：每个平台 `21 PASS / 7 EXPECTED FAIL`

七个失败与上表七个复审缺口一一对应；没有通过改测试、skip、平台例外、宽泛 allowlist 或警告降级制造 GREEN。

## 6. 最终源码核验

### 6.1 Canonical serialization

通过：

- 版本号进入 hash domain；
- object key 和 set-like value 使用 locale-free code-unit 顺序；
- timestamp 统一 UTC ISO；
- `-0` 归一为 `0`；
- NaN、Infinity、unsafe integer fail-closed；
- 普通数组保持顺序，set-like 数组按 canonical value 去重排序；
- symbol key、稀疏数组、自定义数组属性、accessor、cycle、executable、binary 和 non-plain object 全部拒绝；
- 输入对象不被修改。

### 6.2 Data classification

通过：

- 分类词汇固定为 `PUBLIC_METADATA / BUSINESS_CONTENT / SECRET_REFERENCE / BINARY_REFERENCE`；
- schema 和 payload 使用 own-property descriptors，non-enumerable 不会消失；
- symbol key 显式拒绝；
- unknown/unclassified/missing field fail-closed；
- BUSINESS_CONTENT 不复制到 metadata；
- secret 只保存 custody reference、generation、receipt 与 scope，不接受原始 key/token/cookie/QR；
- binary 只保存 managed reference、hash、size、mime、lifecycle，不接受 Buffer/TypedArray/base64/bytes；
- getter 在错误返回前不会执行。

### 6.3 Event type / Upcaster registry

通过：

- descriptor 必填字段和允许字段集合固定；
- payload required 字段必须有合法分类；
- duplicate exact descriptor 幂等，冲突 descriptor fail-closed；
- Upcaster 只能逐版本、连续、唯一地演进到当前 schema；
- 明确的时间、随机、环境、文件、网络源代码在注册时拒绝；
- 执行时在隔离 VM context 内运行，无宿主闭包、process、require、fetch、Date、random、timer、crypto、Buffer 等能力；
- 动态代码和 WebAssembly 禁止，单次执行有时间预算；
- 输出必须 structured-cloneable plain data；
- 输入 mutation、Promise、两次执行输出不一致全部 fail-closed；
- public descriptor 不暴露可直接调用的原始 transform。

说明：该 VM context 用于执行仓库内、源码审查过的版本迁移函数，不是向用户开放的不可信脚本运行平台；任何运行时上传脚本或远端代码均不在本合同内且默认禁止。

## 7. 最终双平台验证

- 最终受审源码 Head：`ff74d7a72a7be2974a4023035ab6d779e17ed081`
- Workflow：`30737251833`
- Ubuntu Job：`91468231849` — SUCCESS
- Windows Job：`91468231885` — SUCCESS

每个平台：

```text
Windows mutex helper       3/3 PASS
AuthorityWriteHost         7/7 PASS
Real process matrix        2/2 PASS
A2 contracts              28/28 PASS
Legacy SQLite/fencing     22/22 PASS
```

## 8. CodeRabbit 与 Sentry 边界

- CodeRabbit 已通过 PR 评论 `5156080850` 显式触发。
- CodeRabbit 服务为该 Draft/Free 席位生成 walkthrough/summary，但仍标记 `Review skipped`，没有形成正式 review；本报告不把人工独立复审冒充为 CodeRabbit 结果。
- Sentry 插件已调用，但本会话没有可用的 read-only Sentry token 或连接的 Sentry API，因此没有执行生产事件查询，也没有伪造“无错误”结论。
- A2 是尚未切入生产命令链的新公共模块；真实运行时错误率与事件证据必须在后续集成/UAT 阶段通过实际 Sentry 连接或等价生产可观测性证据核验。

## 9. 最终结论

```text
A2IndependentSourceReview=APPROVED_AFTER_REVIEW_REOPEN_AND_ROOT_REPAIR
openP0=0
openP1=0
A2SourceClosed=true
WP_A_Complete=false
A3ProductionCodeAuthorized=false
WP_B_TO_WP_H_LOCKED=true
gate1MayStart=false
candidatePackageGenerated=false
readyForPromotion=false
formalRelease=false
prMustRemainDraft=true
```

A2 可以关闭，并可在最终治理 Head 再验证成功后只授权 A3 的 test-first 阶段；不得据此开始 A3 生产实现、WP-B、Gate 1、候选包或发布。
