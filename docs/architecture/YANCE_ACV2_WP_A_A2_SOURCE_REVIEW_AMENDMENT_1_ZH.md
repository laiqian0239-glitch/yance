# Yance Architecture Closure V2 — WP-A / A2 独立源码复审修订 1

- 文档类型：`NORMATIVE_INDEPENDENT_SOURCE_REVIEW_AMENDMENT`
- 修订编号：`ACV2-A2-ISR-001`
- 被修订报告：`docs/architecture/YANCE_ACV2_WP_A_A2_SOURCE_REVIEW_ZH.md`
- 被修订报告原最终 Head：`ff74d7a72a7be2974a4023035ab6d779e17ed081`
- 最终受审源码 Head：`947c5a66610d260869188bb7c8fdf36ee0b00f54`
- 修订日期：2026-08-02
- 最终结论：`APPROVED_AFTER_TWO_ADDITIONAL_REOPENS_AND_ROOT_REPAIRS`

## 1. 效力

本修订案具有优先效力。原报告中把 `ff74d7a...`、Workflow `30737251833` 和 `28/28 PASS` 作为最终闭环的结论已撤销；这些记录仅保留为中间 GREEN 证据。

撤销原因不是测试波动，而是独立对抗复核在中间 GREEN 后继续发现两个 P0 公共层缺口：

1. VM 上下文接收宿主创建的 payload 对象，payload 的 constructor chain 可抵达宿主 Function 构造器。
2. 普通对象 clone/registry 路径未统一拒绝 `__proto__`、`prototype`、`constructor` 自有键，存在原型污染或字段静默消失风险。

## 2. P0：VM host-object constructor escape

### 2.1 根因

首轮 VM 修复虽然启用了：

```text
codeGeneration.strings=false
codeGeneration.wasm=false
```

但在 `vm.createContext()` 前把宿主创建的对象直接赋给：

```text
sandbox.__input = hostOriginObject
```

因此 `payload.constructor.constructor` 仍可引用宿主 realm 的 Function 构造器；VM 自身禁止动态代码不能约束已经跨边界传入的宿主构造器。

### 2.2 RED

- Head：`d002960ce414767bb6c002e2f279f659095d77a4`
- Workflow：`30737394158`
- Ubuntu Job：`91468598290` — EXPECTED FAILURE
- Windows Job：`91468598271` — EXPECTED FAILURE
- A1 前置：每个平台 `12/12 PASS`
- A2：每个平台 `29 PASS / 1 EXPECTED FAIL`

失败测试：

```text
payload.constructor.constructor('return process')()
```

测试证明逃逸实际获得宿主 `process`，不是理论告警。

### 2.3 底层修复

`eventTypeRegistry.js` 改为 primitive-only VM boundary：

1. 宿主只把 `JSON.stringify(payload)` 产生的字符串放入 sandbox。
2. VM 内使用该 context 自己的 `JSON.parse` 创建 payload。
3. 调用 Upcaster 前删除输入字符串全局变量。
4. 输入变更快照和输出仅以 JSON 字符串返回宿主。
5. 宿主不向 VM 注入对象、函数、Buffer、Date、process、require、fetch、timer、crypto 或任何能力对象。
6. context-native Function 仍受 `codeGeneration.strings=false` 约束。

验证 Head：`50e75537720ac4bc455de0fe821fae1b9ebe932e`；Workflow `30737480199`；Ubuntu `91468816238`、Windows `91468816210` 均 SUCCESS；A2 每个平台 `30/30 PASS`。

## 3. P0：prototype mutation key boundary

### 3.1 根因

canonical、classification 与 event registry 的部分 clone 路径使用普通对象赋值：

```text
result[key] = value
```

如果 key 为 `__proto__`，赋值可能修改原型而不是创建普通数据字段；`prototype` 与 `constructor` 也会形成构造器/原型攻击面。仅依赖 plain-object 检查不能关闭 own-property 保留键风险。

### 3.2 RED

- Head：`064993668171cb796482ab79372f5d049fa10caa`
- Workflow：`30737549974`
- Ubuntu Job：`91469007420` — EXPECTED FAILURE
- Windows Job：`91469007370` — EXPECTED FAILURE
- A1 前置：每个平台 `12/12 PASS`
- A2：每个平台 `30 PASS / 3 EXPECTED FAIL`

三个失败分别覆盖：

1. canonical serialization 任意深度保留键；
2. classification schema / event payload 保留键；
3. event descriptor schema / historical upcast payload 保留键。

### 3.3 底层修复

三个公共模块统一在读取/排序/clone/序列化前拒绝 own key：

```text
__proto__
prototype
constructor
```

并返回稳定的领域错误：

```text
CANONICAL_FORBIDDEN_OBJECT_KEY
DATA_CLASSIFICATION_FORBIDDEN_KEY
EVENT_DESCRIPTOR_FORBIDDEN_KEY
```

错误包含精确 `fieldPath`，且测试证明 `Object.prototype` 未被污染。

## 4. 最终验证

- 最终受审源码 Head：`947c5a66610d260869188bb7c8fdf36ee0b00f54`
- Workflow：`30737653039`
- Ubuntu Job：`91469279772` — SUCCESS
- Windows Job：`91469279753` — SUCCESS

每个平台：

```text
Windows mutex helper       3/3 PASS
AuthorityWriteHost         7/7 PASS
Real process matrix        2/2 PASS
A2 contracts              33/33 PASS
Legacy SQLite/fencing     22/22 PASS
```

## 5. CodeRabbit 与 Sentry

- CodeRabbit 已通过评论 `5156080850` 调用；服务因 Draft/Free 席位跳过正式 Review，只生成 walkthrough/summary。本修订不把独立人工源码复审表述为 CodeRabbit 结果，也不为触发机器人把 PR 改为 Ready。
- Sentry 插件已调用，但当前会话没有 read-only Sentry token 或已连接的 Sentry API，故未执行生产事件查询，也未伪造“无错误”结论。
- A2 尚未接入完整生产 command path；真实运行错误率需要后续集成与 UAT 绑定真实 Sentry/等价可观测性证据。

## 6. 最终结论

```text
A2IndependentSourceReview=APPROVED_AFTER_TWO_ADDITIONAL_REOPENS_AND_ROOT_REPAIRS
supersededFinalHead=ff74d7a72a7be2974a4023035ab6d779e17ed081
finalReviewedCodeHead=947c5a66610d260869188bb7c8fdf36ee0b00f54
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

只有承载本修订案和最终治理状态的 Head 再次通过 Ubuntu/Windows 矩阵后，才可授权 A3 的 test-first 阶段；A3 生产实现仍必须等待其自身有效 RED。
